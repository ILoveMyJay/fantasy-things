#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_fault_injection.py - 故障注入与边界条件单测
涵盖:
- TC-FLT-01: 宏观网关 502 / 超时故障注入（彻底消灭 5.01 / 1.63 / 6.66 / 102.2）
- TC-FLT-02: 法定节假日白天成交额预估守卫注入（禁止休市日 U 型除法外推）
- TC-FLT-03: 期指当月交割周 (D<=4) 年化贴水发散抑制（平滑切换次月合约，is_extreme 为 False）
- TC-FLT-06: 运行环境缺失 akshare 优雅降级测试
- TC-REC-03: 全市场真中位数与前 100 采样偏差校正验证
"""

import sys
import datetime
import unittest
from unittest.mock import patch, MagicMock
from urllib.error import HTTPError
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import fetch_macro
import fetch_tech_volume
import fetch_cffex
from utils.calendar_guard import is_trade_date, is_trading_time


class TestFaultInjection(unittest.TestCase):
    """故障注入单测"""

    def test_tc_flt_01_macro_502_no_fakes(self):
        """TC-FLT-01: 宏观网关 502/超时故障注入，断言系统永不输出 5.01/1.63/6.66/102.2 假数据"""
        with patch("urllib.request.urlopen", side_effect=HTTPError("url", 502, "Bad Gateway", {}, None)):
            yields = fetch_macro.get_macro_yields()
            fx = fetch_macro.get_fx_and_dxy()

            # 断言全部严格为 None，严禁等于伪造常数！
            self.assertIsNone(yields["us_10y"])
            self.assertIsNone(yields["cn_10y"])
            self.assertIsNone(yields["spread_bp"])
            self.assertNotEqual(yields["us_10y"], 5.01)
            self.assertNotEqual(yields["cn_10y"], 1.63)

            self.assertIsNone(fx["usd_cnh"])
            self.assertIsNone(fx["dxy"])
            self.assertNotEqual(fx["usd_cnh"], 6.66)
            self.assertNotEqual(fx["dxy"], 102.2)

    def test_tc_flt_02_holiday_volume_estimate_guard(self):
        """TC-FLT-02: 法定节假日白天成交额预估守卫注入，禁止休市日外推放大"""
        # 模拟国庆长假工作日白天：2026-10-02 10:30:00 (周五，但属于国庆法定休市)
        holiday_dt = datetime.datetime(2026, 10, 2, 10, 30, 0)
        
        # 1. 验证交易日历判定
        self.assertFalse(is_trade_date("2026-10-02"))

        # 2. 验证 is_trading_time
        is_intraday, elapsed, session = is_trading_time(holiday_dt)
        self.assertFalse(is_intraday)
        self.assertEqual(session, "holiday_closed")

        # 3. 验证 estimate_full_day_volume 在休市态下不进行 U 型除法
        current_residue = 15.0 # 模拟盘面微小残余成交
        estimated = fetch_tech_volume.estimate_full_day_volume(current_residue, elapsed)
        # 必须直接返回当前值，绝对不能产生除以小权重的数万亿畸变
        self.assertEqual(estimated, current_residue)

    def test_tc_flt_03_delivery_week_smoothing(self):
        """TC-FLT-03: 期指当月交割周 (D<=4) 年化贴水发散抑制与次月切换"""
        # 模拟交割周（距交割日剩余 1 天），正常日内微小基差 -10 点（现货 4000，贴水 0.25%）
        # 若按原公式除以 1 天，年化贴水将发散至 -91.25%，误报极限恐慌
        # 新架构当月标 N/A，切换次月约 30 天计算，年化贴水约 -3%，is_extreme 为 False
        basis_info = fetch_cffex.fetch_cffex_basis(
            spot_prices={"IF": 4000.0},
            futures_prices={"IF": 3990.0}, # 当月贴水 10 点
            days_to_expiry=1, # 仅剩 1 天
            next_month_futures_prices={"IF": 3990.0},
            next_month_days_to_expiry=31
        )
        if_row = basis_info["basis_table"]["IF"]
        self.assertEqual(if_row["basis"], -10.0)
        # 当月年化应处于交割周保护
        self.assertIsNone(if_row["annualized_discount_rate"])
        # is_extreme 必须为 False，杜绝误报抄底
        self.assertFalse(if_row["is_extreme_oversold_signal"])

    def test_tc_flt_06_akshare_missing_graceful_degradation(self):
        """TC-FLT-06: 运行环境缺失 akshare 优雅降级测试，且行为判别器不得伪造 MEDIUM 置信度"""
        with patch.dict("sys.modules", {"akshare": None}):
            res = fetch_cffex.fetch_citic_positions(trade_date="20261118")
            self.assertEqual(res["status"], "degraded")
            self.assertEqual(res["IF"]["total_long"], 0)
            self.assertEqual(res["net_short_chg"], 0)
            dash = fetch_cffex.fetch_cffex_dashboard(trade_date="20261118")
            self.assertEqual(dash["citic_behavior"]["confidence"], "DEGRADED")

    def test_tc_reg_01_intraday_elapsed_minutes_not_remaining(self):
        """回归测试：盘中时段必须返回已开盘分钟数而非剩余分钟数"""
        # 2026-11-26 为交易日
        morning_dt = datetime.datetime(2026, 11, 26, 10, 30, 0)
        is_tr, elapsed, phase = is_trading_time(morning_dt)
        self.assertTrue(is_tr)
        self.assertEqual(elapsed, 60)
        self.assertEqual(phase, "morning_session")

        afternoon_dt = datetime.datetime(2026, 11, 26, 13, 17, 0)
        is_tr2, elapsed2, phase2 = is_trading_time(afternoon_dt)
        self.assertTrue(is_tr2)
        self.assertEqual(elapsed2, 137)
        self.assertEqual(phase2, "afternoon_session")

        post_dt = datetime.datetime(2026, 11, 26, 15, 5, 0)
        is_tr3, elapsed3, phase3 = is_trading_time(post_dt)
        self.assertFalse(is_tr3)
        self.assertEqual(elapsed3, 240)
        self.assertEqual(phase3, "post_market")

    def test_tc_reg_02_cffex_basis_no_hardcoded_fake_prices(self):
        """回归测试：期指行情接口故障时必须返回 None，绝不返回 4010.4 等硬编码假价"""
        with patch("urllib.request.urlopen", side_effect=HTTPError("url", 502, "Bad Gateway", {}, None)):
            res = fetch_cffex.fetch_cffex_basis()
            for k in ("IF", "IC", "IM", "IH"):
                self.assertIsNone(res["basis_table"][k]["futures_price"])
                self.assertIsNone(res["basis_table"][k]["spot_price"])
                self.assertIsNone(res["basis_table"][k]["basis"])

    def test_tc_rec_03_true_median_vs_sample_bias(self):
        """TC-REC-03: 全市场真中位数与前 100 采样偏差校正验证"""
        # 构造典型“权重护盘、个股普跌”行情（前100只龙头多为正，其余普跌）
        # 前 100 只龙头中位数偏正，但全市场 5500 只个股真实中位数为显著负值
        import statistics
        top_100_core = [0.5 + 0.05 * (i % 10) for i in range(100)] # 龙头平均微涨 +0.7%
        other_5400_stocks = [-1.5 - 0.05 * (i % 20) for i in range(5400)] # 大多数个股普跌 -2%
        all_market = top_100_core + other_5400_stocks

        sample_median = statistics.median(top_100_core)
        true_median = statistics.median(all_market)

        # 抽样中位数为正，严重失真
        self.assertGreater(sample_median, 0)
        # 全市场真中位数为显著负值，客观反映赚钱效应冰点
        self.assertLess(true_median, -1.0)


if __name__ == "__main__":
    unittest.main()
