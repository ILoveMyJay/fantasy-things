#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""实时财经快讯与产业政策催化雷达 (fetch_news_catalyst.py)

双权威源免密实盘直连（0 第三方依赖、亚秒级响应）：
  1. 新浪财经 7x24 直播（焦点 tag=9 / A股 tag=10 / 宏观 tag=1）；
  2. 东方财富 7x24 财经快讯（fastColumn=102，含红字重磅标记）。

功能：
  - 实时拉取最新快讯（精确到秒级时间戳 + 原文可追溯链接）；
  - 去重并过滤盘面纯播报噪音；
  - 基于确定性规则对“国产算力/半导体、宏观政策、AI科技、周期涨价、风险利空”打标计分；
  - 输出结构化催化摘要供三级红绿灯拐点信号引擎直接消费。
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from datetime import datetime
from typing import Any

# ---------------------------------------------------------------------------
# 确定性催化主题与极性词典
# ---------------------------------------------------------------------------

TOPIC_KEYWORDS: dict[str, tuple[str, ...]] = {
    "国产算力/半导体": (
        "芯片", "半导体", "光刻", "HBM", "华为", "昇腾", "鸿蒙", "平头哥",
        "中芯", "算力", "先进封装", "混合键合", "国产替代", "自主可控",
        "国产算力", "存储芯片", "晶圆", "英伟达", "GPU", "TPU", "封测", "EDA",
    ),
    "宏观政策/流动性": (
        "央行", "降准", "降息", "逆回购", "MLF", "财政", "国常会", "发改委",
        "工信部", "证监会", "商务部", "十五五", "规划", "实施方案", "数据局",
        "平准", "汇金", "美联储", "FOMC", "政治局", "特别国债", "以旧换新",
    ),
    "AI与科技产业": (
        "人工智能", "大模型", "AI", "算力中心", "液冷", "光模块", "CPO",
        "机器人", "人形机器人", "智能驾驶", "自动驾驶", "低空经济", "商业航天",
        "数据要素", "通信网", "6G", "云计算", "开源",
    ),
    "周期与涨价": (
        "有色", "煤炭", "黄金", "白银", "铜", "稀土", "锂", "原油",
        "涨价", "提价", "供需偏紧", "停产", "化工",
    ),
}

POSITIVE_WORDS: tuple[str, ...] = (
    "印发", "规划", "鼓励", "优先使用", "支持", "突破", "录用", "首创", "量产",
    "中标", "大单", "增持", "回购", "分拆", "上市", "预增", "扭亏", "超预期",
    "加速", "利好", "降准", "降息", "出海", "扩产", "涨价", "签约", "合作",
    "加力", "稳市", "平准基金", "优化", "部署", "扩大", "提振", "放宽",
)

NEGATIVE_WORDS: tuple[str, ...] = (
    "制裁", "实体清单", "加征关税", "关税", "违约", "暴跌", "爆雷", "立案",
    "处罚", "退市", "大幅减持", "清仓减持", "停产", "限制出口", "出口管制",
    "下修", "预亏", "亏损扩大", "警告", "下调评级", "走跌风险",
)

# 过滤纯盘面涨跌机械播报（避免把结果当成催化原因）
NOISE_PATTERNS: tuple[str, ...] = (
    "午间涨停分析", "涨停复盘", "主力资金净流入", "成交额突破", "早盘收评",
    "午评", "收评：", "盘中拉升", "直线拉升", "触及涨停", "触及20cm涨停",
    "封板", "分钟内涨幅", "主力净买", "资金流向", "股涨停", "涨势扩大", "均涨超",
)


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").replace("\u3000", " ").strip()


def _extract_title_and_body(text: str) -> tuple[str, str]:
    clean = _strip_html(text)
    m = re.match(r"【([^】]{2,80})】(.*)", clean, flags=re.S)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return clean[:55], clean


def _fetch_sina_7x24(tag_id: int, page_size: int = 30) -> list[dict[str, Any]]:
    url = (
        f"https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size={page_size}"
        f"&zhibo_id=152&tag_id={tag_id}&dire=f&dpc=1"
    )
    items: list[dict[str, Any]] = []
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://finance.sina.com.cn/"}
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            feed = ((data.get("result") or {}).get("data") or {}).get("feed") or {}
            for row in feed.get("list") or []:
                rich = row.get("rich_text") or ""
                title, body = _extract_title_and_body(rich)
                tags = [t.get("name", "") for t in (row.get("tag") or []) if isinstance(t, dict)]
                is_important = bool(row.get("is_focus")) or ("焦点" in tags)
                items.append({
                    "time": str(row.get("create_time", ""))[:19],
                    "source": "新浪7x24",
                    "title": title,
                    "summary": body[:160],
                    "url": row.get("docurl") or "",
                    "is_important": is_important,
                    "raw_tags": tags,
                })
    except Exception as e:
        sys.stderr.write(f"[WARN] 新浪7x24(tag={tag_id})拉取失败: {e}\n")
    return items


def _fetch_eastmoney_fastnews(page_size: int = 40) -> list[dict[str, Any]]:
    url = (
        "https://np-listapi.eastmoney.com/comm/web/getFastNewsList"
        f"?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize={page_size}&req_trace=1"
    )
    items: list[dict[str, Any]] = []
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://kuaixun.eastmoney.com/"}
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8")).get("data") or {}
            for row in data.get("fastNewsList") or []:
                title = _strip_html(row.get("title") or "")
                summary = _strip_html(row.get("summary") or "")
                if not title:
                    title, summary = _extract_title_and_body(summary)
                code = str(row.get("code") or "")
                url_link = f"https://finance.eastmoney.com/a/{code}.html" if code else ""
                # titleColor == "3" 或非 "0" 通常是红字/加粗重磅
                is_important = str(row.get("titleColor", "0")) not in ("0", "", "None")
                items.append({
                    "time": str(row.get("showTime", ""))[:19],
                    "source": "东财7x24",
                    "title": title,
                    "summary": summary[:160],
                    "url": url_link,
                    "is_important": is_important,
                    "raw_tags": [],
                })
    except Exception as e:
        sys.stderr.write(f"[WARN] 东财7x24快讯拉取失败: {e}\n")
    return items


def _classify_and_score(item: dict[str, Any]) -> dict[str, Any] | None:
    """对单条快讯执行去噪、主题打标、极性判定与催化权重打分。"""
    full_text = f"{item.get('title', '')} {item.get('summary', '')}"
    if any(np in full_text for np in NOISE_PATTERNS):
        return None

    matched_topics: list[str] = []
    topic_hits = 0
    for topic, kws in TOPIC_KEYWORDS.items():
        hits = [kw for kw in kws if kw.lower() in full_text.lower()]
        if hits:
            matched_topics.append(topic)
            topic_hits += len(hits)

    if not matched_topics and not item.get("is_important"):
        return None

    pos_hits = sum(1 for w in POSITIVE_WORDS if w in full_text)
    neg_hits = sum(1 for w in NEGATIVE_WORDS if w in full_text)

    # 特殊规则：海外限制出口/制裁芯片对国产替代往往具有双向催化（标为“外部约束/国产催化”）
    is_export_ctrl_tech = (
        ("出口管制" in full_text or "限制出口" in full_text or "暂停" in full_text)
        and "国产算力/半导体" in matched_topics
    )

    if is_export_ctrl_tech:
        polarity = "外部约束/国产催化"
    elif pos_hits > neg_hits:
        polarity = "利好催化"
    elif neg_hits > pos_hits:
        polarity = "风险利空"
    else:
        polarity = "中性要闻"

    score = topic_hits * 15 + (25 if item.get("is_important") else 0) + pos_hits * 8 + neg_hits * 8
    if "国产算力/半导体" in matched_topics or "宏观政策/流动性" in matched_topics:
        score += 15

    return {
        **item,
        "topics": matched_topics or ["市场焦点"],
        "polarity": polarity,
        "score": score,
    }


def fetch_news_catalyst_dashboard(
    injected_items: list[dict] | None = None,
    top_n: int = 8,
) -> dict[str, Any]:
    """拉取并聚合新浪 + 东财实时 7x24 快讯，提炼高价值市场与科技催化。"""
    if injected_items is not None:
        raw_items = list(injected_items)
        sources_ok = ["injected"]
    else:
        raw_items = []
        sources_ok = []
        sina_focus = _fetch_sina_7x24(tag_id=9, page_size=25)
        sina_ashare = _fetch_sina_7x24(tag_id=10, page_size=30)
        sina_macro = _fetch_sina_7x24(tag_id=1, page_size=20)
        if sina_focus or sina_ashare or sina_macro:
            sources_ok.append("新浪财经7x24")
            raw_items.extend(sina_focus + sina_ashare + sina_macro)

        em_items = _fetch_eastmoney_fastnews(page_size=40)
        if em_items:
            sources_ok.append("东方财富7x24")
            raw_items.extend(em_items)

    # 去重（按规范化标题前 22 字）
    seen: set[str] = set()
    scored: list[dict[str, Any]] = []
    for it in raw_items:
        key = re.sub(r"\W+", "", it.get("title", ""))[:22]
        if not key or key in seen:
            continue
        seen.add(key)
        res = _classify_and_score(it)
        if res is not None:
            scored.append(res)

    scored.sort(key=lambda x: (x["score"], x.get("time", "")), reverse=True)
    top_catalysts = scored[:top_n]

    pos_cnt = sum(1 for x in scored if x["polarity"] in ("利好催化", "外部约束/国产催化"))
    neg_cnt = sum(1 for x in scored if x["polarity"] == "风险利空")
    tech_pos = [
        x for x in scored
        if ("国产算力/半导体" in x["topics"] or "AI与科技产业" in x["topics"])
        and x["polarity"] in ("利好催化", "外部约束/国产催化")
    ]
    policy_pos = [
        x for x in scored
        if "宏观政策/流动性" in x["topics"] and x["polarity"] == "利好催化"
    ]

    tech_catalyst_active = len(tech_pos) >= 1 or len(policy_pos) >= 2

    if not raw_items:
        summary = "实时快讯接口暂不可用，请人工核查最新财联社/交易所公告。"
        status = "degraded"
    elif top_catalysts:
        lead = top_catalysts[0]
        summary = (
            f"监测到 {len(scored)} 条高相关财经催化（利好 {pos_cnt} / 利空 {neg_cnt}），"
            f"核心焦点：[{lead['topics'][0]} / {lead['polarity']}] {lead['title']}"
        )
        status = "ok"
    else:
        summary = f"已扫描 {len(raw_items)} 条实时快讯，暂无重大政策或科技产业异动催化。"
        status = "ok"

    return {
        "fetch_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "sources": sources_ok,
        "raw_scanned_count": len(raw_items),
        "relevant_count": len(scored),
        "positive_catalyst_count": pos_cnt,
        "negative_risk_count": neg_cnt,
        "tech_catalyst_count": len(tech_pos),
        "policy_catalyst_count": len(policy_pos),
        "tech_catalyst_active": tech_catalyst_active,
        "top_catalysts": top_catalysts,
        "catalyst_summary": summary,
        "status": status,
    }


if __name__ == "__main__":
    print(json.dumps(fetch_news_catalyst_dashboard(), ensure_ascii=False, indent=2))
