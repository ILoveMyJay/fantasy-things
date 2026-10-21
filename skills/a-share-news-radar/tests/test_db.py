#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""db.py 自测"""
import json
import os
import subprocess
import sys
import tempfile

PY = sys.executable
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(BASE, "scripts", "db.py")
TEST_DB = os.path.join(tempfile.gettempdir(), "radar_test.db")
TMP = tempfile.gettempdir()
BODY_PATH = os.path.join(TMP, "_radar_body.md")
CANDS_PATH = os.path.join(TMP, "_radar_cands.json")

if os.path.exists(TEST_DB):
    os.remove(TEST_DB)


def run(*args, expect_ok=True):
    cmd = [PY, DB] + list(args) + ["--db", TEST_DB]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        print("  RC=%d STDERR=%s" % (p.returncode, p.stderr.strip()[:300]))
        return None
    try:
        return json.loads(p.stdout)
    except ValueError:
        print("  非 JSON 输出:", p.stdout[:300])
        return None


def line(t):
    print("\n" + "=" * 66)
    print(t)
    print("=" * 66)


line("1. init")
r = run("init")
print(" ", r)

line("2. save 报告（含候选池，trade_date=2026-10-09 以便回看）")
cands = [
    {"ticker": "600519", "name": "贵州茅台", "group": "direct", "direction": "✅正面",
     "evidence_label": "业务归属", "source_quality": "A", "confidence": "High",
     "reason": "白酒消费复苏直接受益", "event_title": "消费刺激政策落地"},
    {"ticker": "000001.SZ", "name": "平安银行", "group": "watch_verify", "direction": "👀中性观察",
     "evidence_label": "情绪映射", "source_quality": "C", "confidence": "Low",
     "reason": "仅概念关联", "event_title": "消费刺激政策落地"},
    {"ticker": "300750", "name": "宁德时代", "group": "possible_losers", "direction": "⚠️负面",
     "evidence_label": "负面暴露", "source_quality": "B", "confidence": "Medium",
     "reason": "补贴退坡压制需求", "event_title": "新能源补贴退坡"},
    {"ticker": "000983", "name": "山西焦煤", "group": "direct", "direction": "正面",
     "evidence_label": "公告确认", "source_quality": "S", "confidence": "High",
     "reason": "公告确认产能扩张", "event_title": "焦煤涨价"},
]
body = "# 测试报告\n\n这是一份用于验证落库链路的假报告。\n"
with open(BODY_PATH, "w", encoding="utf-8") as fh:
    fh.write(body)
with open(CANDS_PATH, "w", encoding="utf-8") as fh:
    json.dump(cands, fh, ensure_ascii=False)
r = run("save", "--trade-date", "2026-10-09", "--phase", "phase2",
        "--body-file", BODY_PATH, "--candidates", "@" + CANDS_PATH,
        "--market-opened", "--lint-status", "pass")
print(" ", r)

line("3. save 第二份（同日 phase1，验证不冲突）")
r = run("save", "--trade-date", "2026-10-20", "--phase", "phase1",
        "--body", "盘前预期扫描测试", "--candidates", "[]",
        "--market-opened", "--lint-status", "pass")
print(" ", r)

line("4. 重复 save 同日同 phase（验证覆盖而非报错）")
r = run("save", "--trade-date", "2026-10-09", "--phase", "phase2",
        "--body-file", BODY_PATH, "--candidates", "@" + CANDS_PATH,
        "--market-opened", "--lint-status", "pass")
print(" ", r)

line("5. list")
r = run("list", "--limit", "10")
for row in (r or {}).get("data", []):
    print("  %s %-7s 事件=%s 候选=%s lint=%s"
          % (row["trade_date"], row["phase"], row["event_count"],
             row["candidate_count"], row["lint_status"]))

line("6. show")
r = run("show", "--trade-date", "2026-10-09", "--phase", "phase2")
d = (r or {}).get("data") or {}
print("  报告: trade_date=%s phase=%s 候选=%d 条"
      % (d.get("trade_date"), d.get("phase"), len(d.get("candidates") or [])))
for c in d.get("candidates") or []:
    print("    %-7s %-6s group=%-15s dir=%-5s label=%-6s src=%-2s conf=%s"
          % (c["ticker"], c["name"], c["group_name"], c["direction"],
             c["evidence_label"], c["source_quality"], c["confidence"]))

line("7. pending --horizon 5")
r = run("pending", "--horizon", "5")
print("  待回看 %d 条" % len((r or {}).get("data") or []))
for p in (r or {}).get("data", [])[:6]:
    print("    %s %-7s %-6s dir=%s" % (p["trade_date"], p["ticker"], p["name"], p["direction"]))

line("8. review --dry-run")
r = run("review", "--horizon", "5", "--dry-run")
print("  reviewed=%s skipped=%s errors=%s"
      % ((r or {}).get("reviewed"), (r or {}).get("skipped"), (r or {}).get("errors")))
for it in (r or {}).get("data", []):
    print("    %-7s %-6s %s -> %s  %+.2f%%  hit=%s"
          % (it["ticker"], it["name"], it["trade_date"], it["review_date"],
             it["pct_change"], it["hit"]))
for sk in (r or {}).get("skipped_detail", []):
    print("    skip %s: %s" % (sk["ticker"], sk["reason"]))

line("9. review 正式写入")
r = run("review", "--horizon", "5")
print("  reviewed=%s" % (r or {}).get("reviewed"))

line("10. stats")
r = run("stats")
d = (r or {}).get("data") or {}
print("  总体:", d.get("overall"))
print("  按证据标签:")
for x in d.get("by_evidence_label", []):
    print("    %-8s n=%-3s hits=%-3s 命中率=%s%% 平均涨跌=%s%%"
          % (x["label"], x["n"], x["hits"], x["hit_rate"], x["avg_pct"]))
print("  按方向:")
for x in d.get("by_direction", []):
    print("    %-8s n=%-3s hits=%-3s 命中率=%s%% 平均涨跌=%s%%"
          % (x["direction"], x["n"], x["hits"], x["hit_rate"], x["avg_pct"]))

line("11. pending 复查（应已清空已回看的）")
r = run("pending", "--horizon", "5")
print("  剩余待回看 %d 条" % len((r or {}).get("data") or []))

line("12. log-run")
r = run("log-run", "--trade-date", "2026-10-20", "--phase", "phase2",
        "--started-at", "2026-10-20 16:00:00", "--duration-ms", "95000",
        "--search-calls", "8", "--event-count", "5", "--candidate-count", "12",
        "--lint-status", "pass")
print(" ", r)
print("\n测试库大小: %.1f KB" % (os.path.getsize(TEST_DB) / 1024))
