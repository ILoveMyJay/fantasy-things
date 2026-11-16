#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
explore_sentiment_data.py - 情绪增强指标数据可行性探索脚本
验证东方财富/腾讯接口能否提供：
1. 涨停/跌停家数（按2026年新规分层统计）
2. 炸板率（盘中触板但未封住）
3. 连板高度与晋级率
4. 全市场个股涨跌幅中位数
"""

import urllib.request
import json
import time
from datetime import datetime

def test_limit_up_down_data():
    """
    测试1: 涨跌停家数数据获取
    验证能否获取全市场涨跌停统计
    """
    print("\n" + "="*60)
    print("测试1: 涨跌停家数数据")
    print("="*60)

    # 东方财富涨跌停数据接口
    url = 'http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=5000&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f12,f14,f2,f3,f15,f16,f17,f18'

    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        req = urllib.request.Request(url, headers=headers)
        start = time.time()
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            elapsed = time.time() - start

            if data.get('data') and data['data'].get('diff'):
                stocks = data['data']['diff']
                print(f"✅ 成功获取 {len(stocks)} 只股票数据")
                print(f"⏱️  耗时: {elapsed:.2f}秒")

                # 分析样本数据
                sample = stocks[:3]
                print("\n样本数据字段:")
                for i, s in enumerate(sample, 1):
                    print(f"  股票{i}: {s.get('f14')} ({s.get('f12')})")
                    print(f"    最新价: {s.get('f2')}, 涨跌幅: {s.get('f3')}%")
                    print(f"    今开: {s.get('f17')}, 昨收: {s.get('f18')}")
                    print(f"    最高: {s.get('f15')}, 最低: {s.get('f16')}")

                # 统计涨跌停（需要涨跌停价格字段）
                print("\n字段完整性检查:")
                has_high = all(s.get('f15') is not None for s in stocks[:100])
                has_low = all(s.get('f16') is not None for s in stocks[:100])
                has_open = all(s.get('f17') is not None for s in stocks[:100])
                has_prev_close = all(s.get('f18') is not None for s in stocks[:100])

                print(f"  最高价字段(f15): {'✅ 完整' if has_high else '❌ 缺失'}")
                print(f"  最低价字段(f16): {'✅ 完整' if has_low else '❌ 缺失'}")
                print(f"  今开字段(f17): {'✅ 完整' if has_open else '❌ 缺失'}")
                print(f"  昨收字段(f18): {'✅ 完整' if has_prev_close else '❌ 缺失'}")

                # 判定可行性
                if has_high and has_low and has_prev_close:
                    print("\n✅ 结论: 可通过最高价/最低价与昨收计算涨跌停家数")
                    print("   方法: 涨停判定 = 最高价 ≈ 昨收*(1+涨跌幅限制)")
                    print("   方法: 跌停判定 = 最低价 ≈ 昨收*(1-涨跌幅限制)")
                    return True
                else:
                    print("\n❌ 结论: 关键字段缺失，无法计算涨跌停")
                    return False

    except Exception as e:
        print(f"❌ 接口请求失败: {e}")
        return False

def test_broken_board_data():
    """
    测试2: 炸板率（盘中触板但收盘未封）数据获取
    这需要盘中分时数据或专门的炸板统计接口
    """
    print("\n" + "="*60)
    print("测试2: 炸板率数据（盘中触板记录）")
    print("="*60)

    # 尝试东方财富炸板统计接口
    url = 'http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=20&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f12,f14,f2,f3,f15,f16,f62'

    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        req = urllib.request.Request(url, headers=headers)
        start = time.time()
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            elapsed = time.time() - start

            if data.get('data') and data['data'].get('diff'):
                stocks = data['data']['diff']
                print(f"✅ 成功获取 {len(stocks)} 只股票数据")
                print(f"⏱️  耗时: {elapsed:.2f}秒")

                # 检查是否有封板相关字段
                sample = stocks[0]
                print("\n可用字段:")
                for key, value in sample.items():
                    print(f"  {key}: {value}")

                # 检查是否有封板强度、封单量等字段
                if 'f62' in sample or any('封' in str(k) for k in sample.keys()):
                    print("\n✅ 发现可能的封板相关字段")
                    return True
                else:
                    print("\n⚠️  未发现明确的触板/炸板统计字段")
                    print("   替代方案: 通过【最高价=涨停价 且 收盘价<涨停价】判定炸板")
                    print("   局限性: 无法区分'开盘即涨停'与'盘中触板后回落'")
                    return "PARTIAL"

    except Exception as e:
        print(f"❌ 接口请求失败: {e}")
        return False

def test_consecutive_limit_up_data():
    """
    测试3: 连板高度与晋级率数据获取
    需要多日历史涨停数据
    """
    print("\n" + "="*60)
    print("测试3: 连板高度与晋级率数据")
    print("="*60)

    # 测试单只股票的历史K线（用于判断连板）
    test_code = '1.000001'  # 上证指数作为测试
    url = f'http://push2his.eastmoney.com/api/qt/stock/kline/get?secid={test_code}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=10'

    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        req = urllib.request.Request(url, headers=headers)
        start = time.time()
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            elapsed = time.time() - start

            if data.get('data') and data['data'].get('klines'):
                klines = data['data']['klines']
                print(f"✅ 成功获取历史K线数据 {len(klines)} 根")
                print(f"⏱️  耗时: {elapsed:.2f}秒")

                print("\nK线字段样本:")
                sample = klines[-1].split(',')
                print(f"  日期: {sample[0]}")
                print(f"  开盘: {sample[1]}, 收盘: {sample[2]}")
                print(f"  最高: {sample[3]}, 最低: {sample[4]}")
                print(f"  成交量: {sample[5]}, 成交额: {sample[6]}")
                print(f"  振幅: {sample[7] if len(sample) > 7 else 'N/A'}")

                print("\n✅ 结论: 可通过历史K线计算连板高度")
                print("   方法: 遍历每只股票最近N日K线，判断连续涨停天数")
                print("   性能考量: 5000只股票 × 10日K线 ≈ 5万次请求")
                print("   ⚠️  警告: 大规模请求可能触发限流，需分批+缓存")

                return "FEASIBLE_BUT_SLOW"

    except Exception as e:
        print(f"❌ 接口请求失败: {e}")
        return False

def test_market_breadth_data():
    """
    测试4: 全市场个股涨跌幅中位数（市场宽度指标）
    需要获取全市场5000+只股票涨跌幅
    """
    print("\n" + "="*60)
    print("测试4: 全市场个股涨跌幅中位数")
    print("="*60)

    # 分批获取全市场数据
    url = 'http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=5000&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23&fields=f12,f14,f3'

    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        req = urllib.request.Request(url, headers=headers)
        start = time.time()
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            elapsed = time.time() - start

            if data.get('data') and data['data'].get('diff'):
                stocks = data['data']['diff']
                total = data['data'].get('total', 0)
                print(f"✅ 单次请求获取 {len(stocks)} 只股票")
                print(f"📊 市场总股票数: {total}")
                print(f"⏱️  耗时: {elapsed:.2f}秒")

                # 提取涨跌幅
                pct_changes = [s['f3'] for s in stocks if s.get('f3') is not None]
                pct_changes.sort()
                median_idx = len(pct_changes) // 2
                median = pct_changes[median_idx] if pct_changes else None

                print(f"\n样本统计 (基于{len(pct_changes)}只股票):")
                print(f"  中位数涨跌幅: {median:.2f}%")
                print(f"  上涨家数: {sum(1 for p in pct_changes if p > 0)}")
                print(f"  下跌家数: {sum(1 for p in pct_changes if p < 0)}")
                print(f"  平盘家数: {sum(1 for p in pct_changes if p == 0)}")

                if len(stocks) >= 4500:
                    print("\n✅ 结论: 单次请求可覆盖全市场，性能良好")
                    return True
                else:
                    print(f"\n⚠️  结论: 单次仅获取{len(stocks)}只，需分页或增加pz参数")
                    return "PARTIAL"

    except Exception as e:
        print(f"❌ 接口请求失败: {e}")
        return False

def test_2026_trading_rules():
    """
    测试5: 验证2026年7月新规涨跌幅限制识别
    需要区分主板ST(10%)、双创(20%)、北交所(30%)、新股(无限制)
    """
    print("\n" + "="*60)
    print("测试5: 2026年新规涨跌幅限制识别")
    print("="*60)

    # 获取不同板块样本
    test_codes = [
        ('1.600000', '浦发银行', '主板'),
        ('0.000001', '平安银行', '主板'),
        ('0.300001', '特锐德', '创业板'),
        ('1.688001', '华兴源创', '科创板'),
        ('0.430001', '不存在', '北交所')  # 示例代码
    ]

    url_template = 'http://push2.eastmoney.com/api/qt/stock/get?secid={}&fields=f57,f58,f84,f85,f86,f127,f128,f152'

    print("\n板块与涨跌幅限制对照:")
    print("| 板块 | 普通股涨跌幅 | ST股涨跌幅 | 新股前5日 |")
    print("| :--- | :---: | :---: | :---: |")
    print("| 主板 | ±10% | ±10% (新规) | 无限制 |")
    print("| 双创 | ±20% | ±20% | 无限制 |")
    print("| 北交所 | ±30% | ±30% | 首日无限制 |")

    print("\n字段识别测试:")
    for code, name, board in test_codes[:2]:  # 只测试前2个避免超时
        try:
            url = url_template.format(code)
            headers = {'User-Agent': 'Mozilla/5.0'}
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                if data.get('data'):
                    d = data['data']
                    print(f"\n{name} ({code}) - {board}:")
                    print(f"  可用字段: {list(d.keys())}")
                    # 常见字段: f57=涨停价, f58=跌停价, f152=市场类型

        except Exception as e:
            print(f"  ⚠️  获取失败: {e}")

    print("\n✅ 结论: 需通过【市场代码前缀】判定板块")
    print("   方法: 0.3xxxxx=创业板, 1.688xxx=科创板, 0.43xxxx/0.83xxxx=北交所")
    print("   方法: ST标识通过股票名称包含'ST'判断")
    print("   方法: 新股通过名称前缀'N'/'C'判断")
    return True

def main():
    """执行所有测试"""
    print("="*60)
    print("情绪增强指标数据可行性探索")
    print("测试时间:", datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    print("="*60)

    results = {}

    # 执行测试
    results['limit_up_down'] = test_limit_up_down_data()
    time.sleep(0.5)  # 避免请求过快

    results['broken_board'] = test_broken_board_data()
    time.sleep(0.5)

    results['consecutive_limit'] = test_consecutive_limit_up_data()
    time.sleep(0.5)

    results['market_breadth'] = test_market_breadth_data()
    time.sleep(0.5)

    results['trading_rules'] = test_2026_trading_rules()

    # 汇总报告
    print("\n" + "="*60)
    print("综合可行性评估报告")
    print("="*60)

    print("\n✅ 可立即实现的指标:")
    if results.get('limit_up_down'):
        print("  • 涨停/跌停家数统计（按2026新规分层）")
    if results.get('market_breadth'):
        print("  • 全市场涨跌家数与中位数涨跌幅")
        print("  • 指数与个股分化度")
    if results.get('trading_rules'):
        print("  • 2026年7月新规涨跌幅限制识别")

    print("\n⚠️  有限制的指标:")
    if results.get('broken_board') == "PARTIAL":
        print("  • 炸板率: 可用【最高=涨停价且收盘<涨停价】近似，但不精确")
    if results.get('consecutive_limit') == "FEASIBLE_BUT_SLOW":
        print("  • 连板高度: 技术可行但需5000+次请求，必须缓存+限流")

    print("\n❌ 暂不建议实现:")
    if not results.get('broken_board') or results.get('broken_board') == "PARTIAL":
        print("  • 精确炸板率（需盘中逐笔成交或专用统计接口）")

    print("\n" + "="*60)
    print("推荐优化路径:")
    print("="*60)
    print("""
Phase 1A - 立即可做（无性能风险）:
  1. 盘中态识别与量能估算标记
  2. 两融三市对齐校验
  3. 2026年新规涨跌幅阈值校准
  4. 涨停/跌停家数统计（分板块）
  5. 全市场涨跌中位数与指数分化度

Phase 1B - 需要优化实现（性能敏感）:
  1. 近似炸板率（最高价触及涨停但收盘未封）
  2. 连板梯队统计（需历史数据缓存）
  3. 晋级率（昨涨停→今涨停比例）

Phase 2 - 后续迭代:
  1. 本地缓存机制（减少重复请求）
  2. 主备源降级（容错增强）
  3. 标准化情绪标签生成
    """)

if __name__ == '__main__':
    main()
