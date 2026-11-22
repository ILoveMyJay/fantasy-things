# -*- coding: utf-8 -*-
"""看板 6 —— 两融与出清弹性。

全市场融资融券余额、单日变动与 Em 出清弹性系数。
彻底剔除 3 只静态 ETF 与重复广度。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# 路径常量
# ---------------------------------------------------------------------------
_BASE_DIR = Path(__file__).resolve().parent.parent
_WATCHLIST_PATH = _BASE_DIR / "data" / "default_watchlist.json"
_CUSTOM_PATH = _BASE_DIR / "references" / "custom_stocks.json"

# ---------------------------------------------------------------------------
# 静态 ETF 黑名单 —— 两融统计中需剔除
# ---------------------------------------------------------------------------
_STATIC_ETF_EXCLUSION: set[str] = {
    "510300",  # 300ETF
    "510500",  # 500ETF
    "510050",  # 50ETF
}


# ---------------------------------------------------------------------------
# 自选股加载
# ---------------------------------------------------------------------------

def _load_watchlist() -> list[dict]:
    """读取自选股列表。若有 references/custom_stocks.json 优先覆盖。"""
    if _CUSTOM_PATH.exists():
        with open(_CUSTOM_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("stocks", data) if isinstance(data, dict) else data

    if _WATCHLIST_PATH.exists():
        with open(_WATCHLIST_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("stocks", [])

    return []


# ---------------------------------------------------------------------------
# Em 出清弹性系数
# ---------------------------------------------------------------------------

def calculate_em_elasticity(
    margin_pct_5d: float,
    index_pct_5d: float,
) -> dict[str, Any]:
    """计算出清弹性系数 Em。

    公式: Em = ΔMargin%_5d / ΔIndex%_5d

    标注规则：
    - 现货下跌时 (index_pct_5d < 0):
        - Em > 1.2: 出清充分
        - Em < 0.5: 出清不足
    - 现货上涨时：只报数值不贴标签

    Parameters
    ----------
    margin_pct_5d : float  5 日融资余额变动百分比
    index_pct_5d  : float  5 日指数涨跌幅百分比

    Returns
    -------
    dict  含 em, label
    """
    if index_pct_5d == 0:
        return {"em": None, "label": "指数无变动", "margin_pct_5d": margin_pct_5d, "index_pct_5d": index_pct_5d}

    em = margin_pct_5d / index_pct_5d
    label: str | None = None

    if index_pct_5d < 0:
        if em > 1.2:
            label = "出清充分"
        elif em < 0.5:
            label = "出清不足"
        else:
            label = "出清一般"
    # 现货上涨时不贴标签

    return {
        "em": round(em, 4),
        "label": label,
        "verdict": label,
        "margin_pct_5d": margin_pct_5d,
        "index_pct_5d": index_pct_5d,
    }


calculate_em = calculate_em_elasticity


# ---------------------------------------------------------------------------
# 两融余额
# ---------------------------------------------------------------------------

def _filter_etf(symbol: str) -> bool:
    """检查标的是否应排除（3 只静态 ETF）。"""
    code = symbol.split(".")[0] if "." in symbol else symbol
    return code not in _STATIC_ETF_EXCLUSION


def fetch_leverage_margin_dashboard(
    margin_data: dict | None = None,
    index_data: dict | None = None,
) -> dict[str, Any]:
    """两融与出清弹性看板。

    Parameters
    ----------
    margin_data : dict  融资融券原始数据
    index_data  : dict  指数数据

    Returns
    -------
    dict  看板字典
    """
    if not isinstance(margin_data, dict):
        # 非 dict 输入（如误传日期字符串）一律按无注入数据处理，输出空看板。
        margin_data = {}
    if not isinstance(index_data, dict):
        index_data = {}

    # 全市场融资融券余额
    total_margin_balance = margin_data.get("total_margin_balance", 0.0)
    daily_change = margin_data.get("daily_change", 0.0)
    margin_pct_5d = margin_data.get("margin_pct_5d", 0.0)
    index_pct_5d = index_data.get("index_pct_5d", 0.0)

    # 出清弹性系数
    em_result = calculate_em_elasticity(margin_pct_5d, index_pct_5d)

    # 自选股融资
    watchlist = _load_watchlist()
    watchlist_margin: list[dict] = []
    stock_margins = margin_data.get("stock_margins", {})
    for stock in watchlist:
        code = stock.get("code", "")
        if _filter_etf(code):
            margin_info = stock_margins.get(code, {})
            watchlist_margin.append({
                "code": code,
                "name": stock.get("name", ""),
                "margin_balance": margin_info.get("margin_balance", 0.0),
                "daily_change": margin_info.get("daily_change", 0.0),
            })

    return {
        "total_margin_balance": total_margin_balance,
        "daily_change": daily_change,
        "em_elasticity": em_result,
        "watchlist_margin": watchlist_margin,
        "etf_excluded": list(_STATIC_ETF_EXCLUSION),
        "source": "api" if margin_data.get("total_margin_balance") else "empty",
    }
