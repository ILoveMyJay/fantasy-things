#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_macro.py — 看板 1：外围宏观流动性指标与中美利差雷达

修复要点（融合版）：
  1. 彻底删除全部硬编码伪造兜底值（5.01/1.63/6.66/102.2）
  2. 新浪主选 + 东财备选双源轮询
  3. 任何数据源失败时返回 None，打印 [WARN] 日志，严禁伪造数字
  4. FOMC 日历改为读取 references/fomc_calendar.json 配置文件
"""

import urllib.request
import json
import datetime
import sys
from pathlib import Path

# 项目根目录定位（scripts/ 上一级即 ashare-quant-review/）
BASE_DIR = Path(__file__).resolve().parent.parent
REFERENCES_DIR = BASE_DIR / "references"


# ---------------------------------------------------------------------------
#  利率获取：新浪主选 + 东财备选
# ---------------------------------------------------------------------------

def _fetch_sina_yield(symbol_key):
    """
    通过新浪财经外围接口获取利率数据

    参数:
        symbol_key: 'US10Y' 或 'CN10Y'
    返回:
        float 或 None
    """
    # 新浪外围债券接口映射
    sina_map = {
        'US10Y': 'hf_USDTB10Y',   # 新浪美债10年
        'CN10Y': 'hf_CNTB10Y',    # 新浪中债10年（备注：实际符号可能因新浪接口调整而变化）
    }
    sina_symbol = sina_map.get(symbol_key)
    if not sina_symbol:
        return None

    try:
        url = f'https://hq.sinajs.cn/list={sina_symbol}'
        req = urllib.request.Request(url, headers={
            'Referer': 'https://finance.sina.com.cn',
            'User-Agent': 'Mozilla/5.0'
        })
        with urllib.request.urlopen(req, timeout=5) as resp:
            text = resp.read().decode('gbk')
            for line in text.strip().split('\n'):
                if sina_symbol in line:
                    val_str = line.split('="')[1].split('";')[0]
                    parts = val_str.split(',')
                    if parts and len(parts) > 0:
                        # 新浪债券利率直接返回百分比值
                        raw = float(parts[0])
                        if raw > 0:
                            return raw
    except Exception:
        pass
    return None


def _fetch_eastmoney_yield(symbol_key):
    """
    通过东财 push2 接口获取利率数据（备选源）

    参数:
        symbol_key: 'US10Y' 或 'CN10Y'
    返回:
        float 或 None
    """
    secid_map = {
        'US10Y': '171.US10Y',
        'CN10Y': '171.CN10Y',
    }
    secid = secid_map.get(symbol_key)
    if not secid:
        return None

    try:
        url = f'https://push2.eastmoney.com/api/qt/stock/get?secid={secid}&fields=f43'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as resp:
            res = json.loads(resp.read().decode())
            raw_val = res.get('data', {}).get('f43')
            if raw_val is not None:
                val = float(raw_val)
                # 东财利率有时扩大 10000 倍存储（如 50072 → 5.0072%）
                if val > 100:
                    val = val / 10000.0
                if val > 0:
                    return val
    except Exception:
        pass
    return None


def get_macro_yields():
    """
    获取中美10年期国债收益率与利差

    轮询策略：新浪主选 → 东财备选
    失败策略：返回 None，打印 [WARN]，严禁伪造数字
    """
    us_10y = None
    cn_10y = None

    # 美债10年：新浪主选 → 东财备选
    us_10y = _fetch_sina_yield('US10Y')
    if us_10y is None:
        us_10y = _fetch_eastmoney_yield('US10Y')
    if us_10y is None:
        print("[WARN] 美债10Y收益率接口不可用（新浪+东财均失败），当前值置空，严禁使用假数据！", file=sys.stderr)

    # 中债10年：新浪主选 → 东财备选
    cn_10y = _fetch_sina_yield('CN10Y')
    if cn_10y is None:
        cn_10y = _fetch_eastmoney_yield('CN10Y')
    if cn_10y is None:
        print("[WARN] 中债10Y收益率接口不可用（新浪+东财均失败），当前值置空，严禁使用假数据！", file=sys.stderr)

    # 利差计算：任一为 None 则利差也为 None
    spread_bp = None
    if us_10y is not None and cn_10y is not None:
        spread_bp = round((cn_10y - us_10y) * 100, 2)

    return {
        'us_10y': round(us_10y, 4) if us_10y is not None else None,
        'cn_10y': round(cn_10y, 4) if cn_10y is not None else None,
        'spread_bp': spread_bp,
    }


# ---------------------------------------------------------------------------
#  汇率与美元指数：新浪主选 + 东财备选
# ---------------------------------------------------------------------------

def _fetch_sina_fx():
    """
    通过新浪财经获取离岸人民币汇率与美元指数（主选源）

    返回:
        (usd_cnh, dxy) 元组，失败项返回 None
    """
    usd_cnh = None
    dxy = None
    try:
        url = 'https://hq.sinajs.cn/list=fx_susdcnh,DINIW'
        req = urllib.request.Request(url, headers={
            'Referer': 'https://finance.sina.com.cn',
            'User-Agent': 'Mozilla/5.0'
        })
        with urllib.request.urlopen(req, timeout=5) as resp:
            text = resp.read().decode('gbk')
            for line in text.strip().split('\n'):
                if 'fx_susdcnh' in line:
                    val_str = line.split('="')[1].split('";')[0]
                    parts = val_str.split(',')
                    if len(parts) > 1:
                        v = float(parts[1])
                        if v > 0:
                            usd_cnh = v
                elif 'DINIW' in line:
                    val_str = line.split('="')[1].split('";')[0]
                    parts = val_str.split(',')
                    if len(parts) > 1:
                        v = float(parts[1])
                        if v > 0:
                            dxy = v
    except Exception:
        pass
    return usd_cnh, dxy


def _fetch_eastmoney_fx():
    """
    通过东财 push2 接口获取离岸人民币汇率与美元指数（备选源）

    返回:
        (usd_cnh, dxy) 元组，失败项返回 None
    """
    usd_cnh = None
    dxy = None
    fx_configs = [
        # (secid, 字段, 目标变量名, 除数)
        ('133.USDCNH', 'f43', 'usd_cnh', 10000),
        ('100.UDI', 'f43', 'dxy', 100),
    ]
    for secid, field, target, divisor in fx_configs:
        try:
            url = f'https://push2.eastmoney.com/api/qt/stock/get?secid={secid}&fields={field}'
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=5) as resp:
                res = json.loads(resp.read().decode())
                raw = res.get('data', {}).get(field)
                if raw is not None:
                    val = float(raw) / divisor
                    if val > 0:
                        if target == 'usd_cnh':
                            usd_cnh = val
                        else:
                            dxy = val
        except Exception:
            pass
    return usd_cnh, dxy


def get_fx_and_dxy():
    """
    获取离岸人民币汇率与美元指数

    轮询策略：新浪主选 → 东财备选
    失败策略：返回 None，打印 [WARN]
    """
    usd_cnh, dxy = _fetch_sina_fx()

    # 新浪失败的项尝试东财
    if usd_cnh is None or dxy is None:
        em_cnh, em_dxy = _fetch_eastmoney_fx()
        if usd_cnh is None:
            usd_cnh = em_cnh
        if dxy is None:
            dxy = em_dxy

    if usd_cnh is None:
        print("[WARN] 离岸人民币汇率接口不可用，当前值置空，严禁使用假数据！", file=sys.stderr)
    if dxy is None:
        print("[WARN] 美元指数接口不可用，当前值置空，严禁使用假数据！", file=sys.stderr)

    return {
        'usd_cnh': round(usd_cnh, 4) if usd_cnh is not None else None,
        'dxy': round(dxy, 2) if dxy is not None else None,
    }


# ---------------------------------------------------------------------------
#  FOMC 日程：从 JSON 配置文件读取
# ---------------------------------------------------------------------------

def get_fomc_info():
    """
    从 references/fomc_calendar.json 读取 FOMC 议息日程，计算距离下次会议倒计时

    返回:
        dict 包含 next_meeting_date, days_remaining, has_dot_plot
    """
    calendar_path = REFERENCES_DIR / "fomc_calendar.json"

    meetings = []
    try:
        with open(calendar_path, 'r', encoding='utf-8') as f:
            cal = json.load(f)
        for m in cal.get('meetings', []):
            start = datetime.date.fromisoformat(m['start_date'])
            meetings.append({
                'date': start,
                'has_dot_plot': m.get('has_dot_plot', False),
                'note': m.get('note', ''),
            })
    except FileNotFoundError:
        print(f"[WARN] FOMC日历文件不存在: {calendar_path}", file=sys.stderr)
    except Exception as e:
        print(f"[WARN] FOMC日历解析失败: {e}", file=sys.stderr)

    today = datetime.date.today()
    next_meeting = None
    days_left = 0
    is_dot_plot = False

    for m in sorted(meetings, key=lambda x: x['date']):
        if m['date'] >= today:
            next_meeting = m
            days_left = (m['date'] - today).days
            is_dot_plot = m['has_dot_plot']
            break

    if next_meeting is None:
        # 当前年份所有会议已结束，提示次年
        next_meeting_str = f"{today.year + 1}年1月常规会议（待更新日历）"
        days_left = 60
        is_dot_plot = False
    else:
        d = next_meeting['date']
        next_meeting_str = f"{d.year}年{d.month}月{d.day}日"

    return {
        'next_meeting_date': next_meeting_str,
        'days_remaining': days_left,
        'has_dot_plot': is_dot_plot,
    }


# ---------------------------------------------------------------------------
#  主入口
# ---------------------------------------------------------------------------

def fetch_macro_dashboard():
    """
    看板 1 主入口：汇总外围宏观流动性全部指标

    返回:
        dict 包含 us_10y, cn_10y, spread_bp, usd_cnh, dxy, fomc 相关字段
    """
    yields = get_macro_yields()
    fx = get_fx_and_dxy()
    fomc = get_fomc_info()

    return {
        **yields,
        **fx,
        **fomc,
    }


if __name__ == '__main__':
    res = fetch_macro_dashboard()
    print(json.dumps(res, ensure_ascii=False, indent=2))
