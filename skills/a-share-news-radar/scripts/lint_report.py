#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""报告字段校验器 —— 把 SKILL.md 里的「必须」变成可机检的断言。

SKILL.md 写了大量「必须」「禁止」，但没有任何机制检查。本脚本负责在报告
推送前做最后一道闸门：不合格就打回重写，而不是直接把推测发出去。

用法：
    python3 lint_report.py report.md --phase phase2
    python3 lint_report.py --json structured.json
    python3 lint_report.py report.md --phase phase2 --strict

退出码：0 = pass，1 = warn，2 = fail
"""

from __future__ import annotations

import argparse
import json
import re
import sys

# ---------------------------------------------------------------------------
# 词表
# ---------------------------------------------------------------------------

DIRECTION_TOKENS = ["✅", "⚠️", "⚠", "👀", "正面", "负面", "中性观察"]

EVIDENCE_LABELS = ["公告确认", "业务归属", "产业链推断", "情绪映射", "负面暴露", "剔除"]

CONFIDENCE_TOKENS = ["High", "Medium", "Low"]

SOURCE_QUALITY_RE = re.compile(r"(?<![A-Za-z])([SABC])(?![A-Za-z])")

STOCK_CODE_RE = re.compile(r"(?<!\d)(\d{6})(?!\d)")

INDEX_NAMES = ["上证指数", "深证成指", "创业板指", "沪深300", "中证500", "沪指", "深成指"]

# 出现这些词但没有具体数字，说明是模糊描述
VAGUE_MARKET_WORDS = ["震荡走低", "震荡走高", "低开后反弹", "高开低走", "窄幅震荡",
                      "小幅上涨", "小幅下跌", "略有回升"]

DROPPED_HEADINGS = ["dropped", "deprioritized", "剔除", "降级", "已排除", "未纳入"]

INVALIDATION_WORDS = ["失效条件", "失效", "invalidation"]

SOURCE_ATTRIBUTION_WORDS = ["数据来源", "来源：", "来源:"]

WINDOW_WORDS = ["观察窗口", "窗口", "window"]

DATA_SOURCE_SCRIPT = "market_snapshot"

# 表格行：以 | 开头
TABLE_ROW_RE = re.compile(r"^\s*\|.*\|\s*$")
TABLE_SEP_RE = re.compile(r"^\s*\|[\s:\-|]+\|\s*$")


# ---------------------------------------------------------------------------
# 结果收集
# ---------------------------------------------------------------------------

class Result:
    def __init__(self):
        self.errors = []
        self.warnings = []
        self.stats = {}

    def fail(self, code, msg, detail=None):
        item = {"code": code, "msg": msg}
        if detail is not None:
            item["detail"] = detail
        self.errors.append(item)

    def warn(self, code, msg, detail=None):
        item = {"code": code, "msg": msg}
        if detail is not None:
            item["detail"] = detail
        self.warnings.append(item)

    @property
    def status(self):
        if self.errors:
            return "fail"
        if self.warnings:
            return "warn"
        return "pass"

    def to_dict(self):
        return {
            "status": self.status,
            "error_count": len(self.errors),
            "warning_count": len(self.warnings),
            "errors": self.errors,
            "warnings": self.warnings,
            "stats": self.stats,
        }


# ---------------------------------------------------------------------------
# Markdown 解析
# ---------------------------------------------------------------------------

def split_sections(text):
    """按 ## 标题切段，返回 [(heading, body)]。"""
    parts = re.split(r"(?m)^(#{1,4})\s+(.*)$", text)
    sections = []
    if parts[0].strip():
        sections.append(("", parts[0]))
    i = 1
    while i + 2 <= len(parts) - 1:
        heading = parts[i + 1].strip()
        body = parts[i + 2] if i + 2 < len(parts) else ""
        sections.append((heading, body))
        i += 3
    return sections


def parse_tables(text):
    """返回所有表格：[{"header": [...], "rows": [[...]]}]"""
    tables = []
    lines = text.split("\n")
    i = 0
    while i < len(lines):
        if TABLE_ROW_RE.match(lines[i]) and i + 1 < len(lines) and TABLE_SEP_RE.match(lines[i + 1]):
            header = [c.strip() for c in lines[i].strip().strip("|").split("|")]
            rows = []
            j = i + 2
            while j < len(lines) and TABLE_ROW_RE.match(lines[j]):
                cells = [c.strip() for c in lines[j].strip().strip("|").split("|")]
                rows.append(cells)
                j += 1
            tables.append({"header": header, "rows": rows})
            i = j
        else:
            i += 1
    return tables


def find_candidate_rows(text):
    """找出疑似候选股行：含 6 位代码的行（表格行或列表行）。"""
    out = []
    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            continue
        codes = STOCK_CODE_RE.findall(line)
        if codes:
            out.append({"line": line, "codes": codes})
    return out


# ---------------------------------------------------------------------------
# 校验规则
# ---------------------------------------------------------------------------

def check_market_section(text, phase, res):
    """Phase 2 / mixed 必须有带来源的指数点位。"""
    if phase == "phase1":
        return
    has_index = any(name in text for name in INDEX_NAMES)
    has_number = bool(re.search(r"\d{3,4}\.\d{1,2}", text))
    has_source = any(w in text for w in SOURCE_ATTRIBUTION_WORDS)

    if not (has_index and has_number):
        res.fail("E-MARKET-MISSING",
                 "缺少指数点位（Phase 2 必须给出上证/深成/创业板收盘点位）")
    elif not has_source:
        res.fail("E-MARKET-NOSOURCE",
                 "有指数点位但未标注数据来源")

    if DATA_SOURCE_SCRIPT not in text and "行情脚本" not in text and has_index:
        res.warn("W-MARKET-SOURCE-UNKNOWN",
                 "未注明点位来自 market_snapshot.py，无法判断是否脚本取数")

    for word in VAGUE_MARKET_WORDS:
        if word in text and not re.search(r"\d{3,4}\.\d{1,2}", text):
            res.fail("E-MARKET-VAGUE",
                     "出现模糊行情描述「%s」但无具体数字" % word)
            break


def check_candidates(text, phase, res):
    """每个候选股必须有方向标记和证据标签。"""
    rows = find_candidate_rows(text)

    # Phase 1 不应点名个股
    if phase == "phase1" and rows:
        allowed = [r for r in rows
                   if "[预期/待确认]" in r["line"] or "待确认" in r["line"]]
        bad = len(rows) - len(allowed)
        if bad > 0:
            res.fail("E-PHASE1-NAMES-STOCK",
                     "Phase 1 出现 %d 行具体个股代码（盘前预期不应点名个股，"
                     "如确需映射请标 [预期/待确认]）" % bad,
                     {"sample": rows[0]["line"][:120]})

    if not rows:
        if phase in ("phase2", "mixed"):
            res.fail("E-CANDIDATE-MISSING", "未找到候选股票池（Phase 2 必须给出候选池）")
        return

    res.stats["candidate_rows"] = len(rows)

    no_direction, no_label, no_confidence = [], [], []
    for r in rows:
        line = r["line"]
        if not any(t in line for t in DIRECTION_TOKENS):
            no_direction.append(r)
        if not any(lbl in line for lbl in EVIDENCE_LABELS):
            no_label.append(r)
        if not any(c in line for c in CONFIDENCE_TOKENS):
            no_confidence.append(r)

    if no_direction:
        res.fail("E-CANDIDATE-NODIR",
                 "%d/%d 个候选股缺多空方向标记（✅正面/⚠️负面/👀中性观察）"
                 % (len(no_direction), len(rows)),
                 {"sample": no_direction[0]["line"][:120]})

    if no_label:
        res.fail("E-CANDIDATE-NOLABEL",
                 "%d/%d 个候选股缺证据标签（公告确认/业务归属/产业链推断/"
                 "情绪映射/负面暴露/剔除）" % (len(no_label), len(rows)),
                 {"sample": no_label[0]["line"][:120]})

    if no_confidence:
        res.warn("W-CANDIDATE-NOCONF",
                 "%d/%d 个候选股缺置信度（High/Medium/Low）"
                 % (len(no_confidence), len(rows)))

    # 表格列序检查：方向列应在最前
    for tb in parse_tables(text):
        header = tb["header"]
        if not any("股票" in h or "代码" in h for h in header):
            continue
        if "方向" not in "".join(header):
            res.warn("W-TABLE-NODIRCOL", "候选池表格缺少「方向」列")
        else:
            dir_idx = next(i for i, h in enumerate(header) if "方向" in h)
            if dir_idx > 0:
                res.warn("W-TABLE-DIRNOTFIRST",
                         "「方向」列不在首列（当前第 %d 列）" % (dir_idx + 1))
        if not any("来源" in h or "质量" in h for h in header):
            res.warn("W-TABLE-NOSRCCOL", "候选池表格缺少「来源」列")
        if not any("置信" in h for h in header):
            res.warn("W-TABLE-NOCONFCOL", "候选池表格缺少「置信度」列")


def check_discipline(text, res):
    """必须展示纪律：失效条件 + 排除项。"""
    if not any(w in text for w in INVALIDATION_WORDS):
        res.fail("E-NO-INVALIDATION",
                 "缺少「失效条件」——每个事件都应说明什么情况下判断不成立")

    low = text.lower()
    if not any(w.lower() in low for w in DROPPED_HEADINGS):
        res.fail("E-NO-DROPPED",
                 "缺少「剔除/降级」段——需说明哪些传闻、过期消息、弱关联被排除")


def check_structure(text, res, phase="phase2"):
    """基础结构。"""
    if len(text.strip()) < 200:
        res.fail("E-TOO-SHORT", "报告正文过短（%d 字符），可能是空壳" % len(text.strip()))
    if not re.search(r"(?m)^#{1,3}\s+\S", text):
        res.warn("W-NO-HEADING", "报告没有任何标题结构")
    # 观察窗口是 Phase 2 的输出要求；Phase 1 用「触发日期 + 行动建议」代替
    if phase in ("phase2", "mixed") and not any(w in text for w in WINDOW_WORDS):
        res.warn("W-NO-WINDOW", "未给出观察窗口（当日/1-3交易日/1-2周/政策周期）")


def lint_markdown(text, phase="phase2", strict=False):
    res = Result()
    check_structure(text, res, phase)
    check_market_section(text, phase, res)
    check_candidates(text, phase, res)
    check_discipline(text, res)
    if strict and res.warnings:
        # strict 模式下警告升级为错误
        for w in res.warnings:
            res.errors.append(dict(w, code=w["code"].replace("W-", "E-"), promoted=True))
        res.warnings = []
    res.stats["chars"] = len(text)
    res.stats["phase"] = phase
    return res


# ---------------------------------------------------------------------------
# 结构化 JSON 校验（比 markdown 解析更可靠）
# ---------------------------------------------------------------------------

def lint_structured(doc, strict=False):
    res = Result()
    events = doc.get("events") or []
    res.stats["events"] = len(events)
    if not events:
        res.fail("E-NO-EVENT", "events 为空")

    total_cand = 0
    for i, ev in enumerate(events, 1):
        title = ev.get("title") or ev.get("event") or ("事件%d" % i)
        if not ev.get("chain"):
            res.warn("W-EVENT-NOCHAIN", "事件「%s」缺影响链" % title)
        if not ev.get("invalidation"):
            res.fail("E-EVENT-NOINVAL", "事件「%s」缺失效条件" % title)
        cands = ev.get("candidates") or {}
        flat = []
        if isinstance(cands, dict):
            for group, items in cands.items():
                for c in items or []:
                    flat.append((group, c))
        elif isinstance(cands, list):
            flat = [(c.get("group", "watch_verify"), c) for c in cands]

        for group, c in flat:
            total_cand += 1
            label = c.get("evidence_label")
            if label not in EVIDENCE_LABELS:
                res.fail("E-CAND-BADLABEL",
                         "%s 的证据标签非法：%r" % (c.get("name") or c.get("ticker"), label))
            if not c.get("direction"):
                res.fail("E-CAND-NODIR",
                         "%s 缺方向" % (c.get("name") or c.get("ticker")))
            if not c.get("confidence"):
                res.warn("W-CAND-NOCONF",
                         "%s 缺置信度" % (c.get("name") or c.get("ticker")))
            if group in ("direct", "直接受益") and label not in ("公告确认", "业务归属"):
                res.fail("E-DIRECT-WEAKLABEL",
                         "%s 放在「直接受益」但标签是「%s」，只有公告确认/业务归属可进"
                         % (c.get("name") or c.get("ticker"), label))
            if label == "情绪映射" and c.get("confidence") == "High":
                res.fail("E-SENTIMENT-HIGH",
                         "%s 是情绪映射但给了 High 置信度" % (c.get("name") or c.get("ticker")))

    res.stats["candidates"] = total_cand
    if total_cand == 0:
        res.warn("W-NO-CANDIDATE", "没有任何候选股")

    if not doc.get("dropped") and not doc.get("deprioritized"):
        res.fail("E-NO-DROPPED", "缺 dropped/deprioritized 字段")

    if strict and res.warnings:
        for w in res.warnings:
            res.errors.append(dict(w, code=w["code"].replace("W-", "E-"), promoted=True))
        res.warnings = []

    return res


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv=None):
    parser = argparse.ArgumentParser(description="A股雷达报告字段校验")
    parser.add_argument("path", nargs="?", help="报告 markdown 路径")
    parser.add_argument("--json", dest="json_path", help="结构化 JSON 路径（优先于 markdown）")
    parser.add_argument("--phase", default="phase2",
                        choices=["phase1", "phase2", "mixed"])
    parser.add_argument("--strict", action="store_true", help="警告升级为错误")
    parser.add_argument("--pretty", action="store_true")
    parser.add_argument("--quiet", action="store_true", help="只输出退出码")
    args = parser.parse_args(argv)

    if not args.path and not args.json_path:
        parser.print_help()
        return 2

    try:
        if args.json_path:
            with open(args.json_path, "r", encoding="utf-8") as fh:
                doc = json.load(fh)
            res = lint_structured(doc, strict=args.strict)
        else:
            with open(args.path, "r", encoding="utf-8") as fh:
                text = fh.read()
            res = lint_markdown(text, args.phase, strict=args.strict)
    except OSError as exc:
        print(json.dumps({"status": "fail", "errors": [
            {"code": "E-IO", "msg": "读取失败: %s" % exc}]}, ensure_ascii=False))
        return 2

    payload = res.to_dict()
    if not args.quiet:
        print(json.dumps(payload, ensure_ascii=False, indent=2 if args.pretty else None))

    return {"pass": 0, "warn": 1, "fail": 2}[res.status]


if __name__ == "__main__":
    sys.exit(main())
