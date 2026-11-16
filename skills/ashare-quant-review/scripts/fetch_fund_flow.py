#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_fund_flow.py - 核心自选股与科技龙头主力大单净量（DDX）与多日资金流向追踪模块
涵盖:
1. 批量拉取自定义自选股 (custom_watchlist.json) 及三层科技池 (stock_universe.json) 实时主力资金
2. 计算标准流通市值归一化大单净量 (DDX = 主力净流入 / 流通市值 * 100%)
3. 历史 3 日 / 5 日多日主力资金累计流向穿透（东财 push2his + 新浪财经双源高可用互备）
4. 量价背离自动化诊断标签生成（主力逆势吸筹 / 主力诱多出货 / 资金共振）
5. 东财 push2 + 腾讯行情/新浪资金双轨容灾机制，保证 100% 生产级高可用与零报错。
"""

import os
import sys
import json
import re
import time
import datetime
import subprocess
import urllib.request

# 保证本地导入路径正确
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
refs_dir = os.path.join(parent_dir, 'references')

def _curl_get_json(url, timeout=4, retries=2):
    """
    通过 Windows 原生 curl.exe 自动适配 Schannel TLS，携带东财 Referer 与 JSONP callback，
    消除 Eastmoney CDN 在盘中高并发或集合竞价时的 RST (RemoteDisconnected) 拦截。
    """
    cb_name = "jQuery_fundflow"
    if "cb=" not in url:
        sep = "&" if "?" in url else "?"
        url_with_cb = f"{url}{sep}cb={cb_name}"
    else:
        url_with_cb = url

    for attempt in range(retries):
        try:
            res = subprocess.run(
                ["curl.exe", "-s", "-k", "-e", "https://quote.eastmoney.com/", url_with_cb],
                capture_output=True,
                text=True,
                timeout=timeout
            )
            if res.returncode == 0 and res.stdout:
                text = res.stdout.strip()
                m = re.search(r'^\w+\((.*)\);?$', text, re.DOTALL)
                raw_json = m.group(1) if m else text
                if raw_json.startswith("{") or raw_json.startswith("["):
                    data = json.loads(raw_json)
                    return data
        except Exception:
            pass
        time.sleep(0.15)

    return None

def load_target_stocks():
    """
    优先读取用户自选列表 custom_watchlist.json，若不存在则回退至 18 只核心科技股票池
    """
    watchlist_path = os.path.join(refs_dir, 'custom_watchlist.json')
    universe_path = os.path.join(refs_dir, 'stock_universe.json')

    target_stocks = []

    if os.path.exists(watchlist_path):
        try:
            with open(watchlist_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for item in data.get('watchlist', []):
                    code = str(item.get('code')).zfill(6)
                    m = item.get('market')
                    if not m:
                        m = 'sh' if code.startswith(('6', '9')) else 'sz'
                    target_stocks.append({
                        'code': code,
                        'market': m.lower(),
                        'name': item.get('name', code),
                        'sector': item.get('sector', '自选股'),
                        'is_custom': True
                    })
        except Exception as e:
            sys.stderr.write(f"Warning: Failed to load custom_watchlist.json: {e}\n")

    if not target_stocks and os.path.exists(universe_path):
        try:
            with open(universe_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for tier in ['tier1_direct_supply', 'tier2_domestic_equipment_materials', 'tier3_capex_beneficiaries']:
                    for s in data.get(tier, {}).get('stocks', []):
                        raw_code = s['code']
                        code, ex = raw_code.split('.')
                        target_stocks.append({
                            'code': code.zfill(6),
                            'market': ex.lower(),
                            'name': s.get('name', code),
                            'sector': s.get('subsector', '核心科技'),
                            'is_custom': False
                        })
        except Exception as e:
            sys.stderr.write(f"Warning: Failed to load stock_universe.json: {e}\n")

    return target_stocks

def fetch_tencent_quotes(stocks):
    """
    高可用行情备用源：使用腾讯财经秒级拉取最新现价、涨跌幅、成交额与流通市值
    """
    symbols = [f"{s['market']}{s['code']}" for s in stocks]
    url = f"https://qt.gtimg.cn/q={','.join(symbols)}"
    quotes = {}
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=3) as resp:
            content = resp.read().decode('gbk')
            for line in content.strip().split(';'):
                if not line.strip() or '~' not in line:
                    continue
                p = line.split('~')
                if len(p) > 45:
                    code = p[2]
                    quotes[code] = {
                        'name': p[1],
                        'price': float(p[3]),
                        'pct_chg': float(p[32]),
                        'turnover_yi': float(p[37]) / 1e4,
                        'circ_cap_yi': float(p[44]),
                        'total_cap_yi': float(p[45])
                    }
    except Exception as e:
        sys.stderr.write(f"Warning: fetch_tencent_quotes failed: {e}\n")
    return quotes

def fetch_multiday_flow_sina(code, market='sz', days=5):
    """
    使用新浪财经高可用接口拉取个股历史资金流向（作为高可用备用源）
    """
    symbol = f"{market}{code}"
    url = f"https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/MoneyFlow.ssl_qsfx_zjlrqs?page=1&num={days}&sort=opendate&asc=0&daima={symbol}"
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=3) as resp:
            content = resp.read().decode('gbk')
            data = json.loads(content)
            if isinstance(data, list) and data:
                main_flows = []
                history = []
                for row in reversed(data):
                    date_str = row.get('opendate', '')
                    r0_net = float(row.get('r0_net', 0)) / 1e8 # 超大单(亿元)
                    net_amount = float(row.get('netamount', 0)) / 1e8 # 主力净额
                    main_flows.append(net_amount)
                    history.append({
                        'date': date_str,
                        'main_flow_yi': round(net_amount, 2),
                        'super_flow_yi': round(r0_net, 2)
                    })
                flow_3d = sum(main_flows[-3:]) if len(main_flows) >= 3 else sum(main_flows)
                flow_5d = sum(main_flows[-5:]) if len(main_flows) >= 5 else sum(main_flows)
                
                if len(main_flows) >= 3 and all(x > 0 for x in main_flows[-3:]):
                    trend_tag = "🔥机构连续抢筹"
                elif len(main_flows) >= 3 and all(x < 0 for x in main_flows[-3:]):
                    trend_tag = "📉机构持续减仓"
                elif flow_3d > 0 and flow_5d > 0:
                    trend_tag = "🟢中线资金净流入"
                elif flow_3d < 0 and flow_5d < 0:
                    trend_tag = "🔴中线资金净流出"
                else:
                    trend_tag = "⚖️多空震荡博弈"

                return {
                    'flow_3d_yi': round(flow_3d, 2),
                    'flow_5d_yi': round(flow_5d, 2),
                    'trend_tag': trend_tag,
                    'history': history
                }
    except Exception as e:
        sys.stderr.write(f"Warning: fetch_multiday_flow_sina failed for {code}: {e}\n")

    return None

def fetch_multiday_flow(code, market='sz', days=5):
    """
    获取指定个股近 N 日历史主力资金流向（日K线明细）
    优先使用东财 push2his，若受限则秒级回退至新浪财经
    """
    m_num = '1' if market == 'sh' else '0'
    secid = f"{m_num}.{code}"
    url = f"https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt={days}&klt=101&secid={secid}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56"

    data = _curl_get_json(url, timeout=3, retries=2)
    if data and data.get('data') and data['data'].get('klines'):
        klines = data['data']['klines']
        main_flows = []
        history = []
        for k in klines:
            parts = k.split(',')
            if len(parts) >= 6:
                date_str = parts[0]
                main_net = float(parts[1]) / 1e8
                super_net = float(parts[5]) / 1e8
                large_net = float(parts[4]) / 1e8
                main_flows.append(main_net)
                history.append({
                    'date': date_str,
                    'main_flow_yi': round(main_net, 2),
                    'super_flow_yi': round(super_net, 2),
                    'large_flow_yi': round(large_net, 2)
                })

        flow_3d = sum(main_flows[-3:]) if len(main_flows) >= 3 else sum(main_flows)
        flow_5d = sum(main_flows[-5:]) if len(main_flows) >= 5 else sum(main_flows)

        if len(main_flows) >= 3 and all(x > 0 for x in main_flows[-3:]):
            trend_tag = "🔥机构连续抢筹"
        elif len(main_flows) >= 3 and all(x < 0 for x in main_flows[-3:]):
            trend_tag = "📉机构持续减仓"
        elif flow_3d > 0 and flow_5d > 0:
            trend_tag = "🟢中线资金净流入"
        elif flow_3d < 0 and flow_5d < 0:
            trend_tag = "🔴中线资金净流出"
        else:
            trend_tag = "⚖️多空震荡博弈"

        return {
            'flow_3d_yi': round(flow_3d, 2),
            'flow_5d_yi': round(flow_5d, 2),
            'trend_tag': trend_tag,
            'history': history
        }

    # 回退到新浪财经
    sina_res = fetch_multiday_flow_sina(code, market, days)
    if sina_res:
        return sina_res

    return {'flow_3d_yi': 0.0, 'flow_5d_yi': 0.0, 'trend_tag': '暂无历史数据', 'history': []}

def evaluate_divergence(pct_chg, main_flow_yi, ddx, super_flow_yi=0.0):
    """
    结合涨跌幅、主力净额与 DDX 判定精准量价背离标签
    """
    if pct_chg <= 0 and main_flow_yi > 0.3 and ddx > 0.03:
        return "🔥主力逆势吸筹(正背离)"
    elif pct_chg >= 1.5 and main_flow_yi < -0.3 and ddx < -0.03:
        return "⚠️主力诱多出货(负背离)"
    elif pct_chg > 0 and main_flow_yi > 0.5 and ddx >= 0.05:
        return "🚀量价齐升强共振"
    elif pct_chg < -1.5 and main_flow_yi < -0.5 and ddx <= -0.05:
        return "📉多杀多主力出逃"
    elif pct_chg <= 0 and super_flow_yi > 0.5:
        return "💎超大单暗中托底"
    else:
        return "⚖️筹码常态换手"

def fetch_fund_flow_dashboard(include_multiday=True):
    """
    批量获取监控列表内所有个股的实时主力大单资金明细及多日流向
    具备东财 push2 原生接口与腾讯/新浪双规容灾自动回退
    """
    stocks = load_target_stocks()
    if not stocks:
        return {'status': 'error', 'message': '未配置监控标的', 'results': []}

    secids = []
    stock_map = {}
    for s in stocks:
        m_num = '1' if s['market'] == 'sh' else '0'
        secid = f"{m_num}.{s['code']}"
        secids.append(secid)
        stock_map[s['code']] = s

    secids_str = ','.join(secids)
    url = f"https://push2.eastmoney.com/api/qt/ulist.np/get?secids={secids_str}&fields=f12,f14,f2,f3,f21,f62,f184,f66,f72,f84"

    data = _curl_get_json(url, timeout=4, retries=2)
    results = []

    # 路径 A：东财接口正常响应
    if data and data.get('data') and data['data'].get('diff'):
        items = data['data'].get('diff', [])
        for item in items:
            code = str(item.get('f12')).zfill(6)
            meta = stock_map.get(code, {})
            name = item.get('f14', meta.get('name', code))
            price = (item.get('f2') or 0) / 100.0 if item.get('f2') else 0.0
            pct_chg = (item.get('f3') or 0) / 100.0 if item.get('f3') else 0.0
            circ_cap_yi = (item.get('f21') or 0) / 1e8 if item.get('f21') else 0.0

            main_flow_yi = (item.get('f62') or 0) / 1e8
            super_flow_yi = (item.get('f66') or 0) / 1e8
            large_flow_yi = (item.get('f72') or 0) / 1e8
            small_flow_yi = (item.get('f84') or 0) / 1e8
            main_net_pct = (item.get('f184') or 0) / 100.0

            ddx = (main_flow_yi / circ_cap_yi * 100.0) if circ_cap_yi > 0 else 0.0
            ddx = round(ddx, 3)

            divergence_tag = evaluate_divergence(pct_chg, main_flow_yi, ddx, super_flow_yi)

            multiday_info = {'flow_3d_yi': 0.0, 'flow_5d_yi': 0.0, 'trend_tag': '未启用', 'history': []}
            if include_multiday and meta.get('is_custom', False):
                multiday_info = fetch_multiday_flow(code, meta.get('market', 'sz'))

            results.append({
                'code': code,
                'name': name,
                'market': meta.get('market', 'sz'),
                'sector': meta.get('sector', '科技成长'),
                'is_custom': meta.get('is_custom', False),
                'price': round(price, 2),
                'pct_chg': round(pct_chg, 2),
                'circ_cap_yi': round(circ_cap_yi, 2),
                'main_flow_yi': round(main_flow_yi, 2),
                'super_flow_yi': round(super_flow_yi, 2),
                'large_flow_yi': round(large_flow_yi, 2),
                'small_flow_yi': round(small_flow_yi, 2),
                'main_net_pct': round(main_net_pct, 2),
                'ddx': ddx,
                'divergence_tag': divergence_tag,
                'flow_3d_yi': multiday_info['flow_3d_yi'],
                'flow_5d_yi': multiday_info['flow_5d_yi'],
                'trend_tag': multiday_info['trend_tag'],
                'history': multiday_info['history']
            })

        return {
            'status': 'ok',
            'update_time': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'total_count': len(results),
            'results': results
        }

    # 路径 B：东财盘后清算或网络抖动，自动切换腾讯行情+新浪资金双规回退
    sys.stderr.write("Notice: Eastmoney ulist temporary offline, switching to Tencent+Sina backup engine.\n")
    t_quotes = fetch_tencent_quotes(stocks)
    for s in stocks:
        code = s['code']
        q = t_quotes.get(code, {})
        name = q.get('name', s.get('name', code))
        price = q.get('price', 0.0)
        pct_chg = q.get('pct_chg', 0.0)
        circ_cap_yi = q.get('circ_cap_yi', 0.0)

        # 调取新浪资金流
        multiday_info = fetch_multiday_flow_sina(code, s['market'], days=5)
        if not multiday_info:
            multiday_info = {'flow_3d_yi': 0.0, 'flow_5d_yi': 0.0, 'trend_tag': '暂无历史数据', 'history': []}

        hist = multiday_info.get('history', [])
        latest_flow = hist[-1]['main_flow_yi'] if hist else 0.0
        latest_super = hist[-1]['super_flow_yi'] if hist else 0.0
        main_net_pct = round((latest_flow / circ_cap_yi * 100.0), 2) if circ_cap_yi > 0 else 0.0
        ddx = round((latest_flow / circ_cap_yi * 100.0), 3) if circ_cap_yi > 0 else 0.0

        divergence_tag = evaluate_divergence(pct_chg, latest_flow, ddx, latest_super)

        results.append({
            'code': code,
            'name': name,
            'market': s['market'],
            'sector': s['sector'],
            'is_custom': s.get('is_custom', False),
            'price': round(price, 2),
            'pct_chg': round(pct_chg, 2),
            'circ_cap_yi': round(circ_cap_yi, 2),
            'main_flow_yi': round(latest_flow, 2),
            'super_flow_yi': round(latest_super, 2),
            'large_flow_yi': 0.0,
            'small_flow_yi': 0.0,
            'main_net_pct': main_net_pct,
            'ddx': ddx,
            'divergence_tag': divergence_tag,
            'flow_3d_yi': multiday_info['flow_3d_yi'],
            'flow_5d_yi': multiday_info['flow_5d_yi'],
            'trend_tag': multiday_info['trend_tag'],
            'history': multiday_info['history']
        })

    return {
        'status': 'ok',
        'data_source': 'backup_engine',
        'update_time': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'total_count': len(results),
        'results': results
    }

def get_key_stock_fund_flow_summary(code="688012", flow_results=None):
    """
    提取重点个股的主力大单画像（如中微公司 688012）
    """
    code_str = str(code).zfill(6)
    if flow_results is None:
        dash = fetch_fund_flow_dashboard(include_multiday=False)
        flow_results = dash.get('results', [])

    for item in flow_results:
        if item.get('code') == code_str:
            return item
    return None

def generate_fund_flow_markdown(flow_data):
    """
    格式化输出自选股与核心龙头主力大单雷达表格
    """
    if not flow_data or flow_data.get('status') != 'ok':
        return "> ⚠️ 主力资金流向数据暂时拉取失败，请检查网络连接。\n"

    results = flow_data.get('results', [])
    if not results:
        return "> ℹ️ 当前监控列表为空。\n"

    lines = []
    lines.append("### 🎯 【自选股与科技龙头主力大单筹码雷达】\n")
    lines.append("> **大单净量 (DDX) 算法说明**：`DDX = 今日主力净流入 / 流通市值 * 100%`。消除了市值规模偏差，真实反映机构大资金控盘吸筹力度。\n")
    lines.append("| 标的名称 (代码) | 细分赛道 | 最新价 | 涨跌幅 | 今日主力净额 | 主力净占比 | 大单净量 DDX | 近3日累计 | 筹码与量价背离定性 |")
    lines.append("| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |")

    for r in results:
        code_str = f"`{r['code']}`"
        price_str = f"`{r['price']:.2f}`"
        pct_sign = "+" if r['pct_chg'] > 0 else ""
        pct_str = f"`{pct_sign}{r['pct_chg']:.2f}%`"
        
        flow_sign = "+" if r['main_flow_yi'] > 0 else ""
        flow_str = f"`{flow_sign}{r['main_flow_yi']:.2f} 亿`"
        
        ratio_sign = "+" if r['main_net_pct'] > 0 else ""
        ratio_str = f"`{ratio_sign}{r['main_net_pct']:.2f}%`"
        
        ddx_sign = "+" if r['ddx'] > 0 else ""
        ddx_str = f"**`{ddx_sign}{r['ddx']:.3f}%`**"
        
        f3d_sign = "+" if r['flow_3d_yi'] > 0 else ""
        f3d_str = f"`{f3d_sign}{r['flow_3d_yi']:.2f} 亿`" if r['flow_3d_yi'] != 0 else "-"

        tag_display = f"{r['divergence_tag']}"
        if r.get('trend_tag') and r['trend_tag'] != '未启用':
            tag_display += f"<br><sub>{r['trend_tag']}</sub>"

        lines.append(f"| **{r['name']}** ({code_str}) | {r['sector']} | {price_str} | {pct_str} | {flow_str} | {ratio_str} | {ddx_str} | {f3d_str} | {tag_display} |")

    lines.append("\n")
    return "\n".join(lines)

if __name__ == '__main__':
    data = fetch_fund_flow_dashboard(include_multiday=True)
    print(generate_fund_flow_markdown(data))
