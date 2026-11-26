# -*- coding: utf-8 -*-
"""看板 7 —— 核心自选股主力大单净量 (DDX) 与多日资金沉淀雷达。

实盘数据直连：
  1. 腾讯财经 qt.gtimg.cn：秒级批量获取现价、涨跌幅、成交额与流通市值；
  2. 东财官方中台 emdatah5.eastmoney.com/dc/ZJLX/getZJLXData：获取当日确切主力净流入(f137 = 超大单f140 + 大单f143)；
  3. 东财 push2his fflow/daykline：获取近 3 日 / 5 日主力资金累计沉淀；
  4. 严格执行 DDX 防火墙，任何宽基 ETF 强制拦截；接口缺失严格返回 None，绝不用 0.00 伪装。
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path
from typing import Any

from utils.ddx_firewall import DDXFirewallViolationError, check_ddx_allowed

_BASE_DIR = Path(__file__).resolve().parent.parent
_WATCHLIST_PATH = _BASE_DIR / "data" / "default_watchlist.json"
_CUSTOM_PATH = _BASE_DIR / "references" / "custom_stocks.json"


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


def calculate_ddx(
    big_buy: float,
    big_sell: float,
    circulating_shares: float,
) -> float | None:
    if circulating_shares <= 0:
        return None
    return (big_buy - big_sell) / circulating_shares


def detect_divergence(
    price_chg_pct: float,
    ddx_today: float,
    ddx_prev: float,
    volume_chg_pct: float,
    main_net_flow: float,
    retail_net_flow: float,
    divergence_days: int = 0,
) -> list[str]:
    tags: list[str] = []
    if price_chg_pct > 0 and ddx_today < ddx_prev:
        tags.append("price_up_ddx_down")
    if price_chg_pct < 0 and ddx_today > ddx_prev:
        tags.append("price_down_ddx_up")
    if (price_chg_pct > 0 and volume_chg_pct < -10) or (
        price_chg_pct < 0 and volume_chg_pct > 10
    ):
        tags.append("volume_price_diverge")
    if (main_net_flow > 0 and retail_net_flow < 0) or (
        main_net_flow < 0 and retail_net_flow > 0
    ):
        tags.append("main_retail_diverge")
    if divergence_days >= 2:
        tags.append("consecutive_diverge")
    return tags


def calculate_sedimentation(ddx_history: list[float]) -> dict[str, float | None]:
    ddx_3d = sum(ddx_history[:3]) if len(ddx_history) >= 3 else None
    ddx_5d = sum(ddx_history[:5]) if len(ddx_history) >= 5 else None
    return {"ddx_3d": ddx_3d, "ddx_5d": ddx_5d}


def _diagnose_stock_flow(pct_chg: float | None, main_flow_yi: float | None, ddx_pct: float | None) -> str:
    if pct_chg is None or main_flow_yi is None:
        return "数据待更新"
    if pct_chg >= 1.0 and main_flow_yi >= 0.5:
        return "量价齐升/主力共振"
    if pct_chg >= 1.0 and main_flow_yi <= -0.5:
        return "价涨资出/警惕诱多"
    if pct_chg <= -1.0 and main_flow_yi >= 0.5:
        return "逆势吸筹/底背离"
    if pct_chg <= -1.0 and main_flow_yi <= -0.5:
        return "破位派发/主力出逃"
    if ddx_pct is not None and ddx_pct >= 0.3:
        return "主力温和吸筹"
    if ddx_pct is not None and ddx_pct <= -0.3:
        return "主力温和派发"
    return "常态换手"


def _fetch_stock_quotes(codes: list[str]) -> dict[str, dict[str, Any]]:
    qt_syms = [f"{'sh' if c.startswith(('6', '9')) else 'sz'}{c}" for c in codes]
    if not qt_syms:
        return {}
    url = f"https://qt.gtimg.cn/q={','.join(qt_syms)}"
    quotes: dict[str, dict[str, Any]] = {}
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            text = resp.read().decode("gbk", errors="ignore")
            for line in text.strip().split(";"):
                if not line.strip() or "~" not in line:
                    continue
                p = line.split("~")
                if len(p) > 45:
                    quotes[p[2]] = {
                        "name": p[1],
                        "price": float(p[3]) if p[3] else None,
                        "pct_chg": float(p[32]) if p[32] else None,
                        "turnover_yi": round(float(p[37]) / 1e4, 2) if p[37] else None,
                        "circ_cap_yi": float(p[44]) if p[44] else None,
                    }
    except Exception as e:
        sys.stderr.write(f"[WARN] 拉取自选股行情失败: {e}\n")
    return quotes


def _fetch_realtime_main_flow(code: str) -> dict[str, float | None]:
    """东财官方中台接口：f137 = 主力净流入(=超大单f140 + 大单f143)，避免重复累加。"""
    market = "1" if code.startswith(("6", "9")) else "0"
    secid = f"{market}.{code}"
    url = f"https://emdatah5.eastmoney.com/dc/ZJLX/getZJLXData?secid={secid}&fields=f57,f58,f137,f140,f143,f146"
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://emdatah5.eastmoney.com/"}
        )
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8")).get("data") or {}
            if data and data.get("f137") is not None:
                return {
                    "main_net_inflow": round(float(data["f137"]) / 1e8, 2),
                    "super_flow_yi": round(float(data.get("f140", 0)) / 1e8, 2),
                    "large_flow_yi": round(float(data.get("f143", 0)) / 1e8, 2),
                    "small_flow_yi": round(float(data.get("f146", 0)) / 1e8, 2),
                }
    except Exception:
        pass
    return {"main_net_inflow": None, "super_flow_yi": None, "large_flow_yi": None, "small_flow_yi": None}


def _fetch_multiday_main_flow(code: str) -> tuple[float | None, float | None]:
    """拉取近 3 日 / 5 日主力净流入累计（亿元）。"""
    market = "1" if code.startswith(("6", "9")) else "0"
    secid = f"{market}.{code}"
    url = (
        f"http://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get"
        f"?lmt=5&klt=101&secid={secid}&fields1=f1,f2,f3,f7"
        "&fields2=f51,f52,f53,f54,f55,f56"
    )
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            kl = (json.loads(resp.read().decode("utf-8")).get("data") or {}).get("klines") or []
            vals = [float(row.split(",")[1]) / 1e8 for row in kl if len(row.split(",")) >= 2]
            if vals:
                f3 = round(sum(vals[-3:]), 2) if len(vals) >= 3 else round(sum(vals), 2)
                f5 = round(sum(vals[-5:]), 2) if len(vals) >= 5 else round(sum(vals), 2)
                return f3, f5
    except Exception:
        pass
    return None, None


def fetch_fund_flow_dashboard(
    flow_data: dict | None = None,
    include_multiday: bool = True,
) -> dict[str, Any]:
    """看板 7 主入口：自选股实时主力大单净量 (DDX) 与多日资金沉淀。"""
    watchlist = _load_watchlist()
    results: list[dict] = []
    blocked: list[dict] = []

    allowed_stocks: list[dict] = []
    for stock in watchlist:
        code = str(stock.get("code", "")).split(".")[0].zfill(6)
        name = stock.get("name", code)
        try:
            check_ddx_allowed(code)
            allowed_stocks.append({"code": code, "name": name})
        except DDXFirewallViolationError as e:
            blocked.append({"code": code, "name": name, "reason": str(e)})

    # 显式注入模式（单测用）
    if isinstance(flow_data, dict) and flow_data:
        for s in allowed_stocks:
            code, name = s["code"], s["name"]
            sf = flow_data.get(code, {})
            results.append({
                "code": code,
                "name": name,
                "price": sf.get("price"),
                "pct_chg": sf.get("pct_chg"),
                "main_net_inflow": sf.get("main_net_inflow"),
                "ddx": sf.get("ddx"),
                "divergence_tags": sf.get("divergence_tags", []),
                "diagnosis": "、".join(sf.get("divergence_tags", [])) or "常态换手",
                "ddx_3d": sf.get("ddx_3d"),
                "ddx_5d": sf.get("ddx_5d"),
            })
        return {
            "stocks": results,
            "results": results,
            "blocked_etf": blocked,
            "watchlist_count": len(watchlist),
            "source": "injected",
        }

    # 实盘网络抓取
    codes = [s["code"] for s in allowed_stocks]
    quotes = _fetch_stock_quotes(codes)
    live_ok = 0

    for s in allowed_stocks:
        code = s["code"]
        q = quotes.get(code, {})
        name = q.get("name") or s["name"]
        price = q.get("price")
        pct_chg = q.get("pct_chg")
        circ_cap = q.get("circ_cap_yi")

        rt = _fetch_realtime_main_flow(code)
        main_inflow = rt.get("main_net_inflow")
        if main_inflow is not None:
            live_ok += 1

        ddx_pct = (
            round((main_inflow / circ_cap) * 100.0, 3)
            if main_inflow is not None and circ_cap and circ_cap > 0
            else None
        )
        flow_3d, flow_5d = _fetch_multiday_main_flow(code) if include_multiday else (None, None)
        diag = _diagnose_stock_flow(pct_chg, main_inflow, ddx_pct)

        results.append({
            "code": code,
            "name": name,
            "price": price,
            "pct_chg": pct_chg,
            "main_net_inflow": main_inflow,
            "ddx": ddx_pct,
            "diagnosis": diag,
            "divergence_tags": [diag] if diag not in ("常态换手", "数据待更新") else [],
            "ddx_3d": flow_3d,
            "ddx_5d": flow_5d,
        })

    return {
        "stocks": results,
        "results": results,
        "blocked_etf": blocked,
        "watchlist_count": len(watchlist),
        "source": "live_emdatah5" if live_ok > 0 else "degraded",
    }


def generate_fund_flow_markdown(flow_data: dict | None) -> str:
    """格式化输出自选股主力大单 DDX 与多日资金沉淀表格（缺失值显式标 N/A，绝不填 0.00）。"""
    if not flow_data:
        return "> ⚠️ 主力资金流向数据暂未获取。\n"

    stocks = flow_data.get("stocks", flow_data.get("results", []))
    if not stocks:
        return "> ℹ️ 当前自选股监控列表为空。\n"

    lines = [
        "| 代码 | 标的名称 | 现价 / 涨跌幅 | 主力净流入 (亿元) | DDX 净控盘 (%) | 量价诊断 | 近3日 / 近5日主力沉淀 |",
        "| :---: | :--- | :---: | :---: | :---: | :--- | :---: |",
    ]
    for s in stocks:
        code = s.get("code", "")
        name = s.get("name", "")
        price = s.get("price")
        pct = s.get("pct_chg")
        px_str = f"`{price:.2f}` (`{pct:+.2f}%`)" if (price is not None and pct is not None) else "`N/A`"
        inflow = s.get("main_net_inflow")
        inflow_str = f"`{inflow:+.2f}`" if inflow is not None else "`N/A`"
        ddx = s.get("ddx")
        ddx_str = f"**`{ddx:+.3f}%`**" if ddx is not None else "`N/A`"
        diag = s.get("diagnosis") or ("、".join(s.get("divergence_tags", [])) or "常态换手")
        f3, f5 = s.get("ddx_3d"), s.get("ddx_5d")
        m_str = (
            f"`{f3:+.2f}` / `{f5:+.2f}` 亿"
            if (f3 is not None and f5 is not None)
            else (f"`{f3:+.2f}` 亿" if f3 is not None else "`N/A`")
        )
        lines.append(f"| `{code}` | {name} | {px_str} | {inflow_str} | {ddx_str} | {diag} | {m_str} |")

    blocked = flow_data.get("blocked_etf", [])
    if blocked:
        lines.append("\n> 🛡️ **DDX 防火墙拦截记录**：")
        for b in blocked:
            lines.append(f"> - 标的 `{b.get('code')}` ({b.get('name')}) 已被防火墙拦截，理由：{b.get('reason')}")

    return "\n".join(lines)
