#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
decision_engine.py - Compass v2 趋势锚定 × 去偏确认分 四态仲裁引擎
经近 2 年（2024-11-27 ~ 2026-11-26）严格零未来数据 IS/OOS 盲测升级：
  1. 彻底移除已证伪/共线失效因子：高管增减持、全A等权PE、恒生国企(HSCEI)先行速率。
  2. 主趋势轴：周K技术面（上证 + 沪深300 一目均衡表 + VW-MACD）；时机阀：日K技术面。
  3. 去偏确认分（confirm_score, -100 ~ +100）由 4 路正交因子构成：
     - 股债息差 ERP 非对称估值（权重 1.5：低估强确认 +1.0/+0.5，高估仅温和警示 -0.5）
     - 官方 50/300 期权 PCR 共振（权重 1.5：60日滚动分位，保留50领先300防假底铁律）
     - 纯净 IF 滚仓年化基差 120日分位（权重 1.0：交割前<=5天提前滚仓，消除常态贴水偏置）
     - 19只宽基 ETF 底部条件加分（权重 1.0：仅当 >=70轨 且 日K转多 时激活 +1.0，绝不在牛市赎回时做空头惩罚）
  4. 微观拆量层（TRIN_额 / 额价差 / MCL）：作为短线战术警示与熊市假反弹拆穿层，不盲目覆盖牛市主趋势。
  5. 缺失指标必须显式登记在 missing_items 中，绝不静默伪造。
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


def arbitrate_v2(
    tech_weekly: str,
    tech_daily: str,
    confirm_score: float,
) -> Tuple[str, str]:
    """
    Compass v2 纯函数：周K主趋势轴 × 日K时机阀 × 去偏确认分 → 四态对称决策
    """
    w = tech_weekly if tech_weekly in ("多", "空", "中性") else "中性"
    d = tech_daily if tech_daily in ("多", "空", "中性") else "中性"

    if w == "多":
        if confirm_score <= -35.0 and d == "空":
            return "空", "周K虽在多头区但日K已转空且去偏确认分严重恶化(≤-35)：疑似头部破位，转为防守/空仓"
        if confirm_score <= -25.0 or d == "空":
            return "准备空", "周K多头趋势中出现日K转空或确认分偏空预警(≤-25)：暂停追高，减仓/观望等待日K重回共振"
        return "多", "周K主趋势向上且日K/确认分无破位警示：多头高确定性窗口，顺势持有/逢回踩分批布局"

    if w == "空":
        if confirm_score >= 30.0 and d == "多":
            return "多", "周K虽在空头区但去偏确认分强力转多(≥+30)且日K已率先翻多：底部反转共振信号，可右侧试仓"
        if confirm_score >= 15.0 or d == "多":
            return "准备多", "周K仍偏空但底部确认分转暖(≥+15)或日K出现反弹：左侧观察区，严控仓位等待周/日共振"
        return "空", "周K与日K共振向下且无底部确认支撑：顺大势严格防守/空仓，警惕死猫跳假反弹"

    # 周K中性（震荡/变盘过渡期）
    if d == "多" and confirm_score >= 0.0:
        return "多", "周K中性过渡期，日K转多且去偏确认分非负：可轻中仓顺势跟随短中期波段"
    if d == "空" and confirm_score <= 0.0:
        return "空", "周K中性过渡期，日K转空且去偏确认分偏弱：保持防守/空仓规避下行"
    if confirm_score >= 25.0:
        return "准备多", "周K中性且去偏确认分明显偏多(≥+25)：等待日K放量翻多后入场"
    if confirm_score <= -25.0:
        return "准备空", "周K中性且去偏确认分明显偏空(≤-25)：谨防向下变盘，严禁重仓博弈"
    return "观望(中性)", "周K、日K与去偏确认分均无明确单边共振（纯震荡市）：轻仓观望为主"


def arbitrate_four_state(fund_signal: str, tech_signal: str) -> Tuple[str, str]:
    """保留兼容接口：传统资金面 × 技术面四态映射"""
    tech_norm = "多" if tech_signal.startswith("多") else ("空" if tech_signal.startswith("空") else "中性")
    if fund_signal == "空":
        if tech_norm == "空":
            return "空", "大势资金面与技术面共振向下（顺大势防守/空仓）"
        return "准备空", "资金面偏空但技术面仍偏多/反弹：严禁追多，等待共振"
    if fund_signal == "多":
        if tech_norm == "多":
            return "多", "大势资金面与技术面共振向上（多头高确定性窗口）"
        return "准备多", "资金面已偏多但技术面尚未转强：等待右侧共振"
    return "观望(中性)", "中期无明确单边大势，轻仓观望为主"


def evaluate_decision(
    breadth: Dict[str, Any],
    midterm: Dict[str, Any],
    derivatives: Dict[str, Any],
    tech: Dict[str, Any],
    save_ledger: bool = True,
    db_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """综合 Compass v2 核心指标计算去偏确认分、主趋势状态、四态结论并落盘"""
    missing: List[str] = []
    votes: List[Tuple[str, float, float, str]] = []  # (name, weight, raw_score, note)

    if tech.get("status") != "OK":
        missing.append("周K/日K技术面(一目均衡表+VW-MACD)")
        tech_signal = "中性"
        tech_weekly = "未知"
        tech_daily = "未知"
    else:
        tech_signal = tech.get("tech_signal", "中性")
        tech_weekly = tech.get("weekly_signal", "中性")
        tech_daily = tech.get("daily_signal", "中性")

    # 1. 股债息差 ERP（非对称估值，权重 1.5）
    erp = midterm.get("erp")
    if erp and erp.get("status") == "OK":
        ez = erp.get("zscore")
        if ez is not None:
            erp_score = 1.0 if ez >= 1.5 else (0.5 if ez >= 0.8 else (-0.5 if ez <= -1.2 else 0.0))
        else:
            erp_score = SCORE_MAP.get(erp.get("signal", "NEUTRAL"), 0.0)
        votes.append(("股债息差(ERP非对称估值)", 1.5, erp_score, erp.get("note", "")))
    else:
        missing.append("股债息差(ERP)")

    # 2. 官方 50/300 期权 PCR 共振（60日滚动分位，权重 1.5）
    pcr = derivatives.get("option_pcr")
    if pcr and pcr.get("status") == "OK":
        pcr_score = SCORE_MAP.get(pcr.get("signal", "NEUTRAL"), 0.0)
        votes.append(("全市场期权PCR(50/300共振)", 1.5, pcr_score, pcr.get("note", "")))
    else:
        missing.append("全市场期权PCR(50/300共振)")

    # 3. 纯净期指基差（IF 滚仓年化基差 120日分位，权重 1.0）
    cffex = derivatives.get("cffex_basis")
    if cffex and cffex.get("status") == "OK":
        cf_score = SCORE_MAP.get(cffex.get("signal", "NEUTRAL"), 0.0)
        votes.append(("纯净期指基差(IF 120日分位)", 1.0, cf_score, cffex.get("note", "")))
    else:
        missing.append("四大期指升贴水(IF/IH)")

    # 4. 19只宽基 ETF 底部条件加分器（权重 1.0：仅当 >=70轨 且 日K转多 时触发 +1.0，否则 0.0）
    etf19 = midterm.get("etf_19_accumulation")
    if etf19 and etf19.get("status") == "OK" and etf19.get("index_value") is not None:
        etf_val = float(etf19["index_value"])
        if etf_val >= 70.0 and tech_daily == "多":
            etf_score = 1.0
            etf_note = f"宽基份额指数 {etf_val} ≥70轨 且 日K已翻多：触发底部右侧共振加分 (+1.0)"
        elif etf_val >= 70.0:
            etf_score = 0.0
            etf_note = f"宽基份额指数 {etf_val} ≥70轨（左侧大资金扫货中），日K尚未翻多暂不加分"
        else:
            etf_score = 0.0
            etf_note = f"宽基份额指数 {etf_val}（v2条件模式：非底部极值不作空头惩罚）"
        votes.append(("19只宽基ETF底部共振加分", 1.0, etf_score, etf_note))
    else:
        missing.append("19只宽基ETF加权加仓指数")

    # 微观拆量与宽广度（检查缺失，但不直接灌入永熊负分；用于短线战术警示）
    if breadth.get("status") != "OK":
        missing.append("全A微观拆量与TRIN")

    # 计算去偏确认分 (-100 ~ +100)
    total_w = sum(v[1] for v in votes)
    confirm_score = round(sum(v[1] * v[2] for v in votes) / total_w * 100.0, 1) if total_w > 0 else 0.0

    if confirm_score >= 20.0:
        confirm_signal = "多"
    elif confirm_score <= -20.0:
        confirm_signal = "空"
    else:
        confirm_signal = "中性"

    final_state, action_guidance = arbitrate_v2(tech_weekly, tech_daily, confirm_score)

    # 战术风险/陷阱注记（基于 2 年回测验证的实盘微观规律）
    extra_notes = []
    if breadth.get("status") == "OK":
        b_code = breadth.get("scenario_code")
        mcl_val = breadth.get("mcl")
        if tech_weekly == "空" and b_code in ("FAKE_REBOUND_SHORT_COVER", "WEIGHT_PROPPING"):
            extra_notes.append(f"熊市短线陷阱警示：{breadth.get('scenario_tag', '')}（2年盲测空头期胜率87%~100%偏弱）")
        elif tech_weekly == "多" and b_code == "TOP_DIVERGENCE":
            extra_notes.append("短线提示：出现小票普涨/权重放量分化(TOP_DIVERGENCE)，需观察后续是否伴随 MCL 转负，单日不直接推翻牛市趋势")
        elif b_code in ("EXTREME_WEIGHT_OR_ICE", "ICE_POINT_CANDIDATE"):
            extra_notes.append(breadth.get("scenario_tag", ""))
        if tech_weekly == "多" and mcl_val is not None and mcl_val < -150.0:
            extra_notes.append(f"⚠️ 宽广度失血预警：MCL={mcl_val:.1f} (< -150)，虽然周K尚强但全市场个股持续失血，注意控仓防高位补跌")

    if pcr and pcr.get("signal") == "BEAR_DIVERGENCE":
        extra_notes.append("50/300 PCR 分歧警示(防假底)")
    if etf19 and etf19.get("index_value") is not None and etf19["index_value"] >= 70.0 and tech_daily != "多":
        extra_notes.append(f"宽基加权加仓指数={etf19['index_value']}(突破70轨，进入左侧大资金承接区，静待日K翻多共振)")

    trade_date = (
        breadth.get("trade_date")
        or (cffex or {}).get("trade_date")
        or datetime.date.today().strftime("%Y-%m-%d")
    )

    decision = {
        "engine_version": "v2",
        "trade_date": trade_date,
        "created_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "fund_signal": confirm_signal,
        "fund_score": confirm_score,
        "confirm_signal": confirm_signal,
        "confirm_score": confirm_score,
        "tech_signal": tech_signal,
        "tech_weekly": tech_weekly,
        "tech_daily": tech_daily,
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
            "fund_signal": confirm_signal,
            "fund_score": confirm_score,
            "tech_signal": tech_signal,
            "tech_weekly": tech_weekly,
            "tech_daily": tech_daily,
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
