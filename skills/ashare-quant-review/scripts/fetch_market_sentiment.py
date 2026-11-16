#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_market_sentiment.py - 市场情绪与涨跌停结构统计
核心功能:
1. 全市场涨停/跌停家数统计（按2026年7月新规分层）
2. 全市场涨跌家数与中位数涨跌幅
3. 指数与个股分化度识别（权重护盘/题材唱戏等结构特征）
4. 标准化情绪标签生成
"""

import urllib.request
import json
import statistics
from datetime import datetime

def get_limit_threshold(stock_code, stock_name):
    """
    根据股票代码和名称判定涨跌幅限制（2026年7月新规）

    参数:
        stock_code: 股票代码（不含市场前缀）
        stock_name: 股票名称

    返回:
        float: 涨跌幅限制（如0.10表示10%），None表示无限制
    """
    # 新股判定（上市前5日无涨跌幅限制）
    if stock_name.startswith('N') or stock_name.startswith('C'):
        return None

    # 板块判定（按代码前缀）
    if stock_code.startswith('688'):  # 科创板
        return 0.20
    elif stock_code.startswith('300'):  # 创业板
        return 0.20
    elif stock_code.startswith('43') or stock_code.startswith('83'):  # 北交所
        return 0.30
    else:  # 主板（沪深）
        # 2026年7月新规：主板ST涨跌幅从5%升至10%
        return 0.10

def classify_board(stock_code, stock_name):
    """
    分类股票所属板块

    返回:
        str: 'mainboard', 'chinext', 'star', 'bse', 'new_stock'
    """
    if stock_name.startswith('N') or stock_name.startswith('C'):
        return 'new_stock'
    elif stock_code.startswith('688'):
        return 'star'
    elif stock_code.startswith('300'):
        return 'chinext'
    elif stock_code.startswith('43') or stock_code.startswith('83'):
        return 'bse'
    else:
        return 'mainboard'

def is_limit_up(high, prev_close, threshold, tolerance=0.01):
    """
    判定是否涨停

    参数:
        high: 最高价
        prev_close: 昨收价
        threshold: 涨跌幅限制
        tolerance: 容差（元），避免浮点误差，默认0.01元（A股最小变动单位）
    """
    if threshold is None or prev_close is None or prev_close <= 0:
        return False
    limit_price = round(prev_close * (1 + threshold), 2)
    return high >= limit_price - tolerance

def is_limit_down(low, prev_close, threshold, tolerance=0.01):
    """
    判定是否跌停（容差0.01元，A股最小变动单位）
    """
    if threshold is None or prev_close is None or prev_close <= 0:
        return False
    limit_price = round(prev_close * (1 - threshold), 2)
    return low <= limit_price + tolerance

def is_sealed_limit_up(close, high, prev_close, threshold, tolerance=0.01):
    """
    判定是否封死涨停（收盘价也在涨停价，容差0.01元）
    """
    if not is_limit_up(high, prev_close, threshold, tolerance):
        return False
    limit_price = round(prev_close * (1 + threshold), 2)
    return close >= limit_price - tolerance

def is_broken_board(high, close, prev_close, threshold, tolerance=0.01):
    """
    判定是否炸板（触及涨停但收盘未封住，容差0.01元）
    注意：此为近似计算，无法区分"开盘涨停"与"盘中触板回落"
    """
    if not is_limit_up(high, prev_close, threshold, tolerance):
        return False
    limit_price = round(prev_close * (1 + threshold), 2)
    return close < limit_price - tolerance

def fetch_market_sentiment():
    """
    获取全市场情绪与涨跌停结构数据
    """
    # 东方财富全市场行情接口
    # fs参数: m:0+t:6,m:0+t:80(沪深主板) m:1+t:2,m:1+t:23(沪深主板)
    # 实际需要覆盖：主板、创业板、科创板、北交所
    # fid=f12: 按股票代码排序（不按涨跌幅排序，避免采样偏差）
    url = 'http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=6000&np=1&fltt=2&invt=2&fid=f12&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048&fields=f12,f14,f2,f3,f15,f16,f17,f18'

    result = {
        'fetch_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'total_stocks': 0,
        'valid_stocks': 0,
        'market_breadth': {},
        'limit_structure': {},
        'board_breakdown': {},
        'divergence': {},
        'sentiment_label': '',
        'data_quality': {}
    }

    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))

            if not data.get('data') or not data['data'].get('diff'):
                result['data_quality']['status'] = 'error'
                result['data_quality']['message'] = 'API返回数据为空'
                return result

            stocks = data['data']['diff']
            result['total_stocks'] = len(stocks)

            # 统计变量
            pct_changes = []
            up_count = 0
            down_count = 0
            flat_count = 0

            limit_up_total = 0
            limit_down_total = 0
            sealed_limit_up = 0
            broken_board_count = 0
            new_stock_count = 0

            # 分板块统计
            board_stats = {
                'mainboard': {'limit_up': 0, 'limit_down': 0, 'total': 0},
                'chinext': {'limit_up': 0, 'limit_down': 0, 'total': 0},
                'star': {'limit_up': 0, 'limit_down': 0, 'total': 0},
                'bse': {'limit_up': 0, 'limit_down': 0, 'total': 0},
                'new_stock': {'count': 0, 'extreme_up': 0, 'extreme_down': 0}
            }

            for s in stocks:
                code = s.get('f12', '')
                name = s.get('f14', '')

                # 类型转换和数据有效性检查
                try:
                    price = float(s.get('f2', 0))
                    pct_chg = float(s.get('f3', 0))
                    high = float(s.get('f15', 0))
                    low = float(s.get('f16', 0))
                    prev_close = float(s.get('f18', 0))
                except (ValueError, TypeError):
                    continue

                if prev_close <= 0:
                    continue

                result['valid_stocks'] += 1
                pct_changes.append(pct_chg)

                # 涨跌统计
                if pct_chg > 0:
                    up_count += 1
                elif pct_chg < 0:
                    down_count += 1
                else:
                    flat_count += 1

                # 板块分类
                board = classify_board(code, name)
                threshold = get_limit_threshold(code, name)

                # 新股单独统计（无涨跌幅限制）
                if board == 'new_stock':
                    new_stock_count += 1
                    board_stats['new_stock']['count'] += 1
                    if pct_chg > 20:
                        board_stats['new_stock']['extreme_up'] += 1
                    elif pct_chg < -20:
                        board_stats['new_stock']['extreme_down'] += 1
                    continue

                # 有涨跌幅限制的股票
                board_stats[board]['total'] += 1

                # 涨停判定
                if is_limit_up(high, prev_close, threshold):
                    limit_up_total += 1
                    board_stats[board]['limit_up'] += 1

                    # 封板/炸板判定
                    if is_sealed_limit_up(price, high, prev_close, threshold):
                        sealed_limit_up += 1
                    elif is_broken_board(high, price, prev_close, threshold):
                        broken_board_count += 1

                # 跌停判定
                if is_limit_down(low, prev_close, threshold):
                    limit_down_total += 1
                    board_stats[board]['limit_down'] += 1

            # 计算市场宽度指标
            if pct_changes:
                pct_changes_sorted = sorted(pct_changes)
                median_pct = statistics.median(pct_changes)
                mean_pct = statistics.mean(pct_changes)
            else:
                median_pct = 0.0
                mean_pct = 0.0

            result['market_breadth'] = {
                'up_count': up_count,
                'down_count': down_count,
                'flat_count': flat_count,
                'advance_decline_ratio': round(up_count / down_count, 2) if down_count > 0 else 999.99,
                'advance_pct': round(up_count / result['valid_stocks'] * 100, 2) if result['valid_stocks'] > 0 else 0,
                'decline_pct': round(down_count / result['valid_stocks'] * 100, 2) if result['valid_stocks'] > 0 else 0,
                'median_change_pct': round(median_pct, 2),
                'mean_change_pct': round(mean_pct, 2)
            }

            # 涨跌停结构
            limit_up_touched = sealed_limit_up + broken_board_count
            seal_rate = round(sealed_limit_up / limit_up_touched * 100, 2) if limit_up_touched > 0 else 0
            broken_rate = round(broken_board_count / limit_up_touched * 100, 2) if limit_up_touched > 0 else 0

            result['limit_structure'] = {
                'limit_up_count': limit_up_total,
                'limit_down_count': limit_down_total,
                'sealed_limit_up_count': sealed_limit_up,
                'broken_board_count': broken_board_count,
                'seal_rate': seal_rate,
                'broken_board_rate': broken_rate,
                'new_stock_count': new_stock_count,
                'note': '炸板率为近似计算（最高触板但收盘未封），无法区分开盘涨停与盘中触板'
            }

            # 分板块明细
            result['board_breakdown'] = board_stats

            # 数据质量标记
            result['data_quality'] = {
                'status': 'ok',
                'coverage_rate': round(result['valid_stocks'] / result['total_stocks'] * 100, 2) if result['total_stocks'] > 0 else 0,
                'note': f"成功获取{result['valid_stocks']}只股票有效数据"
            }

    except Exception as e:
        result['data_quality'] = {
            'status': 'error',
            'message': str(e)
        }

    return result

def calculate_divergence(index_pct, median_stock_pct):
    """
    计算指数与个股分化度，并生成结构标签

    参数:
        index_pct: 指数涨跌幅（如上证指数）
        median_stock_pct: 全市场个股中位数涨跌幅

    返回:
        dict: 包含分化度数值与结构标签
    """
    divergence_value = round(index_pct - median_stock_pct, 2)

    # 结构标签判定
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
        'description': desc
    }

def generate_sentiment_label(breadth, limit_structure, divergence_info):
    """
    基于市场宽度、涨跌停结构和分化度生成标准化情绪标签

    返回:
        dict: 包含情绪等级、驱动因素列表
    """
    drivers = []

    # 上涨家数占比
    advance_pct = breadth.get('advance_pct', 0)
    if advance_pct > 70:
        breadth_score = 80
        drivers.append(f"上涨面广（{advance_pct:.1f}%个股上涨）")
    elif advance_pct > 50:
        breadth_score = 60
        drivers.append(f"上涨家数过半（{advance_pct:.1f}%）")
    elif advance_pct > 30:
        breadth_score = 40
        drivers.append(f"上涨家数偏弱（{advance_pct:.1f}%）")
    else:
        breadth_score = 20
        drivers.append(f"普跌格局（{advance_pct:.1f}%上涨）")

    # 涨停结构
    limit_up_count = limit_structure.get('limit_up_count', 0)
    broken_rate = limit_structure.get('broken_board_rate', 0)

    if limit_up_count > 100:
        limit_score = 80
        drivers.append(f"涨停潮({limit_up_count}家涨停)")
    elif limit_up_count > 50:
        limit_score = 60
        drivers.append(f"涨停活跃({limit_up_count}家)")
    elif limit_up_count > 20:
        limit_score = 40
    else:
        limit_score = 20
        if limit_up_count > 0:
            drivers.append(f"涨停稀缺({limit_up_count}家)")

    # 炸板率判定
    if broken_rate > 40:
        limit_score -= 20
        drivers.append(f"炸板率高({broken_rate:.1f}%，情绪分歧)")

    # 中位数涨跌幅
    median_pct = breadth.get('median_change_pct', 0)
    if median_pct > 2:
        median_score = 80
    elif median_pct > 0:
        median_score = 60
    elif median_pct > -2:
        median_score = 40
    else:
        median_score = 20

    # 分化度
    divergence_label = divergence_info.get('label', 'neutral')
    if divergence_label == 'index_up_breadth_weak':
        drivers.append("权重护盘但个股走弱")
        divergence_score = 30
    elif divergence_label == 'broad_risk_on':
        drivers.append("指数与个股共振向上")
        divergence_score = 80
    elif divergence_label == 'broad_risk_off':
        drivers.append("指数与个股共振下跌")
        divergence_score = 20
    else:
        divergence_score = 50

    # 综合评分
    total_score = (breadth_score * 0.4 + limit_score * 0.3 +
                   median_score * 0.2 + divergence_score * 0.1)

    # 情绪等级映射
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
            'divergence_score': divergence_score
        }
    }

if __name__ == '__main__':
    # 测试运行
    result = fetch_market_sentiment()
    print(json.dumps(result, ensure_ascii=False, indent=2))

    # 测试分化度计算（示例）
    divergence = calculate_divergence(0.5, -0.3)
    print("\n指数与个股分化度测试:")
    print(json.dumps(divergence, ensure_ascii=False, indent=2))

    # 测试情绪标签生成
    if result.get('market_breadth'):
        sentiment = generate_sentiment_label(
            result['market_breadth'],
            result['limit_structure'],
            divergence
        )
        print("\n情绪标签测试:")
        print(json.dumps(sentiment, ensure_ascii=False, indent=2))
