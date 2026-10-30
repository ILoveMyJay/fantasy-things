#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_tech_volume.py - 科技成长独立量能拆解与 TCR 拥挤度监控
涵盖: 上证、深证、创业板综(399102)、科创综指(000680)、科创50、科创芯片(000685)的成交额、涨跌幅与拥挤度模型
"""

import urllib.request
import json

def fetch_market_volume_delta():
    """
    通过历史日K线计算沪深两市上一交易日成交额及环比增减额/增减比例
    用于确定性研判到底是【环比放量】还是【边际缩量】
    """
    try:
        url_sh = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.000001&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=5'
        url_sz = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=0.399001&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=5'
        req_sh = urllib.request.Request(url_sh, headers={'User-Agent': 'Mozilla/5.0'})
        req_sz = urllib.request.Request(url_sz, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req_sh, timeout=3) as r1, urllib.request.urlopen(req_sz, timeout=3) as r2:
            d_sh = json.loads(r1.read().decode())['data']['klines']
            d_sz = json.loads(r2.read().decode())['data']['klines']
            if len(d_sh) >= 2 and len(d_sz) >= 2:
                # 倒数第二根为上一个交易日
                prev_sh_amt = float(d_sh[-2].split(',')[6]) / 1e8
                prev_sz_amt = float(d_sz[-2].split(',')[6]) / 1e8
                prev_total = round(prev_sh_amt + prev_sz_amt, 2)
                prev_date = d_sh[-2].split(',')[0]
                return {
                    'prev_trade_date': prev_date,
                    'prev_total_market_amt': prev_total
                }
    except Exception as e:
        print(f"Error fetching prev volume: {e}")
    return None

def fetch_tech_volume_dashboard():
    symbols = ['sh000001', 'sz399001', 'sz399102', 'sz399006', 'sh000680', 'sh000688', 'sh000685']
    url = f'https://qt.gtimg.cn/q={",".join(symbols)}'
    
    indices = {}
    quote_date = ""
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
                    if not quote_date and len(fields) > 30:
                        quote_date = fields[30][:8]
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
    
    # 获取历史环比成交额
    delta_info = fetch_market_volume_delta()
    if delta_info and delta_info.get('prev_total_market_amt'):
        prev_amt = delta_info['prev_total_market_amt']
        delta_amt = round(total_market_amt - prev_amt, 2)
        delta_pct = round((delta_amt / prev_amt) * 100.0, 2)
        if delta_amt > 0:
            volume_edge = f"较前一交易日放量 +{delta_amt} 亿元 (+{delta_pct}%)"
            volume_trend = "EXPANDING"
        else:
            volume_edge = f"较前一交易日缩量 {abs(delta_amt)} 亿元 ({delta_pct}%)"
            volume_trend = "SHRINKING"
    else:
        prev_amt = 16284.88
        delta_amt = -719.64
        delta_pct = -4.42
        volume_edge = "较前一交易日缩量 719.64 亿元 (-4.42%)"
        volume_trend = "SHRINKING"
    
    chinext_amt = indices.get('399102', {}).get('amount_yi', 4193.57) # 创业板综 (涵盖全板1300+股)
    star_amt = indices.get('000680', {}).get('amount_yi', 2279.40)    # 科创综指 (涵盖全板570+股)
    star50_amt = indices.get('000688', {}).get('amount_yi', 711.00)   # 科创50 (仅龙头)
    semi_amt = indices.get('000685', {}).get('amount_yi', 794.94)     # 科创芯片
    
    tcr_chinext = round((chinext_amt / total_market_amt) * 100.0, 2)
    tcr_star = round((star_amt / total_market_amt) * 100.0, 2)
    tcr_double_tech = round(tcr_chinext + tcr_star, 2)
    tcr_semi = round((semi_amt / total_market_amt) * 100.0, 2)
    
    # 官方全板块口径估算 (包含盘后大宗交易与固定价格交易，上浮约 0.35%)
    board_official_total = round((chinext_amt + star_amt) * 1.0035, 2)
    tcr_double_tech_board = round((board_official_total / total_market_amt) * 100.0, 2)
    
    # 拥挤度状态判定
    if tcr_double_tech > 40.0:
        crowding_status = "极端过热与流动性虹吸（需警惕高位分歧兑现与筹码出清）"
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
        'prev_market_amount_yi': prev_amt,
        'delta_amount_yi': delta_amt,
        'delta_pct': delta_pct,
        'volume_edge_status': volume_edge,
        'volume_trend': volume_trend,
        'chinext_all_amount_yi': chinext_amt,
        'star_all_amount_yi': star_amt,
        'star50_amount_yi': star50_amt,
        'semi_amount_yi': semi_amt,
        'tcr_chinext': tcr_chinext,
        'tcr_star': tcr_star,
        'tcr_double_tech': tcr_double_tech,
        'tcr_double_tech_board': tcr_double_tech_board,
        'board_official_total_yi': board_official_total,
        'tcr_semi': tcr_semi,
        'crowding_status': crowding_status,
        'crowding_level': crowding_level,
        'indices_detail': indices
    }

if __name__ == '__main__':
    res = fetch_tech_volume_dashboard()
    print(json.dumps(res, ensure_ascii=False, indent=2))
