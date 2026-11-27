#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_formulas.py - Compass v2 核心公式、博主实盘案例交叉验算与趋势锚定四态仲裁单元测试
"""

import datetime
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from calc_tech_timing import compute_tech_indicators
from db_store import fetch_ledger_recent, get_conn
from decision_engine import arbitrate_four_state, arbitrate_v2, evaluate_decision
from fetch_breadth_trin import classify_breadth_scenario, compute_breadth_metrics, compute_mcl_series
from fetch_derivatives import evaluate_pcr_resonance, get_front_contract_info
from fetch_midterm_regime import compute_etf_weighted_accumulation_index
from run_compass import render_markdown_report


class TestBruceIndicatorsV2(unittest.TestCase):
    def test_bruce_case_2026_11_13_morning_excel(self):
        """验算 2026-11-13 10:10 实盘表：涨家39.34%, 涨额65.43% -> 额价差+26.09pp, TRIN额=0.34, 抱团护盘"""
        n_up, n_down = 3934, 6066
        up_amt_each = 65.43 / n_up * 1e8
        dn_amt_each = 34.57 / n_down * 1e8
        df = pd.DataFrame(
            {
                "code": [f"60{i:04d}" for i in range(n_up + n_down)],
                "name": ["TEST"] * (n_up + n_down),
                "pct_chg": [1.0] * n_up + [-1.0] * n_down,
                "amount": [up_amt_each] * n_up + [dn_amt_each] * n_down,
                "volume": [1000.0] * (n_up + n_down),
                "turnover_rate": [3.0] * (n_up + n_down),
            }
        )
        m = compute_breadth_metrics(df)
        self.assertAlmostEqual(m["adv_ratio"], 39.34, places=2)
        self.assertAlmostEqual(m["adv_amt_ratio"], 65.43, places=2)
        self.assertAlmostEqual(m["amt_breadth_spread"], 26.09, places=2)
        self.assertAlmostEqual(m["trin_amount"], 0.343, places=2)
        self.assertAlmostEqual(m["avg_amt_ratio"], 2.92, places=1)
        self.assertEqual(m["scenario_code"], "WEIGHT_PROPPING")

    def test_bruce_case_2026_09_21_top_divergence(self):
        """验算 2026-09-21 见顶背离：涨跌家数比 4.6:1 (82.1%红), 涨跌额比 2.72:1 -> TRIN额=1.69, 高位量价背离"""
        n_up, n_down = 4600, 1000
        df = pd.DataFrame(
            {
                "code": [f"60{i:04d}" for i in range(n_up + n_down)],
                "name": ["TEST"] * (n_up + n_down),
                "pct_chg": [1.5] * n_up + [-1.5] * n_down,
                "amount": [2.72 / n_up * 1e11] * n_up + [1.0 / n_down * 1e11] * n_down,
                "volume": [1000.0] * (n_up + n_down),
                "turnover_rate": [6.0] * (n_up + n_down),
            }
        )
        m = compute_breadth_metrics(df)
        self.assertAlmostEqual(m["trin_amount"], 1.691, places=2)
        self.assertEqual(m["scenario_code"], "TOP_DIVERGENCE")
        self.assertAlmostEqual(m["high_turnover_ratio"], 100.0, places=1)

    def test_bruce_case_2026_11_20_close_cli(self):
        """验算 2026-11-20 15:00 命令行画面：涨302/跌5237/平33, 涨额17.93% -> TRIN额=0.264"""
        n_up, n_down, n_flat = 302, 5237, 33
        df = pd.DataFrame(
            {
                "code": [f"00{i:04d}" for i in range(n_up + n_down + n_flat)],
                "name": ["TEST"] * (n_up + n_down + n_flat),
                "pct_chg": [1.0] * n_up + [-1.0] * n_down + [0.0] * n_flat,
                "amount": [17.93 / n_up * 1e9] * n_up + [81.9 / n_down * 1e9] * n_down + [0.17 / n_flat * 1e9] * n_flat,
                "volume": [21.11 / n_up * 1e7] * n_up + [78.7 / n_down * 1e7] * n_down + [0.19 / n_flat * 1e7] * n_flat,
                "turnover_rate": [2.0] * (n_up + n_down + n_flat),
            }
        )
        m = compute_breadth_metrics(df)
        self.assertAlmostEqual(m["adv_ratio"], 5.42, places=1)
        self.assertAlmostEqual(m["trin_amount"], 0.264, places=2)
        self.assertEqual(m["scenario_code"], "EXTREME_WEIGHT_OR_ICE")

    def test_fake_rebound_classification(self):
        """验算 10-23 / 11-04 假反弹：宽广度80% + TRIN额0.90 -> FAKE_REBOUND_SHORT_COVER"""
        code, _ = classify_breadth_scenario(80.0, 0.90, -2.0)
        self.assertEqual(code, "FAKE_REBOUND_SHORT_COVER")

    def test_mcl_series(self):
        hist = [{"up_count": 3500, "down_count": 1500} for _ in range(45)]
        res = compute_mcl_series(hist)
        self.assertTrue(res["mcl_stable"])
        self.assertIsNotNone(res["mcl"])
        self.assertAlmostEqual(res["adr_10"], 3500 / 1500, places=2)

    def test_etf_weighted_accumulation_bounds(self):
        s_in = pd.Series([1.0] * 20 + [5.0, 12.0, 25.0, 45.0, 80.0, 120.0])
        res_in = compute_etf_weighted_accumulation_index(s_in)
        self.assertGreaterEqual(res_in["index_value"], 70.0)
        self.assertEqual(res_in["signal"], "BULL")

        s_out = pd.Series([1.0] * 20 + [-10.0, -25.0, -50.0, -90.0, -130.0])
        res_out = compute_etf_weighted_accumulation_index(s_out)
        self.assertLessEqual(res_out["index_value"], 30.0)
        self.assertEqual(res_out["signal"], "BEAR")

    def test_cffex_5day_roll(self):
        """验算交割前 <=5 天自动提前滚仓次月合约"""
        # 2026-11 第三个周五是 2026-11-20；2026-11-16 距交割 4 天应自动滚至 2612
        suf, exp_s, days = get_front_contract_info(datetime.datetime(2026, 11, 16), roll_days=5)
        self.assertEqual(suf, "2612")
        self.assertGreater(days, 25)
        # 2026-11-10 距交割 10 天应仍用 2611
        suf2, _, days2 = get_front_contract_info(datetime.datetime(2026, 11, 10), roll_days=5)
        self.assertEqual(suf2, "2611")
        self.assertEqual(days2, 10)

    def test_pcr_50_300_divergence_trap(self):
        """验算布鲁斯 9-30 铁律：300 PCR 击穿下轨而 50 PCR 未破 -> BEAR_DIVERGENCE"""
        p50 = pd.Series([80.0] * 20 + [82.0, 81.0, 83.0, 80.0, 81.0])
        p300 = pd.Series([90.0] * 20 + [85.0, 75.0, 65.0, 55.0, 45.0])
        pall = pd.Series([85.0] * 25)
        res = evaluate_pcr_resonance(p50, p300, pall, span=3)
        self.assertEqual(res["signal"], "BEAR_DIVERGENCE")

    def test_tech_indicators_and_v2_arbitration(self):
        n = 100
        prices = np.linspace(4000, 3400, n)
        df = pd.DataFrame(
            {
                "date": [f"2026-01-{i%28+1:02d}" for i in range(n)],
                "open": prices + 5,
                "high": prices + 15,
                "low": prices - 15,
                "close": prices,
                "volume": np.linspace(1e8, 2e8, n),
                "amount": np.linspace(1e11, 2e11, n),
            }
        )
        ti = compute_tech_indicators(df)
        self.assertEqual(ti["ichimoku"]["position"], "BELOW_CLOUD")
        self.assertEqual(ti["vw_macd"]["state"], "BEAR_BELOW_ZERO")
        self.assertEqual(ti["signal"], "空")

        # v2 趋势锚定对称四态校验
        self.assertEqual(arbitrate_v2("多", "多", 0.0)[0], "多")
        self.assertEqual(arbitrate_v2("多", "空", 0.0)[0], "准备空")
        self.assertEqual(arbitrate_v2("多", "空", -40.0)[0], "空")
        self.assertEqual(arbitrate_v2("空", "空", 0.0)[0], "空")
        self.assertEqual(arbitrate_v2("空", "多", 0.0)[0], "准备多")
        self.assertEqual(arbitrate_v2("空", "多", 35.0)[0], "多")
        self.assertEqual(arbitrate_v2("中性", "中性", 0.0)[0], "观望(中性)")

        # 兼容旧函数
        self.assertEqual(arbitrate_four_state("空", "多")[0], "准备空")

    def test_v2_conditional_etf_and_zero_hallucination(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "test.sqlite"
            # 1. 全缺失零造假检查（v2 应包含 6 个核心缺失项，不再含高管/等权PE/HSCEI）
            dec = evaluate_decision(
                breadth={"status": "ERROR", "error": "timeout"},
                midterm={"erp": {"status": "ERROR"}, "etf_19_accumulation": {"status": "ERROR"}, "macro_rates": {}},
                derivatives={"cffex_basis": {"status": "ERROR"}, "option_pcr": {"status": "ERROR"}},
                tech={"status": "ERROR"},
                save_ledger=True,
                db_path=db_path,
            )
            self.assertEqual(len(dec["missing_items"]), 6)
            self.assertNotIn("高管股东增减持", dec["missing_items"])
            self.assertNotIn("全A等权PE", dec["missing_items"])
            self.assertNotIn("恒生国企先行速率", dec["missing_items"])
            self.assertEqual(dec["final_state"], "观望(中性)")
            conn = get_conn(db_path)
            rows = fetch_ledger_recent(conn, limit=5)
            conn.close()
            self.assertEqual(len(rows), 1)

            # 2. 条件宽基 ETF 加分器验证：周空但日多 + ETF>=70 + ERP>=1.5 -> 确认分>=30 -> 共振转多
            dec2 = evaluate_decision(
                breadth={"status": "OK", "trade_date": "2026-11-27", "scenario_code": "HEALTHY_BULL_ATTACK", "mcl": 50.0},
                midterm={
                    "erp": {"status": "OK", "zscore": 1.6, "signal": "BULL", "note": "deep value"},
                    "etf_19_accumulation": {"status": "OK", "index_value": 80.0, "signal": "BULL", "note": "accum"},
                    "macro_rates": {},
                },
                derivatives={
                    "cffex_basis": {"status": "OK", "signal": "NEUTRAL", "note": "neutral", "basis_table": {"IF": {"annualized_discount_pct": -3.0}}},
                    "option_pcr": {"status": "OK", "signal": "NEUTRAL", "note": "neutral", "pcr_50_ema5": 70.0, "pcr_300_ema5": 70.0},
                },
                tech={"status": "OK", "weekly_signal": "空", "daily_signal": "多", "tech_signal": "多(周空日多反弹)"},
                save_ledger=False,
            )
            # ERP(1.5*1.0) + ETF(1.0*1.0) = 2.5 / 5.0 = +50.0 >= 30.0 -> 多
            self.assertEqual(dec2["confirm_score"], 50.0)
            self.assertEqual(dec2["final_state"], "多")

    def test_render_report_includes_tech_style_and_excludes_removed(self):
        """确认 v2 报告包含双创科技风格子面板且彻底不含高管增减持/全A等权PE/HSCEI"""
        sample_tf = {
            "close": 2200.0,
            "ichimoku": {"position": "ABOVE_CLOUD", "failed_cloud_breakouts_30": 0},
            "vw_macd": {"state": "BULL_ABOVE_ZERO", "dif": 12.0, "dea": 8.0},
            "bollinger": {"position": "中轨偏上", "pct_b": 0.72},
            "cci": {"value": 85.0, "divergence": "NONE"},
            "signal": "多",
            "score": 2.5,
        }
        payload = {
            "decision": {
                "trade_date": "2026-11-27",
                "created_at": "2026-11-27 17:30:00",
                "fund_signal": "中性",
                "fund_score": 0.0,
                "tech_signal": "多",
                "tech_weekly": "多",
                "tech_daily": "多",
                "final_state": "多",
                "action_guidance": "ok",
                "notes": "ok",
                "votes": [],
                "missing_items": [],
            },
            "breadth": {"status": "ERROR", "error": "skip"},
            "midterm": {"erp": {"status": "ERROR"}, "etf_19_accumulation": {"status": "ERROR"}, "macro_rates": {}},
            "derivatives": {"cffex_basis": {"status": "ERROR"}, "option_pcr": {"status": "ERROR"}},
            "tech": {
                "status": "OK",
                "indices": {
                    "SH000001": {"name": "上证指数", "weekly": sample_tf, "daily": sample_tf},
                    "SH000300": {"name": "沪深300", "weekly": sample_tf, "daily": sample_tf},
                },
                "tech_style_indices": {
                    "SZ399006": {"name": "创业板指", "weekly": sample_tf, "daily": sample_tf},
                    "SH000688": {"name": "科创50", "weekly": sample_tf, "daily": sample_tf},
                },
                "tech_style_weekly": "多",
                "tech_style_daily": "多",
                "tech_style_note": "日线强弱持平",
            },
        }
        md = render_markdown_report(payload)
        self.assertIn("双创科技风格子面板", md)
        self.assertIn("创业板指", md)
        self.assertIn("科创50", md)
        self.assertNotIn("高管", md)
        self.assertNotIn("等权 PE", md)
        self.assertNotIn("HSCEI", md)


if __name__ == "__main__":
    unittest.main(verbosity=2)
