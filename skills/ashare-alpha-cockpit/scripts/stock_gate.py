#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
stock_gate.py - Phase 2 解耦式个股趋势评估与买前风控闸门 (ashare-alpha-cockpit)。

独立于大盘决策层（不反向污染 L1 大盘方向），但单向耦合 L1 大盘总仓位上限：
  1. 多周期趋势共振：周/日一目均衡表 + VW-MACD + MA20/60/120 多头排列；
  2. 相对强弱 (RS Alpha)：20D / 60D 相对沪深300 及 所属风格基准（科创50/创业板）超额收益；
  3. 买点形态与追高风控：个股大阳线中轨回踩 / MA10-20 趋势支撑 / VCP 缩量收敛 / 偏离 MA20>12% 追高拦截；
  4. 资金与换手健康度：东财 emdatah5 当日主力 + push2his 3D/5D 累计主力流向 + 严格 ETF 防火墙；
  5. 结构止损与盈亏比门禁：基于 10日波段低点 / 2×ATR14 / 大阳线中轨计算硬止损与 R:R，耦合 L1 仓位上限输出 PASS / WATCH / VETO。
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_ROOT = SCRIPT_DIR.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from cockpit_engine import load_config
from fetch_tech_timing import _resample_weekly_causal, compute_tech_indicators, fetch_index_kline

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
ETF_PREFIXES = ("51", "56", "58", "159", "501", "502", "16")


def normalize_stock_code(raw: str) -> str:
    digits = re.sub(r"[^0-9]", "", str(raw or ""))
    return digits[-6:].zfill(6) if digits else ""


def is_etf_or_fund(code: str) -> bool:
    return code.startswith(ETF_PREFIXES)


def _to_sina_symbol(code: str) -> str:
    if code.startswith(("6", "9")):
        return f"sh{code}"
    if code.startswith(("4", "8", "92")):
        return f"bj{code}"
    return f"sz{code}"


def _fetch_stock_kline(code: str, period: str = "day", limit: int = 240) -> Optional[pd.DataFrame]:
    sym = _to_sina_symbol(code)
    url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={sym},{period},,,{limit},qfq"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=6) as resp:
            d = json.loads(resp.read().decode("utf-8")).get("data", {}).get(sym, {})
            raw = d.get(f"qfq{period}") or d.get(period) or []
            rows = []
            for r in raw:
                if len(r) >= 6:
                    c, v = float(r[2]), float(r[5])
                    rows.append({
                        "date": str(r[0]), "open": float(r[1]), "close": c,
                        "high": float(r[3]), "low": float(r[4]),
                        "volume": v, "amount": v * c,
                    })
            df = pd.DataFrame(rows)
            min_len = 60 if period == "week" else 65
            return df if len(df) >= min_len else None
    except Exception:
        return None


def _fetch_stock_quote_tencent(code: str) -> Dict[str, Any]:
    sym = _to_sina_symbol(code)
    url = f"https://qt.gtimg.cn/q={sym}"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=5) as resp:
            text = resp.read().decode("gbk", errors="ignore")
            if "~" in text:
                p = text.split("~")
                if len(p) > 45:
                    return {
                        "name": p[1],
                        "price": float(p[3]) if p[3] else None,
                        "pct_chg": float(p[32]) if p[32] else None,
                        "turnover_yi": round(float(p[37]) / 1e4, 2) if p[37] else None,
                        "turnover_rate": float(p[38]) if p[38] else None,
                        "circ_cap_yi": float(p[44]) if p[44] else None,
                    }
    except Exception:
        pass
    return {}


def _fetch_stock_main_flow(code: str) -> Dict[str, Optional[float]]:
    """东财 emdatah5 当日主力净流入 + push2his 3D/5D 主力累计（亿元），严禁伪造。"""
    market = "1" if code.startswith(("6", "9")) else "0"
    secid = f"{market}.{code}"
    out: Dict[str, Optional[float]] = {"main_flow_1d_yi": None, "main_flow_3d_yi": None, "main_flow_5d_yi": None}

    try:
        url = f"https://emdatah5.eastmoney.com/dc/ZJLX/getZJLXData?secid={secid}&fields=f57,f58,f137"
        req = urllib.request.Request(url, headers={**HEADERS, "Referer": "https://emdatah5.eastmoney.com/"})
        with urllib.request.urlopen(req, timeout=4) as r:
            d = (json.loads(r.read().decode("utf-8")).get("data") or {})
            if d.get("f137") is not None:
                out["main_flow_1d_yi"] = round(float(d["f137"]) / 1e8, 2)
    except Exception:
        pass

    try:
        url = (
            f"http://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get"
            f"?lmt=5&klt=101&secid={secid}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56"
        )
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=4) as r:
            kl = (json.loads(r.read().decode("utf-8")).get("data") or {}).get("klines") or []
            vals = [float(row.split(",")[1]) / 1e8 for row in kl if len(row.split(",")) >= 2]
            if vals:
                out["main_flow_3d_yi"] = round(sum(vals[-3:]), 2) if len(vals) >= 3 else round(sum(vals), 2)
                out["main_flow_5d_yi"] = round(sum(vals[-5:]), 2) if len(vals) >= 5 else round(sum(vals), 2)
                if out["main_flow_1d_yi"] is None:
                    out["main_flow_1d_yi"] = round(vals[-1], 2)
    except Exception:
        pass
    return out


def _l1_single_stock_cap(l1_target_pos: float, cfg: Dict[str, Any]) -> Tuple[float, str]:
    tiers = cfg["phase2_stock_gate"]["max_single_stock_pct_by_l1_exposure"]
    for t in tiers:
        if l1_target_pos >= float(t["min_l1_pos"]):
            return float(t["max_single_pct"]), str(t["regime_label"])
    return 0.0, "空仓防守期（严禁新开多仓）"


def evaluate_single_stock_gate(
    code: str,
    name: str,
    df_daily: pd.DataFrame,
    df_weekly: Optional[pd.DataFrame] = None,
    bench_hs300: Optional[pd.DataFrame] = None,
    bench_style: Optional[pd.DataFrame] = None,
    quote: Optional[Dict[str, Any]] = None,
    flow: Optional[Dict[str, Optional[float]]] = None,
    l1_target_pos: float = 0.5,
    cfg: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    纯函数个股趋势与买前风控闸门（支持离线单元测试与实盘统一调用）。
    """
    full_cfg = cfg or load_config()
    gc = full_cfg["phase2_stock_gate"]
    code = normalize_stock_code(code)

    if is_etf_or_fund(code):
        return {
            "code": code, "name": name or code, "status": "BLOCKED_ETF",
            "verdict": "⛔ VETO (ETF防火墙拦截)",
            "reasons": ["宽基/行业 ETF 严禁套用个股 DDX 与微观风控闸门，请直接参考 L1/L3 指数仓位"],
        }

    df = df_daily.sort_values("date").reset_index(drop=True).copy()
    if len(df) < 65:
        return {
            "code": code, "name": name or code, "status": "ERROR",
            "verdict": "⛔ VETO (上市/样本不足65日)", "reasons": ["日K历史不足 65 个交易日"],
        }

    c = df["close"].astype(float)
    h = df["high"].astype(float)
    l = df["low"].astype(float)
    v = df["volume"].astype(float)
    px = float(c.iloc[-1])

    # 1. 多周期趋势（日K + 周K + MA20/60/120）
    daily_ind = compute_tech_indicators(df)
    df_w = df_weekly if (df_weekly is not None and len(df_weekly) >= 60) else _resample_weekly_causal(df, limit=120)
    weekly_ind = compute_tech_indicators(df_w) if df_w is not None else {"signal": "未知", "score": 0.0}

    ma10 = float(c.rolling(10).mean().iloc[-1])
    ma20 = float(c.rolling(20).mean().iloc[-1])
    ma20_prev5 = float(c.rolling(20).mean().iloc[-6]) if len(c) >= 26 else ma20
    ma60 = float(c.rolling(60).mean().iloc[-1])
    ma120 = float(c.rolling(120).mean().iloc[-1]) if len(c) >= 120 else None

    ma20_rising = ma20 >= ma20_prev5
    ma_bull_stack = (px > ma20 > ma60) and (ma120 is None or ma60 >= ma120 * 0.98)
    ext_ma20_pct = round((px / ma20 - 1.0) * 100.0, 2) if ma20 > 0 else 0.0

    # 2. 相对强弱 RS Alpha (20D / 60D)
    ret20 = (px / float(c.iloc[-21]) - 1.0) * 100.0 if len(c) >= 21 else 0.0
    ret60 = (px / float(c.iloc[-61]) - 1.0) * 100.0 if len(c) >= 61 else 0.0

    def _bench_ret(bdf: Optional[pd.DataFrame], n_bars: int) -> Optional[float]:
        if bdf is None or len(bdf) <= n_bars:
            return None
        bc = bdf["close"].astype(float)
        return (float(bc.iloc[-1]) / float(bc.iloc[-(n_bars + 1)]) - 1.0) * 100.0

    b_hs20, b_hs60 = _bench_ret(bench_hs300, 20), _bench_ret(bench_hs300, 60)
    b_st20 = _bench_ret(bench_style, 20)
    rs20_hs300 = round(ret20 - b_hs20, 2) if b_hs20 is not None else None
    rs60_hs300 = round(ret60 - b_hs60, 2) if b_hs60 is not None else None
    rs20_style = round(ret20 - b_st20, 2) if b_st20 is not None else None

    # 3. 买点形态识别：大阳线中轨回踩 / MA10-20 支撑 / VCP 缩量收敛
    pct_s = c.pct_change() * 100.0
    anchor_mid = None
    anchor_holding = False
    for j in range(len(df) - 2, max(0, len(df) - 7), -1):
        if pd.notna(pct_s.iloc[j]) and float(pct_s.iloc[j]) >= 6.0:
            mid = (float(c.iloc[j - 1]) + float(c.iloc[j])) / 2.0
            anchor_mid = round(mid, 2)
            anchor_holding = px >= mid
            break

    # ATR14 与 VCP 波动收敛
    tr = pd.concat([(h - l), (h - c.shift(1)).abs(), (l - c.shift(1)).abs()], axis=1).max(axis=1)
    atr5 = float(tr.tail(5).mean())
    atr14 = float(tr.tail(14).mean())
    atr20 = float(tr.tail(20).mean())
    vcp_ratio = round(atr5 / atr20, 2) if atr20 > 1e-9 else 1.0
    hi20 = float(h.tail(20).max())
    is_vcp = (vcp_ratio <= 0.72) and (px >= hi20 * 0.92) and ma20_rising
    is_ma_pullback = (-2.5 <= ext_ma20_pct <= 5.5) and ma20_rising and (px >= ma20 * 0.975)

    setups: List[str] = []
    if anchor_mid is not None and anchor_holding:
        setups.append(f"稳守大阳线中轨({anchor_mid})")
    if is_ma_pullback:
        setups.append("回踩MA10/20趋势支撑")
    if is_vcp:
        setups.append(f"VCP波动收敛(ATR5/20={vcp_ratio})")
    if not setups:
        setups.append("常规运行/无典型低吸形态")

    # 4. 资金流与流动性健康
    q = quote or {}
    fl = flow or {}
    turnover_yi = q.get("turnover_yi")
    if turnover_yi is None and "amount" in df.columns:
        turnover_yi = round(float(df["amount"].iloc[-1]) / 1e8, 2)
    turnover_rate = q.get("turnover_rate")
    circ_cap_yi = q.get("circ_cap_yi")
    f1 = fl.get("main_flow_1d_yi")
    f5 = fl.get("main_flow_5d_yi")
    ddx_5d_pct = round(f5 / circ_cap_yi * 100.0, 2) if (f5 is not None and circ_cap_yi and circ_cap_yi > 0) else None

    # 5. 结构止损与盈亏比计算
    swing_low_10 = float(l.tail(10).min())
    atr_stop = px - 2.0 * atr14
    stop_candidates = [swing_low_10, atr_stop]
    if anchor_mid is not None and anchor_holding and anchor_mid < px:
        stop_candidates.append(anchor_mid * 0.99)
    stop_loss = round(max(stop_candidates), 2)
    if stop_loss >= px * 0.985:
        stop_loss = round(px - 1.5 * atr14, 2)
    stop_dist_pct = round((px - stop_loss) / px * 100.0, 2) if px > 0 else 99.0

    hi60 = float(h.tail(60).max())
    target_px = round(max(hi60, px + 2.5 * atr14), 2)
    upside_pct = round((target_px - px) / px * 100.0, 2) if px > 0 else 0.0
    rr_ratio = round(upside_pct / stop_dist_pct, 2) if stop_dist_pct > 0.1 else 0.0

    # 6. 综合评分 (0~100) 与 买前硬风控闸门裁决
    score = 50
    if weekly_ind.get("signal") == "多":
        score += 15
    elif weekly_ind.get("signal") == "空":
        score -= 20
    if daily_ind.get("signal") == "多":
        score += 15
    elif daily_ind.get("signal") == "空":
        score -= 20
    if ma_bull_stack:
        score += 10
    if rs20_hs300 is not None and rs20_hs300 >= 3.0:
        score += 10
    elif rs20_hs300 is not None and rs20_hs300 <= -5.0:
        score -= 10
    if f5 is not None and f5 > 0:
        score += 5
    elif f5 is not None and f5 < -2.0:
        score -= 8
    if anchor_holding or is_ma_pullback or is_vcp:
        score += 8
    score = max(0, min(100, score))

    max_pos_pct, l1_regime_lbl = _l1_single_stock_cap(l1_target_pos, full_cfg)
    veto_reasons: List[str] = []
    watch_reasons: List[str] = []

    if max_pos_pct <= 0.0:
        veto_reasons.append(f"大盘 L1 处于【{l1_regime_lbl}】，总仓位上限 0%，严禁新开多仓")
    if daily_ind.get("signal") == "空" and weekly_ind.get("signal") == "空":
        veto_reasons.append("个股周K/日K双空共振破位")
    if ext_ma20_pct > float(gc["max_chase_ext_ma20_pct"]):
        veto_reasons.append(f"偏离 MA20 达 {ext_ma20_pct:+.1f}% (>{gc['max_chase_ext_ma20_pct']}%)，追高风险红灯")
    if turnover_yi is not None and turnover_yi < float(gc["min_turnover_yi"]):
        veto_reasons.append(f"日成交额仅 {turnover_yi:.2f} 亿 (<{gc['min_turnover_yi']}亿)，流动性不足")
    if stop_dist_pct > float(gc["max_stop_distance_pct"]):
        watch_reasons.append(f"结构止损距离 {stop_dist_pct:.1f}% 偏宽 (>{gc['max_stop_distance_pct']}%)，建议等回踩降风险")
    if rr_ratio < float(gc["min_rr_ratio"]):
        watch_reasons.append(f"盈亏比 R:R={rr_ratio:.2f} 偏低 (<{gc['min_rr_ratio']})")
    if daily_ind.get("signal") != "多":
        watch_reasons.append(f"日K趋势尚未确认转多（当前 {daily_ind.get('signal')}）")
    if turnover_rate is not None and turnover_rate > 20.0:
        watch_reasons.append(f"换手率过高({turnover_rate:.1f}%>20%)，筹码过热谨防分歧")

    if veto_reasons:
        verdict = "⛔ VETO (拦截/严禁追买)"
        suggested_pos_pct = 0.0
    elif watch_reasons or score < 65:
        verdict = "🟡 WATCH (观察/等回踩或确认)"
        suggested_pos_pct = round(min(max_pos_pct * 0.5, max_pos_pct), 1)
    else:
        verdict = "✅ PASS (通过闸门/可分批执行)"
        suggested_pos_pct = max_pos_pct

    return {
        "code": code,
        "name": name or q.get("name") or code,
        "status": "OK",
        "trade_date": str(df["date"].iloc[-1]),
        "price": round(px, 2),
        "pct_chg": q.get("pct_chg") if q.get("pct_chg") is not None else daily_ind.get("ret_1d_pct"),
        "weekly_signal": weekly_ind.get("signal"),
        "daily_signal": daily_ind.get("signal"),
        "ma_bull_stack": ma_bull_stack,
        "ext_ma20_pct": ext_ma20_pct,
        "rs20_hs300_pct": rs20_hs300,
        "rs60_hs300_pct": rs60_hs300,
        "rs20_style_pct": rs20_style,
        "setups": setups,
        "turnover_yi": turnover_yi,
        "turnover_rate": turnover_rate,
        "main_flow_1d_yi": f1,
        "main_flow_3d_yi": fl.get("main_flow_3d_yi"),
        "main_flow_5d_yi": f5,
        "ddx_5d_pct": ddx_5d_pct,
        "stop_loss": stop_loss,
        "stop_dist_pct": stop_dist_pct,
        "target_price": target_px,
        "rr_ratio": rr_ratio,
        "score": score,
        "l1_cap_pct": max_pos_pct,
        "suggested_pos_pct": suggested_pos_pct,
        "verdict": verdict,
        "veto_reasons": veto_reasons,
        "watch_reasons": watch_reasons,
    }


def evaluate_stock_watchlist(
    codes: List[str],
    l1_target_pos: float = 0.5,
) -> Dict[str, Any]:
    """实盘批量评估任意动态自选股/行业龙头列表。"""
    clean_codes = []
    seen = set()
    for c in codes:
        nc = normalize_stock_code(c)
        if nc and nc not in seen:
            seen.add(nc)
            clean_codes.append(nc)

    if not clean_codes:
        return {"status": "EMPTY", "results": [], "note": "未传入股票代码"}

    bench_hs300 = fetch_index_kline("1.000300", klt=101, limit=120)
    bench_k50 = fetch_index_kline("1.000688", klt=101, limit=120)
    bench_cyb = fetch_index_kline("0.399006", klt=101, limit=120)

    results = []
    for code in clean_codes:
        if is_etf_or_fund(code):
            results.append(evaluate_single_stock_gate(code, code, pd.DataFrame(), l1_target_pos=l1_target_pos))
            continue
        df_d = _fetch_stock_kline(code, period="day", limit=240)
        df_w = _fetch_stock_kline(code, period="week", limit=160)
        q = _fetch_stock_quote_tencent(code)
        fl = _fetch_stock_main_flow(code)
        if df_d is None:
            results.append({
                "code": code, "name": q.get("name") or code, "status": "ERROR",
                "verdict": "⛔ VETO (行情K线获取失败)", "veto_reasons": ["日K接口暂不可用（严守零造假）"],
            })
            continue
        style_b = bench_k50 if code.startswith(("688", "689")) else (bench_cyb if code.startswith(("300", "301")) else bench_hs300)
        results.append(
            evaluate_single_stock_gate(
                code=code, name=q.get("name") or code, df_daily=df_d, df_weekly=df_w,
                bench_hs300=bench_hs300, bench_style=style_b,
                quote=q, flow=fl, l1_target_pos=l1_target_pos,
            )
        )

    results.sort(key=lambda x: (x.get("score") or -1), reverse=True)
    return {
        "status": "OK",
        "l1_target_position_pct": round(l1_target_pos * 100.0, 1),
        "count": len(results),
        "results": results,
    }


if __name__ == "__main__":
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
    codes_in = sys.argv[1].split(",") if len(sys.argv) > 1 else []
    print(json.dumps(evaluate_stock_watchlist(codes_in), ensure_ascii=False, indent=2))
