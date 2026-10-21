#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""market_snapshot.py 全命令自测"""
import json
import os
import subprocess
import sys

PY = sys.executable
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(BASE, "scripts", "market_snapshot.py")


def run(*args):
    cmd = [PY, SCRIPT] + list(args) + ["--no-cache"]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0 and not p.stdout.strip():
        return None, "rc=%d stderr=%s" % (p.returncode, p.stderr.strip()[:200])
    try:
        return json.loads(p.stdout), None
    except ValueError as e:
        return None, "JSON 解析失败 %s | out=%s" % (e, p.stdout[:200])


def line(t):
    print("\n" + "=" * 66)
    print(t)
    print("=" * 66)


line("1. tradecal")
d, err = run("tradecal")
if err:
    print("FAIL", err)
else:
    print("today=%s last_trade=%s opened=%s source=%s"
          % (d["today"], d["last_trade_date"], d["market_opened_today"], d["source"]))

line("2. snapshot 中文别名")
d, err = run("snapshot", "上证,深证,创业板")
if err:
    print("FAIL", err)
else:
    print("count=%d source=%s" % (d["count"], d["source"]))
    for r in d["data"]:
        print("  %-6s %-8s 收=%-10s 涨跌幅=%s%%" % (r["code"], r["name"], r["price"], r["pct_chg"]))

line("3. snapshot 20 只批量")
codes = ["600519", "000001", "000002", "601318", "300750", "600036", "002594",
         "601899", "000858", "600030", "300413", "601088", "000983", "600740",
         "002475", "603019", "300308", "600547", "002179", "600760"]
d, err = run("snapshot", ",".join(codes))
if err:
    print("FAIL", err)
else:
    print("请求 %d 只 -> 返回 %d 只, errors=%d" % (len(codes), d["count"], len(d["errors"])))

line("4. kline 60 天")
d, err = run("kline", "600519", "--days", "60")
if err:
    print("FAIL", err)
else:
    print("source=%s count=%d" % (d["source"], d["count"]))
    print("  首 %s" % d["data"][0])
    print("  末 %s" % d["data"][-1])

line("5. kline 320 天（深数据，验证 ifzq host）")
d, err = run("kline", "000001", "--days", "320")
if err:
    print("FAIL", err)
else:
    print("source=%s count=%d 首=%s 末=%s"
          % (d["source"], d["count"], d["data"][0]["date"] if d["data"] else "-",
             d["data"][-1]["date"] if d["data"] else "-"))

line("6. metrics 多只")
d, err = run("metrics", "600519,000001,300750")
if err:
    print("FAIL", err)
else:
    for m in d["data"]:
        print("  %s 收=%s 近5日=%s%% 近20日=%s%% 连板=%s 量比(vs5日均)=%s"
              % (m.get("code"), m.get("last_close"), m.get("pct_5d"),
                 m.get("pct_20d"), m.get("consecutive_limit_up"),
                 m.get("volume_vs_5d_avg")))

line("7. minute 分时")
d, err = run("minute", "sh000001")
if err:
    print("FAIL", err)
else:
    print("count=%d source=%s" % (d["count"], d["source"]))
    print("  首 %s" % d["data"][0])
    print("  末 %s" % d["data"][-1])

line("8. mkline m5")
d, err = run("mkline", "600519", "--period", "m5", "--limit", "6")
if err:
    print("FAIL", err)
else:
    print("count=%d source=%s" % (d["count"], d["source"]))
    print("  末 %s" % (d["data"][-1] if d["data"] else None))

line("9. mkline m1/m15/m30/m60 各取 3 条")
for per in ["m1", "m15", "m30", "m60"]:
    d, err = run("mkline", "600519", "--period", per, "--limit", "3")
    print("  %-4s -> %s" % (per, ("count=%d" % d["count"]) if not err else err))

line("10. fundflow 当日四档")
d, err = run("fundflow", "600519")
if err:
    print("FAIL", err)
else:
    print("ok=%s main_net=%.2f亿 super_large_net=%.2f亿"
          % (d["ok"], d["main_net_yi"], d["super_large_net_yi"]))
    for k, v in d["tiers"].items():
        print("  %-12s 流入=%.2f亿 流出=%.2f亿 净=%.2f亿"
              % (k, v["in"] / 1e8, v["out"] / 1e8, v["net"] / 1e8))

line("11. fundflow-history 60 日")
d, err = run("fundflow-history", "600519", "--days", "60")
if err:
    print("FAIL", err)
else:
    print("count=%d 最新=%s 最早=%s"
          % (d["count"], d["data"][0]["date"], d["data"][-1]["date"]))
    print("  最新一条: %s" % d["data"][0])

line("12. 错误处理：非法代码")
d, err = run("kline", "999999", "--days", "5")
if err:
    print("返回错误信息（预期行为）:", err[:120])
else:
    print("count=%d errors=%s" % (d.get("count"), d.get("errors")))
