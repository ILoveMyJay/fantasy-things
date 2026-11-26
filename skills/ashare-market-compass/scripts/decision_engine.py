#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
decision_engine.py - 四层信号汇总与「四态决策表」仲裁引擎
核心铁律（出自布鲁斯 2026-11-07《一张表格提高胜率》与全套 31 篇文稿）：
  1. 资金面定大势方向（多 / 空 / 中性），技术面定入场时机（多 / 空 / 中性）
  2. 资金面 == 技术面 → 执行「多」或「空」
  3. 资金面 != 技术面 → 强制输出「准备多」或「准备空」（零仓位等待大小周期共振）
  4. 缺失指标必须显式登记在 missing_items 中，绝不静默伪造
"""

import datetime
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from db_store import get_conn, upsert_decision_ledger

SCORE_MAP = {
    "BULL": 1.0,
    "BULL_MILD": 0.5,
    "NEUTRAL": 0.0,
    "BEAR_MILD": -0.5,
    "BEAR": -1.0,
    "BEAR_DIVERGENCE": -1.0,
}


def arbitrate_four_state(fund_signal: str, tech_signal: str) -> Tuple[str, str]:
    """
    纯函数：资金面(大势) × 技术面(小势) → 四态结论
    """
    tech_norm = "多" if tech_signal.startswith("多") else ("空" if tech_signal.startswith("空") else "中性")

    if fund_signal == "空":
        if tech_norm == "空":
            return "空", "大势资金面与技术面共振向下（顺大势防守/空仓，衍生品仅顺势偏空）"
        return "准备空", "资金面偏空但技术面仍偏多/反弹：严禁追多，零仓位等待技术面转空共振"

    if fund_signal == "多":
        if tech_norm == "多":
            return "多", "大势资金面与技术面共振向上（多头高确定性窗口，可分批顺势布局）"
        return "准备多", "资金面已偏多/进入价值区但技术面尚未转强：零仓位/极轻仓等待右侧共振"

    return "观望(中性)", "中期资金面无明确单边大势（震荡/过渡市），以控制仓位、轻仓观望为主"


def evaluate_decision(
    breadth: Dict[str, Any],
    midterm: Dict[str, Any],
    derivatives: Dict[str, Any],
    tech: Dict[str, Any],
    save_ledger: bool = True,
    db_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """综合四层指标计算资金面得分、技术面状态、四态结论并落盘"""
    missing: List[str] = []
    votes: List[Tuple[str, float, float, str]] = []  # (name, weight, raw_score, note)

    def _add_vote(name: str, weight: float, block: Optional[Dict[str, Any]]) -> None:
        if not block or block.get("status") != "OK":
            missing.append(name)
            return
        sig = block.get("signal", "NEUTRAL")
        votes.append((name, weight, SCORE_MAP.get(sig, 0.0), block.get("note", "")))

    # 第一层（中期资金面与估值，总权重偏重，代表“洋流方向”）
    erp = midterm.get("erp")
    pe = midterm.get("equal_weight_pe")
    etf19 = midterm.get("etf_19_accumulation")
    insider = midterm.get("insider_trading")
    hk = (midterm.get("macro_and_hk") or {}).get("hk_leading")

    _add_vote("股债息差(ERP)", 1.5, erp)
    _add_vote("全A等权PE", 1.0, pe)
    if etf19 and etf19.get("status") == "OK" and etf19.get("index_value") is not None:
        _add_vote("19只宽基ETF加权加仓指数", 1.5, etf19)
    else:
        missing.append("19只宽基ETF加权加仓指数")
    _add_vote("高管股东增减持", 1.0, insider)
    if hk:
        votes.append(("恒生国企先行速率", 1.0, SCORE_MAP.get(hk.get("signal", "NEUTRAL"), 0.0), hk.get("note", "")))
    else:
        missing.append("恒生国企先行速率")

    # 第二层（衍生品聪明钱：期指升贴水 + 50/300期权PCR）
    cffex = derivatives.get("cffex_basis")
    pcr = derivatives.get("option_pcr")
    _add_vote("四大期指升贴水(IF/IH)", 1.5, cffex)
    _add_vote("全市场期权PCR(50/300共振)", 1.5, pcr)

    # 第三层（短线拆量宽度：辅助修正，不覆盖中期大势）
    if breadth.get("status") == "OK":
        code = breadth.get("scenario_code")
        b_score = {
            "TOP_DIVERGENCE": -1.0,
            "FAKE_REBOUND_SHORT_COVER": -0.5,
            "WEIGHT_PROPPING": -0.5,
            "BROAD_SELLOFF": -0.5,
            "HEALTHY_BULL_ATTACK": 1.0,
            "ICE_POINT_CANDIDATE": 0.5,
            "EXTREME_WEIGHT_OR_ICE": 0.0,
            "NEUTRAL_DIVERGENCE": 0.0,
        }.get(code, 0.0)
        votes.append(("短线拆量宽广度(TRIN_额)", 1.0, b_score, breadth.get("scenario_tag", "")))
    else:
        missing.append("全A微观拆量与TRIN")

    # 计算加权资金面得分 (-100 ~ +100)
    total_w = sum(v[1] for v in votes)
    weighted_score = round(sum(v[1] * v[2] for v in votes) / total_w * 100.0, 1) if total_w > 0 else 0.0

    if weighted_score >= 20.0:
        fund_signal = "多"
    elif weighted_score <= -20.0:
        fund_signal = "空"
    else:
        fund_signal = "中性"

    if tech.get("status") != "OK":
        missing.append("周K/日K技术面(一目均衡表+VW-MACD)")
        tech_signal = "中性"
    else:
        tech_signal = tech.get("tech_signal", "中性")

    final_state, action_guidance = arbitrate_four_state(fund_signal, tech_signal)

    # 额外纪律提醒：若短线处于高位背离/抱团护盘，叠加风险注记
    extra_notes = []
    if breadth.get("scenario_code") in ("TOP_DIVERGENCE", "FAKE_REBOUND_SHORT_COVER", "WEIGHT_PROPPING"):
        extra_notes.append(breadth.get("scenario_tag", ""))
    if pcr and pcr.get("signal") == "BEAR_DIVERGENCE":
        extra_notes.append("50/300 PCR 分歧警示(防假底)")
    if etf19 and etf19.get("index_value") is not None and etf19["index_value"] >= 60:
        extra_notes.append(f"宽基加权加仓指数={etf19['index_value']}(逼近/突破70轨，接近底部区但须共振)")

    trade_date = (
        breadth.get("trade_date")
        or (cffex or {}).get("trade_date")
        or datetime.date.today().strftime("%Y-%m-%d")
    )

    decision = {
        "trade_date": trade_date,
        "created_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "fund_signal": fund_signal,
        "fund_score": weighted_score,
        "tech_signal": tech_signal,
        "tech_weekly": tech.get("weekly_signal", "未知"),
        "tech_daily": tech.get("daily_signal", "未知"),
        "final_state": final_state,
        "action_guidance": action_guidance,
        "votes": [
            {"indicator": v[0], "weight": v[1], "score": v[2], "note": v[3]} for v in votes
        ],
        "missing_items": missing,
        "notes": " | ".join(extra_notes) if extra_notes else action_guidance,
    }

    if save_ledger:
        if_ann = ((cffex or {}).get("basis_table") or {}).get("IF", {}).get("annualized_discount_pct")
        ledger_entry = {
            "trade_date": trade_date,
            "created_at": decision["created_at"],
            "fund_signal": fund_signal,
            "fund_score": weighted_score,
            "tech_signal": tech_signal,
            "tech_weekly": decision["tech_weekly"],
            "tech_daily": decision["tech_daily"],
            "final_state": final_state,
            "breadth_tag": breadth.get("scenario_code"),
            "trin_amount": breadth.get("trin_amount"),
            "adv_ratio": breadth.get("adv_ratio"),
            "etf_acc_index": (etf19 or {}).get("index_value"),
            "erp_zscore": (erp or {}).get("zscore"),
            "if_ann_basis": if_ann,
            "pcr_50": (pcr or {}).get("pcr_50_ema5"),
            "pcr_300": (pcr or {}).get("pcr_300_ema5"),
            "missing_items": missing,
            "notes": decision["notes"],
            "raw_json": {
                "decision": decision,
                "breadth": breadth,
            },
        }
        conn = get_conn(db_path)
        try:
            upsert_decision_ledger(conn, ledger_entry, export_csv=True)
        finally:
            conn.close()

    return decision
