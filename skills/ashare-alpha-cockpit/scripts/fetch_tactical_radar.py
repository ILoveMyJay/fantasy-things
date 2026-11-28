#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_tactical_radar.py - L2/L3 战术拐点、3/4蓝灯中轨监测、双源7x24新闻雷达与49行业轮动。

实证升级（融合 ashare-quant-review v2.2 经验证精华，剔除已证伪项）：
  1. 大阳线中轨监测 + 精确 3/4 蓝灯（严禁收紧为 4/4 AND）；
  2. 左尾绿灯已剔除证伪的 Em 弹性，替换为全A真中位数 <= -4% / 5日累计 <= -8% / IC贴水 <= -25%；
  3. 红灯升级：双创 TCR > 40% 且放量滞涨 / 有效跌破大阳线中轨 / 冲顶暴走 BLOWOFF_EUPHORIA；
  4. 新浪+东财双源 7x24 免密实时快讯催化雷达 + 新浪 49 一级行业资金轮动。
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

ANCHOR_THRESHOLDS: Dict[str, Tuple[str, float]] = {
    "sh000688": ("科创50", 5.0),
    "sz399006": ("创业板指", 4.0),
    "sh000001": ("上证指数", 2.0),
}

TOPIC_KEYWORDS: Dict[str, Tuple[str, ...]] = {
    "国产算力/半导体": (
        "芯片", "半导体", "光刻", "HBM", "华为", "昇腾", "鸿蒙", "平头哥",
        "中芯", "算力", "先进封装", "国产替代", "自主可控", "国产算力", "存储芯片", "GPU", "EDA",
    ),
    "宏观政策/流动性": (
        "央行", "降准", "降息", "逆回购", "MLF", "财政", "国常会", "发改委",
        "工信部", "证监会", "商务部", "十五五", "平准", "汇金", "美联储", "FOMC", "政治局", "特别国债",
    ),
    "AI与科技产业": (
        "人工智能", "大模型", "AI", "算力中心", "液冷", "光模块", "CPO",
        "机器人", "人形机器人", "自动驾驶", "低空经济", "商业航天", "数据要素", "6G", "云计算",
    ),
    "周期与涨价": ("有色", "煤炭", "黄金", "白银", "铜", "稀土", "锂", "原油", "涨价", "提价", "化工"),
}
POSITIVE_WORDS = (
    "印发", "规划", "鼓励", "优先使用", "支持", "突破", "量产", "中标", "大单",
    "增持", "回购", "预增", "扭亏", "超预期", "利好", "降准", "降息", "扩产", "涨价", "稳市", "平准基金",
)
NEGATIVE_WORDS = (
    "制裁", "实体清单", "加征关税", "关税", "违约", "暴跌", "爆雷", "立案",
    "处罚", "退市", "大幅减持", "清仓减持", "停产", "限制出口", "出口管制", "下修", "预亏", "亏损扩大",
)
NOISE_PATTERNS = (
    "午间涨停分析", "涨停复盘", "主力资金净流入", "成交额突破", "早盘收评",
    "午评", "收评：", "盘中拉升", "直线拉升", "触及涨停", "封板", "分钟内涨幅", "股涨停",
)


def _fetch_recent_klines_tencent(symbol: str, days: int = 12) -> List[Dict[str, Any]]:
    url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={symbol},day,,,{days},qfq"
    rows: List[Dict[str, Any]] = []
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            d = json.loads(resp.read().decode("utf-8")).get("data", {}).get(symbol, {})
            for r in (d.get("day") or d.get("qfqday") or []):
                if len(r) >= 6:
                    rows.append({
                        "date": str(r[0]), "open": float(r[1]), "close": float(r[2]),
                        "high": float(r[3]), "low": float(r[4]), "volume": float(r[5]),
                    })
    except Exception as e:
        sys.stderr.write(f"[fetch_tactical_radar] kline {symbol} failed: {e}\n")
    return rows


def detect_anchor_bullish_candle(
    klines_map: Optional[Dict[str, List[Dict[str, Any]]]] = None,
    live_prices: Optional[Dict[str, float]] = None,
    lookback_days: int = 6,
) -> Dict[str, Any]:
    """扫描近 lookback_days 日大阳线并计算中轨 (prev_close + anchor_close) / 2。"""
    if klines_map is None:
        klines_map = {sym: _fetch_recent_klines_tencent(sym, days=12) for sym in ANCHOR_THRESHOLDS}

    anchor_date: Optional[str] = None
    trigger_reason = ""
    for sym, (name, pct_th) in ANCHOR_THRESHOLDS.items():
        rows = klines_map.get(sym) or []
        if len(rows) < 2:
            continue
        start_idx = max(1, len(rows) - lookback_days)
        for i in range(len(rows) - 1, start_idx - 1, -1):
            prev_c, curr_c = rows[i - 1]["close"], rows[i]["close"]
            if prev_c <= 0:
                continue
            pct = (curr_c - prev_c) / prev_c * 100.0
            if pct >= pct_th:
                if anchor_date is None or rows[i]["date"] > anchor_date:
                    anchor_date = rows[i]["date"]
                    trigger_reason = f"{name}单日大涨 {pct:+.2f}%"
                break

    if not anchor_date:
        return {
            "has_anchor": False, "anchor_date": None, "days_since_anchor": None,
            "status": "no_recent_anchor", "status_note": f"近 {lookback_days} 日无突破型大阳线", "levels": {},
        }

    levels: Dict[str, Dict[str, Any]] = {}
    days_since = 0
    broken_count = 0
    for sym, (name, _) in ANCHOR_THRESHOLDS.items():
        rows = klines_map.get(sym) or []
        idx = next((i for i, r in enumerate(rows) if r["date"] == anchor_date), None)
        if idx is None or idx == 0:
            continue
        prev_c, anc_c = rows[idx - 1]["close"], rows[idx]["close"]
        mid = round((prev_c + anc_c) / 2.0, 2)
        code6 = sym[2:]
        cur_px = (live_prices or {}).get(code6) or rows[-1]["close"]
        days_since = max(days_since, (len(rows) - 1) - idx)
        dist = round((cur_px - mid) / mid * 100.0, 2) if mid > 0 else 0.0
        st = "anchor_day" if days_since == 0 else ("above_midpoint" if cur_px >= mid else "below_midpoint")
        if st == "below_midpoint":
            broken_count += 1
        levels[code6] = {
            "symbol": sym, "name": name, "prev_close": round(prev_c, 2),
            "anchor_close": round(anc_c, 2), "midpoint": mid,
            "current_price": round(cur_px, 2), "dist_to_mid_pct": dist, "state": st,
        }

    if days_since == 0:
        status = "anchor_day"
        note = f"今日({anchor_date})为大阳线爆发日（{trigger_reason}），已锁定中轨基准"
    elif broken_count >= 2 or (levels.get("000688", {}).get("state") == "below_midpoint"):
        status = "broken_below_midpoint"
        note = f"距大阳线({anchor_date})已 T+{days_since}，核心指数有效跌破中轨（止损红灯）"
    else:
        status = "holding_above_midpoint"
        note = f"距大阳线({anchor_date})已 T+{days_since}，稳守大阳线中轨上方（承接有效）"

    return {
        "has_anchor": True, "anchor_date": anchor_date, "trigger_reason": trigger_reason,
        "days_since_anchor": days_since, "status": status, "status_note": note, "levels": levels,
    }


def evaluate_traffic_lights(
    breadth: Dict[str, Any],
    confirm: Dict[str, Any],
    tech: Dict[str, Any],
    anchor: Dict[str, Any],
    news: Dict[str, Any],
) -> Dict[str, Any]:
    """实证升级版三级红绿灯（已剔除证伪 Em，保留精确 3/4 蓝灯与 TCR>40%放量滞涨红灯）。"""
    tcr = breadth.get("tcr_double_tech")
    vol_r = breadth.get("vol_ratio_prev")
    brk_rate = breadth.get("broken_board_rate")
    med1 = breadth.get("median_pct")
    med5 = breadth.get("median_cum_5d")
    ic_ann = (confirm.get("cffex_basis") or {}).get("ic_ann_roll")
    erp_z = (confirm.get("erp") or {}).get("zscore")
    k50_ret = tech.get("k50_ret_1d_pct")
    cyb_ret = tech.get("cyb_ret_1d_pct")

    # 1. 🟢 绿灯（左尾恐慌 + 深值 + 催化）
    g_checks = [
        {"name": "全A极端左尾(中位数<=-4%或5日<=-8%)", "hit": bool((med1 is not None and med1 <= -4.0) or (med5 is not None and med5 <= -8.0)), "detail": f"当日{med1}% / 5日累计{med5}%"},
        {"name": "ERP 深值底锚(Z>=+1.5σ)", "hit": bool(erp_z is not None and erp_z >= 1.5), "detail": f"ERP Z={erp_z}"},
        {"name": "IC 深度贴水恐慌(<=-25%)", "hit": bool(ic_ann is not None and ic_ann <= -25.0), "detail": f"IC年化={ic_ann}%"},
        {"name": "科技/政策重磅快讯催化", "hit": bool(news.get("tech_catalyst_active")), "detail": f"科技{news.get('tech_catalyst_count', 0)}条/政策{news.get('policy_catalyst_count', 0)}条"},
    ]
    g_hits = sum(1 for x in g_checks if x["hit"])
    green_active = g_hits >= 2 and (tcr is None or tcr <= 40.0)

    # 2. 🔵 蓝灯（精确 3/4 规则：大阳线后 T+1~T+5 + 稳守中轨 + [TCR健康区 OR 炸板率<35%]）
    has_post = bool(anchor.get("has_anchor")) and (anchor.get("days_since_anchor") or 0) >= 1
    hold_mid = anchor.get("status") == "holding_above_midpoint"
    tcr_cool = tcr is not None and 25.0 <= tcr <= 37.5
    healthy_pb = (brk_rate is not None and brk_rate < 35.0) and (vol_r is not None)
    b_checks = [
        {"name": "大阳线后 T+1~T+5 验证期", "hit": has_post, "detail": anchor.get("status_note", "")},
        {"name": "回踩稳守大阳线中轨上方", "hit": hold_mid, "detail": str((anchor.get("levels") or {}).get("000688", {}).get("dist_to_mid_pct", "N/A")) + "%"},
        {"name": "双创 TCR 降温至健康区(25%~37.5%)", "hit": tcr_cool, "detail": f"TCR={tcr}%"},
        {"name": "盘口承接健康(炸板率<35%)", "hit": healthy_pb, "detail": f"炸板率={brk_rate}% / 量比={vol_r}"},
    ]
    b_hits = sum(1 for x in b_checks if x["hit"])
    blue_active = has_post and hold_mid and (b_hits >= 3)

    # 3. 🔴 红灯（双创 TCR>40%且放量滞涨 / 跌破中轨 / 冲顶暴走）
    tcr_froth_stag = bool(
        tcr is not None and tcr > 40.0
        and vol_r is not None and vol_r > 1.0
        and k50_ret is not None and k50_ret < 0.5
        and cyb_ret is not None and cyb_ret < 0.5
    )
    mid_broken = anchor.get("status") == "broken_below_midpoint"
    blowoff = breadth.get("scenario_code") == "BLOWOFF_EUPHORIA"
    r_checks = [
        {"name": "双创 TCR>40% 且放量滞涨", "hit": tcr_froth_stag, "detail": f"TCR={tcr}% / 量比={vol_r} / 科创50={k50_ret}%"},
        {"name": "有效跌破大阳线中轨(突破失败)", "hit": mid_broken, "detail": anchor.get("status_note", "")},
        {"name": "极端普涨冲顶过热(BLOWOFF_EUPHORIA)", "hit": blowoff, "detail": breadth.get("scenario_tag", "")},
    ]
    r_hits = sum(1 for x in r_checks if x["hit"])
    red_active = r_hits >= 1

    if red_active:
        primary = "🔴 红灯风控"
    elif blue_active:
        primary = "🔵 蓝灯确认(右侧回踩买点)"
    elif green_active:
        primary = "🟢 绿灯左尾(恐慌试仓)"
    else:
        primary = "⚪ 灰灯常规"

    return {
        "primary_light": primary,
        "tcr_froth_stagnation": tcr_froth_stag,
        "blue_light_3of4": blue_active,
        "broken_midpoint": mid_broken,
        "green": {"active": green_active, "hits": g_hits, "total": len(g_checks), "checks": g_checks},
        "blue": {"active": blue_active, "hits": b_hits, "total": len(b_checks), "checks": b_checks},
        "red": {"active": red_active, "hits": r_hits, "total": len(r_checks), "checks": r_checks},
        "anchor_candle": anchor,
    }


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").replace("\u3000", " ").strip()


def _extract_title_body(text: str) -> Tuple[str, str]:
    clean = _strip_html(text)
    m = re.match(r"【([^】]{2,80})】(.*)", clean, flags=re.S)
    return (m.group(1).strip(), m.group(2).strip()) if m else (clean[:55], clean)


def fetch_news_catalyst_radar(injected_items: Optional[List[Dict[str, Any]]] = None, top_n: int = 8) -> Dict[str, Any]:
    """新浪 7x24 + 东财 7x24 双权威免密快讯雷达。"""
    if injected_items is not None:
        raw_items = list(injected_items)
        sources_ok = ["injected"]
    else:
        raw_items = []
        sources_ok = []
        # 新浪 7x24
        sina_cnt = 0
        for tag_id, psz in ((9, 25), (10, 30), (1, 20)):
            try:
                url = f"https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size={psz}&zhibo_id=152&tag_id={tag_id}&dire=f&dpc=1"
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://finance.sina.com.cn/"})
                with urllib.request.urlopen(req, timeout=5) as resp:
                    feed = ((json.loads(resp.read().decode("utf-8")).get("result") or {}).get("data") or {}).get("feed") or {}
                    for row in feed.get("list") or []:
                        title, body = _extract_title_body(row.get("rich_text") or "")
                        tags = [t.get("name", "") for t in (row.get("tag") or []) if isinstance(t, dict)]
                        raw_items.append({
                            "time": str(row.get("create_time", ""))[:19], "source": "新浪7x24",
                            "title": title, "summary": body[:160], "url": row.get("docurl") or "",
                            "is_important": bool(row.get("is_focus")) or ("焦点" in tags),
                        })
                        sina_cnt += 1
            except Exception:
                pass
        if sina_cnt:
            sources_ok.append("新浪财经7x24")

        # 东财 7x24
        em_cnt = 0
        try:
            url = "https://np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=40&req_trace=1"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://kuaixun.eastmoney.com/"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                for row in (json.loads(resp.read().decode("utf-8")).get("data") or {}).get("fastNewsList") or []:
                    title = _strip_html(row.get("title") or "")
                    summary = _strip_html(row.get("summary") or "")
                    if not title:
                        title, summary = _extract_title_body(summary)
                    code = str(row.get("code") or "")
                    raw_items.append({
                        "time": str(row.get("showTime", ""))[:19], "source": "东财7x24",
                        "title": title, "summary": summary[:160],
                        "url": f"https://finance.eastmoney.com/a/{code}.html" if code else "",
                        "is_important": str(row.get("titleColor", "0")) not in ("0", "", "None"),
                    })
                    em_cnt += 1
        except Exception:
            pass
        if em_cnt:
            sources_ok.append("东方财富7x24")

    seen = set()
    scored = []
    for it in raw_items:
        key = re.sub(r"\W+", "", it.get("title", ""))[:22]
        if not key or key in seen:
            continue
        seen.add(key)
        full_text = f"{it.get('title', '')} {it.get('summary', '')}"
        if any(np in full_text for np in NOISE_PATTERNS):
            continue
        matched = [t for t, kws in TOPIC_KEYWORDS.items() if any(kw.lower() in full_text.lower() for kw in kws)]
        if not matched and not it.get("is_important"):
            continue
        pos = sum(1 for w in POSITIVE_WORDS if w in full_text)
        neg = sum(1 for w in NEGATIVE_WORDS if w in full_text)
        is_exp = ("出口管制" in full_text or "限制出口" in full_text) and ("国产算力/半导体" in matched)
        pol = "外部约束/国产催化" if is_exp else ("利好催化" if pos > neg else ("风险利空" if neg > pos else "中性要闻"))
        score = len(matched) * 18 + (25 if it.get("is_important") else 0) + (pos + neg) * 8
        scored.append({**it, "topics": matched or ["市场焦点"], "polarity": pol, "score": score})

    scored.sort(key=lambda x: (x["score"], x.get("time", "")), reverse=True)
    tech_pos = [x for x in scored if ("国产算力/半导体" in x["topics"] or "AI与科技产业" in x["topics"]) and x["polarity"] in ("利好催化", "外部约束/国产催化")]
    pol_pos = [x for x in scored if "宏观政策/流动性" in x["topics"] and x["polarity"] == "利好催化"]
    return {
        "status": "OK" if raw_items else "DEGRADED",
        "fetch_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "sources": sources_ok,
        "raw_scanned_count": len(raw_items),
        "relevant_count": len(scored),
        "tech_catalyst_count": len(tech_pos),
        "policy_catalyst_count": len(pol_pos),
        "tech_catalyst_active": len(tech_pos) >= 1 or len(pol_pos) >= 2,
        "top_catalysts": scored[:top_n],
    }


def fetch_sector_rotation(top_n: int = 5) -> Dict[str, Any]:
    """新浪 49 一级行业涨跌幅 + 主力资金净流入/净流出榜（附领涨股代码供 Phase 2 联动）。"""
    quotes: List[Dict[str, Any]] = []
    flows: List[Dict[str, Any]] = []
    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://vip.stock.finance.sina.com.cn/"}
    try:
        req = urllib.request.Request("http://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php", headers=headers)
        with urllib.request.urlopen(req, timeout=6) as resp:
            text = resp.read().decode("gbk", errors="ignore")
            s, e = text.find("{"), text.rfind("}")
            if s >= 0 and e > s:
                for _, v in json.loads(text[s : e + 1]).items():
                    p = str(v).split(",")
                    if len(p) >= 13:
                        try:
                            quotes.append({
                                "code": p[0], "name": p[1], "stock_count": int(p[2]),
                                "pct_chg": round(float(p[5]), 2), "turnover_yi": round(float(p[7]) / 1e8, 2),
                                "leader_code": re.sub(r"[^0-9]", "", p[8])[-6:],
                                "leader_name": p[12], "leader_pct": round(float(p[9]), 2),
                            })
                        except (ValueError, TypeError):
                            pass
    except Exception as e:
        sys.stderr.write(f"[fetch_tactical_radar] industry quotes failed: {e}\n")

    try:
        url = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/MoneyFlow.ssl_bkzj_bk?page=1&num=60&sort=netamount&asc=0&fenlei=0"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, list):
                for item in data:
                    try:
                        flows.append({
                            "name": item.get("name", ""),
                            "pct_chg": round(float(item.get("avg_changeratio", 0)) * 100.0, 2),
                            "net_inflow_yi": round(float(item.get("netamount", 0)) / 1e8, 2),
                        })
                    except (ValueError, TypeError):
                        pass
    except Exception as e:
        sys.stderr.write(f"[fetch_tactical_radar] industry flow failed: {e}\n")

    flow_map = {f["name"]: f["net_inflow_yi"] for f in flows if f.get("name")}
    for q in quotes:
        q["net_inflow_yi"] = flow_map.get(q["name"])

    q_sorted = sorted(quotes, key=lambda x: x["pct_chg"], reverse=True)
    f_sorted = sorted(flows, key=lambda x: x["net_inflow_yi"], reverse=True)
    return {
        "status": "OK" if (quotes or flows) else "DEGRADED",
        "sector_count": len(quotes),
        "top_gainers": q_sorted[:top_n],
        "top_losers": list(reversed(q_sorted[-top_n:])) if len(q_sorted) >= top_n else [],
        "top_inflow": [f for f in f_sorted[:top_n] if f["net_inflow_yi"] > 0],
        "top_outflow": [f for f in reversed(f_sorted[-top_n:]) if f["net_inflow_yi"] < 0],
    }
