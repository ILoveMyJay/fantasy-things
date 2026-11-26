# -*- coding: utf-8 -*-
"""看板 6 —— 全市场两融杠杆与滚动 5 日出清弹性 Em。

实盘数据直连：
  1. 全市场两融余额、融资/融券明细及近 10 日序列：东财数据中心 RPTA_RZRQ_LSDB（法定 T+1 披露）；
  2. 上证指数近 10 日收盘序列：push2his.eastmoney.com，精确计算 5 日滚动出清弹性 Em；
  3. 重点自选股融资余额与单日净买入：东财数据中心 RPTA_WEB_RZRQ_GGMX；
  4. 接口不可用时严格返回 None，绝不伪造常数；保留测试注入模式。
"""

from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

_BASE_DIR = Path(__file__).resolve().parent.parent
_WATCHLIST_PATH = _BASE_DIR / "data" / "default_watchlist.json"
_CUSTOM_PATH = _BASE_DIR / "references" / "custom_stocks.json"

_STATIC_ETF_EXCLUSION: set[str] = {"510300", "510500", "510050"}


def _safe_float(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def _load_watchlist() -> list[dict]:
    if _CUSTOM_PATH.exists():
        with open(_CUSTOM_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("stocks", data) if isinstance(data, dict) else data
    if _WATCHLIST_PATH.exists():
        with open(_WATCHLIST_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("stocks", [])
    return []


def _filter_etf(symbol: str) -> bool:
    code = symbol.split(".")[0] if "." in symbol else symbol
    return code not in _STATIC_ETF_EXCLUSION


def calculate_em_elasticity(
    margin_pct_5d: float | None,
    index_pct_5d: float | None,
) -> dict[str, Any]:
    """计算出清弹性系数 Em = ΔMargin%_5d / ΔIndex%_5d。"""
    if margin_pct_5d is None or index_pct_5d is None:
        return {
            "em": None,
            "label": "数据缺失",
            "verdict": "数据缺失",
            "margin_pct_5d": margin_pct_5d,
            "index_pct_5d": index_pct_5d,
        }
    if abs(index_pct_5d) < 1e-6:
        return {
            "em": None,
            "label": "指数近5日基本走平",
            "verdict": "指数近5日基本走平",
            "margin_pct_5d": round(margin_pct_5d, 2),
            "index_pct_5d": round(index_pct_5d, 2),
        }

    em = margin_pct_5d / index_pct_5d
    label: str | None = None
    if index_pct_5d < 0:
        if em > 1.2:
            label = "出清充分"
        elif em < 0.5:
            label = "出清不足"
        else:
            label = "出清一般"
    else:
        label = "上涨周期（仅报数值不贴出清标签）"

    return {
        "em": round(em, 4),
        "label": label,
        "verdict": label,
        "margin_pct_5d": round(margin_pct_5d, 2),
        "index_pct_5d": round(index_pct_5d, 2),
    }


calculate_em = calculate_em_elasticity


def _fetch_live_market_margin_series() -> dict[str, Any]:
    """拉取全市场近 10 个交易日两融余额（单位：亿元）与 5 日变动百分比。"""
    url = (
        "https://datacenter-web.eastmoney.com/api/data/v1/get"
        "?reportName=RPTA_RZRQ_LSDB&columns=ALL&pageNumber=1&pageSize=12"
        "&sortTypes=-1&sortColumns=DIM_DATE"
    )
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://data.eastmoney.com/"}
        )
        with urllib.request.urlopen(req, timeout=6) as resp:
            res = json.loads(resp.read().decode("utf-8"))
            rows = (res.get("result") or {}).get("data") or []
            full_rows = [
                r for r in rows
                if (r.get("TOTAL_RZRQYE") is not None or r.get("RZRQYE") is not None)
            ]
            if not full_rows:
                return {}

            latest = full_rows[0]
            prev = full_rows[1] if len(full_rows) > 1 else None

            def _tot(r):
                v = _safe_float(r.get("TOTAL_RZRQYE"))
                return (v if v is not None else _safe_float(r.get("RZRQYE")))

            def _rz(r):
                v = _safe_float(r.get("TOTAL_RZYE"))
                return (v if v is not None else _safe_float(r.get("RZYE")))

            def _rq(r):
                v = _safe_float(r.get("TOTAL_RQYE"))
                return (v if v is not None else _safe_float(r.get("RQYE")))

            tot_latest = _tot(latest)
            rz_latest = _rz(latest)
            rq_latest = _rq(latest)
            tot_prev = _tot(prev) if prev else None

            trade_date = str(latest.get("DIM_DATE", ""))[:10]
            margin_yi = round(tot_latest / 1e8, 2) if tot_latest is not None else None
            rz_yi = round(rz_latest / 1e8, 2) if rz_latest is not None else None
            rq_yi = round(rq_latest / 1e8, 2) if rq_latest is not None else None
            chg_yi = (
                round((tot_latest - tot_prev) / 1e8, 2)
                if tot_latest is not None and tot_prev is not None
                else None
            )

            # 5 日两融变动百分比（取第 0 条 vs 第 5 条，对应 5 个交易日跨度）
            margin_pct_5d = None
            base_date_5d = None
            if len(full_rows) >= 6:
                base_row = full_rows[5]
                tot_base = _tot(base_row)
                if tot_latest and tot_base and tot_base > 0:
                    margin_pct_5d = (tot_latest - tot_base) / tot_base * 100.0
                    base_date_5d = str(base_row.get("DIM_DATE", ""))[:10]

            # 沪市先行数据（若最新一天深市尚未落地）
            sh_note = f"截至 {trade_date}（交易所法定 T+1 披露）"
            if rows[0].get("H_RZRQYE") is not None and str(rows[0].get("DIM_DATE", ""))[:10] > trade_date:
                sh_dt = str(rows[0].get("DIM_DATE", ""))[:10]
                sh_cur = _safe_float(rows[0].get("H_RZRQYE"))
                sh_prv = _safe_float(latest.get("H_RZRQYE"))
                if sh_cur is not None and sh_prv is not None:
                    sh_diff = round((sh_cur - sh_prv) / 1e8, 2)
                    sh_note += f"；{sh_dt} 沪市先行变动 {sh_diff:+.2f} 亿元"

            return {
                "trade_date": trade_date,
                "base_date_5d": base_date_5d,
                "total_margin_yi": margin_yi,
                "total_financing_yi": rz_yi,
                "total_securities_lending_yi": rq_yi,
                "margin_change_yi": chg_yi,
                "margin_pct_5d": margin_pct_5d,
                "date_note": sh_note,
            }
    except Exception as e:
        sys.stderr.write(f"[WARN] 拉取全市场两融数据失败: {e}\n")
    return {}


def _fetch_index_pct_5d(end_date: str | None, base_date: str | None) -> float | None:
    """拉取上证指数对应 5 个交易日区间涨跌幅（腾讯日K主源，零限流），与两融日期严格对齐。"""
    if not end_date or not base_date:
        return None
    # 1. 腾讯日K主源（高可用）
    try:
        u_tx = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000001,day,,,20,qfq"
        req = urllib.request.Request(u_tx, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            d = json.loads(resp.read().decode("utf-8")).get("data", {}).get("sh000001", {})
            rows = d.get("day") or d.get("qfqday") or []
            close_by_date = {r[0]: float(r[2]) for r in rows if len(r) >= 3}
            c_end = close_by_date.get(end_date)
            c_base = close_by_date.get(base_date)
            if c_end and c_base and c_base > 0:
                return (c_end - c_base) / c_base * 100.0
    except Exception:
        pass

    # 2. 东财 push2his 备源
    url = (
        "http://push2his.eastmoney.com/api/qt/stock/kline/get"
        "?secid=1.000001&fields1=f1,f2,f3,f4,f5,f6"
        "&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=15"
    )
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            kl = (json.loads(resp.read().decode("utf-8")).get("data") or {}).get("klines") or []
            close_by_date = {r.split(",")[0]: float(r.split(",")[2]) for r in kl}
            c_end = close_by_date.get(end_date)
            c_base = close_by_date.get(base_date)
            if c_end and c_base and c_base > 0:
                return (c_end - c_base) / c_base * 100.0
    except Exception as e:
        sys.stderr.write(f"[WARN] 拉取指数5日涨跌幅失败: {e}\n")
    return None


def _fetch_live_watchlist_margin(codes: list[str]) -> dict[str, dict[str, Any]]:
    """通过东财数据中心批量拉取自选股最新融资余额与单日净买入额（单位：亿元）。"""
    if not codes:
        return {}
    quoted = ",".join(f'"{c}"' for c in codes)
    filt = urllib.parse.quote(f"(SCODE in ({quoted}))")
    url = (
        "https://datacenter-web.eastmoney.com/api/data/v1/get"
        f"?reportName=RPTA_WEB_RZRQ_GGMX&columns=SCODE,SECNAME,DATE,RZYE,RZJME"
        f"&filter={filt}&pageSize={max(15, len(codes) * 3)}&sortColumns=DATE&sortTypes=-1"
    )
    out: dict[str, dict[str, Any]] = {}
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://data.eastmoney.com/"}
        )
        with urllib.request.urlopen(req, timeout=6) as resp:
            rows = ((json.loads(resp.read().decode("utf-8")).get("result") or {}).get("data")) or []
            for r in rows:
                code = str(r.get("SCODE", "")).zfill(6)
                if code in out:
                    continue  # 已按 DATE 降序，取最新一条
                rzye = _safe_float(r.get("RZYE"))
                rzjme = _safe_float(r.get("RZJME"))
                chg_yi = round(rzjme / 1e8, 2) if rzjme is not None else None
                status = "净买入加仓" if (chg_yi is not None and chg_yi > 0) else (
                    "净偿还出清" if (chg_yi is not None and chg_yi < 0) else "持平"
                )
                out[code] = {
                    "trade_date": str(r.get("DATE", ""))[:10],
                    "rzye_yi": round(rzye / 1e8, 2) if rzye is not None else None,
                    "change_yi": chg_yi,
                    "status": status,
                }
    except Exception as e:
        sys.stderr.write(f"[WARN] 拉取自选股两融明细失败: {e}\n")
    return out


def fetch_leverage_margin_dashboard(
    margin_data: dict | None = None,
    index_data: dict | None = None,
) -> dict[str, Any]:
    """看板 6 主入口：全市场两融余额、滚动 5 日 Em 弹性与自选股融资明细。"""
    watchlist = _load_watchlist()
    valid_stocks = [s for s in watchlist if _filter_etf(s.get("code", ""))]

    # 1. 支持单元测试显式注入
    if isinstance(margin_data, dict) and margin_data:
        margin_summary = {
            "trade_date": margin_data.get("trade_date", "injected"),
            "total_margin_yi": margin_data.get("total_margin_yi", margin_data.get("total_margin_balance")),
            "total_financing_yi": margin_data.get("total_financing_yi"),
            "total_securities_lending_yi": margin_data.get("total_securities_lending_yi"),
            "margin_change_yi": margin_data.get("margin_change_yi", margin_data.get("daily_change")),
            "date_note": margin_data.get("date_note", "注入数据"),
        }
        m_pct_5d = margin_data.get("margin_pct_5d")
        i_pct_5d = (index_data or {}).get("index_pct_5d")
        em_result = calculate_em_elasticity(m_pct_5d, i_pct_5d)
        stock_margins = margin_data.get("stock_margins", {})
        wl_rows = []
        for s in valid_stocks:
            code = s.get("code", "")
            info = stock_margins.get(code, {})
            wl_rows.append({
                "code": code,
                "name": s.get("name", ""),
                "rzye_yi": info.get("rzye_yi", info.get("margin_balance")),
                "change_yi": info.get("change_yi", info.get("daily_change")),
                "status": info.get("status", "正常"),
            })
        return {
            "margin_summary": margin_summary,
            "total_margin_balance": margin_summary["total_margin_yi"],
            "daily_change": margin_summary["margin_change_yi"],
            "em_elasticity": em_result,
            "watchlist_margin": wl_rows,
            "etf_excluded": list(_STATIC_ETF_EXCLUSION),
            "source": "injected",
        }

    # 2. 实盘网络抓取
    summary = _fetch_live_market_margin_series()
    m_pct_5d = summary.get("margin_pct_5d")
    i_pct_5d = _fetch_index_pct_5d(summary.get("trade_date"), summary.get("base_date_5d"))
    em_result = calculate_em_elasticity(m_pct_5d, i_pct_5d)

    codes = [str(s.get("code", "")).split(".")[0].zfill(6) for s in valid_stocks if s.get("code")]
    stock_live = _fetch_live_watchlist_margin(codes)

    wl_rows = []
    for s in valid_stocks:
        code = str(s.get("code", "")).split(".")[0].zfill(6)
        info = stock_live.get(code, {})
        wl_rows.append({
            "code": code,
            "name": s.get("name", ""),
            "trade_date": info.get("trade_date", "N/A"),
            "rzye_yi": info.get("rzye_yi"),
            "change_yi": info.get("change_yi"),
            "status": info.get("status", "待更新"),
        })

    return {
        "margin_summary": summary,
        "total_margin_balance": summary.get("total_margin_yi"),
        "daily_change": summary.get("margin_change_yi"),
        "em_elasticity": em_result,
        "watchlist_margin": wl_rows,
        "etf_excluded": list(_STATIC_ETF_EXCLUSION),
        "source": "live_eastmoney_datacenter" if summary else "degraded",
    }
