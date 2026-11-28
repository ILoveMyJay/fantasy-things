#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_cockpit.py - ashare-alpha-cockpit 全面单元测试套件（覆盖 Phase 1 三层引擎 + Phase 2 个股闸门）。
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from cockpit_engine import (
    arbitrate_l1_cockpit,
    compute_cockpit_confirm_score,
    evaluate_cockpit_decision,
    step_cockpit_state_machine,
    validate_module_dates,
)
from db_store import fetch_ledger_recent, get_conn
from fetch_breadth_tcr import classify_breadth_scenario_cockpit, compute_breadth_and_tcr
from fetch_tactical_radar import detect_anchor_bullish_candle, evaluate_traffic_lights
from stock_gate import evaluate_single_stock_gate


# =============================================================================
# 1. L1 确认分、分红季基差底线 & 双空防单票铁律（封堵 2026-09-22 漏洞）
# =============================================================================

def test_erp_mild_caution_never_solo_vetoes_bull_market():
    """ERP Z <= -1.2σ 单独作用必须 > -25.0（-21.4），绝不单票把周/日双多牛市打成准备空。"""
    res = compute_cockpit_confirm_score(
        erp_zscore=-1.8, pcr_signal="NEUTRAL", im_pct120=50.0, im_ann_roll=-2.0
    )
    assert -25.0 < res["confirm_score"] < 0.0
    st, _ = arbitrate_l1_cockpit("多", "多", res["confirm_score"], res["positive_vote_count"], res["erp_deep_bull"])
    assert st == "多"


def test_dividend_season_basis_floor_blocks_false_bull_2026_10_case():
    """复刻 2026-10-19 分红季尾声污染：IM_pct120=81.7% 但年化基差 -5.88% (< -5.0%) 必须压回 0.0！"""
    res = compute_cockpit_confirm_score(
        erp_zscore=0.28, pcr_signal="NEUTRAL", im_pct120=81.7, im_ann_roll=-5.88
    )
    assert res["confirm_score"] == 0.0
    assert res["positive_vote_count"] == 0


def test_dual_bear_blocks_single_factor_override_2026_09_22_case():
    """
    复刻 2026-09-22 / 2026-09-28 漏洞：
    周空 + 日空 时，即便 IM_pct120=98% 且年化 -2.0% 拿到单一因子 +1.0 (confirm=+28.6)，
    但 ERP 未深值且仅 1 路正向因子 -> 必须坚定输出【空】，禁止单票软化成准备多！
    """
    res = compute_cockpit_confirm_score(
        erp_zscore=-0.07, pcr_signal="NEUTRAL", im_pct120=98.3, im_ann_roll=-1.99
    )
    assert res["confirm_score"] > 25.0
    assert res["positive_vote_count"] == 1
    assert res["erp_deep_bull"] is False
    st, _ = arbitrate_l1_cockpit("空", "空", res["confirm_score"], res["positive_vote_count"], res["erp_deep_bull"])
    assert st == "空", f"Single basis factor improperly overrode dual-bear to {st}!"


def test_dual_bear_allows_erp_deep_value_or_multi_factor_resonance():
    """周空 + 日空 时，若 ERP >= +1.5σ 深值或 2 路正向共振且 >= +25，允许进入左侧准备多。"""
    r_erp = compute_cockpit_confirm_score(erp_zscore=1.7, pcr_signal="NEUTRAL", im_pct120=50.0, im_ann_roll=-2.0)
    st1, _ = arbitrate_l1_cockpit("空", "空", r_erp["confirm_score"], r_erp["positive_vote_count"], r_erp["erp_deep_bull"])
    assert st1 == "准备多"

    r_multi = compute_cockpit_confirm_score(erp_zscore=0.0, pcr_signal="BEAR", im_pct120=85.0, im_ann_roll=-1.0)
    assert r_multi["positive_vote_count"] == 2 and r_multi["confirm_score"] >= 25.0
    st2, _ = arbitrate_l1_cockpit("空", "空", r_multi["confirm_score"], r_multi["positive_vote_count"], r_multi["erp_deep_bull"])
    assert st2 == "准备多"


def test_pcr_reversed_polarity_and_fake_bottom_veto():
    """验证 PCR 反转极性（BEAR 高恐慌=+0.5, BULL 低自满=-0.5）与假底否决（BEAR_DIVERGENCE=-1.0）。"""
    r_panic = compute_cockpit_confirm_score(0.0, "BEAR", 50.0, -2.0)
    r_comp = compute_cockpit_confirm_score(0.0, "BULL", 50.0, -2.0)
    r_fake = compute_cockpit_confirm_score(0.0, "BEAR_DIVERGENCE", 50.0, -2.0)
    assert r_panic["confirm_score"] > 0
    assert r_comp["confirm_score"] < 0
    assert r_fake["confirm_score"] < r_comp["confirm_score"]


# =============================================================================
# 2. 状态机：非对称缓冲、硬破位快出、左尾探针、冲顶封顶、L3 风格风控
# =============================================================================

def test_asymmetric_hysteresis_and_fast_hard_bear_exit():
    """K=2 拦截 1 日假波动，但周/日双空硬破位 0 延迟当日立即切空。"""
    prev = {"l1_confirmed_state": "多", "pending_state": None, "pending_streak": 0}
    # 第1天 准备空 -> 缓冲拦截，维持 多
    s1 = step_cockpit_state_machine(
        "2026-06-25", "多", "多", "准备空", -35.7, -1.7, 5020.0, 2.0, 3.0,
        0.5, 1.0, -3.0, 50.0, 55.0, False, False, False, prev_state=prev, hysteresis_k=2
    )
    assert s1["l1_confirmed_state"] == "多"
    assert s1["new_engine_state"]["pending_streak"] == 1

    # 周空 + 日空 硬破位 -> 0 延迟当日切空
    s_crash = step_cockpit_state_machine(
        "2026-08-25", "空", "空", "空", -20.0, 0.0, 4550.0, -3.0, -5.0,
        -1.5, -3.0, -5.0, 20.0, 25.0, False, False, False, prev_state=prev, hysteresis_k=2
    )
    assert s_crash["l1_confirmed_state"] == "空"
    assert s_crash["target_position"] == 0.0


def test_l2_blowoff_euphoria_cap_2024_10_08_case():
    """复刻 2024-10-08（adv=94.2%, adv_amt=89.6%, ext_ma20=+26.6%）：强制压仓至 50% 封顶。"""
    sc, _ = classify_breadth_scenario_cockpit(94.2, 1.88, -4.6, vol_ratio_prev=1.35, hs300_ext_ma20_pct=26.6)
    assert sc == "BLOWOFF_EUPHORIA"

    prev = {"l1_confirmed_state": "多", "pending_state": None, "pending_streak": 0}
    s = step_cockpit_state_machine(
        "2024-10-08", "多", "多", "多", 10.0, 0.5, 4256.0, 26.6, 34.7,
        5.0, 18.0, 5.0, 94.2, 89.6, False, False, False, prev_state=prev, hysteresis_k=2
    )
    assert s["fastlane_tag"] == "L2_BLOWOFF_CAP"
    assert s["target_position"] == 0.5


def test_breadth_singularity_fix_distinguishes_2026_11_27_vs_2021_02_18():
    """2026-11-27 放量普涨 -> BROAD_SURGE_EXPANDING；2021-02-18 抱团崩盘(adv_amt=60.6%) -> TOP_DIVERGENCE。"""
    sc_26, _ = classify_breadth_scenario_cockpit(96.52, 2.609, -4.86, vol_ratio_prev=1.52, hs300_ext_ma20_pct=1.31)
    assert sc_26 == "BROAD_SURGE_EXPANDING"
    sc_21, _ = classify_breadth_scenario_cockpit(85.9, 4.288, -25.3, vol_ratio_prev=1.24, hs300_ext_ma20_pct=4.30)
    assert sc_21 == "TOP_DIVERGENCE"


def test_l3_tcr_froth_stagnation_cut_2026_07_01_case():
    """复刻 2026-07-01：双创 TCR=44.22%>40% + 放量1.12倍滞涨 -> 科创50风格仓位强制压至 <=30%。"""
    prev = {"l1_confirmed_state": "多", "pending_state": None, "pending_streak": 0}
    s = step_cockpit_state_machine(
        "2026-07-01", "多", "多", "多", -21.4, -1.54, 4959.0, 2.0, 3.0,
        0.5, 1.0, -3.0, 78.5, 52.8, blue_light_3of4=False, broken_midpoint=False,
        tcr_froth_stagnation=True, prev_state=prev, hysteresis_k=2
    )
    assert s["target_position"] == 1.0
    assert s["style_position"] == 0.3
    assert "L3_TCR_FROTH_CUT" in s["style_state"]


def test_l2_left_tail_probe_and_stop_loss():
    """极端左尾(中位数<=-4%)在空仓期开启 40% 探针，跌超 -5% 时触发止损退出。"""
    prev = {"l1_confirmed_state": "空", "pending_state": None, "pending_streak": 0}
    s1 = step_cockpit_state_machine(
        "2026-11-20", "空", "空", "空", -25.0, 0.2, 4000.0, -2.0, -3.0,
        -4.5, -6.0, -10.0, 5.6, 18.0, False, False, False, prev_state=prev, hysteresis_k=2
    )
    assert s1["fastlane_tag"] == "L2_LEFTTAIL_PROBE"
    assert s1["target_position"] == 0.4

    # 跌破 -5% 止损线 (4000 -> 3780 = -5.5%)
    s2 = step_cockpit_state_machine(
        "2026-11-21", "空", "空", "空", -25.0, 0.2, 3780.0, -6.0, -8.0,
        -2.0, -5.0, -10.0, 20.0, 25.0, False, False, False, prev_state=s1["new_engine_state"], hysteresis_k=2
    )
    assert s2["target_position"] == 0.0
    assert s2["new_engine_state"]["probe_active"] == 0


# =============================================================================
# 3. `module_dates` 跨日污染拦截与 SQLite 拒绝污染写入
# =============================================================================

def test_module_dates_guard_blocks_cross_day_contamination(tmp_path: Path):
    """T+0 核心模块（tech=11-27 vs breadth=11-26）跨日错位必须拦截并拒绝写入台账！"""
    tech = {"status": "OK", "trade_date": "2026-11-27", "weekly_signal": "空", "daily_signal": "空", "hs300_close": 4063.0}
    breadth = {"status": "OK", "trade_date": "2026-11-26", "adv_ratio": 31.6, "adv_amt_ratio": 52.4, "median_pct": -0.5}
    confirm = {
        "erp": {"status": "OK", "trade_date": "2026-11-26", "zscore": 0.1},
        "option_pcr": {"status": "OK", "trade_date": "2026-11-26", "signal": "NEUTRAL"},
        "cffex_basis": {"status": "OK", "trade_date": "2026-11-27", "im_pct120": 50.0, "im_ann_roll": -2.0},
    }
    audit = validate_module_dates(tech, breadth, confirm)
    assert audit["status"] == "CROSS_DAY_CONTAMINATED"

    db_file = tmp_path / "test_cockpit.sqlite"
    dec = evaluate_cockpit_decision(
        tech=tech, breadth=breadth, confirm=confirm,
        traffic_lights={"primary_light": "⚪ 灰灯常规"},
        save_ledger=True, db_path=db_file,
    )
    assert dec["date_alignment_status"] == "CROSS_DAY_CONTAMINATED"
    assert "ledger_skipped_reason" in dec
    conn = get_conn(db_file)
    try:
        assert len(fetch_ledger_recent(conn)) == 0
    finally:
        conn.close()


def test_module_dates_allows_expected_t1_lag_for_erp_pcr(tmp_path: Path):
    """T+0 核心同日(11-27)，而 ERP/PCR 滞后一日(11-26) 属于正常预期 EXPECTED_T1_LAG，允许正常落盘。"""
    tech = {"status": "OK", "trade_date": "2026-11-27", "weekly_signal": "空", "daily_signal": "空", "hs300_close": 4063.0}
    breadth = {"status": "OK", "trade_date": "2026-11-27", "adv_ratio": 96.5, "adv_amt_ratio": 91.7, "median_pct": 2.5}
    confirm = {
        "erp": {"status": "OK", "trade_date": "2026-11-26", "zscore": 0.1},
        "option_pcr": {"status": "OK", "trade_date": "2026-11-26", "signal": "NEUTRAL"},
        "cffex_basis": {"status": "OK", "trade_date": "2026-11-27", "im_pct120": 50.0, "im_ann_roll": -2.0},
    }
    db_file = tmp_path / "test_ok.sqlite"
    dec = evaluate_cockpit_decision(
        tech=tech, breadth=breadth, confirm=confirm,
        traffic_lights={"primary_light": "⚪ 灰灯常规"},
        save_ledger=True, db_path=db_file,
    )
    assert dec["date_alignment_status"] == "EXPECTED_T1_LAG"
    conn = get_conn(db_file)
    try:
        rows = fetch_ledger_recent(conn)
        assert len(rows) == 1 and rows[0]["trade_date"] == "2026-11-27"
    finally:
        conn.close()


# =============================================================================
# 4. 3/4 蓝灯大阳线中轨测试
# =============================================================================

def test_anchor_midpoint_and_exact_3of4_blue_light():
    """验证大阳线中轨 = (prev_close + anchor_close) / 2，且 3/4 蓝灯 (OR) 精确触发。"""
    klines = {
        "sh000688": [
            {"date": "2026-06-01", "open": 1000, "close": 1000, "high": 1010, "low": 990, "volume": 100},
            {"date": "2026-06-02", "open": 1005, "close": 1060, "high": 1065, "low": 1000, "volume": 180},
            {"date": "2026-06-03", "open": 1055, "close": 1040, "high": 1060, "low": 1032, "volume": 130},
        ],
        "sz399006": [
            {"date": "2026-06-01", "open": 2000, "close": 2000, "high": 2010, "low": 1990, "volume": 100},
            {"date": "2026-06-02", "open": 2005, "close": 2090, "high": 2095, "low": 2000, "volume": 180},
            {"date": "2026-06-03", "open": 2080, "close": 2060, "high": 2085, "low": 2050, "volume": 130},
        ],
        "sh000001": [
            {"date": "2026-06-01", "open": 3000, "close": 3000, "high": 3010, "low": 2990, "volume": 100},
            {"date": "2026-06-02", "open": 3005, "close": 3070, "high": 3075, "low": 3000, "volume": 180},
            {"date": "2026-06-03", "open": 3065, "close": 3050, "high": 3070, "low": 3040, "volume": 130},
        ],
    }
    anc = detect_anchor_bullish_candle(klines_map=klines)
    assert anc["status"] == "holding_above_midpoint"
    assert anc["levels"]["000688"]["midpoint"] == 1030.0

    # TCR=38.5 (>37.5) 但炸板率=20% (<35%) -> 满足 3/4 蓝灯 (OR)
    tl = evaluate_traffic_lights(
        breadth={"tcr_double_tech": 38.5, "vol_ratio_prev": 0.9, "broken_board_rate": 20.0},
        confirm={}, tech={}, anchor=anc, news={},
    )
    assert tl["blue_light_3of4"] is True
    assert tl["blue"]["hits"] == 3


# =============================================================================
# 5. Phase 2 解耦式个股趋势与买前风控闸门测试
# =============================================================================

def _make_trending_stock(n: int = 260, trend: float = 0.0025, surge_last: float = 0.0) -> pd.DataFrame:
    dates = pd.bdate_range("2025-01-02", periods=n).strftime("%Y-%m-%d")
    rng = np.random.default_rng(7)
    rets = rng.normal(trend, 0.012, size=n)
    close = 50.0 * np.cumprod(1.0 + rets)
    if surge_last != 0.0:
        close[-5:] *= (1.0 + surge_last)
    open_ = close * 0.995
    high = close * 1.015
    low = close * 0.985
    vol = np.full(n, 2e7)
    return pd.DataFrame({
        "date": dates, "open": open_, "close": close, "high": high, "low": low,
        "volume": vol, "amount": vol * close,
    })


def test_stock_gate_etf_firewall_blocks_broad_etf():
    res = evaluate_single_stock_gate("510300", "沪深300ETF", pd.DataFrame(), l1_target_pos=1.0)
    assert res["status"] == "BLOCKED_ETF"
    assert "VETO" in res["verdict"]


def test_stock_gate_couples_to_l1_zero_exposure_veto():
    """即使个股本身多头趋势完美，若 L1 大盘处于空仓防守期 (0%)，买前闸门必须强制 VETO！"""
    df_bull = _make_trending_stock(n=260, trend=0.003)
    df_bench = _make_trending_stock(n=260, trend=0.0005)
    res_bear_mkt = evaluate_single_stock_gate(
        "688981", "中芯国际", df_bull, bench_hs300=df_bench,
        quote={"turnover_yi": 50.0, "turnover_rate": 3.5, "circ_cap_yi": 2000.0},
        flow={"main_flow_1d_yi": 3.0, "main_flow_5d_yi": 10.0},
        l1_target_pos=0.0,
    )
    assert "VETO" in res_bear_mkt["verdict"]
    assert res_bear_mkt["suggested_pos_pct"] == 0.0

    # 切换至大盘满仓多头期 (1.0) -> 闸门放行且单票上限 20%
    res_bull_mkt = evaluate_single_stock_gate(
        "688981", "中芯国际", df_bull, bench_hs300=df_bench,
        quote={"turnover_yi": 50.0, "turnover_rate": 3.5, "circ_cap_yi": 2000.0},
        flow={"main_flow_1d_yi": 3.0, "main_flow_5d_yi": 10.0},
        l1_target_pos=1.0,
    )
    assert res_bull_mkt["l1_cap_pct"] == 20.0
    assert res_bull_mkt["stop_loss"] < res_bull_mkt["price"]
    assert res_bull_mkt["rs20_hs300_pct"] is not None


def test_stock_gate_blocks_overextended_chase():
    """偏离 MA20 超过 +12% 的爆拉追高股必须触发 VETO 追高红灯！"""
    df_ext = _make_trending_stock(n=260, trend=0.002, surge_last=0.25)
    res = evaluate_single_stock_gate(
        "300750", "宁德时代", df_ext,
        quote={"turnover_yi": 80.0, "turnover_rate": 4.0, "circ_cap_yi": 8000.0},
        l1_target_pos=1.0,
    )
    assert "VETO" in res["verdict"]
    assert any("追高" in r for r in res["veto_reasons"])
