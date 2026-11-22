#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_etf_alignment.py - 沪深交易所清算对齐规则与折算熔断单测
涵盖:
- TC-REC-01: 华泰柏瑞 300ETF (510300) 日度净申赎对账复算
- TC-REC-02: 深市核心 ETF (159915) 时滞对齐与次晨披露守卫 (未披露返回 None)
- TC-FLT-05: 机械拆细折算异常熔断安全网
"""

import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from fetch_etf_flows import calculate_etf_daily_flow, estimate_flow


class TestEtfAlignment(unittest.TestCase):
    """沪深对齐与申赎算法单测"""

    def test_tc_rec_01_huatai_300_reconciliation(self):
        """TC-REC-01: 华泰柏瑞 300ETF (510300.SH) 净申赎复算与公差校验"""
        # 沪市规则：T 日份额 - T-1 日份额
        calendar = ["2026-11-17", "2026-11-18"]
        # 模拟 2026-11-18: T-1日 950亿份, T日 953.8亿份, NAV 4.0585
        # Δ份额 = +3.8亿份, 净申购 = 3.8 * 4.0585 = +15.4223 亿元
        shares_map = {
            "2026-11-17": 95000000000,
            "2026-11-18": 95380000000,
        }
        navs_map = {
            "2026-11-17": 4.0512,
            "2026-11-18": 4.0585,
        }

        res = calculate_etf_daily_flow(
            symbol="510300.SH",
            target_date="2026-11-18",
            shares_map=shares_map,
            navs_map=navs_map,
            calendar=calendar
        )
        self.assertIsNotNone(res["flow"])
        # 验证金额在 15.42 附近，相对误差 < 0.1%
        self.assertAlmostEqual(res["flow"], 15.4223, delta=0.01)

    def test_tc_rec_02_szse_disclosure_guard(self):
        """TC-REC-02: 深市 159915 次晨登记时滞守卫"""
        calendar = ["2026-11-17", "2026-11-18", "2026-11-19"]

        # 场景 A: 已披露 T+1 (2026-11-19晨间) 数据
        shares_with_t1 = {
            "2026-11-18": 30000000000,
            "2026-11-19": 30200000000,
        }
        navs = {"2026-11-18": 2.1500}
        res_a = calculate_etf_daily_flow(
            symbol="159915.SZ",
            target_date="2026-11-18",
            shares_map=shares_with_t1,
            navs_map=navs,
            calendar=calendar
        )
        self.assertIsNotNone(res_a["flow"])
        self.assertAlmostEqual(res_a["flow"], 4.3000, delta=0.01)

        # 场景 B: T+1 尚未发生或未披露 (例如在 2026-11-18 当晚复盘时)
        shares_without_t1 = {
            "2026-11-17": 29800000000,
            "2026-11-18": 30000000000,
        }
        res_b = calculate_etf_daily_flow(
            symbol="159915.SZ",
            target_date="2026-11-18",
            shares_map=shares_without_t1,
            navs_map=navs,
            calendar=["2026-11-17", "2026-11-18"]  # 日历到 T 日截止，无 T+1
        )
        # 必须且只能返回 None，绝不可提前填 0 或填前值
        self.assertIsNone(res_b["flow"])
        self.assertEqual(res_b["issue"], "pending_t_plus_1_disclosure")

    def test_tc_flt_05_split_consolidation_circuit_break(self):
        """TC-FLT-05: 机械拆细折算异常熔断安全网"""
        # 构造某 ETF 发生 1 拆 2 场景:
        # S_prev = 100 亿份, NAV_prev = 2.00 元
        # S_curr = 200 亿份, NAV_curr = 1.00 元
        # sr = 2.0, nr = 0.5, sr*nr = 1.0 -> 触发熔断
        flow = estimate_flow(
            current_share=20000000000,
            prev_share=10000000000,
            nav=1.0000,
            prev_nav=2.0000,
            split_ratio=1.0
        )
        # 必须返回 None，绝不可误报 +100 亿元虚假净申购！
        self.assertIsNone(flow)


if __name__ == "__main__":
    unittest.main()
