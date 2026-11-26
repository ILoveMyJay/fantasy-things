# -*- coding: utf-8 -*-
"""看板 4 —— 中金所基差与中信席位分析。

提供 fetch_cffex_basis()、fetch_citic_positions() 和
discriminate_citic_behavior() 确定性四象限判别。
"""

from __future__ import annotations

import sys
import math
from datetime import datetime, date, timedelta
from typing import Any


# ---------------------------------------------------------------------------
# 中信行为四象限阈值
# ---------------------------------------------------------------------------
_NET_SHORT_SURGE_THRESHOLD = 3500    # 净空激增阈值
_NET_SHORT_PLUNGE_THRESHOLD = -3500  # 净空剧减阈值
_VOLUME_SHRINK_THRESHOLD = -5.0      # 两市缩量阈值（%）


# ---------------------------------------------------------------------------
# 基差计算
# ---------------------------------------------------------------------------

def _get_front_contract_info(dt=None):
    """计算当月主力合约代码、到期日与剩余交易日"""
    if dt is None:
        dt = datetime.now()
    first_day = date(dt.year, dt.month, 1)
    first_friday = 1 + (4 - first_day.weekday()) % 7
    third_friday = date(dt.year, dt.month, first_friday + 14)
    if dt.date() > third_friday:
        if dt.month == 12:
            target_year, target_month = dt.year + 1, 1
        else:
            target_year, target_month = dt.year, dt.month + 1
        first_day_next = date(target_year, target_month, 1)
        next_third_friday = date(target_year, target_month, 1 + (4 - first_day_next.weekday()) % 7 + 14)
        expiry_date = next_third_friday
    else:
        target_year, target_month = dt.year, dt.month
        expiry_date = third_friday
    suffix = f"{target_year % 100:02d}{target_month:02d}"
    days = max(1, (expiry_date - dt.date()).days)
    return suffix, expiry_date.strftime("%Y-%m-%d"), days


def fetch_cffex_basis(
    spot_prices: dict[str, float] | None = None,
    futures_prices: dict[str, float] | None = None,
    days_to_expiry: int | None = None,
    next_month_futures_prices: dict[str, float] | None = None,
    next_month_days_to_expiry: int | None = None,
    **kwargs
) -> dict[str, Any]:
    """计算期现基差与年化贴水率（含交割周平滑保护）。

    交割周保护规则：
    - 剩余自然日 days_to_expiry <= 4 时，当月年化标 None (交割周保护)
    - 切换次月主力合约计算年化贴水率，is_extreme_oversold_signal 置 False
    """
    suffix, expiry_str, default_days = _get_front_contract_info()
    days = days_to_expiry if days_to_expiry is not None else default_days

    # 若调用方未显式传入行情，则直连新浪财经
    spot_map = spot_prices if spot_prices is not None else {}
    futures_map = futures_prices if futures_prices is not None else {}
    next_f_map = next_month_futures_prices if next_month_futures_prices is not None else {}
    next_days = next_month_days_to_expiry if next_month_days_to_expiry is not None else 31

    if not spot_map or not futures_map:
        try:
            import urllib.request
            futures_syms = [f"CFF_RE_IF{suffix}", f"CFF_RE_IC{suffix}", f"CFF_RE_IM{suffix}", f"CFF_RE_IH{suffix}"]
            spot_syms = ["sh000300", "sh000905", "sz399852", "sh000016"]
            url = f"https://hq.sinajs.cn/list={','.join(futures_syms + spot_syms)}"
            req = urllib.request.Request(url, headers={'Referer': 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=3) as resp:
                text = resp.read().decode('gbk')
                for line in text.strip().split('\n'):
                    if not line.strip() or '="' not in line:
                        continue
                    k = line.split('="')[0]
                    v = line.split('="')[1].split('";')[0].split(',')
                    if len(v) > 4:
                        price = float(v[3])
                        if "CFF_RE_" in k:
                            pfx = k.split("CFF_RE_")[-1][:2]
                            if pfx not in futures_map:
                                futures_map[pfx] = price
                        elif "sh000300" in k:
                            spot_map['IF'] = price
                        elif "sh000905" in k:
                            spot_map['IC'] = price
                        elif "sz399852" in k or "sh000852" in k:
                            spot_map['IM'] = price
                        elif "sh000016" in k:
                            spot_map['IH'] = price
        except Exception as e:
            sys.stderr.write(f"[WARN] 获取期现基差行情异常: {e}\n")

    # 严禁使用硬编码假价格兜底，接口缺失则置 None
    is_delivery_week = days <= 4
    basis_table = {}

    for prefix in ['IF', 'IC', 'IM', 'IH']:
        s_val = spot_map.get(prefix)
        f_val = futures_map.get(prefix)

        if s_val and f_val:
            basis = round(f_val - s_val, 2)
            if is_delivery_week:
                # 交割周保护：当月年化置空，切换次月
                annualized = None
                is_extreme = False
                if next_f_map.get(prefix):
                    nf_val = next_f_map[prefix]
                    next_ann = ((nf_val - s_val) / s_val) * (365.0 / next_days) * 100.0
                    is_extreme = next_ann <= -25.0
            else:
                annualized = round((basis / s_val) * (365.0 / days) * 100.0, 2)
                is_extreme = annualized <= -25.0

            basis_table[prefix] = {
                'contract': f"{prefix}{suffix}",
                'futures_price': round(f_val, 2),
                'spot_price': round(s_val, 2),
                'basis': basis,
                'annualized_discount_rate': annualized,
                'is_extreme_oversold_signal': is_extreme,
            }
        else:
            basis_table[prefix] = {
                'contract': f"{prefix}{suffix}",
                'futures_price': None,
                'spot_price': None,
                'basis': None,
                'annualized_discount_rate': None,
                'is_extreme_oversold_signal': False,
            }

    return {
        "front_contract_suffix": suffix,
        "expiry_date": expiry_str,
        "days_to_expiry": days,
        "is_delivery_week": is_delivery_week,
        "basis_table": basis_table,
    }


# ---------------------------------------------------------------------------
# 中信席位
# ---------------------------------------------------------------------------

def fetch_citic_positions(
    trade_date: str | None = None,
    positions_data: list[dict] | None = None,
) -> dict[str, Any]:
    """提取中信期货（代客）多空持仓。

    精确匹配 long_party_name == "中信期货(代客)" 和
    short_party_name == "中信期货(代客)"（比较前归一化全/半角括号），绝不用 contains('中信')。

    Parameters
    ----------
    trade_date     : str | None 交易日 (YYYYMMDD)
    positions_data : list[dict] 席位持仓原始数据列表 (用于单测/显式传入)

    Returns
    -------
    dict  含 IF, IC, IM, IH 各品种明细及合计 net_short_chg
    """
    _TARGET = "中信期货(代客)"

    def _norm_party(name) -> str:
        # 上游 akshare 返回半角括号 "中信期货(代客)"；归一化括号字形后仍做全串精确匹配
        return str(name).replace("（", "(").replace("）", ")").strip()
    
    # 若显式传入 positions_data（如测试用例）
    if positions_data is not None:
        long_volume = 0
        short_volume = 0
        long_chg = 0
        short_chg = 0
        for row in positions_data:
            if _norm_party(row.get("long_party_name", "")) == _TARGET:
                long_volume += row.get("long_volume", 0)
                long_chg += row.get("long_chg", 0)
            if _norm_party(row.get("short_party_name", "")) == _TARGET:
                short_volume += row.get("short_volume", 0)
                short_chg += row.get("short_chg", 0)
        net_short = short_volume - long_volume
        net_short_chg = short_chg - long_chg
        return {
            "party_name": _TARGET,
            "long_volume": long_volume,
            "short_volume": short_volume,
            "net_short": net_short,
            "net_short_chg": net_short_chg,
            "IF": {"total_long": long_volume, "long_chg": long_chg, "total_short": short_volume, "short_chg": short_chg, "net_short": net_short, "net_short_chg": net_short_chg},
            "IC": {"total_long": 0, "long_chg": 0, "total_short": 0, "short_chg": 0, "net_short": 0, "net_short_chg": 0},
            "IM": {"total_long": 0, "long_chg": 0, "total_short": 0, "short_chg": 0, "net_short": 0, "net_short_chg": 0},
            "IH": {"total_long": 0, "long_chg": 0, "total_short": 0, "short_chg": 0, "net_short": 0, "net_short_chg": 0},
        }

    # 尝试使用 akshare 真实接口 get_cffex_rank_table 拉取（自动回溯最近已披露交易日）
    citic_res = {
        "party_name": _TARGET,
        "total_long": 0,
        "total_short": 0,
        "net_short": 0,
        "net_short_chg": 0,
        "trade_date": None,
    }
    try:
        import akshare as ak
        if ak is None:
            raise ImportError("akshare is None")

        # 构建候选日期列表：指定日期优先，否则倒序探测最近 7 个交易日/自然日
        candidate_dates = []
        if trade_date is not None:
            candidate_dates.append(trade_date.replace("-", ""))
        else:
            try:
                from utils.calendar_guard import get_recent_trade_dates
                recent = get_recent_trade_dates(count=7)
                candidate_dates = [d.replace("-", "") for d in reversed(recent)]
            except Exception:
                today = date.today()
                candidate_dates = [(today - timedelta(days=i)).strftime("%Y%m%d") for i in range(7)]

        rank_dict = None
        resolved_date = None
        if hasattr(ak, "get_cffex_rank_table"):
            for d_str in candidate_dates:
                try:
                    res = ak.get_cffex_rank_table(date=d_str)
                    if isinstance(res, dict) and len(res) > 0:
                        # 确认至少包含一个 IF/IC/IM/IH 合约且非空
                        has_equity = any(
                            str(k)[:2] in ('IF', 'IC', 'IM', 'IH') and v is not None and not v.empty
                            for k, v in res.items()
                        )
                        if has_equity:
                            rank_dict = res
                            resolved_date = f"{d_str[:4]}-{d_str[4:6]}-{d_str[6:8]}"
                            break
                except Exception:
                    continue

        if rank_dict is not None:
            per_var = {
                v: {'total_long': 0, 'long_chg': 0, 'total_short': 0, 'short_chg': 0}
                for v in ('IF', 'IC', 'IM', 'IH')
            }
            for sym, df in rank_dict.items():
                pfx = str(sym)[:2]
                if pfx not in per_var or df is None or df.empty:
                    continue
                if 'long_party_name' in df.columns:
                    l_row = df[df['long_party_name'].map(_norm_party) == _TARGET]
                    if not l_row.empty:
                        per_var[pfx]['total_long'] += int(l_row['long_open_interest'].fillna(0).sum())
                        per_var[pfx]['long_chg'] += int(l_row['long_open_interest_chg'].fillna(0).sum())
                if 'short_party_name' in df.columns:
                    s_row = df[df['short_party_name'].map(_norm_party) == _TARGET]
                    if not s_row.empty:
                        per_var[pfx]['total_short'] += int(s_row['short_open_interest'].fillna(0).sum())
                        per_var[pfx]['short_chg'] += int(s_row['short_open_interest_chg'].fillna(0).sum())

            tot_long = 0
            tot_short = 0
            tot_net_short_chg = 0
            for v in ('IF', 'IC', 'IM', 'IH'):
                p = per_var[v]
                v_net = p['total_short'] - p['total_long']
                v_chg = p['short_chg'] - p['long_chg']
                tot_long += p['total_long']
                tot_short += p['total_short']
                tot_net_short_chg += v_chg
                citic_res[v] = {
                    'total_long': p['total_long'],
                    'long_chg': p['long_chg'],
                    'total_short': p['total_short'],
                    'short_chg': p['short_chg'],
                    'net_short': v_net,
                    'net_short_chg': v_chg,
                }
            citic_res['total_long'] = tot_long
            citic_res['total_short'] = tot_short
            citic_res['net_short'] = tot_short - tot_long
            citic_res['net_short_chg'] = tot_net_short_chg
            citic_res['trade_date'] = resolved_date
            citic_res['status'] = 'ok'
            return citic_res
    except Exception as e:
        sys.stderr.write(f"[WARN] 获取中信席位持仓异常: {e}\n")

    # 降级返回（不崩溃）
    for v in ['IF', 'IC', 'IM', 'IH']:
        citic_res[v] = {'total_long': 0, 'long_chg': 0, 'total_short': 0, 'short_chg': 0, 'net_short': 0, 'net_short_chg': 0}
    citic_res['status'] = 'degraded'
    citic_res['note'] = '中信席位数据已降级（akshare未安装或当日/近期龙虎榜未披露）'
    return citic_res


# ---------------------------------------------------------------------------
# 确定性四象限判别
# ---------------------------------------------------------------------------

def discriminate_citic_behavior(
    citic_net_short_chg: float,
    spot_chg_pct: float,
    market_turnover_delta_pct: float,
    basis_delta_pct: float = 0.0,
    **kwargs: Any,
) -> dict[str, Any]:
    """FUSION_DESIGN 第四章确定性四象限判别表与缩量守卫。

    四象限：
    1. 现货涨 + 净空激增 (>= 3500):  被动套保 / 加法 / HIGH / 严禁写看空
    2. 现货跌 + 净空激增:            主动做空动能 / 减法
    3. 现货涨 + 净空剧减 (<= -3500):  空头回补 / 中性对冲
    4. 现货跌 + 净空剧减:            被动减仓 / 减法-被动

    缩量守卫：两市缩量 <= -5% 且净空未破阈值 → 置信度强制 LOW

    Parameters
    ----------
    citic_net_short_chg          : float  中信净空持仓变动（手）
    spot_chg_pct                 : float  现货涨跌幅（%）
    market_turnover_delta_pct    : float  两市成交额变动比例（%）
    basis_delta_pct              : float  基差变动百分比（%），默认 0

    Returns
    -------
    dict  含 behavior_tag, macro_verdict, evidence_line, confidence
    """
    if market_turnover_delta_pct is None:
        market_turnover_delta_pct = 0.0
    if spot_chg_pct is None:
        spot_chg_pct = 0.0
    if citic_net_short_chg is None:
        citic_net_short_chg = 0.0
    if basis_delta_pct is None:
        basis_delta_pct = 0.0

    spot_up = spot_chg_pct > 0
    net_short_surge = citic_net_short_chg >= _NET_SHORT_SURGE_THRESHOLD
    net_short_plunge = citic_net_short_chg <= _NET_SHORT_PLUNGE_THRESHOLD

    # 1. 缩量低置信度守卫
    if market_turnover_delta_pct <= _VOLUME_SHRINK_THRESHOLD and not (net_short_surge or net_short_plunge):
        return {
            "behavior_tag": "低量无序震荡",
            "macro_verdict": "中性对冲（敞口基本不变）",
            "evidence_line": f"两市缩量 {market_turnover_delta_pct:.1f}%，中信净空变动 {citic_net_short_chg:+.0f} 手未达阈值",
            "confidence": "LOW",
        }

    is_volume_expansion = market_turnover_delta_pct >= 5.0
    is_basis_deepening = basis_delta_pct <= -0.3

    if spot_up and net_short_surge:
        # 象限一：被动套保
        behavior_tag = "被动套保"
        macro_verdict = "加法（净风险敞口在增）"
        confidence = "HIGH" if is_volume_expansion else "MEDIUM"
        evidence_line = (
            f"现货上涨 {spot_chg_pct:+.2f}% 且放量，中信净空激增 {citic_net_short_chg:+.0f} 手"
            f"属量化中性建仓对冲。严禁写看空。"
        )
    elif not spot_up and net_short_surge:
        # 象限二：主动做空动能
        behavior_tag = "主动做空动能"
        macro_verdict = "减法（净风险敞口在减）"
        confidence = "HIGH" if is_basis_deepening else "MEDIUM"
        evidence_line = (
            f"现货下跌 {spot_chg_pct:+.2f}% 且中信净空大增 {citic_net_short_chg:+.0f} 手"
            + ("，贴水显著加深确认" if is_basis_deepening else "")
        )
    elif spot_up and net_short_plunge:
        # 象限三：空头回补
        behavior_tag = "空头回补"
        macro_verdict = "中性对冲（阶段修复）"
        confidence = "HIGH" if is_volume_expansion else "MEDIUM"
        evidence_line = (
            f"现货反弹 {spot_chg_pct:+.2f}%，中信净空单大幅撤退 {citic_net_short_chg:+.0f} 手"
        )
    elif not spot_up and net_short_plunge:
        # 象限四：被动减仓
        behavior_tag = "被动减仓"
        macro_verdict = "减法（被动撤退，杀伤力低于主动做空）"
        confidence = "MEDIUM"
        evidence_line = (
            f"现货下跌 {spot_chg_pct:+.2f}% 伴随套保盘被动平仓 {citic_net_short_chg:+.0f} 手，多头离场引发连带出清"
        )
    else:
        behavior_tag = "中性微调"
        macro_verdict = "中性对冲（敞口基本不变）"
        confidence = "MEDIUM"
        evidence_line = (
            f"现货波动 {spot_chg_pct:+.2f}%，中信净空变动 {citic_net_short_chg:+.0f} 手处于常态波动区间"
        )

    return {
        "behavior_tag": behavior_tag,
        "macro_verdict": macro_verdict,
        "evidence_line": evidence_line,
        "confidence": confidence,
    }


def _analyze_style_divergence(citic: dict) -> str:
    """拆解大盘(IF+IH) vs 中盘(IC) vs 小盘(IM) 净空变动，捕捉大小盘风格切换"""
    if citic.get("status") == "degraded":
        return "席位数据暂未获取，无法分析分品种风格切换。"
    if_chg = citic.get("IF", {}).get("net_short_chg", 0)
    ih_chg = citic.get("IH", {}).get("net_short_chg", 0)
    ic_chg = citic.get("IC", {}).get("net_short_chg", 0)
    im_chg = citic.get("IM", {}).get("net_short_chg", 0)
    big_chg = if_chg + ih_chg
    notes = []
    if ic_chg > 800 and im_chg < -800:
        notes.append(f"中盘 IC 净空增 {ic_chg:+d} 手而小盘 IM 净空减 {im_chg:+d} 手（量化/指增资金向中小微盘倾斜或做多 IM/IC 价差）")
    elif ic_chg < -800 and im_chg > 800:
        notes.append(f"中盘 IC 净空减 {ic_chg:+d} 手而小盘 IM 净空增 {im_chg:+d} 手（资金从小盘向中盘蓝筹回流）")
    if big_chg < -1500 and (ic_chg + im_chg) > 1500:
        notes.append(f"大盘权重(IF+IH)净空回补 {big_chg:+d} 手，中小盘(IC+IM)净空增加 {ic_chg + im_chg:+d} 手（防御切权重或中小盘对冲升温）")
    elif big_chg > 1500 and (ic_chg + im_chg) < -1500:
        notes.append(f"大盘权重(IF+IH)净空增加 {big_chg:+d} 手，中小盘(IC+IM)净空缩减 {ic_chg + im_chg:+d} 手（资金偏向中小盘弹性）")
    if not notes:
        notes.append(f"大盘(IF+IH)净空变动 {big_chg:+d} 手，中盘(IC) {ic_chg:+d} 手，小盘(IM) {im_chg:+d} 手，风格分化相对温和。")
    return "；".join(notes)


def _fetch_sh_pct_for_date(target_date: str | None) -> float | None:
    """获取指定历史交易日上证指数真实涨跌幅，保证中信席位与同日现货严格对齐。"""
    if not target_date:
        return None
    try:
        import urllib.request, json
        u = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000001,day,,,15,qfq"
        with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=4) as r:
            d = json.loads(r.read().decode("utf-8")).get("data", {}).get("sh000001", {})
            rows = d.get("day") or d.get("qfqday") or []
            for i in range(1, len(rows)):
                if rows[i][0] == target_date:
                    prev_c = float(rows[i - 1][2])
                    curr_c = float(rows[i][2])
                    if prev_c > 0:
                        return round((curr_c - prev_c) / prev_c * 100.0, 2)
    except Exception:
        pass
    return None


def fetch_cffex_dashboard(
    trade_date: str | None = None,
    spot_chg_pct: float = 0.0,
    market_turnover_delta_pct: float = 0.0,
) -> dict[str, Any]:
    """汇总四大期指基差、中信席位持仓与中信席位行为判别器三件套。"""
    basis = fetch_cffex_basis()
    citic = fetch_citic_positions(trade_date=trade_date)

    if citic.get("status") == "degraded":
        behavior = {
            "behavior_tag": "席位数据降级（未判定）",
            "macro_verdict": "N/A（席位接口未返回）",
            "evidence_line": citic.get("note", "中金所席位数据不可用，禁止基于全 0 做行为推断"),
            "confidence": "DEGRADED",
        }
    else:
        net_short_chg = citic.get("net_short_chg", 0)
        # 若席位日期早于今日（如盘中取 T-1 盘后龙虎榜），自动对齐该交易日真实现货涨跌幅
        citic_dt = citic.get("trade_date")
        today_str = date.today().strftime("%Y-%m-%d")
        effective_spot = spot_chg_pct
        if citic_dt and citic_dt < today_str:
            hist_pct = _fetch_sh_pct_for_date(citic_dt)
            if hist_pct is not None:
                effective_spot = hist_pct
        behavior = discriminate_citic_behavior(
            citic_net_short_chg=net_short_chg,
            spot_chg_pct=effective_spot,
            market_turnover_delta_pct=market_turnover_delta_pct,
        )

    return {
        **basis,
        "citic_positions": citic,
        "citic_behavior": behavior,
        "style_divergence": _analyze_style_divergence(citic),
        "cffex_trade_date": citic.get("trade_date") or trade_date or "N/A",
    }
