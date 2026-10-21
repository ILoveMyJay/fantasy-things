#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""决策快照落库（SQLite）—— 替代 Supabase。

设计要点：
- 只存「决策」，不存行情。行情随时可从 market_snapshot.py 回补，
  但「当时推了哪只、什么理由、什么证据标签、什么置信度」无法回溯。
- 三张主表：radar_reports（报告）/ radar_candidates（候选股）/ radar_reviews（T+N 回看）
- 一张运行日志：radar_runs（耗时、搜索次数、事件数、lint 结果）

用法：
    python3 db.py init
    python3 db.py save --trade-date 2026-10-20 --phase phase2 --body-file report.md --candidates cand.json
    python3 db.py list --limit 10
    python3 db.py show --trade-date 2026-10-20 --phase phase2
    python3 db.py pending --horizon 5
    python3 db.py review --horizon 5
    python3 db.py stats
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "radar.db")

DIRECTION_ALIASES = {
    "正面": "正面", "✅正面": "正面", "✅": "正面", "positive": "正面",
    "负面": "负面", "⚠️负面": "负面", "⚠": "负面", "negative": "负面",
    "中性观察": "中性观察", "👀中性观察": "中性观察", "👀": "中性观察",
    "中性": "中性观察", "neutral": "中性观察",
}

EVIDENCE_LABELS = {"公告确认", "业务归属", "产业链推断", "情绪映射", "负面暴露", "剔除"}
GROUPS = {"direct", "indirect", "watch_verify", "possible_losers", "removed"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS radar_reports (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_date      TEXT NOT NULL,
    phase           TEXT NOT NULL,
    run_at          TEXT NOT NULL,
    market_opened   INTEGER,
    index_snapshot  TEXT,
    event_count     INTEGER DEFAULT 0,
    candidate_count INTEGER DEFAULT 0,
    lint_status     TEXT DEFAULT 'unknown',
    body            TEXT,
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(trade_date, phase)
);

CREATE TABLE IF NOT EXISTS radar_candidates (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id      INTEGER NOT NULL REFERENCES radar_reports(id) ON DELETE CASCADE,
    trade_date     TEXT NOT NULL,
    ticker         TEXT NOT NULL,
    name           TEXT,
    group_name     TEXT,
    direction      TEXT,
    evidence_label TEXT,
    source_quality TEXT,
    confidence     TEXT,
    reason         TEXT,
    event_title    TEXT,
    base_close     REAL,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cand_date ON radar_candidates(trade_date);
CREATE INDEX IF NOT EXISTS idx_cand_ticker ON radar_candidates(ticker);

CREATE TABLE IF NOT EXISTS radar_reviews (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id   INTEGER NOT NULL REFERENCES radar_candidates(id) ON DELETE CASCADE,
    review_date    TEXT NOT NULL,
    horizon        INTEGER NOT NULL,
    close_at_review REAL,
    pct_change     REAL,
    hit            INTEGER,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(candidate_id, horizon)
);

CREATE TABLE IF NOT EXISTS radar_runs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_date     TEXT,
    phase          TEXT,
    started_at     TEXT,
    finished_at    TEXT,
    duration_ms    INTEGER,
    search_calls   INTEGER,
    event_count    INTEGER,
    candidate_count INTEGER,
    lint_status    TEXT,
    status         TEXT,
    error          TEXT,
    created_at     TEXT DEFAULT CURRENT_TIMESTAMP
);
"""


# ----------------------------------------------------------------------------
# 连接与初始化
# ----------------------------------------------------------------------------

def connect(path=None):
    db = path or DB_PATH
    os.makedirs(os.path.dirname(db), exist_ok=True)
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(path=None):
    conn = connect(path)
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()
    return path or DB_PATH


# ----------------------------------------------------------------------------
# 规范化
# ----------------------------------------------------------------------------

def norm_ticker(raw):
    """统一成 6 位数字代码，便于回看时再转腾讯格式。"""
    s = str(raw or "").strip()
    if not s:
        return ""
    s = s.upper()
    for suffix in (".SH", ".SZ", ".BJ"):
        if s.endswith(suffix):
            return s[: -len(suffix)]
    s = s.lower()
    if s[:2] in ("sh", "sz", "bj"):
        return s[2:]
    return s


def norm_direction(raw):
    if not raw:
        return None
    s = str(raw).strip()
    return DIRECTION_ALIASES.get(s, DIRECTION_ALIASES.get(s.lower(), s))


def norm_group(raw):
    s = str(raw or "").strip().lower()
    alias = {
        "direct": "direct", "直接受益": "direct", "direct_benefit": "direct",
        "indirect": "indirect", "间接受益": "indirect", "indirect_benefit": "indirect",
        "watch": "watch_verify", "watch_verify": "watch_verify",
        "观察核实": "watch_verify", "verify": "watch_verify",
        "possible_losers": "possible_losers", "可能受损": "possible_losers",
        "losers": "possible_losers", "negative": "possible_losers",
        "removed": "removed", "剔除": "removed",
    }
    return alias.get(s, "watch_verify")


# ----------------------------------------------------------------------------
# 写入
# ----------------------------------------------------------------------------

def save_report(trade_date, phase, body, candidates=None, index_snapshot=None,
                market_opened=None, lint_status="unknown", event_count=None,
                path=None):
    """保存一份报告及其候选池。同一 (trade_date, phase) 重复保存会覆盖。"""
    conn = connect(path)
    try:
        candidates = candidates or []
        if event_count is None:
            event_count = 0
            if isinstance(index_snapshot, dict):
                event_count = int(index_snapshot.get("event_count") or 0)

        conn.execute(
            "INSERT INTO radar_reports "
            "(trade_date, phase, run_at, market_opened, index_snapshot, event_count,"
            " candidate_count, lint_status, body) "
            "VALUES (?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(trade_date, phase) DO UPDATE SET "
            "  run_at=excluded.run_at, market_opened=excluded.market_opened,"
            "  index_snapshot=excluded.index_snapshot, event_count=excluded.event_count,"
            "  candidate_count=excluded.candidate_count, lint_status=excluded.lint_status,"
            "  body=excluded.body",
            (
                trade_date, phase, datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                1 if market_opened else (0 if market_opened is False else None),
                json.dumps(index_snapshot, ensure_ascii=False) if index_snapshot else None,
                event_count, len(candidates), lint_status, body,
            ),
        )
        row = conn.execute(
            "SELECT id FROM radar_reports WHERE trade_date=? AND phase=?",
            (trade_date, phase)).fetchone()
        report_id = row["id"]

        # 覆盖式：先删旧候选再插入
        conn.execute("DELETE FROM radar_candidates WHERE report_id=?", (report_id,))

        for c in candidates:
            ticker = norm_ticker(c.get("ticker") or c.get("code"))
            if not ticker:
                continue
            conn.execute(
                "INSERT INTO radar_candidates "
                "(report_id, trade_date, ticker, name, group_name, direction,"
                " evidence_label, source_quality, confidence, reason, event_title, base_close) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    report_id, trade_date, ticker,
                    c.get("name") or "", norm_group(c.get("group") or c.get("group_name")),
                    norm_direction(c.get("direction")),
                    c.get("evidence_label") or "",
                    (c.get("source_quality") or "").upper() or None,
                    c.get("confidence") or "",
                    c.get("reason") or "", c.get("event_title") or "",
                    c.get("base_close"),
                ),
            )
        conn.commit()
        return {"ok": True, "report_id": report_id,
                "candidates": len(candidates), "trade_date": trade_date, "phase": phase}
    finally:
        conn.close()


def log_run(trade_date, phase, started_at, duration_ms=None, search_calls=None,
            event_count=None, candidate_count=None, lint_status=None,
            status="ok", error=None, path=None):
    conn = connect(path)
    try:
        conn.execute(
            "INSERT INTO radar_runs (trade_date, phase, started_at, finished_at, duration_ms,"
            " search_calls, event_count, candidate_count, lint_status, status, error) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (trade_date, phase, started_at, datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
             duration_ms, search_calls, event_count, candidate_count,
             lint_status, status, error))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


# ----------------------------------------------------------------------------
# 查询
# ----------------------------------------------------------------------------

def list_reports(limit=20, path=None):
    conn = connect(path)
    try:
        rows = conn.execute(
            "SELECT id, trade_date, phase, run_at, market_opened, event_count,"
            " candidate_count, lint_status FROM radar_reports "
            "ORDER BY trade_date DESC, phase LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_report(trade_date, phase, path=None):
    conn = connect(path)
    try:
        rep = conn.execute(
            "SELECT * FROM radar_reports WHERE trade_date=? AND phase=?",
            (trade_date, phase)).fetchone()
        if not rep:
            return None
        cands = conn.execute(
            "SELECT * FROM radar_candidates WHERE report_id=? ORDER BY group_name, id",
            (rep["id"],)).fetchall()
        out = dict(rep)
        out["candidates"] = [dict(c) for c in cands]
        return out
    finally:
        conn.close()


def pending_reviews(horizon=5, path=None):
    """找出已过 horizon 个交易日、但还没回看的候选。"""
    conn = connect(path)
    try:
        rows = conn.execute(
            "SELECT c.id, c.trade_date, c.ticker, c.name, c.direction,"
            " c.evidence_label, c.source_quality, c.confidence, c.base_close "
            "FROM radar_candidates c "
            "LEFT JOIN radar_reviews r ON r.candidate_id=c.id AND r.horizon=? "
            "WHERE r.id IS NULL AND c.evidence_label != '剔除' "
            "ORDER BY c.trade_date, c.ticker", (horizon,)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def save_review(candidate_id, review_date, horizon, close_at_review, pct_change,
                hit, path=None):
    conn = connect(path)
    try:
        conn.execute(
            "INSERT INTO radar_reviews (candidate_id, review_date, horizon,"
            " close_at_review, pct_change, hit) VALUES (?,?,?,?,?,?) "
            "ON CONFLICT(candidate_id, horizon) DO UPDATE SET "
            " review_date=excluded.review_date, close_at_review=excluded.close_at_review,"
            " pct_change=excluded.pct_change, hit=excluded.hit",
            (candidate_id, review_date, horizon, close_at_review, pct_change, hit))
        conn.commit()
        return True
    finally:
        conn.close()


def stats(path=None):
    """按证据标签 / 方向统计命中率。"""
    conn = connect(path)
    try:
        by_label = conn.execute(
            "SELECT c.evidence_label AS label, COUNT(*) AS n,"
            " SUM(CASE WHEN r.hit=1 THEN 1 ELSE 0 END) AS hits,"
            " ROUND(AVG(r.pct_change),2) AS avg_pct "
            "FROM radar_candidates c JOIN radar_reviews r ON r.candidate_id=c.id "
            "WHERE r.hit IS NOT NULL GROUP BY c.evidence_label ORDER BY n DESC").fetchall()
        by_direction = conn.execute(
            "SELECT c.direction AS direction, COUNT(*) AS n,"
            " SUM(CASE WHEN r.hit=1 THEN 1 ELSE 0 END) AS hits,"
            " ROUND(AVG(r.pct_change),2) AS avg_pct "
            "FROM radar_candidates c JOIN radar_reviews r ON r.candidate_id=c.id "
            "WHERE r.hit IS NOT NULL GROUP BY c.direction ORDER BY n DESC").fetchall()
        overall = conn.execute(
            "SELECT COUNT(*) AS reviewed, SUM(CASE WHEN hit=1 THEN 1 ELSE 0 END) AS hits,"
            " ROUND(AVG(pct_change),2) AS avg_pct FROM radar_reviews "
            "WHERE hit IS NOT NULL").fetchone()

        def pct(h, n):
            return round(h * 100.0 / n, 1) if n else None

        return {
            "overall": {
                "reviewed": overall["reviewed"] or 0,
                "hits": overall["hits"] or 0,
                "hit_rate": pct(overall["hits"] or 0, overall["reviewed"] or 0),
                "avg_pct": overall["avg_pct"],
            },
            "by_evidence_label": [
                {"label": r["label"], "n": r["n"], "hits": r["hits"],
                 "hit_rate": pct(r["hits"] or 0, r["n"]), "avg_pct": r["avg_pct"]}
                for r in by_label],
            "by_direction": [
                {"direction": r["direction"], "n": r["n"], "hits": r["hits"],
                 "hit_rate": pct(r["hits"] or 0, r["n"]), "avg_pct": r["avg_pct"]}
                for r in by_direction],
        }
    finally:
        conn.close()


# ----------------------------------------------------------------------------
# T+N 回看
# ----------------------------------------------------------------------------

def run_reviews(horizon=5, dry_run=False, path=None):
    """用 market_snapshot 的日K 计算 T+horizon 涨跌幅与命中。"""
    import market_snapshot as ms

    pend = pending_reviews(horizon, path=path)
    done, skipped, errors = [], [], []
    for p in pend:
        try:
            res = ms.fetch_kline(p["ticker"], days=90)
        except Exception as exc:  # noqa: BLE001
            errors.append({"ticker": p["ticker"], "error": str(exc)[:100]})
            continue
        bars = res.get("data") or []
        dates = [b["date"] for b in bars]
        if p["trade_date"] not in dates:
            skipped.append({"ticker": p["ticker"], "reason": "K线中无报告日"})
            continue
        idx = dates.index(p["trade_date"])
        target = idx + horizon
        if target >= len(bars):
            skipped.append({"ticker": p["ticker"],
                            "reason": "尚未满 %d 个交易日" % horizon})
            continue
        close0 = bars[idx]["close"]
        close1 = bars[target]["close"]
        if not close0 or not close1:
            skipped.append({"ticker": p["ticker"], "reason": "收盘价缺失"})
            continue
        pct = round((close1 - close0) / close0 * 100, 2)

        direction = p["direction"]
        if direction == "正面":
            hit = 1 if pct > 0 else 0
        elif direction == "负面":
            hit = 1 if pct < 0 else 0
        else:
            hit = None  # 中性观察不计命中

        item = {
            "ticker": p["ticker"], "name": p["name"],
            "trade_date": p["trade_date"], "review_date": bars[target]["date"],
            "direction": direction, "pct_change": pct, "hit": hit,
        }
        if not dry_run:
            save_review(p["id"], bars[target]["date"], horizon, close1, pct, hit, path=path)
        done.append(item)

    return {"ok": True, "horizon": horizon, "dry_run": dry_run,
            "reviewed": len(done), "skipped": len(skipped),
            "errors": errors, "skipped_detail": skipped, "data": done}


# ----------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------

def _load_json_arg(value, is_file_hint):
    """支持直接传 JSON 字符串或 @文件路径。"""
    if value is None:
        return None
    if value.startswith("@"):
        with open(value[1:], "r", encoding="utf-8") as fh:
            return json.load(fh)
    return json.loads(value)


def main(argv=None):
    parser = argparse.ArgumentParser(description="决策快照落库（SQLite）")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--pretty", action="store_true")
    common.add_argument("--db", default=None, help="自定义 db 路径")
    sub = parser.add_subparsers(dest="cmd")

    sub.add_parser("init", parents=[common], help="建表")

    p = sub.add_parser("save", parents=[common], help="保存报告")
    p.add_argument("--trade-date", required=True)
    p.add_argument("--phase", required=True, choices=["phase1", "phase2", "mixed"])
    p.add_argument("--body-file", default=None)
    p.add_argument("--body", default=None)
    p.add_argument("--candidates", default=None, help="JSON 字符串或 @文件")
    p.add_argument("--index-snapshot", default=None, help="JSON 字符串或 @文件")
    p.add_argument("--market-opened", action="store_true")
    p.add_argument("--event-count", type=int, default=None)
    p.add_argument("--lint-status", default="unknown")

    p = sub.add_parser("list", parents=[common], help="列出报告")
    p.add_argument("--limit", type=int, default=20)

    p = sub.add_parser("show", parents=[common], help="查看某份报告")
    p.add_argument("--trade-date", required=True)
    p.add_argument("--phase", required=True, choices=["phase1", "phase2", "mixed"])

    p = sub.add_parser("pending", parents=[common], help="待回看候选")
    p.add_argument("--horizon", type=int, default=5)

    p = sub.add_parser("review", parents=[common], help="执行 T+N 回看")
    p.add_argument("--horizon", type=int, default=5)
    p.add_argument("--dry-run", action="store_true")

    sub.add_parser("stats", parents=[common], help="命中率统计")

    p = sub.add_parser("log-run", parents=[common], help="记录一次运行")
    p.add_argument("--trade-date", required=True)
    p.add_argument("--phase", required=True)
    p.add_argument("--started-at", required=True)
    p.add_argument("--duration-ms", type=int, default=None)
    p.add_argument("--search-calls", type=int, default=None)
    p.add_argument("--event-count", type=int, default=None)
    p.add_argument("--candidate-count", type=int, default=None)
    p.add_argument("--lint-status", default=None)
    p.add_argument("--status", default="ok")
    p.add_argument("--error", default=None)

    args = parser.parse_args(argv)
    if not args.cmd:
        parser.print_help()
        return 1

    if args.cmd == "init":
        out = {"ok": True, "db": init_db(args.db)}
    elif args.cmd == "save":
        body = args.body
        if args.body_file:
            with open(args.body_file, "r", encoding="utf-8") as fh:
                body = fh.read()
        out = save_report(
            args.trade_date, args.phase, body or "",
            candidates=_load_json_arg(args.candidates, True) or [],
            index_snapshot=_load_json_arg(args.index_snapshot, True),
            market_opened=args.market_opened, lint_status=args.lint_status,
            event_count=args.event_count, path=args.db)
    elif args.cmd == "list":
        out = {"ok": True, "data": list_reports(args.limit, path=args.db)}
    elif args.cmd == "show":
        rep = get_report(args.trade_date, args.phase, path=args.db)
        out = {"ok": rep is not None, "data": rep}
    elif args.cmd == "pending":
        out = {"ok": True, "horizon": args.horizon,
               "data": pending_reviews(args.horizon, path=args.db)}
    elif args.cmd == "review":
        out = run_reviews(args.horizon, args.dry_run, path=args.db)
    elif args.cmd == "stats":
        out = {"ok": True, "data": stats(path=args.db)}
    elif args.cmd == "log-run":
        out = log_run(args.trade_date, args.phase, args.started_at, args.duration_ms,
                      args.search_calls, args.event_count, args.candidate_count,
                      args.lint_status, args.status, args.error, path=args.db)
    else:
        parser.print_help()
        return 1

    print(json.dumps(out, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0


if __name__ == "__main__":
    sys.exit(main())
