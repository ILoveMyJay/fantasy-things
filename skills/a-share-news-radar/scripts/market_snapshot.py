#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""A股行情统一入口 —— 供 a-share-news-radar skill 调用。

设计原则：
1. 只用标准库，不依赖 numpy/pandas/tushare，避免环境问题
2. 一个命令一个 JSON 输出，便于 agent 直接读取
3. 本地缓存，接口异常时当天仍可用
4. 多源降级，不押单一接口

用法：
    python3 market_snapshot.py snapshot sh000001,sz399001,sz399006
    python3 market_snapshot.py kline sh600519 --days 60
    python3 market_snapshot.py minute sh000001
    python3 market_snapshot.py mkline sh600519 --period m5 --limit 48
    python3 market_snapshot.py tradecal
    python3 market_snapshot.py fundflow sh600519
    python3 market_snapshot.py fundflow-history sh600519 --days 60

数据源实测结论见 references/data-sources.md。
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime

# ----------------------------------------------------------------------------
# 常量
# ----------------------------------------------------------------------------

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(BASE_DIR, "cache")

SNAPSHOT_HOST = "https://qt.gtimg.cn/q="
KLINE_HOSTS = ["https://ifzq.gtimg.cn", "https://web.ifzq.gtimg.cn"]
MINUTE_HOSTS = ["https://web.ifzq.gtimg.cn", "https://ifzq.gtimg.cn"]
SINA_FLOW = ("https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
             "MoneyFlow.ssi_ssfx_flzjtj?daima=")
SINA_FLOW_HIST = ("https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
                  "MoneyFlow.ssl_qsfx_zjlrqs?daima=")

SNAPSHOT_BATCH = 20          # 腾讯快照单次最多 20 只
DEFAULT_TIMEOUT = 12
RETRIES = 2

# 腾讯快照字段下标（按 ~ 分割后）
SNAP_FIELDS = {
    1: "name", 2: "code", 3: "price", 4: "prev_close", 5: "open",
    31: "change", 32: "pct_chg", 33: "high", 34: "low",
    36: "volume", 37: "amount", 38: "turnover", 49: "volume_ratio",
}


# ----------------------------------------------------------------------------
# 基础 HTTP
# ----------------------------------------------------------------------------

def http_get(url, timeout=DEFAULT_TIMEOUT, encoding="utf-8", referer=None):
    """带重试与 gzip 解压的 GET。返回 (text, error)。"""
    last_err = None
    for attempt in range(RETRIES + 1):
        headers = {
            "User-Agent": UA,
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate",
        }
        if referer:
            headers["Referer"] = referer
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
            if raw[:2] == b"\x1f\x8b":
                try:
                    raw = gzip.decompress(raw)
                except OSError:
                    pass
            return raw.decode(encoding, "replace"), None
        except Exception as exc:  # noqa: BLE001
            last_err = "%s: %s" % (type(exc).__name__, str(exc)[:120])
            if attempt < RETRIES:
                time.sleep(0.6 * (attempt + 1))
    return None, last_err


# ----------------------------------------------------------------------------
# 缓存
# ----------------------------------------------------------------------------

def _cache_path(kind, key):
    day = date.today().isoformat()
    safe = urllib.parse.quote(str(key), safe="")
    return os.path.join(CACHE_DIR, "%s-%s-%s.json" % (kind, safe, day))


def cache_read(kind, key):
    path = _cache_path(kind, key)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def cache_write(kind, key, payload):
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(_cache_path(kind, key), "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=1)
    except OSError:
        pass


# ----------------------------------------------------------------------------
# 代码规范化
# ----------------------------------------------------------------------------

def normalize_code(code):
    """把 600519 / sh600519 / 600519.SH 统一成 sh600519。"""
    c = str(code).strip().lower()
    if c.startswith(("sh", "sz", "bj")):
        return c
    if "." in c:
        num, _, suffix = c.partition(".")
        suffix = suffix.upper()
        prefix = {"SH": "sh", "SZ": "sz", "BJ": "bj"}.get(suffix, "sh")
        return prefix + num
    if c.startswith(("6", "5", "9")):
        return "sh" + c
    if c.startswith(("0", "3", "1", "2")):
        return "sz" + c
    if c.startswith(("4", "8")):
        return "bj" + c
    return "sh" + c


INDEX_ALIASES = {
    "sh": "sh000001", "上证": "sh000001", "上证指数": "sh000001",
    "sz": "sz399001", "深证": "sz399001", "深证成指": "sz399001",
    "cyb": "sz399006", "创业板": "sz399006", "创业板指": "sz399006",
    "hs300": "sh000300", "沪深300": "sh000300",
    "zz500": "sh000905", "中证500": "sh000905",
}

INDEX_NAMES = {
    "sh000001": "上证指数", "sz399001": "深证成指", "sz399006": "创业板指",
    "sh000300": "沪深300", "sh000905": "中证500",
}


def expand_codes(raw):
    out = []
    for item in raw.replace("，", ",").split(","):
        item = item.strip()
        if not item:
            continue
        out.append(INDEX_ALIASES.get(item.lower(), normalize_code(item)))
    # 去重保序
    seen, uniq = set(), []
    for c in out:
        if c not in seen:
            seen.add(c)
            uniq.append(c)
    return uniq


# ----------------------------------------------------------------------------
# 实时快照（腾讯）
# ----------------------------------------------------------------------------

def _to_float(value):
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f


def parse_snapshot_text(text):
    """解析 v_sh600519="a~b~c..." 形式。"""
    rows = []
    for segment in text.split(";"):
        if '"' not in segment:
            continue
        head, _, tail = segment.partition('"')
        body, _, _ = tail.partition('"')
        if not body:
            continue
        fields = body.split("~")
        if len(fields) < 6:
            continue
        row = {}
        for idx, name in SNAP_FIELDS.items():
            row[name] = fields[idx] if idx < len(fields) else ""
        for key in ("price", "prev_close", "open", "change", "pct_chg",
                    "high", "low", "volume", "amount", "turnover", "volume_ratio"):
            row[key] = _to_float(row.get(key))
        row["code_raw"] = head.replace("v_", "").strip().rstrip("=")
        rows.append(row)
    return rows


def fetch_snapshot(codes, use_cache=True):
    """批量取实时快照，自动按 20 只分批。"""
    if isinstance(codes, str):
        codes = expand_codes(codes)
    key = ",".join(codes)
    if use_cache:
        hit = cache_read("snapshot", key)
        if hit:
            hit["_cache"] = True
            return hit

    results, errors = [], []
    for i in range(0, len(codes), SNAPSHOT_BATCH):
        batch = codes[i:i + SNAPSHOT_BATCH]
        url = SNAPSHOT_HOST + ",".join(batch)
        text, err = http_get(url, encoding="gbk")
        if text is None:
            errors.append({"batch": batch, "error": err})
            continue
        results.extend(parse_snapshot_text(text))

    payload = {
        "source": "tencent-qt.gtimg.cn",
        "fetched_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "count": len(results),
        "data": results,
        "errors": errors,
        "_cache": False,
    }
    if results and use_cache:
        cache_write("snapshot", key, {k: v for k, v in payload.items() if k != "_cache"})
    return payload


# ----------------------------------------------------------------------------
# 日K（腾讯，多 host 降级）
# ----------------------------------------------------------------------------

def fetch_kline(code, days=60, adjust="qfq", use_cache=True):
    code = normalize_code(code)
    key = "%s-%s-%s" % (code, days, adjust)
    if use_cache:
        hit = cache_read("kline", key)
        if hit:
            hit["_cache"] = True
            return hit

    errors = []
    for host in KLINE_HOSTS:
        url = "%s/appstock/app/fqkline/get?param=%s,day,,,%d,%s" % (host, code, days, adjust)
        text, err = http_get(url, referer="https://gu.qq.com/")
        if text is None:
            errors.append({"host": host, "error": err})
            continue
        try:
            doc = json.loads(text)
        except ValueError as exc:
            errors.append({"host": host, "error": "JSON 解析失败 %s" % exc})
            continue
        node = (doc.get("data") or {}).get(code) or {}
        series = node.get("%sday" % adjust) or node.get("day") or []
        if not series:
            errors.append({"host": host, "error": "无 K线数据（可能代码有误）"})
            continue
        bars = []
        for item in series:
            if len(item) < 6:
                continue
            bars.append({
                "date": item[0],
                "open": _to_float(item[1]),
                "close": _to_float(item[2]),
                "high": _to_float(item[3]),
                "low": _to_float(item[4]),
                "volume": _to_float(item[5]),
            })
        payload = {
            "source": "tencent-%s" % host.split("//")[-1],
            "code": code,
            "adjust": adjust,
            "count": len(bars),
            "data": bars,
            "errors": errors,
            "_cache": False,
        }
        if use_cache:
            cache_write("kline", key, {k: v for k, v in payload.items() if k != "_cache"})
        return payload

    return {"source": None, "code": code, "count": 0, "data": [], "errors": errors}


def kline_metrics(code, days=25, use_cache=True):
    """从日K派生常用指标：近5日涨幅、连板数、量比等。"""
    res = fetch_kline(code, days=max(days, 25), use_cache=use_cache)
    bars = res.get("data") or []
    out = {"code": normalize_code(code), "bars": len(bars)}
    if len(bars) < 2:
        out["error"] = "K线不足，无法计算指标"
        return out

    closes = [b["close"] for b in bars if b["close"] is not None]
    pcts = []
    for prev, cur in zip(bars, bars[1:]):
        if prev["close"] and cur["close"]:
            pcts.append((cur["close"] - prev["close"]) / prev["close"] * 100)

    out["last_date"] = bars[-1]["date"]
    out["last_close"] = bars[-1]["close"]
    if len(closes) >= 6:
        out["pct_5d"] = round((closes[-1] - closes[-6]) / closes[-6] * 100, 2)
    if len(closes) >= 21:
        out["pct_20d"] = round((closes[-1] - closes[-21]) / closes[-21] * 100, 2)
    if pcts:
        out["pct_1d"] = round(pcts[-1], 2)
        # 连续同向涨跌幅超过 9.5% 视作连板
        limit_ups = 0
        for p in reversed(pcts):
            if p >= 9.5:
                limit_ups += 1
            else:
                break
        out["consecutive_limit_up"] = limit_ups
        out["recent_pct"] = [round(p, 2) for p in pcts[-5:]]
    vols = [b["volume"] for b in bars if b["volume"]]
    if len(vols) >= 6 and vols[-1]:
        avg5 = sum(vols[-6:-1]) / 5
        if avg5:
            out["volume_vs_5d_avg"] = round(vols[-1] / avg5, 2)
    return out


# ----------------------------------------------------------------------------
# 分时 / 分钟K
# ----------------------------------------------------------------------------

def fetch_minute(code, use_cache=True):
    code = normalize_code(code)
    if use_cache:
        hit = cache_read("minute", code)
        if hit:
            hit["_cache"] = True
            return hit

    errors = []
    for host in MINUTE_HOSTS:
        url = "%s/appstock/app/minute/query?code=%s" % (host, code)
        text, err = http_get(url, referer="https://gu.qq.com/")
        if text is None:
            errors.append({"host": host, "error": err})
            continue
        try:
            doc = json.loads(text)
        except ValueError as exc:
            errors.append({"host": host, "error": "JSON 解析失败 %s" % exc})
            continue
        node = (doc.get("data") or {}).get(code) or {}
        rows = ((node.get("data") or {}).get("data")) or []
        if not rows:
            errors.append({"host": host, "error": "无分时数据"})
            continue
        points = []
        for item in rows:
            parts = str(item).split()
            if len(parts) < 3:
                continue
            points.append({
                "time": parts[0],
                "price": _to_float(parts[1]),
                "cum_volume": _to_float(parts[2]),
                "cum_amount": _to_float(parts[3]) if len(parts) > 3 else None,
            })
        payload = {
            "source": "tencent-%s" % host.split("//")[-1],
            "code": code,
            "count": len(points),
            "data": points,
            "errors": errors,
            "_cache": False,
        }
        if use_cache:
            cache_write("minute", code, {k: v for k, v in payload.items() if k != "_cache"})
        return payload

    return {"source": None, "code": code, "count": 0, "data": [], "errors": errors}


def fetch_mkline(code, period="m5", limit=48, use_cache=True):
    code = normalize_code(code)
    if period not in ("m1", "m5", "m15", "m30", "m60"):
        return {"error": "period 必须是 m1/m5/m15/m30/m60"}
    key = "%s-%s-%s" % (code, period, limit)
    if use_cache:
        hit = cache_read("mkline", key)
        if hit:
            hit["_cache"] = True
            return hit

    errors = []
    for host in KLINE_HOSTS:
        url = "%s/appstock/app/kline/mkline?param=%s,%s,,%d" % (host, code, period, limit)
        text, err = http_get(url, referer="https://gu.qq.com/")
        if text is None:
            errors.append({"host": host, "error": err})
            continue
        try:
            doc = json.loads(text)
        except ValueError as exc:
            errors.append({"host": host, "error": "JSON 解析失败 %s" % exc})
            continue
        node = (doc.get("data") or {}).get(code) or {}
        series = node.get(period) or []
        if not series:
            errors.append({"host": host, "error": "无分钟K数据"})
            continue
        bars = []
        for item in series:
            if len(item) < 6:
                continue
            bars.append({
                "time": item[0],
                "open": _to_float(item[1]),
                "close": _to_float(item[2]),
                "high": _to_float(item[3]),
                "low": _to_float(item[4]),
                "volume": _to_float(item[5]),
            })
        payload = {
            "source": "tencent-%s" % host.split("//")[-1],
            "code": code,
            "period": period,
            "count": len(bars),
            "data": bars,
            "errors": errors,
            "_cache": False,
        }
        if use_cache:
            cache_write("mkline", key, {k: v for k, v in payload.items() if k != "_cache"})
        return payload

    return {"source": None, "code": code, "period": period, "count": 0, "data": [], "errors": errors}


# ----------------------------------------------------------------------------
# 交易日判断（零成本，不调 trade_cal）
# ----------------------------------------------------------------------------

def tradecal(use_cache=True):
    """用腾讯日K最后一条日期判断今天是否已开市。"""
    res = fetch_kline("sh000001", days=6, use_cache=use_cache)
    bars = res.get("data") or []
    today = date.today().isoformat()
    now = datetime.now()
    if not bars:
        return {
            "ok": False,
            "today": today,
            "error": "无法获取指数K线，无法判断交易日",
            "errors": res.get("errors"),
        }
    last = bars[-1]["date"]
    opened_today = (last == today)
    return {
        "ok": True,
        "today": today,
        "now": now.strftime("%H:%M"),
        "last_trade_date": last,
        "market_opened_today": opened_today,
        "has_today_bar": opened_today,
        "recent_trade_dates": [b["date"] for b in bars],
        "hint": (
            "今日已开市，可用当日数据" if opened_today
            else "今日尚无K线：若当前为盘前属正常；若已过 16:00 则今日休市"
        ),
        "source": res.get("source"),
    }


# ----------------------------------------------------------------------------
# 资金流（新浪，单只）
# ----------------------------------------------------------------------------

def _sina_json(url):
    text, err = http_get(url, referer="https://finance.sina.com.cn/")
    if text is None:
        return None, err
    body = text.strip()
    if body in ("", "null", "[]"):
        return None, "空结果"
    try:
        return json.loads(body), None
    except ValueError as exc:
        return None, "JSON 解析失败 %s" % exc


def fetch_fundflow(code, use_cache=True):
    """当日四档资金（超大/大/中/小单）。新浪只支持单只查询。"""
    code = normalize_code(code)
    if use_cache:
        hit = cache_read("fundflow", code)
        if hit:
            hit["_cache"] = True
            return hit

    doc, err = _sina_json(SINA_FLOW + code)
    if doc is None:
        return {"ok": False, "code": code, "error": err, "source": "sina"}

    def f(k):
        return _to_float(doc.get(k)) or 0.0

    r0_net = f("r0_in") - f("r0_out")
    r1_net = f("r1_in") - f("r1_out")
    r2_net = f("r2_in") - f("r2_out")
    r3_net = f("r3_in") - f("r3_out")

    payload = {
        "ok": True,
        "source": "sina-MoneyFlow.ssi_ssfx_flzjtj",
        "code": code,
        "fetched_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "unit": "元",
        "tiers": {
            "super_large": {"in": f("r0_in"), "out": f("r0_out"), "net": r0_net},
            "large": {"in": f("r1_in"), "out": f("r1_out"), "net": r1_net},
            "medium": {"in": f("r2_in"), "out": f("r2_out"), "net": r2_net},
            "small": {"in": f("r3_in"), "out": f("r3_out"), "net": r3_net},
        },
        "main_net": r0_net + r1_net,
        "main_net_yi": round((r0_net + r1_net) / 1e8, 2),
        "super_large_net_yi": round(r0_net / 1e8, 2),
        "_cache": False,
    }
    if use_cache:
        cache_write("fundflow", code, {k: v for k, v in payload.items() if k != "_cache"})
    return payload


def fetch_fundflow_history(code, days=60, use_cache=True):
    code = normalize_code(code)
    key = "%s-%s" % (code, days)
    if use_cache:
        hit = cache_read("fundflow_hist", key)
        if hit:
            hit["_cache"] = True
            return hit

    url = "%s%s&num=%d&sort=opendate&asc=0" % (SINA_FLOW_HIST, code, days)
    doc, err = _sina_json(url)
    if doc is None:
        return {"ok": False, "code": code, "error": err, "source": "sina"}

    rows = []
    for item in doc:
        rows.append({
            "date": item.get("opendate"),
            "close": _to_float(item.get("trade")),
            "pct_chg": round((_to_float(item.get("changeratio")) or 0) * 100, 2),
            "turnover": _to_float(item.get("turnover")),
            "net_amount": _to_float(item.get("netamount")),
            "super_large_net": _to_float(item.get("r0_net")),
            "super_large_ratio": _to_float(item.get("r0_ratio")),
        })
    payload = {
        "ok": True,
        "source": "sina-MoneyFlow.ssl_qsfx_zjlrqs",
        "code": code,
        "count": len(rows),
        "data": rows,
        "_cache": False,
    }
    if use_cache:
        cache_write("fundflow_hist", key, {k: v for k, v in payload.items() if k != "_cache"})
    return payload


# ----------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------

def _print(obj, pretty):
    if pretty:
        print(json.dumps(obj, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(obj, ensure_ascii=False))


def main(argv=None):
    parser = argparse.ArgumentParser(description="A股行情统一入口（腾讯/新浪）")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--pretty", action="store_true", help="缩进输出")
    common.add_argument("--no-cache", action="store_true", help="跳过本地缓存")
    sub = parser.add_subparsers(dest="cmd")

    p = sub.add_parser("snapshot", parents=[common], help="实时快照，20 只/批")
    p.add_argument("codes", help="逗号分隔，支持 600519 / sh600519 / 上证")

    p = sub.add_parser("kline", parents=[common], help="日K")
    p.add_argument("code")
    p.add_argument("--days", type=int, default=60)
    p.add_argument("--adjust", default="qfq", choices=["qfq", "hfq", ""])

    p = sub.add_parser("metrics", parents=[common], help="从日K派生指标（近5日涨幅/连板/量比）")
    p.add_argument("codes", help="逗号分隔多只")
    p.add_argument("--days", type=int, default=25)

    p = sub.add_parser("minute", parents=[common], help="当日分时")
    p.add_argument("code")

    p = sub.add_parser("mkline", parents=[common], help="分钟K")
    p.add_argument("code")
    p.add_argument("--period", default="m5", choices=["m1", "m5", "m15", "m30", "m60"])
    p.add_argument("--limit", type=int, default=48)

    sub.add_parser("tradecal", parents=[common], help="判断今天是否交易日")

    p = sub.add_parser("fundflow", parents=[common], help="当日四档资金（单只）")
    p.add_argument("code")

    p = sub.add_parser("fundflow-history", parents=[common], help="资金流历史（单只）")
    p.add_argument("code")
    p.add_argument("--days", type=int, default=60)

    args = parser.parse_args(argv)

    if not args.cmd:
        parser.print_help()
        return 1

    use_cache = not getattr(args, "no_cache", False)

    if args.cmd == "snapshot":
        out = fetch_snapshot(args.codes, use_cache=use_cache)
    elif args.cmd == "kline":
        out = fetch_kline(args.code, args.days, args.adjust or "qfq", use_cache=use_cache)
    elif args.cmd == "metrics":
        out = {"data": [kline_metrics(c, args.days, use_cache=use_cache)
                        for c in expand_codes(args.codes)]}
    elif args.cmd == "minute":
        out = fetch_minute(args.code, use_cache=use_cache)
    elif args.cmd == "mkline":
        out = fetch_mkline(args.code, args.period, args.limit, use_cache=use_cache)
    elif args.cmd == "tradecal":
        out = tradecal(use_cache=use_cache)
    elif args.cmd == "fundflow":
        out = fetch_fundflow(args.code, use_cache=use_cache)
    elif args.cmd == "fundflow-history":
        out = fetch_fundflow_history(args.code, args.days, use_cache=use_cache)
    else:
        parser.print_help()
        return 1

    _print(out, args.pretty)
    return 0 if not (isinstance(out, dict) and out.get("ok") is False) else 2


if __name__ == "__main__":
    sys.exit(main())
