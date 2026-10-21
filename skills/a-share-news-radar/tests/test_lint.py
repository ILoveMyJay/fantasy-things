#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""lint_report.py 自测：每条规则的通过/失败路径都要覆盖。"""
import json
import os
import subprocess
import sys
import tempfile

PY = sys.executable
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LINT = os.path.join(BASE, "scripts", "lint_report.py")

ok_all = True


def check(name, cond, detail=""):
    global ok_all
    if not cond:
        ok_all = False
    print("[%s] %-42s %s" % ("PASS" if cond else "FAIL", name, detail))


def run_text(text, phase="phase2", strict=False, use_json=False, doc=None):
    fd, path = tempfile.mkstemp(suffix=".md" if not use_json else ".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            if use_json:
                json.dump(doc, fh, ensure_ascii=False)
            else:
                fh.write(text)
        cmd = [PY, LINT]
        if use_json:
            cmd += ["--json", path]
        else:
            cmd += [path, "--phase", phase]
        if strict:
            cmd.append("--strict")
        p = subprocess.run(cmd, capture_output=True, text=True)
        try:
            payload = json.loads(p.stdout)
        except ValueError:
            payload = {"status": "parse-error", "raw": p.stdout[:200], "stderr": p.stderr[:200]}
        payload["_rc"] = p.returncode
        return payload
    finally:
        os.unlink(path)


def codes(payload):
    return {e["code"] for e in payload.get("errors", [])}


def wcodes(payload):
    return {w["code"] for w in payload.get("warnings", [])}


GOOD = """# A股新闻投资方向雷达 | 2026-10-20 盘后

范围：当日已落地事件 + 预期跟踪；市场：A股；定位：研究线索，不构成投资建议。

## Market Pulse

- 上证指数 3735.37（+0.12%），深证成指 11801.29（-0.14%），创业板指 2739.20（-0.26%）。
  数据来源：market_snapshot.py（腾讯），收盘数据。
- 主线：消费刺激政策落地。
- 风险提示：部分主题拥挤度偏高。

## 已落地事件分析

### 1. 消费刺激政策落地

- 事件摘要：政策正式发布，覆盖家电与白酒。
- 影响链：政策 -> 消费需求回升 -> 白酒/零售 -> 候选池
- 预期 vs 实际：如期反应，白酒领涨。
- 候选池：

| 方向 | 股票 | 标签 | 来源 | 置信度 | 理由 | 观察窗口 |
|------|------|------|------|--------|------|----------|
| ✅正面 | 600519 贵州茅台 | 业务归属 | A | High | 白酒龙头直接受益 | 1-2周 |
| ⚠️负面 | 300750 宁德时代 | 负面暴露 | B | Medium | 补贴退坡压制需求 | 1-2周 |
| 👀中性观察 | 000001 平安银行 | 情绪映射 | C | Low | 仅概念关联，需核实 | 当日 |

- 失效条件：政策执行力度低于预期，或消费数据未改善。

## Dropped Or Deprioritized

- 某传闻：无权威来源，已排除。
- 某过期消息：上月事件，已剔除。
"""

PHASE1_OK = """# A股预期扫描 | 2026-10-21 盘前

范围：未来 1-3 个交易日确定性事件；市场：A股。

## 预期概览

- 未来 3 个交易日共 3 类关键事件：会议、政策、财报。

## 高优先级预期事件

### 1. 某产业政策发布

- 时间：2026-10-22（已确认，来源：工信部官网）
- 事件摘要：产业扶持政策预期发布。
- 预期影响链：政策 -> 补贴落地 -> 新能源/半导体
- 受益主题方向：新能源、半导体（不点名个股）
- 事件确定性：High
- 失效条件：政策延期或力度不及预期。
- 行动建议：提前布局 [新能源]，事件当日观察 [半导体]

## Dropped Or Deprioritized

- 某航天发射传闻：仅有传闻，待确认后纳入。
"""


def line(t):
    print("\n" + "-" * 68)
    print(t)
    print("-" * 68)


line("A. 合规报告应 pass")
r = run_text(GOOD)
check("good 报告 status=pass", r.get("status") == "pass",
      "status=%s errors=%s warns=%s" % (r.get("status"), r.get("error_count"), r.get("warning_count")))
check("good 退出码 0", r.get("_rc") == 0, "rc=%s" % r.get("_rc"))
check("good 识别到 3 个候选行", r.get("stats", {}).get("candidate_rows") == 3,
      "rows=%s" % r.get("stats", {}).get("candidate_rows"))

line("B. 缺行情点位")
bad = GOOD.replace("上证指数 3735.37（+0.12%），深证成指 11801.29（-0.14%），创业板指 2739.20（-0.26%）。", "")
r = run_text(bad)
check("检出 E-MARKET-MISSING", "E-MARKET-MISSING" in codes(r), str(codes(r)))
check("退出码 2", r.get("_rc") == 2, "rc=%s" % r.get("_rc"))

line("C. 有行情但无来源")
bad = GOOD.replace("数据来源：market_snapshot.py（腾讯），收盘数据。", "")
r = run_text(bad)
check("检出 E-MARKET-NOSOURCE", "E-MARKET-NOSOURCE" in codes(r), str(codes(r)))

line("D. 模糊行情描述")
bad = GOOD.replace("上证指数 3735.37（+0.12%），深证成指 11801.29（-0.14%），创业板指 2739.20（-0.26%）。",
                   "今日大盘震荡走低。")
r = run_text(bad)
check("检出 E-MARKET-VAGUE 或 E-MARKET-MISSING",
      bool(codes(r) & {"E-MARKET-VAGUE", "E-MARKET-MISSING"}), str(codes(r)))

line("E. 候选股缺方向")
bad = GOOD.replace("| ✅正面 | 600519 贵州茅台", "|  | 600519 贵州茅台")
r = run_text(bad)
check("检出 E-CANDIDATE-NODIR", "E-CANDIDATE-NODIR" in codes(r), str(codes(r)))

line("F. 候选股缺证据标签")
bad = GOOD.replace("| 业务归属 |", "|  |")
r = run_text(bad)
check("检出 E-CANDIDATE-NOLABEL", "E-CANDIDATE-NOLABEL" in codes(r), str(codes(r)))

line("G. 缺失效条件")
bad = GOOD.replace("- 失效条件：政策执行力度低于预期，或消费数据未改善。", "")
r = run_text(bad)
check("检出 E-NO-INVALIDATION", "E-NO-INVALIDATION" in codes(r), str(codes(r)))

line("H. 缺剔除段")
bad = GOOD.replace("## Dropped Or Deprioritized", "## 其他")
bad = bad.replace("- 某传闻：无权威来源，已排除。\n- 某过期消息：上月事件，已剔除。", "- 无。")
r = run_text(bad)
check("检出 E-NO-DROPPED", "E-NO-DROPPED" in codes(r), str(codes(r)))

line("I. Phase 1 不应点名个股")
bad = PHASE1_OK.replace("- 受益主题方向：新能源、半导体（不点名个股）",
                        "- 受益主题方向：新能源（如 600519 贵州茅台）")
r = run_text(bad, phase="phase1")
check("检出 E-PHASE1-NAMES-STOCK", "E-PHASE1-NAMES-STOCK" in codes(r), str(codes(r)))

line("J. Phase 1 标了 [预期/待确认] 则放行")
ok = PHASE1_OK.replace("- 受益主题方向：新能源、半导体（不点名个股）",
                       "- 受益主题方向：新能源（600519 贵州茅台 [预期/待确认]）")
r = run_text(ok, phase="phase1")
check("不报 E-PHASE1-NAMES-STOCK", "E-PHASE1-NAMES-STOCK" not in codes(r), str(codes(r)))

line("K. 合规 Phase 1 报告")
r = run_text(PHASE1_OK, phase="phase1")
check("phase1 good status=pass", r.get("status") == "pass",
      "status=%s errors=%s" % (r.get("status"), codes(r)))

line("L. 表格方向列不在首位")
bad = GOOD.replace("| 方向 | 股票 | 标签 |", "| 股票 | 方向 | 标签 |")
bad = bad.replace("| ✅正面 | 600519 贵州茅台 |", "| 600519 贵州茅台 | ✅正面 |")
bad = bad.replace("| ⚠️负面 | 300750 宁德时代 |", "| 300750 宁德时代 | ⚠️负面 |")
bad = bad.replace("| 👀中性观察 | 000001 平安银行 |", "| 000001 平安银行 | 👀中性观察 |")
r = run_text(bad)
check("检出 W-TABLE-DIRNOTFIRST", "W-TABLE-DIRNOTFIRST" in wcodes(r), str(wcodes(r)))

line("M. strict 模式：警告升级为错误")
r = run_text(bad, strict=True)
check("strict 下 status=fail", r.get("status") == "fail", "status=%s" % r.get("status"))
check("strict 下退出码 2", r.get("_rc") == 2, "rc=%s" % r.get("_rc"))

line("N. 结构化 JSON：合规")
doc = {
    "events": [{
        "title": "消费刺激政策落地",
        "chain": "政策 -> 需求 -> 白酒",
        "invalidation": "政策力度不足",
        "candidates": {
            "direct": [{"ticker": "600519", "name": "贵州茅台", "evidence_label": "业务归属",
                        "direction": "正面", "confidence": "High"}],
            "watch_verify": [{"ticker": "000001", "name": "平安银行", "evidence_label": "情绪映射",
                              "direction": "中性观察", "confidence": "Low"}],
        },
    }],
    "dropped": ["某传闻：无来源"],
}
r = run_text("", use_json=True, doc=doc)
check("structured good status=pass", r.get("status") == "pass",
      "status=%s errors=%s" % (r.get("status"), codes(r)))

line("O. 结构化 JSON：直接受益但标签弱")
doc2 = json.loads(json.dumps(doc))
doc2["events"][0]["candidates"]["direct"][0]["evidence_label"] = "情绪映射"
r = run_text("", use_json=True, doc=doc2)
check("检出 E-DIRECT-WEAKLABEL", "E-DIRECT-WEAKLABEL" in codes(r), str(codes(r)))

line("P. 结构化 JSON：情绪映射给 High")
doc3 = json.loads(json.dumps(doc))
doc3["events"][0]["candidates"]["watch_verify"][0]["confidence"] = "High"
r = run_text("", use_json=True, doc=doc3)
check("检出 E-SENTIMENT-HIGH", "E-SENTIMENT-HIGH" in codes(r), str(codes(r)))

line("Q. 结构化 JSON：缺失效条件")
doc4 = json.loads(json.dumps(doc))
del doc4["events"][0]["invalidation"]
r = run_text("", use_json=True, doc=doc4)
check("检出 E-EVENT-NOINVAL", "E-EVENT-NOINVAL" in codes(r), str(codes(r)))

line("R. 结构化 JSON：无 dropped")
doc5 = json.loads(json.dumps(doc))
del doc5["dropped"]
r = run_text("", use_json=True, doc=doc5)
check("检出 E-NO-DROPPED", "E-NO-DROPPED" in codes(r), str(codes(r)))

print("\n" + "=" * 68)
print("结论：%s" % ("全部通过 ✅" if ok_all else "存在失败项 ❌"))
print("=" * 68)
sys.exit(0 if ok_all else 1)
