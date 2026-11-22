#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_ddx_firewall.py - DDX 安全防火墙拦截单测
涵盖:
- TC-FLT-04: DDX 防火墙强校验（个股允许，宽基 ETF 强制拦截抛错）
"""

import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from utils.ddx_firewall import check_ddx_allowed, DDXFirewallViolationError


class TestDDXFirewall(unittest.TestCase):
    """DDX 防火墙单测"""

    def test_tc_flt_04_stocks_pass(self):
        """个股流通盘恒定，允许计算 DDX"""
        stocks = ["688012", "002371", "688981", "688041", "688256", "300750", "600519"]
        for s in stocks:
            self.assertTrue(check_ddx_allowed(s))

    def test_tc_flt_04_etf_blocked(self):
        """宽基 ETF 存在做市商双边报价与动态申赎，严禁计算 DDX，必须拦截抛错"""
        etfs = [
            "510300", "510310", "510500", "510050", "588000",
            "588080", "159915", "159919", "512100", "159845",
            "563360", "159352", "159338", "159949", "510210"
        ]
        for etf in etfs:
            with self.assertRaises(DDXFirewallViolationError) as ctx:
                check_ddx_allowed(etf)
            self.assertIn("DDX", str(ctx.exception))
            self.assertIn("ETF", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
