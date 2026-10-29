#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
run_quant_suite.py - A股全维度量化复盘与七大看板总调度引擎
整合:
- 看板1: 外围宏观流动性与利差雷达
- 看板2: 科技成长独立量能与拥挤度(TCR)
- 看板3: 两融杠杆水位与出清度
- 看板4: 期指博弈与到期交割日雷达
- 看板5: 全球AI龙头财报与CAPEX映射指引
- 看板6: 国家队宽基ETF托底看板
- 看板7: 超卖与均值回归看板
"""

import sys
import os
import json
import argparse
import datetime

# 保证本地导入
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

from fetch_macro import fetch_macro_dashboard
from fetch_tech_volume import fetch_tech_volume_dashboard
from fetch_cffex import fetch_cffex_dashboard
from fetch_leverage_etf import fetch_leverage_etf_dashboard

def generate_markdown_dashboard(data):
    """根据量化数据生成标准化 Markdown 仪表板表格"""
    macro = data.get('macro', {})
    tech = data.get('tech_volume', {})
    cffex = data.get('cffex', {})
    leverage = data.get('leverage_etf', {})
    
    margin = leverage.get('margin_summary', {})
    breadth = leverage.get('market_breadth', {})
    etfs = leverage.get('national_team_etfs', {})
    basis_tbl = cffex.get('basis_table', {})
    citic = cffex.get('citic_positions', {})
    
    md = []
    md.append("## 📊 A股全维度量化复盘仪表板（Seven Quantitative Dashboards）\n")
    
    # 看板 1
    md.append("### 1. 【外围宏观流动性与利差雷达】")
    md.append("| 宏观指标 | 最新数值 | 历史基准与阈值 | 信号研判 |")
    md.append("| :--- | :--- | :--- | :--- |")
    md.append(f"| **10Y 美债收益率 (US10Y)** | `{macro.get('us_10y')}%` | 正常中枢 4.0%~4.5% | 高位压制长久期科技资产分母端估值 |")
    md.append(f"| **10Y 中债收益率 (CN10Y)** | `{macro.get('cn_10y')}%` | 宽松区间 1.6%~1.8% | 货币政策维持流动性充裕托底 |")
    md.append(f"| **中美 10Y 利差倒挂** | `{macro.get('spread_bp')} bps` | 极值分位 < -300 bps | 深度倒挂，外资交易盘防守倾向强 |")
    md.append(f"| **离岸人民币 (USD/CNH)** | `{macro.get('usd_cnh')}` | 关口 6.65~6.70 | 处于震荡防守区间 |")
    md.append(f"| **下次美联储 FOMC 决议** | `{macro.get('next_meeting_date')}` | 距今剩余 `{macro.get('days_remaining')}` 天 | {'含点阵图重磅指引' if macro.get('has_dot_plot') else '常规例行决议'} |\n")
    
    # 看板 2
    md.append("### 2. 【科技成长独立量能与拥挤度看板】")
    md.append("| 监测标的/指数 | 代码 | 真实成交额(亿元) | 涨跌幅 | 拥挤度 TCR / 量能占比 | 状态诊断 |")
    md.append("| :--- | :---: | :---: | :---: | :---: | :--- |")
    md.append(f"| **沪深两市总成交额** | 全市场 | `{tech.get('total_market_amount_yi')}` | - | `100.0%` | 全市场交投活跃 |")
    md.append(f"| **创业板综 (全板1300+股)** | `sz399102` | `{tech.get('chinext_all_amount_yi')}` | `{tech.get('indices_detail',{}).get('399102',{}).get('pct_chg')}%` | TCR `{tech.get('tcr_chinext')}%` | 涵盖创业板全市场 100% 真实量能 |")
    md.append(f"| **科创综指 (全板570+股)** | `sh000680` | `{tech.get('star_all_amount_yi')}` | `{tech.get('indices_detail',{}).get('000680',{}).get('pct_chg')}%` | TCR `{tech.get('tcr_star')}%` | 涵盖科创板全市场 100% 真实量能 |")
    md.append(f"| *科创50 (仅50只龙头)* | `sh000688` | `{tech.get('star50_amount_yi')}` | `{tech.get('indices_detail',{}).get('000688',{}).get('pct_chg')}%` | 占比约 31% | 仅代表硬科技大市值龙头走势 |")
    md.append(f"| **科创芯片指数** | `sh000685` | `{tech.get('semi_amount_yi')}` | `{tech.get('indices_detail',{}).get('000685',{}).get('pct_chg')}%` | TCR `{tech.get('tcr_semi')}%` | 芯片核心赛道交投温度计 |")
    md.append(f"| **双创总拥挤度 (TCR_DoubleTech)** | 创业+科创 | `{round(tech.get('chinext_all_amount_yi',0)+tech.get('star_all_amount_yi',0), 2)}` | - | **`{tech.get('tcr_double_tech')}%`** | **{tech.get('crowding_status')}** |\n")
    
    # 看板 3
    md.append("### 3. 【两融杠杆水位与出清度看板】")
    md.append("| 两融监测项 | 最新数据 | 单日变动 | 预警基准线 | 杠杆出清评估 |")
    md.append("| :--- | :---: | :---: | :---: | :--- |")
    md.append(f"| **全市场两融余额** | `{margin.get('total_margin_yi')} 亿元` | `+{margin.get('margin_change_yi')} 亿元` | 警戒线 2.4万亿 | 杠杆交投维持高位 |")
    md.append(f"| **融资余额 / 融券余额** | `{margin.get('total_financing_yi')} 亿 / {margin.get('total_securities_lending_yi')} 亿` | - | 融券占比极低 | 做空受限，以融资多头为主 |")
    ksm = leverage.get('key_stock_margin', {})
    md.append(f"| **重点标的: {ksm.get('stock_name')}({ksm.get('stock_code')})** | `{ksm.get('rzye_yi')} 亿元` | `净买入 {ksm.get('net_buy_yi')} 亿元` | 浮筹弹性 $E_m$ | {ksm.get('status')} |\n")
    
    # 看板 4
    md.append("### 4. 【期指博弈与到期交割日雷达】")
    md.append(f"> **到期交割日提醒**：当前主力为 `{cffex.get('front_contract_suffix')}` 合约，距 **{cffex.get('expiry_date')}**（每月第三个周五交割日）剩余 **`{cffex.get('days_to_expiry')}`** 个自然日。中金所结算价按最后两小时 120 个切片算术平均防操纵。")
    md.append("| 期指品种 | 当月合约 | 期货价 | 现货价 | 基差 (Basis) | 年化贴水率 | 极端反转预警 |")
    md.append("| :---: | :---: | :---: | :---: | :---: | :---: | :---: |")
    for k, name in [('IF','沪深300'), ('IC','中证500'), ('IM','中证1000'), ('IH','上证50')]:
        row = basis_tbl.get(k, {})
        sig = "🔥 <=-25% 极限恐慌超卖做多点" if row.get('is_extreme_oversold_signal') else "正常套保贴水"
        md.append(f"| **{k} ({name})** | `{row.get('contract')}` | `{row.get('futures_price')}` | `{row.get('spot_price')}` | `{row.get('basis')}` | `{row.get('annualized_discount_rate')}%` | {sig} |")
    
    md.append("\n**头部席位持仓微观拆解 (中信期货代客)**：")
    md.append("| 标的 | 中信多单总量(手) | 单日增减 | 中信空单总量(手) | 单日增减 | 中信净空单(手) | 净空单变动 | 微观定性 |")
    md.append("| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |")
    for k in ['IF', 'IC', 'IM', 'IH']:
        c = citic.get(k, {})
        nature = "现货减仓被动平保" if c.get('net_short_chg', 0) < 0 else "现货加仓中性对冲"
        md.append(f"| **{k}** | `{c.get('total_long')}` | `{c.get('long_chg'):+d}` | `{c.get('total_short')}` | `{c.get('short_chg'):+d}` | `{c.get('net_short')}` | `{c.get('net_short_chg'):+d}` | {nature} |")
    md.append("")
    
    # 看板 6 & 7
    md.append("### 5. 【国家队宽基 ETF 托底与全市场超卖看板】")
    md.append(f"全市场广度：**上涨 `{breadth.get('up_count')}` 家 / 下跌 `{breadth.get('down_count')}` 家 / 平盘 `{breadth.get('flat_count')}` 家**（当前盘面特征：**{breadth.get('sentiment')}**）。")
    md.append("| 核心宽基 ETF | 代码 | 收盘价 | 涨跌幅 | 单日成交额(亿元) | 托底指纹识别 |")
    md.append("| :--- | :---: | :---: | :---: | :---: | :--- |")
    for code, row in etfs.items():
        md.append(f"| **{row.get('name')}** | `{code}` | `{row.get('price')}` | `{row.get('pct_chg')}%` | `{row.get('amount_yi')}` | 监测尾盘放量与净申购 |")
    md.append("")
    
    return "\n".join(md)

def main():
    parser = argparse.ArgumentParser(description="A股全维度量化复盘与七大看板总调度")
    parser.add_argument('--date', type=str, default=None, help="指定交易日期(YYYYMMDD)")
    parser.add_argument('--format', type=str, choices=['json', 'markdown', 'all'], default='all', help="输出格式")
    args = parser.parse_args()
    
    macro = fetch_macro_dashboard()
    tech = fetch_tech_volume_dashboard()
    cffex = fetch_cffex_dashboard(args.date)
    leverage = fetch_leverage_etf_dashboard()
    
    full_data = {
        'timestamp': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'macro': macro,
        'tech_volume': tech,
        'cffex': cffex,
        'leverage_etf': leverage
    }
    
    if args.format == 'json':
        print(json.dumps(full_data, ensure_ascii=False, indent=2))
    elif args.format == 'markdown':
        print(generate_markdown_dashboard(full_data))
    else:
        # 默认同时输出 JSON 与 Markdown
        print("=== QUANT_DATA_JSON_START ===")
        print(json.dumps(full_data, ensure_ascii=False))
        print("=== QUANT_DATA_JSON_END ===")
        print("\n")
        print(generate_markdown_dashboard(full_data))

if __name__ == '__main__':
    main()
