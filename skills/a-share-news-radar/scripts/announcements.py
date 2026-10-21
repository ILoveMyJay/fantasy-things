#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""巨潮资讯公告检索 —— 给「公告确认」这个最硬的证据标签提供数据通道。

SKILL.md 要求「公告确认」只能来自交易所披露，但此前没有自动通道，全靠
web_search 撞。本脚本把这条路打通：全市场按日期+类别扫，或按股票查历史公告。

用法：
    python3 announcements.py categories
    python3 announcements.py search --date 2026-10-20~2026-10-21 --category 业绩预告
    python3 announcements.py search --date 2026-10-20 --limit 30
    python3 announcements.py stock 600519 --days 30 --limit 20
    python3 announcements.py stock 600519,300750 --days 7

输出为 JSON。每条含 secCode / secName / title / date / url（PDF 直链）。
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(BASE_DIR, "cache")

QUERY_URL = "http://www.cninfo.com.cn/new/hisAnnouncement/query"
SEARCH_URL = "http://www.cninfo.com.cn/new/information/topSearch/query"
PDF_BASE = "http://static.cninfo.com.cn/"

HEADERS = {
    "User-Agent": UA,
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate",
    "Referer": "http://www.cninfo.com.cn/new/commonUrl?url=disclosure/list/notice",
    "Origin": "http://www.cninfo.com.cn",
    "X-Requested-With": "XMLHttpRequest",
}

# 巨潮的公告类别代码
CATEGORIES = {
    "年度报告": "category_ndbg_szsh",
    "半年度报告": "category_bndbg_szsh",
    "一季报": "category_yjdbg_szsh",
    "三季报": "category_sjdbg_szsh",
    "业绩预告": "category_yjygjxz_szsh",
    "业绩快报": "category_yjkb_szsh",
    "股权变动": "category_gqbd_szsh",
    "增发": "category_zf_szsh",
    "配股": "category_pg_szsh",
    "公司债": "category_gszq_szsh",
    "日常经营": "category_rcjy_szsh",
    "公司治理": "category_gszl_szsh",
    "董事会": "category_dshgg_szsh",
    "监事会": "category_jshgg_szsh",
    "股东大会": "category_gddh_szsh",
    "澄清致歉": "category_cqdq_szsh",
    "风险提示": "category_fxts_szsh",
    "特别处理与退市": "category_tbclts_szsh",
    "补充更正": "category_bcgz_szsh",
    "中介报告": "category_zj_szsh",
}

DEFAULT_TIMEOUT = 15
RETRIES = 2


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

def _decode(raw):
    if raw[:2] == b"\x1f\x8b":
        try:
            raw = gzip.decompress(raw)
        except OSError:
            pass
    return raw.decode("utf-8", "replace")


def http_post(url, data, timeout=DEFAULT_TIMEOUT):
    body = urllib.parse.urlencode(data).encode()
    last = None
    for attempt in range(RETRIES + 1):
        req = urllib.request.Request(url, data=body, headers=HEADERS)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return _decode(resp.read()), None
        except Exception as exc:  # noqa: BLE001
            last = "%s: %s" % (type(exc).__name__, str(exc)[:110])
            if attempt < RETRIES:
                import time
                time.sleep(0.6 * (attempt + 1))
    return None, last


# ---------------------------------------------------------------------------
# orgId 解析（巨潮按股票查公告必须带 orgId）
# ---------------------------------------------------------------------------

def _orgid_cache_path():
    return os.path.join(CACHE_DIR, "cninfo-orgid.json")


def load_orgid_cache():
    try:
        with open(_orgid_cache_path(), "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def save_orgid_cache(mapping):
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(_orgid_cache_path(), "w", encoding="utf-8") as fh:
            json.dump(mapping, fh, ensure_ascii=False, indent=1)
    except OSError:
        pass


def resolve_orgid(code):
    """把 6 位代码解析成巨潮 orgId。带本地缓存。"""
    cache = load_orgid_cache()
    if code in cache:
        return cache[code], None

    txt, err = http_post(SEARCH_URL, {"keyWord": code, "maxNum": 10})
    if txt is None:
        return None, "orgId 查询失败: %s" % err
    try:
        arr = json.loads(txt)
    except ValueError as exc:
        return None, "orgId 响应解析失败: %s" % exc
    for item in arr or []:
        if str(item.get("code")) == code and item.get("orgId"):
            cache[code] = item["orgId"]
            save_orgid_cache(cache)
            return item["orgId"], None
    return None, "未找到 %s 的 orgId（代码可能不存在或非 A 股）" % code


def column_for(code):
    """按代码前缀判断巨潮的 column 参数。"""
    if code.startswith("6"):
        return "sse"
    if code.startswith(("0", "3")):
        return "szse"
    if code.startswith(("4", "8", "9")):
        return "bj"
    return "szse"


# ---------------------------------------------------------------------------
# 查询
# ---------------------------------------------------------------------------

def _normalize(item):
    ts = item.get("announcementTime")
    when = None
    if isinstance(ts, (int, float)) and ts > 0:
        when = datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")
    adj = item.get("adjunctUrl") or ""
    return {
        "code": item.get("secCode"),
        "name": item.get("secName"),
        "title": (item.get("announcementTitle") or "").strip(),
        "date": when,
        "pdf": (PDF_BASE + adj) if adj else None,
        "type": item.get("announcementType"),
    }


def _query(params, limit):
    txt, err = http_post(QUERY_URL, params)
    if txt is None:
        return None, err
    try:
        doc = json.loads(txt)
    except ValueError as exc:
        return None, "响应解析失败: %s" % exc
    anns = doc.get("announcements") or []
    rows = [_normalize(a) for a in anns[:limit]]
    return {
        "total": doc.get("totalAnnouncement"),
        "returned": len(rows),
        "data": rows,
    }, None


def search_market(start, end, category=None, limit=30, page=1):
    """全市场按日期区间（可加类别）扫公告。"""
    params = {
        "pageNum": page,
        "pageSize": min(max(limit, 1), 30),
        "tabName": "fulltext",
        "column": "szse",          # 实测该值可返回全市场（含科创板）
        "plate": "",
        "stock": "",
        "searchkey": "",
        "secid": "",
        "category": CATEGORIES.get(category, category) or "",
        "trade": "",
        "seDate": "%s~%s" % (start, end),
        "sortName": "",
        "sortType": "",
        "isHLtitle": "true",
    }
    res, err = _query(params, limit)
    if res is None:
        return {"ok": False, "error": err}
    res.update({"ok": True, "source": "cninfo-hisAnnouncement",
                "range": "%s~%s" % (start, end),
                "category": category or "全部"})
    return res


def search_stock(codes, start, end, category=None, limit=20):
    """按股票查公告。多只股票会逐只查询后合并。"""
    out, errors = [], []
    for code in codes:
        code = str(code).strip()
        if not code:
            continue
        orgid, err = resolve_orgid(code)
        if not orgid:
            errors.append({"code": code, "error": err})
            continue
        params = {
            "pageNum": 1,
            "pageSize": min(max(limit, 1), 30),
            "tabName": "fulltext",
            "column": column_for(code),
            "plate": "",
            "stock": "%s,%s" % (code, orgid),
            "searchkey": "",
            "secid": "",
            "category": CATEGORIES.get(category, category) or "",
            "trade": "",
            "seDate": "%s~%s" % (start, end),
            "sortName": "",
            "sortType": "",
            "isHLtitle": "true",
        }
        res, err = _query(params, limit)
        if res is None:
            errors.append({"code": code, "error": err})
            continue
        for row in res["data"]:
            row["query_code"] = code
            out.append(row)

    out.sort(key=lambda r: (r.get("date") or ""), reverse=True)
    return {
        "ok": bool(out) or not errors,
        "source": "cninfo-hisAnnouncement",
        "range": "%s~%s" % (start, end),
        "category": category or "全部",
        "count": len(out),
        "data": out,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _parse_range(value, days):
    """支持 '2026-10-20' 或 '2026-10-20~2026-10-21'；只给一个日期时按 days 回推。"""
    today = date.today()
    if value:
        if "~" in value:
            a, b = value.split("~", 1)
            return a.strip(), b.strip()
        return value.strip(), value.strip()
    return (today - timedelta(days=days)).isoformat(), today.isoformat()


def main(argv=None):
    parser = argparse.ArgumentParser(description="巨潮公告检索")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--pretty", action="store_true")
    common.add_argument("--limit", type=int, default=30)
    common.add_argument("--category", default=None, help="中文类别名或巨潮代码")
    common.add_argument("--date", default=None, help="YYYY-MM-DD 或 A~B")
    common.add_argument("--days", type=int, default=7, help="未给 --date 时回看天数")
    sub = parser.add_subparsers(dest="cmd")

    sub.add_parser("categories", parents=[common], help="列出可用公告类别")

    p = sub.add_parser("search", parents=[common], help="全市场按日期/类别扫")
    p.add_argument("--page", type=int, default=1)

    p = sub.add_parser("stock", parents=[common], help="按股票查公告")
    p.add_argument("codes", help="逗号分隔，如 600519,300750")

    args = parser.parse_args(argv)
    if not args.cmd:
        parser.print_help()
        return 1

    if args.cmd == "categories":
        out = {"ok": True, "data": CATEGORIES}
    elif args.cmd == "search":
        start, end = _parse_range(args.date, args.days)
        out = search_market(start, end, args.category, args.limit, args.page)
    elif args.cmd == "stock":
        start, end = _parse_range(args.date, args.days)
        codes = [c.strip() for c in args.codes.replace("，", ",").split(",") if c.strip()]
        out = search_stock(codes, start, end, args.category, args.limit)
    else:
        parser.print_help()
        return 1

    print(json.dumps(out, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0 if out.get("ok") else 2


if __name__ == "__main__":
    sys.exit(main())
