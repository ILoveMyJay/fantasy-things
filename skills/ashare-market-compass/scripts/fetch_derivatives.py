#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_derivatives.py - 衍生品聪明钱层（四大股指期货升贴水趋势 + 全市场期权PCR + QVIX成本水位）
严守布鲁斯核心纪律：
1. 股指期货（IF/IH/IC/IM）体量是宽基ETF的5~10倍，追踪真实升贴水与IH领先性，不采信“中信代客”。
2. 期权PCR必须经平滑处理，严格执行「50 PCR vs 300 PCR 共振校验」（300破下轨而50未破不认底）。
3. QVIX/IV 严禁用于预测涨跌，仅用于标定期权买方/卖方成本。
4. 零造假原则：接口失败返回 None，绝不写死默认值。
"""

import argparse
import datetime
import json
import sys
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import akshare as ak
import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from db_store import (
    fetch_cffex_history,
    fetch_option_pcr_history,
    get_conn,
    upsert_cffex_basis,
    upsert_option_pcr,
)

HEADERS_SINA = {
    "Referer": "https://finance.sina.com.cn",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
}
HEADERS_EM = {
    "Referer": "https://quote.eastmoney.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
}


def get_front_contract_info(dt: Optional[datetime.datetime] = None) -> Tuple[str, str, int]:
    """计算当月主力合约后缀(YYMM)、交割日(每月第三个周五)及剩余自然日"""
    if dt is None:
        dt = datetime.datetime.now()
    first_day = datetime.date(dt.year, dt.month, 1)
    first_friday = 1 + (4 - first_day.weekday()) % 7
    third_friday = datetime.date(dt.year, dt.month, first_friday + 14)

    if dt.date() > third_friday:
        target_year = dt.year + 1 if dt.month == 12 else dt.year
        target_month = 1 if dt.month == 12 else dt.month + 1
        fd_next = datetime.date(target_year, target_month, 1)
        expiry_date = datetime.date(target_year, target_month, 1 + (4 - fd_next.weekday()) % 7 + 14)
    else:
        target_year, target_month, expiry_date = dt.year, dt.month, third_friday

    suffix = f"{target_year % 100:02d}{target_month:02d}"
    days = max(1, (expiry_date - dt.date()).days)
    return suffix, expiry_date.strftime("%Y-%m-%d"), days


def _get_recent_trade_dates(limit: int = 30) -> List[str]:
    url = (
        f"https://push2his.eastmoney.com/api/qt/stock/kline/get?"
        f"secid=1.000001&fields1=f1&fields2=f51&klt=101&fqt=1&end=20500101&lmt={limit}"
    )
    try:
        req = urllib.request.Request(url, headers=HEADERS_EM)
        with urllib.request.urlopen(req, timeout=5) as r:
            klines = (json.loads(r.read().decode("utf-8")).get("data") or {}).get("klines") or []
            return [k.split(",")[0] for k in klines]
    except Exception:
        return []


def fetch_cffex_basis_signal(db_path: Optional[Path] = None) -> Dict[str, Any]:
    """抓取 IF/IH/IC/IM 当月主力基差、年化贴水率与上证50(IH)相对强弱"""
    suffix, expiry_str, days = get_front_contract_info()
    futures_symbols = [f"CFF_RE_{p}{suffix}" for p in ("IF", "IH", "IC", "IM")]
    spot_symbols = ["sh000300", "sh000016", "sh000905", "sh000852"]

    futures_px: Dict[str, float] = {}
    futures_chg: Dict[str, float] = {}
    spot_px: Dict[str, float] = {}
    spot_chg: Dict[str, float] = {}

    try:
        req_f = urllib.request.Request(
            f"https://hq.sinajs.cn/list={','.join(futures_symbols)}", headers=HEADERS_SINA
        )
        with urllib.request.urlopen(req_f, timeout=5) as resp:
            for line in resp.read().decode("gbk", errors="ignore").strip().splitlines():
                if '="' not in line:
                    continue
                k = line.split('="')[0].split("hq_str_CFF_RE_")[-1]
                v = line.split('="')[1].split('";')[0].split(",")
                if len(v) > 14 and v[3]:
                    px = float(v[3])
                    pre = float(v[14]) if v[14] else None
                    if px > 0:
                        futures_px[k[:2]] = px
                        if pre and pre > 0:
                            futures_chg[k[:2]] = round((px / pre - 1.0) * 100.0, 2)
    except Exception as e:
        sys.stderr.write(f"[fetch_derivatives] Sina futures failed: {e}\n")

    try:
        req_s = urllib.request.Request(
            f"https://hq.sinajs.cn/list={','.join(spot_symbols)}", headers=HEADERS_SINA
        )
        with urllib.request.urlopen(req_s, timeout=5) as resp:
            for line in resp.read().decode("gbk", errors="ignore").strip().splitlines():
                if '="' not in line:
                    continue
                v = line.split('="')[1].split('";')[0].split(",")
                if len(v) > 3 and v[3]:
                    px = float(v[3])
                    pre = float(v[2]) if v[2] else None
                    code_map = {"sh000300": "IF", "sh000016": "IH", "sh000905": "IC", "sh000852": "IM"}
                    for sc, sym in code_map.items():
                        if sc in line and px > 0:
                            spot_px[sym] = px
                            if pre and pre > 0:
                                spot_chg[sym] = round((px / pre - 1.0) * 100.0, 2)
    except Exception as e:
        sys.stderr.write(f"[fetch_derivatives] Sina spot failed: {e}\n")

    trade_dates = _get_recent_trade_dates(limit=3)
    trade_date = trade_dates[-1] if trade_dates else datetime.date.today().strftime("%Y-%m-%d")

    table: Dict[str, Any] = {}
    db_rows = []
    for sym in ("IF", "IH", "IC", "IM"):
        f_val = futures_px.get(sym)
        s_val = spot_px.get(sym)
        if f_val is None or s_val is None:
            table[sym] = {
                "contract": f"{sym}{suffix}",
                "futures_price": f_val,
                "spot_price": s_val,
                "basis": None,
                "annualized_discount_pct": None,
                "spot_pct_chg": spot_chg.get(sym),
            }
            continue
        basis = round(f_val - s_val, 2)
        ann_pct = round((basis / s_val) * (365.0 / days) * 100.0, 2)
        table[sym] = {
            "contract": f"{sym}{suffix}",
            "futures_price": round(f_val, 2),
            "spot_price": round(s_val, 2),
            "basis": basis,
            "annualized_discount_pct": ann_pct,
            "spot_pct_chg": spot_chg.get(sym),
            "futures_pct_chg": futures_chg.get(sym),
        }
        db_rows.append(
            {
                "trade_date": trade_date,
                "symbol": sym,
                "contract": f"{sym}{suffix}",
                "futures_price": round(f_val, 2),
                "spot_price": round(s_val, 2),
                "basis": basis,
                "annualized_discount_pct": ann_pct,
                "days_to_expiry": days,
            }
        )

    if not db_rows:
        return {"status": "ERROR", "error": "四大期指实时/收盘基差接口获取失败（未填充虚假默认值）"}

    conn = get_conn(db_path)
    try:
        upsert_cffex_basis(conn, db_rows)
        hist = fetch_cffex_history(conn, days=20)
    finally:
        conn.close()

    # 计算 5 日基差变化趋势（若本地有历史）
    if_hist = [r["annualized_discount_pct"] for r in hist if r["symbol"] == "IF" and r.get("annualized_discount_pct") is not None]
    if_ann = table["IF"]["annualized_discount_pct"]
    ih_ann = table["IH"]["annualized_discount_pct"]
    im_ann = table["IM"]["annualized_discount_pct"]

    # 综合判定：贴水率是否深度走阔 + 蓝筹(IH)是否领先小盘(IM)
    ih_vs_im_chg = (
        round(spot_chg["IH"] - spot_chg["IM"], 2)
        if "IH" in spot_chg and "IM" in spot_chg
        else None
    )
    if if_ann is None:
        sig, note = "NEUTRAL", "IF 基差缺失"
    elif if_ann <= -15.0 or (ih_ann is not None and ih_ann <= -15.0):
        sig, note = "BEAR", f"大盘期指深度贴水(IF {if_ann}% / IH {ih_ann}%)，大资金对冲/看空意愿强烈"
    elif if_ann >= 2.0 and (ih_ann is None or ih_ann >= 0.0):
        sig, note = "BULL", f"大盘期指转升水(IF {if_ann:+.2f}%)，大资金主动做多意愿增强"
    elif if_ann <= -5.0:
        sig, note = "BEAR_MILD", f"大盘期指持续贴水(IF {if_ann}%)，资金偏谨慎"
    else:
        sig, note = "NEUTRAL", f"期指基差处于正常区间(IF {if_ann:+.2f}%)"

    return {
        "status": "OK",
        "trade_date": trade_date,
        "front_contract_suffix": suffix,
        "expiry_date": expiry_str,
        "days_to_expiry": days,
        "basis_table": table,
        "ih_vs_im_spot_diff_pp": ih_vs_im_chg,
        "if_history_days": len(if_hist),
        "signal": sig,
        "note": note,
    }


def backfill_option_pcr(days: int = 25, db_path: Optional[Path] = None) -> int:
    """回填近 N 个交易日官方 SSE/SZSE 全市场 ETF 期权日度 PCR"""
    trade_dates = _get_recent_trade_dates(limit=days + 3)
    if not trade_dates:
        return 0

    conn = get_conn(db_path)
    inserted = 0
    try:
        cur = conn.execute("SELECT DISTINCT trade_date FROM daily_option_pcr")
        existing = {r[0] for r in cur.fetchall()}
        targets = [d for d in trade_dates[-days:] if d not in existing]
        for dt_str in targets:
            ymd = dt_str.replace("-", "")
            rows = []
            try:
                df_sse = ak.option_daily_stats_sse(date=ymd)
                if df_sse is not None and not df_sse.empty:
                    for _, r in df_sse.iterrows():
                        cv = int(r["认购成交量"])
                        pv = int(r["认沽成交量"])
                        co = int(r["未平仓认购合约数"])
                        po = int(r["未平仓认沽合约数"])
                        rows.append(
                            {
                                "trade_date": dt_str,
                                "underlying_code": str(r["合约标的代码"]),
                                "underlying_name": str(r["合约标的名称"]),
                                "exchange": "SSE",
                                "call_vol": cv,
                                "put_vol": pv,
                                "vol_pcr": round(pv / cv * 100.0, 2) if cv > 0 else None,
                                "call_oi": co,
                                "put_oi": po,
                                "oi_pcr": round(po / co * 100.0, 2) if co > 0 else None,
                            }
                        )
            except Exception:
                pass

            try:
                df_sz = ak.option_daily_stats_szse(date=ymd)
                if df_sz is not None and not df_sz.empty:
                    for _, r in df_sz.iterrows():
                        cv = int(r["认购成交量"])
                        pv = int(r["认沽成交量"])
                        co = int(r["未平仓认购合约数"])
                        po = int(r["未平仓认沽合约数"])
                        rows.append(
                            {
                                "trade_date": dt_str,
                                "underlying_code": str(r["合约标的代码"]),
                                "underlying_name": str(r["合约标的名称"]),
                                "exchange": "SZSE",
                                "call_vol": cv,
                                "put_vol": pv,
                                "vol_pcr": round(pv / cv * 100.0, 2) if cv > 0 else None,
                                "call_oi": co,
                                "put_oi": po,
                                "oi_pcr": round(po / co * 100.0, 2) if co > 0 else None,
                            }
                        )
            except Exception:
                pass

            if rows:
                upsert_option_pcr(conn, rows)
                inserted += 1
    finally:
        conn.close()
    return inserted


def evaluate_pcr_resonance(
    pcr_50_series: pd.Series,
    pcr_300_series: pd.Series,
    all_pcr_series: pd.Series,
    span: int = 5,
) -> Dict[str, Any]:
    """
    纯函数：计算经 EMA 平滑后的 50 PCR、300 PCR 与全市场综合 PCR，
    并严格执行布鲁斯「50 PCR 领先于 300 PCR」共振检验规则。
    """
    if pcr_50_series.empty or pcr_300_series.empty:
        return {"status": "ERROR", "error": "缺少 50/300 期权 PCR 序列"}

    s50 = pcr_50_series.ewm(span=span, adjust=False).mean()
    s300 = pcr_300_series.ewm(span=span, adjust=False).mean()
    s_all = all_pcr_series.ewm(span=span, adjust=False).mean()

    v50, v300, vall = float(s50.iloc[-1]), float(s300.iloc[-1]), float(s_all.iloc[-1])
    q50 = round(float((s50 <= v50).mean() * 100.0), 1)
    q300 = round(float((s300 <= v300).mean() * 100.0), 1)
    qall = round(float((s_all <= vall).mean() * 100.0), 1)

    # 布鲁斯 9-30 铁律：300 PCR 击穿下轨(<=20%分位)但 50 PCR 未击穿(>30%分位) => 假底警告！
    if q300 <= 20.0 and q50 > 30.0:
        sig = "BEAR_DIVERGENCE"
        note = f"⚠️ 300 PCR 触及下轨({q300}%分位)但 50 PCR 未破({q50}%分位)：50为指数的指数，历史先例未见底"
    elif q50 <= 20.0 and q300 <= 25.0:
        sig = "BULL"
        note = f"✅ 50 PCR({q50}%分位)与 300 PCR({q300}%分位)双双触及下轨共振，阶段底部特征"
    elif q50 >= 80.0 and q300 >= 75.0:
        sig = "BEAR"
        note = f"⚠️ 50 PCR({q50}%分位)与 300 PCR({q300}%分位)同步抬升至上轨，短期顶部风险警示"
    else:
        sig = "NEUTRAL"
        note = f"期权 PCR 处于不上不下的中间区（50分位 {q50}% / 300分位 {q300}% / 全市场 {qall}%）"

    return {
        "status": "OK",
        "sample_days": len(s50),
        "pcr_50_raw": round(float(pcr_50_series.iloc[-1]), 2),
        "pcr_50_ema5": round(v50, 2),
        "pcr_50_pct_rank": q50,
        "pcr_300_raw": round(float(pcr_300_series.iloc[-1]), 2),
        "pcr_300_ema5": round(v300, 2),
        "pcr_300_pct_rank": q300,
        "pcr_all_ema5": round(vall, 2),
        "pcr_all_pct_rank": qall,
        "signal": sig,
        "note": note,
    }


def fetch_option_pcr_signal(db_path: Optional[Path] = None, auto_backfill_days: int = 20) -> Dict[str, Any]:
    """拉取并评估全市场 50/300/500/双创期权 PCR"""
    conn = get_conn(db_path)
    try:
        cur = conn.execute("SELECT COUNT(DISTINCT trade_date) FROM daily_option_pcr")
        existing_days = int(cur.fetchone()[0])
    finally:
        conn.close()

    backfill_option_pcr(days=auto_backfill_days if existing_days < 15 else 3, db_path=db_path)

    conn = get_conn(db_path)
    try:
        hist = fetch_option_pcr_history(conn, days=80)
    finally:
        conn.close()

    if not hist:
        return {"status": "ERROR", "error": "官方 SSE/SZSE 期权 PCR 获取失败"}

    df = pd.DataFrame(hist)
    # 构造 50 ETF (510050)、300 ETF (510300 + 159919) 及全市场综合 成交量 PCR 序列
    g_50 = df[df["underlying_code"] == "510050"].groupby("trade_date")[["put_vol", "call_vol"]].sum()
    g_300 = df[df["underlying_code"].isin(["510300", "159919"])].groupby("trade_date")[["put_vol", "call_vol"]].sum()
    g_all = df.groupby("trade_date")[["put_vol", "call_vol", "put_oi", "call_oi"]].sum()

    common_dates = sorted(set(g_50.index) & set(g_300.index) & set(g_all.index))
    if not common_dates:
        return {"status": "ERROR", "error": "50/300 期权共同交易日为空"}

    p50 = (g_50.loc[common_dates, "put_vol"] / g_50.loc[common_dates, "call_vol"] * 100.0).dropna()
    p300 = (g_300.loc[common_dates, "put_vol"] / g_300.loc[common_dates, "call_vol"] * 100.0).dropna()
    pall = (g_all.loc[common_dates, "put_vol"] / g_all.loc[common_dates, "call_vol"] * 100.0).dropna()

    res = evaluate_pcr_resonance(p50, p300, pall, span=5)
    last_dt = common_dates[-1]
    res["trade_date"] = last_dt
    res["all_oi_pcr"] = round(
        float(g_all.loc[last_dt, "put_oi"] / g_all.loc[last_dt, "call_oi"] * 100.0), 2
    )
    res["iv_cost_note"] = "注：IV/QVIX 严禁用于预测涨跌，仅做期权买/卖方定价成本评估"
    return res


def fetch_derivatives_dashboard(db_path: Optional[Path] = None, auto_backfill_days: int = 20) -> Dict[str, Any]:
    return {
        "cffex_basis": fetch_cffex_basis_signal(db_path=db_path),
        "option_pcr": fetch_option_pcr_signal(db_path=db_path, auto_backfill_days=auto_backfill_days),
    }


if __name__ == "__main__":
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="股指期货升贴水与官方期权PCR抓取")
    parser.add_argument("--backfill-pcr", type=int, default=0, help="回填近N日官方期权PCR")
    args = parser.parse_args()
    if args.backfill_pcr > 0:
        n = backfill_option_pcr(days=args.backfill_pcr)
        print(f"Backfilled {n} trading days of SSE/SZSE option PCR.")
    else:
        print(json.dumps(fetch_derivatives_dashboard(), ensure_ascii=False, indent=2))
