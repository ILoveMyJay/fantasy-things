#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_breadth_trin.py - 全A股微观拆量、市场宽广度、双口径TRIN(阿姆氏)、MCL与盘中实时监控屏
严守零造假原则：若行情源全数失败，返回 status='ERROR' 且所有数值为 None，绝不填充硬编码默认值。
"""

import argparse
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
                data = json.loads(resp.read().decode("utf-8"))
                d = data.get("data") or {}
                total = int(d.get("total") or 0)
                diff = d.get("diff") or []
                return total, diff
        except Exception as e:
            last_err = e
            time.sleep(0.3 * (attempt + 1))
    raise RuntimeError(f"EM clist page {page} failed: {last_err}")


def fetch_all_a_snapshot() -> Optional[pd.DataFrame]:
    """并发抓取全A 5500+只股票实时/收盘切片（沪深北全覆盖）"""
    page_size = 100
    try:
        total, first_rows = _fetch_em_page(1, page_size=page_size)
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
            records.append(
                {
                    "code": code,
                    "name": str(r.get("f14", "")),
                    "price": _safe_num(r.get("f2")),
                    "pct_chg": _safe_num(r.get("f3")),
                    "volume": _safe_num(r.get("f5")),        # 手
                    "amount": _safe_num(r.get("f6")),        # 元
                    "turnover_rate": _safe_num(r.get("f8")), # %
                    "pre_close": _safe_num(r.get("f18")),
                }
            )
        df = pd.DataFrame(records)
        if df.empty or len(df) < 3000:
            return None
        return df
    except Exception as e:
        sys.stderr.write(f"[fetch_breadth_trin] Error fetching all-A snapshot: {e}\n")
        return None


def _is_limit_up(code: str, name: str, pct: float) -> bool:
    if pct is None:
        return False
    if "ST" in name.upper():
        return pct >= 4.90
    if code.startswith(("300", "301", "688", "689")):
        return pct >= 19.85
    if code.startswith(("4", "8", "92")):
        return pct >= 29.85
    return pct >= 9.85


def _is_limit_down(code: str, name: str, pct: float) -> bool:
    if pct is None:
        return False
    if "ST" in name.upper():
        return pct <= -4.90
    if code.startswith(("300", "301", "688", "689")):
        return pct <= -19.85
    if code.startswith(("4", "8", "92")):
        return pct <= -29.85
    return pct <= -9.85


def classify_breadth_scenario(
    adv_ratio: Optional[float],
    trin_amount: Optional[float],
    amt_breadth_spread: Optional[float],
) -> Tuple[str, str]:
    """
    依据布鲁斯「宽广度 × TRIN_额 × 额价差」四象限规则定性当日短线资金行为。
    返回: (scenario_code, scenario_desc)
    """
    if adv_ratio is None or trin_amount is None or amt_breadth_spread is None:
        return "UNKNOWN", "数据缺失，无法定性"

    # 1. 高位量价背离（如 9-21: 宽广度 80%, TRIN_额 1.69 -> 小票无量涨、权重放量出货）
    if adv_ratio >= 70.0 and trin_amount >= 1.35:
        return "TOP_DIVERGENCE", "⚠️ 高位量价背离（小票无量补涨，少数权重放量出货）"

    # 2. 假反弹 / 空头回补（如 10-23 / 11-02 / 11-04 / 11-05: 高宽广度但 TRIN >= 0.88）
    if adv_ratio >= 65.0 and trin_amount >= 0.88:
        return "FAKE_REBOUND_SHORT_COVER", "⚠️ 缩量普涨/空头回补（大蓝筹未主动爆量进攻）"

    # 3. 极端抱团护盘 / 托而不举（如 11-13 / 11-18 / 11-20: 低宽广度 + 极低 TRIN + 高额价差）
    if adv_ratio <= 45.0 and trin_amount <= 0.58 and amt_breadth_spread >= 10.0:
        if adv_ratio <= 15.0 and trin_amount <= 0.35:
            return "EXTREME_WEIGHT_OR_ICE", "🔥 极端权重护盘/疑似冰点（须中期层共振+次日放量辨真伪）"
        return "WEIGHT_PROPPING", "⚠️ 抱团护盘/托而不举（少数权重硬拉指数，宽广度报废）"

    # 4. 宽广度偏低但 TRIN 极低（3-23 / 7-21 类候选冰点）
    if adv_ratio <= 55.0 and trin_amount <= 0.40:
        return "ICE_POINT_CANDIDATE", "🔥 资金集中扫货权重（疑似冰点，须中期层共振确认）"

    # 5. 健康普涨主动进攻（高宽广度 + TRIN < 0.88）
    if adv_ratio >= 65.0 and trin_amount < 0.88:
        return "HEALTHY_BULL_ATTACK", "✅ 放量普涨进攻（宽广度与大资金量能同步共振）"

    # 6. 无差别普跌出清（低宽广度 + TRIN >= 1.0）
    if adv_ratio <= 30.0 and trin_amount >= 1.0:
        return "BROAD_SELLOFF", "🔻 无差别普跌（抱团瓦解，跌势伴随放量抛压）"

    return "NEUTRAL_DIVERGENCE", "⚖️ 震荡分化（资金强弱中性）"


def compute_breadth_metrics(df: pd.DataFrame) -> Dict[str, Any]:
    """纯函数：根据全A截面 DataFrame 计算全部拆量与宽度指标（便于单元测试校验）"""
    valid = df[df["amount"].notna() & (df["amount"] > 0) & df["pct_chg"].notna()].copy()
    valid_count = int(len(valid))
    if valid_count == 0:
        return {}

    up = valid[valid["pct_chg"] > 0]
    down = valid[valid["pct_chg"] < 0]
    flat = valid[valid["pct_chg"] == 0]

    up_count = int(len(up))
    down_count = int(len(down))
    flat_count = int(len(flat))

    total_amount = float(valid["amount"].sum())
    up_amount = float(up["amount"].sum())
    down_amount = float(down["amount"].sum())

    total_vol = float(valid["volume"].fillna(0).sum())
    up_vol = float(up["volume"].fillna(0).sum())
    down_vol = float(down["volume"].fillna(0).sum())

    # 涨家占比（按全市场有效家数，和博主命令行画面一致：302/5574=5.42%, 1324/5576=23.74%）
    adv_ratio = round(up_count / valid_count * 100.0, 2)
    adv_amt_ratio = round(up_amount / total_amount * 100.0, 2) if total_amount > 0 else None
    adv_vol_ratio = round(up_vol / total_vol * 100.0, 2) if total_vol > 0 else None

    amt_breadth_spread = (
        round(adv_amt_ratio - adv_ratio, 2) if adv_amt_ratio is not None else None
    )
    amt_vol_spread = (
        round(adv_amt_ratio - adv_vol_ratio, 2)
        if adv_amt_ratio is not None and adv_vol_ratio is not None
        else None
    )

    # 双口径 TRIN（按非平盘的涨跌家数比 ÷ 涨跌成交额/量比）
    trin_amount = None
    if down_count > 0 and up_amount > 0 and down_amount > 0:
        trin_amount = round((up_count / down_count) / (up_amount / down_amount), 3)

    trin_volume = None
    if down_count > 0 and up_vol > 0 and down_vol > 0:
        trin_volume = round((up_count / down_count) / (up_vol / down_vol), 3)

    # 换手率 >= 5% 个股占比（布鲁斯 10-22 首次公开的底部出清观察点）
    turn_valid = valid["turnover_rate"].dropna()
    high_turnover_ratio = (
        round(float((turn_valid >= 5.0).mean() * 100.0), 2) if len(turn_valid) > 0 else None
    )

    limit_up = int(
        sum(
            1
            for c, n, p in zip(valid["code"], valid["name"], valid["pct_chg"])
            if _is_limit_up(c, n, p)
        )
    )
    limit_down = int(
        sum(
            1
            for c, n, p in zip(valid["code"], valid["name"], valid["pct_chg"])
            if _is_limit_down(c, n, p)
        )
    )

    # 上涨股人均成交额 / 下跌股人均成交额（对应 11-13 视频“人均成交额 2.9 倍”）
    avg_amt_ratio = None
    if up_count > 0 and down_count > 0 and down_amount > 0:
        avg_amt_ratio = round((up_amount / up_count) / (down_amount / down_count), 2)

    scenario_code, scenario_desc = classify_breadth_scenario(
        adv_ratio, trin_amount, amt_breadth_spread
    )

    return {
        "valid_count": valid_count,
        "up_count": up_count,
        "down_count": down_count,
        "flat_count": flat_count,
        "limit_up": limit_up,
        "limit_down": limit_down,
        "total_amount_yi": round(total_amount / 1e8, 2),
        "up_amount_yi": round(up_amount / 1e8, 2),
        "down_amount_yi": round(down_amount / 1e8, 2),
        "adv_ratio": adv_ratio,
        "adv_amt_ratio": adv_amt_ratio,
        "adv_vol_ratio": adv_vol_ratio,
        "amt_breadth_spread": amt_breadth_spread,
        "amt_vol_spread": amt_vol_spread,
        "trin_amount": trin_amount,
        "trin_volume": trin_volume,
        "avg_amt_ratio": avg_amt_ratio,
        "high_turnover_ratio": high_turnover_ratio,
        "scenario_code": scenario_code,
        "scenario_tag": scenario_desc,
    }


def compute_mcl_series(history_rows: List[Dict[str, Any]]) -> Dict[str, Optional[float]]:
    """
    基于历史每日涨跌家数计算 McClellan Oscillator (MCL)、MSI、ADL 与 10日 ADR。
    至少需要 2 天才开始有参考值，39 天以上 EMA39 趋于稳定。
    """
    if not history_rows:
        return {"mcl": None, "msi": None, "adl": None, "adr_10": None, "history_days": 0}

    net_adv = pd.Series(
        [(r["up_count"] - r["down_count"]) for r in history_rows], dtype=float
    )
    ups = pd.Series([r["up_count"] for r in history_rows], dtype=float)
    downs = pd.Series([r["down_count"] for r in history_rows], dtype=float)

    ema19 = net_adv.ewm(span=19, adjust=False).mean()
    ema39 = net_adv.ewm(span=39, adjust=False).mean()
    mcl_series = ema19 - ema39
    msi_series = mcl_series.cumsum()
    adl_series = net_adv.cumsum()

    win = min(10, len(history_rows))
    down_sum = float(downs.tail(win).sum())
    adr_10 = round(float(ups.tail(win).sum()) / down_sum, 3) if down_sum > 0 else None

    return {
        "mcl": round(float(mcl_series.iloc[-1]), 2),
        "msi": round(float(msi_series.iloc[-1]), 2),
        "adl": round(float(adl_series.iloc[-1]), 1),
        "adr_10": adr_10,
        "history_days": len(history_rows),
        "mcl_stable": len(history_rows) >= 39,
    }


def _detect_trade_date() -> str:
    """用上证指数最新日K确定当前业务交易日（优先东财，自动回退新浪）"""
    url = (
        "https://push2his.eastmoney.com/api/qt/stock/kline/get?"
        "secid=1.000001&fields1=f1&fields2=f51&klt=101&fqt=1&end=20500101&lmt=2"
    )
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=4) as r:
            klines = (json.loads(r.read().decode("utf-8")).get("data") or {}).get("klines") or []
            if klines:
                return klines[-1].split(",")[0]
    except Exception:
        pass
    try:
        import akshare as ak
        df = ak.stock_zh_index_daily(symbol="sh000001")
        if df is not None and not df.empty:
            return pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d").max()
    except Exception:
        pass
    return datetime.date.today().strftime("%Y-%m-%d")


def _fetch_all_a_snapshot_tushare(trade_date: str) -> Tuple[Optional[pd.DataFrame], str]:
    """东财 WAF 断连时的盘后备源：通过本地 Tushare Pro 拉取全A日线截面（5500+只股票）"""
    try:
        import tushare as ts
        pro = ts.pro_api()
        base_dt = datetime.datetime.strptime(trade_date, "%Y-%m-%d").date()
        # 尝试目标日期及前3个自然日（应对当日盘中/刚收盘Tushare尚未入库的情况）
        for offset in range(4):
            cand = (base_dt - datetime.timedelta(days=offset)).strftime("%Y-%m-%d")
            df = pro.daily(trade_date=cand.replace("-", ""))
            if df is not None and len(df) >= 3000:
                out = pd.DataFrame(
                    {
                        "code": df["ts_code"].astype(str).str.split(".").str[0],
                        "name": df["ts_code"].astype(str),
                        "price": pd.to_numeric(df["close"], errors="coerce"),
                        "pct_chg": pd.to_numeric(df["pct_chg"], errors="coerce"),
                        "volume": pd.to_numeric(df["vol"], errors="coerce"),
                        "amount": pd.to_numeric(df["amount"], errors="coerce") * 1000.0,  # 千元 -> 元
                        "turnover_rate": np.nan,
                        "pre_close": pd.to_numeric(df["pre_close"], errors="coerce"),
                    }
                )
                return out, cand
    except Exception as e:
        sys.stderr.write(f"[fetch_breadth_trin] Tushare fallback failed: {e}\n")
    return None, trade_date


def backfill_breadth_tushare(days: int = 60, db_path: Optional[Path] = None) -> int:
    """
    利用本地已配置的 Tushare Pro (`pro.daily(trade_date=...)`) 回填近 N 个交易日的全A拆量宽广度、
    双口径 TRIN 与 MCL/MSI 历史序列至本地 SQLite，使 MCL(EMA19-EMA39) 立即达到 39 日稳定期。
    注意：若未安装 tushare 或未配置有效 token，返回 0 而不报错。
    """
    try:
        import tushare as ts
        pro = ts.pro_api()
    except Exception as e:
        sys.stderr.write(f"[fetch_breadth_trin] Tushare unavailable for backfill: {e}\n")
        return 0

    # 获取近 N 个交易日列表
    url = (
        f"https://push2his.eastmoney.com/api/qt/stock/kline/get?"
        f"secid=1.000001&fields1=f1&fields2=f51&klt=101&fqt=1&end=20500101&lmt={days + 5}"
    )
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=6) as r:
            klines = (json.loads(r.read().decode("utf-8")).get("data") or {}).get("klines") or []
        trade_dates = [k.split(",")[0] for k in klines][-days:]
    except Exception:
        return 0

    if not trade_dates:
        return 0

    conn = get_conn(db_path)
    inserted = 0
    try:
        existing = {r[0] for r in conn.execute("SELECT trade_date FROM daily_breadth").fetchall()}
        targets = [d for d in trade_dates if d not in existing]
        for dt_str in targets:
            ymd = dt_str.replace("-", "")
            df = None
            for attempt in range(4):
                try:
                    df = pro.daily(trade_date=ymd)
                    break
                except Exception as e:
                    msg = str(e)
                    wait = 20 if ("每分钟" in msg or "频率" in msg or "limit" in msg.lower()) else 2 * (attempt + 1)
                    time.sleep(wait)
            if df is None or df.empty:
                continue
            valid = df[df["amount"].notna() & (df["amount"] > 0) & df["pct_chg"].notna()].copy()
            if len(valid) < 2000:
                continue
            up = valid[valid["pct_chg"] > 0]
            dn = valid[valid["pct_chg"] < 0]
            fl = valid[valid["pct_chg"] == 0]
            up_c, dn_c, fl_c = int(len(up)), int(len(dn)), int(len(fl))
            valid_c = int(len(valid))
            tot_amt = float(valid["amount"].sum())  # 千元
            up_amt = float(up["amount"].sum())
            dn_amt = float(dn["amount"].sum())
            tot_vol = float(valid["vol"].fillna(0).sum())
            up_vol = float(up["vol"].fillna(0).sum())
            dn_vol = float(dn["vol"].fillna(0).sum())

            adv_ratio = round(up_c / valid_c * 100.0, 2)
            adv_amt_ratio = round(up_amt / tot_amt * 100.0, 2) if tot_amt > 0 else None
            adv_vol_ratio = round(up_vol / tot_vol * 100.0, 2) if tot_vol > 0 else None
            amt_spread = round(adv_amt_ratio - adv_ratio, 2) if adv_amt_ratio is not None else None
            vol_spread = round(adv_amt_ratio - adv_vol_ratio, 2) if (adv_amt_ratio is not None and adv_vol_ratio is not None) else None
            trin_amt = round((up_c / dn_c) / (up_amt / dn_amt), 3) if (dn_c > 0 and up_amt > 0 and dn_amt > 0) else None
            trin_vol = round((up_c / dn_c) / (up_vol / dn_vol), 3) if (dn_c > 0 and up_vol > 0 and dn_vol > 0) else None
            _, stag = classify_breadth_scenario(adv_ratio, trin_amt, amt_spread)

            row = {
                "trade_date": dt_str,
                "captured_at": f"{dt_str} 15:00:00 (tushare)",
                "valid_count": valid_c,
                "up_count": up_c,
                "down_count": dn_c,
                "flat_count": fl_c,
                "limit_up": None,
                "limit_down": None,
                "total_amount_yi": round(tot_amt / 1e5, 2),
                "up_amount_yi": round(up_amt / 1e5, 2),
                "down_amount_yi": round(dn_amt / 1e5, 2),
                "adv_ratio": adv_ratio,
                "adv_amt_ratio": adv_amt_ratio,
                "adv_vol_ratio": adv_vol_ratio,
                "amt_breadth_spread": amt_spread,
                "amt_vol_spread": vol_spread,
                "trin_amount": trin_amt,
                "trin_volume": trin_vol,
                "high_turnover_ratio": None,
                "mcl": None,
                "msi": None,
                "adl": None,
                "adr_10": None,
                "scenario_tag": stag,
            }
            upsert_breadth(conn, row)
            inserted += 1

        # 重新计算并回写全表历史 MCL / MSI / ADL / ADR_10
        all_rows = fetch_breadth_history(conn, limit=1000)
        if all_rows:
            net_adv = pd.Series([(r["up_count"] - r["down_count"]) for r in all_rows], dtype=float)
            ups = pd.Series([r["up_count"] for r in all_rows], dtype=float)
            downs = pd.Series([r["down_count"] for r in all_rows], dtype=float)
            mcl_s = net_adv.ewm(span=19, adjust=False).mean() - net_adv.ewm(span=39, adjust=False).mean()
            msi_s = mcl_s.cumsum()
            adl_s = net_adv.cumsum()
            for i, r in enumerate(all_rows):
                w0 = max(0, i - 9)
                dn_sum = float(downs.iloc[w0:i + 1].sum())
                adr10 = round(float(ups.iloc[w0:i + 1].sum()) / dn_sum, 3) if dn_sum > 0 else None
                conn.execute(
                    "UPDATE daily_breadth SET mcl=?, msi=?, adl=?, adr_10=? WHERE trade_date=?",
                    (round(float(mcl_s.iloc[i]), 2), round(float(msi_s.iloc[i]), 2), round(float(adl_s.iloc[i]), 1), adr10, r["trade_date"]),
                )
            conn.commit()
    finally:
        conn.close()
    return inserted


def fetch_breadth_dashboard(save_to_db: bool = True, db_path: Optional[Path] = None) -> Dict[str, Any]:
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    trade_date = _detect_trade_date()
    data_source = "eastmoney"
    df = fetch_all_a_snapshot()
    if df is None:
        df, ts_date = _fetch_all_a_snapshot_tushare(trade_date)
        if df is not None:
            trade_date = ts_date
            data_source = "tushare_daily"
    if df is None:
        return {
            "status": "ERROR",
            "error": "全A实时/收盘截面接口获取失败（东财与Tushare均失败，已重试，未填充虚假数据）",
            "trade_date": trade_date,
            "captured_at": now_str,
        }

    metrics = compute_breadth_metrics(df)
    metrics["trade_date"] = trade_date
    metrics["captured_at"] = now_str
    metrics["data_source"] = data_source
    metrics["status"] = "OK"

    conn = get_conn(db_path)
    try:
        hist = fetch_breadth_history(conn, limit=250)
        # 合并今日临时/收盘行以计算最新 MCL
        merged = [r for r in hist if r["trade_date"] != trade_date]
        merged.append(metrics)
        mcl_info = compute_mcl_series(merged)
        metrics.update(mcl_info)

        # 计算 TRIN_额 的历史分位（需至少 10 天样本）
        past_trins = [r["trin_amount"] for r in hist if r.get("trin_amount") is not None]
        if len(past_trins) >= 10 and metrics.get("trin_amount") is not None:
            pct_rank = sum(1 for x in past_trins if x <= metrics["trin_amount"]) / len(past_trins) * 100.0
            metrics["trin_amount_pct_rank"] = round(pct_rank, 1)
        else:
            metrics["trin_amount_pct_rank"] = None

        if save_to_db:
            upsert_breadth(conn, metrics)
    finally:
        conn.close()

    return metrics


def format_cli_tick(m: Dict[str, Any]) -> str:
    """复刻布鲁斯命令行实时监控屏单次刷新格式"""
    if m.get("status") != "OK":
        return f"[{datetime.datetime.now().strftime('%H:%M:%S')}] ❌ 数据获取失败: {m.get('error')}"
    ts = m["captured_at"].split(" ")[-1]
    spread = m.get("amt_breadth_spread")
    vspread = m.get("amt_vol_spread")
    spread_s = f"{spread:+.2f}" if spread is not None else "N/A"
    vspread_s = f"{vspread:+.2f}" if vspread is not None else "N/A"
    flow_note = "放量(资金强于宽度)" if (m.get("trin_amount") or 1.0) < 1.0 else "资金弱于宽度"
    lines = [
        f"[{ts}] 涨家占比 {m['adv_ratio']:.2f}% | 涨额占比 {m['adv_amt_ratio']:.2f}% | 额价差 {spread_s}pp | "
        f"TRIN额 {m['trin_amount']} | TRIN量 {m['trin_volume']} | 涨停 {m['limit_up']} 跌停 {m['limit_down']}",
        f"           涨{m['up_count']}/跌{m['down_count']}/平{m['flat_count']} | 有效 {m['valid_count']} | "
        f"成交额 {m['total_amount_yi']}亿 -> {flow_note}",
        f"           量价差 {vspread_s}pp | 涨量占比 {m['adv_vol_ratio']:.2f}% | 换手>=5%占比 {m['high_turnover_ratio']}% | "
        f"定性: {m['scenario_tag']}",
    ]
    return "\n".join(lines)


def run_watch_loop(interval_sec: int = 60, max_ticks: int = 0) -> None:
    print(f"=== A股微观拆量 & 双口径TRIN 实时监控屏 (每 {interval_sec} 秒刷新，15:00 自动落盘停止) ===")
    ticks = 0
    while True:
        now = datetime.datetime.now()
        m = fetch_breadth_dashboard(save_to_db=True)
        print(format_cli_tick(m), flush=True)
        ticks += 1
        if max_ticks > 0 and ticks >= max_ticks:
            break
        if now.hour >= 15 and now.minute >= 1 and max_ticks == 0:
            print("已到 15:00 收盘，收盘数据已落盘，停止刷新。", flush=True)
            break
        time.sleep(interval_sec)


if __name__ == "__main__":
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="全A拆量、宽广度、TRIN与盘中实时监控")
    parser.add_argument("--watch", type=int, default=0, help="盘中每N秒循环刷新（如 --watch 60）")
    parser.add_argument("--max-ticks", type=int, default=0, help="最多刷新次数（0为不限，仅测试用）")
    parser.add_argument("--no-save", action="store_true", help="不写入本地SQLite")
    args = parser.parse_args()

    if args.watch > 0:
        run_watch_loop(interval_sec=args.watch, max_ticks=args.max_ticks)
    else:
        res = fetch_breadth_dashboard(save_to_db=not args.no_save)
        print(json.dumps(res, ensure_ascii=False, indent=2))
