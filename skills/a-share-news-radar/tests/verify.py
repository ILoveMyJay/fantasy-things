#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""最终验收：结构 / 编译 / 各测试套件 / 端到端

用法：
    python3 tests/verify.py            # 全量（含联网的行情测试）
    python3 tests/verify.py --offline  # 跳过联网测试
"""
import os
import py_compile
import subprocess
import sys

PY = sys.executable
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL = os.path.join(BASE, "SKILL.md")
REFS = os.path.join(BASE, "references")
SCRIPTS = os.path.join(BASE, "scripts")
TESTS = os.path.join(BASE, "tests")
FIXTURES = os.path.join(BASE, "fixtures")

OFFLINE = "--offline" in sys.argv
ok_all = True
failures = []


def check(name, cond, detail=""):
    global ok_all
    if not cond:
        ok_all = False
        failures.append(name)
    print("[%s] %-44s %s" % ("PASS" if cond else "FAIL", name, detail))


def run(cmd, cwd=None):
    return subprocess.run(cmd, capture_output=True, text=True, cwd=cwd or BASE)


def line(t):
    print("\n" + "=" * 72)
    print(t)
    print("=" * 72)


# ---------------------------------------------------------------------------
line("A. SKILL.md 结构与体积")

txt = open(SKILL, encoding="utf-8").read()
n_lines = txt.count("\n") + 1
check("无 oldText 污染", "oldText" not in txt)
check("行数 ≤ 100（路由层，不是流程手册）", n_lines <= 100, "%d 行" % n_lines)
check("字符数 ≤ 4500", len(txt) <= 4500, "%d 字符" % len(txt))
longest = max(len(l) for l in txt.split("\n"))
check("最长行 < 1000", longest < 1000, "%d" % longest)
for key in ["workflow.md", "workflow-phase1.md", "workflow-phase2.md",
            "market_snapshot.py", "lint_report.py", "db.py",
            "data-sources.md", "calendar-scanning.md", "source-policy.md"]:
    check("引用 %s" % key, key in txt)
check("声明 python3.11", "python3.11" in txt)
check("声明不构成投资建议", "不构成投资建议" in txt or "不给买卖建议" in txt)
check("根目录无孤儿 report-template.md",
      not os.path.exists(os.path.join(BASE, "report-template.md")))

# ---------------------------------------------------------------------------
line("B. 文件齐全")

for f in ["workflow.md", "workflow-phase1.md", "workflow-phase2.md",
          "data-sources.md", "calendar-scanning.md", "source-policy.md",
          "event-taxonomy.md", "a-share-mapping.md",
          "candidate-verification.md", "report-template.md"]:
    check("references/%s" % f, os.path.exists(os.path.join(REFS, f)))

for f in ["market_snapshot.py", "db.py", "lint_report.py", "score_events.py",
          "run_historical_cases.py", "sample_events.json"]:
    check("scripts/%s" % f, os.path.exists(os.path.join(SCRIPTS, f)))

for f in ["test_market.py", "test_db.py", "test_lint.py", "test_pipeline.py",
          "verify.py"]:
    check("tests/%s" % f, os.path.exists(os.path.join(TESTS, f)))

check("fixtures/historical_cases.json 存在",
      os.path.exists(os.path.join(FIXTURES, "historical_cases.json")))

# ---------------------------------------------------------------------------
line("C. 所有脚本可编译")

cache_dir = os.path.join(TESTS, "__pycache__")
os.makedirs(cache_dir, exist_ok=True)
for f in sorted(os.listdir(SCRIPTS)):
    if not f.endswith(".py"):
        continue
    try:
        py_compile.compile(os.path.join(SCRIPTS, f), doraise=True,
                           cfile=os.path.join(cache_dir, f + "c"))
        check("编译 %s" % f, True)
    except py_compile.PyCompileError as exc:
        check("编译 %s" % f, False, str(exc)[:80])

# ---------------------------------------------------------------------------
line("D. 历史回归用例")

p = run([PY, os.path.join(SCRIPTS, "run_historical_cases.py"),
         os.path.join(FIXTURES, "historical_cases.json")], cwd=SCRIPTS)
out = (p.stdout or "").strip()
check("7/7 回归通过", "7/7 passed" in out,
      out.splitlines()[0] if out else (p.stderr or "")[:80])

# ---------------------------------------------------------------------------
line("E. lint_report.py 规则测试")

p = run([PY, os.path.join(TESTS, "test_lint.py")])
out = p.stdout or ""
n_pass = out.count("[PASS]")
n_fail = out.count("[FAIL]")
check("lint 测试全通过", n_fail == 0 and n_pass >= 20,
      "pass=%d fail=%d" % (n_pass, n_fail))
if n_fail:
    for ln in out.split("\n"):
        if "[FAIL]" in ln:
            print("       " + ln.strip())

# ---------------------------------------------------------------------------
line("F. 端到端管线（打分 -> 校验 -> 落库 -> 回看）")

p = run([PY, os.path.join(TESTS, "test_pipeline.py")])
out = p.stdout or ""
n_pass = out.count("[PASS]")
n_fail = out.count("[FAIL]")
check("管线测试全通过", n_fail == 0 and n_pass >= 10,
      "pass=%d fail=%d" % (n_pass, n_fail))
if n_fail:
    for ln in out.split("\n"):
        if "[FAIL]" in ln:
            print("       " + ln.strip())

# ---------------------------------------------------------------------------
line("G. 落库测试")

p = run([PY, os.path.join(TESTS, "test_db.py")])
out = p.stdout or ""
check("落库链路通过", "reviewed=4" in out and "hit_rate" in out,
      "含 review + stats" if "reviewed=4" in out else (p.stderr or "")[:80])

# ---------------------------------------------------------------------------
line("H. 行情数据层" + ("（offline，跳过）" if OFFLINE else ""))

if OFFLINE:
    print("  已指定 --offline，跳过联网测试")
else:
    p = run([PY, os.path.join(TESTS, "test_market.py")])
    out = p.stdout or ""
    fails = [ln.strip() for ln in out.split("\n") if "[FAIL]" in ln]
    check("行情命令全部可用", not fails,
          "全部通过" if not fails else fails[0][:80])

# ---------------------------------------------------------------------------
line("结论")

if ok_all:
    print("全部通过 ✅")
else:
    print("存在失败项 ❌")
    for f in failures:
        print("  - %s" % f)

sys.exit(0 if ok_all else 1)
