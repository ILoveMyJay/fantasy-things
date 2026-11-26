#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""行业主线强弱与主力资金轮动看板。

数据直连新浪财经行业行情与板块资金流向接口（高可用、零限流、亚秒级响应）：
  1. newSinaHy.php：49 个一级行业当日涨跌幅、成交额、上涨/领涨龙头；
  2. MoneyFlow.ssl_bkzj_bk：行业板块实时主力净流入/净流出排名（亿元）。
接口不可用时返回空列表与 degraded 标记，严禁伪造数据。
"""

from __future__ import annotations

import json
import sys
import urllib.request
from typing import Any


def _fetch_sina_industry_quotes() -> list[dict[str, Any]]:
    """拉取新浪 49 个一级行业实时涨跌幅与领涨龙头。"""
    url = "http://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php"
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://vip.stock.finance.sina.com.cn/",
    }
    rows: list[dict[str, Any]] = []
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=6) as resp:
            text = resp.read().decode("gbk", errors="ignore")
            start = text.find("{")
            end = text.rfind("}")
            if start < 0 or end <= start:
                return []
            raw_map = json.loads(text[start:end + 1])
            for _, val_str in raw_map.items():
                parts = str(val_str).split(",")
                # 格式: code,name,stock_cnt,avg_price,chg_val,pct_chg,vol,amount,lead_code,lead_pct,lead_price,lead_chg,lead_name
                if len(parts) >= 13:
                    try:
                        rows.append({
                            "code": parts[0],
                            "name": parts[1],
                            "stock_count": int(parts[2]),
                            "pct_chg": round(float(parts[5]), 2),
                            "turnover_yi": round(float(parts[7]) / 1e8, 2),
                            "leader_name": parts[12],
                            "leader_pct": round(float(parts[9]), 2),
                        })
                    except (ValueError, TypeError):
                        continue
    except Exception as e:
        sys.stderr.write(f"[WARN] 拉取行业涨跌幅失败: {e}\n")
    return rows


def _fetch_sina_industry_money_flow() -> list[dict[str, Any]]:
    """拉取行业板块实时主力资金净流入排名（亿元）。"""
    url = (
        "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
        "MoneyFlow.ssl_bkzj_bk?page=1&num=60&sort=netamount&asc=0&fenlei=0"
    )
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://vip.stock.finance.sina.com.cn/",
    }
    rows: list[dict[str, Any]] = []
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, list):
                for item in data:
                    try:
                        rows.append({
                            "name": item.get("name", ""),
                            "pct_chg": round(float(item.get("avg_changeratio", 0)) * 100.0, 2),
                            "net_inflow_yi": round(float(item.get("netamount", 0)) / 1e8, 2),
                            "turnover_yi": round(float(item.get("turnover", 0)) / 1e8, 2),
                        })
                    except (ValueError, TypeError):
                        continue
    except Exception as e:
        sys.stderr.write(f"[WARN] 拉取行业资金流向失败: {e}\n")
    return rows


def fetch_sector_rotation_dashboard(top_n: int = 5) -> dict[str, Any]:
    """汇总行业领涨/领跌榜与主力净流入/净流出榜，并生成一句话主线结论。"""
    quotes = _fetch_sina_industry_quotes()
    flows = _fetch_sina_industry_money_flow()

    flow_by_name = {f["name"]: f["net_inflow_yi"] for f in flows if f.get("name")}
    for q in quotes:
        q["net_inflow_yi"] = flow_by_name.get(q["name"])

    quotes_sorted = sorted(quotes, key=lambda x: x["pct_chg"], reverse=True)
    top_gainers = quotes_sorted[:top_n]
    top_losers = list(reversed(quotes_sorted[-top_n:])) if len(quotes_sorted) >= top_n else []

    flows_sorted = sorted(flows, key=lambda x: x["net_inflow_yi"], reverse=True)
    top_inflow = [f for f in flows_sorted[:top_n] if f["net_inflow_yi"] > 0]
    top_outflow = [f for f in reversed(flows_sorted[-top_n:]) if f["net_inflow_yi"] < 0]

    # 生成主线总结
    summary_parts = []
    if top_gainers:
        g_str = "、".join(f"{x['name']}({x['pct_chg']:+.2f}%)" for x in top_gainers[:3])
        summary_parts.append(f"领涨主线：{g_str}")
    if top_inflow:
        i_str = "、".join(f"{x['name']}({x['net_inflow_yi']:+.1f}亿)" for x in top_inflow[:3])
        summary_parts.append(f"资金净流入居前：{i_str}")
    if top_losers:
        l_str = "、".join(f"{x['name']}({x['pct_chg']:+.2f}%)" for x in top_losers[:3])
        summary_parts.append(f"承压板块：{l_str}")

    return {
        "sector_count": len(quotes),
        "top_gainers": top_gainers,
        "top_losers": top_losers,
        "top_inflow": top_inflow,
        "top_outflow": top_outflow,
        "main_theme_summary": "；".join(summary_parts) if summary_parts else "行业板块接口暂未返回数据",
        "status": "ok" if (quotes or flows) else "degraded",
    }


if __name__ == "__main__":
    print(json.dumps(fetch_sector_rotation_dashboard(), ensure_ascii=False, indent=2))
