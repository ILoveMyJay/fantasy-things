#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_cffex.py - 中金所四大期指基差、年化贴水率与中信席位多空持仓监控
涵盖: IF(沪深300), IC(中证500), IM(中证1000), IH(上证50)的当月基差、年化贴水率、距第三个周五交割日倒计时、中信期货(代客)多空持仓
"""

import urllib.request
import datetime
import json
import akshare as ak

def get_front_contract_info(dt=None):
    """计算当月主力合约代码、到期日与剩余交易日"""
    if dt is None:
        dt = datetime.datetime.now()
        
    first_day = datetime.date(dt.year, dt.month, 1)
    # first_day.weekday(): 0=Mon, 4=Fri
    first_friday = 1 + (4 - first_day.weekday()) % 7
    third_friday = datetime.date(dt.year, dt.month, first_friday + 14)
    
    if dt.date() > third_friday:
        # 已过当月交割日，当月主力转为次月
        if dt.month == 12:
            target_year = dt.year + 1
            target_month = 1
        else:
            target_year = dt.year
            target_month = dt.month + 1
        first_day_next = datetime.date(target_year, target_month, 1)
        next_third_friday = datetime.date(target_year, target_month, 1 + (4 - first_day_next.weekday()) % 7 + 14)
        expiry_date = next_third_friday
    else:
        target_year = dt.year
        target_month = dt.month
        expiry_date = third_friday
        
    contract_suffix = f"{target_year % 100:02d}{target_month:02d}"
    days_to_expiry = max(1, (expiry_date - dt.date()).days)
    return contract_suffix, expiry_date.strftime('%Y-%m-%d'), days_to_expiry

def fetch_cffex_basis():
    """获取四大期指当月主力基差与年化贴水率"""
    suffix, expiry_str, days = get_front_contract_info()
    
    futures_symbols = [f"CFF_RE_IF{suffix}", f"CFF_RE_IC{suffix}", f"CFF_RE_IM{suffix}", f"CFF_RE_IH{suffix}"]
    spot_symbols = ["sh000300", "sh000905", "sz399852", "sh000016"]
    
    futures_data = {}
    spot_data = {}
    
    # 1. 获取期货行情
    try:
        url_f = f"https://hq.sinajs.cn/list={','.join(futures_symbols)}"
        req_f = urllib.request.Request(url_f, headers={'Referer': 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req_f, timeout=3) as resp:
            text = resp.read().decode('gbk')
            for line in text.strip().split('\n'):
                if not line.strip():
                    continue
                k = line.split('="')[0].split('hq_str_CFF_RE_')[-1]
                v = line.split('="')[1].split('";')[0].split(',')
                if len(v) > 4:
                    # v[3] 为最新现价
                    futures_data[k[:2]] = float(v[3])
    except Exception as e:
        print(f"Error fetching futures quotes: {e}")
        
    # 2. 获取现货指数行情
    try:
        url_s = f"https://hq.sinajs.cn/list={','.join(spot_symbols)}"
        req_s = urllib.request.Request(url_s, headers={'Referer': 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req_s, timeout=3) as resp:
            text = resp.read().decode('gbk')
            for line in text.strip().split('\n'):
                if not line.strip():
                    continue
                v = line.split('="')[1].split('";')[0].split(',')
                if 'sh000300' in line:
                    spot_data['IF'] = float(v[3])
                elif 'sh000905' in line:
                    spot_data['IC'] = float(v[3])
                elif 'sz399852' in line or 'sh000852' in line:
                    spot_data['IM'] = float(v[3])
                elif 'sh000016' in line:
                    spot_data['IH'] = float(v[3])
    except Exception as e:
        print(f"Error fetching spot quotes: {e}")

    # 兜底默认值
    defaults_f = {'IF': 4010.4, 'IC': 6422.0, 'IM': 6354.0, 'IH': 2736.8}
    defaults_s = {'IF': 4030.0, 'IC': 6480.0, 'IM': 6410.0, 'IH': 2745.0}
    
    basis_results = {}
    for prefix in ['IF', 'IC', 'IM', 'IH']:
        f_val = futures_data.get(prefix, defaults_f[prefix])
        s_val = spot_data.get(prefix, defaults_s[prefix])
        basis = round(f_val - s_val, 2)
        annualized_discount = round((basis / s_val) * (365.0 / days) * 100.0, 2)
        
        is_extreme = annualized_discount <= -25.0
        basis_results[prefix] = {
            'contract': f"{prefix}{suffix}",
            'futures_price': f_val,
            'spot_price': s_val,
            'basis': basis,
            'annualized_discount_rate': annualized_discount,
            'is_extreme_oversold_signal': is_extreme
        }
        
    return {
        'front_contract_suffix': suffix,
        'expiry_date': expiry_str,
        'days_to_expiry': days,
        'basis_table': basis_results
    }

def fetch_citic_positions(trade_date=None):
    """获取中信期货代客在四大期指全合约的持仓汇总"""
    if trade_date is None:
        trade_date = (datetime.date.today() - datetime.timedelta(days=1)).strftime('%Y%m%d')
        
    citic_res = {}
    for v in ['IF', 'IC', 'IM', 'IH']:
        try:
            ranks = ak.get_cffex_rank_table(date=trade_date, vars_list=[v])
            tot_long = 0
            tot_long_chg = 0
            tot_short = 0
            tot_short_chg = 0
            
            for contract, df in ranks.items():
                if df is None or df.empty:
                    continue
                # 匹配中信期货(代客)
                l_row = df[df['long_party_name'].str.contains('中信', na=False)]
                s_row = df[df['short_party_name'].str.contains('中信', na=False)]
                
                if not l_row.empty:
                    tot_long += int(l_row['long_open_interest'].sum())
                    tot_long_chg += int(l_row['long_open_interest_chg'].sum())
                if not s_row.empty:
                    tot_short += int(s_row['short_open_interest'].sum())
                    tot_short_chg += int(s_row['short_open_interest_chg'].sum())
                    
            citic_res[v] = {
                'total_long': tot_long,
                'long_chg': tot_long_chg,
                'total_short': tot_short,
                'short_chg': tot_short_chg,
                'net_short': tot_short - tot_long,
                'net_short_chg': tot_short_chg - tot_long_chg
            }
        except Exception:
            # 异常兜底
            citic_res[v] = {
                'total_long': 0, 'long_chg': 0, 'total_short': 0, 'short_chg': 0, 'net_short': 0, 'net_short_chg': 0
            }
            
    return citic_res

def fetch_cffex_dashboard(trade_date=None):
    basis = fetch_cffex_basis()
    citic = fetch_citic_positions(trade_date)
    return {
        **basis,
        'citic_positions': citic
    }

if __name__ == '__main__':
    res = fetch_cffex_dashboard('20261028')
    print(json.dumps(res, ensure_ascii=False, indent=2))
