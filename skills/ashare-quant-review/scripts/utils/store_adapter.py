# -*- coding: utf-8 -*-
"""
分钟快照存储适配器模块

功能：
  - Parquet 优先（依赖 pyarrow），SQLite 回退（纯标准库 sqlite3）
  - 提供 write_bars(trade_date, rows) 写入分钟 K 线数据
  - 提供 read_bars(symbol, trade_dates) 读取指定标的的分钟 K 线数据
  - 提供 import_seed(seed_path) 从 demo-seed.json 导入种子数据（冷启动）
  - 滚动窗口 60 个交易日，自动清理过期数据

Schema:
  trade_date(str), symbol(str), minute_slot(str), minute_index(int),
  bar_amount(float), cum_amount(float), close_price(float)

设计规范：
  - 使用 pathlib.Path 相对路径定位数据文件
  - 全部注释使用简体中文
  - pyarrow 缺失时优雅降级为 sqlite3
"""

import json
import sqlite3
import logging
from pathlib import Path
from typing import List, Dict, Optional

# 尝试导入 pyarrow，缺失时优雅降级
try:
    import pyarrow as pa
    import pyarrow.parquet as pq
    HAS_PYARROW = True
except ImportError:
    pa = None
    pq = None
    HAS_PYARROW = False

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 路径定义
# ---------------------------------------------------------------------------
# 本文件: scripts/utils/store_adapter.py
# 数据目录: data/
_BASE_DIR = Path(__file__).resolve().parent.parent.parent
_DATA_DIR = _BASE_DIR / "data"

# 存储文件路径
_PARQUET_PATH = _DATA_DIR / "etf_minute_store.parquet"
_SQLITE_PATH = _DATA_DIR / "etf_minute_store.db"

# 滚动窗口大小（交易日数）
_ROLLING_WINDOW = 60

# 分钟快照表结构字段
_SCHEMA_COLUMNS = [
    "trade_date", "symbol", "minute_slot", "minute_index",
    "bar_amount", "cum_amount", "close_price"
]


class MinuteStoreAdapter:
    """
    分钟快照存储适配器

    自动选择存储后端：
      - 优先使用 Parquet（需要 pyarrow）
      - pyarrow 不可用时回退为 SQLite
    """

    def __init__(self):
        """初始化存储适配器，自动探测后端"""
        if HAS_PYARROW:
            self._backend = "parquet"
            logger.info("存储后端: Parquet (pyarrow)")
        else:
            self._backend = "sqlite"
            logger.info("存储后端: SQLite (pyarrow 未安装，优雅降级)")
            self._init_sqlite()

    # -------------------------------------------------------------------
    # SQLite 后端初始化
    # -------------------------------------------------------------------
    def _init_sqlite(self):
        """初始化 SQLite 数据库表结构"""
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(_SQLITE_PATH))
        conn.execute("""
            CREATE TABLE IF NOT EXISTS minute_bars (
                trade_date  TEXT NOT NULL,
                symbol      TEXT NOT NULL,
                minute_slot TEXT NOT NULL,
                minute_index INTEGER NOT NULL,
                bar_amount  REAL NOT NULL,
                cum_amount  REAL NOT NULL,
                close_price REAL NOT NULL,
                PRIMARY KEY (trade_date, symbol, minute_slot)
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_symbol_date
            ON minute_bars (symbol, trade_date)
        """)
        conn.commit()
        conn.close()

    # -------------------------------------------------------------------
    # 写入接口
    # -------------------------------------------------------------------
    def write_bars(self, trade_date: str, rows: List[Dict]) -> int:
        """
        写入分钟 K 线数据

        参数:
            trade_date: 交易日期字符串 'YYYY-MM-DD'
            rows: 分钟记录列表，每条记录为字典，字段参见 _SCHEMA_COLUMNS

        返回:
            int: 成功写入的记录数
        """
        if not rows:
            return 0

        if self._backend == "parquet":
            return self._write_parquet(trade_date, rows)
        else:
            return self._write_sqlite(trade_date, rows)

    def _write_parquet(self, trade_date: str, rows: List[Dict]) -> int:
        """Parquet 后端写入"""
        _DATA_DIR.mkdir(parents=True, exist_ok=True)

        # 构建新数据表
        new_table = pa.table({
            "trade_date": [r.get("trade_date", trade_date) for r in rows],
            "symbol": [r["symbol"] for r in rows],
            "minute_slot": [r["minute_slot"] for r in rows],
            "minute_index": [r["minute_index"] for r in rows],
            "bar_amount": [float(r["bar_amount"]) for r in rows],
            "cum_amount": [float(r["cum_amount"]) for r in rows],
            "close_price": [float(r["close_price"]) for r in rows],
        })

        # 合并已有数据（如果存在）
        if _PARQUET_PATH.exists():
            existing = pq.read_table(str(_PARQUET_PATH))
            # 删除同一交易日的旧数据，防止重复
            mask = pa.compute.not_equal(existing.column("trade_date"), trade_date)
            existing = existing.filter(mask)
            combined = pa.concat_tables([existing, new_table])
        else:
            combined = new_table

        # 执行滚动窗口清理
        combined = self._rolling_clean_parquet(combined)

        # 写入 Parquet 文件
        pq.write_table(combined, str(_PARQUET_PATH), compression="snappy")
        return len(rows)

    def _write_sqlite(self, trade_date: str, rows: List[Dict]) -> int:
        """SQLite 后端写入"""
        conn = sqlite3.connect(str(_SQLITE_PATH))
        try:
            # 删除同一交易日的旧数据
            conn.execute("DELETE FROM minute_bars WHERE trade_date = ?", (trade_date,))

            # 批量插入
            conn.executemany("""
                INSERT INTO minute_bars
                    (trade_date, symbol, minute_slot, minute_index,
                     bar_amount, cum_amount, close_price)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, [
                (
                    r.get("trade_date", trade_date),
                    r["symbol"],
                    r["minute_slot"],
                    r["minute_index"],
                    float(r["bar_amount"]),
                    float(r["cum_amount"]),
                    float(r["close_price"]),
                )
                for r in rows
            ])

            # 执行滚动窗口清理
            self._rolling_clean_sqlite(conn)

            conn.commit()
            return len(rows)
        finally:
            conn.close()

    # -------------------------------------------------------------------
    # 读取接口
    # -------------------------------------------------------------------
    def read_bars(self, symbol: str, trade_dates: List[str]) -> List[Dict]:
        """
        读取指定标的在指定交易日的分钟 K 线数据

        参数:
            symbol: 标的代码，如 '510300.SH'
            trade_dates: 交易日期列表 ['YYYY-MM-DD', ...]

        返回:
            List[Dict]: 分钟记录列表，按 trade_date 和 minute_index 排序
        """
        if not trade_dates:
            return []

        if self._backend == "parquet":
            return self._read_parquet(symbol, trade_dates)
        else:
            return self._read_sqlite(symbol, trade_dates)

    def _read_parquet(self, symbol: str, trade_dates: List[str]) -> List[Dict]:
        """Parquet 后端读取"""
        if not _PARQUET_PATH.exists():
            return []

        table = pq.read_table(str(_PARQUET_PATH))

        # 过滤标的
        mask_symbol = pa.compute.equal(table.column("symbol"), symbol)
        table = table.filter(mask_symbol)

        # 过滤日期
        dates_set = pa.array(trade_dates)
        mask_dates = pa.compute.is_in(table.column("trade_date"), dates_set)
        table = table.filter(mask_dates)

        # 转换为字典列表
        result = table.to_pydict()
        rows = []
        for i in range(len(result.get("trade_date", []))):
            rows.append({col: result[col][i] for col in _SCHEMA_COLUMNS})

        # 按日期和分钟序号排序
        rows.sort(key=lambda r: (r["trade_date"], r["minute_index"]))
        return rows

    def _read_sqlite(self, symbol: str, trade_dates: List[str]) -> List[Dict]:
        """SQLite 后端读取"""
        if not _SQLITE_PATH.exists():
            return []

        conn = sqlite3.connect(str(_SQLITE_PATH))
        try:
            placeholders = ",".join("?" for _ in trade_dates)
            cursor = conn.execute(f"""
                SELECT trade_date, symbol, minute_slot, minute_index,
                       bar_amount, cum_amount, close_price
                FROM minute_bars
                WHERE symbol = ? AND trade_date IN ({placeholders})
                ORDER BY trade_date, minute_index
            """, [symbol] + trade_dates)

            rows = []
            for row in cursor:
                rows.append({
                    "trade_date": row[0],
                    "symbol": row[1],
                    "minute_slot": row[2],
                    "minute_index": row[3],
                    "bar_amount": row[4],
                    "cum_amount": row[5],
                    "close_price": row[6],
                })
            return rows
        finally:
            conn.close()

    # -------------------------------------------------------------------
    # 滚动窗口清理
    # -------------------------------------------------------------------
    def _rolling_clean_parquet(self, table) -> "pa.Table":
        """Parquet 滚动窗口清理：只保留最近 _ROLLING_WINDOW 个交易日"""
        dates = sorted(set(table.column("trade_date").to_pylist()))
        if len(dates) <= _ROLLING_WINDOW:
            return table

        # 只保留最近 N 个交易日
        keep_dates = set(dates[-_ROLLING_WINDOW:])
        keep_array = pa.array(list(keep_dates))
        mask = pa.compute.is_in(table.column("trade_date"), keep_array)
        return table.filter(mask)

    def _rolling_clean_sqlite(self, conn):
        """SQLite 滚动窗口清理：只保留最近 _ROLLING_WINDOW 个交易日"""
        cursor = conn.execute("""
            SELECT DISTINCT trade_date FROM minute_bars
            ORDER BY trade_date DESC
        """)
        dates = [row[0] for row in cursor]

        if len(dates) > _ROLLING_WINDOW:
            # 删除超出窗口的旧数据
            cutoff_date = dates[_ROLLING_WINDOW - 1]
            conn.execute(
                "DELETE FROM minute_bars WHERE trade_date < ?",
                (cutoff_date,)
            )

    # -------------------------------------------------------------------
    # 种子数据导入（冷启动）
    # -------------------------------------------------------------------
    def import_seed(self, seed_path: Optional[str] = None) -> int:
        """
        从种子 JSON 文件导入历史分钟数据（冷启动用）

        参数:
            seed_path: 种子文件路径，默认为 data/demo-seed.json

        返回:
            int: 导入的总记录数
        """
        if seed_path is None:
            seed_path = _DATA_DIR / "demo-seed.json"
        else:
            seed_path = Path(seed_path)

        if not seed_path.exists():
            logger.warning(f"种子文件不存在: {seed_path}")
            return 0

        with open(seed_path, "r", encoding="utf-8") as f:
            seed_data = json.load(f)

        total = 0

        # 种子数据格式兼容：支持按交易日分组或扁平列表
        if isinstance(seed_data, dict) and "bars" in seed_data:
            # 格式: {"bars": [{"trade_date": ..., "symbol": ..., ...}, ...]}
            bars = seed_data["bars"]
            # 按交易日分组写入
            grouped = {}
            for bar in bars:
                td = bar.get("trade_date", "unknown")
                grouped.setdefault(td, []).append(bar)
            for td, rows in grouped.items():
                total += self.write_bars(td, rows)
        elif isinstance(seed_data, dict):
            # 格式: {"2026-01-05": [rows...], ...} 按日期分组
            for td, rows in seed_data.items():
                if isinstance(rows, list):
                    total += self.write_bars(td, rows)
        elif isinstance(seed_data, list):
            # 格式: [{"trade_date": ..., ...}, ...] 扁平列表
            grouped = {}
            for bar in seed_data:
                td = bar.get("trade_date", "unknown")
                grouped.setdefault(td, []).append(bar)
            for td, rows in grouped.items():
                total += self.write_bars(td, rows)

        logger.info(f"种子数据导入完成: {total} 条记录")
        return total

    # -------------------------------------------------------------------
    # 辅助方法
    # -------------------------------------------------------------------
    @property
    def backend(self) -> str:
        """返回当前使用的存储后端名称"""
        return self._backend

    def count_records(self) -> int:
        """返回存储中的总记录数"""
        if self._backend == "parquet":
            if not _PARQUET_PATH.exists():
                return 0
            table = pq.read_table(str(_PARQUET_PATH))
            return table.num_rows
        else:
            if not _SQLITE_PATH.exists():
                return 0
            conn = sqlite3.connect(str(_SQLITE_PATH))
            try:
                cursor = conn.execute("SELECT COUNT(*) FROM minute_bars")
                return cursor.fetchone()[0]
            finally:
                conn.close()

    def list_trade_dates(self) -> List[str]:
        """返回存储中所有交易日列表（已排序）"""
        if self._backend == "parquet":
            if not _PARQUET_PATH.exists():
                return []
            table = pq.read_table(str(_PARQUET_PATH))
            return sorted(set(table.column("trade_date").to_pylist()))
        else:
            if not _SQLITE_PATH.exists():
                return []
            conn = sqlite3.connect(str(_SQLITE_PATH))
            try:
                cursor = conn.execute(
                    "SELECT DISTINCT trade_date FROM minute_bars ORDER BY trade_date"
                )
                return [row[0] for row in cursor]
            finally:
                conn.close()
