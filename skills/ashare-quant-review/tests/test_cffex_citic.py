#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_cffex_citic.py - 中信席位精确匹配与行为判别器回放单测
涵盖:
- TC-REC-04: 中金所中信期货（代客）席位精确匹配核验（排除中信建投）
- TC-CIT-01: 现货放量大涨 + 净空激增回放（被动套保 / 加法）
- TC-CIT-02: 现货破位大跌 + 净空狂增 + 贴水加深回放（主动做空动能 / 减法）
- TC-CIT-03: 止跌大涨 + 净空单大幅撤退回放（空头回补 / 中性对冲）
- TC-CIT-04: 现货下跌 + 净空跟随缩减回放（被动减仓 / 减法-被动）
- TC-CIT-05: 存量极度缩量环境下的降权与低置信度（低量无序震荡 / LOW）
"""

import sys
import unittest
from pathlib import Path

# 保证导入被测模块
SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from fetch_cffex import discriminate_citic_behavior, fetch_citic_positions


class TestCiticClassifier(unittest.TestCase):
    """中信席位行为判别器确定性回放单测"""

    def test_tc_cit_01_passive_hedging(self):
        """TC-CIT-01: 现货放量大涨 + 净空激增 -> 被动套保 (机构做加法)"""
        res = discriminate_citic_behavior(
            citic_net_short_chg=4850,
            spot_chg_pct=2.4,
            market_turnover_delta_pct=18.5,
            basis_delta_pct=0.1
        )
        self.assertEqual(res["behavior_tag"], "被动套保")
        self.assertEqual(res["macro_verdict"], "加法（净风险敞口在增）")
        self.assertEqual(res["confidence"], "HIGH")
        # 严禁出现看空定性
        self.assertNotIn("空头砸盘", res["evidence_line"])
        self.assertNotIn("大举看空", res["evidence_line"])

    def test_tc_cit_02_directional_shorting(self):
        """TC-CIT-02: 现货破位大跌 + 净空激增 + 贴水加深 -> 主动做空动能 (机构做减法)"""
        res = discriminate_citic_behavior(
            citic_net_short_chg=5200,
            spot_chg_pct=-2.1,
            market_turnover_delta_pct=6.2,
            basis_delta_pct=-0.65
        )
        self.assertEqual(res["behavior_tag"], "主动做空动能")
        self.assertEqual(res["macro_verdict"], "减法（净风险敞口在减）")
        self.assertEqual(res["confidence"], "HIGH")

    def test_tc_cit_03_short_covering(self):
        """TC-CIT-03: 止跌大涨 + 净空单大幅撤退 -> 空头回补 (中性对冲修复)"""
        res = discriminate_citic_behavior(
            citic_net_short_chg=-4300,
            spot_chg_pct=1.8,
            market_turnover_delta_pct=8.0,
            basis_delta_pct=0.0
        )
        self.assertEqual(res["behavior_tag"], "空头回补")
        self.assertEqual(res["macro_verdict"], "中性对冲（阶段修复）")
        self.assertEqual(res["confidence"], "HIGH")

    def test_tc_cit_04_passive_unwinding(self):
        """TC-CIT-04: 现货下跌 + 净空跟随缩减 -> 被动减仓 (连带出清)"""
        res = discriminate_citic_behavior(
            citic_net_short_chg=-3800,
            spot_chg_pct=-1.2,
            market_turnover_delta_pct=-1.5,
            basis_delta_pct=0.0
        )
        self.assertEqual(res["behavior_tag"], "被动减仓")
        self.assertEqual(res["macro_verdict"], "减法（被动撤退，杀伤力低于主动做空）")

    def test_tc_cit_05_volume_drop_filter(self):
        """TC-CIT-05: 存量极度缩量 -> 低量无序震荡 (置信度强制 LOW)"""
        res = discriminate_citic_behavior(
            citic_net_short_chg=850,
            spot_chg_pct=0.15,
            market_turnover_delta_pct=-16.2,
            basis_delta_pct=0.0
        )
        self.assertEqual(res["behavior_tag"], "低量无序震荡")
        self.assertEqual(res["macro_verdict"], "中性对冲（敞口基本不变）")
        self.assertEqual(res["confidence"], "LOW")


class TestCiticPositionMatching(unittest.TestCase):
    """TC-REC-04: 中信期货（代客）精确匹配核验"""

    def test_tc_rec_04_exact_match_exclude_jiantou(self):
        """验证严格精确匹配'中信期货（代客）'，彻底排除'中信建投'"""
        mock_rows = [
            {"long_party_name": "中信期货(代客)", "long_volume": 12500, "long_chg": 500},
            {"long_party_name": "中信建投期货", "long_volume": 8000, "long_chg": 200},
            {"long_party_name": "国泰君安", "long_volume": 15000, "long_chg": 300},
            {"short_party_name": "中信期货(代客)", "short_volume": 21000, "short_chg": 1200},
            {"short_party_name": "中信建投期货", "short_volume": 7500, "short_chg": 100},
        ]
        res = fetch_citic_positions(positions_data=mock_rows)
        # 必须仅包含中信期货（代客）的数据：多单 12500, 空单 21000, 净空 8500
        self.assertEqual(res["long_volume"], 12500)
        self.assertEqual(res["short_volume"], 21000)
        self.assertEqual(res["net_short"], 8500)
        self.assertEqual(res["net_short_chg"], 700) # 1200 - 500


if __name__ == "__main__":
    unittest.main()
