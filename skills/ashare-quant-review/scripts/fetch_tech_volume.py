#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_tech_volume.py - 科技成长独立量能拆解与 TCR 拥挤度监控
涵盖: 上证、深证、创业板综(399102)、科创综指(000680)、科创50、科创芯片(000685)的成交额、涨跌幅与拥挤度模型
"""

import urllib.request
import json

def fetch_tech_volume_dashboard():
    symbols = ['sh000001', 'sz399001', 'sz399102', 'sz399006', 'sh000680', 'sh000688', 'sh000685']
    url = f'https://qt.gtimg.cn/q={",".join(symbols)}'
    
    indices = {}
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=3) as resp:
            text = resp.read().decode('gbk')
            for item in text.strip().split(';'):
                if not item.strip():
                    continue
                fields = item.split('~')
                if len(fields) > 37:
                    code = fields[2]
                    name = fields[1]
                    price = float(fields[3])
                    pct = float(fields[32])
                    amt_yi = float(fields[37]) / 10000.0  # 万元转亿元
                    indices[code] = {
                        'name': name,
                        'price': round(price, 2),
                        'pct_chg': round(pct, 2),
                        'amount_yi': round(amt_yi, 2)
                    }
    except Exception as e:
        print(f"Error fetching tech volume: {e}")
        
    sh_amt = indices.get('000001', {}).get('amount_yi', 7156.21)
    sz_amt = indices.get('399001', {}).get('amount_yi', 8409.03)
    total_market_amt = round(sh_amt + sz_amt, 2)
    
    chinext_amt = indices.get('399102', {}).get('amount_yi', 4193.57) # 创业板综 (涵盖全板1300+股)
    star_amt = indices.get('000680', {}).get('amount_yi', 2279.40)    # 科创综指 (涵盖全板570+股)
    star50_amt = indices.get('000688', {}).get('amount_yi', 711.00)   # 科创50 (仅龙头)
    semi_amt = indices.get('000685', {}).get('amount_yi', 794.94)     # 科创芯片
    
    tcr_chinext = round((chinext_amt / total_market_amt) * 100.0, 2)
    tcr_star = round((star_amt / total_market_amt) * 100.0, 2)
    tcr_double_tech = round(tcr_chinext + tcr_star, 2)
    tcr_semi = round((semi_amt / total_market_amt) * 100.0, 2)
    
    # 拥挤度状态判定
    if tcr_double_tech > 40.0:
        crowding_status = "极端过热与流动性虹吸（需警惕放量滞涨与主力分歧兑现）"
        crowding_level = "HIGH_ALERT"
    elif tcr_double_tech >= 25.0:
        crowding_status = "健康活跃与良性换手（主线良性上升或健康震荡）"
        crowding_level = "HEALTHY"
    else:
        crowding_status = "情绪冰点与极度缩量（关注重要支撑位的左侧战略布局机会）"
        crowding_level = "FREEZING_OPPORTUNITY"
        
    return {
        'total_market_amount_yi': total_market_amt,
        'sh_amount_yi': sh_amt,
        'sz_amount_yi': sz_amt,
        'chinext_all_amount_yi': chinext_amt,
        'star_all_amount_yi': star_amt,
        'star50_amount_yi': star50_amt,
        'semi_amount_yi': semi_amt,
        'tcr_chinext': tcr_chinext,
        'tcr_star': tcr_star,
        'tcr_double_tech': tcr_double_tech,
        'tcr_semi': tcr_semi,
        'crowding_status': crowding_status,
        'crowding_level': crowding_level,
        'indices_detail': indices
    }

if __name__ == '__main__':
    res = fetch_tech_volume_dashboard()
    print(json.dumps(res, ensure_ascii=False, indent=2))
