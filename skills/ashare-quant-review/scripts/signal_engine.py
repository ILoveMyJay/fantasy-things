#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""三级红绿灯拐点信号引擎 & 自动大阳线中轨监测器 (signal_engine.py)

完全基于确定性量化阈值运行，为交易决策提供清晰的可执行红绿灯信号：
  - 🟢 绿灯（左侧/共振抄底信号）：宽基 ETF 大买 + 两融充分出清 + 期指深贴水 + 科技逆势吸筹 + 新闻催化共振；
  - 🔵 蓝灯（右侧回踩确认信号）：自动锁定近 5 日锚定大阳线，精准监测回踩是否守住“大阳线中轨” + 双创 TCR 降温 + 缩量企稳；
  - 🔴 红灯（过热/风控减仓信号）：双创 TCR > 40% 虹吸过热 / 炸板率高企 / 中信主动做空 / 有效跌破大阳线中轨。
"""

from __future__ import annotations

import json
import sys
import urllib.request
from datetime import datetime
from typing import Any

# 锚定大阳线判定阈值（满足任意宽基放量爆发即锁定）
ANCHOR_THRESHOLDS: dict[str, tuple[str, float]] = {
    "sh000688": ("科创50", 5.0),
    "sz399006": ("创业板指", 4.0),
    "sh000001": ("上证指数", 2.0),
}


def _fetch_recent_index_klines(symbol: str, days: int = 12) -> list[dict[str, Any]]:
    """通过腾讯日K接口拉取指数近 12 个交易日 OHLC（零限流）。"""
    url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={symbol},day,,,{days},qfq"
    rows: list[dict[str, Any]] = []
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            d = json.loads(resp.read().decode("utf-8")).get("data", {}).get(symbol, {})
            raw = d.get("day") or d.get("qfqday") or []
            for r in raw:
                if len(r) >= 6:
                    rows.append({
                        "date": r[0],
                        "open": float(r[1]),
                        "close": float(r[2]),
                        "high": float(r[3]),
                        "low": float(r[4]),
                        "volume": float(r[5]),
                    })
    except Exception as e:
        sys.stderr.write(f"[WARN] 拉取 {symbol} 日K用于中轨计算失败: {e}\n")
    return rows


def detect_anchor_bullish_candle(
    klines_map: dict[str, list[dict[str, Any]]] | None = None,
    live_prices: dict[str, float] | None = None,
    lookback_days: int = 6,
) -> dict[str, Any]:
    """
    自动扫描最近 lookback_days 个交易日内的大阳线，并计算三大核心指数的“大阳线中轨”与当前回踩状态。

    大阳线中轨公式：
        midpoint = (prev_close + close) / 2
        upper_third = close - (close - prev_close) / 3
    """
    if klines_map is None:
        klines_map = {sym: _fetch_recent_index_klines(sym, days=12) for sym in ANCHOR_THRESHOLDS}

    # 以科创50、创业板指、上证指数中任意一个在近 lookback_days 内触发大阳线的最近日期作为锚定日
    anchor_date: str | None = None
    latest_date: str | None = None
    trigger_reason = ""

    # 汇总所有可用日期
    for sym, (name, pct_th) in ANCHOR_THRESHOLDS.items():
        rows = klines_map.get(sym) or []
        if len(rows) < 2:
            continue
        if latest_date is None or rows[-1]["date"] > latest_date:
            latest_date = rows[-1]["date"]

        start_idx = max(1, len(rows) - lookback_days)
        for i in range(len(rows) - 1, start_idx - 1, -1):
            prev_c = rows[i - 1]["close"]
            curr_c = rows[i]["close"]
            if prev_c <= 0:
                continue
            pct = (curr_c - prev_c) / prev_c * 100.0
            if pct >= pct_th:
                if anchor_date is None or rows[i]["date"] > anchor_date:
                    anchor_date = rows[i]["date"]
                    trigger_reason = f"{name}单日大涨 {pct:+.2f}%"
                break

    if not anchor_date:
        return {
            "has_anchor": False,
            "anchor_date": None,
            "days_since_anchor": None,
            "status": "no_recent_anchor",
            "status_note": f"近 {lookback_days} 个交易日内无显著突破型大阳线",
            "levels": {},
        }

    # 计算三大指数在 anchor_date 当日的大阳线中轨与当前价距离
    levels: dict[str, dict[str, Any]] = {}
    days_since = 0
    holding_count = 0
    broken_count = 0

    for sym, (name, _) in ANCHOR_THRESHOLDS.items():
        rows = klines_map.get(sym) or []
        idx = next((i for i, r in enumerate(rows) if r["date"] == anchor_date), None)
        if idx is None or idx == 0:
            continue

        prev_c = rows[idx - 1]["close"]
        anchor_c = rows[idx]["close"]
        anchor_pct = round((anchor_c - prev_c) / prev_c * 100.0, 2) if prev_c > 0 else 0.0
        midpoint = round((prev_c + anchor_c) / 2.0, 2)
        upper_third = round(anchor_c - (anchor_c - prev_c) / 3.0, 2)

        # 当前价优先取 live_prices，否则取最新 K 线收盘价
        code_6 = sym[2:]
        curr_price = (live_prices or {}).get(code_6) or rows[-1]["close"]
        days_since = max(days_since, (len(rows) - 1) - idx)

        dist_to_mid_pct = round((curr_price - midpoint) / midpoint * 100.0, 2) if midpoint > 0 else 0.0
        pullback_from_anchor_pct = round((curr_price - anchor_c) / anchor_c * 100.0, 2) if anchor_c > 0 else 0.0

        if days_since == 0:
            idx_state = "anchor_day"
        elif curr_price >= midpoint:
            idx_state = "above_midpoint"
            holding_count += 1
        else:
            idx_state = "below_midpoint"
            broken_count += 1

        levels[code_6] = {
            "symbol": sym,
            "name": name,
            "prev_close": round(prev_c, 2),
            "anchor_close": round(anchor_c, 2),
            "anchor_pct": anchor_pct,
            "midpoint": midpoint,
            "upper_third": upper_third,
            "current_price": round(curr_price, 2),
            "dist_to_mid_pct": dist_to_mid_pct,
            "pullback_from_anchor_pct": pullback_from_anchor_pct,
            "state": idx_state,
        }

    if days_since == 0:
        status = "anchor_day"
        status_note = f"今日({anchor_date})为大阳线爆发日（{trigger_reason}），已锁定中轨基准供后续 T+1~T+5 监控回踩"
    elif broken_count >= 2 or (levels.get("000688", {}).get("state") == "below_midpoint"):
        status = "broken_below_midpoint"
        status_note = f"距大阳线({anchor_date})已 T+{days_since}，核心指数跌破大阳线中轨，突破失败警示！"
    else:
        status = "holding_above_midpoint"
        status_note = f"距大阳线({anchor_date})已 T+{days_since}，回踩稳守大阳线中轨上方（主力成本区承接有效）"

    return {
        "has_anchor": True,
        "anchor_date": anchor_date,
        "trigger_reason": trigger_reason,
        "days_since_anchor": days_since,
        "status": status,
        "status_note": status_note,
        "levels": levels,
    }


def evaluate_traffic_light_signals(
    data: dict[str, Any],
    anchor_info: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    三级红绿灯拐点信号核心评估器（确定性规则，零主观拍脑袋）。
    """
    tech = data.get("tech_volume") or {}
    sectors = data.get("sector_rotation") or {}
    sentiment = data.get("market_sentiment") or {}
    mb = sentiment.get("market_breadth") or {}
    ls = sentiment.get("limit_structure") or {}
    cffex = data.get("cffex") or {}
    etf_flows = data.get("etf_flows") or {}
    margin_data = data.get("leverage_margin") or {}
    news = data.get("news_catalyst") or {}

    if anchor_info is None:
        idx_detail = tech.get("indices_detail") or {}
        live_px = {
            k: v["price"] for k, v in idx_detail.items()
            if isinstance(v, dict) and v.get("price") is not None
        }
        anchor_info = detect_anchor_bullish_candle(live_prices=live_px)

    # =========================================================================
    # 1. 🟢 绿灯：左侧/共振抄底信号 (5 项硬指标)
    # =========================================================================
    green_checks: list[dict[str, Any]] = []

    etf_total_flow = etf_flows.get("total_flow")
    c_etf = etf_total_flow is not None and etf_total_flow >= 50.0
    green_checks.append({
        "name": "宽基ETF大额净申购(>=50亿)",
        "hit": c_etf,
        "detail": f"已确认净申购 {etf_total_flow:+.2f} 亿" if etf_total_flow is not None else "暂缺",
    })

    em_val = (margin_data.get("em_elasticity") or {}).get("em")
    em_idx_5d = (margin_data.get("em_elasticity") or {}).get("index_pct_5d")
    c_em = em_val is not None and em_idx_5d is not None and em_idx_5d < 0 and em_val > 1.2
    green_checks.append({
        "name": "两融跌势出清充分(Em>1.2)",
        "hit": c_em,
        "detail": f"Em={em_val:.2f} (5日指数{em_idx_5d:+.2f}%)" if (em_val is not None and em_idx_5d is not None) else "未达条件",
    })

    basis_tbl = cffex.get("basis_table") or {}
    ic_ann = (basis_tbl.get("IC") or {}).get("annualized_discount_rate")
    im_ann = (basis_tbl.get("IM") or {}).get("annualized_discount_rate")
    min_ann = min([x for x in (ic_ann, im_ann) if x is not None], default=None)
    c_basis = min_ann is not None and min_ann <= -20.0
    green_checks.append({
        "name": "期指深度贴水保护(IC/IM<=-20%)",
        "hit": c_basis,
        "detail": f"IC={ic_ann}% / IM={im_ann}%" if min_ann is not None else "交割周保护或暂缺",
    })

    med_pct = mb.get("median_change_pct")
    top_inflow = sectors.get("top_inflow") or []
    tech_inflow_lead = any(
        any(k in (s.get("name") or "") for k in ("电子", "通信", "计算机", "半导体", "软件", "机械"))
        and (s.get("net_inflow_yi") or 0) >= 15.0
        for s in top_inflow[:3]
    )
    c_diverge_buy = (med_pct is not None and med_pct < 0) and tech_inflow_lead
    green_checks.append({
        "name": "弱势中科技主力逆势吸筹",
        "hit": c_diverge_buy,
        "detail": f"中位数 {med_pct}% 且科技居资金流入前三" if c_diverge_buy else "未触发逆势背离",
    })

    c_news = bool(news.get("tech_catalyst_active"))
    green_checks.append({
        "name": "重磅科技/政策快讯催化",
        "hit": c_news,
        "detail": f"科技催化 {news.get('tech_catalyst_count', 0)} 条 / 政策 {news.get('policy_catalyst_count', 0)} 条",
    })

    green_hits = sum(1 for x in green_checks if x["hit"])
    # 仅在市场未暴涨过热（TCR <= 40%）时，左侧绿灯才具备左侧建仓意义
    tcr = tech.get("tcr_double_tech") or 0.0
    green_active = (green_hits >= 3) and (tcr <= 40.0)

    # =========================================================================
    # 2. 🔵 蓝灯：右侧回踩确认信号（含大阳线中轨监测）
    # =========================================================================
    blue_checks: list[dict[str, Any]] = []
    has_post_anchor = bool(anchor_info.get("has_anchor")) and (anchor_info.get("days_since_anchor") or 0) >= 1
    blue_checks.append({
        "name": "处于大阳线后 T+1~T+5 验证期",
        "hit": has_post_anchor,
        "detail": anchor_info.get("status_note", "无近期锚定大阳线"),
    })

    c_hold_mid = anchor_info.get("status") == "holding_above_midpoint"
    k50_lvl = (anchor_info.get("levels") or {}).get("000688")
    mid_detail = (
        f"科创50现价 {k50_lvl['current_price']} vs 中轨 {k50_lvl['midpoint']} ({k50_lvl['dist_to_mid_pct']:+.2f}%)"
        if k50_lvl else "暂无中轨数据"
    )
    blue_checks.append({
        "name": "回踩稳守大阳线中轨上方",
        "hit": c_hold_mid,
        "detail": mid_detail,
    })

    c_tcr_cool = 25.0 <= tcr <= 37.5
    blue_checks.append({
        "name": "双创拥挤度 TCR 降温至健康区(25%~37.5%)",
        "hit": c_tcr_cool,
        "detail": f"当前 TCR={tcr}%",
    })

    broken_rate = ls.get("broken_board_rate") or 0.0
    vol_trend = tech.get("volume_trend", "UNKNOWN")
    c_healthy_pullback = (broken_rate < 35.0) and (vol_trend in ("SHRINKING", "EXPANDING"))
    blue_checks.append({
        "name": "盘口承接健康(炸板率<35%)",
        "hit": c_healthy_pullback,
        "detail": f"炸板率 {broken_rate:.1f}% / 量能趋势 {vol_trend}",
    })

    blue_hits = sum(1 for x in blue_checks if x["hit"])
    blue_active = has_post_anchor and c_hold_mid and (blue_hits >= 3)

    # =========================================================================
    # 3. 🔴 红灯：过热/风控减仓信号 (4 项硬指标)
    # =========================================================================
    red_checks: list[dict[str, Any]] = []

    c_tcr_froth = tcr > 40.0
    red_checks.append({
        "name": "双创拥挤度极端过热(TCR>40%)",
        "hit": c_tcr_froth,
        "detail": f"当前 TCR={tcr}%（资金高度虹吸，谨防次日分歧兑现）" if c_tcr_froth else f"当前 TCR={tcr}%（未破红线）",
    })

    limit_down = ls.get("limit_down_count") or 0
    c_sentiment_risk = (broken_rate > 38.0) or (limit_down >= 20)
    red_checks.append({
        "name": "短线情绪退潮(炸板率>38%或跌停>=20)",
        "hit": c_sentiment_risk,
        "detail": f"炸板率 {broken_rate:.1f}% / 跌停 {limit_down} 家",
    })

    citic_tag = (cffex.get("citic_behavior") or {}).get("behavior_tag", "")
    c_citic_short = citic_tag == "主动做空动能"
    red_checks.append({
        "name": "中信席位主动做空动能",
        "hit": c_citic_short,
        "detail": f"当前中信定性【{citic_tag or 'N/A'}】",
    })

    c_mid_broken = anchor_info.get("status") == "broken_below_midpoint"
    red_checks.append({
        "name": "有效跌破大阳线中轨(突破失败)",
        "hit": c_mid_broken,
        "detail": mid_detail if c_mid_broken else "未破位",
    })

    red_hits = sum(1 for x in red_checks if x["hit"])
    red_active = red_hits >= 1

    # =========================================================================
    # 综合主灯裁决与通知开关
    # =========================================================================
    if red_active and not blue_active:
        primary_light = "🔴 红灯警戒"
        if anchor_info.get("status") == "anchor_day":
            action_call = (
                "短线情绪与拥挤度已冲破红线，空仓严禁追高！系统已锁定今日大阳线中轨，"
                "请耐心等待后续 T+1~T+3 回踩不破中轨且 TCR 回落至 37% 以下的 🔵 蓝灯买点。"
            )
        elif c_mid_broken:
            action_call = "已跌破近期大阳线中轨，短线突破大概率失效，严守防守纪律、禁止抄底。"
        else:
            action_call = "触发过热或情绪退潮风控红灯，有仓位建议逢高分批锁利，空仓坚决观望。"
        should_notify = True
        notify_reason = "触发 🔴 风控红灯（" + "；".join(x["name"] for x in red_checks if x["hit"]) + "）"
    elif blue_active:
        primary_light = "🔵 蓝灯确认（右侧回踩买点）"
        action_call = (
            f"大阳线({anchor_info.get('anchor_date')})后回踩稳守中轨上方，且双创拥挤度已降温至 {tcr}%，"
            "满足右侧高盈亏比低吸条件，可按计划分批布局领涨主线核心龙头，以跌破中轨作硬止损。"
        )
        should_notify = True
        notify_reason = f"触发 🔵 右侧回踩确认信号（稳守大阳线中轨，TCR={tcr}%）"
    elif green_active:
        primary_light = "🟢 绿灯共振（左侧高胜率机会）"
        action_call = (
            f"左侧底部共振命中 {green_hits}/5 项硬指标（筹码出清/大资金托底/催化对齐），"
            "具备极佳左侧盈亏比，可分批试探布局宽基 ETF 或逆势吸筹主线龙头。"
        )
        should_notify = True
        notify_reason = f"触发 🟢 左侧共振信号（命中 {green_hits}/5 项）"
    else:
        primary_light = "⚪ 灰灯观望（无极端共振信号）"
        action_call = "当前未触发强买点或强风控警报，按常规震荡节奏控仓观察即可。"
        should_notify = False
        notify_reason = "常规状态，无需打扰推送"

    return {
        "primary_light": primary_light,
        "action_call": action_call,
        "should_notify": should_notify,
        "notify_reason": notify_reason,
        "green": {"active": green_active, "hits": green_hits, "total": len(green_checks), "checks": green_checks},
        "blue": {"active": blue_active, "hits": blue_hits, "total": len(blue_checks), "checks": blue_checks},
        "red": {"active": red_active, "hits": red_hits, "total": len(red_checks), "checks": red_checks},
        "anchor_candle": anchor_info,
    }
