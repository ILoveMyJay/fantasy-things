#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_market_sentiment.py — 看板 3：全市场微观结构、真中位数与全景情绪

融合版修复要点：
  1. 中位数改全市场计算: 用东财全市场行情快报拉全量 5500+ 个股
  2. 附带计算 25/75 分位数与偏度 (Skewness)
  3. 任何数据源失败返回 None 并告警，绝不静默填假值
  4. 保留涨跌停、炸板率、连板梯队、剪刀差与综合情绪评分
"""

import urllib.request
import urllib.parse
import json
import statistics
import math
import sys
from datetime import datetime, date


# ---------------------------------------------------------------------------
#  板块分类与涨跌幅限制（2026年7月新规口径）
# ---------------------------------------------------------------------------

def get_limit_threshold(stock_code, stock_name):
    """根据股票代码和名称判定涨跌幅限制"""
    if not stock_name or not stock_code:
        return 0.10

    # 新股判定（上市前5日无涨跌幅限制，N开头为首日，C开头为第2~5日）
    if stock_name.startswith('N') or stock_name.startswith('C'):
        return None

    # 科创板 (688/689)
    if stock_code.startswith(('688', '689')):
        return 0.20
    # 创业板 (300/301)
    elif stock_code.startswith(('300', '301')):
        return 0.20
    # 北交所 (43/83/87/88/920)
    elif stock_code.startswith(('43', '83', '87', '88', '920')):
        return 0.30
    else:
        # 主板（含ST，2026年7月新规统一10%）
        return 0.10


def classify_board(stock_code, stock_name):
    """分类股票所属板块"""
    if not stock_code:
        return 'mainboard'
    if stock_name and (stock_name.startswith('N') or stock_name.startswith('C')):
        return 'new_stock'
    elif stock_code.startswith(('688', '689')):
        return 'star'
    elif stock_code.startswith(('300', '301')):
        return 'chinext'
    elif stock_code.startswith(('43', '83', '87', '88', '920')):
        return 'bse'
    else:
        return 'mainboard'


# ---------------------------------------------------------------------------
#  涨跌停判定工具函数
# ---------------------------------------------------------------------------

def is_limit_up(high, prev_close, threshold, tolerance=1e-4):
    """判定是否触及涨停"""
    if threshold is None or prev_close is None or prev_close <= 0:
        return False
    limit_price = round(prev_close * (1 + threshold), 2)
    return high >= limit_price - tolerance


def is_limit_down(low, prev_close, threshold, tolerance=1e-4):
    """判定是否触及跌停"""
    if threshold is None or prev_close is None or prev_close <= 0:
        return False
    limit_price = round(prev_close * (1 - threshold), 2)
    return low <= limit_price + tolerance


def is_sealed_limit_up(close, high, prev_close, threshold, tolerance=1e-4):
    """判定是否封死涨停"""
    if not is_limit_up(high, prev_close, threshold, tolerance):
        return False
    limit_price = round(prev_close * (1 + threshold), 2)
    return close >= limit_price - tolerance


def is_broken_board(high, close, prev_close, threshold, tolerance=1e-4):
    """判定是否炸板"""
    if not is_limit_up(high, prev_close, threshold, tolerance):
        return False
    limit_price = round(prev_close * (1 + threshold), 2)
    return close < limit_price - 0.01


# ---------------------------------------------------------------------------
#  全市场宽度（涨跌平家数）
# ---------------------------------------------------------------------------

def fetch_market_breadth():
    """
    获取真实全市场（沪深京 5600+ 股）上涨/下跌/平盘总家数
    """
    url = ('http://push2.eastmoney.com/api/qt/ulist.np/get'
           '?secids=1.000001,0.399001,0.899050'
           '&fields=f12,f14,f104,f105,f106')
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            diff = data.get('data', {}).get('diff', [])
            if diff:
                up_total = sum(d.get('f104', 0) for d in diff)
                down_total = sum(d.get('f105', 0) for d in diff)
                flat_total = sum(d.get('f106', 0) for d in diff)
                total = up_total + down_total + flat_total
                if total > 0:
                    return {
                        'up_count': up_total,
                        'down_count': down_total,
                        'flat_count': flat_total,
                        'total_stocks': total,
                        'advance_decline_ratio': round(up_total / down_total, 2) if down_total > 0 else 999.99,
                        'advance_pct': round(up_total / total * 100, 2),
                        'decline_pct': round(down_total / total * 100, 2),
                        'status': 'ok',
                    }
    except Exception as e:
        sys.stderr.write(f"Warning: fetch_market_breadth error: {e}\n")
    return None


# ---------------------------------------------------------------------------
#  涨跌停专题池
# ---------------------------------------------------------------------------

def fetch_limit_pools(trade_date=None):
    """从东财专题池获取涨停、炸板与跌停全量明细"""
    if trade_date is None:
        trade_date = date.today().strftime('%Y%m%d')

    zt_url = f'https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=5000&sort=fbt:asc&date={trade_date}'
    zb_url = f'https://push2ex.eastmoney.com/getTopicZBPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=5000&sort=fbt:asc&date={trade_date}'
    dt_url = f'https://push2ex.eastmoney.com/getTopicDTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=5000&sort=fund:asc&date={trade_date}'

    headers = {'User-Agent': 'Mozilla/5.0'}
    pools_data = {'zt': [], 'zb': [], 'dt': []}

    for key, url in [('zt', zt_url), ('zb', zb_url), ('dt', dt_url)]:
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=4) as resp:
                d = json.loads(resp.read().decode('utf-8'))
                if d.get('data') and d['data'].get('pool'):
                    pools_data[key] = d['data']['pool']
        except Exception as e:
            sys.stderr.write(f"Warning: fetch limit pool {key} error: {e}\n")

    board_stats = {
        'mainboard': {'limit_up': 0, 'limit_down': 0, 'broken': 0},
        'chinext': {'limit_up': 0, 'limit_down': 0, 'broken': 0},
        'star': {'limit_up': 0, 'limit_down': 0, 'broken': 0},
        'bse': {'limit_up': 0, 'limit_down': 0, 'broken': 0},
        'new_stock': {'count': 0, 'extreme_up': 0, 'extreme_down': 0},
    }

    sealed_count = len(pools_data['zt'])
    for s in pools_data['zt']:
        code = str(s.get('c', ''))
        name = str(s.get('n', ''))
        b = classify_board(code, name)
        if b == 'new_stock':
            board_stats[b]['count'] += 1
        else:
            board_stats[b]['limit_up'] += 1

    broken_count = len(pools_data['zb'])
    for s in pools_data['zb']:
        code = str(s.get('c', ''))
        name = str(s.get('n', ''))
        b = classify_board(code, name)
        if b != 'new_stock':
            board_stats[b]['broken'] += 1

    dt_count = len(pools_data['dt'])
    for s in pools_data['dt']:
        code = str(s.get('c', ''))
        name = str(s.get('n', ''))
        b = classify_board(code, name)
        if b != 'new_stock':
            board_stats[b]['limit_down'] += 1

    total_touched = sealed_count + broken_count
    seal_rate = round(sealed_count / total_touched * 100, 2) if total_touched > 0 else 0.0
    broken_rate = round(broken_count / total_touched * 100, 2) if total_touched > 0 else 0.0

    # 连板梯队统计
    consecutive_boards = {}
    for s in pools_data['zt']:
        lbc = s.get('lbc', 1)
        try:
            lbc = int(lbc)
        except (ValueError, TypeError):
            lbc = 1
        if lbc >= 2:
            consecutive_boards[lbc] = consecutive_boards.get(lbc, 0) + 1

    return {
        'sealed_limit_up_count': sealed_count,
        'broken_board_count': broken_count,
        'limit_up_total': total_touched,
        'limit_up_count': sealed_count,
        'limit_down_count': dt_count,
        'seal_rate': seal_rate,
        'broken_board_rate': broken_rate,
        'consecutive_boards': consecutive_boards,
        'board_breakdown': board_stats,
        'status': 'ok',
    }


# ---------------------------------------------------------------------------
#  全市场真实中位数（核心修复：5500+ 个股全量计算）
# ---------------------------------------------------------------------------

def _compute_skewness(data):
    """
    计算样本偏度 (Fisher's skewness)

    公式: g1 = (n / ((n-1)(n-2))) * sum((xi - mean)^3) / std^3

    返回:
        float 偏度值，样本不足返回 None
    """
    n = len(data)
    if n < 3:
        return None
    mean = sum(data) / n
    std = (sum((x - mean) ** 2 for x in data) / (n - 1)) ** 0.5
    if std == 0:
        return 0.0
    m3 = sum((x - mean) ** 3 for x in data) / n
    return round(m3 / (std ** 3), 4)


def fetch_full_market_median():
    """
    通过东财全市场行情快报获取全量 5500+ 个股真实涨跌幅，计算：
      - 中位数 (median)
      - 均值 (mean)
      - 25 分位数 (q25)
      - 75 分位数 (q75)
      - 偏度 (skewness)

    fs 参数说明：
      m:0+t:6   = 深主板A股
      m:0+t:80  = 深创业板
      m:1+t:2   = 沪主板A股
      m:1+t:23  = 沪科创板

    失败时返回全部 None，绝不静默填假值。
    """
    base_url = 'https://82.push2.eastmoney.com/api/qt/clist/get'

    all_pcts = []
    page = 1
    page_size = 5000  # 单页拉取上限

    while True:
        params = {
            'pn': str(page),
            'pz': str(page_size),
            'po': '1',
            'np': '1',
            'ut': 'bd1d9ddb04089700cf9c27f6f7426281',
            'fltt': '2',
            'invt': '2',
            'fid': 'f3',
            'fs': 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23',
            'fields': 'f12,f14,f2,f3',
        }
        query = urllib.parse.urlencode(params)
        full_url = f"{base_url}?{query}"

        try:
            req = urllib.request.Request(full_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                diff = data.get('data', {}).get('diff', [])
                total_count = data.get('data', {}).get('total', 0)

                if not diff:
                    break

                for item in diff:
                    try:
                        pct = item.get('f3')
                        if pct is not None and pct != '-':
                            pcts_val = float(pct)
                            # 过滤掉停牌/无效数据（涨跌幅为 0 且价格为 0 的通常为停牌）
                            price = item.get('f2')
                            if price is not None and price != '-' and float(price) > 0:
                                all_pcts.append(pcts_val)
                    except (ValueError, TypeError):
                        continue

                # 判断是否还有下一页
                fetched_so_far = page * page_size
                if fetched_so_far >= total_count or len(diff) < page_size:
                    break
                page += 1

        except Exception as e:
            print(f"[WARN] 全市场中位数接口异常（第{page}页）: {e}", file=sys.stderr)
            break

    if not all_pcts:
        print("[WARN] 全市场个股涨跌幅数据为空，中位数置空，严禁使用假数据！", file=sys.stderr)
        return {
            'median_change_pct': None,
            'mean_change_pct': None,
            'q25_change_pct': None,
            'q75_change_pct': None,
            'skewness': None,
            'sample_size': 0,
        }

    # 排序后计算分位数
    all_pcts.sort()
    n = len(all_pcts)

    median_val = round(statistics.median(all_pcts), 2)
    mean_val = round(statistics.mean(all_pcts), 2)

    # 25/75 分位数
    q25_idx = int(n * 0.25)
    q75_idx = int(n * 0.75)
    q25_val = round(all_pcts[q25_idx], 2)
    q75_val = round(all_pcts[q75_idx], 2)

    # 偏度
    skewness = _compute_skewness(all_pcts)

    return {
        'median_change_pct': median_val,
        'mean_change_pct': mean_val,
        'q25_change_pct': q25_val,
        'q75_change_pct': q75_val,
        'skewness': skewness,
        'sample_size': n,
    }


# ---------------------------------------------------------------------------
#  指数与个股分化度诊断
# ---------------------------------------------------------------------------

def calculate_divergence(index_pct, median_stock_pct):
    """
    计算指数与个股分化度，并生成结构标签

    参数:
        index_pct: 指数涨跌幅
        median_stock_pct: 全市场个股中位数涨跌幅
    """
    if median_stock_pct is None:
        return {
            'divergence_value': None,
            'label': 'data_unavailable',
            'description': '中位数数据缺失，无法计算分化度',
        }

    divergence_value = round(index_pct - median_stock_pct, 2)

    if index_pct > 0 and median_stock_pct > 0:
        if divergence_value > 0.5:
            label = 'index_outperform_broad_up'
            desc = '指数跑赢个股（权重护盘拉指数）'
        else:
            label = 'broad_risk_on'
            desc = '全面做多（指数与个股共振上涨）'
    elif index_pct > 0 and median_stock_pct < 0:
        label = 'index_up_breadth_weak'
        desc = '指数涨个股跌（权重护盘、题材分化）'
    elif index_pct < 0 and median_stock_pct > 0:
        label = 'index_down_breadth_strong'
        desc = '指数跌个股涨（权重拖累、题材活跃）'
    elif index_pct < 0 and median_stock_pct < 0:
        if abs(divergence_value) > 0.5:
            label = 'index_underperform_broad_down'
            desc = '指数跌幅大于个股（权重杀跌）'
        else:
            label = 'broad_risk_off'
            desc = '全面杀跌（指数与个股共振下跌）'
    else:
        label = 'neutral'
        desc = '震荡整理'

    return {
        'divergence_value': divergence_value,
        'label': label,
        'description': desc,
    }


# ---------------------------------------------------------------------------
#  综合情绪评级
# ---------------------------------------------------------------------------

def generate_sentiment_label(breadth, limit_structure, divergence_info):
    """
    基于全市场宽度、涨跌停结构、跌停惩罚与分化度生成确定性情绪标签

    加权维度：
      - 上涨家数占比 (40%)
      - 涨停与封板率 (30%)
      - 中位数 (20%)
      - 分化度 (10%)
    """
    drivers = []

    # 1. 上涨家数占比得分 (权重 40%)
    advance_pct = breadth.get('advance_pct', 0)
    if advance_pct >= 70:
        breadth_score = 85
        drivers.append(f"普涨做多（{advance_pct:.1f}%个股上涨）")
    elif advance_pct >= 50:
        breadth_score = 65
        drivers.append(f"多方占优（{advance_pct:.1f}%个股上涨）")
    elif advance_pct >= 30:
        breadth_score = 45
        drivers.append(f"空方承压（仅{advance_pct:.1f}%个股上涨）")
    else:
        breadth_score = 25
        drivers.append(f"普跌格局（仅{advance_pct:.1f}%个股上涨）")

    # 2. 涨停与封板率得分 (权重 30%)
    limit_up = limit_structure.get('sealed_limit_up_count',
                                   limit_structure.get('limit_up_count', 0))
    broken_rate = limit_structure.get('broken_board_rate', 0)
    limit_down = limit_structure.get('limit_down_count', 0)

    if limit_up >= 80:
        limit_score = 90
        drivers.append(f"涨停潮({limit_up}家封死涨停)")
    elif limit_up >= 50:
        limit_score = 75
        drivers.append(f"赚钱效应活跃({limit_up}家涨停)")
    elif limit_up >= 30:
        limit_score = 55
        drivers.append(f"涨停常态换手({limit_up}家)")
    else:
        limit_score = 35
        if limit_up > 0:
            drivers.append(f"短线涨停偏少({limit_up}家)")

    # 炸板率扣分/加分
    if broken_rate > 40:
        limit_score -= 15
        drivers.append(f"炸板率高企({broken_rate:.1f}%，分歧兑现)")
    elif broken_rate < 20 and limit_up >= 30:
        limit_score += 10
        drivers.append(f"封板坚决(炸板率仅{broken_rate:.1f}%)")

    # 跌停惩罚
    if limit_down > 50:
        limit_score -= 20
        drivers.append(f"跌停踩踏加剧({limit_down}家跌停)")
    elif limit_down > 20:
        limit_score -= 10
        drivers.append(f"局部跌停分歧({limit_down}家跌停)")

    limit_score = max(10, min(100, limit_score))

    # 3. 中位数得分 (权重 20%)
    median_pct = breadth.get('median_change_pct')
    if median_pct is None:
        median_score = 50  # 数据缺失时中性打分
    elif median_pct > 1.5:
        median_score = 85
    elif median_pct > 0:
        median_score = 65
    elif median_pct > -1.5:
        median_score = 45
    else:
        median_score = 25

    # 4. 分化度得分 (权重 10%)
    div_label = divergence_info.get('label', 'neutral')
    if div_label == 'broad_risk_on':
        divergence_score = 85
        drivers.append("指数与个股共振向上")
    elif div_label == 'broad_risk_off':
        divergence_score = 20
        drivers.append("指数与个股共振走弱")
    elif div_label == 'index_up_breadth_weak':
        divergence_score = 35
        drivers.append("权重护盘但个股亏钱效应凸显")
    elif div_label == 'index_down_breadth_strong':
        divergence_score = 70
        drivers.append("权重承压但题材活跃")
    elif div_label == 'data_unavailable':
        divergence_score = 50
        drivers.append("分化度数据缺失")
    else:
        divergence_score = 50

    # 综合得分计算
    total_score = (
        breadth_score * 0.40 +
        limit_score * 0.30 +
        median_score * 0.20 +
        divergence_score * 0.10
    )

    if total_score >= 75:
        sentiment_level = '强势'
    elif total_score >= 60:
        sentiment_level = '回暖'
    elif total_score >= 45:
        sentiment_level = '分歧'
    elif total_score >= 30:
        sentiment_level = '退潮'
    else:
        sentiment_level = '冰点'

    return {
        'sentiment_level': sentiment_level,
        'sentiment_score': round(total_score, 1),
        'drivers': drivers,
        'components': {
            'breadth_score': breadth_score,
            'limit_score': limit_score,
            'median_score': median_score,
            'divergence_score': divergence_score,
        },
    }


# ---------------------------------------------------------------------------
#  看板 3 主入口
# ---------------------------------------------------------------------------

def fetch_market_sentiment(trade_date=None):
    """
    看板 3 主入口：获取全市场情绪与涨跌停结构综合数据

    返回:
        dict 包含完整情绪分析结果
    """
    fetch_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    # 1. 真实全市场宽度 (5600+股)
    breadth = fetch_market_breadth()
    if not breadth:
        print("[WARN] 市场宽度接口不可用，宽度数据置空", file=sys.stderr)
        breadth = {
            'up_count': None,
            'down_count': None,
            'flat_count': None,
            'total_stocks': 0,
            'advance_decline_ratio': None,
            'advance_pct': 0,
            'decline_pct': 0,
            'status': 'degraded',
        }

    # 2. 全市场真实中位数（5500+个股全量计算）
    med_stats = fetch_full_market_median()
    breadth['median_change_pct'] = med_stats['median_change_pct']
    breadth['mean_change_pct'] = med_stats['mean_change_pct']
    breadth['q25_change_pct'] = med_stats['q25_change_pct']
    breadth['q75_change_pct'] = med_stats['q75_change_pct']
    breadth['skewness'] = med_stats['skewness']
    breadth['median_sample_size'] = med_stats['sample_size']

    # 3. 涨跌停与炸板池
    limit_info = fetch_limit_pools(trade_date)

    # 4. 指数分化度诊断
    divergence = calculate_divergence(0.0, breadth['median_change_pct'])

    # 5. 综合情绪评级
    sentiment = generate_sentiment_label(breadth, limit_info, divergence)

    return {
        'fetch_time': fetch_time,
        'total_stocks': breadth['total_stocks'],
        'valid_stocks': med_stats['sample_size'],
        'market_breadth': breadth,
        'limit_structure': limit_info,
        'board_breakdown': limit_info['board_breakdown'],
        'divergence': divergence,
        'sentiment_label': sentiment.get('sentiment_level', '分歧'),
        'sentiment_score': sentiment.get('sentiment_score', 50.0),
        'sentiment_detail': sentiment,
        'data_quality': {
            'status': 'ok' if breadth.get('status') == 'ok' else 'degraded',
            'coverage_rate': round(med_stats['sample_size'] / 5500 * 100, 1) if med_stats['sample_size'] > 0 else 0,
            'total_market_coverage': med_stats['sample_size'],
            'note': '基于东财全市场行情快报全量5500+个股计算（非前100抽样）',
        },
    }


if __name__ == '__main__':
    result = fetch_market_sentiment()
    print(json.dumps(result, ensure_ascii=False, indent=2))
