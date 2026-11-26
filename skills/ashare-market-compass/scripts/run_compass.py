#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
run_compass.py - A股四层多空指标罗盘统一入口 (ashare-market-compass)
支持模式：
  --mode daily     盘后/实时全维度四层量化仪表盘 + 四态决策台账落盘
  --mode watch     复刻布鲁斯盘中每分钟命令行拆量/TRIN监控屏
  --mode backfill  回填近N日上交所宽基ETF份额与官方期权PCR历史底座
  --mode ledger    查看历史四态决策台账
"""

import argparse
import concurrent.futures
import json
import sys
from pathlib import Path
from typing import Any, Dict

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from calc_tech_timing import fetch_tech_timing_dashboard
from db_store import LEDGER_CSV_PATH, fetch_ledger_recent, get_conn
from decision_engine import evaluate_decision
from fetch_breadth_trin import fetch_breadth_dashboard, run_watch_loop
from fetch_derivatives import backfill_option_pcr, fetch_derivatives_dashboard
from fetch_midterm_regime import backfill_sse_etf_shares, fetch_midterm_dashboard


def _fmt(v: Any, suffix: str = "") -> str:
    if v is None:
        return "⚠️ 未获取"
    return f"`{v}{suffix}`"


def render_markdown_report(payload: Dict[str, Any]) -> str:
    b = payload["breadth"]
    m = payload["midterm"]
    d = payload["derivatives"]
    t = payload["tech"]
    dec = payload["decision"]

    lines = []
    lines.append(f"# 🧭 A股四层多空指标罗盘（{dec['trade_date']}）\n")
    lines.append(f"> **采集时间**：`{dec['created_at']}` | **最终四态结论**：**【{dec['final_state']}】**")
    lines.append(f"> **操作纪律**：{dec['action_guidance']}\n")

    if dec.get("missing_items"):
        lines.append(f"> ⚠️ **缺失数据明示（严格零造假，未填默认值）**：{', '.join(dec['missing_items'])}\n")

    # 顶层四态决策汇总表
    lines.append("## 0. 四态决策仲裁总表（资金面定方向 × 技术面定时机）")
    lines.append("| 维度 | 综合状态 | 核心读数 / 拆解 |")
    lines.append("| :--- | :---: | :--- |")
    lines.append(f"| **资金面（大势 / 洋流）** | **`{dec['fund_signal']}`** | 加权得分 `{dec['fund_score']:+.1f}`（范围 -100 ~ +100） |")
    lines.append(f"| **技术面（小势 / 时机）** | **`{dec['tech_signal']}`** | 周K大势 `{dec['tech_weekly']}` / 日K时机 `{dec['tech_daily']}` |")
    lines.append(f"| **四态最终结论** | **【{dec['final_state']}】** | {dec['notes']} |\n")

    # 第一层：盘中/日度微观拆量与市场宽广度
    lines.append("## 1. 微观拆量、市场宽广度与双口径 TRIN（短线转折 & 拆穿假反弹）")
    if b.get("status") != "OK":
        lines.append(f"> ❌ 数据获取失败：{b.get('error')}\n")
    else:
        mcl_note = (
            f"MCL `{b.get('mcl')}` / MSI `{b.get('msi')}` / 10日ADR `{b.get('adr_10')}`"
            f"（本地累计 `{b.get('history_days')}` 天"
            + ("" if b.get("mcl_stable") else "，满39天后EMA39完全稳定")
            + "）"
        )
        lines.append(f"> **四象限场景定性**：**{b.get('scenario_tag')}**\n")
        lines.append("| 指标 | 最新读数 | 说明 / 拆解 |")
        lines.append("| :--- | :---: | :--- |")
        lines.append(f"| **涨 / 跌 / 平家数** | `涨{b['up_count']} / 跌{b['down_count']} / 平{b['flat_count']}` | 有效 `{b['valid_count']}` 只；涨停 `{b['limit_up']}` / 跌停 `{b['limit_down']}` |")
        lines.append(f"| **涨家占比（宽广度）** | `{b['adv_ratio']}%` | 全A红盘比例 |")
        lines.append(f"| **涨额占比 / 涨量占比** | `{b['adv_amt_ratio']}%` / `{b['adv_vol_ratio']}%` | 全A总成交额 `{b['total_amount_yi']} 亿`（上涨 `{b['up_amount_yi']} 亿`） |")
        lines.append(f"| **额价差 / 量价差** | `{b['amt_breadth_spread']:+.2f} pp` / `{b['amt_vol_spread']:+.2f} pp` | 额价差越大 = 资金越集中少数权重抱团 |")
        lines.append(f"| **阿姆氏 TRIN_额 / TRIN_量** | **`{b['trin_amount']}`** / `{b['trin_volume']}` | 上涨股人均成交额为下跌股的 `{b.get('avg_amt_ratio')}` 倍 |")
        lines.append(f"| **换手率 ≥ 5% 个股占比** | `{b.get('high_turnover_ratio')}%` | 筹码投机热度/出清温度计（越低越近冰点） |")
        lines.append(f"| **宽度平滑（MCL/ADR）** | {mcl_note} | 拒绝原始涨跌家数折线 |\n")

    # 第二层：中期资金面与估值
    lines.append("## 2. 中期资金面、估值水位与 19 只宽基 ETF 份额加权指数")
    lines.append("| 观察点 | 日期 | 最新读数 | 状态 | 量化研判 |")
    lines.append("| :--- | :---: | :---: | :---: | :--- |")

    erp = m.get("erp") or {}
    if erp.get("status") == "OK":
        lines.append(
            f"| **股债息差 (ERP)** | `{erp['trade_date']}` | `{erp['erp_pct']}%` (Z=`{erp['zscore']:+.2f}`) | `{erp['signal']}` | "
            f"3年均值 `{erp['rolling_mean_pct']}%`，+1σ `{erp['upper_1sigma_pct']}%` / +1.5σ `{erp['upper_1_5sigma_pct']}%`；{erp['note']} |"
        )
    else:
        lines.append(f"| **股债息差 (ERP)** | - | ⚠️ 未获取 | - | {erp.get('error', '')} |")

    pe = m.get("equal_weight_pe") or {}
    if pe.get("status") == "OK":
        lines.append(
            f"| **全A等权 PE (TTM)** | `{pe['trade_date']}` | 中位 `{pe['median_pe_ttm']}` / 均值 `{pe['avg_pe_ttm']}` | `{pe['signal']}` | "
            f"10年分位：中位 `{pe['median_pe_10y_pct']}%` / 均值 `{pe['avg_pe_10y_pct']}%`；{pe['note']} |"
        )
    else:
        lines.append(f"| **全A等权 PE (TTM)** | - | ⚠️ 未获取 | - | {pe.get('error', '')} |")

    etf = m.get("etf_19_accumulation") or {}
    if etf.get("status") == "OK":
        lines.append(
            f"| **19只宽基ETF份额加权指数** | `{etf.get('trade_date')}` | **`{etf.get('index_value')}`** (30/70轨) | `{etf.get('signal')}` | "
            f"最新份额净变 `{etf.get('latest_share_change_yi')}亿份` / 净流 `{etf.get('latest_net_flow_yi')}亿`（样本`{etf.get('sample_days')}`天）；{etf.get('note')} |"
        )
    else:
        lines.append(f"| **19只宽基ETF份额加权指数** | - | ⚠️ 未获取 | - | {etf.get('error', '')} |")

    ins = m.get("insider_trading") or {}
    if ins.get("status") == "OK":
        lines.append(
            f"| **高管/重要股东增减持(30日)** | 近30日 | 减`{ins['decrease_count']}` / 增`{ins['increase_count']}` (`{ins['decrease_to_increase_ratio']}:1`) | `{ins['signal']}` | "
            f"估算减持 `{ins['decrease_est_yi']}亿` vs 增持 `{ins['increase_est_yi']}亿`；{ins['note']} |"
        )
    else:
        lines.append(f"| **高管/重要股东增减持** | - | ⚠️ 未获取 | - | {ins.get('error', '')} |")

    mhk = m.get("macro_and_hk") or {}
    hk = mhk.get("hk_leading")
    if hk:
        lines.append(
            f"| **恒生国企先行速率 (HSCEI)** | `{hk['trade_date']}` | `{hk['hscei_close']}` (20日 `{hk['ret_20d_pct']:+.2f}%`) | `{hk['signal']}` | "
            f"5日 `{hk['ret_5d_pct']:+.2f}%` / 相对沪深300 `{hk['rel_vs_csi300_20d_pp']}pp`；{hk['note']} |"
        )
    else:
        lines.append("| **恒生国企先行速率** | - | ⚠️ 未获取 | - | 接口异常 |")

    bc = mhk.get("bond_curve")
    shib = mhk.get("shibor")
    if bc:
        shib_str = f"Shibor O/N `{shib['on']}%` / 3M `{shib['3m']}%`" if shib else "Shibor未获取"
        lines.append(
            f"| **中债收益率曲线 & Shibor** | `{bc['trade_date']}` | 10Y `{bc['cn_10y']}%` / 1Y `{bc['cn_1y']}%` | `参考` | "
            f"10Y-1Y 利差 `{bc['spread_10y_1y_bp']}bps`；{shib_str} |"
        )
    lines.append("")

    # 第三层：衍生品聪明钱（期指升贴水 + 50/300期权PCR）
    lines.append("## 3. 衍生品聪明钱层（四大期指升贴水 & 全市场期权 PCR）")
    cf = d.get("cffex_basis") or {}
    if cf.get("status") == "OK":
        lines.append(
            f"> **当月主力 `{cf['front_contract_suffix']}`**（距交割日 `{cf['expiry_date']}` 剩 `{cf['days_to_expiry']}` 天） | "
            f"IH vs IM 现货强弱差：`{cf.get('ih_vs_im_spot_diff_pp')} pp` | **研判**：{cf['note']}\n"
        )
        lines.append("| 品种 | 合约 | 期货价 | 现货价 | 基差 | 年化贴水率 | 现货涨跌 |")
        lines.append("| :---: | :---: | :---: | :---: | :---: | :---: | :---: |")
        for sym in ("IH", "IF", "IC", "IM"):
            row = (cf.get("basis_table") or {}).get(sym) or {}
            lines.append(
                f"| **{sym}** | `{row.get('contract')}` | {_fmt(row.get('futures_price'))} | "
                f"{_fmt(row.get('spot_price'))} | {_fmt(row.get('basis'))} | "
                f"{_fmt(row.get('annualized_discount_pct'), '%')} | {_fmt(row.get('spot_pct_chg'), '%')} |"
            )
        lines.append("")
    else:
        lines.append(f"> ⚠️ 期指基差获取失败：{cf.get('error')}\n")

    pcr = d.get("option_pcr") or {}
    if pcr.get("status") == "OK":
        lines.append(
            f"**官方全市场期权 PCR（截至 `{pcr.get('trade_date')}`，样本 `{pcr['sample_days']}` 日）**：\n"
            f"- 上证 50 PCR：原始 `{pcr['pcr_50_raw']}%` / 5日平滑 **`{pcr['pcr_50_ema5']}%`**（分位 `{pcr['pcr_50_pct_rank']}%`）\n"
            f"- 沪深 300 PCR：原始 `{pcr['pcr_300_raw']}%` / 5日平滑 **`{pcr['pcr_300_ema5']}%`**（分位 `{pcr['pcr_300_pct_rank']}%`）\n"
            f"- 全市场综合（50/300/500/科创/创业）：5日平滑成交量 PCR `{pcr['pcr_all_ema5']}%`（分位 `{pcr['pcr_all_pct_rank']}%`） / 持仓量 PCR `{pcr.get('all_oi_pcr')}%`\n"
            f"- **共振判定**：`{pcr['signal']}` — {pcr['note']}\n"
        )
    else:
        lines.append(f"> ⚠️ 官方期权 PCR 获取失败：{pcr.get('error')}\n")

    # 第四层：多周期技术面（周K定方向 / 日K找入场）
    lines.append("## 4. 多周期技术面共振（一目均衡表 + VW-MACD + 布林带 + CCI）")
    if t.get("status") != "OK":
        lines.append("> ⚠️ 技术面数据获取失败\n")
    else:
        lines.append("| 指数 | 周期 | 最新收盘 | 一目均衡表位置 (近30根受阻) | VW-MACD 状态 (DIF/DEA) | 布林位置 (%B) | CCI (背离) | 判定 |")
        lines.append("| :--- | :---: | :---: | :--- | :--- | :---: | :---: | :---: |")
        for key in ("SH000001", "SH000300"):
            idx_obj = (t.get("indices") or {}).get(key) or {}
            nm = idx_obj.get("name", key)
            for tf_key, tf_label in (("weekly", "周K"), ("daily", "日K")):
                tf = idx_obj.get(tf_key) or {}
                if not tf.get("signal"):
                    lines.append(f"| {nm} | {tf_label} | ⚠️ | - | - | - | - | - |")
                    continue
                ichi = tf["ichimoku"]
                vw = tf["vw_macd"]
                bb = tf["bollinger"]
                cci = tf["cci"]
                lines.append(
                    f"| **{nm}** | {tf_label} | `{tf['close']}` | "
                    f"`{ichi['position']}` (受阻{ichi['failed_cloud_breakouts_30']}次) | "
                    f"`{vw['state']}` ({vw['dif']}/{vw['dea']}) | "
                    f"{bb['position']} (`{bb['pct_b']}`) | "
                    f"`{cci['value']}` ({cci['divergence']}) | **`{tf['signal']}`** |"
                )
        lines.append("")

    # 决策台账提示
    lines.append(f"---\n*本地四态决策台账已自动更新至：`{LEDGER_CSV_PATH}`*")
    return "\n".join(lines)


def run_daily(output_format: str = "markdown", save: bool = True) -> None:
    # 并发执行四大独立抓取模块（约 4~8 秒全部完成）
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        f_breadth = ex.submit(fetch_breadth_dashboard, save)
        f_midterm = ex.submit(fetch_midterm_dashboard, None, 25)
        f_deriv = ex.submit(fetch_derivatives_dashboard, None, 20)
        f_tech = ex.submit(fetch_tech_timing_dashboard)

        breadth = f_breadth.result()
        midterm = f_midterm.result()
        derivatives = f_deriv.result()
        tech = f_tech.result()

    decision = evaluate_decision(breadth, midterm, derivatives, tech, save_ledger=save)
    payload = {
        "decision": decision,
        "breadth": breadth,
        "midterm": midterm,
        "derivatives": derivatives,
        "tech": tech,
    }
    if output_format == "json":
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(render_markdown_report(payload))


def print_ledger(limit: int = 15) -> None:
    conn = get_conn()
    try:
        rows = fetch_ledger_recent(conn, limit=limit)
    finally:
        conn.close()
    if not rows:
        print("暂无历史决策台账记录。请先运行 --mode daily。")
        return
    print("| 交易日 | 资金面(得分) | 技术面(周/日) | 四态结论 | 涨家% | TRIN_额 | 19ETF加仓 | ERP_Z | IF年化基差 | 50/300 PCR | 备注 |")
    print("| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |")
    for r in rows:
        print(
            f"| {r['trade_date']} | {r['fund_signal']}({r['fund_score']}) | "
            f"{r['tech_signal']}({r['tech_weekly']}/{r['tech_daily']}) | **{r['final_state']}** | "
            f"{r['adv_ratio']}% | {r['trin_amount']} | {r['etf_acc_index']} | "
            f"{r['erp_zscore']} | {r['if_ann_basis']}% | {r['pcr_50']}/{r['pcr_300']} | {r['notes']} |"
        )


if __name__ == "__main__":
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="A股四层多空指标罗盘 (ashare-market-compass)")
    parser.add_argument("--mode", choices=["daily", "watch", "backfill", "ledger"], default="daily")
    parser.add_argument("--format", choices=["markdown", "json"], default="markdown")
    parser.add_argument("--interval", type=int, default=60, help="watch模式刷新秒数")
    parser.add_argument("--max-ticks", type=int, default=0, help="watch模式最大刷新次数(0不限)")
    parser.add_argument("--days", type=int, default=30, help="backfill模式回填天数")
    parser.add_argument("--no-save", action="store_true", help="daily模式不落盘")
    args = parser.parse_args()

    if args.mode == "watch":
        run_watch_loop(interval_sec=args.interval, max_ticks=args.max_ticks)
    elif args.mode == "backfill":
        n_etf = backfill_sse_etf_shares(days=args.days)
        n_pcr = backfill_option_pcr(days=args.days)
        print(f"回填完成：上交所宽基ETF份额新增 {n_etf} 个交易日，官方期权PCR新增 {n_pcr} 个交易日。")
    elif args.mode == "ledger":
        print_ledger(limit=20)
    else:
        run_daily(output_format=args.format, save=not args.no_save)
