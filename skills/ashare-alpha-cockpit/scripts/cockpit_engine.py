#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cockpit_engine.py - ashare-alpha-cockpit 核心三层融合仲裁引擎 (S4a_CockpitV1_K2 默认 / K=3 可选)。

实证锁定规则：
  1. L1 纠偏确认分（总权重 3.5）：
     - ERP (1.5): Z >= +1.5σ -> +1.0; Z <= -1.2σ -> -0.5（绝不单票触发 -25 否决牛市）; 其余 0.0
     - PCR (1.0): BEAR_DIVERGENCE -> -1.0 (假底否决); BEAR(双高恐慌) -> +0.5; BULL(双低自满) -> -0.5; 其余 0.0
     - IM/IC 滚仓基差 (1.0): IM_pct120 优先（缺失时回退 IC_pct120）
       * 分红季绝对基差底线铁律：pct120 >= 75% 且年化基差 >= -5.0% 才记多 (+1.0 / IC +0.5)，
         若仍深度贴水 (< -5.0%，如 2026-09~10 分红季尾声污染) 则压回 0.0！
       * pct120 <= 15% -> -0.5
     - 19-ETF: 权重 0.0（纯观测）
  2. L1 双空防单票推翻铁律（彻底封堵 2026-09-22 误判漏洞）：
     当 tech_weekly == '空' 且 tech_daily == '空' 时，严禁单一非 ERP 因子把 '空' 软化成 '准备多'；
     必须满足 (ERP Z >= +1.5σ) OR (正向因子 >= 2 路 且 confirm_score >= +25.0) 才可软化，否则坚定输出 '空'。
  3. L1 非对称缓冲器 (Hysteresis K=2 默认 / K=3 低频)：
     普通切换需连续 K 日确认；周/日双空硬破位 0 延迟当日立即切空。
  4. L2 战术快车道与冲顶护栏：
     - 极端左尾探针 (中位数<=-4% / 5日<=-8% / IC<=-25%)：防守态开 40% 有界试仓（最长10日，-5%止损）
     - V底非过热快升 (偏离MA20<=+5% 且 10D<=+10%)：日K翻多+(确认分>=20或ERP深值) 或 ERP深值+放量普涨 -> 跳过缓冲升级
     - 冲顶暴走护栏 (BLOWOFF_EUPHORIA)：连续 3 日将仓位封顶至 50%
  5. L3 成长风格叠加（科创50 / 创业板）：
     - 3/4 蓝灯（非周空、无滞涨）-> 抬升至 80%（最长 5 日）
     - 跌破大阳线中轨 -> 压至 <= 20%；双创 TCR > 40% 且放量滞涨 -> 压至 <= 30%
  6. 严格 `module_dates` 跨日污染门禁：
     区分“法定 T-1 滞后”（ERP/PCR/ETF/两融）与“T+0 核心模块跨日错位”（tech / breadth / cffex 必须同日）。
"""

from __future__ import annotations

import datetime
import json
import math
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_ROOT = SCRIPT_DIR.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from db_store import fetch_prev_engine_state, get_conn, upsert_decision_ledger, upsert_engine_state

CONFIG_PATH = SKILL_ROOT / "config" / "cockpit_config.json"


def load_config() -> Dict[str, Any]:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


# =============================================================================
# 1. `module_dates` 跨日污染门禁
# =============================================================================

def validate_module_dates(
    tech: Dict[str, Any],
    breadth: Dict[str, Any],
    confirm: Dict[str, Any],
) -> Dict[str, Any]:
    """
    校验各模块实际交易日：
      - T+0 核心模块（tech, breadth, cffex）必须对齐到同一基准交易日，若出现跨日错位标记 CROSS_DAY_CONTAMINATED；
      - T-1 晚间/次日披露模块（erp, pcr, margin, etf）滞后 1 个交易日属于正常预期（EXPECTED_T1_LAG），若超前则报警。
    """
    t_dt = tech.get("trade_date")
    b_dt = breadth.get("trade_date")
    cf_dt = (confirm.get("cffex_basis") or {}).get("trade_date")
    erp_dt = (confirm.get("erp") or {}).get("trade_date")
    pcr_dt = (confirm.get("option_pcr") or {}).get("trade_date")
    obs = confirm.get("observation") or {}
    margin_dt = (obs.get("margin") or {}).get("trade_date")
    etf_dt = (obs.get("etf_19") or {}).get("trade_date")

    module_dates = {
        "tech": t_dt,
        "breadth": b_dt,
        "cffex": cf_dt,
        "erp": erp_dt,
        "option_pcr": pcr_dt,
        "margin_obs": margin_dt,
        "etf_19_obs": etf_dt,
    }
    t0_dates = {k: v for k, v in (("tech", t_dt), ("breadth", b_dt), ("cffex", cf_dt)) if v}
    anchor_date = max(t0_dates.values()) if t0_dates else datetime.date.today().strftime("%Y-%m-%d")

    warnings_list: List[str] = []
    if len(set(t0_dates.values())) > 1:
        status = "CROSS_DAY_CONTAMINATED"
        warnings_list.append(
            f"T+0核心模块日期错位：{', '.join(f'{k}={v}' for k, v in t0_dates.items())}（拒绝静默混拼，已显式降级预警）"
        )
    else:
        lagged = []
        for k, v in (("erp", erp_dt), ("option_pcr", pcr_dt), ("margin_obs", margin_dt)):
            if v and v < anchor_date:
                lagged.append(f"{k}={v}")
            elif v and v > anchor_date:
                warnings_list.append(f"异常：{k} 日期({v}) 超前于基准交易日({anchor_date})")
        if warnings_list:
            status = "CROSS_DAY_CONTAMINATED"
        elif lagged:
            status = "EXPECTED_T1_LAG"
        else:
            status = "ALIGNED"

    return {
        "anchor_trade_date": anchor_date,
        "status": status,
        "module_dates": module_dates,
        "warnings": warnings_list,
    }


# =============================================================================
# 2. L1 纠偏确认分（含分红季绝对基差底线保护）
# =============================================================================

def compute_cockpit_confirm_score(
    erp_zscore: Optional[float],
    pcr_signal: Optional[str],
    im_pct120: Optional[float],
    im_ann_roll: Optional[float],
    ic_pct120: Optional[float] = None,
    ic_ann_roll: Optional[float] = None,
    cfg: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    c = (cfg or load_config())["l1_confirm"]
    votes: List[Dict[str, Any]] = []
    missing: List[str] = []

    # 1. ERP 非对称估值（权重 1.5）
    erp_deep_bull = False
    if erp_zscore is not None and not math.isnan(float(erp_zscore)):
        ez = float(erp_zscore)
        if ez >= c["erp_bull_z"]:
            s_erp, note_erp = 1.0, f"ERP Z={ez:+.2f} >= +{c['erp_bull_z']}σ（历史级深值底锚）"
            erp_deep_bull = True
        elif ez <= c["erp_bear_mild_z"]:
            s_erp, note_erp = -0.5, f"ERP Z={ez:+.2f} <= {c['erp_bear_mild_z']}σ（高估温和警示，不单票否决牛市）"
        else:
            s_erp, note_erp = 0.0, f"ERP Z={ez:+.2f} 位于中性区"
        votes.append({"indicator": "股债息差(ERP非对称)", "weight": c["erp_weight"], "score": s_erp, "note": note_erp})
    else:
        missing.append("股债息差(ERP)")

    # 2. 官方 50/300 期权 PCR 反转极性 + 假底否决（权重 1.0）
    if pcr_signal:
        if pcr_signal == "BEAR_DIVERGENCE":
            s_pcr, note_pcr = c["pcr_fake_bottom_veto_score"], "50领先300假底分歧否决 (-1.0)"
        elif pcr_signal == "BEAR":
            s_pcr, note_pcr = c["pcr_panic_bull_score"], "50/300 PCR双高恐慌对冲（逆向托底 +0.5）"
        elif pcr_signal == "BULL":
            s_pcr, note_pcr = c["pcr_complacency_bear_score"], "50/300 PCR双低自满区（短线过热警示 -0.5）"
        else:
            s_pcr, note_pcr = 0.0, "期权 PCR 处于中性区"
        votes.append({"indicator": "50/300期权PCR(反转+假底否决)", "weight": c["pcr_weight"], "score": s_pcr, "note": note_pcr})
    else:
        missing.append("50/300期权PCR")

    # 3. 中金所中小盘滚仓基差（IM 优先 / IC 备选 + 分红季绝对基差底线 >= -5.0%）
    floor_ann = float(c["basis_dividend_floor_ann_pct"])
    if im_pct120 is not None and not math.isnan(float(im_pct120)):
        p = float(im_pct120)
        ann = float(im_ann_roll) if (im_ann_roll is not None and not math.isnan(float(im_ann_roll))) else None
        if p >= c["basis_bull_pct120"]:
            if ann is not None and ann < floor_ann:
                s_bas = 0.0
                note_bas = f"IM 120D分位 {p:.1f}%>=75%，但年化基差 {ann:+.2f}% < {floor_ann:+.1f}%（分红季贴水底线拦截 -> 记0.0）"
            else:
                s_bas = 1.0
                note_bas = f"IM 120D分位 {p:.1f}%>=75% 且年化基差 {ann:+.2f}% >= {floor_ann:+.1f}%（风险偏好转强 +1.0）" if ann is not None else f"IM分位 {p:.1f}%>=75% (+1.0)"
        elif p <= c["basis_bear_pct120"]:
            s_bas = -0.5
            note_bas = f"IM 120D分位 {p:.1f}%<=15%（贴水偏深温和警示 -0.5）"
        else:
            s_bas = 0.0
            note_bas = f"IM 120D分位 {p:.1f}% 位于中性带"
        votes.append({"indicator": "IM滚仓基差(120D分位+分红护栏)", "weight": c["basis_weight"], "score": s_bas, "note": note_bas})
    elif ic_pct120 is not None and not math.isnan(float(ic_pct120)):
        p = float(ic_pct120)
        ann = float(ic_ann_roll) if (ic_ann_roll is not None and not math.isnan(float(ic_ann_roll))) else None
        if p >= c["basis_bull_pct120"]:
            if ann is not None and ann < floor_ann:
                s_bas, note_bas = 0.0, f"IC分位 {p:.1f}%>=75% 但年化 {ann:+.2f}%<{floor_ann:+.1f}%（分红护栏拦截 -> 0.0）"
            else:
                s_bas, note_bas = 0.5, f"IC分位 {p:.1f}%>=75%（IM缺失备选 +0.5）"
        elif p <= c["basis_bear_pct120"]:
            s_bas, note_bas = -0.5, f"IC分位 {p:.1f}%<=15% (-0.5)"
        else:
            s_bas, note_bas = 0.0, f"IC分位 {p:.1f}% 中性"
        votes.append({"indicator": "IC滚仓基差(备选120D分位)", "weight": c["basis_weight"], "score": s_bas, "note": note_bas})
    else:
        missing.append("IM/IC纯净滚仓基差(120D分位)")

    tot_w = sum(v["weight"] for v in votes)
    confirm_score = round(sum(v["weight"] * v["score"] for v in votes) / tot_w * 100.0, 1) if tot_w > 0 else 0.0
    pos_vote_cnt = sum(1 for v in votes if v["score"] > 0)

    return {
        "confirm_score": confirm_score,
        "votes": votes,
        "positive_vote_count": pos_vote_cnt,
        "erp_deep_bull": erp_deep_bull,
        "missing": missing,
    }


# =============================================================================
# 3. L1 四态仲裁（含双空防单票推翻门禁）
# =============================================================================

def arbitrate_l1_cockpit(
    tech_weekly: str,
    tech_daily: str,
    confirm_score: float,
    positive_vote_count: int = 0,
    erp_deep_bull: bool = False,
    cfg: Optional[Dict[str, Any]] = None,
) -> Tuple[str, str]:
    """周K主趋势轴 × 日K时机阀 × 纠偏确认分（含双空防单票篡改铁律）。"""
    c = (cfg or load_config())["l1_arbitration"]
    w = tech_weekly if tech_weekly in ("多", "空", "中性") else "中性"
    d = tech_daily if tech_daily in ("多", "空", "中性") else "中性"

    if w == "多":
        if confirm_score <= -35.0 and d == "空":
            return "空", "周K虽多但日K翻空且确认分严重恶化(≤-35)：疑似头部破位，转为防守空仓"
        if confirm_score <= -25.0 or d == "空":
            return "准备空", "周K多头趋势中出现日K转空或双因子确认分预警(≤-25)：暂停追高，先落袋减仓防守"
        return "多", "周K主趋势向上且日K/确认分无破位警示：多头高确定性主升窗口，顺势持股"

    if w == "空":
        if confirm_score >= 30.0 and d == "多":
            return "多", "周K虽空但确认分强力转多(≥+30)且日K率先翻多：底部右侧反转共振"
        if d == "多":
            return "准备多", "周K偏空但日K已率先翻多：右侧修复试仓观察区，严控仓位"
        # 双空（w=='空' 且 d!='多'）防单票推翻门禁：彻底封堵 2026-09-22 类漏洞！
        min_cs = float(c["dual_bear_min_confirm_score"])
        multi_ok = erp_deep_bull or (positive_vote_count >= 2)
        if confirm_score >= min_cs and (multi_ok or not c["dual_bear_require_multi_or_erp"]):
            return "准备多", f"双空状态下满足深值/多因子底部共振（确认分 {confirm_score:+.1f} >= +{min_cs}）：左侧分批观察"
        return "空", "周K与日K共振向下且无深值/多因子共振支撑：顺大势坚定空仓防守，严防熊市假反抽"

    # 周K中性
    if d == "多" and confirm_score >= 0.0:
        return "多", "周K中性过渡期，日K翻多且确认分非负：顺势跟随波段"
    if d == "空" and confirm_score <= 0.0:
        return "空", "周K中性过渡期，日K翻空且确认分偏弱：空仓防守规避下行"
    if confirm_score >= 25.0:
        return "准备多", "周K中性且确认分显著偏多(≥+25)：等待日K放量翻多确认"
    if confirm_score <= -25.0:
        return "准备空", "周K中性且确认分明显偏空(≤-25)：谨防向下变盘"
    return "观望(中性)", "周K、日K与确认分均无单边共振：轻仓观望"


# =============================================================================
# 4. 单步状态机：L1 缓冲器 + L2 战术快车道 + L3 双创风格叠加
# =============================================================================

def step_cockpit_state_machine(
    trade_date: str,
    tech_weekly: str,
    tech_daily: str,
    l1_raw_state: str,
    confirm_score: float,
    erp_zscore: Optional[float],
    hs300_close: Optional[float],
    hs300_ext_ma20_pct: Optional[float],
    hs300_ret10d_pct: Optional[float],
    median_pct: Optional[float],
    median_cum_5d: Optional[float],
    ic_ann_roll: Optional[float],
    adv_ratio: Optional[float],
    adv_amt_ratio: Optional[float],
    blue_light_3of4: bool,
    broken_midpoint: bool,
    tcr_froth_stagnation: bool,
    prev_state: Optional[Dict[str, Any]] = None,
    hysteresis_k: int = 2,
    cfg: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    纯函数单步状态机（实盘逐日执行与 Walk-Forward 回测 100% 逻辑等价）：
      输入当日因果特征 + 前一交易日持久化状态 -> 输出当日最终状态、仓位、主波段定性、风格仓位及新持久化状态。
    """
    full_cfg = cfg or load_config()
    pos_map = full_cfg["l1_arbitration"]["graded_position_map"]
    fast_exit = bool(full_cfg["l1_arbitration"]["fast_hard_bear_exit"])
    l2c = full_cfg["l2_tactical"]
    l3c = full_cfg["l3_style"]

    # ---- Step A: L1 非对称缓冲器 (Hysteresis) ----
    if not prev_state or not prev_state.get("l1_confirmed_state") or hysteresis_k <= 1:
        l1_confirmed = l1_raw_state
        pending_state = None
        pending_streak = 0
    else:
        cur = str(prev_state["l1_confirmed_state"])
        pend = prev_state.get("pending_state")
        streak = int(prev_state.get("pending_streak") or 0)

        if l1_raw_state == cur:
            l1_confirmed, pending_state, pending_streak = cur, None, 0
        elif fast_exit and l1_raw_state == "空" and tech_weekly == "空" and tech_daily == "空":
            l1_confirmed, pending_state, pending_streak = "空", None, 0
        else:
            if l1_raw_state == pend:
                streak += 1
            else:
                pend = l1_raw_state
                streak = 1
            if streak >= hysteresis_k:
                l1_confirmed, pending_state, pending_streak = l1_raw_state, None, 0
            else:
                l1_confirmed, pending_state, pending_streak = cur, pend, streak

    base_pos = float(pos_map.get(l1_confirmed, 0.3))

    # ---- Step B: L2 左尾探针 / V底快升 / 冲顶暴走护栏 ----
    probe_active = bool(prev_state.get("probe_active")) if prev_state else False
    probe_entry_date = prev_state.get("probe_entry_date") if prev_state else None
    probe_entry_px = float(prev_state["probe_entry_hs300"]) if (prev_state and prev_state.get("probe_entry_hs300") is not None) else None
    probe_age = int(prev_state.get("probe_age") or 0) if prev_state else 0
    blowoff_cd = int(prev_state.get("blowoff_cooldown") or 0) if prev_state else 0

    is_broad_surge = (
        adv_ratio is not None and adv_amt_ratio is not None
        and adv_ratio >= l2c["blowoff_adv_ratio_pct"] and adv_amt_ratio >= l2c["blowoff_adv_amt_ratio_pct"]
    )
    is_overextended = hs300_ext_ma20_pct is not None and hs300_ext_ma20_pct > l2c["blowoff_ext_ma20_pct"]
    if is_broad_surge and is_overextended:
        blowoff_cd = int(l2c["blowoff_cooldown_days"])
    elif blowoff_cd > 0:
        blowoff_cd -= 1

    if probe_active:
        probe_age += 1
        dd = (
            (hs300_close / probe_entry_px - 1.0)
            if (hs300_close is not None and probe_entry_px is not None and probe_entry_px > 0) else 0.0
        )
        if base_pos >= 0.50 or probe_age > int(l2c["probe_max_days"]) or dd <= float(l2c["probe_stop_loss_pct"]):
            probe_active = False
            probe_entry_date = None
            probe_entry_px = None
            probe_age = 0

    is_left_tail = (
        (median_pct is not None and median_pct <= l2c["left_tail_median_1d_pct"])
        or (median_cum_5d is not None and median_cum_5d <= l2c["left_tail_median_5d_pct"])
        or (ic_ann_roll is not None and ic_ann_roll <= l2c["left_tail_ic_raw_ann_pct"])
    )
    if is_left_tail and base_pos <= 0.20 and not probe_active:
        probe_active = True
        probe_entry_date = trade_date
        probe_entry_px = hs300_close
        probe_age = 0

    final_state = l1_confirmed
    final_pos = base_pos
    fastlane_tag = "L1_BASE"

    not_extended = (
        (hs300_ext_ma20_pct is None or hs300_ext_ma20_pct <= l2c["vbottom_max_ext_ma20_pct"])
        and (hs300_ret10d_pct is None or hs300_ret10d_pct <= l2c["vbottom_max_ret10d_pct"])
    )
    erp_deep = erp_zscore is not None and erp_zscore >= 1.5
    probe_pos = float(l2c["probe_position"])

    if base_pos <= 0.20 and not_extended:
        if tech_daily == "多" and (confirm_score >= 20.0 or erp_deep):
            final_state = "多" if (erp_deep or confirm_score >= 35.0) else "准备多"
            final_pos = float(pos_map[final_state])
            fastlane_tag = "L2_VBOTTOM_FASTLANE"
            probe_active, probe_entry_date, probe_entry_px, probe_age = False, None, None, 0
        elif erp_deep and is_broad_surge:
            final_state = "准备多"
            final_pos = 0.50
            fastlane_tag = "L2_ERP_SURGE_FASTLANE"
            probe_active, probe_entry_date, probe_entry_px, probe_age = False, None, None, 0
        elif probe_active:
            final_state = "准备多"
            final_pos = max(base_pos, probe_pos)
            fastlane_tag = "L2_LEFTTAIL_PROBE"
    elif probe_active and final_pos < probe_pos:
        final_state = "准备多"
        final_pos = probe_pos
        fastlane_tag = "L2_LEFTTAIL_PROBE"

    if blowoff_cd > 0 and final_pos > float(l2c["blowoff_cap_position"]):
        final_state = "准备空"
        final_pos = float(l2c["blowoff_cap_position"])
        fastlane_tag = "L2_BLOWOFF_CAP"

    # ---- Step C: L3 成长风格叠加（科创50 / 创业板专用仓位） ----
    bl_active = bool(prev_state.get("blue_hold_active")) if prev_state else False
    bl_age = int(prev_state.get("blue_hold_age") or 0) if prev_state else 0
    if bl_active:
        bl_age += 1
        if broken_midpoint or tcr_froth_stagnation or bl_age > int(l3c["blue_light_max_days"]):
            bl_active, bl_age = False, 0
    if blue_light_3of4 and not broken_midpoint and not tcr_froth_stagnation and tech_weekly != "空":
        bl_active, bl_age = True, 0

    if tcr_froth_stagnation:
        style_pos = min(final_pos, float(l3c["tcr_froth_cap_position"]))
        style_state = "L3_TCR_FROTH_CUT（双创拥挤放量滞涨，强制压仓<=30%）"
    elif broken_midpoint:
        style_pos = min(final_pos, float(l3c["broken_midpoint_cap_position"]))
        style_state = "L3_BROKEN_MID_STOP（跌破大阳线中轨，风控压仓<=20%）"
    elif bl_active:
        style_pos = max(final_pos, float(l3c["blue_light_boost_position"]))
        style_state = f"L3_BLUELIGHT_3OF4（大阳线中轨蓝灯确认第{bl_age+1}日，成长仓位提升至80%）"
    else:
        style_pos = final_pos
        style_state = "L3_FOLLOW_L1（无特殊双创异动，跟随L1大盘仓位）"

    # ---- Step D: 双层人性化实盘指令（主波段定性 + 精确五档仓位） ----
    if tech_weekly == "多" and tech_daily in ("多", "中性"):
        if final_state == "多":
            wave_regime = "主升持股期（周/日共振向上，安心持仓）"
        else:
            wave_regime = "多头趋势短线高抛预警期（周/日趋势未坏，仅衍生品/过热短线警戒，不折腾可稳守核心仓）"
    elif tech_weekly == "多" and tech_daily == "空":
        wave_regime = "多头回调减仓期（周多日空，建议高抛锁定利润、留底仓观察）"
    elif tech_weekly == "空" and tech_daily == "空":
        if fastlane_tag == "L2_LEFTTAIL_PROBE":
            wave_regime = "熊市极端冰点左侧试仓期（仅限40%有界试仓，跌破入场-5%硬止损）"
        elif final_state == "准备多":
            wave_regime = "深值/多因子左侧观察期（严控半仓以下，静待日K翻多）"
        else:
            wave_regime = "空头主跌防守期（周/日双空共振，坚定空仓躺平）"
    elif tech_weekly == "空" and tech_daily == "多":
        wave_regime = "右侧底部修复试仓期（周空日多，轻中仓试错等待周线拐头）"
    else:
        wave_regime = "震荡过渡观望期（周线中性，按日K与确认分灵活控仓）"

    new_state = {
        "trade_date": trade_date,
        "hysteresis_k": hysteresis_k,
        "l1_raw_state": l1_raw_state,
        "l1_confirmed_state": l1_confirmed,
        "pending_state": pending_state,
        "pending_streak": pending_streak,
        "probe_active": int(probe_active),
        "probe_entry_date": probe_entry_date,
        "probe_entry_hs300": probe_entry_px,
        "probe_age": probe_age,
        "blowoff_cooldown": blowoff_cd,
        "blue_hold_active": int(bl_active),
        "blue_hold_age": bl_age,
        "updated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }

    return {
        "l1_raw_state": l1_raw_state,
        "l1_confirmed_state": l1_confirmed,
        "wave_regime": wave_regime,
        "final_state": final_state,
        "target_position": round(final_pos, 2),
        "target_position_pct": round(final_pos * 100.0, 1),
        "fastlane_tag": fastlane_tag,
        "style_state": style_state,
        "style_position": round(style_pos, 2),
        "style_position_pct": round(style_pos * 100.0, 1),
        "hysteresis_note": (
            f"确认缓冲 K={hysteresis_k}" + (f"（待确认 {pending_state} {pending_streak}/{hysteresis_k}日）" if pending_state else "（状态已稳定）")
        ),
        "new_engine_state": new_state,
    }


# =============================================================================
# 5. 完整顶层决策入口（含落盘与防跨日校验）
# =============================================================================

def evaluate_cockpit_decision(
    tech: Dict[str, Any],
    breadth: Dict[str, Any],
    confirm: Dict[str, Any],
    traffic_lights: Dict[str, Any],
    hysteresis_k: int = 2,
    save_ledger: bool = True,
    db_path: Optional[Path] = None,
) -> Dict[str, Any]:
    cfg = load_config()
    date_audit = validate_module_dates(tech, breadth, confirm)
    trade_date = date_audit["anchor_trade_date"]

    tech_weekly = tech.get("weekly_signal", "中性") if tech.get("status") == "OK" else "中性"
    tech_daily = tech.get("daily_signal", "中性") if tech.get("status") == "OK" else "中性"

    erp = confirm.get("erp") or {}
    pcr = confirm.get("option_pcr") or {}
    cf = confirm.get("cffex_basis") or {}

    cs_res = compute_cockpit_confirm_score(
        erp_zscore=erp.get("zscore") if erp.get("status") == "OK" else None,
        pcr_signal=pcr.get("signal") if pcr.get("status") == "OK" else None,
        im_pct120=cf.get("im_pct120") if cf.get("status") == "OK" else None,
        im_ann_roll=cf.get("im_ann_roll") if cf.get("status") == "OK" else None,
        ic_pct120=cf.get("ic_pct120") if cf.get("status") == "OK" else None,
        ic_ann_roll=cf.get("ic_ann_roll") if cf.get("status") == "OK" else None,
        cfg=cfg,
    )

    missing = list(cs_res["missing"])
    if tech.get("status") != "OK":
        missing.append("周/日K技术面")
    if breadth.get("status") != "OK":
        missing.append("全A微观宽广度/TRIN/TCR")

    l1_raw, l1_guidance = arbitrate_l1_cockpit(
        tech_weekly=tech_weekly,
        tech_daily=tech_daily,
        confirm_score=cs_res["confirm_score"],
        positive_vote_count=cs_res["positive_vote_count"],
        erp_deep_bull=cs_res["erp_deep_bull"],
        cfg=cfg,
    )

    conn = get_conn(db_path)
    try:
        prev_st = fetch_prev_engine_state(conn, before_trade_date=trade_date)
    finally:
        conn.close()

    sm = step_cockpit_state_machine(
        trade_date=trade_date,
        tech_weekly=tech_weekly,
        tech_daily=tech_daily,
        l1_raw_state=l1_raw,
        confirm_score=cs_res["confirm_score"],
        erp_zscore=erp.get("zscore") if erp.get("status") == "OK" else None,
        hs300_close=tech.get("hs300_close"),
        hs300_ext_ma20_pct=tech.get("hs300_ext_ma20_pct"),
        hs300_ret10d_pct=tech.get("hs300_ret_10d_pct"),
        median_pct=breadth.get("median_pct") if breadth.get("status") == "OK" else None,
        median_cum_5d=breadth.get("median_cum_5d") if breadth.get("status") == "OK" else None,
        ic_ann_roll=cf.get("ic_ann_roll") if cf.get("status") == "OK" else None,
        adv_ratio=breadth.get("adv_ratio") if breadth.get("status") == "OK" else None,
        adv_amt_ratio=breadth.get("adv_amt_ratio") if breadth.get("status") == "OK" else None,
        blue_light_3of4=bool(traffic_lights.get("blue_light_3of4")),
        broken_midpoint=bool(traffic_lights.get("broken_midpoint")),
        tcr_froth_stagnation=bool(traffic_lights.get("tcr_froth_stagnation")),
        prev_state=prev_st,
        hysteresis_k=hysteresis_k,
        cfg=cfg,
    )

    extra_notes = list(date_audit["warnings"])
    if breadth.get("status") == "OK":
        b_code = breadth.get("scenario_code")
        mcl_v = breadth.get("mcl")
        if b_code == "TOP_DIVERGENCE":
            extra_notes.append(f"⚠️ 高位量价背离预警：{breadth.get('scenario_tag')}")
        elif b_code == "BLOWOFF_EUPHORIA":
            extra_notes.append(f"🔥 冲顶暴走封顶护栏激活：{breadth.get('scenario_tag')}")
        elif tech_weekly == "空" and b_code in ("FAKE_REBOUND_SHORT_COVER", "WEIGHT_PROPPING"):
            extra_notes.append(f"⚠️ 熊市陷阱警示：{breadth.get('scenario_tag')}")
        if tech_weekly == "多" and mcl_v is not None and mcl_v < -150.0:
            extra_notes.append(f"⚠️ 宽广度失血预警：MCL={mcl_v:.1f} (< -150)")

    created_at = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    decision = {
        "engine_version": cfg["engine_version"],
        "trade_date": trade_date,
        "created_at": created_at,
        "hysteresis_k": hysteresis_k,
        "date_alignment_status": date_audit["status"],
        "module_dates": date_audit["module_dates"],
        "date_warnings": date_audit["warnings"],
        "tech_weekly": tech_weekly,
        "tech_daily": tech_daily,
        "confirm_score": cs_res["confirm_score"],
        "votes": cs_res["votes"],
        "l1_raw_state": sm["l1_raw_state"],
        "l1_confirmed_state": sm["l1_confirmed_state"],
        "l1_guidance": l1_guidance,
        "wave_regime": sm["wave_regime"],
        "final_state": sm["final_state"],
        "target_position": sm["target_position"],
        "target_position_pct": sm["target_position_pct"],
        "fastlane_tag": sm["fastlane_tag"],
        "hysteresis_note": sm["hysteresis_note"],
        "style_state": sm["style_state"],
        "style_position": sm["style_position"],
        "style_position_pct": sm["style_position_pct"],
        "traffic_light": traffic_lights.get("primary_light"),
        "missing_items": missing,
        "notes": " | ".join(extra_notes) if extra_notes else l1_guidance,
    }

    if save_ledger and date_audit["status"] != "CROSS_DAY_CONTAMINATED":
        conn = get_conn(db_path)
        try:
            upsert_engine_state(conn, sm["new_engine_state"])
            upsert_decision_ledger(
                conn,
                {
                    "trade_date": trade_date,
                    "created_at": created_at,
                    "engine_version": cfg["engine_version"],
                    "hysteresis_k": hysteresis_k,
                    "date_alignment_status": date_audit["status"],
                    "module_dates_json": date_audit["module_dates"],
                    "tech_weekly": tech_weekly,
                    "tech_daily": tech_daily,
                    "confirm_score": cs_res["confirm_score"],
                    "l1_raw_state": sm["l1_raw_state"],
                    "l1_confirmed_state": sm["l1_confirmed_state"],
                    "wave_regime": sm["wave_regime"],
                    "final_state": sm["final_state"],
                    "target_position_pct": sm["target_position_pct"],
                    "fastlane_tag": sm["fastlane_tag"],
                    "style_state": sm["style_state"],
                    "style_position_pct": sm["style_position_pct"],
                    "traffic_light": traffic_lights.get("primary_light"),
                    "breadth_code": breadth.get("scenario_code"),
                    "adv_ratio": breadth.get("adv_ratio"),
                    "median_pct": breadth.get("median_pct"),
                    "tcr_double_tech": breadth.get("tcr_double_tech"),
                    "erp_zscore": erp.get("zscore"),
                    "im_ann_basis": cf.get("im_ann_roll"),
                    "im_pct120": cf.get("im_pct120"),
                    "pcr_50_ema5": pcr.get("pcr_50_ema5"),
                    "pcr_300_ema5": pcr.get("pcr_300_ema5"),
                    "missing_items": missing,
                    "notes": decision["notes"],
                    "raw_json": decision,
                },
                export_csv=True,
            )
        finally:
            conn.close()
    elif save_ledger and date_audit["status"] == "CROSS_DAY_CONTAMINATED":
        decision["ledger_skipped_reason"] = "检测到 T+0 模块跨日错位，已拒绝污染台账写入"

    return decision
