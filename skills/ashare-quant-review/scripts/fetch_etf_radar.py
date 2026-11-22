# -*- coding: utf-8 -*-
"""看板 5 —— 同进度雷达。

1:1 纯 Python 移植 FtShare_fincase/src/assets/radar-math.js。
提供 evaluate_radar() 与 fetch_etf_radar_dashboard()。
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# 路径常量
# ---------------------------------------------------------------------------
_BASE_DIR = Path(__file__).resolve().parent.parent
_SEED_PATH = _BASE_DIR / "data" / "demo-seed.json"

# ---------------------------------------------------------------------------
# 默认参数
# ---------------------------------------------------------------------------
RADAR_DEFAULTS: dict[str, float] = {
    "cumulative": 1.5,
    "burst": 2.0,
    "minBurstAmount": 5.0,
    "fundFlow": 10.0,
}


# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------

def _valid(v: Any) -> bool:
    """判断值是否为有效有限数值。"""
    return isinstance(v, (int, float)) and math.isfinite(v)


def _sum(rows: list) -> float | None:
    """对列表求和，若有无效值返回 None。"""
    if all(_valid(v) for v in rows):
        return sum(rows)
    return None


def _mean(rows: list) -> float | None:
    """求均值。"""
    if not rows:
        return None
    return sum(rows) / len(rows)


def _window_range(slots: list[str], end: int) -> tuple[int, int] | None:
    """计算 5 分钟窗口范围 [start, end]。"""
    start = end - 4
    if start < 0 or end >= len(slots) or not slots[end]:
        return None

    def minute(s: str) -> int:
        return int(s[:2]) * 60 + int(s[3:])

    if minute(slots[end]) - minute(slots[start]) == 4:
        return (start, end)
    return None


def _covered(actual: list, coverage: list, start: int, stop: int) -> bool:
    """检查 [start, stop] 范围是否完整覆盖（coverage 全为 20）。"""
    if stop < start:
        return False
    seg_actual = actual[start:stop + 1]
    seg_cov = coverage[start:stop + 1]
    if len(seg_actual) != stop - start + 1 or len(seg_cov) != stop - start + 1:
        return False
    return all(n == 20 for n in seg_cov)


# ---------------------------------------------------------------------------
# 核心雷达函数
# ---------------------------------------------------------------------------

def evaluate_radar(
    seed: dict,
    live: dict | None = None,
    options: dict | None = None,
) -> dict[str, Any]:
    """评估同进度雷达状态。

    1:1 移植 radar-math.js evaluateRadar()。

    Parameters
    ----------
    seed    : dict  种子数据（含 minute_slots, minutes 等）
    live    : dict  实时数据（含 bars, coverage, date 等）
    options : dict  覆盖默认参数

    Returns
    -------
    dict  雷达看板字典，含 state, reason, recent, long 等
    """
    if options is None:
        options = {}
    if not isinstance(live, dict):
        # 非 dict 输入（如误传日期字符串）一律按无实时数据处理，
        # 走种子冷启动口径，绝不让单个看板的入参问题拖垮整套套件。
        live = {}

    rules = {**RADAR_DEFAULTS, **options}

    slots = seed.get("minute_slots", [])
    actual = live.get("bars", [])
    coverage = live.get("coverage", [])

    # 确定 last（最后一个有效且 coverage == 20 的索引）
    last = -1
    for i, v in enumerate(actual):
        if _valid(v) and i < len(coverage) and coverage[i] == 20:
            last = i

    # 确定 end
    if "at" in options and isinstance(options["at"], int):
        end = max(-1, min(last, options["at"]))
    else:
        end = last

    # 历史数据筛选：日期 < live.date，无 quality 标记，bars 长度 == slots 长度，所有 bar 有效
    live_date = live.get("date", "")
    minutes = seed.get("minutes", {})
    history: list[tuple[str, dict]] = []
    for date_str, record in minutes.items():
        if date_str >= live_date:
            continue
        if record.get("quality"):
            continue
        bars = record.get("bars", [])
        if len(bars) != len(slots):
            continue
        if not all(_valid(b) for b in bars):
            continue
        history.append((date_str, record))

    # 按日期降序排列，取最近 60 个
    history.sort(key=lambda x: x[0], reverse=True)
    history = history[:60]

    # 累计成交额
    amount: float | None = None
    if end >= 0 and _covered(actual, coverage, 0, end):
        amount = _sum(actual[:end + 1])

    # baseline 计算（20 日和 60 日窗口）
    def _baseline(window: int) -> dict[str, Any]:
        rows = history[:window]
        ready = len(rows) == window

        # 同进度参考值
        reference: float | None = None
        if ready and end >= 0:
            refs = [_sum(r["bars"][:end + 1]) for _, r in rows]
            valid_refs = [r for r in refs if r is not None]
            reference = _mean(valid_refs) if valid_refs else None

        # 成交倍数
        multiple: float | None = None
        if _valid(amount) and reference is not None and reference > 0:
            multiple = amount / reference

        # 脉冲检测
        def _burst_at(i: int) -> dict[str, Any]:
            rng = _window_range(slots, i)
            if rng is None or not ready or not _covered(actual, coverage, rng[0], rng[1]):
                return {"ratio": None, "amount": None, "reference": None, "range": rng}
            value = _sum(actual[rng[0]:rng[1] + 1])
            ref_vals = [_sum(r["bars"][rng[0]:rng[1] + 1]) for _, r in rows]
            valid_ref_vals = [r for r in ref_vals if r is not None]
            ref = _mean(valid_ref_vals) if valid_ref_vals else None
            ratio: float | None = None
            if ref is not None and ref > 0 and _valid(value):
                ratio = value / ref
            return {"ratio": ratio, "amount": value, "reference": ref, "range": rng}

        short = _burst_at(end)
        prior_short = _burst_at(end - 1)

        burst = (
            _valid(short["ratio"])
            and short["ratio"] >= rules["burst"]
            and short["amount"] is not None
            and short["amount"] >= rules["minBurstAmount"]
        )

        burst_confirmed = (
            burst
            and _valid(prior_short["ratio"])
            and prior_short["ratio"] >= rules["burst"]
            and prior_short["amount"] is not None
            and prior_short["amount"] >= rules["minBurstAmount"]
        )

        cumulative_alert = _valid(multiple) and multiple >= rules["cumulative"]

        return {
            "window": window,
            "ready": ready,
            "samples": len(rows),
            "sampleDates": [d for d, _ in rows],
            "reference": reference,
            "multiple": multiple,
            "short": short,
            "burst": burst,
            "burstConfirmed": burst_confirmed,
            "cumulativeAlert": cumulative_alert,
        }

    recent = _baseline(20)
    long = _baseline(60)

    # 累计信号
    if recent["cumulativeAlert"] and long["cumulativeAlert"]:
        cumulative_signal = "both"
    elif recent["cumulativeAlert"]:
        cumulative_signal = "recent"
    elif long["cumulativeAlert"]:
        cumulative_signal = "long"
    else:
        cumulative_signal = "none"

    # 双确认脉冲
    burst_dual_confirmed = recent["burstConfirmed"] and long["burstConfirmed"]

    # 状态判定
    state = "normal"
    reason = "none"

    if not _valid(amount):
        state = "incomplete"
    elif not recent["ready"] or not _valid(recent["multiple"]):
        state = "insufficient"
    elif end < 14:
        state = "warming"
    elif cumulative_signal == "both":
        state = "strong"
        reason = "dual_cumulative"
    elif burst_dual_confirmed:
        state = "strong"
        reason = "dual_burst"
    elif cumulative_signal == "recent":
        state = "watch"
        reason = "recent"
    elif cumulative_signal == "long":
        state = "watch"
        reason = "long"
    elif recent["burst"] or long["burst"]:
        state = "watch"
        reason = "burst"

    # 资金流向
    core = seed.get("core_fund_daily")
    flow_date = None
    if core and core.get("date") and core["date"] <= live.get("date", ""):
        flow_date = core["date"]

    flows_map: dict[str, dict] = {}
    if flow_date and "rows" in core:
        for row in core["rows"]:
            flows_map[row["symbol"]] = row

    # 合并表格
    table_raw = live.get("table", [])
    table: list[dict] = []
    for q in table_raw:
        sym = q.get("symbol", "")
        f = flows_map.get(sym, {})
        flow = f.get("flow") if _valid(f.get("flow")) else None
        flow_signal = None
        if flow is not None:
            if flow >= rules["fundFlow"]:
                flow_signal = "creation"
            elif flow <= -rules["fundFlow"]:
                flow_signal = "redemption"
        table.append({
            **q,
            "flow": flow,
            "flowDate": flow_date if flow is not None else None,
            "flowSignal": flow_signal,
        })
    table.sort(
        key=lambda a: (-int(bool(a.get("flowSignal"))), -(a.get("amount") or -1))
    )

    # 指数涨跌幅
    index_val = live.get("closes", [None] * (end + 1))[end] if end >= 0 and live.get("closes") and end < len(live.get("closes", [])) else None
    pre_close = live.get("pre_close", 0)
    index_pct: float | None = None
    if _valid(index_val) and pre_close and pre_close > 0:
        index_pct = (index_val / pre_close - 1) * 100

    return {
        "rules": rules,
        "state": state,
        "reason": reason,
        "date": live.get("date"),
        "end": end,
        "last": last,
        "time": slots[end] if 0 <= end < len(slots) else None,
        "amount": amount,
        "recent": recent,
        "long": long,
        "cumulativeSignal": cumulative_signal,
        "burstDualConfirmed": burst_dual_confirmed,
        # 兼容性别名（20 日基线）
        "reference": recent["reference"],
        "multiple": recent["multiple"],
        "short": recent["short"],
        "burst": recent["burst"],
        "burstConfirmed": recent["burstConfirmed"],
        "samples": recent["samples"],
        "sampleDates": recent["sampleDates"],
        "baseline": 20,
        "indexPct": index_pct,
        "table": table,
        "flowDate": flow_date,
        "creations": sum(1 for r in table if r.get("flowSignal") == "creation"),
        "redemptions": sum(1 for r in table if r.get("flowSignal") == "redemption"),
    }


# ---------------------------------------------------------------------------
# 看板级入口
# ---------------------------------------------------------------------------

def _load_seed() -> dict:
    """加载 demo-seed.json。"""
    if _SEED_PATH.exists():
        with open(_SEED_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def fetch_etf_radar_dashboard(live: dict | None = None) -> dict[str, Any]:
    """结合 demo-seed.json 冷启动种子输出雷达看板字典。

    Parameters
    ----------
    live : dict | None  实时数据，默认使用种子最后一日模拟

    Returns
    -------
    dict  雷达看板
    """
    seed = _load_seed()

    if live is None:
        # 冷启动：使用种子最后一日数据作为 live 模拟
        minutes = seed.get("minutes", {})
        dates = sorted(minutes.keys())
        if dates:
            last_date = dates[-1]
            last_record = minutes[last_date]
            live = {
                "date": last_date,
                "bars": last_record.get("bars", []),
                "coverage": [20] * len(last_record.get("bars", [])),
                "table": [],
            }
        else:
            live = {"date": "2026-01-01", "bars": [], "coverage": [], "table": []}

    return evaluate_radar(seed, live)
