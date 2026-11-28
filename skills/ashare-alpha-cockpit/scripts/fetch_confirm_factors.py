#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_confirm_factors.py - L1 正交确认因子 + 纯观测宏观/资金面板。

L1 参与投票（严格按 Phase 0 + Walk-Forward 实证锁定）：
  1. 股债息差 ERP (750D 滚动 Z)：仅 Z >= +1.5σ (+1.0) 与 Z <= -1.2σ (-0.5)，剔除 0.8~1.5σ；
  2. 官方 50/300 期权 PCR (60D 滚动 EMA5 共振)：极性反转（双高恐慌=+0.5, 双低自满=-0.5）+ 保留 50领先300 假底否决 (-1.0)；
  3. 中金所中小盘滚仓基差 (IM_pct120 优先 / IC_pct120 备选，交割前<=5天自动滚次月) + 分红季绝对基差底线护栏 (ann >= -5.0%)；
     同时计算原始当月 IC 年化贴水（交割周<=4天切次月）供 L2 左尾探针 (IC <= -25%) 使用。

纯观测面板（权重 0.0，绝不污染 L1 投票）：
  4. 19只宽基 ETF 真实份额加权加仓指数 (30/70轨)；
  5. 两融原始余额与 5 日变动率（已彻底移除证伪的 Em 比值）；
  6. 中美 10Y 国债利差与 60 日变化量。
"""

from __future__ import annotations

import datetime
import io
import json
import sys
import urllib.request
import warnings
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import akshare as ak
import numpy as np
import pandas as pd
import requests

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_ROOT = SCRIPT_DIR.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from db_store import (
    fetch_cffex_history,
    fetch_etf_shares_history,
    fetch_option_pcr_history,
    get_conn,
    upsert_cffex_basis,
    upsert_etf_shares,
    upsert_option_pcr,
)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://finance.sina.com.cn/",
}


def get_front_contract_info(ref_date: Optional[datetime.date] = None, roll_days: int = 5) -> Tuple[str, str, int]:
    """计算中金所纯净滚仓合约月份（距离第三个周五 <= roll_days 时提前滚次月）。"""
    today = ref_date or datetime.date.today()
    y, m = today.year, today.month
    first_day = datetime.date(y, m, 1)
    third_fri = datetime.date(y, m, 1 + (4 - first_day.weekday()) % 7 + 14)
    days_left = (third_fri - today).days
    if days_left <= roll_days:
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
        fd2 = datetime.date(y, m, 1)
        third_fri = datetime.date(y, m, 1 + (4 - fd2.weekday()) % 7 + 14)
        days_left = (third_fri - today).days
    return f"{y % 100:02d}{m:02d}", third_fri.strftime("%Y-%m-%d"), max(1, days_left)


def _get_recent_trade_dates(limit: int = 130) -> List[str]:
    try:
        df = ak.stock_zh_index_daily(symbol="sh000001")
        if df is not None and not df.empty:
            return pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d").tail(limit).tolist()
    except Exception:
        pass
    try:
        url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000001,day,,,{limit},qfq"
        req = urllib.request.Request(url, headers={"User-Agent": HEADERS["User-Agent"]})
        with urllib.request.urlopen(req, timeout=6) as r:
            rows = (json.loads(r.read().decode("utf-8")).get("data", {}).get("sh000001", {}).get("day") or [])
            return [str(x[0]) for x in rows]
    except Exception:
        return []


# =============================================================================
# 1. ERP (750D 滚动 Z，严格只用 >= +1.5σ 和 <= -1.2σ)
# =============================================================================

def fetch_erp_signal(window: int = 750) -> Dict[str, Any]:
    try:
        df = ak.stock_ebs_lg()
        if df is None or df.empty:
            return {"status": "ERROR", "error": "stock_ebs_lg 返回空数据"}
        df = df.copy()
        df["日期"] = pd.to_datetime(df["日期"]).dt.strftime("%Y-%m-%d")
        df["股债利差"] = pd.to_numeric(df["股债利差"], errors="coerce")
        df = df.dropna(subset=["股债利差"]).sort_values("日期")

        s = df["股债利差"]
        win = min(window, len(s))
        roll_mean = float(s.tail(win).mean())
        roll_std = float(s.tail(win).std(ddof=0))
        latest = float(s.iloc[-1])
        latest_date = str(df["日期"].iloc[-1])
        zscore = round((latest - roll_mean) / roll_std, 3) if roll_std > 0 else 0.0

        if zscore >= 1.5:
            sig, note = "BULL", "触发 +1.5σ 历史级深值底锚（强多确认 +1.0）"
        elif zscore <= -1.2:
            sig, note = "BEAR_MILD", "跌破 -1.2σ 估值偏高温和警示（仅 -0.5，绝不单票否决牛市）"
        else:
            sig, note = "NEUTRAL", "位于中性估值区间（已剔除原版 0.8~1.5σ 熊市接飞刀区）"

        return {
            "status": "OK",
            "trade_date": latest_date,
            "erp_pct": round(latest * 100.0, 2),
            "rolling_mean_pct": round(roll_mean * 100.0, 2),
            "zscore": zscore,
            "signal": sig,
            "note": note,
        }
    except Exception as e:
        return {"status": "ERROR", "error": f"ERP 获取失败: {e}"}


# =============================================================================
# 2. 官方 50/300 期权 PCR (60D EMA5 共振：保留假底否决，反转极值方向)
# =============================================================================

def evaluate_pcr_cockpit(
    pcr_50_series: pd.Series,
    pcr_300_series: pd.Series,
    all_pcr_series: pd.Series,
    span: int = 5,
) -> Dict[str, Any]:
    if pcr_50_series.empty or pcr_300_series.empty:
        return {"status": "ERROR", "error": "缺少 50/300 期权 PCR 序列"}

    s50 = pcr_50_series.ewm(span=span, adjust=False).mean()
    s300 = pcr_300_series.ewm(span=span, adjust=False).mean()
    s_all = all_pcr_series.ewm(span=span, adjust=False).mean()

    v50, v300, vall = float(s50.iloc[-1]), float(s300.iloc[-1]), float(s_all.iloc[-1])
    q50 = round(float((s50 <= v50).mean() * 100.0), 1)
    q300 = round(float((s300 <= v300).mean() * 100.0), 1)
    qall = round(float((s_all <= vall).mean() * 100.0), 1)

    # 保持原版 raw_signal 命名以便审计对照，同时标注 Cockpit 反转极性解读
    if q300 <= 20.0 and q50 > 30.0:
        raw_sig = "BEAR_DIVERGENCE"
        note = f"⚠️ 300 PCR({q300}%)击穿下轨但 50 PCR({q50}%)未破：保留 50 领先 300 假底否决 (-1.0)"
    elif q50 >= 80.0 and q300 >= 75.0:
        raw_sig = "BEAR"
        note = f"✅ 50({q50}%)/300({q300}%) PCR 同步冲至高位恐慌对冲区：逆向情绪托底 (+0.5)"
    elif q50 <= 20.0 and q300 <= 25.0:
        raw_sig = "BULL"
        note = f"⚠️ 50({q50}%)/300({q300}%) PCR 同步降至低位自满区：短线过热温和警示 (-0.5)"
    else:
        raw_sig = "NEUTRAL"
        note = f"期权 PCR 处于中性区（50分位 {q50}% / 300分位 {q300}% / 全市场 {qall}%）"

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
        "signal": raw_sig,
        "note": note,
    }


def backfill_option_pcr(days: int = 60, db_path: Optional[Path] = None) -> int:
    trade_dates = _get_recent_trade_dates(limit=days + 3)
    if not trade_dates:
        return 0
    conn = get_conn(db_path)
    inserted = 0
    try:
        existing = {r[0] for r in conn.execute("SELECT DISTINCT trade_date FROM daily_option_pcr").fetchall()}
        targets = [d for d in trade_dates[-days:] if d not in existing]
        for dt_str in targets:
            ymd = dt_str.replace("-", "")
            rows = []
            try:
                df_sse = ak.option_daily_stats_sse(date=ymd)
                if df_sse is not None and not df_sse.empty:
                    for _, r in df_sse.iterrows():
                        cv, pv = int(r["认购成交量"]), int(r["认沽成交量"])
                        co, po = int(r["未平仓认购合约数"]), int(r["未平仓认沽合约数"])
                        rows.append({
                            "trade_date": dt_str, "underlying_code": str(r["合约标的代码"]),
                            "underlying_name": str(r["合约标的名称"]), "exchange": "SSE",
                            "call_vol": cv, "put_vol": pv, "vol_pcr": round(pv / cv * 100.0, 2) if cv > 0 else None,
                            "call_oi": co, "put_oi": po, "oi_pcr": round(po / co * 100.0, 2) if co > 0 else None,
                        })
            except Exception:
                pass
            if rows:
                upsert_option_pcr(conn, rows)
                inserted += 1
    finally:
        conn.close()
    return inserted


def fetch_option_pcr_signal(db_path: Optional[Path] = None, auto_backfill_days: int = 60) -> Dict[str, Any]:
    conn = get_conn(db_path)
    try:
        existing_days = int(conn.execute("SELECT COUNT(DISTINCT trade_date) FROM daily_option_pcr").fetchone()[0])
    finally:
        conn.close()

    backfill_option_pcr(days=auto_backfill_days if existing_days < 45 else 3, db_path=db_path)

    conn = get_conn(db_path)
    try:
        hist = fetch_option_pcr_history(conn, days=65)
    finally:
        conn.close()
    if not hist:
        return {"status": "ERROR", "error": "官方上交所期权 PCR 获取失败"}

    df = pd.DataFrame(hist)
    df = df[df["exchange"] == "SSE"].copy() if "exchange" in df.columns else df
    g_50 = df[df["underlying_code"] == "510050"].groupby("trade_date")[["put_vol", "call_vol"]].sum()
    g_300 = df[df["underlying_code"].isin(["510300", "159919"])].groupby("trade_date")[["put_vol", "call_vol"]].sum()
    g_all = df.groupby("trade_date")[["put_vol", "call_vol", "put_oi", "call_oi"]].sum()
    common = sorted(set(g_50.index) & set(g_300.index) & set(g_all.index))[-60:]
    if not common:
        return {"status": "ERROR", "error": "50/300 期权共同交易日为空"}

    p50 = (g_50.loc[common, "put_vol"] / g_50.loc[common, "call_vol"].replace(0, np.nan) * 100.0).dropna()
    p300 = (g_300.loc[common, "put_vol"] / g_300.loc[common, "call_vol"].replace(0, np.nan) * 100.0).dropna()
    pall = (g_all.loc[common, "put_vol"] / g_all.loc[common, "call_vol"].replace(0, np.nan) * 100.0).dropna()
    res = evaluate_pcr_cockpit(p50, p300, pall, span=5)
    res["trade_date"] = common[-1]
    res["all_oi_pcr"] = round(float(g_all.loc[common[-1], "put_oi"] / max(1, g_all.loc[common[-1], "call_oi"]) * 100.0), 2)
    return res


# =============================================================================
# 3. 纯净滚仓期指基差 (IM_pct120 优先 / IC_pct120 备选 + 分红季底线保护)
# =============================================================================

def _fetch_sina_cffex_realtime(suffix: str) -> Tuple[Dict[str, float], Dict[str, float], Dict[str, float]]:
    """直连新浪行情批量抓取四大期指与现货最新价。"""
    fut_syms = [f"CFF_RE_{s}{suffix}" for s in ("IF", "IH", "IC", "IM")]
    spot_syms = ["sh000300", "sh000016", "sh000905", "sh000852"]
    url = f"https://hq.sinajs.cn/list={','.join(fut_syms + spot_syms)}"
    fut_px, spot_px, spot_chg = {}, {}, {}
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=6) as resp:
            text = resp.read().decode("gbk", errors="ignore")
            for line in text.splitlines():
                if "=" not in line or '"' not in line:
                    continue
                lhs, rhs = line.split("=", 1)
                raw = rhs.strip().strip(';').strip('"')
                if not raw:
                    continue
                parts = raw.split(",")
                for sym in ("IF", "IH", "IC", "IM"):
                    if f"CFF_RE_{sym}{suffix}" in lhs and len(parts) > 3 and parts[3]:
                        fut_px[sym] = float(parts[3])
                for sym, scode in (("IF", "sh000300"), ("IH", "sh000016"), ("IC", "sh000905"), ("IM", "sh000852")):
                    if scode in lhs and len(parts) > 3 and parts[3] and parts[2]:
                        c, pc = float(parts[3]), float(parts[2])
                        spot_px[sym] = c
                        if pc > 0:
                            spot_chg[sym] = round((c / pc - 1.0) * 100.0, 2)
    except Exception as e:
        sys.stderr.write(f"[fetch_confirm_factors] Sina CFFEX realtime failed: {e}\n")
    return fut_px, spot_px, spot_chg


def backfill_cffex_basis(days: int = 130, db_path: Optional[Path] = None) -> int:
    """回填近 N 个交易日四大期指纯净滚仓年化基差（IM/IC/IF/IH）。"""
    trade_dates = _get_recent_trade_dates(limit=days + 5)
    if not trade_dates:
        return 0
    targets = trade_dates[-days:]
    spot_map = {"IF": "sh000300", "IH": "sh000016", "IC": "sh000905", "IM": "sh000852"}
    spot_lookup: Dict[Tuple[str, str], float] = {}
    for sym, scode in spot_map.items():
        try:
            sdf = ak.stock_zh_index_daily(symbol=scode)
            if sdf is not None and not sdf.empty:
                sdf["date"] = pd.to_datetime(sdf["date"]).dt.strftime("%Y-%m-%d")
                for d_s, cl in zip(sdf["date"].tail(days + 20), sdf["close"].tail(days + 20)):
                    spot_lookup[(sym, d_s)] = float(cl)
        except Exception:
            pass

    needed_contracts = set()
    date_contract_info = {}
    for d_s in targets:
        dt_obj = datetime.date.fromisoformat(d_s)
        suf, _, rem = get_front_contract_info(dt_obj, roll_days=5)
        date_contract_info[d_s] = (suf, rem)
        for sym in ("IF", "IH", "IC", "IM"):
            needed_contracts.add(f"{sym}{suf}")

    fut_lookup: Dict[Tuple[str, str], float] = {}
    for cname in sorted(needed_contracts):
        try:
            fdf = ak.futures_zh_daily_sina(symbol=cname)
            if fdf is not None and not fdf.empty:
                fdf["date"] = pd.to_datetime(fdf["date"]).dt.strftime("%Y-%m-%d")
                for d_s, cl in zip(fdf["date"], fdf["close"]):
                    fut_lookup[(cname, d_s)] = float(cl)
        except Exception:
            continue

    rows = []
    for d_s in targets:
        suf, rem = date_contract_info[d_s]
        for sym in ("IF", "IH", "IC", "IM"):
            s_px = spot_lookup.get((sym, d_s))
            f_px = fut_lookup.get((f"{sym}{suf}", d_s))
            if s_px and f_px and s_px > 0:
                basis = round(f_px - s_px, 2)
                ann = round((basis / s_px) * (365.0 / rem) * 100.0, 2)
                rows.append({
                    "trade_date": d_s, "symbol": sym, "contract": f"{sym}{suf}",
                    "futures_price": round(f_px, 2), "spot_price": round(s_px, 2),
                    "basis": basis, "annualized_discount_pct": ann, "days_to_expiry": rem, "is_rolled": 1,
                })
    if rows:
        conn = get_conn(db_path)
        try:
            upsert_cffex_basis(conn, rows)
        finally:
            conn.close()
    return len({r["trade_date"] for r in rows})


def fetch_cffex_basis_signal(db_path: Optional[Path] = None, auto_backfill_days: int = 130) -> Dict[str, Any]:
    tdates = _get_recent_trade_dates(limit=5)
    trade_date = tdates[-1] if tdates else datetime.date.today().strftime("%Y-%m-%d")
    ref_dt = datetime.date.fromisoformat(trade_date)
    suffix, expiry_str, days = get_front_contract_info(ref_dt, roll_days=5)

    fut_px, spot_px, spot_chg = _fetch_sina_cffex_realtime(suffix)
    table: Dict[str, Dict[str, Any]] = {}
    db_rows = []
    for sym in ("IH", "IF", "IC", "IM"):
        f_val, s_val = fut_px.get(sym), spot_px.get(sym)
        if f_val and s_val and s_val > 0:
            basis = round(f_val - s_val, 2)
            ann = round((basis / s_val) * (365.0 / days) * 100.0, 2)
            table[sym] = {
                "contract": f"{sym}{suffix}", "futures_price": round(f_val, 2),
                "spot_price": round(s_val, 2), "basis": basis,
                "annualized_discount_pct": ann, "spot_pct_chg": spot_chg.get(sym),
            }
            db_rows.append({
                "trade_date": trade_date, "symbol": sym, "contract": f"{sym}{suffix}",
                "futures_price": round(f_val, 2), "spot_price": round(s_val, 2),
                "basis": basis, "annualized_discount_pct": ann, "days_to_expiry": days, "is_rolled": 1,
            })
        else:
            table[sym] = {"contract": f"{sym}{suffix}", "futures_price": f_val, "spot_price": s_val, "basis": None, "annualized_discount_pct": None}

    if not db_rows:
        return {"status": "ERROR", "trade_date": None, "error": "四大期指实时基差获取失败（严守零造假）"}

    conn = get_conn(db_path)
    try:
        existing_im = int(conn.execute("SELECT COUNT(DISTINCT trade_date) FROM daily_cffex_basis WHERE symbol='IM'").fetchone()[0])
    finally:
        conn.close()

    if existing_im < 40 and auto_backfill_days > 0:
        try:
            backfill_cffex_basis(days=auto_backfill_days, db_path=db_path)
        except Exception:
            pass

    conn = get_conn(db_path)
    try:
        upsert_cffex_basis(conn, db_rows)
        hist = fetch_cffex_history(conn, days=130)
    finally:
        conn.close()

    pct120: Dict[str, Optional[float]] = {}
    hist_cnt: Dict[str, int] = {}
    for sym in ("IM", "IC", "IF"):
        s_rows = [
            float(r["annualized_discount_pct"])
            for r in hist
            if r["symbol"] == sym and r.get("annualized_discount_pct") is not None
            and (r.get("days_to_expiry") is None or int(r["days_to_expiry"]) > 5)
        ][-120:]
        hist_cnt[sym] = len(s_rows)
        cur_ann = table[sym]["annualized_discount_pct"]
        if cur_ann is not None and len(s_rows) >= 40:
            pct120[sym] = round(sum(1 for x in s_rows if x <= cur_ann) / len(s_rows) * 100.0, 1)
        else:
            pct120[sym] = None

    return {
        "status": "OK",
        "trade_date": trade_date,
        "front_contract_suffix": suffix,
        "expiry_date": expiry_str,
        "days_to_expiry": days,
        "basis_table": table,
        "im_ann_roll": table["IM"]["annualized_discount_pct"],
        "ic_ann_roll": table["IC"]["annualized_discount_pct"],
        "if_ann_roll": table["IF"]["annualized_discount_pct"],
        "im_pct120": pct120["IM"],
        "ic_pct120": pct120["IC"],
        "if_pct120": pct120["IF"],
        "history_days": hist_cnt,
    }


# =============================================================================
# 4. 纯观测面板（权重 0.0）：19-ETF 份额、两融原始 5D 变动、中美 10Y 60D 变化
# =============================================================================

def fetch_observation_panel(db_path: Optional[Path] = None) -> Dict[str, Any]:
    obs: Dict[str, Any] = {"margin": {"status": "ERROR"}, "macro_yields": {"status": "ERROR"}, "etf_19": {"status": "ERROR"}}

    # (a) 两融原始余额与 5 日变动（不再计算证伪的 Em）
    try:
        url = (
            "https://datacenter-web.eastmoney.com/api/data/v1/get"
            "?reportName=RPTA_RZRQ_LSDB&columns=ALL&pageNumber=1&pageSize=12"
            "&sortColumns=DIM_DATE&sortTypes=-1"
        )
        req = urllib.request.Request(
            url, headers={"User-Agent": HEADERS["User-Agent"], "Referer": "https://data.eastmoney.com/"}
        )
        with urllib.request.urlopen(req, timeout=6) as r:
            rows = ((json.loads(r.read().decode("utf-8")).get("result") or {}).get("data") or [])
        valid_rows = [
            x for x in rows
            if (x.get("TOTAL_RZRQYE") is not None or x.get("RZRQYE") is not None)
        ]
        if len(valid_rows) >= 6:
            latest = valid_rows[0]
            prev5 = valid_rows[5]
            tot_now = float(latest.get("TOTAL_RZRQYE") or latest.get("RZRQYE")) / 1e8
            tot_p5 = float(prev5.get("TOTAL_RZRQYE") or prev5.get("RZRQYE")) / 1e8
            obs["margin"] = {
                "status": "OK",
                "trade_date": str(latest["DIM_DATE"])[:10],
                "total_margin_yi": round(tot_now, 2),
                "margin_5d_chg_yi": round(tot_now - tot_p5, 2),
                "margin_5d_chg_pct": round((tot_now / tot_p5 - 1.0) * 100.0, 2) if tot_p5 > 0 else None,
                "note": "纯观测（Em弹性比值已于Phase 0证伪移除）",
            }
    except Exception as e:
        obs["margin"] = {"status": "ERROR", "error": str(e)}

    # (b) 中美 10Y 国债收益率与 60 日利差变化
    try:
        url = (
            "https://datacenter-web.eastmoney.com/api/data/v1/get"
            "?reportName=RPTA_WEB_TREASURYYIELD&columns=SOLAR_DATE,EMM00166466,EMG00001310"
            "&pageNumber=1&pageSize=90&sortColumns=SOLAR_DATE&sortTypes=-1&source=WEB&client=WEB"
        )
        req = urllib.request.Request(url, headers={"User-Agent": HEADERS["User-Agent"]})
        with urllib.request.urlopen(req, timeout=6) as r:
            rows = ((json.loads(r.read().decode("utf-8")).get("result") or {}).get("data") or [])
        valid_y = [
            (str(x["SOLAR_DATE"])[:10], float(x["EMM00166466"]), float(x["EMG00001310"]))
            for x in rows if x.get("EMM00166466") is not None and x.get("EMG00001310") is not None
        ]
        if valid_y:
            dt_now, cn_now, us_now = valid_y[0]
            spd_now = round((cn_now - us_now) * 100.0, 1)
            spd_60d = None
            if len(valid_y) >= 60:
                _, cn_60, us_60 = valid_y[59]
                spd_60d = round(spd_now - (cn_60 - us_60) * 100.0, 1)
            obs["macro_yields"] = {
                "status": "OK",
                "trade_date": dt_now,
                "cn_10y": round(cn_now, 3),
                "us_10y": round(us_now, 3),
                "cn_us_spread_bp": spd_now,
                "spread_chg_60d_bp": spd_60d,
                "note": "60D利差走阔>=+30bp为宏观顺风参考，绝对利差不参与L1投票",
            }
    except Exception as e:
        obs["macro_yields"] = {"status": "ERROR", "error": str(e)}

    # (c) 19 只宽基 ETF 观测（若本地已有记录则计算，缺省拉取深交所/上交所最新快照）
    try:
        conn = get_conn(db_path)
        try:
            hist = fetch_etf_shares_history(conn, days=130)
        finally:
            conn.close()
        if hist:
            edf = pd.DataFrame(hist)
            piv_sh = edf.pivot(index="trade_date", columns="etf_code", values="shares_yi").sort_index()
            piv_nv = edf.pivot(index="trade_date", columns="etf_code", values="nav").sort_index().ffill().fillna(1.0)
            flow = (piv_sh.diff() * piv_nv).sum(axis=1, min_count=1).dropna()
            if len(flow) >= 3:
                ef = flow.ewm(span=min(5, len(flow)), adjust=False).mean()
                es = flow.ewm(span=min(20, len(flow)), adjust=False).mean()
                vel = 0.65 * ef + 0.35 * (ef - es)
                rec = vel.tail(120)
                idx_val = round(float((rec <= float(vel.iloc[-1])).mean() * 100.0), 1)
                obs["etf_19"] = {
                    "status": "OK",
                    "trade_date": str(flow.index[-1]),
                    "index_value": idx_val,
                    "latest_net_flow_yi": round(float(flow.iloc[-1]), 2),
                    "sample_days": len(flow),
                    "note": "纯观测（权重0.0，Phase 0证伪条件加分器）",
                }
            else:
                obs["etf_19"] = {"status": "EMPTY", "note": "本地ETF份额样本不足，纯观测不影响L1决策"}
        else:
            obs["etf_19"] = {"status": "EMPTY", "note": "尚未回填ETF份额，纯观测不影响L1决策"}
    except Exception as e:
        obs["etf_19"] = {"status": "ERROR", "error": str(e)}

    return obs


def fetch_confirm_dashboard(db_path: Optional[Path] = None, auto_backfill: bool = True) -> Dict[str, Any]:
    return {
        "erp": fetch_erp_signal(),
        "option_pcr": fetch_option_pcr_signal(db_path=db_path, auto_backfill_days=60 if auto_backfill else 0),
        "cffex_basis": fetch_cffex_basis_signal(db_path=db_path, auto_backfill_days=130 if auto_backfill else 0),
        "observation": fetch_observation_panel(db_path=db_path),
    }


if __name__ == "__main__":
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(fetch_confirm_dashboard(auto_backfill=False), ensure_ascii=False, indent=2))
