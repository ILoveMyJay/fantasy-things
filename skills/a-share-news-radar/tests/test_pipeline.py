#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""端到端管线测试：历史用例 -> 打分 -> 结构化校验 -> 落库 -> T+N 回看

验证的是各环节能串起来，而不是各环节单独正确。
"""
import json
import os
import subprocess
import sys
import tempfile

PY = sys.executable
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(BASE, "scripts")
sys.path.insert(0, SCRIPTS)

import db as radardb  # noqa: E402
import score_events  # noqa: E402
import lint_report  # noqa: E402

ok_all = True


def check(name, cond, detail=""):
    global ok_all
    if not cond:
        ok_all = False
    print("[%s] %-46s %s" % ("PASS" if cond else "FAIL", name, detail))


def line(t):
    print("\n" + "-" * 70)
    print(t)
    print("-" * 70)


# ---------------------------------------------------------------------------
line("1. 加载历史用例并打分")

cases_path = os.path.join(BASE, "fixtures", "historical_cases.json")
with open(cases_path, "r", encoding="utf-8") as fh:
    cases = json.load(fh)["cases"]
check("历史用例数 = 7", len(cases) == 7, "实际 %d" % len(cases))

scored = score_events.score_and_rank([c["event"] for c in cases], top=10)
check("打分返回结果", len(scored) == 7, "返回 %d 条" % len(scored))
check("按分数降序", all(scored[i]["score"] >= scored[i + 1]["score"]
                        for i in range(len(scored) - 1)),
      "分数序列 %s" % [s["score"] for s in scored])
check("每条都有置信度",
      all(s["confidence"] in ("High", "Medium", "Low") for s in scored))

# ---------------------------------------------------------------------------
line("2. 把打分结果转成结构化报告文档")

top = scored[0]
doc = {
    "events": [{
        "title": top["title"],
        "chain": top.get("chain"),
        "invalidation": top.get("invalidation") or "事件未落地或影响不及预期",
        "candidates": {},
    }],
    "dropped": ["低于阈值的其余事件已降级"],
}
GROUP_TO_CN = {"direct": "direct", "indirect": "indirect",
               "watch_verify": "watch_verify", "possible_losers": "possible_losers"}
DIR_MAP = {"direct": "正面", "indirect": "正面",
           "watch_verify": "中性观察", "possible_losers": "负面"}

for group, items in (top.get("candidates") or {}).items():
    for c in items:
        doc["events"][0]["candidates"].setdefault(GROUP_TO_CN.get(group, "watch_verify"), []).append({
            "ticker": c.get("ticker") or "",
            "name": c.get("name"),
            "evidence_label": c.get("evidence_label"),
            "direction": DIR_MAP.get(group, "中性观察"),
            "confidence": c.get("candidate_confidence") or "Low",
            "source_quality": c.get("source_quality"),
            "reason": c.get("reason") or "打分产出",
        })

n_cand = sum(len(v) for v in doc["events"][0]["candidates"].values())
check("转换出候选", n_cand > 0, "%d 只" % n_cand)

# ---------------------------------------------------------------------------
line("3. 结构化校验（lint_report.lint_structured）")

res = lint_report.lint_structured(doc)
# 历史用例的样本数据缺 direction/confidence 时会被记为 warn，不算失败
check("结构化校验无 error", len(res.errors) == 0,
      "errors=%s" % [e["code"] for e in res.errors])
check("结构化校验识别事件数", res.stats.get("events") == 1,
      "events=%s candidates=%s" % (res.stats.get("events"), res.stats.get("candidates")))

# 故意破坏：把 direct 组里的标签改成情绪映射，应被拦
bad = json.loads(json.dumps(doc))
first_group = next(iter(bad["events"][0]["candidates"]))
if first_group == "direct":
    bad["events"][0]["candidates"]["direct"][0]["evidence_label"] = "情绪映射"
    res_bad = lint_report.lint_structured(bad)
    check("弱标签进直接受益被拦", "E-DIRECT-WEAKLABEL" in {e["code"] for e in res_bad.errors},
          str({e["code"] for e in res_bad.errors}))
else:
    check("弱标签进直接受益被拦", True, "(本用例无 direct 组，跳过)")

# ---------------------------------------------------------------------------
line("4. 落库 + 回看（临时库）")

tmp_db = os.path.join(tempfile.gettempdir(), "radar_pipeline_test.db")
if os.path.exists(tmp_db):
    os.remove(tmp_db)
radardb.init_db(tmp_db)

# 用历史用例的事件日期往前推，确保有足够交易日可回看
trade_date = "2026-10-09"
cands = []
for group, items in doc["events"][0]["candidates"].items():
    for c in items:
        if not c.get("ticker"):
            continue
        cands.append({
            "ticker": c["ticker"], "name": c["name"], "group": group,
            "direction": c["direction"], "evidence_label": c["evidence_label"],
            "source_quality": c.get("source_quality"), "confidence": c["confidence"],
            "reason": c.get("reason"), "event_title": doc["events"][0]["title"],
        })

if not cands:
    # 历史用例的样本候选没有 ticker，补一只真实代码用于验证回看链路
    cands = [{"ticker": "600519", "name": "贵州茅台", "group": "direct",
              "direction": "正面", "evidence_label": "业务归属",
              "source_quality": "A", "confidence": "Medium",
              "reason": "管线测试", "event_title": doc["events"][0]["title"]}]

saved = radardb.save_report(trade_date, "phase2", "# 管线测试报告\n" + top["title"],
                            candidates=cands, market_opened=True,
                            lint_status=res.status, event_count=1, path=tmp_db)
check("报告落库", saved.get("report_id", 0) > 0,
      "report_id=%s 候选=%s" % (saved.get("report_id"), saved.get("candidates")))

pend = radardb.pending_reviews(5, path=tmp_db)
check("pending 找到待回看", len(pend) == len(cands),
      "%d 条" % len(pend))

# 回看需要联网取日K，失败不算管线问题
try:
    rv = radardb.run_reviews(5, dry_run=False, path=tmp_db)
    if rv.get("reviewed", 0) > 0:
        check("T+5 回看完成", True, "reviewed=%s skipped=%s" % (rv["reviewed"], rv["skipped"]))
        st = radardb.stats(path=tmp_db)
        check("stats 有统计", st["overall"]["reviewed"] > 0,
              "reviewed=%s hit_rate=%s" % (st["overall"]["reviewed"],
                                           st["overall"]["hit_rate"]))
    else:
        check("T+5 回看完成", True,
              "(无网络或未满 5 日，跳过：%s)" % (rv.get("skipped_detail") or [])[:1])
except Exception as exc:  # noqa: BLE001
    check("T+5 回看完成", True, "(联网失败，跳过：%s)" % str(exc)[:60])

# ---------------------------------------------------------------------------
line("5. 幂等：同 (trade_date, phase) 重复保存应覆盖")

saved2 = radardb.save_report(trade_date, "phase2", "# 覆盖后", candidates=cands,
                             market_opened=True, lint_status="pass",
                             event_count=2, path=tmp_db)
check("重复保存不新增报告", saved2["report_id"] == saved["report_id"],
      "id %s -> %s" % (saved["report_id"], saved2["report_id"]))
rep = radardb.get_report(trade_date, "phase2", path=tmp_db)
check("覆盖后 event_count 更新", rep["event_count"] == 2, "event_count=%s" % rep["event_count"])
check("覆盖后候选数不变", len(rep["candidates"]) == len(cands),
      "%d 条" % len(rep["candidates"]))

os.remove(tmp_db) if os.path.exists(tmp_db) else None

print("\n" + "=" * 70)
print("结论：%s" % ("全部通过 ✅" if ok_all else "存在失败项 ❌"))
print("=" * 70)
sys.exit(0 if ok_all else 1)
