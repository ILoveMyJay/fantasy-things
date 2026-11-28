#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_breadth_tcr.py - 全A微观宽广度、真中位数、修正版TRIN/额价差、双创TCR与MCL。

核心升级（吸收 Phase 0 与 Walk-Forward 实证结论）：
  1. 修正 TRIN_额 高广度奇点（adv_ratio>=85% & adv_amt_ratio>=80% 不再误标 TOP_DIVERGENCE），
     并叠加 MA20 乖离率门禁区分“底部放量普涨(BROAD_SURGE_EXPANDING)”与“冲顶过热(BLOWOFF_EUPHORIA)”；
  2. 一次快照同步产出：全A真中位数、5日累计中位数、双创拥挤度 TCR 及 120D 分位、炸板率近似、MCL/MSI/ADR10；
  3. 明确标注实际行情交易日 `trade_date`，绝不静默混拼跨日数据。
"""

from __future__ import annotations

import concurrent.futures
import datetime
import json
import math
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from db_store import fetch_breadth_history, get_conn, upsert_breadth

EM_CLIST_URLS = [
    "https://push2.eastmoney.com/api/qt/clist/get",
    "https://82.push2.eastmoney.com/api/qt/clist/get",
]
EM_FS_ALL_A = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048"
EM_FIELDS = "f12,f14,f2,f3,f5,f6,f8,f15,f16,f17,f18"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://quote.eastmoney.com/",
}


def _safe_num(val: Any) -> Optional[float]:
    if val is None or val == "-" or val == "":
        return None
    try:
        v = float(val)
        return None if math.isnan(v) or math.isinf(v) else v
    except (ValueError, TypeError):
        return None


def _get_latest_market_date() -> str:
    """通过腾讯上证日K获取最新真实交易日（秒级、零限流）。"""
    try:
        url = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000001,day,,,3,qfq"
        req = urllib.request.Request(url, headers={"User-Agent": HEADERS["User-Agent"]})
        with urllib.request.urlopen(req, timeout=4) as r:
            rows = (json.loads(r.read().decode("utf-8")).get("data", {}).get("sh000001", {}).get("day") or [])
            if rows:
                return str(rows[-1][0])
    except Exception:
        pass
    return datetime.date.today().strftime("%Y-%m-%d")


def _fetch_em_page(page: int, page_size: int = 100) -> Tuple[int, List[Dict[str, Any]]]:
    last_err = None
    for attempt in range(3):
        base = EM_CLIST_URLS[attempt % len(EM_CLIST_URLS)]
        url = (
            f"{base}?pn={page}&pz={page_size}&po=1&np=1"
            f"&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f12"
            f"&fs={EM_FS_ALL_A}&fields={EM_FIELDS}"
        )
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=6) as resp:
                d = (json.loads(resp.read().decode("utf-8")).get("data") or {})
                return int(d.get("total") or 0), (d.get("diff") or [])
        except Exception as e:
            last_err = e
            time.sleep(0.25 * (attempt + 1))
    raise RuntimeError(f"EM clist page {page} failed: {last_err}")


def fetch_all_a_snapshot() -> Optional[pd.DataFrame]:
    """并发抓取全A 5300+只股票实时/收盘截面。"""
    try:
        total, first_rows = _fetch_em_page(1, page_size=100)
        if total <= 0 or not first_rows:
            return None
        actual_pz = len(first_rows)
        total_pages = math.ceil(total / actual_pz)
        all_rows = list(first_rows)
        if total_pages > 1:
            with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
                futs = {ex.submit(_fetch_em_page, p, actual_pz): p for p in range(2, total_pages + 1)}
                for fut in concurrent.futures.as_completed(futs):
                    _, rows = fut.result()
                    if rows:
                        all_rows.extend(rows)

        records = []
        seen = set()
        for r in all_rows:
            code = str(r.get("f12", ""))
            if not code or code in seen:
                continue
            seen.add(code)
            records.append({
                "code": code,
                "name": str(r.get("f14", "")),
                "price": _safe_num(r.get("f2")),
                "pct_chg": _safe_num(r.get("f3")),
                "volume": _safe_num(r.get("f5")),
                "amount": _safe_num(r.get("f6")),
                "turnover_rate": _safe_num(r.get("f8")),
                "high": _safe_num(r.get("f15")),
                "pre_close": _safe_num(r.get("f18")),
            })
        df = pd.DataFrame(records)
        return df if len(df) >= 3000 else None
    except Exception as e:
        sys.stderr.write(f"[fetch_breadth_tcr] EM all-A snapshot failed: {e}\n")
        return None


def _limit_threshold(code: str, name: str) -> float:
    if "ST" in name.upper():
        return 4.90
    if code.startswith(("300", "301", "688", "689")):
        return 19.85
    if code.startswith(("4", "8", "92")):
        return 29.85
    return 9.85


def classify_breadth_scenario_cockpit(
    adv_ratio: Optional[float],
    trin_amount: Optional[float],
    amt_breadth_spread: Optional[float],
    vol_ratio_prev: Optional[float] = None,
    hs300_ext_ma20_pct: Optional[float] = None,
) -> Tuple[str, str]:
    """
    修正版宽广度 × TRIN_额 × 额价差 × 位置护栏场景定性（纯函数）：
      - 当 adv_ratio >= 85% 且 adv_amt_ratio >= 80%：
        * 若 hs300_ext_ma20_pct > +8.0% -> BLOWOFF_EUPHORIA（如 2024-10-08 冲顶暴走）
        * 若 vol_ratio_prev >= 1.05     -> BROAD_SURGE_EXPANDING（如 2026-11-27 放量普涨）
        * 否则                          -> BROAD_SURGE_GENERAL
      - 若 adv_ratio >= 85% 但 adv_amt_ratio < 80%（如 2021-02-18 抱团崩盘 adv_amt=60.6%），
        仍保留 TOP_DIVERGENCE 警示！
    """
    if adv_ratio is None or trin_amount is None or amt_breadth_spread is None:
        return "UNKNOWN", "数据缺失，无法定性"

    adv_amt_ratio = adv_ratio + amt_breadth_spread
    if adv_ratio >= 85.0 and adv_amt_ratio >= 80.0:
        if hs300_ext_ma20_pct is not None and hs300_ext_ma20_pct > 8.0:
            return "BLOWOFF_EUPHORIA", "🔥 极端普涨且严重偏离均线（冲顶暴走警戒，触发仓位封顶保护）"
        if vol_ratio_prev is not None and vol_ratio_prev >= 1.05:
            return "BROAD_SURGE_EXPANDING", "✅ 放量普涨共振进攻（高广度+高涨额占比，已修正TRIN数学奇点）"
        return "BROAD_SURGE_GENERAL", "✅ 全面普涨共振（高广度+高涨额占比）"

    if adv_ratio >= 70.0 and trin_amount >= 1.35:
        return "TOP_DIVERGENCE", "⚠️ 高位量价背离（小票无量补涨，少数权重放量出货）"
    if adv_ratio >= 65.0 and trin_amount >= 0.88:
        return "FAKE_REBOUND_SHORT_COVER", "⚠️ 缩量普涨/空头回补（大蓝筹未主动爆量进攻）"
    if adv_ratio <= 45.0 and trin_amount <= 0.58 and amt_breadth_spread >= 10.0:
        if adv_ratio <= 15.0 and trin_amount <= 0.35:
            return "EXTREME_WEIGHT_OR_ICE", "🔥 极端权重护盘/疑似冰点（须中期层/左尾探针确认）"
        return "WEIGHT_PROPPING", "⚠️ 抱团护盘/托而不举（少数权重硬拉指数，宽广度报废）"
    if adv_ratio <= 55.0 and trin_amount <= 0.40:
        return "ICE_POINT_CANDIDATE", "🔥 资金集中扫货权重（疑似冰点）"
    if adv_ratio >= 65.0 and trin_amount < 0.88:
        return "HEALTHY_BULL_ATTACK", "✅ 放量普涨进攻（宽广度与大资金量能共振）"
    if adv_ratio <= 30.0 and trin_amount >= 1.0:
        return "BROAD_SELLOFF", "🔻 无差别普跌（跌势伴随放量抛压）"
    return "NEUTRAL_DIVERGENCE", "⚖️ 震荡分化（资金强弱中性）"


def compute_breadth_and_tcr(
    df: pd.DataFrame,
    vol_ratio_prev: Optional[float] = None,
    hs300_ext_ma20_pct: Optional[float] = None,
) -> Dict[str, Any]:
    """纯函数：计算全A宽度、真中位数、双口径TRIN、双创TCR及炸板率。"""
    valid = df[df["amount"].notna() & (df["amount"] > 0) & df["pct_chg"].notna()].copy()
    valid = valid[valid["pct_chg"].abs() <= 500.0]  # 过滤极端新股/异常脏值
    valid_count = int(len(valid))
    if valid_count == 0:
        return {}

    up = valid[valid["pct_chg"] > 0]
    down = valid[valid["pct_chg"] < 0]
    flat = valid[valid["pct_chg"] == 0]
    up_count, down_count, flat_count = int(len(up)), int(len(down)), int(len(flat))

    total_amount = float(valid["amount"].sum())
    up_amount = float(up["amount"].sum())
    down_amount = float(down["amount"].sum())
    total_vol = float(valid["volume"].fillna(0).sum())
    up_vol = float(up["volume"].fillna(0).sum())
    down_vol = float(down["volume"].fillna(0).sum())

    adv_ratio = round(up_count / valid_count * 100.0, 2)
    adv_amt_ratio = round(up_amount / total_amount * 100.0, 2) if total_amount > 0 else None
    adv_vol_ratio = round(up_vol / total_vol * 100.0, 2) if total_vol > 0 else None
    amt_breadth_spread = round(adv_amt_ratio - adv_ratio, 2) if adv_amt_ratio is not None else None

    trin_amount = (
        round((up_count / down_count) / (up_amount / down_amount), 3)
        if down_count > 0 and up_amount > 0 and down_amount > 0 else None
    )
    trin_volume = (
        round((up_count / down_count) / (up_vol / down_vol), 3)
        if down_count > 0 and up_vol > 0 and down_vol > 0 else None
    )

    # 全A真中位数与均值
    median_pct = round(float(valid["pct_chg"].median()), 2)
    mean_pct = round(float(valid["pct_chg"].mean()), 2)

    # 双创科技拥挤度 TCR（创业板300/301 + 科创板688/689 占沪深两市总成交额比）
    codes = valid["code"].astype(str)
    is_bj = codes.str.startswith(("4", "8", "92"))
    is_cyb = codes.str.startswith(("300", "301"))
    is_star = codes.str.startswith(("688", "689"))
    sh_sz_amt = float(valid.loc[~is_bj, "amount"].sum())
    cyb_amt = float(valid.loc[is_cyb, "amount"].sum())
    star_amt = float(valid.loc[is_star, "amount"].sum())
    tcr_double_tech = round((cyb_amt + star_amt) / sh_sz_amt * 100.0, 2) if sh_sz_amt > 0 else None

    # 涨停 / 跌停 / 炸板率估算
    limit_up = 0
    limit_down = 0
    broken_board = 0
    has_hl = "high" in valid.columns and "pre_close" in valid.columns
    for row in valid.itertuples(index=False):
        th = _limit_threshold(str(row.code), str(row.name))
        pct = float(row.pct_chg)
        if pct >= th:
            limit_up += 1
        elif pct <= -th:
            limit_down += 1
        elif has_hl and pd.notna(row.high) and pd.notna(row.pre_close) and float(row.pre_close) > 0:
            hi_pct = (float(row.high) / float(row.pre_close) - 1.0) * 100.0
            if hi_pct >= th:
                broken_board += 1

    broken_board_rate = (
        round(broken_board / (limit_up + broken_board) * 100.0, 1)
        if (limit_up + broken_board) > 0 else 0.0
    )

    sc_code, sc_tag = classify_breadth_scenario_cockpit(
        adv_ratio, trin_amount, amt_breadth_spread,
        vol_ratio_prev=vol_ratio_prev,
        hs300_ext_ma20_pct=hs300_ext_ma20_pct,
    )

    return {
        "valid_count": valid_count,
        "up_count": up_count,
        "down_count": down_count,
        "flat_count": flat_count,
        "limit_up": limit_up,
        "limit_down": limit_down,
        "broken_board_count": broken_board,
        "broken_board_rate": broken_board_rate,
        "total_amount_yi": round(total_amount / 1e8, 2),
        "up_amount_yi": round(up_amount / 1e8, 2),
        "down_amount_yi": round(down_amount / 1e8, 2),
        "adv_ratio": adv_ratio,
        "adv_amt_ratio": adv_amt_ratio,
        "adv_vol_ratio": adv_vol_ratio,
        "amt_breadth_spread": amt_breadth_spread,
        "trin_amount": trin_amount,
        "trin_volume": trin_volume,
        "median_pct": median_pct,
        "mean_pct": mean_pct,
        "tcr_double_tech": tcr_double_tech,
        "tcr_chinext": round(cyb_amt / sh_sz_amt * 100.0, 2) if sh_sz_amt > 0 else None,
        "tcr_star": round(star_amt / sh_sz_amt * 100.0, 2) if sh_sz_amt > 0 else None,
        "scenario_code": sc_code,
        "scenario_tag": sc_tag,
    }


def _fetch_all_a_snapshot_tushare(trade_date: str) -> Tuple[Optional[pd.DataFrame], str]:
    """东财 WAF 断连时的盘后备源：Tushare Pro 全A日线截面（严格返回真实交易日 cand，绝不伪造日期）。"""
    try:
        import tushare as ts
        pro = ts.pro_api()
        base_dt = datetime.date.fromisoformat(trade_date)
        for offset in range(4):
            cand = (base_dt - datetime.timedelta(days=offset)).strftime("%Y-%m-%d")
            df = pro.daily(trade_date=cand.replace("-", ""))
            if df is not None and len(df) >= 3000:
                out = pd.DataFrame({
                    "code": df["ts_code"].astype(str).str.split(".").str[0],
                    "name": df["ts_code"].astype(str),
                    "price": pd.to_numeric(df["close"], errors="coerce"),
                    "pct_chg": pd.to_numeric(df["pct_chg"], errors="coerce"),
                    "volume": pd.to_numeric(df["vol"], errors="coerce"),
                    "amount": pd.to_numeric(df["amount"], errors="coerce") * 1000.0,
                    "turnover_rate": np.nan,
                    "high": pd.to_numeric(df["high"], errors="coerce"),
                    "pre_close": pd.to_numeric(df["pre_close"], errors="coerce"),
                })
                return out, cand
    except Exception as e:
        sys.stderr.write(f"[fetch_breadth_tcr] Tushare fallback failed: {e}\n")
    return None, trade_date


def calc_intraday_progress(
    trade_date: str,
    now_dt: Optional[datetime.datetime] = None,
    is_realtime_source: bool = True,
) -> Dict[str, Any]:
    """
    判断当前是盘中还是盘后，并精确计算A股已开市交易分钟数（满分 240 分钟）：
      - 上午 09:30 ~ 11:30 -> 1 ~ 120 分钟
      - 午间休市 11:30 ~ 13:00 -> 固定 120 分钟
      - 下午 13:00 ~ 15:00 -> 120 ~ 240 分钟
      - 15:00 及以后 / 周末节假日 / 历史交易日 / Tushare盘后源 -> 盘后收盘（240 分钟，折算系数 1.0，不折算）
    """
    now = now_dt or datetime.datetime.now()
    today_str = now.strftime("%Y-%m-%d")

    if not is_realtime_source or trade_date != today_str:
        return {
            "is_intraday": False,
            "elapsed_minutes": 240,
            "scale_factor": 1.0,
            "session_phase": "盘后收盘(无需折算)",
        }

    hm = now.hour * 60 + now.minute
    open_am = 9 * 60 + 30    # 570
    close_am = 11 * 60 + 30  # 690
    open_pm = 13 * 60        # 780
    close_pm = 15 * 60       # 900

    if hm >= close_pm:
        return {
            "is_intraday": False,
            "elapsed_minutes": 240,
            "scale_factor": 1.0,
            "session_phase": "盘后收盘(无需折算)",
        }
    if hm <= open_am:
        return {
            "is_intraday": True,
            "elapsed_minutes": 1,
            "scale_factor": 1.0,
            "session_phase": "盘前集合竞价(暂不折算)",
        }
    if hm <= close_am:
        elapsed = max(1, hm - open_am)
    elif hm < open_pm:
        elapsed = 120
    else:
        elapsed = 120 + (hm - open_pm)

    elapsed = max(1, min(240, elapsed))
    scale = round(240.0 / elapsed, 4)
    return {
        "is_intraday": True,
        "elapsed_minutes": elapsed,
        "scale_factor": scale,
        "session_phase": f"盘中实时({now.strftime('%H:%M')}，已开市{elapsed}/240分，折算系数×{scale:.2f})",
    }


def fetch_breadth_tcr_dashboard(
    save: bool = True,
    db_path: Optional[Path] = None,
    hs300_ext_ma20_pct: Optional[float] = None,
    now_dt: Optional[datetime.datetime] = None,
) -> Dict[str, Any]:
    """抓取全A微观宽广度/TRIN/中位数/TCR（东财实时 -> Tushare盘后容错，盘中自动按开市分钟折算全天量比）。"""
    trade_date = _get_latest_market_date()
    data_source = "eastmoney_realtime"
    df = fetch_all_a_snapshot()
    if df is None or df.empty:
        df, actual_dt = _fetch_all_a_snapshot_tushare(trade_date)
        trade_date = actual_dt
        data_source = "tushare_daily_fallback"
    if df is None or df.empty:
        return {"status": "ERROR", "trade_date": None, "error": "全A快照主备源均抓取失败（严守零造假）"}

    conn = get_conn(db_path)
    try:
        hist = fetch_breadth_history(conn, limit=130)
    finally:
        conn.close()

    prev_hist = [h for h in hist if h["trade_date"] < trade_date]
    prev_amt = float(prev_hist[-1]["total_amount_yi"]) if prev_hist and prev_hist[-1].get("total_amount_yi") else None

    m_init = compute_breadth_and_tcr(df, vol_ratio_prev=None, hs300_ext_ma20_pct=hs300_ext_ma20_pct)
    if not m_init:
        return {"status": "ERROR", "trade_date": trade_date, "error": "全A有效成交样本为空"}

    prog = calc_intraday_progress(
        trade_date=trade_date,
        now_dt=now_dt,
        is_realtime_source=(data_source == "eastmoney_realtime"),
    )
    est_full_amt_yi = round(m_init["total_amount_yi"] * prog["scale_factor"], 2)
    vol_ratio_prev = round(est_full_amt_yi / prev_amt, 3) if prev_amt and prev_amt > 0 else None
    metrics = compute_breadth_and_tcr(df, vol_ratio_prev=vol_ratio_prev, hs300_ext_ma20_pct=hs300_ext_ma20_pct)
    metrics["vol_ratio_prev"] = vol_ratio_prev
    metrics["estimated_full_day_amount_yi"] = est_full_amt_yi
    metrics["is_intraday"] = prog["is_intraday"]
    metrics["elapsed_minutes"] = prog["elapsed_minutes"]
    metrics["volume_scale_factor"] = prog["scale_factor"]
    metrics["session_phase"] = prog["session_phase"]
    metrics["data_source"] = data_source

    # 历史滚动计算：MCL、MSI、ADR10、5日累计中位数、TCR 120日分位
    net_series = [float((h.get("up_count") or 0) - (h.get("down_count") or 0)) for h in prev_hist]
    net_series.append(float(metrics["up_count"] - metrics["down_count"]))
    s_net = pd.Series(net_series)
    mcl_series = s_net.ewm(span=19, adjust=False).mean() - s_net.ewm(span=39, adjust=False).mean()
    mcl = round(float(mcl_series.iloc[-1]), 2)
    msi = round(float(mcl_series.sum()), 2)

    ups_10 = [int(h.get("up_count") or 0) for h in prev_hist[-9:]] + [metrics["up_count"]]
    dns_10 = [int(h.get("down_count") or 0) for h in prev_hist[-9:]] + [metrics["down_count"]]
    adr_10 = round(sum(ups_10) / sum(dns_10), 3) if sum(dns_10) > 0 else None

    med_hist = [float(h["median_pct"]) for h in prev_hist[-4:] if h.get("median_pct") is not None] + [metrics["median_pct"]]
    median_cum_5d = round(sum(med_hist), 2) if len(med_hist) >= 5 else None

    tcr_hist = [float(h["tcr_double_tech"]) for h in prev_hist[-119:] if h.get("tcr_double_tech") is not None]
    if metrics["tcr_double_tech"] is not None:
        tcr_hist.append(metrics["tcr_double_tech"])
    tcr_pct120 = (
        round(sum(1 for x in tcr_hist if x <= metrics["tcr_double_tech"]) / len(tcr_hist) * 100.0, 1)
        if len(tcr_hist) >= 20 and metrics["tcr_double_tech"] is not None else None
    )

    result = {
        "status": "OK",
        "trade_date": trade_date,
        "captured_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "history_days": len(net_series),
        "mcl_stable": len(net_series) >= 39,
        "mcl": mcl,
        "msi": msi,
        "adr_10": adr_10,
        "median_cum_5d": median_cum_5d,
        "tcr_pct120": tcr_pct120,
        **metrics,
    }

    if save:
        conn = get_conn(db_path)
        try:
            upsert_breadth(conn, result)
        finally:
            conn.close()

    return result


if __name__ == "__main__":
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(fetch_breadth_tcr_dashboard(save=False), ensure_ascii=False, indent=2))
