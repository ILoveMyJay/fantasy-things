# -*- coding: utf-8 -*-
"""
交易日历守卫与盘中状态探测模块

功能：
  - 读取 references/trading_calendar_2026.json 获取交易日列表
  - 提供 is_trade_date(date_str) 判断某日期是否为交易日
  - 提供 is_trading_time(dt) 判断当前/指定时刻是否处于盘中交易时段
  - 非交易日强制返回 (False, 240, 'holiday_closed')

盘中交易时段定义：
  上午: 09:30 ~ 11:30
  下午: 13:00 ~ 15:00

设计规范：
  - 纯标准库，不引入 chinesecalendar 等第三方日历库
  - 使用 pathlib.Path 相对路径定位 JSON
"""

import json
from datetime import datetime, time
from pathlib import Path
from functools import lru_cache


# ---------------------------------------------------------------------------
# 日历数据加载（延迟加载 + 缓存）
# ---------------------------------------------------------------------------

# references 目录与本文件的相对位置:
# 本文件: scripts/utils/calendar_guard.py
# 日历:   references/trading_calendar_2026.json
_CALENDAR_PATH = (
    Path(__file__).resolve().parent.parent.parent
    / "references"
    / "trading_calendar_2026.json"
)


@lru_cache(maxsize=1)
def _load_calendar() -> dict:
    """加载并缓存交易日历 JSON，返回原始字典"""
    with open(_CALENDAR_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


@lru_cache(maxsize=1)
def _trading_days_set() -> frozenset:
    """返回交易日集合（frozenset 以便缓存）"""
    cal = _load_calendar()
    return frozenset(cal.get("trading_days", []))


# ---------------------------------------------------------------------------
# 公开接口
# ---------------------------------------------------------------------------

def is_trade_date(date_str: str) -> bool:
    """
    判断给定日期字符串是否为交易日

    参数:
        date_str: 日期字符串，格式 'YYYY-MM-DD'

    返回:
        bool: True 表示是交易日，False 表示非交易日（周末或法定节假日）
    """
    return date_str in _trading_days_set()


def get_recent_trade_dates(count: int = 10, up_to: str = None) -> list:
    """
    返回截至 up_to（含）最近的 count 个交易日列表（按日期升序，格式 'YYYY-MM-DD'）
    """
    if up_to is None:
        up_to = datetime.now().strftime("%Y-%m-%d")
    days = sorted(d for d in _trading_days_set() if d <= up_to)
    return days[-count:] if count > 0 else days


def is_trading_time(dt: datetime = None) -> tuple:
    """
    判断当前或指定时刻是否处于盘中交易时段

    参数:
        dt: 可选的 datetime 对象，默认使用当前本地时间

    返回:
        tuple(bool, int, str):
          - is_trading: 是否处于盘中交易时段
          - elapsed_minutes: 当日已开盘交易分钟数（盘前 0，上午 1~120，午休 120，下午 121~240，盘后/休市 240）
          - status: 状态描述字符串
            'holiday_closed'    - 非交易日休市
            'pre_market'        - 交易日盘前（09:30 之前）
            'morning_session'   - 上午盘中（09:30 ~ 11:30）
            'lunch_break'       - 午间休市（11:30 ~ 13:00）
            'afternoon_session' - 下午盘中（13:00 ~ 15:00）
            'post_market'       - 交易日盘后（15:00 之后）
    """
    if dt is None:
        dt = datetime.now()

    date_str = dt.strftime("%Y-%m-%d")

    # 非交易日强制返回
    if not is_trade_date(date_str):
        return (False, 240, "holiday_closed")

    current_time = dt.time()

    # 盘中时段边界定义
    morning_open = time(9, 30)
    morning_close = time(11, 30)
    afternoon_open = time(13, 0)
    afternoon_close = time(15, 0)

    # 盘前
    if current_time < morning_open:
        return (False, 0, "pre_market")

    # 上午盘中: 09:30 ~ 11:30
    if morning_open <= current_time < morning_close:
        morning_elapsed = max(1, (dt.hour - 9) * 60 + dt.minute - 30)
        return (True, morning_elapsed, "morning_session")

    # 午间休市: 11:30 ~ 13:00
    if morning_close <= current_time < afternoon_open:
        return (False, 120, "lunch_break")

    # 下午盘中: 13:00 ~ 15:00
    if afternoon_open <= current_time < afternoon_close:
        afternoon_elapsed = (dt.hour - 13) * 60 + dt.minute
        elapsed = min(240, 120 + max(1, afternoon_elapsed))
        return (True, elapsed, "afternoon_session")

    # 盘后: 15:00 之后
    return (False, 240, "post_market")
