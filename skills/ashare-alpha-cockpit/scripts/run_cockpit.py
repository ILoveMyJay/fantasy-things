#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
run_cockpit.py - ashare-alpha-cockpit 统一命令行入口。

支持模式：
  --mode daily     全景大盘三层融合驾驶舱（L1 纠偏罗盘 + L2 战术拐点/蓝灯3/4/双源新闻雷达 + L3 双创风格与49行业轮动）
  --mode stock     Phase 2 解耦式个股趋势与买前风控闸门（支持 --stocks 688981,300750 或自动联动今日领涨行业龙头）
  --mode full      一体化运行 daily + stock（自动以 L1 仓位上限耦合个股风控闸门）
  --mode backfill  回填近 N 日纯净滚仓期指基差 (IM/IC/IF/IH) 与上交所官方期权 PCR 底座
  --mode ledger    查看本地历史决策台账（含 module_dates 跨日校验状态）
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from cockpit_engine import evaluate_cockpit_decision
from db_store import LEDGER_CSV_PATH, fetch_ledger_recent, get_conn
from fetch_breadth_tcr import fetch_breadth_tcr_dashboard
from fetch_confirm_factors import backfill_cffex_basis, backfill_option_pcr, fetch_confirm_dashboard
from fetch_tactical_radar import (
    detect_anchor_bullish_candle,
    evaluate_traffic_lights,
    fetch_news_catalyst_radar,
    fetch_sector_rotation,
)
from fetch_tech_timing import fetch_tech_timing_dashboard
from stock_gate import evaluate_stock_watchlist


def _fmt(v: Any, suffix: str = "") -> str:
    return "⚠️ 未获取" if v is None else f"`{v}{suffix}`"


def render_markdown(payload: Dict[str, Any]) -> str:
    dec = payload["decision"]
    tech = payload["tech"]
    b = payload["breadth"]
    cf = payload["confirm"]
    tl = payload["traffic_lights"]
    news = payload["news"]
    sec = payload["sectors"]
    stocks = payload.get("stock_gate")

    lines: List[str] = []
    lines.append(f"# 🧭 A股阿尔法驾驶舱 `ashare-alpha-cockpit`（{dec['trade_date']}）\n")
    lines.append(
        f"> **采集时间**：`{dec['created_at']}` | **引擎版本**：`{dec['engine_version']}` (`K={dec['hysteresis_k']}`) | "
        f"**跨日对齐检查**：`{dec['date_alignment_status']}`\n"
    )
    lines.append(f"### 🎯 双层可执行指令")
    lines.append(f"- **【主波段定性】**：**{dec['wave_regime']}**")
    lines.append(
        f"- **【精确目标仓位】**：大盘 **【{dec['final_state']}】(`{dec['target_position_pct']:.0f}%`)** "
        f"| 触发源 `{dec['fastlane_tag']}` | {dec['hysteresis_note']}"
    )
    lines.append(f"- **【双创风格仓位】**：**`{dec['style_position_pct']:.0f}%`** — {dec['style_state']}")
    lines.append(f"- **【战术红绿灯】**：**{dec['traffic_light']}**\n")

    if dec.get("date_warnings"):
        lines.append("> 🚨 **跨日污染拦截警告**：" + "；".join(dec["date_warnings"]) + "\n")
    if dec.get("missing_items"):
        lines.append("> ⚠️ **缺失数据明示（严守零造假，未填默认值）**：" + "、".join(dec["missing_items"]) + "\n")

    # Module dates audit bar
    md_str = " | ".join(f"{k}=`{v or 'N/A'}`" for k, v in (dec.get("module_dates") or {}).items())
    lines.append(f"> **模块日期审计 (`module_dates`)**：{md_str}\n")

    # 1. L1 纠偏战略罗盘
    lines.append("## 1. L1 纠偏战略罗盘（周/日技术轴 × 正交确认分）")
    lines.append("| 维度 | 状态 | 读数 / 规则说明 |")
    lines.append("| :--- | :---: | :--- |")
    lines.append(
        f"| **主趋势轴（周K / 日K）** | **`{dec['tech_weekly']} / {dec['tech_daily']}`** | "
        f"沪深300 `{tech.get('hs300_close')}` (`{tech.get('hs300_ret_1d_pct')}%`, 偏离MA20 `{tech.get('hs300_ext_ma20_pct')}%`) |"
    )
    lines.append(
        f"| **L1 纠偏确认分** | **`{dec['confirm_score']:+.1f}`** | "
        f"原始态 `{dec['l1_raw_state']}` → 缓冲确认态 `{dec['l1_confirmed_state']}` |"
    )
    lines.append(f"| **综合备注** | `{dec['final_state']}` | {dec['notes']} |\n")

    if dec.get("votes"):
        lines.append("**确认分逐项拆解（总权重 3.5；19-ETF/两融/利差仅观测权重 0.0）**：")
        for v in dec["votes"]:
            lines.append(f"- `{v['indicator']}`（权重 `{v['weight']}`，得分 `{v['score']:+.1f}`）：{v['note']}")
        lines.append("")

    # 2. L2 战术拐点、微观宽广度与大阳线中轨 3/4 蓝灯
    lines.append("## 2. L2 战术拐点引擎（全A宽度/真中位数/TRIN奇点修正 & 3/4蓝灯中轨）")
    if b.get("status") == "OK":
        lines.append(f"> **宽广度四象限定性**：**{b.get('scenario_tag')}** (`{b.get('scenario_code')}`)\n")
        lines.append("| 指标 | 最新读数 | 说明 |")
        lines.append("| :--- | :---: | :--- |")
        lines.append(f"| **涨 / 跌 / 平家数** | `涨{b['up_count']} / 跌{b['down_count']} / 平{b['flat_count']}` | 涨停 `{b['limit_up']}` / 跌停 `{b['limit_down']}` / 炸板率 `{b['broken_board_rate']}%` |")
        amt_desc = (
            f"当前 `{b['total_amount_yi']}亿` → 预估全天 **`{b['estimated_full_day_amount_yi']}亿`**（{b['session_phase']}，量比 `{b.get('vol_ratio_prev')}`）"
            if b.get("is_intraday")
            else f"总成交 `{b['total_amount_yi']}亿`（{b.get('session_phase', '盘后收盘')}，量比 `{b.get('vol_ratio_prev')}`）"
        )
        lines.append(f"| **涨家占比 / 涨额占比** | `{b['adv_ratio']}%` / `{b['adv_amt_ratio']}%` | 额价差 `{b['amt_breadth_spread']:+.2f}pp`，{amt_desc} |")
        lines.append(f"| **全A真中位数 / 5日累计** | **`{b['median_pct']:+.2f}%`** / {_fmt(b.get('median_cum_5d'), '%')} | 左尾探针阈值：`≤-4.0%` 或 5日 `≤-8.0%` |")
        lines.append(f"| **双创拥挤度 TCR** | **`{b['tcr_double_tech']}%`** (120D分位 {_fmt(b.get('tcr_pct120'), '%')}) | 健康区 `25%~37.5%`；红灯 `>40%且放量滞涨` |")
        lines.append(f"| **TRIN_额 / MCL** | `{b['trin_amount']}` / `{b['mcl']}` | 10日ADR `{b.get('adr_10')}`（牛市 MCL<-150 警惕失血） |\n")
    else:
        lines.append(f"> ⚠️ 全A微观宽度暂未获取：{b.get('error', '')}\n")

    anc = tl.get("anchor_candle") or {}
    lines.append(f"**大阳线中轨与 3/4 蓝灯监测**：{anc.get('status_note', '无')}")
    if anc.get("levels"):
        lines.append("| 指数 | 锚定日 | 大阳线中轨 | 最新价 | 距中轨 | 状态 |")
        lines.append("| :--- | :---: | :---: | :---: | :---: | :---: |")
        for _, lv in anc["levels"].items():
            lines.append(
                f"| {lv['name']} | `{anc['anchor_date']}` | `{lv['midpoint']}` | `{lv['current_price']}` | "
                f"`{lv['dist_to_mid_pct']:+.2f}%` | `{lv['state']}` |"
            )
    lines.append("")

    # 3. 7x24 双源催化新闻雷达
    lines.append("## 3. 7×24 双源实时财经催化雷达（新浪 + 东财）")
    if news.get("top_catalysts"):
        lines.append(f"> 扫描 `{news['raw_scanned_count']}` 条，命中高相关 `{news['relevant_count']}` 条（来源：{', '.join(news['sources'])}）\n")
        for it in news["top_catalysts"][:6]:
            t_tag = "/".join(it.get("topics") or [])
            lines.append(f"- `{it.get('time', '')[5:16]}` **[{t_tag} · {it.get('polarity')}]** {it.get('title')}（{it.get('source')}）")
    else:
        lines.append("> 暂无重大政策或科技产业催化异动。")
    lines.append("")

    # 4. L3 49行业轮动与纯观测背景面板
    lines.append("## 4. L3 49行业资金轮动 & 纯观测背景（不参与 L1 投票）")
    if sec.get("top_gainers"):
        g_str = "、".join(f"{x['name']}({x['pct_chg']:+.2f}%, 领涨:{x['leader_name']})" for x in sec["top_gainers"][:5])
        lines.append(f"- **领涨前五行业**：{g_str}")
    if sec.get("top_inflow"):
        i_str = "、".join(f"{x['name']}({x['net_inflow_yi']:+.1f}亿)" for x in sec["top_inflow"][:5])
        lines.append(f"- **主力净流入前五**：{i_str}")
    if sec.get("top_losers"):
        l_str = "、".join(f"{x['name']}({x['pct_chg']:+.2f}%)" for x in sec["top_losers"][:3])
        lines.append(f"- **领跌承压行业**：{l_str}")

    obs = cf.get("observation") or {}
    mg = obs.get("margin") or {}
    my = obs.get("macro_yields") or {}
    e19 = obs.get("etf_19") or {}
    lines.append(
        f"- **纯观测资金背景**：两融余额 {_fmt(mg.get('total_margin_yi'), '亿')} (5D {_fmt(mg.get('margin_5d_chg_pct'), '%')}) | "
        f"中美10Y利差 {_fmt(my.get('cn_us_spread_bp'), 'bp')} (60D变化 {_fmt(my.get('spread_chg_60d_bp'), 'bp')}) | "
        f"19-ETF加仓指数 {_fmt(e19.get('index_value'))}\n"
    )

    # 5. Phase 2 个股趋势与买前风控闸门（若运行）
    if stocks and stocks.get("results"):
        lines.append(f"## 5. Phase 2 个股趋势与买前风控闸门（耦合 L1 仓位 `{stocks['l1_target_position_pct']:.0f}%`）")
        lines.append("| 代码 / 名称 | 现价(涨跌) | 周/日趋势 | 20D/60D RS(vs300) | 形态识别 | 5D主力(亿) | 止损价(距离) | 盈亏比 | 建议仓位 | 闸门裁决 |")
        lines.append("| :--- | :---: | :---: | :---: | :--- | :---: | :---: | :---: | :---: | :--- |")
        for s in stocks["results"]:
            if s.get("status") != "OK":
                lines.append(f"| `{s['code']}` {s.get('name','')} | - | - | - | - | - | - | - | 0% | **{s.get('verdict')}** |")
                continue
            rs_s = f"{s.get('rs20_hs300_pct', 'N/A')}% / {s.get('rs60_hs300_pct', 'N/A')}%"
            stp_s = f"`{s['stop_loss']}` (`-{s['stop_dist_pct']}%`)"
            lines.append(
                f"| `{s['code']}` {s['name']} | `{s['price']}` ({s.get('pct_chg')}%) | "
                f"`{s['weekly_signal']}/{s['daily_signal']}` | `{rs_s}` | {'；'.join(s['setups'])} | "
                f"{_fmt(s.get('main_flow_5d_yi'))} | {stp_s} | `{s['rr_ratio']}` | **`{s['suggested_pos_pct']}%`** | **{s['verdict']}** |"
            )
            reasons = s.get("veto_reasons") or s.get("watch_reasons")
            if reasons:
                lines.append(f"  - *{s['name']} 提示*：{'；'.join(reasons)}")
        lines.append("")

    lines.append(f"---\n*决策台账自动落盘至：`{LEDGER_CSV_PATH}`*")
    return "\n".join(lines)


def run_daily_pipeline(
    hysteresis_k: int = 2,
    save: bool = True,
    auto_backfill: bool = True,
    db_path: Optional[Path] = None,
) -> Dict[str, Any]:
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
        f_tech = ex.submit(fetch_tech_timing_dashboard)
        f_confirm = ex.submit(fetch_confirm_dashboard, db_path, auto_backfill)
        f_news = ex.submit(fetch_news_catalyst_radar)
        f_sec = ex.submit(fetch_sector_rotation)
        f_anc = ex.submit(detect_anchor_bullish_candle)

        tech = f_tech.result()
        confirm = f_confirm.result()
        news = f_news.result()
        sectors = f_sec.result()
        anchor = f_anc.result()

    # 拿到 tech 的 hs300_ext_ma20_pct 后再算 breadth 场景分类（确保 BLOWOFF_EUPHORIA 精准判定）
    breadth = fetch_breadth_tcr_dashboard(
        save=save, db_path=db_path, hs300_ext_ma20_pct=tech.get("hs300_ext_ma20_pct")
    )
    traffic_lights = evaluate_traffic_lights(breadth, confirm, tech, anchor, news)
    decision = evaluate_cockpit_decision(
        tech=tech, breadth=breadth, confirm=confirm, traffic_lights=traffic_lights,
        hysteresis_k=hysteresis_k, save_ledger=save, db_path=db_path,
    )
    return {
        "decision": decision,
        "tech": tech,
        "breadth": breadth,
        "confirm": confirm,
        "traffic_lights": traffic_lights,
        "news": news,
        "sectors": sectors,
    }


def main() -> None:
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="ashare-alpha-cockpit A股融合量化驾驶舱与个股风控闸门")
    parser.add_argument("--mode", choices=["daily", "stock", "full", "backfill", "ledger"], default="daily")
    parser.add_argument("--k", type=int, default=2, choices=[1, 2, 3, 5], help="L1 非对称确认缓冲天数（默认 K=2，低频推荐 K=3）")
    parser.add_argument("--stocks", type=str, default="", help="逗号分隔的股票代码（如 688981,300750），留空在 full 模式下自动取今日领涨行业龙头")
    parser.add_argument("--l1-pos", type=float, default=None, help="stock 独立模式下手动指定大盘仓位(0.0~1.0)；默认自动读取最新台账")
    parser.add_argument("--days", type=int, default=130, help="backfill 模式回填天数")
    parser.add_argument("--format", choices=["markdown", "json"], default="markdown")
    parser.add_argument("--no-save", action="store_true", help="试运行不写入 SQLite/CSV 台账")
    parser.add_argument("--no-backfill", action="store_true", help="跳过首次自动回填（加快试运行速度）")
    args = parser.parse_args()

    if args.mode == "backfill":
        n_cf = backfill_cffex_basis(days=args.days)
        n_pcr = backfill_option_pcr(days=min(args.days, 65))
        print(f"Backfill complete: CFFEX={n_cf} days, OptionPCR={n_pcr} days.")
        return

    if args.mode == "ledger":
        conn = get_conn()
        try:
            rows = fetch_ledger_recent(conn, limit=15)
        finally:
            conn.close()
        if args.format == "json":
            print(json.dumps(rows, ensure_ascii=False, indent=2))
        else:
            if not rows:
                print("台账为空，请先运行 `--mode daily`。")
            else:
                print("| 交易日 | 对齐状态 | 周/日 | 确认分 | 主波段 | 最终状态(仓位) | 风格仓位 | 红绿灯 |")
                print("| :---: | :---: | :---: | :---: | :--- | :---: | :---: | :--- |")
                for r in rows:
                    print(
                        f"| {r['trade_date']} | {r['date_alignment_status']} | {r['tech_weekly']}/{r['tech_daily']} | "
                        f"{r['confirm_score']:+.1f} | {r['wave_regime']} | {r['final_state']}({r['target_position_pct']:.0f}%) | "
                        f"{r['style_position_pct']:.0f}% | {r['traffic_light']} |"
                    )
        return

    if args.mode == "stock":
        codes = [x.strip() for x in args.stocks.split(",") if x.strip()]
        l1_p = args.l1_pos
        if l1_p is None:
            conn = get_conn()
            try:
                recent = fetch_ledger_recent(conn, limit=1)
                l1_p = float(recent[0]["target_position_pct"]) / 100.0 if recent else 0.5
            finally:
                conn.close()
        res = evaluate_stock_watchlist(codes, l1_target_pos=l1_p)
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return

    # daily or full
    payload = run_daily_pipeline(hysteresis_k=args.k, save=not args.no_save, auto_backfill=not args.no_backfill)
    if args.mode == "full":
        codes = [x.strip() for x in args.stocks.split(",") if x.strip()]
        if not codes:
            # 自动联动今日领涨前 3 行业的领涨股（绝不硬编码自选股）
            codes = [
                x["leader_code"]
                for x in (payload["sectors"].get("top_gainers") or [])[:3]
                if x.get("leader_code")
            ]
        payload["stock_gate"] = evaluate_stock_watchlist(
            codes, l1_target_pos=float(payload["decision"]["target_position"])
        )

    if args.format == "json":
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(render_markdown(payload))


if __name__ == "__main__":
    main()
