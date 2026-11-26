#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
run_quant_suite.py - A股全维度量化复盘与大盘形势总调度引擎 (v2.1 实盘定稿版)
结构：
- 顶部总览: 今日大盘形势一页总览（核心宽基 + 确定性市场定性 + 方向指引）
- 看板 1: 外围宏观流动性与利差雷达
- 看板 2: 大盘总量能、行业主线轮动与双创 TCR 拥挤度
- 看板 3: 市场微观结构与全市场真中位数情绪
- 看板 4: 期指基差与中信席位风格透视
- 看板 5: 国家队宽基 ETF 托底与 20/60 日同进度雷达
- 看板 6: 全市场两融杠杆与滚动 5 日出清弹性 Em
- 看板 7: 核心自选股主力大单 DDX 筹码雷达 (带 DDX 防火墙)
"""

import sys
import json
import argparse
import datetime
from pathlib import Path

current_dir = Path(__file__).resolve().parent
if str(current_dir) not in sys.path:
    sys.path.insert(0, str(current_dir))

from fetch_macro import fetch_macro_dashboard
from fetch_tech_volume import fetch_tech_volume_dashboard
from fetch_sector_rotation import fetch_sector_rotation_dashboard
from fetch_market_sentiment import fetch_market_sentiment, calculate_divergence, generate_sentiment_label
from fetch_cffex import fetch_cffex_dashboard
from fetch_etf_flows import fetch_etf_flows_dashboard
from fetch_etf_radar import fetch_etf_radar_dashboard
from fetch_leverage_margin import fetch_leverage_margin_dashboard
from fetch_fund_flow import fetch_fund_flow_dashboard, generate_fund_flow_markdown


def build_executive_summary(data: dict) -> dict:
    """
    确定性大盘形势研判引擎：汇总量价、真中位数、双创拥挤度、宏观/期指/ETF 信号，
    输出今日大盘所处格局与明确的操作姿态建议，严禁拍脑袋。
    """
    tech = data.get('tech_volume', {})
    sent = data.get('market_sentiment', {})
    mb = sent.get('market_breadth', {})
    cffex = data.get('cffex', {})
    etf_radar = data.get('etf_radar', {})
    macro = data.get('macro', {})

    idx = tech.get('indices_detail', {})
    sh_pct = idx.get('000001', {}).get('pct_chg')
    med_pct = mb.get('median_change_pct')
    adv_pct = mb.get('advance_pct', 0)
    vol_trend = tech.get('volume_trend', 'UNKNOWN')
    tcr = tech.get('tcr_double_tech', 0)
    tcr_level = tech.get('crowding_level', 'HEALTHY')
    radar_state = etf_radar.get('state', 'normal')
    spread_bp = macro.get('spread_bp')

    drivers = []

    # 1. 核心格局定性
    if med_pct is not None and sh_pct is not None:
        if med_pct >= 0.8 and adv_pct >= 65 and vol_trend == 'EXPANDING':
            regime = "放量普涨进攻格局"
            posture = "顺势持有主线，逢盘中回踩择强低吸（若 TCR>40% 严禁盲目追高）"
        elif med_pct <= -0.8 and adv_pct <= 35:
            if vol_trend == 'EXPANDING':
                regime = "放量普跌出清格局"
                posture = "严格防守控仓，耐心等待宽基 ETF 放量托底或跌势企稳右侧信号"
            else:
                regime = "缩量阴跌防守格局"
                posture = "防守控仓为主，不接左侧飞刀，保留现金等待放量止跌"
        elif sh_pct >= 0.2 and med_pct <= -0.3:
            regime = "权重护盘、个股分化（赚指数不赚钱）"
            posture = "防御偏均衡，聚焦高股息/核心权重或逆势吸筹主线，回避高位题材"
        elif sh_pct <= -0.2 and med_pct >= 0.3:
            regime = "权重承压、中小盘题材活跃"
            posture = "轻指数重结构，围绕领涨主线做波段，严守个股止损线"
        elif vol_trend == 'SHRINKING':
            regime = "缩量震荡整固格局"
            posture = "均衡高抛低吸，控制总仓位，避免追涨杀跌"
        else:
            regime = "放量结构分化格局"
            posture = "去弱留强，向资金净流入居前的核心主线集中"
    else:
        regime = "部分核心行情缺失（待人工核对）"
        posture = "数据不完整时保持谨慎观望"

    # 2. 核心量化驱动证据
    if med_pct is not None:
        drivers.append(
            f"**赚钱效应**：全市场上涨 `{mb.get('up_count')}` / 下跌 `{mb.get('down_count')}` 家，"
            f"真实个股中位数 **`{med_pct:+.2f}%`**（P25 `{mb.get('p25')}%` ~ P75 `{mb.get('p75')}%`）"
        )
    if tech.get('volume_edge_status'):
        drivers.append(
            f"**量能边际**：当前成交 `{tech.get('total_market_amount_yi')}` 亿"
            f"（预估全天 `{tech.get('estimated_full_day_yi')}` 亿），{tech.get('volume_edge_status')}"
        )
    if tcr_level in ('HIGH_ALERT', 'CAUTION'):
        drivers.append(f"**成长拥挤度警示**：双创 TCR 达 **`{tcr}%`**（{tech.get('crowding_status')}）")
    elif tcr_level == 'FREEZING_OPPORTUNITY':
        drivers.append(f"**左侧情绪冰点**：双创 TCR 仅 **`{tcr}%`**，科技交投接近冰点")

    cb = cffex.get('citic_behavior', {})
    if cb.get('confidence') != 'DEGRADED':
        drivers.append(
            f"**衍生品对冲（{cffex.get('cffex_trade_date')}）**：中信席位定性【{cb.get('behavior_tag')}】；"
            f"{cffex.get('style_divergence', '')}"
        )

    if radar_state in ('strong', 'watch'):
        drivers.append(
            f"**宽基 ETF 异动**：20 只核心宽基 ETF 触发 `{radar_state.upper()}` 信号"
            f"（20日同进度 `{etf_radar.get('multiple_20d')}x` / 60日 `{etf_radar.get('multiple_60d')}x`）"
        )
    if spread_bp is not None and spread_bp < -250:
        drivers.append(f"**外围宏观约束**：中美 10Y 利差 `{spread_bp} bps` 处于深度倒挂警戒区")

    return {
        'regime': regime,
        'posture': posture,
        'drivers': drivers,
    }


def generate_markdown_dashboard(data: dict) -> str:
    """根据量化数据生成清晰易读的标准化 Markdown 复盘与形势报告"""
    macro = data.get('macro', {})
    tech = data.get('tech_volume', {})
    sectors = data.get('sector_rotation', {})
    sentiment = data.get('market_sentiment', {})
    cffex = data.get('cffex', {})
    etf_flows = data.get('etf_flows', {})
    etf_radar = data.get('etf_radar', {})
    margin_data = data.get('leverage_margin', {})
    fund_flow = data.get('fund_flow', {})
    divergence = data.get('divergence', {})
    sentiment_label = data.get('sentiment_label', {})
    exec_sum = data.get('executive_summary', {})

    md = []
    md.append("# 📊 A股全维度量化态势与大盘方向复盘报告\n")
    md.append(
        f"> **生成时间**：`{data.get('timestamp')}` | "
        f"**交易时段**：`{tech.get('session_phase', 'unknown')}` | "
        f"**数据原则**：全链路实盘直连，缺失显式标 N/A，严禁伪造\n"
    )

    # =========================================================================
    # 顶部总览：今日大盘形势一页总览
    # =========================================================================
    md.append("## 🧭 今日大盘形势一页总览（Executive Overview）\n")
    md.append(f"- **当前市场定性**：**`{exec_sum.get('regime', 'N/A')}`**")
    md.append(f"- **今日应对姿态**：{exec_sum.get('posture', 'N/A')}")
    if sectors.get('main_theme_summary'):
        md.append(f"- **盘面主线速览**：{sectors.get('main_theme_summary')}")
    for d in exec_sum.get('drivers', []):
        md.append(f"- {d}")

    idx = tech.get('indices_detail', {})
    core_idx_list = [
        ('000001', '上证指数'), ('399001', '深证成指'), ('000300', '沪深300'),
        ('000905', '中证500'), ('399852', '中证1000'), ('399006', '创业板指'),
        ('000688', '科创50'), ('899050', '北证50'),
    ]
    md.append("\n**核心宽基指数实时快照**：")
    md.append("| 指数名称 | 最新点位 | 涨跌幅 | 成交额 (亿元) |")
    md.append("| :--- | :---: | :---: | :---: |")
    for code, fallback_name in core_idx_list:
        row = idx.get(code)
        if row:
            pct = row.get('pct_chg')
            pct_str = f"**`{pct:+.2f}%`**" if pct is not None else "`N/A`"
            md.append(f"| **{row.get('name', fallback_name)}** (`{code}`) | `{row.get('price')}` | {pct_str} | `{row.get('amount_yi')}` |")
    md.append("")

    # =========================================================================
    # 看板 1: 外围宏观流动性与利差雷达
    # =========================================================================
    md.append("## 看板 1：外围宏观流动性与利差雷达\n")
    us10y_str = f"`{macro.get('us_10y')}%`" if macro.get('us_10y') is not None else "`N/A (接口降级)`"
    cn10y_str = f"`{macro.get('cn_10y')}%`" if macro.get('cn_10y') is not None else "`N/A (接口降级)`"
    spread_val = macro.get('spread_bp')
    spread_str = f"`{spread_val} bps`" if spread_val is not None else "`N/A`"
    usdcnh_str = f"`{macro.get('usd_cnh')}`" if macro.get('usd_cnh') is not None else "`N/A`"
    dxy_str = f"`{macro.get('dxy')}`" if macro.get('dxy') is not None else "`N/A`"
    y_note = f"（国债曲线基准日 `{macro.get('yield_date')}`）" if macro.get('yield_date') else ""

    md.append(f"| 宏观监控指标 {y_note} | 最新数值 | 参考阈值 | 信号研判 |")
    md.append("| :--- | :---: | :---: | :--- |")
    md.append(f"| **10Y 美债收益率 (US10Y)** | {us10y_str} | 正常中枢 4.0%~4.5% | 高位压制长久期科技资产估值分母 |")
    md.append(f"| **10Y 中债收益率 (CN10Y)** | {cn10y_str} | 宽松区间 1.5%~1.8% | 国内利率低位运行，流动性底座充裕 |")
    spread_note = "深度倒挂警戒，外资偏防守" if (spread_val is not None and spread_val < -250) else "跨境利差常态运行"
    md.append(f"| **中美 10Y 利差** | {spread_str} | 警戒线 < -250 bps | {spread_note} |")
    md.append(f"| **离岸人民币 (USD/CNH)** | {usdcnh_str} | 警戒 7.30 / 顺风 7.15 | 反映外资日内汇率与风险偏好 |")
    md.append(f"| **美元指数 (DXY)** | {dxy_str} | 强弱分水岭 103.5 | 全球风险资产流动性总阀门 |")
    md.append(f"| **下次美联储 FOMC 决议** | `{macro.get('next_meeting_date')}` | 剩余 `{macro.get('days_remaining')}` 天 | {'含点阵图重磅指引 (SEP)' if macro.get('has_dot_plot') else '常规例行决议'} |\n")

    # =========================================================================
    # 看板 2: 大盘总量能、行业主线轮动与双创 TCR 拥挤度
    # =========================================================================
    md.append("## 看板 2：大盘总量能、行业主线轮动与双创 TCR 拥挤度\n")
    md.append(f"> **量能边际定性**：{tech.get('volume_edge_status', '常态交投')}。（{tech.get('volume_estimate_note')}）\n")
    vr20 = tech.get('vr20', {})
    vr20_val = f"`{vr20.get('vr20')}`" if vr20.get('vr20') is not None else "`N/A`"
    avg20 = vr20.get('avg_20d_amt_yi')
    avg20_str = f"（近20日沪深日均 `{avg20}` 亿）" if avg20 else ""

    md.append("| 监测维度 | 成交额 (亿元) | 涨跌幅 / 边际 | TCR / 量能指标 | 状态诊断 |")
    md.append("| :--- | :---: | :---: | :---: | :--- |")
    md.append(f"| **沪深北三市总成交** | `{tech.get('total_market_amount_yi')}` | {tech.get('volume_edge_status')} | `100.0%` | 沪 `{tech.get('sh_amount_yi')}` + 深 `{tech.get('sz_amount_yi')}` + 北 `{tech.get('bj_amount_yi')}` |")
    md.append(f"| **全天预估成交额 (U型)** | `{tech.get('estimated_full_day_yi')}` | 已交易 `{tech.get('elapsed_trading_minutes')}` 分钟 | {avg20_str or '-'} | {'放量推进' if tech.get('volume_trend')=='EXPANDING' else ('边际缩量' if tech.get('volume_trend')=='SHRINKING' else '待确认')} |")
    md.append(f"| **创业板综 (全板)** | `{tech.get('chinext_all_amount_yi')}` | `{idx.get('399102', {}).get('pct_chg')}%` | TCR `{tech.get('tcr_chinext')}%` | 涵盖创业板全市场量能 |")
    md.append(f"| **科创综指 (全板)** | `{tech.get('star_all_amount_yi')}` | `{idx.get('000680', {}).get('pct_chg')}%` | TCR `{tech.get('tcr_star')}%` | 涵盖科创板全市场量能 |")
    md.append(f"| **双创总拥挤度 (TCR)** | `{round((tech.get('chinext_all_amount_yi') or 0)+(tech.get('star_all_amount_yi') or 0), 2)}` | - | **`{tech.get('tcr_double_tech')}%`** | **{tech.get('crowding_status')}** |")
    md.append(f"| **成交量比率 ($VR_{{20}}$)** | - | - | {vr20_val} | **{vr20.get('status', '常态')}**（<70 超卖，>250 过热） |\n")

    # 行业主线轮动子表
    if sectors.get('status') == 'ok':
        md.append("### 🔥 行业板块强弱与主力资金主线")
        md.append("| 排名 | 领涨行业 Top 5（领涨股） | 领跌行业 Top 5 | 主力净流入 Top 5 (亿元) | 主力净流出 Top 5 (亿元) |")
        md.append("| :---: | :--- | :--- | :--- | :--- |")
        g_list = sectors.get('top_gainers', [])
        l_list = sectors.get('top_losers', [])
        i_list = sectors.get('top_inflow', [])
        o_list = sectors.get('top_outflow', [])
        for idx_i in range(5):
            g_cell = f"{g_list[idx_i]['name']} `{g_list[idx_i]['pct_chg']:+.2f}%` ({g_list[idx_i]['leader_name']})" if idx_i < len(g_list) else "-"
            l_cell = f"{l_list[idx_i]['name']} `{l_list[idx_i]['pct_chg']:+.2f}%`" if idx_i < len(l_list) else "-"
            i_cell = f"{i_list[idx_i]['name']} `{i_list[idx_i]['net_inflow_yi']:+.2f}亿`" if idx_i < len(i_list) else "-"
            o_cell = f"{o_list[idx_i]['name']} `{o_list[idx_i]['net_inflow_yi']:+.2f}亿`" if idx_i < len(o_list) else "-"
            md.append(f"| {idx_i+1} | {g_cell} | {l_cell} | {i_cell} | {o_cell} |")
        md.append("")

    # =========================================================================
    # 看板 3: 市场微观结构与全市场真中位数情绪
    # =========================================================================
    md.append("## 看板 3：市场微观结构与全景情绪\n")
    mb = sentiment.get('market_breadth', {})
    ls = sentiment.get('limit_structure', {})
    rating = sentiment.get('sentiment_rating', {})
    dq = sentiment.get('data_quality', {})

    md.append(f"**全市场全景宽度（覆盖 `{dq.get('total_market_coverage', mb.get('median_sample_size', 0))}` 只个股精确统计）**：")
    md.append(f"- 涨跌分布：上涨 `{mb.get('up_count')}` 家 / 下跌 `{mb.get('down_count')}` 家 / 平盘 `{mb.get('flat_count')}` 家（上涨占比 `{mb.get('advance_pct')}%`）")
    med_str = f"**`{mb.get('median_change_pct'):+.2f}%`**" if mb.get('median_change_pct') is not None else "`N/A`"
    md.append(f"- 涨跌比：`{mb.get('advance_decline_ratio')}` | 全市场个股真实中位数：{med_str}")
    if mb.get('p25') is not None and mb.get('p75') is not None:
        md.append(f"- 个股分位分布：P25 `{mb.get('p25'):+.2f}%` | 中位数 `{mb.get('median_change_pct'):+.2f}%` | P75 `{mb.get('p75'):+.2f}%` | Bowley 偏度 `{mb.get('skewness')}`")

    md.append(f"\n**短线涨跌停梯队（日期 `{sentiment.get('trade_date', '当日')}`）**：")
    md.append(f"- 封死涨停：`{ls.get('sealed_limit_up_count')}` 只 | 炸板：`{ls.get('broken_board_count')}` 只（炸板率 `{ls.get('broken_board_rate')}%`） | 跌停：`{ls.get('limit_down_count')}` 只")
    cb_boards = ls.get('consecutive_boards', {})
    if cb_boards:
        cb_str = "、".join([f"{k}连板 {v} 家" for k, v in sorted(cb_boards.items(), reverse=True)])
        md.append(f"- 连板晋级梯队：`{cb_str}`")
    if divergence:
        md.append(f"- 指数与个股剪刀差：**{divergence.get('description')}**（指数-中位数差值：`{divergence.get('divergence_value')}%`）")

    score = rating.get('score', sentiment_label.get('sentiment_score', 'N/A'))
    level = rating.get('level', sentiment_label.get('sentiment_level', 'N/A'))
    md.append(f"- **综合情绪得分**：`{score}` 分 | **情绪档位**：**`{level}`**\n")

    # =========================================================================
    # 看板 4: 期指基差与中信席位风格透视
    # =========================================================================
    md.append("## 看板 4：期指基差与中信席位风格透视\n")
    md.append(
        f"> **主力合约与交割保护**：当月主力 `{cffex.get('front_contract_suffix')}`，"
        f"距交割日 **{cffex.get('expiry_date')}** 剩余 **`{cffex.get('days_to_expiry')}`** 个自然日"
        f"（席位龙虎榜披露基准日：`{cffex.get('cffex_trade_date')}`）。\n"
    )

    basis_tbl = cffex.get('basis_table', {})
    md.append("| 期指主力合约 | 期货价格 | 现货点位 | 绝对基差 (点) | 年化贴水率 | 极值反转信号 |")
    md.append("| :---: | :---: | :---: | :---: | :---: | :---: |")
    for k, name in [('IF', '沪深300'), ('IC', '中证500'), ('IM', '中证1000'), ('IH', '上证50')]:
        row = basis_tbl.get(k, {})
        sig = "🔥 <=-25% 极限恐慌超卖点" if row.get('is_extreme_oversold_signal') else "正常对冲基差"
        ann = f"`{row.get('annualized_discount_rate')}%`" if row.get('annualized_discount_rate') is not None else "`N/A (交割周保护)`"
        basis_val = f"`{row.get('basis'):+.2f}`" if row.get('basis') is not None else "`N/A`"
        md.append(f"| **{k} ({name})** | `{row.get('futures_price')}` | `{row.get('spot_price')}` | {basis_val} | {ann} | {sig} |")

    cb_behavior = cffex.get('citic_behavior', {})
    md.append("\n**中信期货（代客）席位行为与风格切换透视**：")
    md.append(f"- **总体行为定性**：**`【{cb_behavior.get('behavior_tag', 'N/A')}】`** | 机构总论：**`{cb_behavior.get('macro_verdict', 'N/A')}`** | 置信度：`{cb_behavior.get('confidence', 'N/A')}`")
    md.append(f"- **判别依据**：*{cb_behavior.get('evidence_line', '')}*")
    md.append(f"- **大小盘风格分化**：{cffex.get('style_divergence', '')}\n")

    citic = cffex.get('citic_positions', {})
    md.append("| 品种 | 多单总量(手) | 多单增减 | 空单总量(手) | 空单增减 | 净空单(手) | 净空单变动 |")
    md.append("| :---: | :---: | :---: | :---: | :---: | :---: | :---: |")
    for k in ['IF', 'IC', 'IM', 'IH']:
        c = citic.get(k, {})
        md.append(
            f"| **{k}** | `{c.get('total_long', 0)}` | `{c.get('long_chg', 0):+d}` | "
            f"`{c.get('total_short', 0)}` | `{c.get('short_chg', 0):+d}` | "
            f"`{c.get('net_short', 0)}` | `{c.get('net_short_chg', 0):+d}` |"
        )
    md.append("")

    # =========================================================================
    # 看板 5: 国家队宽基 ETF 托底与 20/60 日同进度雷达
    # =========================================================================
    md.append("## 看板 5：国家队宽基 ETF 托底与 20/60 日同进度雷达\n")
    m20 = etf_radar.get('multiple_20d')
    m60 = etf_radar.get('multiple_60d')
    m20_str = f"`{m20:.2f}x`" if m20 is not None else "`N/A`"
    m60_str = f"`{m60:.2f}x`" if m60 is not None else "`N/A`"
    md.append(
        f"> **20 只核心宽基雷达状态**：**`{str(etf_radar.get('state', 'normal')).upper()}`** "
        f"| 当日累计成交 `{etf_radar.get('amount')}` 亿 "
        f"| 20日同进度倍数 {m20_str}（{etf_radar.get('samples_20d', 0)}日均值 `{etf_radar.get('reference_20d_full')}` 亿） "
        f"| 60日同进度倍数 {m60_str}（{etf_radar.get('samples_60d', 0)}日均值 `{etf_radar.get('reference_60d_full')}` 亿）\n"
    )

    core_rows = etf_flows.get('core_etf_flows', [])
    if core_rows:
        md.append("**核心宽基 ETF 实时成交与官方日度净申赎（按当日成交额 Top 10）**：")
        md.append("| 代码 | 基金简称 | 宽基分类 | 现价 / 涨跌幅 | 当日成交 (亿) | 官方日度净申赎 (亿) | 份额基准日 / 状态 |")
        md.append("| :---: | :--- | :---: | :---: | :---: | :---: | :--- |")
        for r in core_rows[:10]:
            p = r.get('price')
            pc = r.get('pct_chg')
            px = f"`{p:.3f}` (`{pc:+.2f}%`)" if (p is not None and pc is not None) else "`N/A`"
            fl = r.get('flow')
            fl_str = f"**`{fl:+.2f}`**" if fl is not None else "`待次日基准`"
            st = f"`{r.get('shares_record_date')}`" + (f" ({r.get('issues')})" if r.get('issues') else "")
            md.append(f"| `{r.get('symbol')}` | {r.get('name')} | {r.get('category')} | {px} | `{r.get('amount_yi')}` | {fl_str} | {st} |")
        md.append("")

    broad_cats = etf_flows.get('broad_categories', {})
    if broad_cats:
        cat_lines = [f"`{k}`: **{v:+.2f}亿**" for k, v in sorted(broad_cats.items(), key=lambda x: -abs(x[1])) if v is not None]
        md.append(f"**已确认宽基分类资金流向汇总（合计 `{etf_flows.get('total_flow'):+.2f}` 亿）**：" + " ，".join(cat_lines) + "\n")

    # =========================================================================
    # 看板 6: 全市场两融杠杆与滚动 5 日出清弹性 Em
    # =========================================================================
    md.append("## 看板 6：全市场两融杠杆与出清弹性\n")
    margin_summary = margin_data.get('margin_summary', {})
    md.append(f"> **法定披露时效**：{margin_summary.get('date_note', '交易所两融法定 T+1 披露')}。\n")
    em_info = margin_data.get('em_elasticity', {})
    em_val = f"`{em_info.get('em'):.4f}`" if em_info.get('em') is not None else "`N/A`"
    em_label = em_info.get('verdict') or em_info.get('label') or "常态"
    em_detail = (
        f"（5日两融 `{em_info.get('margin_pct_5d'):+.2f}%` / 5日上证 `{em_info.get('index_pct_5d'):+.2f}%`）"
        if (em_info.get('margin_pct_5d') is not None and em_info.get('index_pct_5d') is not None)
        else ""
    )

    m_tot = margin_summary.get('total_margin_yi')
    m_tot_str = f"`{m_tot} 亿元`" if m_tot is not None else "`N/A`"
    m_rz = margin_summary.get('total_financing_yi')
    m_rq = margin_summary.get('total_securities_lending_yi')
    m_split_str = f"`{m_rz} 亿 / {m_rq} 亿`" if (m_rz is not None and m_rq is not None) else "`N/A`"
    m_chg = margin_summary.get('margin_change_yi')
    m_chg_str = f"`{m_chg:+.2f} 亿元`" if m_chg is not None else "`N/A`"
    m_status = ("杠杆去化净流出" if m_chg < 0 else "杠杆资金净加仓") if m_chg is not None else "待更新"

    md.append("| 两融核心指标 | 最新数值 | 单日变动 / 区间 | 出清评估与状态 |")
    md.append("| :--- | :---: | :---: | :--- |")
    md.append(f"| **全市场两融余额** | {m_tot_str} | {m_chg_str} | {m_status} |")
    md.append(f"| **融资余额 / 融券余额** | {m_split_str} | - | 融资多头杠杆主导市场弹性 |")
    md.append(f"| **两融出清弹性系数 ($E_m$)** | {em_val} | {em_detail or '滚动 5 日'} | **{em_label}**（跌势下 >1.2 出清充分，<0.5 出清不足） |\n")

    stocks_margin = margin_data.get('watchlist_margin', [])
    if stocks_margin:
        md.append("**重点自选股融资动态**：")
        md.append("| 代码 | 标的名称 | 基准日期 | 融资余额 (亿元) | 单日净买入 (亿元) | 状态 |")
        md.append("| :---: | :--- | :---: | :---: | :---: | :--- |")
        for sm in stocks_margin:
            rzye = sm.get('rzye_yi')
            rzye_str = f"`{rzye:.2f}`" if rzye is not None else "`N/A`"
            chg = sm.get('change_yi')
            chg_str = f"`{chg:+.2f}`" if chg is not None else "`N/A`"
            md.append(f"| `{sm.get('code')}` | {sm.get('name')} | `{sm.get('trade_date', 'N/A')}` | {rzye_str} | {chg_str} | {sm.get('status', '待更新')} |")
        md.append("")

    # =========================================================================
    # 看板 7: 核心个股主力大单 DDX 筹码雷达
    # =========================================================================
    md.append("## 看板 7：核心自选股主力大单 DDX 筹码雷达\n")
    md.append("> 🛡️ **指标口径说明**：DDX = 当日主力净流入（超大单+大单）/ 流通市值 × 100%；严禁用于宽基 ETF 标的。\n")
    if fund_flow:
        md.append(generate_fund_flow_markdown(fund_flow))
        md.append("")

    return "\n".join(md)


def main():
    parser = argparse.ArgumentParser(description="A股全维度量化态势与七大看板总调度引擎")
    parser.add_argument('--date', type=str, default=None, help="指定交易日期(YYYYMMDD)")
    parser.add_argument('--format', type=str, choices=['json', 'markdown', 'all'], default='all', help="输出格式")
    parser.add_argument('--save', type=str, default=None, help="将 Markdown 报告保存到指定文件路径")
    args = parser.parse_args()

    sys.stderr.write("[1/8] 正在拉取外围宏观流动性与中美利差...\n")
    macro = fetch_macro_dashboard()

    sys.stderr.write("[2/8] 正在获取大盘总量能、核心宽基指数与双创 TCR...\n")
    tech = fetch_tech_volume_dashboard()

    sys.stderr.write("[3/8] 正在拉取行业板块强弱与主力资金主线...\n")
    sectors = fetch_sector_rotation_dashboard()

    spot_chg = tech.get('indices_detail', {}).get('000001', {}).get('pct_chg')
    vol_delta = tech.get('delta_pct')

    sys.stderr.write("[4/8] 正在计算全市场微观结构与 5500+ 个股真中位数情绪...\n")
    sentiment = fetch_market_sentiment(args.date, index_pct=spot_chg if spot_chg is not None else 0.0)

    sys.stderr.write("[5/8] 正在解析期指基差、中信席位与大小盘风格分化...\n")
    cffex = fetch_cffex_dashboard(
        args.date,
        spot_chg_pct=spot_chg if spot_chg is not None else 0.0,
        market_turnover_delta_pct=vol_delta if vol_delta is not None else 0.0,
    )

    sys.stderr.write("[6/8] 正在拉取 20 只核心宽基 ETF 官方净申赎与 20/60 日同进度雷达...\n")
    etf_flows = fetch_etf_flows_dashboard(args.date)
    etf_quotes_map = {
        r['symbol']: r for r in etf_flows.get('core_etf_flows', []) if r.get('symbol')
    }
    etf_radar = fetch_etf_radar_dashboard(etf_quotes=etf_quotes_map)

    sys.stderr.write("[7/8] 正在获取全市场两融余额、滚动 5 日 Em 弹性与自选股融资...\n")
    margin_data = fetch_leverage_margin_dashboard()

    sys.stderr.write("[8/8] 正在穿透自选股实时主力净流入与 DDX 筹码雷达...\n")
    fund_flow = fetch_fund_flow_dashboard(include_multiday=True)

    mb_raw = sentiment.get('market_breadth') or {}
    median_pct = mb_raw.get('median_change_pct')
    if spot_chg is not None and median_pct is not None:
        divergence = calculate_divergence(spot_chg, median_pct)
    else:
        divergence = {'divergence_value': None, 'description': '中位数或指数数据缺失，剪刀差暂不适用'}

    sentiment_label = generate_sentiment_label(
        mb_raw,
        sentiment.get('limit_structure') or {},
        divergence,
    )

    full_data = {
        'timestamp': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'macro': macro,
        'tech_volume': tech,
        'sector_rotation': sectors,
        'market_sentiment': sentiment,
        'cffex': cffex,
        'etf_flows': etf_flows,
        'etf_radar': etf_radar,
        'leverage_margin': margin_data,
        'fund_flow': fund_flow,
        'divergence': divergence,
        'sentiment_label': sentiment_label,
    }
    full_data['executive_summary'] = build_executive_summary(full_data)

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
