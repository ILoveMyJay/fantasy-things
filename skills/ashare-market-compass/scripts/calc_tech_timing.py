#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
calc_tech_timing.py - 第四层：多周期技术面择时引擎（周K定大趋势，日K找入场）
实现布鲁斯同款技术配置：
1. 主图：一目均衡表（Ichimoku 9/26/52：云层位置 + 出云受阻/三出识别）
2. 副图1：VW-MACD（成交量加权 MACD 12/26/9，防范无量画线）
3. 副图2：布林带 (20, 2) 轨道位置 (%B)
4. 副图3：原版 CCI (14) 顶底背离检测
"""

import json
import sys
import time
import urllib.request
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://quote.eastmoney.com/",
}
EM_KLINE_HOSTS = [
    "https://push2his.eastmoney.com/api/qt/stock/kline/get",
    "https://64.push2his.eastmoney.com/api/qt/stock/kline/get",
]


def _fetch_index_kline_sina(secid: str, klt: int = 101, limit: int = 180) -> Optional[pd.DataFrame]:
    """东财 WAF 限流时的自动备源：新浪官方指数日K（周K由日K按 W-FRI 严格无未来重采样）"""
    sym_map = {
        "1.000001": "sh000001",
        "1.000300": "sh000300",
        "0.399006": "sz399006",
        "1.000688": "sh000688",
        "1.000985": "sh000985",
    }
    sina_sym = sym_map.get(secid)
    if not sina_sym:
        return None
    try:
        import akshare as ak
        df = ak.stock_zh_index_daily(symbol=sina_sym)
        if df is None or df.empty:
            return None
        df = df.copy()
        df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
        df = df.sort_values("date").reset_index(drop=True)
        for col in ("open", "high", "low", "close", "volume"):
            df[col] = pd.to_numeric(df[col], errors="coerce")
        df["amount"] = df["volume"] * df["close"]
        if klt == 102:
            w = df.tail(max(limit * 6, 900)).copy()
            w["dt"] = pd.to_datetime(w["date"])
            w = (
                w.set_index("dt")
                .resample("W-FRI")
                .agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum", "amount": "sum"})
                .dropna()
                .reset_index()
            )
            w["date"] = w["dt"].dt.strftime("%Y-%m-%d")
            res = w[["date", "open", "close", "high", "low", "volume", "amount"]].tail(limit).reset_index(drop=True)
        else:
            res = df[["date", "open", "close", "high", "low", "volume", "amount"]].tail(limit).reset_index(drop=True)
        return res if len(res) >= 60 else None
    except Exception as e:
        sys.stderr.write(f"[calc_tech_timing] sina fallback {secid} klt={klt} failed: {e}\n")
        return None


def fetch_index_kline(secid: str, klt: int = 101, limit: int = 180) -> Optional[pd.DataFrame]:
    """
    klt=101 日K, klt=102 周K
    fields2: f51日期, f52开, f53收, f54高, f55低, f56成交量, f57成交额
    优先东财，若东财 WAF 断连则自动切换新浪备源（严守零造假）。
    """
    last_err = None
    for attempt in range(2):
        base = EM_KLINE_HOSTS[attempt % len(EM_KLINE_HOSTS)]
        url = (
            f"{base}?secid={secid}&fields1=f1,f2&fields2=f51,f52,f53,f54,f55,f56,f57"
            f"&klt={klt}&fqt=1&end=20500101&lmt={limit}"
        )
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=5) as r:
                klines = (json.loads(r.read().decode("utf-8")).get("data") or {}).get("klines") or []
            if not klines:
                continue
            rows = []
            for line in klines:
                p = line.split(",")
                if len(p) >= 7:
                    rows.append(
                        {
                            "date": p[0],
                            "open": float(p[1]),
                            "close": float(p[2]),
                            "high": float(p[3]),
                            "low": float(p[4]),
                            "volume": float(p[5]),
                            "amount": float(p[6]),
                        }
                    )
            df = pd.DataFrame(rows)
            if len(df) >= 60:
                return df
        except Exception as e:
            last_err = e
            time.sleep(0.25 * (attempt + 1))

    # 自动切换新浪备源
    df_fb = _fetch_index_kline_sina(secid, klt=klt, limit=limit)
    if df_fb is not None:
        return df_fb
    sys.stderr.write(f"[calc_tech_timing] kline {secid} klt={klt} failed after retries & fallback: {last_err}\n")
    return None


def calc_vwma(close: pd.Series, volume: pd.Series, span: int) -> pd.Series:
    pv = close * volume
    vol_sum = volume.rolling(window=span, min_periods=span).sum()
    return pv.rolling(window=span, min_periods=span).sum() / vol_sum.replace(0, np.nan)


def compute_tech_indicators(df: pd.DataFrame) -> Dict[str, Any]:
    """纯函数：对 OHLCV DataFrame 计算一目均衡表、VW-MACD、布林带与 CCI 背离"""
    c = df["close"].astype(float)
    h = df["high"].astype(float)
    l = df["low"].astype(float)
    v = df["volume"].astype(float).clip(lower=1.0)

    # 1. 一目均衡表 (9, 26, 52)
    tenkan = (h.rolling(9).max() + l.rolling(9).min()) / 2.0
    kijun = (h.rolling(26).max() + l.rolling(26).min()) / 2.0
    span_a = ((tenkan + kijun) / 2.0).shift(26)
    span_b = ((h.rolling(52).max() + l.rolling(52).min()) / 2.0).shift(26)

    cloud_top = pd.concat([span_a, span_b], axis=1).max(axis=1)
    cloud_bot = pd.concat([span_a, span_b], axis=1).min(axis=1)

    px = float(c.iloc[-1])
    ct = float(cloud_top.iloc[-1]) if pd.notna(cloud_top.iloc[-1]) else None
    cb = float(cloud_bot.iloc[-1]) if pd.notna(cloud_bot.iloc[-1]) else None

    if ct is None or cb is None:
        cloud_pos = "UNKNOWN"
    elif px > ct:
        cloud_pos = "ABOVE_CLOUD"
    elif px < cb:
        cloud_pos = "BELOW_CLOUD"
    else:
        cloud_pos = "IN_CLOUD"

    # 检测近 30 根K线“跌破云后试图出云受阻”次数（三出失败特征）
    failed_breakouts = 0
    recent = df.tail(30).index
    in_attempt = False
    for idx in recent:
        if pd.isna(cloud_top.loc[idx]) or pd.isna(cloud_bot.loc[idx]):
            continue
        hi, cl = float(h.loc[idx]), float(c.loc[idx])
        top, bot = float(cloud_top.loc[idx]), float(cloud_bot.loc[idx])
        if hi >= bot and cl < top:
            if not in_attempt:
                failed_breakouts += 1
                in_attempt = True
        elif cl < bot:
            in_attempt = False

    # 2. VW-MACD (12, 26, 9)
    vw_fast = calc_vwma(c, v, 12)
    vw_slow = calc_vwma(c, v, 26)
    vw_dif = vw_fast - vw_slow
    vw_dea = vw_dif.ewm(span=9, adjust=False).mean()
    vw_hist = (vw_dif - vw_dea) * 2.0

    dif_now = float(vw_dif.iloc[-1]) if pd.notna(vw_dif.iloc[-1]) else None
    dea_now = float(vw_dea.iloc[-1]) if pd.notna(vw_dea.iloc[-1]) else None
    hist_now = float(vw_hist.iloc[-1]) if pd.notna(vw_hist.iloc[-1]) else None

    if dif_now is None or dea_now is None:
        vw_state = "UNKNOWN"
    elif dif_now > 0 and dif_now >= dea_now:
        vw_state = "BULL_ABOVE_ZERO"
    elif dif_now < 0 and dif_now <= dea_now:
        vw_state = "BEAR_BELOW_ZERO"
    elif dif_now < 0 and dif_now > dea_now:
        vw_state = "WEAK_REBOUND_BELOW_ZERO"
    else:
        vw_state = "WEAKENING_ABOVE_ZERO"

    # 3. 布林带 (20, 2)
    bb_mid = c.rolling(20).mean()
    bb_std = c.rolling(20).std(ddof=0)
    bb_up = bb_mid + 2.0 * bb_std
    bb_dn = bb_mid - 2.0 * bb_std
    mid_v, up_v, dn_v = float(bb_mid.iloc[-1]), float(bb_up.iloc[-1]), float(bb_dn.iloc[-1])
    bb_pct_b = round((px - dn_v) / (up_v - dn_v), 3) if (up_v - dn_v) > 1e-9 else 0.5

    if bb_pct_b >= 0.85:
        bb_pos = "上轨压制区"
    elif bb_pct_b <= 0.15:
        bb_pos = "下轨超卖区"
    elif bb_pct_b >= 0.5:
        bb_pos = "中轨偏上"
    else:
        bb_pos = "中轨偏下"

    # 4. 原版 CCI (14) + 近 25 根 K 线顶底背离粗筛
    tp = (h + l + c) / 3.0
    tp_ma = tp.rolling(14).mean()
    md = tp.rolling(14).apply(lambda x: np.mean(np.abs(x - np.mean(x))), raw=True)
    cci = (tp - tp_ma) / (0.015 * md.replace(0, np.nan))
    cci_now = round(float(cci.iloc[-1]), 2) if pd.notna(cci.iloc[-1]) else None

    # 简易前后半段极值背离判定（最近 12 根 vs 前 13~25 根）
    cci_div = "NONE"
    if len(df) >= 26 and cci.tail(25).notna().all():
        prev_c_hi, curr_c_hi = float(c.iloc[-25:-12].max()), float(c.iloc[-12:].max())
        prev_cci_hi, curr_cci_hi = float(cci.iloc[-25:-12].max()), float(cci.iloc[-12:].max())
        prev_c_lo, curr_c_lo = float(c.iloc[-25:-12].min()), float(c.iloc[-12:].min())
        prev_cci_lo, curr_cci_lo = float(cci.iloc[-25:-12].min()), float(cci.iloc[-12:].min())
        if curr_c_hi > prev_c_hi * 1.003 and curr_cci_hi < prev_cci_hi - 15.0:
            cci_div = "TOP_DIVERGENCE"
        elif curr_c_lo < prev_c_lo * 0.997 and curr_cci_lo > prev_cci_lo + 15.0:
            cci_div = "BOTTOM_DIVERGENCE"

    # 单周期技术综合打分 (-3 ~ +3)
    score = 0
    if cloud_pos == "ABOVE_CLOUD":
        score += 1
    elif cloud_pos == "BELOW_CLOUD":
        score -= 1
    if vw_state == "BULL_ABOVE_ZERO":
        score += 1
    elif vw_state == "BEAR_BELOW_ZERO":
        score -= 1
    elif vw_state == "WEAK_REBOUND_BELOW_ZERO":
        score -= 0.5
    elif vw_state == "WEAKENING_ABOVE_ZERO":
        score += 0.5
    if cci_div == "TOP_DIVERGENCE":
        score -= 1
    elif cci_div == "BOTTOM_DIVERGENCE":
        score += 1
    elif cci_now is not None:
        if cci_now > 50:
            score += 0.5
        elif cci_now < -50:
            score -= 0.5

    if score >= 1.0:
        signal = "多"
    elif score <= -1.0:
        signal = "空"
    else:
        signal = "中性"

    return {
        "date": str(df["date"].iloc[-1]),
        "close": round(px, 2),
        "ichimoku": {
            "position": cloud_pos,
            "cloud_top": round(ct, 2) if ct is not None else None,
            "cloud_bottom": round(cb, 2) if cb is not None else None,
            "failed_cloud_breakouts_30": failed_breakouts,
        },
        "vw_macd": {
            "dif": round(dif_now, 2) if dif_now is not None else None,
            "dea": round(dea_now, 2) if dea_now is not None else None,
            "hist": round(hist_now, 2) if hist_now is not None else None,
            "state": vw_state,
        },
        "bollinger": {
            "mid": round(mid_v, 2),
            "upper": round(up_v, 2),
            "lower": round(dn_v, 2),
            "pct_b": bb_pct_b,
            "position": bb_pos,
        },
        "cci": {
            "value": cci_now,
            "divergence": cci_div,
        },
        "score": round(score, 2),
        "signal": signal,
    }


def fetch_tech_timing_dashboard() -> Dict[str, Any]:
    """
    1. 核心大盘（定总仓位）：上证指数(000001) + 沪深300(000300) 的周K(定大趋势)与日K(找入场)
    2. 双创科技风格子面板（仅作风格轮动与强弱排序参考，不干扰大盘总仓位仲裁）：
       创业板指(399006) + 科创50(000688) 的周K与日K
    """
    core_targets = [("SH000001", "1.000001", "上证指数"), ("SH000300", "1.000300", "沪深300")]
    style_targets = [("SZ399006", "0.399006", "创业板指"), ("SH000688", "1.000688", "科创50")]

    results: Dict[str, Any] = {}
    for key, secid, name in core_targets:
        df_w = fetch_index_kline(secid, klt=102, limit=160)
        df_d = fetch_index_kline(secid, klt=101, limit=180)
        results[key] = {
            "name": name,
            "weekly": compute_tech_indicators(df_w) if df_w is not None else {"status": "ERROR"},
            "daily": compute_tech_indicators(df_d) if df_d is not None else {"status": "ERROR"},
        }

    style_results: Dict[str, Any] = {}
    for key, secid, name in style_targets:
        df_w = fetch_index_kline(secid, klt=102, limit=160)
        df_d = fetch_index_kline(secid, klt=101, limit=180)
        style_results[key] = {
            "name": name,
            "weekly": compute_tech_indicators(df_w) if df_w is not None else {"status": "ERROR"},
            "daily": compute_tech_indicators(df_d) if df_d is not None else {"status": "ERROR"},
        }

    # 以核心大盘(上证 + 沪深300)综合得出技术面周线与日线判定（绝不混入双创高波动）
    w_sigs = [results[k]["weekly"].get("signal") for k in results if results[k]["weekly"].get("signal")]
    d_sigs = [results[k]["daily"].get("signal") for k in results if results[k]["daily"].get("signal")]

    def _agg(sigs: List[str]) -> str:
        if not sigs:
            return "未知"
        bull = sigs.count("多")
        bear = sigs.count("空")
        if bull > bear and bull >= 1:
            return "多"
        if bear > bull and bear >= 1:
            return "空"
        return "中性"

    weekly_sig = _agg(w_sigs)
    daily_sig = _agg(d_sigs)

    # 双创科技风格强弱摘要（纯风格参考）
    sw_sigs = [style_results[k]["weekly"].get("signal") for k in style_results if style_results[k]["weekly"].get("signal")]
    sd_sigs = [style_results[k]["daily"].get("signal") for k in style_results if style_results[k]["daily"].get("signal")]
    tech_style_weekly = _agg(sw_sigs)
    tech_style_daily = _agg(sd_sigs)

    cyb_d = style_results.get("SZ399006", {}).get("daily", {})
    kc_d = style_results.get("SH000688", {}).get("daily", {})
    leader_note = "双创均未明显走强"
    if cyb_d.get("score") is not None and kc_d.get("score") is not None:
        if cyb_d["score"] > kc_d["score"]:
            leader_note = f"日线相对强弱：创业板指(得分 {cyb_d['score']:+.1f}) > 科创50(得分 {kc_d['score']:+.1f})"
        elif kc_d["score"] > cyb_d["score"]:
            leader_note = f"日线相对强弱：科创50(得分 {kc_d['score']:+.1f}) > 创业板指(得分 {cyb_d['score']:+.1f})"
        else:
            leader_note = f"日线强弱持平（创业板指 / 科创50 均报 {cyb_d['score']:+.1f}）"

    # 技术面综合规则（布鲁斯：日线服从周线；同向确认，冲突偏中性）
    if weekly_sig == daily_sig and weekly_sig in ("多", "空"):
        tech_overall = weekly_sig
    elif weekly_sig == "空" and daily_sig == "多":
        tech_overall = "多(周空日多反弹)"
    elif weekly_sig == "多" and daily_sig == "空":
        tech_overall = "空(周多日空回调)"
    elif daily_sig in ("多", "空") and weekly_sig == "中性":
        tech_overall = daily_sig
    else:
        tech_overall = "中性"

    return {
        "status": "OK" if (w_sigs and d_sigs) else "ERROR",
        "indices": results,
        "tech_style_indices": style_results,
        "tech_style_weekly": tech_style_weekly,
        "tech_style_daily": tech_style_daily,
        "tech_style_note": leader_note,
        "weekly_signal": weekly_sig,
        "daily_signal": daily_sig,
        "tech_signal": tech_overall,
    }


if __name__ == "__main__":
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(fetch_tech_timing_dashboard(), ensure_ascii=False, indent=2))
