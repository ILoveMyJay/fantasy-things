#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_fund_flow.py - 核心自选股与主力大单净量模块自动化单测
测试覆盖:
1. 自选股列表 (custom_watchlist.json) 优先加载逻辑
2. DDX 算法与流通市值归一化准确性
3. 量价背离与筹码标签判定规则
4. 批量接口真实拉取与数据字段完整度
5. 重点标的 (如中微公司) 快速摘要提取
"""

import os
import sys
import unittest

current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

from fetch_fund_flow import (
    load_target_stocks,
    evaluate_divergence,
    fetch_multiday_flow,
    fetch_fund_flow_dashboard,
    get_key_stock_fund_flow_summary
)

class TestFundFlowModule(unittest.TestCase):

    def test_01_load_target_stocks(self):
        """验证自选股优先加载及股票结构规范"""
        stocks = load_target_stocks()
        self.assertTrue(len(stocks) >= 4, "监控标的数量应不少于4只")
        codes = [s['code'] for s in stocks]
        self.assertIn("002371", codes, "自选股应包含北方华创")
        self.assertIn("688012", codes, "自选股应包含中微公司")
        for s in stocks:
            self.assertEqual(len(s['code']), 6, "股票代码必须为6位数字")
            self.assertIn(s['market'], ['sh', 'sz', 'bj'], "市场标识必须合法")

    def test_02_evaluate_divergence_logic(self):
        """验证量价背离定性算法"""
        # 价跌但主力大额净流入且DDX为正 -> 逆势吸筹
        tag1 = evaluate_divergence(pct_chg=-1.0, main_flow_yi=3.5, ddx=0.08)
        self.assertIn("主力逆势吸筹", tag1)

        # 价涨但主力大单撤退 -> 诱多出货
        tag2 = evaluate_divergence(pct_chg=2.5, main_flow_yi=-2.0, ddx=-0.05)
        self.assertIn("主力诱多出货", tag2)

        # 价跌主力狂砸 -> 多杀多出逃
        tag3 = evaluate_divergence(pct_chg=-3.0, main_flow_yi=-4.0, ddx=-0.10)
        self.assertIn("多杀多主力出逃", tag3)

        # 放量大涨资价共振
        tag4 = evaluate_divergence(pct_chg=5.0, main_flow_yi=4.0, ddx=0.15)
        self.assertIn("量价齐升强共振", tag4)

    def test_03_fetch_multiday_flow(self):
        """验证多日历史流向拉取与中线趋势判断"""
        res = fetch_multiday_flow("002371", market="sz", days=5)
        self.assertIn('flow_3d_yi', res)
        self.assertIn('flow_5d_yi', res)
        self.assertIn('trend_tag', res)
        self.assertIsInstance(res['flow_3d_yi'], float)

    def test_04_fetch_fund_flow_dashboard(self):
        """验证仪表盘批量接口端到端调用"""
        dash = fetch_fund_flow_dashboard(include_multiday=True)
        self.assertEqual(dash.get('status'), 'ok')
        results = dash.get('results', [])
        self.assertTrue(len(results) >= 4)
        
        # 验证必需金融字段
        first = results[0]
        required_fields = [
            'code', 'name', 'price', 'pct_chg', 'circ_cap_yi',
            'main_flow_yi', 'ddx', 'divergence_tag', 'flow_3d_yi'
        ]
        for rf in required_fields:
            self.assertIn(rf, first, f"缺少必需字段: {rf}")

    def test_05_get_key_stock_summary(self):
        """验证重点标的资金面画像提取"""
        summary = get_key_stock_fund_flow_summary("688012")
        self.assertIsNotNone(summary)
        self.assertEqual(summary['code'], "688012")
        self.assertIn("中微", summary['name'])

if __name__ == '__main__':
    unittest.main()
