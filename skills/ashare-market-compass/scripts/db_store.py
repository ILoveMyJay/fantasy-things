#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
db_store.py - 本地 SQLite 历史库与四态决策台账持久化
用于积累全A宽度/TRIN/MCL、19只宽基ETF份额、期指基差、期权PCR及每日四态决策记录。
"""

import csv
import json
import os
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional

SKILL_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = SKILL_ROOT / "data"
DB_PATH = DATA_DIR / "market_history.sqlite"
LEDGER_CSV_PATH = DATA_DIR / "decision_ledger.csv"


def get_conn(db_path: Optional[Path] = None) -> sqlite3.Connection:
    path = Path(db_path) if db_path else DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    init_schema(conn)
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS daily_breadth (
            trade_date TEXT PRIMARY KEY,
            captured_at TEXT,
            valid_count INTEGER,
            up_count INTEGER,
            down_count INTEGER,
            flat_count INTEGER,
            limit_up INTEGER,
            limit_down INTEGER,
            total_amount_yi REAL,
            up_amount_yi REAL,
            down_amount_yi REAL,
            adv_ratio REAL,
            adv_amt_ratio REAL,
            adv_vol_ratio REAL,
            amt_breadth_spread REAL,
            amt_vol_spread REAL,
            trin_amount REAL,
            trin_volume REAL,
            high_turnover_ratio REAL,
            mcl REAL,
            msi REAL,
            adl REAL,
            adr_10 REAL,
            scenario_tag TEXT
        );

        CREATE TABLE IF NOT EXISTS daily_etf_shares (
            trade_date TEXT NOT NULL,
            etf_code TEXT NOT NULL,
            exchange TEXT,
            name TEXT,
            category TEXT,
            shares_yi REAL,
            nav REAL,
            PRIMARY KEY (trade_date, etf_code)
        );

        CREATE TABLE IF NOT EXISTS daily_cffex_basis (
            trade_date TEXT NOT NULL,
            symbol TEXT NOT NULL,
            contract TEXT,
            futures_price REAL,
            spot_price REAL,
            basis REAL,
            annualized_discount_pct REAL,
            days_to_expiry INTEGER,
            PRIMARY KEY (trade_date, symbol)
        );

        CREATE TABLE IF NOT EXISTS daily_option_pcr (
            trade_date TEXT NOT NULL,
            underlying_code TEXT NOT NULL,
            underlying_name TEXT,
            exchange TEXT,
            call_vol INTEGER,
            put_vol INTEGER,
            vol_pcr REAL,
            call_oi INTEGER,
            put_oi INTEGER,
            oi_pcr REAL,
            PRIMARY KEY (trade_date, underlying_code)
        );

        CREATE TABLE IF NOT EXISTS decision_ledger (
            trade_date TEXT PRIMARY KEY,
            created_at TEXT,
            fund_signal TEXT,
            fund_score REAL,
            tech_signal TEXT,
            tech_weekly TEXT,
            tech_daily TEXT,
            final_state TEXT,
            breadth_tag TEXT,
            trin_amount REAL,
            adv_ratio REAL,
            etf_acc_index REAL,
            erp_zscore REAL,
            if_ann_basis REAL,
            pcr_50 REAL,
            pcr_300 REAL,
            missing_items TEXT,
            notes TEXT,
            raw_json TEXT
        );
        """
    )
    conn.commit()


def upsert_breadth(conn: sqlite3.Connection, row: Dict[str, Any]) -> None:
    cols = [
        "trade_date", "captured_at", "valid_count", "up_count", "down_count", "flat_count",
        "limit_up", "limit_down", "total_amount_yi", "up_amount_yi", "down_amount_yi",
        "adv_ratio", "adv_amt_ratio", "adv_vol_ratio", "amt_breadth_spread", "amt_vol_spread",
        "trin_amount", "trin_volume", "high_turnover_ratio", "mcl", "msi", "adl", "adr_10",
        "scenario_tag",
    ]
    placeholders = ",".join(["?"] * len(cols))
    updates = ",".join([f"{c}=excluded.{c}" for c in cols[1:]])
    sql = (
        f"INSERT INTO daily_breadth ({','.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT(trade_date) DO UPDATE SET {updates}"
    )
    conn.execute(sql, [row.get(c) for c in cols])
    conn.commit()


def fetch_breadth_history(conn: sqlite3.Connection, limit: int = 250) -> List[Dict[str, Any]]:
    cur = conn.execute(
        "SELECT * FROM daily_breadth ORDER BY trade_date DESC LIMIT ?",
        (limit,),
    )
    rows = [dict(r) for r in cur.fetchall()]
    rows.reverse()
    return rows


def upsert_etf_shares(conn: sqlite3.Connection, rows: List[Dict[str, Any]]) -> None:
    sql = (
        "INSERT INTO daily_etf_shares (trade_date, etf_code, exchange, name, category, shares_yi, nav) "
        "VALUES (?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(trade_date, etf_code) DO UPDATE SET "
        "exchange=excluded.exchange, name=excluded.name, category=excluded.category, "
        "shares_yi=excluded.shares_yi, nav=COALESCE(excluded.nav, daily_etf_shares.nav)"
    )
    conn.executemany(
        sql,
        [
            (
                r["trade_date"], r["etf_code"], r.get("exchange"), r.get("name"),
                r.get("category"), r.get("shares_yi"), r.get("nav"),
            )
            for r in rows
        ],
    )
    conn.commit()


def fetch_etf_shares_history(conn: sqlite3.Connection, days: int = 160) -> List[Dict[str, Any]]:
    cur = conn.execute(
        """
        SELECT * FROM daily_etf_shares
        WHERE trade_date IN (
            SELECT DISTINCT trade_date FROM daily_etf_shares ORDER BY trade_date DESC LIMIT ?
        )
        ORDER BY trade_date ASC, etf_code ASC
        """,
        (days,),
    )
    return [dict(r) for r in cur.fetchall()]


def upsert_cffex_basis(conn: sqlite3.Connection, rows: List[Dict[str, Any]]) -> None:
    sql = (
        "INSERT INTO daily_cffex_basis "
        "(trade_date, symbol, contract, futures_price, spot_price, basis, annualized_discount_pct, days_to_expiry) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(trade_date, symbol) DO UPDATE SET "
        "contract=excluded.contract, futures_price=excluded.futures_price, spot_price=excluded.spot_price, "
        "basis=excluded.basis, annualized_discount_pct=excluded.annualized_discount_pct, "
        "days_to_expiry=excluded.days_to_expiry"
    )
    conn.executemany(
        sql,
        [
            (
                r["trade_date"], r["symbol"], r.get("contract"), r.get("futures_price"),
                r.get("spot_price"), r.get("basis"), r.get("annualized_discount_pct"),
                r.get("days_to_expiry"),
            )
            for r in rows
        ],
    )
    conn.commit()


def fetch_cffex_history(conn: sqlite3.Connection, days: int = 30) -> List[Dict[str, Any]]:
    cur = conn.execute(
        """
        SELECT * FROM daily_cffex_basis
        WHERE trade_date IN (
            SELECT DISTINCT trade_date FROM daily_cffex_basis ORDER BY trade_date DESC LIMIT ?
        )
        ORDER BY trade_date ASC, symbol ASC
        """,
        (days,),
    )
    return [dict(r) for r in cur.fetchall()]


def upsert_option_pcr(conn: sqlite3.Connection, rows: List[Dict[str, Any]]) -> None:
    sql = (
        "INSERT INTO daily_option_pcr "
        "(trade_date, underlying_code, underlying_name, exchange, call_vol, put_vol, vol_pcr, call_oi, put_oi, oi_pcr) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(trade_date, underlying_code) DO UPDATE SET "
        "underlying_name=excluded.underlying_name, exchange=excluded.exchange, "
        "call_vol=excluded.call_vol, put_vol=excluded.put_vol, vol_pcr=excluded.vol_pcr, "
        "call_oi=excluded.call_oi, put_oi=excluded.put_oi, oi_pcr=excluded.oi_pcr"
    )
    conn.executemany(
        sql,
        [
            (
                r["trade_date"], r["underlying_code"], r.get("underlying_name"), r.get("exchange"),
                r.get("call_vol"), r.get("put_vol"), r.get("vol_pcr"),
                r.get("call_oi"), r.get("put_oi"), r.get("oi_pcr"),
            )
            for r in rows
        ],
    )
    conn.commit()


def fetch_option_pcr_history(conn: sqlite3.Connection, days: int = 80) -> List[Dict[str, Any]]:
    cur = conn.execute(
        """
        SELECT * FROM daily_option_pcr
        WHERE trade_date IN (
            SELECT DISTINCT trade_date FROM daily_option_pcr ORDER BY trade_date DESC LIMIT ?
        )
        ORDER BY trade_date ASC, underlying_code ASC
        """,
        (days,),
    )
    return [dict(r) for r in cur.fetchall()]


def upsert_decision_ledger(conn: sqlite3.Connection, entry: Dict[str, Any], export_csv: bool = True) -> None:
    cols = [
        "trade_date", "created_at", "fund_signal", "fund_score", "tech_signal",
        "tech_weekly", "tech_daily", "final_state", "breadth_tag", "trin_amount",
        "adv_ratio", "etf_acc_index", "erp_zscore", "if_ann_basis", "pcr_50",
        "pcr_300", "missing_items", "notes", "raw_json",
    ]
    placeholders = ",".join(["?"] * len(cols))
    updates = ",".join([f"{c}=excluded.{c}" for c in cols[1:]])
    sql = (
        f"INSERT INTO decision_ledger ({','.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT(trade_date) DO UPDATE SET {updates}"
    )
    row_copy = dict(entry)
    if isinstance(row_copy.get("missing_items"), list):
        row_copy["missing_items"] = "; ".join(row_copy["missing_items"])
    if isinstance(row_copy.get("raw_json"), (dict, list)):
        row_copy["raw_json"] = json.dumps(row_copy["raw_json"], ensure_ascii=False)
    conn.execute(sql, [row_copy.get(c) for c in cols])
    conn.commit()

    if export_csv:
        export_ledger_csv(conn)


def export_ledger_csv(conn: sqlite3.Connection, csv_path: Optional[Path] = None) -> None:
    target = Path(csv_path) if csv_path else LEDGER_CSV_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    csv_cols = [
        "trade_date", "created_at", "fund_signal", "fund_score", "tech_signal",
        "tech_weekly", "tech_daily", "final_state", "breadth_tag", "trin_amount",
        "adv_ratio", "etf_acc_index", "erp_zscore", "if_ann_basis", "pcr_50",
        "pcr_300", "missing_items", "notes",
    ]
    cur = conn.execute(f"SELECT {','.join(csv_cols)} FROM decision_ledger ORDER BY trade_date DESC")
    rows = cur.fetchall()
    with open(target, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(csv_cols)
        for r in rows:
            writer.writerow([r[c] for c in csv_cols])


def fetch_ledger_recent(conn: sqlite3.Connection, limit: int = 15) -> List[Dict[str, Any]]:
    cur = conn.execute(
        """
        SELECT trade_date, fund_signal, fund_score, tech_signal, tech_weekly, tech_daily,
               final_state, breadth_tag, trin_amount, adv_ratio, etf_acc_index, erp_zscore,
               if_ann_basis, pcr_50, pcr_300, notes
        FROM decision_ledger
        ORDER BY trade_date DESC LIMIT ?
        """,
        (limit,),
    )
    return [dict(r) for r in cur.fetchall()]
