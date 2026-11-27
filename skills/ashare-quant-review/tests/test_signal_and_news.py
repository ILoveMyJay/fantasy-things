#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_signal_and_news.py - 三级红绿灯拐点信号引擎、大阳线中轨监测与实时新闻催化雷达单测
"""

import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from signal_engine import detect_anchor_bullish_candle, evaluate_traffic_light_signals
from fetch_news_catalyst import fetch_news_catalyst_dashboard


def _mock_klines_anchor_today():
    """构造今日为大阳线爆发日（类似 2026-11-27 科创50 +14%）"""
    return {
        "sh000001": [
            {"date": "2026-11-25", "open": 3520, "close": 3476.0, "high": 3526, "low": 3468, "volume": 100},
            {"date": "2026-11-26", "open": 3480, "close": 3477.0, "high": 3497, "low": 3455, "volume": 95},
            {"date": "2026-11-27", "open": 3500, "close": 3600.0, "high": 3610, "low": 3495, "volume": 160},
        ],
        "sh000688": [
            {"date": "2026-11-25", "open": 1220, "close": 1186.0, "high": 1225, "low": 1180, "volume": 100},
            {"date": "2026-11-26", "open": 1180, "close": 1170.0, "high": 1190, "low": 1160, "volume": 90},
            {"date": "2026-11-27", "open": 1200, "close": 1330.0, "high": 1340, "low": 1195, "volume": 180},
        ],
        "sz399006": [
            {"date": "2026-11-25", "open": 2250, "close": 2184.0, "high": 2260, "low": 2180, "volume": 100},
            {"date": "2026-11-26", "open": 2185, "close": 2190.0, "high": 2210, "low": 2170, "volume": 95},
            {"date": "2026-11-27", "open": 2220, "close": 2424.0, "high": 2430, "low": 2215, "volume": 170},
        ],
    }


def _mock_klines_pullback(k50_t1_close: float, sh_t1_close: float = 3560.0):
    """构造 T+1 回踩场景"""
    km = _mock_klines_anchor_today()
    km["sh000001"].append({"date": "2026-11-30", "open": 3590, "close": sh_t1_close, "high": 3605, "low": sh_t1_close - 10, "volume": 120})
    km["sh000688"].append({"date": "2026-11-30", "open": 1310, "close": k50_t1_close, "high": 1320, "low": k50_t1_close - 10, "volume": 130})
    km["sz399006"].append({"date": "2026-11-30", "open": 2400, "close": 2360.0, "high": 2410, "low": 2340, "volume": 125})
    return km


class TestSignalEngineAndNews(unittest.TestCase):
    """三级红绿灯与新闻催化单测"""

    def test_anchor_day_midpoint_math(self):
        """验证大阳线爆发日的中轨精确计算：(1170 + 1330)/2 = 1250.0"""
        anc = detect_anchor_bullish_candle(klines_map=_mock_klines_anchor_today())
        self.assertTrue(anc["has_anchor"])
        self.assertEqual(anc["anchor_date"], "2026-11-27")
        self.assertEqual(anc["status"], "anchor_day")
        self.assertEqual(anc["levels"]["000688"]["midpoint"], 1250.0)
        self.assertEqual(anc["levels"]["000001"]["midpoint"], 3538.5)

    def test_red_light_on_anchor_day_froth(self):
        """验证大阳线当日 TCR > 40% 亮红灯警戒，严禁追高"""
        anc = detect_anchor_bullish_candle(klines_map=_mock_klines_anchor_today())
        data = {
            "tech_volume": {"tcr_double_tech": 43.1, "volume_trend": "EXPANDING"},
            "market_sentiment": {"market_breadth": {"median_change_pct": 6.6}, "limit_structure": {"broken_board_rate": 15.0, "limit_down_count": 0}},
            "cffex": {"basis_table": {}, "citic_behavior": {"behavior_tag": "中性微调"}},
            "etf_flows": {"total_flow": 65.0},
            "leverage_margin": {"em_elasticity": {"em": 1.4, "index_pct_5d": -2.8}},
            "news_catalyst": {"tech_catalyst_active": True, "tech_catalyst_count": 3, "policy_catalyst_count": 1},
        }
        sig = evaluate_traffic_light_signals(data, anchor_info=anc)
        self.assertTrue(sig["red"]["active"])
        self.assertFalse(sig["blue"]["active"])
        self.assertIn("🔴", sig["primary_light"])
        self.assertTrue(sig["should_notify"])

    def test_blue_light_pullback_holding_midpoint(self):
        """验证 T+1 回踩守住大阳线中轨(1275 >= 1250) + TCR 降温至 35% -> 触发蓝灯买点"""
        anc = detect_anchor_bullish_candle(klines_map=_mock_klines_pullback(k50_t1_close=1275.0))
        self.assertEqual(anc["status"], "holding_above_midpoint")
        data = {
            "tech_volume": {"tcr_double_tech": 35.2, "volume_trend": "SHRINKING"},
            "market_sentiment": {"market_breadth": {"median_change_pct": -0.6}, "limit_structure": {"broken_board_rate": 24.0, "limit_down_count": 3}},
            "cffex": {"basis_table": {}, "citic_behavior": {"behavior_tag": "中性微调"}},
            "etf_flows": {"total_flow": 20.0},
            "leverage_margin": {"em_elasticity": {"em": 0.8, "index_pct_5d": 1.2}},
            "news_catalyst": {"tech_catalyst_active": False},
        }
        sig = evaluate_traffic_light_signals(data, anchor_info=anc)
        self.assertTrue(sig["blue"]["active"])
        self.assertFalse(sig["red"]["active"])
        self.assertIn("🔵", sig["primary_light"])
        self.assertTrue(sig["should_notify"])

    def test_red_light_when_midpoint_broken(self):
        """验证 T+1 跌破大阳线中轨(1210 < 1250) -> 触发红灯突破失败警示"""
        anc = detect_anchor_bullish_candle(klines_map=_mock_klines_pullback(k50_t1_close=1210.0, sh_t1_close=3510.0))
        self.assertEqual(anc["status"], "broken_below_midpoint")
        data = {
            "tech_volume": {"tcr_double_tech": 34.0, "volume_trend": "SHRINKING"},
            "market_sentiment": {"market_breadth": {"median_change_pct": -2.1}, "limit_structure": {"broken_board_rate": 28.0, "limit_down_count": 5}},
            "cffex": {"basis_table": {}, "citic_behavior": {"behavior_tag": "中性微调"}},
            "etf_flows": {"total_flow": -10.0},
            "leverage_margin": {"em_elasticity": {"em": 0.4, "index_pct_5d": -1.5}},
            "news_catalyst": {"tech_catalyst_active": False},
        }
        sig = evaluate_traffic_light_signals(data, anchor_info=anc)
        self.assertTrue(sig["red"]["active"])
        self.assertFalse(sig["blue"]["active"])
        self.assertIn("🔴", sig["primary_light"])

    def test_green_light_bottom_confluence(self):
        """验证 11月26日经典左侧底部共振：ETF净申购+两融Em>1.2+期指贴水+科技逆势吸筹+政策催化 -> 亮绿灯"""
        no_anchor = {"has_anchor": False, "anchor_date": None, "days_since_anchor": None, "status": "no_recent_anchor", "status_note": "无", "levels": {}}
        data = {
            "tech_volume": {"tcr_double_tech": 35.0, "volume_trend": "SHRINKING"},
            "sector_rotation": {"top_inflow": [{"name": "电子器件", "net_inflow_yi": 38.0}]},
            "market_sentiment": {"market_breadth": {"median_change_pct": -0.79}, "limit_structure": {"broken_board_rate": 29.0, "limit_down_count": 5}},
            "cffex": {"basis_table": {"IC": {"annualized_discount_rate": -21.5}, "IM": {"annualized_discount_rate": -20.8}}, "citic_behavior": {"behavior_tag": "中性微调"}},
            "etf_flows": {"total_flow": 307.0},
            "leverage_margin": {"em_elasticity": {"em": 1.40, "index_pct_5d": -2.82}},
            "news_catalyst": {"tech_catalyst_active": True, "tech_catalyst_count": 2, "policy_catalyst_count": 1},
        }
        sig = evaluate_traffic_light_signals(data, anchor_info=no_anchor)
        self.assertTrue(sig["green"]["active"])
        self.assertEqual(sig["green"]["hits"], 5)
        self.assertIn("🟢", sig["primary_light"])
        self.assertTrue(sig["should_notify"])

    def test_news_catalyst_classification_and_noise_filter(self):
        """验证新闻催化引擎能过滤盘面机械播报并精准识别国产算力利好"""
        mock_news = [
            {"time": "2026-11-27 11:45:00", "source": "新浪7x24", "title": "11月27日午间涨停分析", "summary": "某股封板涨停", "url": "https://a", "is_important": True},
            {"time": "2026-11-26 16:30:00", "source": "东财7x24", "title": "广东印发算力发展十五五规划：鼓励优先使用国产算力芯片", "summary": "加速国产替代与大模型生态", "url": "https://b", "is_important": True},
            {"time": "2026-11-26 14:20:00", "source": "新浪7x24", "title": "华为 HBM 五层混合键合芯片论文获国际顶会录用突破", "summary": "先进封装技术取得重要突破", "url": "https://c", "is_important": False},
        ]
        res = fetch_news_catalyst_dashboard(injected_items=mock_news)
        self.assertEqual(res["relevant_count"], 2)  # 午间涨停分析被去噪过滤
        self.assertTrue(res["tech_catalyst_active"])
        self.assertEqual(res["tech_catalyst_count"], 2)


if __name__ == "__main__":
    unittest.main()
