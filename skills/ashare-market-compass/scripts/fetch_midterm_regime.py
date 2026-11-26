#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_midterm_regime.py - 中期资金面与估值层引擎
覆盖：
1. 股债息差 (ERP) + 滚动3年标准差上下轨
2. 全A等权PE (middlePETTM / averagePETTM + 10年分位)
3. 19只主流宽基ETF「真实份额变化 + 加权加仓指数 (30/70轨)」
4. 高管与重要股东近30/60日净增减持统计
5. 中债国债收益率曲线 + Shibor + 恒生国企(HSCEI)先行速率
严守零造假原则：接口失败返回 None，绝不填充虚假默认值。
"""

import argparse
import datetime
import io
import json
import math
import sys
import urllib.request
import warnings
from pathlib import Path
from typing import Any, Dict, List, Optional

import akshare as ak
import numpy as np
import pandas as pd
import requests

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_ROOT = SCRIPT_DIR.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from db_store import fetch_etf_shares_history, get_conn, upsert_etf_shares

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://quote.eastmoney.com/",
}


def load_etf_universe() -> List[Dict[str, str]]:
    cfg = SKILL_ROOT / "config" / "etf_19_universe.json"
    with open(cfg, "r", encoding="utf-8") as f:
        return json.load(f)["etfs"]


def _fetch_em_kline_close_map(secid: str, limit: int = 160) -> Dict[str, float]:
    import time
    hosts = [
        "https://push2his.eastmoney.com/api/qt/stock/kline/get",
        "https://64.push2his.eastmoney.com/api/qt/stock/kline/get",
    ]
    for attempt in range(4):
        base = hosts[attempt % len(hosts)]
        url = (
            f"{base}?secid={secid}&fields1=f1&fields2=f51,f53"
            f"&klt=101&fqt=0&end=20500101&lmt={limit}"
        )
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=5) as r:
                klines = (json.loads(r.read().decode("utf-8")).get("data") or {}).get("klines") or []
                out = {}
                for line in klines:
                    parts = line.split(",")
                    if len(parts) >= 2:
                        out[parts[0]] = float(parts[1])
                if out:
                    return out
        except Exception:
            time.sleep(0.3 * (attempt + 1))
    return {}


def fetch_erp_signal(window: int = 750) -> Dict[str, Any]:
    """股债息差 (ERP) + 滚动 3 年标准差轨道"""
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
        pct_rank = round(float((s.tail(win) <= latest).mean() * 100.0), 1)

        upper_1s = round((roll_mean + roll_std) * 100.0, 2)
        upper_15s = round((roll_mean + 1.5 * roll_std) * 100.0, 2)
        lower_1s = round((roll_mean - roll_std) * 100.0, 2)

        if zscore >= 1.5:
            signal, note = "BULL", "触发标准差上轨(+1.5σ以上)，历史级底部价值深坑"
        elif zscore >= 0.8:
            signal, note = "BULL_MILD", "逼近标准差上轨，估值性价比显著提升"
        elif zscore <= -1.0:
            signal, note = "BEAR", "跌破标准差下轨(-1.0σ以下)，高估顶部风险区"
        else:
            signal, note = "NEUTRAL", "位于中轨附近，距标准差上轨仍有空间（未到极限冰点）"

        return {
            "status": "OK",
            "trade_date": latest_date,
            "erp_pct": round(latest * 100.0, 2),
            "rolling_mean_pct": round(roll_mean * 100.0, 2),
            "upper_1sigma_pct": upper_1s,
            "upper_1_5sigma_pct": upper_15s,
            "lower_1sigma_pct": lower_1s,
            "zscore": zscore,
            "pct_rank_3y": pct_rank,
            "signal": signal,
            "note": note,
        }
    except Exception as e:
        return {"status": "ERROR", "error": f"ERP 获取失败: {e}"}


def fetch_equal_weight_pe() -> Dict[str, Any]:
    """全A等权市盈率 (middlePETTM / averagePETTM 及近10年分位)"""
    try:
        df = ak.stock_a_ttm_lyr()
        if df is None or df.empty:
            return {"status": "ERROR", "error": "stock_a_ttm_lyr 返回空数据"}
        df = df.copy()
        df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
        df = df.sort_values("date")
        valid = df.dropna(subset=["middlePETTM"])
        if valid.empty:
            return {"status": "ERROR", "error": "无有效 PE 数据"}
        last = valid.iloc[-1]
        q_mid_10y = last.get("quantileInRecent10YearsMiddlePeTtm")
        q_avg_10y = last.get("quantileInRecent10YearsAveragePeTtm")
        q_mid_pct = round(float(q_mid_10y) * 100.0, 2) if pd.notna(q_mid_10y) else None
        q_avg_pct = round(float(q_avg_10y) * 100.0, 2) if pd.notna(q_avg_10y) else None

        # 若最新行分位缺失，退用最近有分位的记录
        if q_mid_pct is None:
            q_valid = valid.dropna(subset=["quantileInRecent10YearsMiddlePeTtm"])
            if not q_valid.empty:
                q_mid_pct = round(float(q_valid.iloc[-1]["quantileInRecent10YearsMiddlePeTtm"]) * 100.0, 2)
        if q_avg_pct is None:
            q_valid = valid.dropna(subset=["quantileInRecent10YearsAveragePeTtm"])
            if not q_valid.empty:
                q_avg_pct = round(float(q_valid.iloc[-1]["quantileInRecent10YearsAveragePeTtm"]) * 100.0, 2)

        ref_q = q_mid_pct if q_mid_pct is not None else q_avg_pct
        if ref_q is None:
            signal, note = "NEUTRAL", "历史分位缺失"
        elif ref_q >= 70.0:
            signal, note = "BEAR", f"中位数PE处于近10年高位({ref_q}%)，高估区"
        elif ref_q <= 30.0:
            signal, note = "BULL", f"中位数PE处于近10年低位({ref_q}%)，低估安全区"
        else:
            signal, note = "NEUTRAL", f"估值处于近10年中间区({ref_q}%)"

        return {
            "status": "OK",
            "trade_date": str(last["date"]),
            "median_pe_ttm": round(float(last["middlePETTM"]), 2),
            "avg_pe_ttm": round(float(last["averagePETTM"]), 2) if pd.notna(last.get("averagePETTM")) else None,
            "median_pe_10y_pct": q_mid_pct,
            "avg_pe_10y_pct": q_avg_pct,
            "signal": signal,
            "note": note,
        }
    except Exception as e:
        return {"status": "ERROR", "error": f"全A等权PE获取失败: {e}"}


def _fetch_szse_etf_shares_today() -> Optional[pd.DataFrame]:
    """直连深交所官方ETF规模接口并用 BytesIO 修复 pandas 3.0 字节流读取问题"""
    url = "https://fund.szse.cn/api/report/ShowReport"
    params = {"SHOWTYPE": "xlsx", "CATALOGID": "1000_lf", "TABKEY": "tab1", "random": "0.123456"}
    headers = {
        "Referer": "https://fund.szse.cn/marketdata/fundslist/index.html",
        "User-Agent": HEADERS["User-Agent"],
    }
    try:
        r = requests.get(url, params=params, headers=headers, timeout=10)
        if r.status_code != 200 or len(r.content) < 1000:
            return None
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            df = pd.read_excel(io.BytesIO(r.content), engine="openpyxl", dtype={"基金代码": str})
        if "当前规模(份)" in df.columns:
            df["基金份额"] = pd.to_numeric(
                df["当前规模(份)"].astype(str).str.replace(",", ""), errors="coerce"
            )
        elif "基金份额" in df.columns:
            df["基金份额"] = pd.to_numeric(
                df["基金份额"].astype(str).str.replace(",", ""), errors="coerce"
            )
        return df
    except Exception as e:
        sys.stderr.write(f"[fetch_midterm_regime] SZSE ETF scale failed: {e}\n")
        return None


def compute_etf_weighted_accumulation_index(
    daily_net_flow_yi: pd.Series,
    fast_span: int = 5,
    slow_span: int = 20,
    norm_window: int = 120,
) -> Dict[str, Any]:
    """
    透明白盒版「19只宽基ETF加权加仓指数」(0~100, 下轨30 / 上轨70)：
    输入：按日汇总的19只宽基ETF净申赎金额序列（亿元，严格按 Δ份额 × 净值 计算，非成交量）
    算法：
      1. 计算快慢双均线变化速率：ema_fast = EMA(5), ema_slow = EMA(20)
      2. 综合速率因子 = 0.6 * ema_fast + 0.4 * (ema_fast - ema_slow)（捕捉加仓加速度与持续性）
      3. 使用滚动窗口 Wilder/EMA RSI 风格归一化到 0~100（若历史天数不足 15 天，回退用 Sigmoid/Z-score 映射并标注样本不足）
    """
    s = daily_net_flow_yi.dropna().astype(float)
    n = len(s)
    if n < 3:
        return {
            "index_value": None,
            "sample_days": n,
            "is_calibrated": False,
            "signal": "NEUTRAL",
            "note": f"仅有 {n} 天份额变动样本，至少需 5 天计算加权加仓指数（建议运行 --mode backfill）",
        }

    ema_fast = s.ewm(span=min(fast_span, n), adjust=False).mean()
    ema_slow = s.ewm(span=min(slow_span, n), adjust=False).mean()
    velocity = 0.65 * ema_fast + 0.35 * (ema_fast - ema_slow)

    win = min(norm_window, n)
    recent_v = velocity.tail(win)
    v_now = float(velocity.iloc[-1])

    if n >= 15:
        # 结合滚动百分位 (60%) 与 tanh(Z-score) (40%)，兼顾极值灵敏度与抗单日异常值
        pct = float((recent_v <= v_now).mean() * 100.0)
        std = float(recent_v.std(ddof=0))
        z = (v_now - float(recent_v.mean())) / std if std > 1e-9 else 0.0
        z_scaled = 50.0 + 45.0 * math.tanh(z / 1.5)
        idx_val = round(0.6 * pct + 0.4 * z_scaled, 2)
    else:
        std = float(recent_v.std(ddof=0))
        z = (v_now - float(recent_v.mean())) / std if std > 1e-9 else 0.0
        idx_val = round(50.0 + 45.0 * math.tanh(z / 1.5), 2)

    idx_val = max(0.0, min(100.0, idx_val))
    if idx_val >= 70.0:
        signal, note = "BULL", f"突破上轨 70（报 {idx_val}），宽基份额加速净申购，接近/进入底部区间"
    elif idx_val >= 60.0:
        signal, note = "BULL_MILD", f"逼近上轨 70（报 {idx_val}），大资金份额持续回流但需多点共振"
    elif idx_val <= 30.0:
        signal, note = "BEAR", f"跌破下轨 30（报 {idx_val}），宽基份额加速撤离，警示顶部区间"
    else:
        signal, note = "NEUTRAL", f"位于 30~70 中性通道（报 {idx_val}），份额流向未达极值"

    return {
        "index_value": idx_val,
        "latest_net_flow_yi": round(float(s.iloc[-1]), 2),
        "ema5_flow_yi": round(float(ema_fast.iloc[-1]), 2),
        "sample_days": n,
        "is_calibrated": n >= 20,
        "signal": signal,
        "note": note,
    }


def backfill_sse_etf_shares(days: int = 35, db_path: Optional[Path] = None) -> int:
    """回填近 N 个交易日的上交所主流宽基ETF官方每日份额（用于初始化 19 只宽基加权加仓指数）"""
    universe = load_etf_universe()
    sse_map = {u["code"]: u for u in universe if u["exchange"] == "SSE"}
    nav_cache = {code: _fetch_em_kline_close_map(u["secid"], limit=max(days + 20, 60)) for code, u in sse_map.items()}

    # 用上证日K获取精确交易日序列
    sh_dates = sorted(_fetch_em_kline_close_map("1.000001", limit=days + 5).keys())
    if not sh_dates:
        return 0

    conn = get_conn(db_path)
    inserted_days = 0
    try:
        # 检查库里已有的日期，避免重复抓取
        cur = conn.execute("SELECT DISTINCT trade_date FROM daily_etf_shares WHERE exchange='SSE'")
        existing = {r[0] for r in cur.fetchall()}
        target_dates = [d for d in sh_dates[-days:] if d not in existing]
        for dt_str in target_dates:
            try:
                df = ak.fund_etf_scale_sse(date=dt_str.replace("-", ""))
                if df is None or df.empty:
                    continue
                sub = df[df["基金代码"].astype(str).isin(sse_map.keys())]
                rows = []
                for _, r in sub.iterrows():
                    code = str(r["基金代码"])
                    u = sse_map[code]
                    shares_raw = pd.to_numeric(r["基金份额"], errors="coerce")
                    if pd.isna(shares_raw):
                        continue
                    rows.append(
                        {
                            "trade_date": dt_str,
                            "etf_code": code,
                            "exchange": "SSE",
                            "name": u["name"],
                            "category": u["category"],
                            "shares_yi": round(float(shares_raw) / 1e8, 4),
                            "nav": nav_cache.get(code, {}).get(dt_str),
                        }
                    )
                if rows:
                    upsert_etf_shares(conn, rows)
                    inserted_days += 1
            except Exception:
                continue
    finally:
        conn.close()
    return inserted_days


def fetch_etf_19_signal(db_path: Optional[Path] = None, auto_backfill_days: int = 25) -> Dict[str, Any]:
    """获取 19 只主流宽基 ETF 份额快照并计算「加权加仓指数」"""
    universe = load_etf_universe()
    u_map = {u["code"]: u for u in universe}

    # 1. 拉取最近交易日 SSE 份额 + 今日 SZSE 份额
    sh_dates = sorted(_fetch_em_kline_close_map("1.000001", limit=10).keys())
    latest_trade_date = sh_dates[-1] if sh_dates else datetime.date.today().strftime("%Y-%m-%d")

    conn = get_conn(db_path)
    try:
        cur = conn.execute("SELECT COUNT(DISTINCT trade_date) FROM daily_etf_shares")
        existing_days = int(cur.fetchone()[0])
    finally:
        conn.close()

    # 若本地样本不足，自动回填近期 SSE 历史份额（SSE 覆盖 50/300/500/1000/科创50/A500/2000 共 12 只核心）
    if existing_days < 15 and auto_backfill_days > 0:
        backfill_sse_etf_shares(days=auto_backfill_days, db_path=db_path)

    # 拉取最新有效一日的 SSE & SZSE 快照
    latest_rows = []
    sse_date_used = None
    for cand in reversed(sh_dates[-5:]):
        try:
            df_sse = ak.fund_etf_scale_sse(date=cand.replace("-", ""))
            if df_sse is not None and not df_sse.empty:
                sse_date_used = cand
                sub = df_sse[df_sse["基金代码"].astype(str).isin(u_map.keys())]
                for _, r in sub.iterrows():
                    code = str(r["基金代码"])
                    u = u_map[code]
                    val = pd.to_numeric(r["基金份额"], errors="coerce")
                    if pd.notna(val):
                        latest_rows.append(
                            {
                                "trade_date": cand,
                                "etf_code": code,
                                "exchange": "SSE",
                                "name": u["name"],
                                "category": u["category"],
                                "shares_yi": round(float(val) / 1e8, 4),
                                "nav": None,
                            }
                        )
                break
        except Exception:
            continue

    df_szse = _fetch_szse_etf_shares_today()
    szse_count = 0
    if df_szse is not None and not df_szse.empty and sse_date_used:
        sub_sz = df_szse[df_szse["基金代码"].astype(str).isin(u_map.keys())]
        for _, r in sub_sz.iterrows():
            code = str(r["基金代码"])
            u = u_map[code]
            val = pd.to_numeric(r["基金份额"], errors="coerce")
            if pd.notna(val):
                latest_rows.append(
                    {
                        "trade_date": sse_date_used,
                        "etf_code": code,
                        "exchange": "SZSE",
                        "name": u["name"],
                        "category": u["category"],
                        "shares_yi": round(float(val) / 1e8, 4),
                        "nav": None,
                    }
                )
                szse_count += 1

    # 补充最新收盘价作为 NAV 估算
    if latest_rows:
        for row in latest_rows:
            cmap = _fetch_em_kline_close_map(u_map[row["etf_code"]]["secid"], limit=5)
            row["nav"] = cmap.get(row["trade_date"]) or (list(cmap.values())[-1] if cmap else None)
        conn = get_conn(db_path)
        try:
            upsert_etf_shares(conn, latest_rows)
        finally:
            conn.close()

    # 从本地 SQLite 聚合每日份额净变化与净申赎金额（按同口径相邻两日都存在的 ETF 计算 Δ份额）
    conn = get_conn(db_path)
    try:
        hist = fetch_etf_shares_history(conn, days=160)
    finally:
        conn.close()

    if not hist:
        return {"status": "ERROR", "error": "宽基 ETF 份额数据获取失败"}

    hdf = pd.DataFrame(hist)
    pivot_sh = hdf.pivot(index="trade_date", columns="etf_code", values="shares_yi").sort_index()
    pivot_nav = hdf.pivot(index="trade_date", columns="etf_code", values="nav").sort_index().ffill()

    # 只统计相邻两天均有数据的 ETF，防止深交所某天新增纳入导致跳变伪信号
    delta_sh = pivot_sh.diff()
    daily_share_chg_yi = delta_sh.sum(axis=1, min_count=1)
    daily_flow_yi = (delta_sh * pivot_nav).sum(axis=1, min_count=1)
    daily_flow_yi = daily_flow_yi.dropna()

    acc = compute_etf_weighted_accumulation_index(daily_flow_yi)
    last_dt = str(daily_flow_yi.index[-1]) if not daily_flow_yi.empty else sse_date_used
    last_share_chg = (
        round(float(daily_share_chg_yi.loc[last_dt]), 2)
        if last_dt in daily_share_chg_yi.index and pd.notna(daily_share_chg_yi.loc[last_dt])
        else None
    )

    return {
        "status": "OK",
        "trade_date": last_dt,
        "covered_etfs_latest": len(latest_rows),
        "szse_etfs_captured": szse_count,
        "latest_share_change_yi": last_share_chg,
        **acc,
    }


def fetch_insider_trading_pressure(days: int = 30) -> Dict[str, Any]:
    """抓取东财数据中心最新高管/重要股东增减持，统计近 30 日增持 vs 减持家次与估算金额"""
    url_base = "https://datacenter-web.eastmoney.com/api/data/v1/get"
    cutoff = (datetime.date.today() - datetime.timedelta(days=days)).strftime("%Y-%m-%d")
    records = []
    try:
        for page in range(1, 5):
            params = {
                "sortColumns": "END_DATE,SECURITY_CODE,EITIME",
                "sortTypes": "-1,-1,-1",
                "pageSize": "500",
                "pageNumber": str(page),
                "reportName": "RPT_SHARE_HOLDER_INCREASE",
                "columns": "SECURITY_CODE,SECURITY_NAME_ABBR,END_DATE,DIRECTION,CHANGE_NUM,TRADE_AVERAGE_PRICE,CLOSE_PRICE",
                "source": "WEB",
                "client": "WEB",
            }
            r = requests.get(url_base, params=params, headers=HEADERS, timeout=6)
            data = (r.json().get("result") or {}).get("data") or []
            if not data:
                break
            stop = False
            for row in data:
                end_dt = str(row.get("END_DATE") or "")[:10]
                if end_dt < cutoff:
                    stop = True
                    continue
                records.append(row)
            if stop:
                break

        if not records:
            return {"status": "ERROR", "error": "近30日高管增减持记录为空或接口异常"}

        inc_cnt, dec_cnt = 0, 0
        inc_amt, dec_amt = 0.0, 0.0
        for row in records:
            direction = str(row.get("DIRECTION") or "")
            num = float(row.get("CHANGE_NUM") or 0) * 10000.0  # 东财单位为万股
            px = float(row.get("TRADE_AVERAGE_PRICE") or row.get("CLOSE_PRICE") or 0)
            amt_yi = (abs(num) * px) / 1e8 if px > 0 else 0.0
            if "增持" in direction:
                inc_cnt += 1
                inc_amt += amt_yi
            elif "减持" in direction:
                dec_cnt += 1
                dec_amt += amt_yi

        ratio = round(dec_cnt / max(1, inc_cnt), 2)
        if ratio >= 3.5:
            signal, note = "BEAR", f"减持/增持家次比高达 {ratio}:1，产业资本抛压沉重"
        elif ratio <= 1.2:
            signal, note = "BULL", f"增减持趋于平衡/偏增持({ratio}:1)，产业资本认可底部"
        else:
            signal, note = "NEUTRAL", f"近{days}日减持略多于增持({ratio}:1)"

        return {
            "status": "OK",
            "window_days": days,
            "increase_count": inc_cnt,
            "decrease_count": dec_cnt,
            "decrease_to_increase_ratio": ratio,
            "increase_est_yi": round(inc_amt, 2),
            "decrease_est_yi": round(dec_amt, 2),
            "signal": signal,
            "note": note,
        }
    except Exception as e:
        return {"status": "ERROR", "error": f"高管增减持获取失败: {e}"}


def fetch_macro_and_hk_leading() -> Dict[str, Any]:
    """中债国债收益率曲线 + Shibor + 恒生国企(HSCEI)先行速率"""
    out: Dict[str, Any] = {"status": "OK"}

    # 1. 中债国债收益率曲线
    try:
        start = (datetime.date.today() - datetime.timedelta(days=20)).strftime("%Y%m%d")
        end = datetime.date.today().strftime("%Y%m%d")
        df_b = ak.bond_china_yield(start_date=start, end_date=end)
        gov = df_b[df_b["曲线名称"] == "中债国债收益率曲线"].sort_values("日期")
        if not gov.empty:
            last = gov.iloc[-1]
            y1 = float(last["1年"])
            y10 = float(last["10年"])
            y30 = float(last["30年"])
            out["bond_curve"] = {
                "trade_date": str(last["日期"]),
                "cn_1y": round(y1, 4),
                "cn_10y": round(y10, 4),
                "cn_30y": round(y30, 4),
                "spread_10y_1y_bp": round((y10 - y1) * 100.0, 1),
            }
        else:
            out["bond_curve"] = None
    except Exception as e:
        out["bond_curve"] = None
        out["bond_curve_error"] = str(e)

    # 2. Shibor
    try:
        df_s = ak.macro_china_shibor_all()
        if df_s is not None and not df_s.empty:
            last_s = df_s.iloc[-1]
            out["shibor"] = {
                "trade_date": str(last_s["日期"]),
                "on": float(last_s["O/N-定价"]),
                "1w": float(last_s["1W-定价"]),
                "3m": float(last_s["3M-定价"]),
            }
        else:
            out["shibor"] = None
    except Exception as e:
        out["shibor"] = None
        out["shibor_error"] = str(e)

    # 3. 恒生国企 (HSCEI) 先行速率（非裸走势叠加，测算 20日/60日动量速率与相对强弱）
    try:
        hscei_map = _fetch_em_kline_close_map("100.HSCEI", limit=80)
        sh300_map = _fetch_em_kline_close_map("1.000300", limit=80)
        hs_dates = sorted(hscei_map.keys())
        if len(hs_dates) >= 21:
            hs_s = pd.Series([hscei_map[d] for d in hs_dates], index=hs_dates)
            ret_5 = round((hs_s.iloc[-1] / hs_s.iloc[-6] - 1.0) * 100.0, 2)
            ret_20 = round((hs_s.iloc[-1] / hs_s.iloc[-21] - 1.0) * 100.0, 2)
            ret_60 = round((hs_s.iloc[-1] / hs_s.iloc[-61] - 1.0) * 100.0, 2) if len(hs_s) >= 61 else None
            # 相对强弱（HSCEI 20日涨幅 - 沪深300 20日涨幅）
            sh_dates = sorted(sh300_map.keys())
            sh_ret_20 = (
                round((sh300_map[sh_dates[-1]] / sh300_map[sh_dates[-21]] - 1.0) * 100.0, 2)
                if len(sh_dates) >= 21
                else None
            )
            rel_20 = round(ret_20 - sh_ret_20, 2) if sh_ret_20 is not None else None
            if ret_20 <= -5.0:
                hk_sig, hk_note = "BEAR", f"恒生国企20日动量转弱({ret_20:+.2f}%)，先行信号偏空"
            elif ret_20 >= 5.0:
                hk_sig, hk_note = "BULL", f"恒生国企20日动量走强({ret_20:+.2f}%)，外资定价权先行转暖"
            else:
                hk_sig, hk_note = "NEUTRAL", f"恒生国企20日震荡({ret_20:+.2f}%)"
            out["hk_leading"] = {
                "trade_date": hs_dates[-1],
                "hscei_close": round(float(hs_s.iloc[-1]), 2),
                "ret_5d_pct": ret_5,
                "ret_20d_pct": ret_20,
                "ret_60d_pct": ret_60,
                "rel_vs_csi300_20d_pp": rel_20,
                "signal": hk_sig,
                "note": hk_note,
            }
        else:
            out["hk_leading"] = None
    except Exception as e:
        out["hk_leading"] = None
        out["hk_leading_error"] = str(e)

    return out


def fetch_midterm_dashboard(db_path: Optional[Path] = None, auto_backfill_days: int = 25) -> Dict[str, Any]:
    return {
        "erp": fetch_erp_signal(),
        "equal_weight_pe": fetch_equal_weight_pe(),
        "etf_19_accumulation": fetch_etf_19_signal(db_path=db_path, auto_backfill_days=auto_backfill_days),
        "insider_trading": fetch_insider_trading_pressure(days=30),
        "macro_and_hk": fetch_macro_and_hk_leading(),
    }


if __name__ == "__main__":
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="中期资金面与估值层数据抓取")
    parser.add_argument("--backfill-etf", type=int, default=0, help="回填近N日上交所宽基ETF份额")
    args = parser.parse_args()
    if args.backfill_etf > 0:
        n = backfill_sse_etf_shares(days=args.backfill_etf)
        print(f"Backfilled {n} trading days of SSE ETF shares.")
    else:
        print(json.dumps(fetch_midterm_dashboard(), ensure_ascii=False, indent=2))
