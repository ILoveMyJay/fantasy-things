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
      - 优先采用腾讯日K线接口（高可用、零限流）拉取上证+深证近 21 个已完成交易日成交量与收盘价；
      - 涨跌日严格以“当日收盘 vs 前一交易日收盘”判定。

    阈值:
      - VR20 < 70: 中线超卖低吸区
      - VR20 > 250: 中线极度过热出货区
      - 70 <= VR20 <= 250: 常态均衡量能区间
    """
    try:
        headers = {'User-Agent': 'Mozilla/5.0'}

        def _fetch_tx_kline(sym):
            u = f'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={sym},day,,,26,qfq'
            with urllib.request.urlopen(urllib.request.Request(u, headers=headers), timeout=5) as r:
                d = json.loads(r.read().decode('utf-8')).get('data', {}).get(sym, {})
                return d.get('day') or d.get('qfqday') or []

        tx_sh = _fetch_tx_kline('sh000001')
        tx_sz = _fetch_tx_kline('sz399001')

        if len(tx_sh) < 21 or len(tx_sz) < 21:
            return {
                'vr20': None,
                'status': '数据不足',
                'v_up': 0, 'v_down': 0, 'v_flat': 0,
                'trading_days_used': 0,
            }

        today_str = datetime.now().strftime('%Y-%m-%d')
        # 剔除当日未收盘柱，保留最近 21 个已完成交易日（计算 20 个涨跌日）
        sh_done = [r for r in tx_sh if len(r) >= 6 and r[0] < today_str][-21:]
        sz_by_date = {r[0]: float(r[5]) for r in tx_sz if len(r) >= 6 and r[0] < today_str}

        v_up = 0.0
        v_down = 0.0
        v_flat = 0.0
        days_used = 0

        for i in range(1, len(sh_done)):
            d_str = sh_done[i][0]
            prev_close = float(sh_done[i - 1][2])
            curr_close = float(sh_done[i][2])
            day_vol = float(sh_done[i][5]) + sz_by_date.get(d_str, 0.0)

            if curr_close > prev_close:
                v_up += day_vol
            elif curr_close < prev_close:
                v_down += day_vol
            else:
                v_flat += day_vol
            days_used += 1

        if days_used < 10:
            return {
                'vr20': None,
                'status': '数据不足',
                'v_up': 0, 'v_down': 0, 'v_flat': 0,
                'trading_days_used': days_used,
            }

        denominator = v_down + 0.5 * v_flat
        if denominator <= 0:
            vr20 = 999.99
        else:
            vr20 = round((v_up + 0.5 * v_flat) / denominator * 100.0, 2)

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
            'v_up': round(v_up / 1e8, 2),
            'v_down': round(v_down / 1e8, 2),
            'v_flat': round(v_flat / 1e8, 2),
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

def _fetch_official_exchange_prev_turnover(quote_date_str=None):
    """
    高可用备选源：直连上交所(query.sse.com.cn) + 深交所(szse.cn)官方每日成交概况接口，
    获取前一完整交易日的沪深股票总成交额（亿元），彻底免疫东财 push2his 限流。
    """
    try:
        from utils.calendar_guard import get_recent_trade_dates
        recent = get_recent_trade_dates(count=5)
    except Exception:
        return None

    target_qdate = None
    if quote_date_str and len(quote_date_str) == 8:
        target_qdate = f"{quote_date_str[:4]}-{quote_date_str[4:6]}-{quote_date_str[6:8]}"
    else:
        target_qdate = datetime.now().strftime('%Y-%m-%d')

    prev_candidates = [d for d in recent if d < target_qdate]
    if not prev_candidates:
        return None
    prev_date = prev_candidates[-1]

    # 1. 上交所官方股票成交额（PRODUCT_CODE 01=主板A, 02=主板B, 03=科创板）
    sh_amt = None
    try:
        u_sse = f'https://query.sse.com.cn/commonQuery.do?sqlId=COMMON_SSE_SJ_GPSJ_CJGK_MRGK_C&SEARCH_DATE={prev_date}'
        req = urllib.request.Request(u_sse, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.sse.com.cn/'})
        with urllib.request.urlopen(req, timeout=5) as r:
            rows = json.loads(r.read().decode('utf-8')).get('result') or []
            tot_sh = 0.0
            found = False
            for row in rows:
                if row.get('PRODUCT_CODE') in ('01', '02', '03') and row.get('TRADE_AMT') not in (None, '', '-'):
                    tot_sh += float(str(row['TRADE_AMT']).replace(',', ''))
                    found = True
            if found and tot_sh > 0:
                sh_amt = round(tot_sh, 2)
    except Exception:
        pass

    # 2. 深交所官方股票成交额（CATALOGID=1803）
    sz_amt = None
    try:
        u_sz = f'https://www.szse.cn/api/report/ShowReport/data?SHOWTYPE=JSON&CATALOGID=1803&TABKEY=tab1&txtQueryDate={prev_date}'
        req = urllib.request.Request(u_sz, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.szse.cn/'})
        with urllib.request.urlopen(req, timeout=5) as r:
            arr = json.loads(r.read().decode('utf-8'))
            for row in (arr[0].get('data') or []) if arr else []:
                if '股票成交金额' in str(row.get('zbmc', '')):
                    val = str(row.get('brsz', '')).replace(',', '').strip()
                    if val and val != '-':
                        sz_amt = round(float(val), 2)
                        break
    except Exception:
        pass

    if sh_amt is not None and sz_amt is not None:
        return {
            'prev_trade_date': prev_date,
            'prev_total_market_amt': round(sh_amt + sz_amt, 2),
            'prev_sh_amt': sh_amt,
            'prev_sz_amt': sz_amt,
            'prev_bj_amt': 0.0,
            'includes_bj': False,
            'source': 'sse_szse_official',
        }
    return None


def fetch_market_volume_delta(quote_date_str=None):
    """
    计算上一完整交易日成交额：
      - 主源：上交所+深交所官方每日成交概况（零限流、权威法定口径）；
      - 备源：东财 push2his 日K线（含北交所）。
    失败时返回 None，严禁伪造数据。
    """
    official = _fetch_official_exchange_prev_turnover(quote_date_str)
    if official:
        return official

    import time as _time
    hosts = ['http://push2his.eastmoney.com', 'http://64.push2his.eastmoney.com']
    headers = {'User-Agent': 'Mozilla/5.0'}

    def _get_klines(secid):
        for attempt in range(2):
            for host in hosts:
                try:
                    url = (
                        f'{host}/api/qt/stock/kline/get?secid={secid}'
                        '&fields1=f1,f2,f3,f4,f5,f6'
                        '&fields2=f51,f52,f53,f54,f55,f56,f57'
                        '&klt=101&fqt=1&end=20500101&lmt=5'
                    )
                    req = urllib.request.Request(url, headers=headers)
                    with urllib.request.urlopen(req, timeout=4) as r:
                        data = json.loads(r.read().decode('utf-8')).get('data') or {}
                        kl = data.get('klines') or []
                        if kl:
                            return kl
                except Exception:
                    _time.sleep(0.2)
        return []

    try:
        d_sh = _get_klines('1.000001')
        d_sz = _get_klines('0.399001')
        d_bj = _get_klines('0.899050')

        if len(d_sh) < 2 or len(d_sz) < 2:
            return None

        sh_by_date = {row.split(',')[0]: float(row.split(',')[6]) / 1e8 for row in d_sh}
        sz_by_date = {row.split(',')[0]: float(row.split(',')[6]) / 1e8 for row in d_sz}
        bj_by_date = {row.split(',')[0]: float(row.split(',')[6]) / 1e8 for row in d_bj}

        common_dates = sorted(set(sh_by_date.keys()) & set(sz_by_date.keys()))
        if len(common_dates) < 2:
            return None

        prev_date = common_dates[-2]
        prev_sh = sh_by_date[prev_date]
        prev_sz = sz_by_date[prev_date]
        prev_bj = bj_by_date.get(prev_date, 0.0)
        prev_total = round(prev_sh + prev_sz + prev_bj, 2)
        return {
            'prev_trade_date': prev_date,
            'prev_total_market_amt': prev_total,
            'prev_sh_amt': round(prev_sh, 2),
            'prev_sz_amt': round(prev_sz, 2),
            'prev_bj_amt': round(prev_bj, 2),
            'includes_bj': prev_date in bj_by_date,
            'source': 'eastmoney_push2his',
        }
    except Exception as e:
        sys.stderr.write(f"Warning: fetch_market_volume_delta: {e}\n")
    return None


# ---------------------------------------------------------------------------
#  看板 2 主入口
# ---------------------------------------------------------------------------

def fetch_tech_volume_dashboard():
    """
    看板 2 主入口：大盘总量能、核心宽基指数涨跌、双创 TCR 拥挤度与 VR20

    返回:
        dict 包含完整量能数据
    """
    # 拉取核心宽基与双创指数行情（含沪深300/中证500/中证1000/北交所）
    symbols = [
        'sh000001', 'sz399001', 'sh000300', 'sh000905', 'sz399852',
        'sz399102', 'sz399006', 'sh000680', 'sh000688', 'sh000685', 'bj899050'
    ]
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
    # 午休期间按已开盘120分钟外推全天，盘前/盘后不外推
    elif session_phase in ('lunch_break', 'noon_break'):
        estimated_full_day = estimate_full_day_volume(total_market_amt, 120)
        volume_estimate_note = (
            f"午间休市（半日120分钟/U型折算），"
            f"当前{total_market_amt}亿元，预估全天{estimated_full_day}亿元"
        )
    else:
        estimated_full_day = total_market_amt
        volume_estimate_note = f"盘后/盘前数据（{session_phase}），成交额{total_market_amt}亿元"

    # 获取历史环比成交额（严格同口径对比：若前一日为沪深口径，则当日亦取沪深口径对比）
    delta_info = fetch_market_volume_delta(quote_date)
    use_estimate_for_delta = is_intraday or session_phase in ('lunch_break', 'noon_break')
    if delta_info and delta_info.get('prev_total_market_amt'):
        prev_amt = delta_info['prev_total_market_amt']
        prev_date = delta_info.get('prev_trade_date', 'T-1')
        sh_sz_curr = round(sh_amt + sz_amt, 2)
        if delta_info.get('includes_bj'):
            compare_amt = estimated_full_day if use_estimate_for_delta else total_market_amt
            scope_note = "沪深北"
        else:
            compare_amt = estimate_full_day_volume(sh_sz_curr, elapsed_minutes if is_intraday else 120) if use_estimate_for_delta else sh_sz_curr
            scope_note = "沪深"
        delta_amt = round(compare_amt - prev_amt, 2)
        delta_pct = round((delta_amt / prev_amt) * 100.0, 2) if prev_amt > 0 else 0
        prefix = '预估' if use_estimate_for_delta else ''
        if delta_amt > 0:
            volume_edge = f"{prefix}较前一日({prev_date}/{scope_note})放量 +{delta_amt} 亿元 (+{delta_pct}%)"
            volume_trend = "EXPANDING"
        else:
            volume_edge = f"{prefix}较前一日({prev_date}/{scope_note})缩量 {abs(delta_amt)} 亿元 ({delta_pct}%)"
            volume_trend = "SHRINKING"
    else:
        prev_amt = None
        delta_amt = None
        delta_pct = None
        volume_edge = "前一交易日成交额接口暂不可用（严禁估算填充）"
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
