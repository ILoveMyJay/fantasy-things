# -*- coding: utf-8 -*-
"""DDX 防火墙 —— 禁止对 ETF 标的使用大单净量指标。

做市商双边报价与套利对冲导致 DDX 指标在 ETF 上严重失真，
本模块维护核心宽基 ETF 黑名单并在计算前强制拦截。
"""

from __future__ import annotations


class DDXFirewallViolationError(Exception):
    """尝试对 ETF 标的计算 DDX 时抛出。"""
    pass


# 核心篮子 20 只 ETF（CORE_BASKET_20），代码不含市场后缀
CORE_BASKET_20: set[str] = {
    "510300",  # 300ETF
    "510310",  # HS300ETF
    "510500",  # 500ETF
    "510050",  # 50ETF
    "588000",  # 科创50
    "588080",  # 科创板50ETF
    "159915",  # 创业板ETF易方达
    "159919",  # 嘉实300
    "512100",  # 1000ETF
    "159845",  # 中证2000ETF
    "563360",  # A500基金
    "159352",  # A500ETF
    "159338",  # 创50ETF
    "159949",  # 创业板50ETF
    "510210",  # 综指ETF
    "159952",  # 创业板ETF
    "159361",  # A500指数
    "512050",  # 上证50ETF
    "159633",  # 国证2000ETF
    "560010",  # 中证1000ETF
}


def _normalize_symbol(symbol: str) -> str:
    """去除常见的市场后缀，只保留纯数字代码。"""
    if "." in symbol:
        return symbol.split(".")[0]
    return symbol


def check_ddx_allowed(symbol: str) -> bool:
    """检查标的是否允许计算 DDX。

    Parameters
    ----------
    symbol : str
        标的代码，支持带市场后缀（如 510300.SH）或纯数字。

    Returns
    -------
    bool
        个股返回 True。

    Raises
    ------
    DDXFirewallViolationError
        若标的属于 ETF 黑名单，立即抛出异常。
    """
    code = _normalize_symbol(symbol)
    if code in CORE_BASKET_20:
        raise DDXFirewallViolationError(
            "大单净量 DDX 严禁用于 ETF，做市商双边报价与套利对冲导致指标失真"
        )
    return True
