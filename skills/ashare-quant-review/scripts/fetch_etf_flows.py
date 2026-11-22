# -*- coding: utf-8 -*-
"""看板 5 —— ETF 日度净申赎。

20 只核心宽基 ETF 与 12 类分类聚合净申赎金额计算。
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# 路径常量
# ---------------------------------------------------------------------------
_BASE_DIR = Path(__file__).resolve().parent.parent
_SEED_PATH = _BASE_DIR / "data" / "demo-seed.json"

# ---------------------------------------------------------------------------
# 20 只核心宽基 ETF（带市场后缀）
# ---------------------------------------------------------------------------
CORE_BASKET_20: list[str] = [
    "510300.SH", "510310.SH", "510500.SH", "510050.SH",
    "588000.SH", "588080.SH", "159915.SZ", "159919.SZ",
    "512100.SH", "159845.SZ", "563360.SH", "159352.SZ",
    "159338.SZ", "159949.SZ", "510210.SH", "159952.SZ",
    "159361.SZ", "512050.SH", "159633.SZ", "560010.SH",
]

# 沪市前缀判断
_SH_PREFIXES = ("51", "56", "58")

# 12 类分类标签
CATEGORY_12: list[str] = [
    "沪深300", "中证1000", "中证500", "科创50", "中证A500", "创业板指",
    "上证50", "其他宽基", "创业板50", "双创50", "中证2000", "国证2000",
]


def _is_sh(symbol: str) -> bool:
    """判断是否为沪市标的。"""
    return symbol.endswith(".SH")


# ---------------------------------------------------------------------------
# 核心公式
# ---------------------------------------------------------------------------

def estimate_flow(
    current_share: float,
    prev_share: float,
    nav: float,
    prev_nav: float,
    split_ratio: float = 1.0,
) -> float | None:
    """计算净申赎金额（亿元），含折算熔断保护。

    折算熔断条件：
        sr = current / (prev * ratio)
        nr = nav / (prev_nav / ratio)
        若 (sr > 1.5 或 sr < 0.67) 且 abs(sr * nr - 1.0) < 0.08 → 返回 None

    正常公式：
        (current_share - prev_share * split_ratio) * nav / 1e8（亿元）

    Parameters
    ----------
    current_share : float  当前份额（万份或亿份，需保持前后一致）
    prev_share    : float  前一日份额
    nav           : float  当日净值
    prev_nav      : float  前一日净值
    split_ratio   : float  拆合比例，默认 1.0

    Returns
    -------
    float | None
        净申赎金额（亿元），触发熔断时返回 None。
    """
    if prev_share == 0 or prev_nav == 0:
        return None

    sr = current_share / (prev_share * split_ratio)
    nr = nav / (prev_nav / split_ratio)

    # 折算熔断判定
    if (sr > 1.5 or sr < 0.67) and abs(sr * nr - 1.0) < 0.08:
        return None

    flow = (current_share - prev_share * split_ratio) * nav / 1e8
    return flow


def calculate_etf_daily_flow(
    symbol: str,
    target_date: str,
    shares_map: dict[str, dict[str, float]],
    navs_map: dict[str, dict[str, float]],
    calendar: list[str],
    split_ratio: float = 1.0,
) -> dict[str, Any]:
    """计算单只 ETF 在指定日期的日度净申赎。

    沪市：取 T 日晚间份额 - T-1 日晚间份额
    深市：取 T+1 日晨间份额 - T 日份额；若 T+1 未披露返回 None

    Parameters
    ----------
    symbol      : str              标的代码（带 .SH/.SZ）
    target_date : str              目标日期 YYYY-MM-DD
    shares_map  : dict             {date: {symbol: share}}
    navs_map    : dict             {date: {symbol: nav}}
    calendar    : list[str]        交易日历列表
    split_ratio : float            拆合比例

    Returns
    -------
    dict  含 flow, issue 等字段
    """
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
        if isinstance(val, dict):
            return val.get(sym)
        return val

    if _is_sh(symbol):
        # 沪市：T 日份额 - T-1 日份额
        if idx == 0:
            result["issue"] = "no_prev_day"
            return result
        prev_date = sorted_cal[idx - 1]
        current = _get(shares_map, target_date, symbol)
        prev = _get(shares_map, prev_date, symbol)
        nav = _get(navs_map, target_date, symbol)
        prev_nav = _get(navs_map, prev_date, symbol) or nav
    else:
        # 深市：T+1 日晨间份额 - T 日份额
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
# 看板级汇总
# ---------------------------------------------------------------------------

def _load_seed() -> dict:
    """加载 demo-seed.json。"""
    if _SEED_PATH.exists():
        with open(_SEED_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def _build_category_map(universe: list[dict]) -> dict[str, str]:
    """从 universe 构建 symbol -> bucket 映射。"""
    return {item["symbol"]: item.get("bucket", "其他宽基") for item in universe}


def fetch_etf_flows_dashboard(target_date: str | None = None) -> dict[str, Any]:
    """输出 20 核心篮子与 12 类流向看板。

    优先从 demo-seed.json 的 demo.fund_flows 读取历史数据，
    实际生产环境可替换为实时抓取逻辑。

    Parameters
    ----------
    target_date : str | None  指定日期，默认取种子最新日期

    Returns
    -------
    dict  看板字典
    """
    seed = _load_seed()
    demo = seed.get("demo", {})
    fund_flows = demo.get("fund_flows", {})
    universe = seed.get("universe", [])
    categories_list = seed.get("categories", CATEGORY_12)
    cat_map = _build_category_map(universe)

    # 确定目标日期
    if target_date is None:
        dates = sorted(fund_flows.keys())
        target_date = dates[-1] if dates else datetime.now().strftime("%Y-%m-%d")

    # 获取当日流向数据
    day_data = fund_flows.get(target_date, {})

    # 20 核心篮子
    basket_flows: list[dict] = []
    for sym in CORE_BASKET_20:
        flow = day_data.get(sym)
        basket_flows.append({
            "symbol": sym,
            "flow": flow,
            "bucket": cat_map.get(sym, "其他宽基"),
        })

    # 12 类分类聚合
    category_agg: dict[str, float] = {cat: 0.0 for cat in categories_list}
    for sym, flow_val in day_data.items():
        bucket = cat_map.get(sym, "其他宽基")
        if bucket in category_agg and flow_val is not None:
            category_agg[bucket] += flow_val

    return {
        "date": target_date,
        "core_basket_20": basket_flows,
        "category_12": category_agg,
        "total_flow": sum(v for v in day_data.values() if v is not None),
        "etf_count": len(day_data),
        "source": "demo-seed" if day_data else "empty",
    }
