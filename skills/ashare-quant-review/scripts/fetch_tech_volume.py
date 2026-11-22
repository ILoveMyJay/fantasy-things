#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_tech_volume.py — 看板 2：大盘总量能、双创 TCR 拥挤度与 VR20

融合版修复要点：
  1. is_trading_time() 接入 calendar_guard，法定假日/非交易日严格返回休市态
  2. 累加北交所成交额（bj899050）至全市场总量能
  3. 彻底删除 1.0035 官方全板块快报估算冗余行
  4. 修复 TCR 33%-40% 缝隙，判定为"结构分歧警戒区"
  5. 正式补全实现 VR20（成交量比率指标）
"""

import urllib.request
import json
import sys
import math
from datetime import datetime, time, date
from pathlib import Path

# 接入交易日历守卫
try:
    from utils.calendar_guard import is_trade_date, is_trading_time as _cal_trading_time
    _HAS_CALENDAR_GUARD = True
except ImportError:
    _HAS_CALENDAR_GUARD = False
    print("[WARN] calendar_guard 未安装，将使用简易周末排查（不含法定假日）", file=sys.stderr)

# ---------------------------------------------------------------------------
#  A股日内经验分时累计成交量分布权重模型 (Volume Profile Weights)
# ---------------------------------------------------------------------------
VOLUME_PROFILE = [
    (0, 0.0),
    (15, 0.16),
    (30, 0.28),
    (60, 0.42),
    (90, 0.50),
    (120, 0.58),
    (150, 0.68),
    (180, 0.78),
    (210, 0.88),
    (240, 1.00),
]


def get_cumulative_volume_weight(elapsed_minutes):
    """根据已开盘分钟数进行分段线性插值计算U型权重"""
    if elapsed_minutes <= 0:
        return 0.001
    if elapsed_minutes >= 240:
        return 1.0
    for i in range(len(VOLUME_PROFILE) - 1):
        m1, w1 = VOLUME_PROFILE[i]
        m2, w2 = VOLUME_PROFILE[i + 1]
        if m1 <= elapsed_minutes <= m2:
            return w1 + (w2 - w1) * ((elapsed_minutes - m1) / (m2 - m1))
    return 1.0


def is_trading_time(dt=None):
    """
    判断当前是否处于A股交易时段（盘中态）

    优先使用 calendar_guard 进行交易日历校验（排除法定假日），
    回退至简易周末排查。

    返回:
        tuple: (is_intraday, elapsed_minutes, session_phase)
    """
    now = datetime.now() if dt is None else dt
    today_str = now.strftime('%Y-%m-%d')

    # 1. 交易日历校验（含法定假日排除）
    if _HAS_CALENDAR_GUARD:
        if not is_trade_date(today_str):
            return (False, 240, 'holiday_closed')
        # 使用 calendar_guard 的 is_trading_time 获取精确状态
        cal_result = _cal_trading_time(now)
        return cal_result
    else:
        # 简易回退：仅排除周末
        if now.weekday() >= 5:
            return (False, 240, 'after_hours')

    current_time = now.time()
    morning_start = time(9, 30)
    morning_end = time(11, 30)
    afternoon_start = time(13, 0)
    afternoon_end = time(15, 0)

    if current_time < morning_start:
        return (False, 0, 'pre_market')
    elif morning_start <= current_time < morning_end:
        delta = datetime.combine(now.date(), current_time) - datetime.combine(now.date(), morning_start)
        elapsed = max(1, int(delta.total_seconds() / 60))
        return (True, elapsed, 'morning')
    elif morning_end <= current_time < afternoon_start:
        return (False, 120, 'noon_break')
    elif afternoon_start <= current_time < afternoon_end:
        delta = datetime.combine(now.date(), current_time) - datetime.combine(now.date(), afternoon_start)
        elapsed = 120 + int(delta.total_seconds() / 60)
        return (True, elapsed, 'afternoon')
    else:
        return (False, 240, 'after_hours')


def estimate_full_day_volume(current_amount, elapsed_minutes, total_minutes=240):
    """
    根据A股日内流动性U型经验分布加权估算全天成交额

    非交易日/盘后直接返回当前值，绝对禁止U型除法外推
    """
    if elapsed_minutes <= 0:
        return current_amount
    if elapsed_minutes >= total_minutes:
        return round(current_amount, 2)

    weight = get_cumulative_volume_weight(elapsed_minutes)
    if weight <= 0:
        return current_amount
    estimated = current_amount / weight
    return round(estimated, 2)


# ---------------------------------------------------------------------------
#  VR20 成交量比率指标（指标 #13，从阈值配置补全至代码实现）
# ---------------------------------------------------------------------------

def calculate_vr20():
    """
    计算全市场成交量比率 VR20

    公式: VR20 = (sum(V_up) + 0.5 * sum(V_flat)) / (sum(V_down) + 0.5 * sum(V_flat)) * 100
      - V_up: 过去20个交易日中上涨日的成交额
      - V_down: 过去20个交易日中下跌日的成交额
      - V_flat: 过去20个交易日中平盘日的成交额

    阈值:
      - VR20 < 70: 中线超卖低吸区
      - VR20 > 250: 中线极度过热出货区
      - 70 <= VR20 <= 250: 常态均衡量能区间

    返回:
        dict 包含 vr20, status, v_up, v_down, v_flat, trading_days_used
        若数据不足返回 None 相关字段
    """
    # 获取上证指数最近21根日K线（20个交易日需要至少21根来判断涨跌）
    try:
        url_sh = ('http://push2his.eastmoney.com/api/qt/stock/kline/get'
                   '?secid=1.000001'
                   '&fields1=f1,f2,f3,f4,f5,f6'
                   '&fields2=f51,f52,f53,f54,f55,f56,f57'
                   '&klt=101&fqt=1&end=20500101&lmt=25')
        url_sz = ('http://push2his.eastmoney.com/api/qt/stock/kline/get'
                   '?secid=0.399001'
                   '&fields1=f1,f2,f3,f4,f5,f6'
                   '&fields2=f51,f52,f53,f54,f55,f56,f57'
                   '&klt=101&fqt=1&end=20500101&lmt=25')
        headers = {'User-Agent': 'Mozilla/5.0'}

        req_sh = urllib.request.Request(url_sh, headers=headers)
        req_sz = urllib.request.Request(url_sz, headers=headers)

        with urllib.request.urlopen(req_sh, timeout=5) as r1, \
             urllib.request.urlopen(req_sz, timeout=5) as r2:
            klines_sh = json.loads(r1.read().decode())['data']['klines']
            klines_sz = json.loads(r2.read().decode())['data']['klines']

        if len(klines_sh) < 21 or len(klines_sz) < 21:
            print("[WARN] VR20计算所需K线数据不足", file=sys.stderr)
            return {
                'vr20': None,
                'status': '数据不足',
                'v_up': 0, 'v_down': 0, 'v_flat': 0,
                'trading_days_used': 0,
            }

        # 取最近20根（排除最后一根可能是当日未收盘数据）
        # 格式: 日期,开盘,收盘,最高,最低,成交量(手),成交额(元)
        v_up = 0.0
        v_down = 0.0
        v_flat = 0.0
        days_used = 0

        # 使用最近20个已完成交易日
        sh_data = klines_sh[-21:-1] if len(klines_sh) >= 22 else klines_sh[-21:]
        sz_data = klines_sz[-21:-1] if len(klines_sz) >= 22 else klines_sz[-21:]

        for i in range(min(len(sh_data), len(sz_data))):
            sh_parts = sh_data[i].split(',')
            sz_parts = sz_data[i].split(',')

            # 成交额（元 → 亿元）
            sh_amt = float(sh_parts[6]) / 1e8
            sz_amt = float(sz_parts[6]) / 1e8
            day_amt = sh_amt + sz_amt

            # 上证涨跌判断（收盘 vs 开盘）
            sh_open = float(sh_parts[1])
            sh_close = float(sh_parts[2])

            if sh_close > sh_open:
                v_up += day_amt
            elif sh_close < sh_open:
                v_down += day_amt
            else:
                v_flat += day_amt

            days_used += 1

        # 计算 VR20
        denominator = v_down + 0.5 * v_flat
        if denominator <= 0:
            vr20 = 999.99  # 分母为零，表明全部上涨
        else:
            vr20 = round((v_up + 0.5 * v_flat) / denominator * 100, 2)

        # 状态判定
        if vr20 < 70:
            vr_status = "中线超卖低吸区"
            vr_level = "OVERSOLD"
        elif vr20 > 250:
            vr_status = "中线极度过热出货区"
            vr_level = "OVERHEATED"
        else:
            vr_status = "常态均衡量能区间"
            vr_level = "BALANCED"

        return {
            'vr20': vr20,
            'status': vr_status,
            'level': vr_level,
            'v_up': round(v_up, 2),
            'v_down': round(v_down, 2),
            'v_flat': round(v_flat, 2),
            'trading_days_used': days_used,
        }

    except Exception as e:
        print(f"[WARN] VR20计算异常: {e}", file=sys.stderr)
        return {
            'vr20': None,
            'status': '接口异常',
            'v_up': 0, 'v_down': 0, 'v_flat': 0,
            'trading_days_used': 0,
        }


# ---------------------------------------------------------------------------
#  历史成交额环比
# ---------------------------------------------------------------------------

def fetch_market_volume_delta():
    """
    通过历史日K线计算沪深两市上一交易日成交额及环比增减额/增减比例
    """
    try:
        url_sh = ('http://push2his.eastmoney.com/api/qt/stock/kline/get'
                   '?secid=1.000001'
                   '&fields1=f1,f2,f3,f4,f5,f6'
                   '&fields2=f51,f52,f53,f54,f55,f56,f57'
                   '&klt=101&fqt=1&end=20500101&lmt=5')
        url_sz = ('http://push2his.eastmoney.com/api/qt/stock/kline/get'
                   '?secid=0.399001'
                   '&fields1=f1,f2,f3,f4,f5,f6'
                   '&fields2=f51,f52,f53,f54,f55,f56,f57'
                   '&klt=101&fqt=1&end=20500101&lmt=5')
        headers = {'User-Agent': 'Mozilla/5.0'}
        req_sh = urllib.request.Request(url_sh, headers=headers)
        req_sz = urllib.request.Request(url_sz, headers=headers)
        with urllib.request.urlopen(req_sh, timeout=4) as r1, \
             urllib.request.urlopen(req_sz, timeout=4) as r2:
            d_sh = json.loads(r1.read().decode())['data']['klines']
            d_sz = json.loads(r2.read().decode())['data']['klines']
            if len(d_sh) >= 2 and len(d_sz) >= 2:
                prev_sh_amt = float(d_sh[-2].split(',')[6]) / 1e8
                prev_sz_amt = float(d_sz[-2].split(',')[6]) / 1e8
                prev_total = round(prev_sh_amt + prev_sz_amt, 2)
                prev_date = d_sh[-2].split(',')[0]
                return {
                    'prev_trade_date': prev_date,
                    'prev_total_market_amt': prev_total,
                }
    except Exception as e:
        sys.stderr.write(f"Warning: fetch_market_volume_delta: {e}\n")
    return None


# ---------------------------------------------------------------------------
#  看板 2 主入口
# ---------------------------------------------------------------------------

def fetch_tech_volume_dashboard():
    """
    看板 2 主入口：大盘总量能、双创 TCR 拥挤度与 VR20

    返回:
        dict 包含完整量能数据
    """
    # 拉取指数行情（含北交所 bj899050）
    symbols = ['sh000001', 'sz399001', 'sz399102', 'sz399006',
               'sh000680', 'sh000688', 'sh000685', 'bj899050']
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
                        'amount_yi': round(amt_yi, 2),
                    }
    except Exception as e:
        sys.stderr.write(f"Warning: fetch_tech_volume quotes: {e}\n")

    # 计算全市场成交额（沪 + 深 + 北交所）
    sh_amt = indices.get('000001', {}).get('amount_yi', 0)
    sz_amt = indices.get('399001', {}).get('amount_yi', 0)
    bj_amt = indices.get('899050', {}).get('amount_yi', 0)
    total_market_amt = round(sh_amt + sz_amt + bj_amt, 2)

    # 盘中态识别与分时加权量能估算
    is_intraday, elapsed_minutes, session_phase = is_trading_time()

    # 非交易日严禁U型外推
    if session_phase == 'holiday_closed':
        estimated_full_day = total_market_amt
        volume_estimate_note = f"非交易日（{session_phase}），不进行盘中外推"
        is_intraday = False
    elif is_intraday:
        estimated_full_day = estimate_full_day_volume(total_market_amt, elapsed_minutes)
        if elapsed_minutes <= 15:
            volume_estimate_note = (
                f"开盘初期（开盘{elapsed_minutes}分钟），"
                f"当前{total_market_amt}亿元，预估全天{estimated_full_day}亿元"
                f"（早盘集中换手，估算波动较大）"
            )
        else:
            volume_estimate_note = (
                f"盘中态（开盘{elapsed_minutes}分钟/加权折算），"
                f"当前{total_market_amt}亿元，预估全天{estimated_full_day}亿元"
            )
    else:
        estimated_full_day = total_market_amt
        volume_estimate_note = f"盘后数据（{session_phase}），全天成交额{total_market_amt}亿元"

    # 获取历史环比成交额
    delta_info = fetch_market_volume_delta()
    if delta_info and delta_info.get('prev_total_market_amt'):
        prev_amt = delta_info['prev_total_market_amt']
        compare_amt = estimated_full_day if is_intraday else total_market_amt
        delta_amt = round(compare_amt - prev_amt, 2)
        delta_pct = round((delta_amt / prev_amt) * 100.0, 2) if prev_amt > 0 else 0
        if delta_amt > 0:
            volume_edge = f"{'预估' if is_intraday else ''}较前一交易日放量 +{delta_amt} 亿元 (+{delta_pct}%)"
            volume_trend = "EXPANDING"
        else:
            volume_edge = f"{'预估' if is_intraday else ''}较前一交易日缩量 {abs(delta_amt)} 亿元 ({delta_pct}%)"
            volume_trend = "SHRINKING"
    else:
        prev_amt = None
        delta_amt = None
        delta_pct = None
        volume_edge = "前一交易日数据暂不可用"
        volume_trend = "UNKNOWN"

    # 双创量能
    chinext_amt = indices.get('399102', {}).get('amount_yi', 0)
    star_amt = indices.get('000680', {}).get('amount_yi', 0)
    star50_amt = indices.get('000688', {}).get('amount_yi', 0)
    semi_amt = indices.get('000685', {}).get('amount_yi', 0)

    # TCR 拥挤度
    if total_market_amt > 0:
        tcr_chinext = round((chinext_amt / total_market_amt) * 100.0, 2)
        tcr_star = round((star_amt / total_market_amt) * 100.0, 2)
        tcr_double_tech = round(tcr_chinext + tcr_star, 2)
        tcr_semi = round((semi_amt / total_market_amt) * 100.0, 2)
    else:
        tcr_chinext = tcr_star = tcr_double_tech = tcr_semi = 0.0

    # 修复后的拥挤度状态判定（补全 33%-40% 缝隙）
    if tcr_double_tech > 40.0:
        crowding_status = "极端过热与流动性虹吸（需警惕高位分歧兑现与筹码出清）"
        crowding_level = "HIGH_ALERT"
    elif tcr_double_tech > 33.0:
        crowding_status = "结构分歧警戒区（主线成长加速分化，只持有核心龙头，防范后排跟风退潮）"
        crowding_level = "CAUTION"
    elif tcr_double_tech >= 25.0:
        crowding_status = "健康活跃与良性换手（主线良性上升或健康震荡）"
        crowding_level = "HEALTHY"
    elif tcr_double_tech >= 20.0:
        crowding_status = "风格降温与资金轮出（双创板块交投降温，资金向蓝筹红利切换）"
        crowding_level = "COOLING"
    else:
        crowding_status = "情绪冰点与极度缩量（关注重要支撑位的左侧战略布局机会）"
        crowding_level = "FREEZING_OPPORTUNITY"

    # VR20 计算
    vr20_data = calculate_vr20()

    return {
        'total_market_amount_yi': total_market_amt,
        'sh_amount_yi': sh_amt,
        'sz_amount_yi': sz_amt,
        'bj_amount_yi': bj_amt,
        'estimated_full_day_yi': estimated_full_day,
        'is_intraday_estimate': is_intraday,
        'session_phase': session_phase,
        'elapsed_trading_minutes': elapsed_minutes,
        'volume_estimate_note': volume_estimate_note,
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
        'tcr_semi': tcr_semi,
        'crowding_status': crowding_status,
        'crowding_level': crowding_level,
        'vr20': vr20_data,
        'indices_detail': indices,
    }


if __name__ == '__main__':
    res = fetch_tech_volume_dashboard()
    print(json.dumps(res, ensure_ascii=False, indent=2))
