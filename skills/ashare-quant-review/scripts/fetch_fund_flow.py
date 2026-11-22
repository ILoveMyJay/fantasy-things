# -*- coding: utf-8 -*-
"""看板 7 —— DDX 大单净量与资金流向。

自选股主力净流入、DDX、5 大背离标签与近 3/5 日沉淀。
在计算前调用 ddx_firewall 检查标的合法性。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from utils.ddx_firewall import DDXFirewallViolationError, check_ddx_allowed

# ---------------------------------------------------------------------------
# 路径常量
# ---------------------------------------------------------------------------
_BASE_DIR = Path(__file__).resolve().parent.parent
_WATCHLIST_PATH = _BASE_DIR / "data" / "default_watchlist.json"
_CUSTOM_PATH = _BASE_DIR / "references" / "custom_stocks.json"


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
# DDX 计算
# ---------------------------------------------------------------------------

def calculate_ddx(
    big_buy: float,
    big_sell: float,
    circulating_shares: float,
) -> float | None:
    """计算 DDX 大单净量指标。

    DDX = (大单买入量 - 大单卖出量) / 流通股本

    Parameters
    ----------
    big_buy           : float  大单买入量（手）
    big_sell          : float  大单卖出量（手）
    circulating_shares: float  流通股本（手）

    Returns
    -------
    float | None  DDX 值
    """
    if circulating_shares <= 0:
        return None
    return (big_buy - big_sell) / circulating_shares


# ---------------------------------------------------------------------------
# 5 大背离标签
# ---------------------------------------------------------------------------

_DIVERGENCE_LABELS: dict[str, str] = {
    "price_up_ddx_down": "价涨量缩背离",       # 价格上涨但 DDX 下降
    "price_down_ddx_up": "价跌量增背离",       # 价格下跌但 DDX 上升
    "volume_price_diverge": "量价背离",         # 成交量与价格走向不一致
    "main_retail_diverge": "主力散户背离",      # 主力净流入而散户净流出（或反向）
    "consecutive_diverge": "连续背离",          # 连续多日出现背离信号
}


def detect_divergence(
    price_chg_pct: float,
    ddx_today: float,
    ddx_prev: float,
    volume_chg_pct: float,
    main_net_flow: float,
    retail_net_flow: float,
    divergence_days: int = 0,
) -> list[str]:
    """检测 5 大背离标签。

    Parameters
    ----------
    price_chg_pct   : float  当日涨跌幅（%）
    ddx_today       : float  当日 DDX
    ddx_prev        : float  前一日 DDX
    volume_chg_pct  : float  成交量变动（%）
    main_net_flow   : float  主力净流入（万元）
    retail_net_flow : float  散户净流入（万元）
    divergence_days : int    此前连续背离天数

    Returns
    -------
    list[str]  触发的背离标签列表
    """
    tags: list[str] = []

    # 价涨量缩背离
    if price_chg_pct > 0 and ddx_today < ddx_prev:
        tags.append("price_up_ddx_down")

    # 价跌量增背离
    if price_chg_pct < 0 and ddx_today > ddx_prev:
        tags.append("price_down_ddx_up")

    # 量价背离
    if (price_chg_pct > 0 and volume_chg_pct < -10) or (
        price_chg_pct < 0 and volume_chg_pct > 10
    ):
        tags.append("volume_price_diverge")

    # 主力散户背离
    if (main_net_flow > 0 and retail_net_flow < 0) or (
        main_net_flow < 0 and retail_net_flow > 0
    ):
        tags.append("main_retail_diverge")

    # 连续背离
    if divergence_days >= 2:
        tags.append("consecutive_diverge")

    return tags


# ---------------------------------------------------------------------------
# 近 3/5 日沉淀
# ---------------------------------------------------------------------------

def calculate_sedimentation(
    ddx_history: list[float],
) -> dict[str, float | None]:
    """计算近 3/5 日 DDX 沉淀。

    Parameters
    ----------
    ddx_history : list[float]  最近的 DDX 序列（从新到旧）

    Returns
    -------
    dict  含 ddx_3d, ddx_5d
    """
    ddx_3d = sum(ddx_history[:3]) if len(ddx_history) >= 3 else None
    ddx_5d = sum(ddx_history[:5]) if len(ddx_history) >= 5 else None
    return {"ddx_3d": ddx_3d, "ddx_5d": ddx_5d}


# ---------------------------------------------------------------------------
# 看板级入口
# ---------------------------------------------------------------------------

def fetch_fund_flow_dashboard(
    flow_data: dict | None = None,
    include_multiday: bool = True,
) -> dict[str, Any]:
    """DDX 资金流向看板。

    自选股池读取 default_watchlist.json（custom_stocks.json 优先覆盖），
    在计算前调用 check_ddx_allowed() 验证标的。

    Parameters
    ----------
    flow_data : dict  外部传入的资金流向原始数据

    Returns
    -------
    dict  看板字典
    """
    if flow_data is None:
        flow_data = {}

    watchlist = _load_watchlist()
    results: list[dict] = []
    blocked: list[dict] = []

    for stock in watchlist:
        code = stock.get("code", "")
        name = stock.get("name", "")

        # DDX 防火墙检查
        try:
            check_ddx_allowed(code)
        except DDXFirewallViolationError as e:
            blocked.append({"code": code, "name": name, "reason": str(e)})
            continue

        # 获取个股数据
        stock_flow = flow_data.get(code, {})
        results.append({
            "code": code,
            "name": name,
            "main_net_inflow": stock_flow.get("main_net_inflow", 0.0),
            "ddx": stock_flow.get("ddx", 0.0),
            "divergence_tags": stock_flow.get("divergence_tags", []),
            "ddx_3d": stock_flow.get("ddx_3d"),
            "ddx_5d": stock_flow.get("ddx_5d"),
        })

    return {
        "stocks": results,
        "results": results,
        "blocked_etf": blocked,
        "watchlist_count": len(watchlist),
        "source": "api" if flow_data else "empty",
    }


def generate_fund_flow_markdown(flow_data: dict | None) -> str:
    """格式化输出自选股核心标的主力大单 DDX 与背离定性表格"""
    if not flow_data:
        return "> ⚠️ 主力资金流向数据暂时未拉取。\n"

    stocks = flow_data.get("stocks", flow_data.get("results", []))
    if not stocks:
        return "> ℹ️ 当前自选股监控列表为空。\n"

    lines = []
    lines.append("| 代码 | 标的名称 | 主力净流入 (亿元) | 大单净量 DDX (%) | 量价背离诊断标签 | 近 3 日沉淀 |")
    lines.append("| :---: | :--- | :---: | :---: | :--- | :---: |")

    for s in stocks:
        code = s.get("code", "")
        name = s.get("name", "")
        inflow = s.get("main_net_inflow", 0.0)
        ddx = s.get("ddx", 0.0)
        tags = s.get("divergence_tags", [])
        tag_str = "、".join(tags) if tags else "常态换手"
        ddx_3d = s.get("ddx_3d")
        ddx_3d_str = f"`{ddx_3d:+.2f} 亿`" if ddx_3d is not None else "-"

        lines.append(
            f"| `{code}` | {name} | `{inflow:+.2f}` | **`{ddx:+.3f}%`** | {tag_str} | {ddx_3d_str} |"
        )

    blocked = flow_data.get("blocked_etf", [])
    if blocked:
        lines.append("\n> 🛡️ **DDX 防火墙拦截记录**：")
        for b in blocked:
            lines.append(f"> - 标的 `{b.get('code')}` ({b.get('name')}) 已被防火墙拦截，理由：{b.get('reason')}")

    return "\n".join(lines)
