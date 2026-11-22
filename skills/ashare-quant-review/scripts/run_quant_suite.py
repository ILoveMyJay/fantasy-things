#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
run_quant_suite.py - A股全维度量化复盘与七大看板总调度引擎 (融合定稿版)
涵盖七大监控看板：
- 看板 1: 外围宏观流动性与利差雷达
- 看板 2: 大盘总量能与双创 TCR 拥挤度 (含北交所与 VR20)
- 看板 3: 市场微观结构与全景情绪 (全市场真中位数与分化剪刀差)
- 看板 4: 期指基差与中信席位透视 (含交割周平滑与中信行为判别器三件套)
- 看板 5: 国家队宽基 ETF 托底与资金雷达 (FtShare 20只核心宽基净申赎 + 同进度雷达)
- 看板 6: 全市场两融杠杆与出清弹性 (含 Em 滚动5日出清度)
- 看板 7: 核心个股主力大单 DDX 筹码雷达 (带 DDX 防火墙)
"""

import sys
import os
import json
import argparse
import datetime
from pathlib import Path

# 保证本地模块平稳导入
current_dir = Path(__file__).resolve().parent
if str(current_dir) not in sys.path:
    sys.path.insert(0, str(current_dir))

from fetch_macro import fetch_macro_dashboard
from fetch_tech_volume import fetch_tech_volume_dashboard
from fetch_market_sentiment import fetch_market_sentiment, calculate_divergence, generate_sentiment_label
from fetch_cffex import fetch_cffex_dashboard
from fetch_etf_flows import fetch_etf_flows_dashboard
from fetch_etf_radar import fetch_etf_radar_dashboard
from fetch_leverage_margin import fetch_leverage_margin_dashboard
from fetch_fund_flow import fetch_fund_flow_dashboard, generate_fund_flow_markdown


def generate_markdown_dashboard(data: dict) -> str:
    """根据量化数据生成标准化 Markdown 仪表板报告"""
    macro = data.get('macro', {})
    tech = data.get('tech_volume', {})
    sentiment = data.get('market_sentiment', {})
    cffex = data.get('cffex', {})
    etf_flows = data.get('etf_flows', {})
    etf_radar = data.get('etf_radar', {})
    margin_data = data.get('leverage_margin', {})
    fund_flow = data.get('fund_flow', {})
    divergence = data.get('divergence', {})
    sentiment_label = data.get('sentiment_label', {})

    md = []
    md.append("# 📊 A股全维度量化复盘与七大看板综合报告\n")
    md.append(f"> **报告生成时间**：`{data.get('timestamp')}` | **系统架构**：确定性 Python + 免密工业级量化套件\n")

    # =========================================================================
    # 看板 1: 外围宏观流动性与利差雷达
    # =========================================================================
    md.append("## 看板 1：外围宏观流动性与利差雷达\n")
    us10y_str = f"`{macro.get('us_10y')}%`" if macro.get('us_10y') is not None else "`N/A (接口降级)`"
    cn10y_str = f"`{macro.get('cn_10y')}%`" if macro.get('cn_10y') is not None else "`N/A (接口降级)`"
    spread_str = f"`{macro.get('spread_bp')} bps`" if macro.get('spread_bp') is not None else "`N/A`"
    usdcnh_str = f"`{macro.get('usd_cnh')}`" if macro.get('usd_cnh') is not None else "`N/A`"
    dxy_str = f"`{macro.get('dxy')}`" if macro.get('dxy') is not None else "`N/A`"

    md.append("| 宏观监控指标 | 最新数值 | 历史基准与阈值 | 信号研判与风险传导 |")
    md.append("| :--- | :---: | :---: | :--- |")
    md.append(f"| **10Y 美债收益率 (US10Y)** | {us10y_str} | 正常中枢 4.0%~4.5% | 高位压制长久期资产估值分母 |")
    md.append(f"| **10Y 中债收益率 (CN10Y)** | {cn10y_str} | 宽松区间 1.6%~1.8% | 国内货币宽松基石，利率低位运行 |")
    md.append(f"| **中美 10Y 利差倒挂** | {spread_str} | 防守警戒 < -250 bps | 刻画跨境套息与汇率风险敞口 |")
    md.append(f"| **离岸人民币 (USD/CNH)** | {usdcnh_str} | 警戒线 7.30 / 顺风线 7.15 | 反映外资交易盘日内情绪与汇率预期 |")
    md.append(f"| **美元指数 (DXY)** | {dxy_str} | 强弱分水岭 103.5 | 全球流动性总阀门 |")
    md.append(f"| **美联储 FOMC 议息决议** | `{macro.get('next_meeting_date')}` | 距今剩余 `{macro.get('days_remaining')}` 天 | {'含点阵图重磅指引 (SEP)' if macro.get('has_dot_plot') else '常规例行决议'} |\n")

    # =========================================================================
    # 看板 2: 大盘总量能与双创 TCR 拥挤度
    # =========================================================================
    md.append("## 看板 2：大盘总量能与双创 TCR 拥挤度\n")
    md.append(f"> **量能边际定性**：{tech.get('volume_edge_status', '常态交投')}。\n")
    vr20 = tech.get('vr20', {})
    vr20_val = f"`{vr20.get('vr20')}`" if vr20.get('vr20') is not None else "`N/A (数据积累中)`"
    vr20_status = vr20.get('status', '常态')

    md.append("| 标的 / 监测维度 | 成交额(亿元) | 环比增减 | TCR / 占比 | 状态诊断与操作策略 |")
    md.append("| :--- | :---: | :---: | :---: | :--- |")
    md.append(f"| **沪深北全市场总成交** | `{tech.get('total_market_amount_yi')}` | {tech.get('volume_edge_status')} | `100.0%` | {'边际缩量整固' if tech.get('volume_trend')=='SHRINKING' else '放量换手推进'} |")
    md.append(f"| **全天预估成交额 (U型)** | `{tech.get('estimated_full_day_yi')}` | - | - | {tech.get('volume_estimate_note')} |")
    md.append(f"| **创业板综 (399102)** | `{tech.get('chinext_all_amount_yi')}` | - | TCR `{tech.get('tcr_chinext')}%` | 涵盖创业板全板块 100% 真实量能 |")
    md.append(f"| **科创综指 (000680)** | `{tech.get('star_all_amount_yi')}` | - | TCR `{tech.get('tcr_star')}%` | 涵盖科创板全板块 100% 真实量能 |")
    md.append(f"| **双创总拥挤度 (TCR)** | `{round(tech.get('chinext_all_amount_yi',0)+tech.get('star_all_amount_yi',0), 2)}` | - | **`{tech.get('tcr_double_tech')}%`** | **{tech.get('crowding_status')}** |")
    md.append(f"| **成交量比率 ($VR_{{20}}$)** | - | - | {vr20_val} | 诊断：**{vr20_status}**（<70 超卖，>250 过热） |\n")

    # =========================================================================
    # 看板 3: 市场微观结构与全景情绪
    # =========================================================================
    md.append("## 看板 3：市场微观结构与全景情绪\n")
    mb = sentiment.get('market_breadth', {})
    ls = sentiment.get('limit_structure', {})
    rating = sentiment.get('sentiment_rating', {})

    md.append(f"**市场全景宽度（覆盖全市场 5500+ 个股）**：")
    md.append(f"- 涨跌分布：上涨 `{mb.get('up_count')}` 家 / 下跌 `{mb.get('down_count')}` 家 / 平盘 `{mb.get('flat_count')}` 家")
    md.append(f"- 涨跌比：`{mb.get('advance_decline_ratio')}` | 真实个股涨跌中位数：**`{mb.get('median_change_pct')}%`**（全市场真中位数，拒绝百只抽样失真）")
    if 'p25' in mb and 'p75' in mb:
        md.append(f"- 分位数结构：P25 `{mb.get('p25')}%` / P75 `{mb.get('p75')}%` / 偏度 Skewness `{mb.get('skewness')}`")

    md.append(f"\n**短线梯队与涨跌停结构**：")
    md.append(f"- 封死涨停：`{ls.get('sealed_limit_up_count')}` 只 | 炸板：`{ls.get('broken_board_count')}` 只（炸板率 `{ls.get('broken_board_rate')}%`） | 跌停：`{ls.get('limit_down_count')}` 只")
    cb = ls.get('consecutive_boards', {})
    if cb:
        cb_str = "、".join([f"{k}连板 {v} 家" for k, v in sorted(cb.items(), reverse=True)])
        md.append(f"- 连板晋级梯队：`{cb_str}`")

    if divergence:
        md.append(f"- 剪刀差背离形态：**{divergence.get('description')}**（剪刀差数值：`{divergence.get('divergence_value')}%`）")

    score = rating.get('score', sentiment_label.get('sentiment_score', 'N/A'))
    level = rating.get('level', sentiment_label.get('sentiment_level', 'N/A'))
    md.append(f"- **综合情绪得分**：`{score}` 分 | **情绪档位**：**`{level}`**\n")

    # =========================================================================
    # 看板 4: 期指基差与中信席位透视
    # =========================================================================
    md.append("## 看板 4：期指基差与中信席位透视\n")
    md.append(f"> **交割周守卫**：主力合约 `{cffex.get('front_contract_suffix')}`，距到期日 **{cffex.get('expiry_date')}** 剩余 **`{cffex.get('days_to_expiry')}`** 个自然日。交割日前 4 天平滑切换次月合约，防范年化贴水发散。\n")

    basis_tbl = cffex.get('basis_table', {})
    md.append("| 期指主力合约 | 期货价格 | 现货点位 | 绝对基差 (点) | 年化贴水率 | 极值反转信号 |")
    md.append("| :---: | :---: | :---: | :---: | :---: | :---: |")
    for k, name in [('IF','沪深300'), ('IC','中证500'), ('IM','中证1000'), ('IH','上证50')]:
        row = basis_tbl.get(k, {})
        sig = "🔥 <=-25% 极限恐慌超卖点" if row.get('is_extreme_oversold_signal') else "正常对冲基差"
        ann = f"`{row.get('annualized_discount_rate')}%`" if row.get('annualized_discount_rate') is not None else "`N/A (交割周保护)`"
        basis_val = f"`{row.get('basis'):+.2f}`" if row.get('basis') is not None else "`N/A`"
        md.append(f"| **{k} ({name})** | `{row.get('futures_price')}` | `{row.get('spot_price')}` | {basis_val} | {ann} | {sig} |")

    # 中信席位行为判别器三件套
    cb_behavior = cffex.get('citic_behavior', {})
    md.append("\n### 🎯 【决策 7 落地：中信席位行为判别器】")
    md.append(f"- **行为标签 (Behavior Tag)**：**`【{cb_behavior.get('behavior_tag', '中性微调')}】`**")
    md.append(f"- **机构总论 (Macro Verdict)**：**`{cb_behavior.get('macro_verdict', '中性对冲')} `**")
    md.append(f"- **置信度评级 (Confidence)**：`{cb_behavior.get('confidence', 'MEDIUM')}`")
    md.append(f"- **确定性证据行**：*{cb_behavior.get('evidence_line', '无异常扰动')}*\n")

    citic = cffex.get('citic_positions', {})
    md.append("**中信期货（代客）席位精确持仓明细**：")
    md.append("| 品种 | 多单总量(手) | 多单增减 | 空单总量(手) | 空单增减 | 净空单(手) | 净空单单日变动 |")
    md.append("| :---: | :---: | :---: | :---: | :---: | :---: | :---: |")
    for k in ['IF', 'IC', 'IM', 'IH']:
        c = citic.get(k, {})
        md.append(f"| **{k}** | `{c.get('total_long', 0)}` | `{c.get('long_chg', 0):+d}` | `{c.get('total_short', 0)}` | `{c.get('short_chg', 0):+d}` | `{c.get('net_short', 0)}` | `{c.get('net_short_chg', 0):+d}` |")
    md.append("\n")

    # =========================================================================
    # 看板 5: 国家队宽基 ETF 托底与资金雷达 (FtShare 核心全面重构)
    # =========================================================================
    md.append("## 看板 5：国家队宽基 ETF 托底与资金雷达 (FtShare 核心)\n")
    radar_state = etf_radar.get('state', 'normal')
    radar_reason = etf_radar.get('reason', 'none')
    multiple = etf_radar.get('multiple')
    mult_str = f"`{multiple:.2f}x`" if multiple is not None else "`N/A`"

    md.append(f"> **分时雷达状态**：**`{radar_state.upper()}`** (原因: `{radar_reason}`) | 20日同进度成交倍数: {mult_str}\n")

    core_rows = etf_flows.get('core_etf_flows', [])
    if core_rows:
        md.append("**20 只核心宽基 ETF 日度法定净申赎 (沪深对齐)**：")
        md.append("| 标的代码 | 基金简称 | 类别 | 最新净申赎 (亿元) | 份额基准日 | 状态标记 |")
        md.append("| :---: | :--- | :---: | :---: | :---: | :---: |")
        for r in core_rows[:10]:  # 报表展示前10大核心标的
            flow_val = f"`{r.get('flow'):+.2f}`" if r.get('flow') is not None else "`None (待披露)`"
            md.append(f"| `{r.get('symbol')}` | {r.get('name')} | {r.get('category')} | {flow_val} | `{r.get('shares_record_date')}` | {r.get('issues') or '正常'} |")
        md.append("\n")

    broad_cats = etf_flows.get('broad_categories', {})
    if broad_cats:
        md.append("**12 类宽基风格资金轮动汇总**：")
        cat_lines = [f"`{k}`: {v:+.2f}亿" for k, v in broad_cats.items() if v is not None]
        md.append("，".join(cat_lines[:6]))
        md.append("\n")

    # =========================================================================
    # 看板 6: 全市场两融杠杆与出清弹性
    # =========================================================================
    md.append("## 看板 6：全市场两融杠杆与出清弹性\n")
    md.append("> **法定时效**：两融数据法定 T+1 披露，推演时严格遵照时序，禁止倒因为果。\n")
    margin_summary = margin_data.get('margin_summary', {})
    em_info = margin_data.get('em_elasticity', {})
    em_val = f"`{em_info.get('em'):.4f}`" if em_info.get('em') is not None else "`N/A`"
    em_label = em_info.get('verdict') or em_info.get('label') or "常态"

    m_chg = margin_summary.get('margin_change_yi')
    m_chg_str = f"`{m_chg:+.2f} 亿元`" if m_chg is not None else "`N/A`"
    m_status = ("杠杆去化净流出" if m_chg < 0 else "杠杆资金净加仓") if m_chg is not None else "常态"

    md.append("| 两融指标 | 最新数值 | 单日变动 | 出清评估与状态 |")
    md.append("| :--- | :---: | :---: | :--- |")
    md.append(f"| **全市场两融余额** | `{margin_summary.get('total_margin_yi')} 亿元` | {m_chg_str} | {m_status} |")
    md.append(f"| **融资余额 / 融券余额** | `{margin_summary.get('total_financing_yi')} 亿 / {margin_summary.get('total_securities_lending_yi')} 亿` | - | 融资盘占比超 99%，绝对多头杠杆 |")
    md.append(f"| **两融出清弹性系数 ($E_m$)** | {em_val} | 滚动 5 日测算 | **{em_label}**（跌势下 >1.2 充分出清，<0.5 出清不足） |\n")

    stocks_margin = margin_data.get('watchlist_margin', [])
    if stocks_margin:
        md.append("**重点自选股融资动态**：")
        md.append("| 代码 | 标的名称 | 融资余额(亿元) | 单日变动 | 状态 |")
        md.append("| :---: | :---: | :---: | :---: | :--- |")
        for sm in stocks_margin:
            chg = sm.get('change_yi')
            chg_str = f"`{chg:+.2f} 亿`" if chg is not None else "`N/A`"
            md.append(f"| `{sm.get('code')}` | {sm.get('name')} | `{sm.get('rzye_yi')}` | {chg_str} | {sm.get('status', '正常')} |")
        md.append("\n")

    # =========================================================================
    # 看板 7: 核心个股主力大单 DDX 筹码雷达 (带 DDX 防火墙)
    # =========================================================================
    md.append("## 看板 7：核心个股主力大单 DDX 筹码雷达\n")
    md.append("> ⚠️ **DDX 安全防火墙已生效**：严格限定于个股维度，对宽基 ETF 标的强制阻断拦截，杜绝伪多头失真。\n")
    if fund_flow:
        md.append(generate_fund_flow_markdown(fund_flow))
        md.append("\n")

    return "\n".join(md)


def main():
    parser = argparse.ArgumentParser(description="A股全维度量化复盘与七大看板总调度")
    parser.add_argument('--date', type=str, default=None, help="指定交易日期(YYYYMMDD)")
    parser.add_argument('--format', type=str, choices=['json', 'markdown', 'all'], default='all', help="输出格式")
    parser.add_argument('--save', type=str, default=None, help="将 Markdown 报告保存到指定文件路径")
    args = parser.parse_args()

    sys.stderr.write("[1/7] 正在拉取外围宏观流动性与利差数据...\n")
    macro = fetch_macro_dashboard()

    sys.stderr.write("[2/7] 正在获取大盘总量能与 TCR 拥挤度 (含 VR20)...\n")
    tech = fetch_tech_volume_dashboard()

    sys.stderr.write("[3/7] 正在计算全市场微观结构与真中位数情绪...\n")
    sentiment = fetch_market_sentiment(args.date)

    sys.stderr.write("[4/7] 正在解析期指基差、中信席位与行为判别器...\n")
    spot_chg = tech.get('indices_detail', {}).get('000001', {}).get('pct_chg')
    if spot_chg is None:
        spot_chg = 0.0
    vol_delta = tech.get('delta_pct')
    if vol_delta is None:
        vol_delta = 0.0
    cffex = fetch_cffex_dashboard(args.date, spot_chg_pct=spot_chg, market_turnover_delta_pct=vol_delta)

    sys.stderr.write("[5/7] 正在计算宽基 ETF 日度净申赎与分时同进度雷达 (FtShare 核心)...\n")
    etf_flows = fetch_etf_flows_dashboard(args.date)
    # 雷达看板只接受实时数据 dict 或 None（种子冷启动）；不要把日期字符串传进去。
    etf_radar = fetch_etf_radar_dashboard()

    sys.stderr.write("[6/7] 正在获取全市场两融杠杆与出清弹性 Em...\n")
    # 两融看板只接受注入数据 dict（当前无注入方时输出空看板）；不要把日期字符串传进去。
    margin_data = fetch_leverage_margin_dashboard()

    sys.stderr.write("[7/7] 正在穿透自选股 Level-2 主力 DDX (经 DDX 防火墙)...\n")
    fund_flow = fetch_fund_flow_dashboard(include_multiday=True)

    # 交叉研判：计算三大指数与个股剪刀差
    sys.stderr.write("正在执行微观背离剪刀差交叉检验...\n")
    mb_raw = sentiment.get('market_breadth') or {}
    median_pct = mb_raw.get('median_change_pct')
    if spot_chg is not None and median_pct is not None:
        divergence = calculate_divergence(spot_chg, median_pct)
    else:
        divergence = {'divergence_value': 0.0, 'description': '中位数或指数数据缺失，剪刀差暂不适用'}

    sentiment_label = generate_sentiment_label(
        mb_raw,
        sentiment.get('limit_structure') or {},
        divergence
    )

    full_data = {
        'timestamp': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'macro': macro,
        'tech_volume': tech,
        'market_sentiment': sentiment,
        'cffex': cffex,
        'etf_flows': etf_flows,
        'etf_radar': etf_radar,
        'leverage_margin': margin_data,
        'fund_flow': fund_flow,
        'divergence': divergence,
        'sentiment_label': sentiment_label
    }

    markdown_report = generate_markdown_dashboard(full_data)

    if args.save:
        save_path = Path(args.save)
        save_path.parent.mkdir(parents=True, exist_ok=True)
        save_path.write_text(markdown_report, encoding='utf-8')
        sys.stderr.write(f"Markdown 报告已成功保存至: {save_path}\n")

    if args.format == 'json':
        print(json.dumps(full_data, ensure_ascii=False, indent=2))
    elif args.format == 'markdown':
        print(markdown_report)
    else:
        print("=== QUANT_DATA_JSON_START ===")
        print(json.dumps(full_data, ensure_ascii=False))
        print("=== QUANT_DATA_JSON_END ===")
        print("\n")
        print(markdown_report)


if __name__ == '__main__':
    main()
