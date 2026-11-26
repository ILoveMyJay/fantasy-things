# -*- coding: utf-8 -*-
"""看板 5 —— 国家队与 20 只核心宽基 ETF 真实日度净申赎与实时行情。

特性：
  1. 严格保留沪深清算对齐公式 estimate_flow() 与 calculate_etf_daily_flow()（含折算熔断）；
  2. 彻底移除默认用 demo-seed.json 冒充当日实盘数据的逻辑；
  3. 实时行情：通过腾讯 qt.gtimg.cn 秒级拉取 20 只核心宽基 ETF 现价、涨跌幅、成交额；
  4. 沪市官方份额：直连上交所官方接口 (query.sse.com.cn) 拉取最近两个完整交易日份额，精确复算亿元净申赎；
  5. 深市官方份额：直连深交所官方接口 (szse.cn) 拉取最新 T-1 日官方份额并滚动写入本地 JSON 历史缓存，
     次日起自动精确复算；尚无前日缓存时显式标明 "待次日基准"，绝不伪造。
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

_BASE_DIR = Path(__file__).resolve().parent.parent
_SHARE_CACHE_PATH = _BASE_DIR / "data" / "etf_share_history.json"

CORE_BASKET_20: list[str] = [
    "510300.SH", "510310.SH", "510500.SH", "510050.SH",
    "588000.SH", "588080.SH", "159915.SZ", "159919.SZ",
    "512100.SH", "159845.SZ", "563360.SH", "159352.SZ",
    "159338.SZ", "159949.SZ", "510210.SH", "159952.SZ",
    "159361.SZ", "512050.SH", "159633.SZ", "560010.SH",
]

CORE_ETF_META: dict[str, tuple[str, str]] = {
    "510300.SH": ("沪深300ETF华泰柏瑞", "沪深300"),
    "510310.SH": ("沪深300ETF易方达", "沪深300"),
    "159919.SZ": ("沪深300ETF嘉实", "沪深300"),
    "510500.SH": ("中证500ETF南方", "中证500"),
    "510050.SH": ("上证50ETF华夏", "上证50"),
    "588000.SH": ("科创50ETF华夏", "科创50"),
    "588080.SH": ("科创板50ETF易方达", "科创50"),
    "159915.SZ": ("创业板ETF易方达", "创业板指"),
    "159949.SZ": ("创业板50ETF华安", "创业板50"),
    "159952.SZ": ("创业板ETF广发", "创业板指"),
    "512100.SH": ("中证1000ETF南方", "中证1000"),
    "159845.SZ": ("中证1000ETF华夏", "中证1000"),
    "560010.SH": ("中证1000ETF广发", "中证1000"),
    "512050.SH": ("A500ETF基金华夏", "中证A500"),
    "563360.SH": ("A500ETF华泰柏瑞", "中证A500"),
    "159352.SZ": ("A500ETF南方", "中证A500"),
    "159338.SZ": ("中证A500ETF国泰", "中证A500"),
    "159361.SZ": ("中证A500ETF易方达", "中证A500"),
    "510210.SH": ("上证指数ETF国泰", "其他宽基"),
    "159633.SZ": ("中证1000ETF易方达", "中证1000"),
}

CATEGORY_12: list[str] = [
    "沪深300", "中证1000", "中证500", "科创50", "中证A500", "创业板指",
    "上证50", "其他宽基", "创业板50", "双创50", "中证2000", "国证2000",
]


def _is_sh(symbol: str) -> bool:
    return symbol.endswith(".SH")


def estimate_flow(
    current_share: float,
    prev_share: float,
    nav: float,
    prev_nav: float,
    split_ratio: float = 1.0,
) -> float | None:
    """计算净申赎金额（亿元），含机械折算熔断保护。"""
    if prev_share == 0 or prev_nav == 0:
        return None
    sr = current_share / (prev_share * split_ratio)
    nr = nav / (prev_nav / split_ratio)
    if (sr > 1.5 or sr < 0.67) and abs(sr * nr - 1.0) < 0.08:
        return None
    return (current_share - prev_share * split_ratio) * nav / 1e8


def calculate_etf_daily_flow(
    symbol: str,
    target_date: str,
    shares_map: dict[str, dict[str, float]],
    navs_map: dict[str, dict[str, float]],
    calendar: list[str],
    split_ratio: float = 1.0,
) -> dict[str, Any]:
    """计算单只 ETF 在指定日期的日度净申赎（严格执行沪深清算时滞对齐）。"""
    result: dict[str, Any] = {
        "symbol": symbol,
        "date": target_date,
        "flow": None,
        "issue": None,
    }
    sorted_cal = sorted(calendar)
    if target_date not in sorted_cal:
        result["issue"] = "not_a_trading_day"
        return result

    idx = sorted_cal.index(target_date)

    def _get(m: dict | None, d: str, sym: str):
        if not m or d not in m:
            return None
        val = m[d]
        return val.get(sym) if isinstance(val, dict) else val

    if _is_sh(symbol):
        if idx == 0:
            result["issue"] = "no_prev_day"
            return result
        prev_date = sorted_cal[idx - 1]
        current = _get(shares_map, target_date, symbol)
        prev = _get(shares_map, prev_date, symbol)
        nav = _get(navs_map, target_date, symbol)
        prev_nav = _get(navs_map, prev_date, symbol) or nav
    else:
        if idx + 1 >= len(sorted_cal):
            result["issue"] = "pending_t_plus_1_disclosure"
            return result
        next_date = sorted_cal[idx + 1]
        current = _get(shares_map, next_date, symbol)
        prev = _get(shares_map, target_date, symbol)
        nav = _get(navs_map, target_date, symbol)
        prev_date = sorted_cal[idx - 1] if idx > 0 else None
        prev_nav = (_get(navs_map, prev_date, symbol) if prev_date else None) or nav
        if current is None:
            result["issue"] = "pending_t_plus_1_disclosure"
            return result

    if current is None or prev is None or nav is None or prev_nav is None:
        result["issue"] = "missing_data"
        return result

    flow = estimate_flow(current, prev, nav, prev_nav, split_ratio)
    result["flow"] = flow
    if flow is None:
        result["issue"] = "circuit_breaker"
    return result


# ---------------------------------------------------------------------------
# 实时与官方交易所数据拉取
# ---------------------------------------------------------------------------

def fetch_core_etf_quotes() -> dict[str, dict[str, Any]]:
    """通过腾讯财经一次性拉取 20 只核心宽基 ETF 实时行情（现价/昨收/涨跌幅/成交额）。"""
    qt_syms = []
    for sym in CORE_BASKET_20:
        code, ex = sym.split(".")
        qt_syms.append(f"{ex.lower()}{code}")
    url = f"https://qt.gtimg.cn/q={','.join(qt_syms)}"
    quotes: dict[str, dict[str, Any]] = {}
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            text = resp.read().decode("gbk", errors="ignore")
            for line in text.strip().split(";"):
                if not line.strip() or "~" not in line:
                    continue
                fields = line.split("~")
                if len(fields) > 37:
                    code = fields[2]
                    ex = "SH" if code.startswith(("51", "56", "58")) else "SZ"
                    sym = f"{code}.{ex}"
                    quotes[sym] = {
                        "name": fields[1],
                        "price": float(fields[3]) if fields[3] else None,
                        "prev_close": float(fields[4]) if fields[4] else None,
                        "pct_chg": float(fields[32]) if fields[32] else None,
                        "amount_yi": round(float(fields[37]) / 10000.0, 2) if fields[37] else 0.0,
                    }
    except Exception as e:
        sys.stderr.write(f"[WARN] 拉取核心ETF实时行情异常: {e}\n")
    return quotes


def _fetch_sse_shares_for_date(stat_date: str) -> dict[str, float]:
    """从上交所官方查询指定日期全部沪市 ETF 份额（返回 {symbol: shares_in_units}）。"""
    url = (
        "https://query.sse.com.cn/commonQuery.do"
        f"?sqlId=COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L&STAT_DATE={stat_date}"
        "&pageHelp.pageSize=2000&pageHelp.pageNo=1"
    )
    out: dict[str, float] = {}
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.sse.com.cn/"},
        )
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            for row in data.get("result") or []:
                code = str(row.get("SEC_CODE", "")).strip()
                vol_wan = row.get("TOT_VOL")
                if code and vol_wan not in (None, "", "-"):
                    sym = f"{code}.SH"
                    if sym in CORE_ETF_META:
                        out[sym] = float(str(vol_wan).replace(",", "")) * 10000.0
    except Exception as e:
        sys.stderr.write(f"[WARN] 上交所ETF份额({stat_date})拉取失败: {e}\n")
    return out


def _fetch_szse_latest_shares() -> tuple[str | None, dict[str, float]]:
    """从深交所官方获取最新披露的深市核心 ETF 份额（返回 (stat_date, {symbol: shares})）。"""
    sz_codes = [s.split(".")[0] for s in CORE_BASKET_20 if s.endswith(".SZ")]
    out: dict[str, float] = {}
    stat_date: str | None = None
    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://www.szse.cn/"}
    for code in sz_codes:
        url = (
            "https://www.szse.cn/api/report/ShowReport/data"
            f"?SHOWTYPE=JSON&CATALOGID=1945&TABKEY=tab1&PAGENO=1&PAGESIZE=5&txtQueryKeyAndCode={code}"
        )
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=4) as resp:
                arr = json.loads(resp.read().decode("utf-8"))
                if not arr:
                    continue
                if stat_date is None:
                    dqgm_hdr = (arr[0].get("metadata", {}).get("cols", {}) or {}).get("dqgm", "")
                    m = re.search(r"(\d{4}-\d{2}-\d{2})", dqgm_hdr)
                    if m:
                        stat_date = m.group(1)
                for row in arr[0].get("data") or []:
                    key_html = str(row.get("sys_key", ""))
                    if f">{code}<" in key_html or code in re.sub(r"<[^>]+>", "", key_html):
                        dqgm = str(row.get("dqgm", "")).replace(",", "").strip()
                        if dqgm and dqgm != "-":
                            out[f"{code}.SZ"] = float(dqgm) * 10000.0
                        break
        except Exception:
            continue
    return stat_date, out


def _load_share_cache() -> dict[str, dict[str, float]]:
    if _SHARE_CACHE_PATH.exists():
        try:
            return json.loads(_SHARE_CACHE_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save_share_cache(cache: dict[str, dict[str, float]]) -> None:
    try:
        _SHARE_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        # 仅保留最近 90 个交易日
        keys = sorted(cache.keys())[-90:]
        trimmed = {k: cache[k] for k in keys}
        _SHARE_CACHE_PATH.write_text(
            json.dumps(trimmed, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except Exception:
        pass


def fetch_etf_flows_dashboard(target_date: str | None = None) -> dict[str, Any]:
    """拉取 20 只核心宽基 ETF 实时行情 + 官方交易所日度净申赎（零 demo 伪造）。"""
    quotes = fetch_core_etf_quotes()

    # 获取最近 5 个交易日
    try:
        from utils.calendar_guard import get_recent_trade_dates
        recent_days = get_recent_trade_dates(count=6)
    except Exception:
        recent_days = []

    share_cache = _load_share_cache()

    # 1. 上交所官方接口：自动寻找最近两个有数据的交易日
    sse_dates_found: list[str] = []
    for d in reversed(recent_days):
        sh_map = _fetch_sse_shares_for_date(d)
        if len(sh_map) >= 5:
            share_cache.setdefault(d, {}).update(sh_map)
            sse_dates_found.append(d)
            if len(sse_dates_found) >= 2:
                break

    # 2. 深交所官方接口：获取最新披露日份额并写入本地滚动缓存
    sz_date, sz_map = _fetch_szse_latest_shares()
    if sz_date and sz_map:
        share_cache.setdefault(sz_date, {}).update(sz_map)

    if share_cache:
        _save_share_cache(share_cache)

    sse_curr_date = sse_dates_found[0] if len(sse_dates_found) >= 1 else None
    sse_prev_date = sse_dates_found[1] if len(sse_dates_found) >= 2 else None

    # 深市寻找前一个已缓存日期
    sz_prev_date = None
    if sz_date:
        earlier_sz = [
            d for d in sorted(share_cache.keys())
            if d < sz_date and any(s.endswith(".SZ") for s in share_cache[d])
        ]
        if earlier_sz:
            sz_prev_date = earlier_sz[-1]

    core_rows: list[dict[str, Any]] = []
    broad_cats: dict[str, float] = {}
    total_turnover_yi = 0.0
    total_confirmed_flow = 0.0
    confirmed_count = 0

    for sym in CORE_BASKET_20:
        default_name, category = CORE_ETF_META.get(sym, (sym, "其他宽基"))
        q = quotes.get(sym, {})
        name = q.get("name") or default_name
        price = q.get("price")
        prev_close = q.get("prev_close") or price
        pct_chg = q.get("pct_chg")
        amt_yi = q.get("amount_yi", 0.0)
        total_turnover_yi += amt_yi

        flow_val: float | None = None
        record_date: str | None = None
        issue: str | None = None

        if _is_sh(sym):
            record_date = sse_curr_date
            if sse_curr_date and sse_prev_date and prev_close:
                s_curr = share_cache.get(sse_curr_date, {}).get(sym)
                s_prev = share_cache.get(sse_prev_date, {}).get(sym)
                if s_curr is not None and s_prev is not None:
                    flow_val = estimate_flow(s_curr, s_prev, prev_close, prev_close)
                    if flow_val is None:
                        issue = "折算熔断"
                else:
                    issue = "份额缺失"
            else:
                issue = "上交所份额待更新"
        else:
            record_date = sz_date
            if sz_date and sz_prev_date and prev_close:
                s_curr = share_cache.get(sz_date, {}).get(sym)
                s_prev = share_cache.get(sz_prev_date, {}).get(sym)
                if s_curr is not None and s_prev is not None:
                    flow_val = estimate_flow(s_curr, s_prev, prev_close, prev_close)
                    if flow_val is None:
                        issue = "折算熔断"
                else:
                    issue = "深市待次日基准"
            else:
                issue = "深市待积累基准(首日已缓存)"

        if flow_val is not None:
            flow_val = round(flow_val, 2)
            broad_cats[category] = round(broad_cats.get(category, 0.0) + flow_val, 2)
            total_confirmed_flow += flow_val
            confirmed_count += 1

        core_rows.append({
            "symbol": sym,
            "name": name,
            "category": category,
            "price": price,
            "pct_chg": pct_chg,
            "amount_yi": amt_yi,
            "flow": flow_val,
            "shares_record_date": record_date or "N/A",
            "issues": issue,
        })

    # 按当日成交额降序，便于优先展示最核心的托底宽基
    core_rows.sort(key=lambda x: -(x.get("amount_yi") or 0.0))

    return {
        "date": sse_curr_date or sz_date or datetime.now().strftime("%Y-%m-%d"),
        "sse_flow_date": sse_curr_date,
        "szse_flow_date": sz_date,
        "core_etf_flows": core_rows,
        "core_basket_20": core_rows,  # 兼容旧键名
        "broad_categories": broad_cats,
        "category_12": broad_cats,    # 兼容旧键名
        "total_turnover_yi": round(total_turnover_yi, 2),
        "total_flow": round(total_confirmed_flow, 2) if confirmed_count > 0 else None,
        "confirmed_flow_count": confirmed_count,
        "etf_count": len(core_rows),
        "source": "live_exchange_official",
    }
