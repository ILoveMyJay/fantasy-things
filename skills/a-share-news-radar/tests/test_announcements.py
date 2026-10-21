#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""announcements.py 自测

离线部分测纯函数（参数解析、字段归一化、column 推断）；
联网部分测真实查询，网络不通时记为跳过而不是失败。

用法：python3 tests/test_announcements.py [--offline]
"""
import json
import os
import subprocess
import sys
from datetime import date, timedelta

PY = sys.executable
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(BASE, "scripts")
sys.path.insert(0, SCRIPTS)

import announcements as ann  # noqa: E402

OFFLINE = "--offline" in sys.argv
ok_all = True
skipped = []


def check(name, cond, detail=""):
    global ok_all
    if not cond:
        ok_all = False
    print("[%s] %-44s %s" % ("PASS" if cond else "FAIL", name, detail))


def skip(name, reason):
    skipped.append(name)
    print("[SKIP] %-44s %s" % (name, reason))


def line(t):
    print("\n" + "-" * 68)
    print(t)
    print("-" * 68)


# ---------------------------------------------------------------------------
line("1. 类别表完整性")

check("类别数量 ≥ 15", len(ann.CATEGORIES) >= 15, "%d 个" % len(ann.CATEGORIES))
check("业绩预告在类别表内", "业绩预告" in ann.CATEGORIES)
check("三季报在类别表内", "三季报" in ann.CATEGORIES)
check("类别代码格式正确",
      all(v.startswith("category_") for v in ann.CATEGORIES.values()))

# ---------------------------------------------------------------------------
line("2. column 推断")

cases = [("600519", "sse"), ("688008", "sse"), ("000001", "szse"),
         ("300750", "szse"), ("002466", "szse"), ("830799", "bj"),
         ("430047", "bj")]
for code, expect in cases:
    got = ann.column_for(code)
    check("column_for(%s) = %s" % (code, expect), got == expect, "实际 %s" % got)

# ---------------------------------------------------------------------------
line("3. 字段归一化")

raw = {
    "secCode": "600519",
    "secName": "贵州茅台",
    "announcementTitle": "  贵州茅台2026年半年度报告  ",
    "announcementTime": 1786780800000,
    "adjunctUrl": "finalpage/2026-08-15/1225475868.PDF",
    "announcementType": "01010503",
}
norm = ann._normalize(raw)
check("code 保留", norm["code"] == "600519")
check("name 保留", norm["name"] == "贵州茅台")
check("title 去首尾空白", norm["title"] == "贵州茅台2026年半年度报告", repr(norm["title"]))
check("date 由毫秒时间戳转换", norm["date"] == "2026-08-15", norm["date"])
check("pdf 拼接为完整直链",
      norm["pdf"] == "http://static.cninfo.com.cn/finalpage/2026-08-15/1225475868.PDF",
      norm["pdf"])

# 缺字段不应崩
empty = ann._normalize({})
check("空对象不抛异常", empty["code"] is None and empty["pdf"] is None)

# ---------------------------------------------------------------------------
line("4. 日期区间解析")

today = date.today()
a, b = ann._parse_range("2026-10-20~2026-10-21", 7)
check("显式区间", (a, b) == ("2026-10-20", "2026-10-21"), "%s~%s" % (a, b))

a, b = ann._parse_range("2026-10-20", 7)
check("单日期 => 起止相同", a == b == "2026-10-20", "%s~%s" % (a, b))

a, b = ann._parse_range(None, 7)
expect_start = (today - timedelta(days=7)).isoformat()
check("未给日期 => 按天数回推",
      a == expect_start and b == today.isoformat(), "%s~%s" % (a, b))

# ---------------------------------------------------------------------------
line("5. CLI 冒烟")

p = subprocess.run([PY, os.path.join(SCRIPTS, "announcements.py"), "categories"],
                   capture_output=True, text=True)
try:
    doc = json.loads(p.stdout)
    check("categories 命令可执行", doc.get("ok") is True and doc.get("data"))
except ValueError:
    check("categories 命令可执行", False, (p.stderr or p.stdout)[:80])

p = subprocess.run([PY, os.path.join(SCRIPTS, "announcements.py")],
                   capture_output=True, text=True)
check("无参数时打印帮助", p.returncode == 1, "rc=%s" % p.returncode)

# ---------------------------------------------------------------------------
line("6. 联网查询" + ("（offline，跳过）" if OFFLINE else ""))

if OFFLINE:
    skip("全市场查询", "--offline")
    skip("orgId 解析", "--offline")
    skip("按股票查询", "--offline")
else:
    end = date.today()
    start = end - timedelta(days=2)
    res = ann.search_market(start.isoformat(), end.isoformat(), limit=3)
    if not res.get("ok"):
        skip("全市场查询", res.get("error"))
    else:
        check("全市场查询返回数据", res.get("returned", 0) > 0,
              "total=%s returned=%s" % (res.get("total"), res.get("returned")))
        row = (res.get("data") or [{}])[0]
        check("返回行字段齐全",
              bool(row.get("code") and row.get("title") and row.get("pdf")),
              "%s %s" % (row.get("code"), (row.get("title") or "")[:20]))

    orgid, err = ann.resolve_orgid("600519")
    if not orgid:
        skip("orgId 解析", err)
    else:
        check("orgId 解析成功", orgid == "gssh0600519", orgid)

    res2 = ann.search_stock(["600519"], (end - timedelta(days=120)).isoformat(),
                            end.isoformat(), limit=3)
    if not res2.get("data"):
        skip("按股票查询", str(res2.get("errors"))[:60])
    else:
        check("按股票查询返回公告", len(res2["data"]) > 0, "%d 条" % len(res2["data"]))
        check("按股票查询带 PDF 链接",
              all(r.get("pdf") for r in res2["data"]))

    # 类别筛选应该比不筛更少
    res3 = ann.search_market(start.isoformat(), end.isoformat(),
                             category="业绩预告", limit=3)
    if res3.get("ok") and res.get("ok"):
        check("类别筛选生效",
              (res3.get("total") or 0) <= (res.get("total") or 0),
              "业绩预告 %s <= 全部 %s" % (res3.get("total"), res.get("total")))
    else:
        skip("类别筛选生效", "查询失败")

# ---------------------------------------------------------------------------
print("\n" + "=" * 68)
if skipped:
    print("跳过 %d 项：%s" % (len(skipped), "、".join(skipped)))
print("结论：%s" % ("全部通过 ✅" if ok_all else "存在失败项 ❌"))
print("=" * 68)
sys.exit(0 if ok_all else 1)
