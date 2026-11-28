#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_tech_timing.py - L1 主趋势轴（周K/日K技术面）与 L3 风格技术面板。
计算：
  - 一目均衡表 (9, 26, 52) 云层位置与出云受阻次数
  - VW-MACD (12, 26, 9) 成交量加权动能
  - 布林带 (20, 2) %B 与 MA20 乖离率 / 10日累计涨幅（供 L2 冲顶过热护栏与 V底非过热校验使用）
  - CCI (14) 25根K线顶底背离
数据源：腾讯日K / 东财 / 新浪三路自动容错，严守零造假。
"""

from __future__ import annotations

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
SECID_TO_SINA = {
    "1.000001": "sh000001",
    "1.000300": "sh000300",
    "0.399006": "sz399006",
    "1.000688": "sh000688",
    "1.000905": "sh000905",
    "1.000852": "sh000852",
}


def _resample_weekly_causal(df_daily: pd.DataFrame, limit: int = 160) -> Optional[pd.DataFrame]:
    """按 W-FRI 严格无未来重采样为周K（本周截至最新已知日）。"""
    if df_daily is None or df_daily.empty:
        return None
    w = df_daily.copy()
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
    return res if len(res) >= 60 else None


def _fetch_kline_tencent(sina_sym: str, klt: int = 101, limit: int = 200) -> Optional[pd.DataFrame]:
    """腾讯免费高频接口（稳定零限流）：支持 day / week。"""
    period = "week" if klt == 102 else "day"
    url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={sina_sym},{period},,,{limit},qfq"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": HEADERS["User-Agent"]})
        with urllib.request.urlopen(req, timeout=6) as resp:
            d = json.loads(resp.read().decode("utf-8")).get("data", {}).get(sina_sym, {})
            raw = d.get(period) or d.get(f"qfq{period}") or []
            rows = []
            for r in raw:
                if len(r) >= 6:
                    c = float(r[2])
                    v = float(r[5])
                    rows.append({
                        "date": str(r[0]),
                        "open": float(r[1]),
                        "close": c,
                        "high": float(r[3]),
                        "low": float(r[4]),
                        "volume": v,
                        "amount": v * c,
                    })
            df = pd.DataFrame(rows)
            return df if len(df) >= 60 else None
    except Exception:
        return None


def _fetch_kline_sina_ak(sina_sym: str, klt: int = 101, limit: int = 180) -> Optional[pd.DataFrame]:
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
            return _resample_weekly_causal(df.tail(max(limit * 6, 900)), limit=limit)
        res = df[["date", "open", "close", "high", "low", "volume", "amount"]].tail(limit).reset_index(drop=True)
        return res if len(res) >= 60 else None
    except Exception:
        return None


def fetch_index_kline(secid: str, klt: int = 101, limit: int = 180) -> Optional[pd.DataFrame]:
    """东财 -> 腾讯 -> 新浪三路自动容错，严禁虚构数据。"""
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
            if klines:
                rows = []
                for line in klines:
                    p = line.split(",")
                    if len(p) >= 7:
                        rows.append({
                            "date": p[0], "open": float(p[1]), "close": float(p[2]),
                            "high": float(p[3]), "low": float(p[4]),
                            "volume": float(p[5]), "amount": float(p[6]),
                        })
                df = pd.DataFrame(rows)
                if len(df) >= 60:
                    return df
        except Exception:
            time.sleep(0.2)

    sina_sym = SECID_TO_SINA.get(secid)
    if sina_sym:
        df_tx = _fetch_kline_tencent(sina_sym, klt=klt, limit=limit)
        if df_tx is not None:
            return df_tx
        df_ak = _fetch_kline_sina_ak(sina_sym, klt=klt, limit=limit)
        if df_ak is not None:
            return df_ak
    return None


def calc_vwma(close: pd.Series, volume: pd.Series, span: int) -> pd.Series:
    pv = close * volume
    vol_sum = volume.rolling(window=span, min_periods=span).sum()
    return pv.rolling(window=span, min_periods=span).sum() / vol_sum.replace(0, np.nan)


def compute_tech_indicators(df: pd.DataFrame) -> Dict[str, Any]:
    """纯函数：计算一目均衡表、VW-MACD、布林带、CCI 背离及 MA20 乖离/10日涨幅。"""
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

    failed_breakouts = 0
    in_attempt = False
    for idx in df.tail(30).index:
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
    vw_dif = calc_vwma(c, v, 12) - calc_vwma(c, v, 26)
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

    # 3. 布林带 (20, 2) + MA20 乖离 + 10日涨幅 + 1日涨跌幅
    bb_mid = c.rolling(20).mean()
    bb_std = c.rolling(20).std(ddof=0)
    bb_up = bb_mid + 2.0 * bb_std
    bb_dn = bb_mid - 2.0 * bb_std
    mid_v, up_v, dn_v = float(bb_mid.iloc[-1]), float(bb_up.iloc[-1]), float(bb_dn.iloc[-1])
    bb_pct_b = round((px - dn_v) / (up_v - dn_v), 3) if (up_v - dn_v) > 1e-9 else 0.5
    ext_ma20_pct = round((px / mid_v - 1.0) * 100.0, 2) if mid_v > 0 else None
    ret_1d_pct = round((px / float(c.iloc[-2]) - 1.0) * 100.0, 2) if len(c) >= 2 and float(c.iloc[-2]) > 0 else None
    ret_10d_pct = round((px / float(c.iloc[-11]) - 1.0) * 100.0, 2) if len(c) >= 11 and float(c.iloc[-11]) > 0 else None

    bb_pos = (
        "上轨压制区" if bb_pct_b >= 0.85 else
        ("下轨超卖区" if bb_pct_b <= 0.15 else ("中轨偏上" if bb_pct_b >= 0.5 else "中轨偏下"))
    )

    # 4. CCI (14) + 25根K线顶底背离
    tp = (h + l + c) / 3.0
    tp_ma = tp.rolling(14).mean()
    md = tp.rolling(14).apply(lambda x: np.mean(np.abs(x - np.mean(x))), raw=True)
    cci = (tp - tp_ma) / (0.015 * md.replace(0, np.nan))
    cci_now = round(float(cci.iloc[-1]), 2) if pd.notna(cci.iloc[-1]) else None

    cci_div = "NONE"
    if len(df) >= 26 and cci.tail(25).notna().all():
        if float(c.iloc[-12:].max()) > float(c.iloc[-25:-12].max()) * 1.003 and float(cci.iloc[-12:].max()) < float(cci.iloc[-25:-12].max()) - 15.0:
            cci_div = "TOP_DIVERGENCE"
        elif float(c.iloc[-12:].min()) < float(c.iloc[-25:-12].min()) * 0.997 and float(cci.iloc[-12:].min()) > float(cci.iloc[-25:-12].min()) + 15.0:
            cci_div = "BOTTOM_DIVERGENCE"

    score = 0.0
    score += 1.0 if cloud_pos == "ABOVE_CLOUD" else (-1.0 if cloud_pos == "BELOW_CLOUD" else 0.0)
    score += (
        1.0 if vw_state == "BULL_ABOVE_ZERO" else
        (-1.0 if vw_state == "BEAR_BELOW_ZERO" else
         (-0.5 if vw_state == "WEAK_REBOUND_BELOW_ZERO" else
          (0.5 if vw_state == "WEAKENING_ABOVE_ZERO" else 0.0)))
    )
    if cci_div == "TOP_DIVERGENCE":
        score -= 1.0
    elif cci_div == "BOTTOM_DIVERGENCE":
        score += 1.0
    elif cci_now is not None:
        if cci_now > 50.0:
            score += 0.5
        elif cci_now < -50.0:
            score -= 0.5

    signal = "多" if score >= 1.0 else ("空" if score <= -1.0 else "中性")
    return {
        "date": str(df["date"].iloc[-1]),
        "close": round(px, 2),
        "ret_1d_pct": ret_1d_pct,
        "ret_10d_pct": ret_10d_pct,
        "ext_ma20_pct": ext_ma20_pct,
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
        "cci": {"value": cci_now, "divergence": cci_div},
        "score": round(score, 2),
        "signal": signal,
    }


def _agg_two(sigs: List[str]) -> str:
    valid = [s for s in sigs if s in ("多", "空", "中性")]
    if not valid:
        return "未知"
    bull = valid.count("多")
    bear = valid.count("空")
    if bull > bear and bull >= 1:
        return "多"
    if bear > bull and bear >= 1:
        return "空"
    return "中性"


def fetch_tech_timing_dashboard() -> Dict[str, Any]:
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

    w_sigs = [results[k]["weekly"].get("signal") for k in results if results[k]["weekly"].get("signal")]
    d_sigs = [results[k]["daily"].get("signal") for k in results if results[k]["daily"].get("signal")]
    weekly_sig = _agg_two(w_sigs)
    daily_sig = _agg_two(d_sigs)

    sw_sigs = [style_results[k]["weekly"].get("signal") for k in style_results if style_results[k]["weekly"].get("signal")]
    sd_sigs = [style_results[k]["daily"].get("signal") for k in style_results if style_results[k]["daily"].get("signal")]

    hs_d = results.get("SH000300", {}).get("daily", {})
    k50_d = style_results.get("SH000688", {}).get("daily", {})
    cyb_d = style_results.get("SZ399006", {}).get("daily", {})
    trade_date = hs_d.get("date") or results.get("SH000001", {}).get("daily", {}).get("date")

    return {
        "status": "OK" if (w_sigs and d_sigs) else "ERROR",
        "trade_date": trade_date,
        "indices": results,
        "tech_style_indices": style_results,
        "weekly_signal": weekly_sig,
        "daily_signal": daily_sig,
        "tech_style_weekly": _agg_two(sw_sigs),
        "tech_style_daily": _agg_two(sd_sigs),
        "hs300_close": hs_d.get("close"),
        "hs300_ret_1d_pct": hs_d.get("ret_1d_pct"),
        "hs300_ret_10d_pct": hs_d.get("ret_10d_pct"),
        "hs300_ext_ma20_pct": hs_d.get("ext_ma20_pct"),
        "k50_ret_1d_pct": k50_d.get("ret_1d_pct"),
        "cyb_ret_1d_pct": cyb_d.get("ret_1d_pct"),
    }


if __name__ == "__main__":
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(fetch_tech_timing_dashboard(), ensure_ascii=False, indent=2))
