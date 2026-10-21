#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""环境自检 —— 检查运行环境与各数据源可达性。

这个 skill 要能在不同网络环境下用，但腾讯/新浪/巨潮在部分出口会被拦
（实测过东财和新浪 hq.sinajs 在某些机房直接 403/502）。先跑一遍 doctor，
就知道这台机器上哪些能力可用、哪些需要降级。

用法：
    python3 doctor.py
    python3 doctor.py --quick      # 只查关键三项
    python3 doctor.py --pretty

退出码：0 = 关键能力齐备，1 = 有降级，2 = 关键能力缺失
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(BASE_DIR, "cache")

MIN_PYTHON = (3, 7)

# 能力清单：key 用于结果索引，required 决定退出码
CAPABILITIES = [
    {
        "key": "python",
        "label": "Python 版本",
        "required": True,
        "hint": "脚本用了 f-string 与 dataclass，需 3.7+",
    },
    {
        "key": "sqlite",
        "label": "SQLite（db.py 落库）",
        "required": True,
        "hint": "标准库自带；缺失则无法落库与回看",
    },
    {
        "key": "cache",
        "label": "缓存目录可写",
        "required": False,
        "hint": "不可写时每次都要重新请求，容易触发限流",
    },
    {
        "key": "snapshot",
        "label": "腾讯实时快照",
        "required": True,
        "hint": "Phase 2 取指数与个股行情的主通道",
    },
    {
        "key": "kline",
        "label": "腾讯日K",
        "required": True,
        "hint": "验证股价走势、算近N日涨幅、T+N 回看都靠它",
    },
    {
        "key": "minute",
        "label": "腾讯分时/分钟K",
        "required": False,
        "hint": "可选；缺失时无法看日内节奏",
    },
    {
        "key": "fundflow",
        "label": "新浪资金流（大单净量）",
        "required": False,
        "hint": "可选；腾讯没有资金流接口，只能走新浪",
    },
    {
        "key": "cninfo",
        "label": "巨潮公告",
        "required": False,
        "hint": "可选但重要；缺失时「公告确认」只能靠搜索，证据强度下降",
    },
]


def _get(url, timeout=10, encoding="utf-8", headers=None):
    h = {"User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"),
         "Accept-Encoding": "gzip, deflate"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except Exception as exc:  # noqa: BLE001
        return None, "%s: %s" % (type(exc).__name__, str(exc)[:90])
    if raw[:2] == b"\x1f\x8b":
        import gzip
        try:
            raw = gzip.decompress(raw)
        except OSError:
            pass
    return raw.decode(encoding, "replace"), None


def check_python():
    cur = sys.version_info[:3]
    ok = cur[:2] >= MIN_PYTHON
    return ok, "Python %d.%d.%d" % cur, None


def check_sqlite():
    try:
        conn = sqlite3.connect(":memory:")
        conn.execute("CREATE TABLE t (a INTEGER)")
        conn.close()
        return True, "sqlite3 %s" % sqlite3.sqlite_version, None
    except Exception as exc:  # noqa: BLE001
        return False, None, str(exc)[:90]


def check_cache():
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        probe = os.path.join(CACHE_DIR, ".doctor-probe")
        with open(probe, "w", encoding="utf-8") as fh:
            fh.write("ok")
        os.remove(probe)
        return True, CACHE_DIR, None
    except OSError as exc:
        return False, None, str(exc)[:90]


def check_snapshot():
    txt, err = _get("https://qt.gtimg.cn/q=sh000001", encoding="gbk")
    if txt is None:
        return False, None, err
    if 'v_sh000001="' in txt and "~" in txt:
        price = txt.split("~")[3] if len(txt.split("~")) > 3 else "?"
        return True, "上证指数 %s" % price, None
    return False, None, "返回格式异常"


def check_kline():
    for host in ["https://ifzq.gtimg.cn", "https://web.ifzq.gtimg.cn"]:
        txt, err = _get("%s/appstock/app/fqkline/get?param=sh000001,day,,,5,qfq" % host,
                        headers={"Referer": "https://gu.qq.com/"})
        if txt and '"data"' in txt:
            try:
                doc = json.loads(txt)
                node = (doc.get("data") or {}).get("sh000001") or {}
                bars = node.get("qfqday") or node.get("day") or []
                if bars:
                    return True, "%s（%d 条）" % (host.split("//")[-1], len(bars)), None
            except ValueError:
                pass
        err = err or "无 K线数据"
    return False, None, err


def check_minute():
    txt, err = _get("https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=sh000001",
                    headers={"Referer": "https://gu.qq.com/"})
    if txt is None:
        return False, None, err
    try:
        doc = json.loads(txt)
        node = (doc.get("data") or {}).get("sh000001") or {}
        rows = ((node.get("data") or {}).get("data")) or []
        if rows:
            return True, "%d 个分时点" % len(rows), None
        return False, None, "无分时数据（可能未开盘）"
    except ValueError as exc:
        return False, None, "解析失败 %s" % exc


def check_fundflow():
    txt, err = _get("https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
                    "MoneyFlow.ssi_ssfx_flzjtj?daima=sh600519",
                    headers={"Referer": "https://finance.sina.com.cn/"})
    if txt is None:
        return False, None, err
    try:
        doc = json.loads(txt.strip())
        if isinstance(doc, dict) and "r0_in" in doc:
            return True, "四档资金字段齐全", None
        return False, None, "字段缺失"
    except ValueError:
        return False, None, "响应非 JSON"


def check_cninfo():
    import announcements as ann
    res = ann.search_market(*_recent_range(), limit=3)
    if res.get("ok"):
        return True, "近3日公告 %s 条" % res.get("total"), None
    return False, None, res.get("error")


def _recent_range(days=2):
    from datetime import date, timedelta
    today = date.today()
    return (today - timedelta(days=days)).isoformat(), today.isoformat()


CHECKERS = {
    "python": check_python,
    "sqlite": check_sqlite,
    "cache": check_cache,
    "snapshot": check_snapshot,
    "kline": check_kline,
    "minute": check_minute,
    "fundflow": check_fundflow,
    "cninfo": check_cninfo,
}


def run_checks(quick=False):
    keys = ["python", "sqlite", "snapshot", "kline"] if quick else list(CHECKERS)
    results = []
    for cap in CAPABILITIES:
        if cap["key"] not in keys:
            continue
        try:
            ok, detail, err = CHECKERS[cap["key"]]()
        except Exception as exc:  # noqa: BLE001
            ok, detail, err = False, None, "%s: %s" % (type(exc).__name__, str(exc)[:80])
        results.append({
            "key": cap["key"],
            "label": cap["label"],
            "required": cap["required"],
            "ok": bool(ok),
            "detail": detail,
            "error": err,
            "hint": cap["hint"],
        })
    return results


def summarize(results):
    required_fail = [r for r in results if r["required"] and not r["ok"]]
    optional_fail = [r for r in results if not r["required"] and not r["ok"]]
    if required_fail:
        status = "fail"
    elif optional_fail:
        status = "degraded"
    else:
        status = "ok"
    return {
        "status": status,
        "ok_count": sum(1 for r in results if r["ok"]),
        "total": len(results),
        "required_failed": [r["key"] for r in required_fail],
        "optional_failed": [r["key"] for r in optional_fail],
        "degradation": [
            "%s 不可用：%s" % (r["label"], r["hint"]) for r in optional_fail
        ],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="环境与数据源自检")
    parser.add_argument("--quick", action="store_true", help="只查 Python/SQLite/快照/日K")
    parser.add_argument("--pretty", action="store_true")
    parser.add_argument("--json", action="store_true", help="只输出 JSON")
    args = parser.parse_args(argv)

    results = run_checks(quick=args.quick)
    summary = summarize(results)
    payload = {"summary": summary, "checks": results}

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2 if args.pretty else None))
    else:
        print("环境自检")
        print("=" * 62)
        for r in results:
            mark = "OK  " if r["ok"] else ("FAIL" if r["required"] else "WARN")
            print("[%s] %-22s %s" % (mark, r["label"], r["detail"] or r["error"] or ""))
        print("-" * 62)
        print("%s  %d/%d 项通过" % (
            {"ok": "全部可用", "degraded": "有降级（可运行，部分能力缺失）",
             "fail": "关键能力缺失（无法正常运行）"}[summary["status"]],
            summary["ok_count"], summary["total"]))
        for d in summary["degradation"]:
            print("  - %s" % d)
        if args.pretty:
            print()
            print(json.dumps(payload, ensure_ascii=False, indent=2))

    return {"ok": 0, "degraded": 1, "fail": 2}[summary["status"]]


if __name__ == "__main__":
    sys.exit(main())
