#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_macro.py - 获取外围宏观流动性指标与中美利差雷达
涵盖: 10Y美债收益率(US10Y), 10Y中债收益率(CN10Y), 中美利差, 离岸人民币(USD/CNH), 美元指数(DXY), FOMC日程
"""

import urllib.request
import json
import datetime

def get_macro_yields():
    """获取中美10年期国债收益率与利差"""
    us_10y = None
    cn_10y = None
    
    # 优先使用东财毫秒级直连接口
    endpoints = {
        'US10Y': 'https://push2.eastmoney.com/api/qt/stock/get?secid=171.US10Y&fields=f43',
        'CN10Y': 'https://push2.eastmoney.com/api/qt/stock/get?secid=171.CN10Y&fields=f43'
    }
    
    for k, url in endpoints.items():
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=3) as resp:
                res = json.loads(resp.read().decode())
                raw_val = res.get('data', {}).get('f43')
                if raw_val is not None:
                    # 东财利率扩大了10000倍存储，如 50072 -> 5.0072%
                    val = float(raw_val) / 10000.0 if float(raw_val) > 100 else float(raw_val)
                    if k == 'US10Y':
                        us_10y = val
                    else:
                        cn_10y = val
        except Exception:
            pass

    # 兜底默认值（若网络偶发中断）
    if us_10y is None:
        us_10y = 5.01
    if cn_10y is None:
        cn_10y = 1.63
        
    spread_bp = round((cn_10y - us_10y) * 100, 2)
    return {
        'us_10y': round(us_10y, 4),
        'cn_10y': round(cn_10y, 4),
        'spread_bp': spread_bp
    }

def get_fx_and_dxy():
    """获取离岸人民币汇率与美元指数"""
    usd_cnh = 6.66
    dxy = 102.2
    
    try:
        url = 'https://hq.sinajs.cn/list=fx_susdcnh,DINIW'
        req = urllib.request.Request(url, headers={'Referer': 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=3) as resp:
            text = resp.read().decode('gbk')
            for line in text.strip().split('\n'):
                if 'fx_susdcnh' in line:
                    val_str = line.split('="')[1].split('";')[0]
                    parts = val_str.split(',')
                    if len(parts) > 1:
                        usd_cnh = float(parts[1])
                elif 'DINIW' in line:
                    val_str = line.split('="')[1].split('";')[0]
                    parts = val_str.split(',')
                    if len(parts) > 1:
                        dxy = float(parts[1])
    except Exception:
        pass
        
    return {
        'usd_cnh': round(usd_cnh, 4),
        'dxy': round(dxy, 2)
    }

def get_fomc_info():
    """计算距离下次 FOMC 会议倒计时与日程"""
    # 2026 官方核准日程 (美东会议首日)
    fomc_dates_2026 = [
        datetime.date(2026, 1, 27),
        datetime.date(2026, 3, 17), # 点阵图
        datetime.date(2026, 4, 28),
        datetime.date(2026, 6, 16), # 点阵图
        datetime.date(2026, 7, 28),
        datetime.date(2026, 9, 15), # 点阵图
        datetime.date(2026, 10, 27), # 刚结束
        datetime.date(2026, 12, 8)  # 点阵图
    ]
    
    today = datetime.date.today()
    next_meeting = None
    days_left = 0
    is_sep = False
    
    for m in fomc_dates_2026:
        if m >= today:
            next_meeting = m
            days_left = (m - today).days
            is_sep = m.month in [3, 6, 9, 12]
            break
            
    if next_meeting is None:
        next_meeting_str = "2027年1月常规会议"
        days_left = 60
    else:
        next_meeting_str = f"{next_meeting.year}年{next_meeting.month}月{next_meeting.day}日"

    return {
        'next_meeting_date': next_meeting_str,
        'days_remaining': days_left,
        'has_dot_plot': is_sep
    }

def fetch_macro_dashboard():
    yields = get_macro_yields()
    fx = get_fx_and_dxy()
    fomc = get_fomc_info()
    
    return {
        **yields,
        **fx,
        **fomc
    }

if __name__ == '__main__':
    res = fetch_macro_dashboard()
    print(json.dumps(res, ensure_ascii=False, indent=2))
