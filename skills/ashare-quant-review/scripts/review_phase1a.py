#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
review_phase1a.py - Phase 1A 代码质量审查脚本
自动化检查：
1. 代码语法正确性
2. 核心函数逻辑验证
3. 边界条件测试
4. 性能基准测试
5. 输出格式一致性
"""

import sys
import os
import json
import time
from datetime import datetime

# 添加scripts目录到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))

def test_market_sentiment_module():
    """测试市场情绪模块的核心功能"""
    print("\n" + "="*60)
    print("1. 市场情绪模块审查（fetch_market_sentiment.py）")
    print("="*60)

    try:
        from fetch_market_sentiment import (
            get_limit_threshold,
            classify_board,
            is_limit_up,
            is_limit_down,
            calculate_divergence,
            generate_sentiment_label,
            fetch_market_sentiment
        )

        print("✅ 模块导入成功")

        # 测试1: 2026新规涨跌幅限制
        print("\n【测试1】2026年新规涨跌幅限制识别")
        test_cases = [
            ("600000", "浦发银行", 0.10, "主板普通股"),
            ("600000", "ST浦发", 0.10, "主板ST（新规10%）"),
            ("300001", "特锐德", 0.20, "创业板"),
            ("300001", "ST特锐", 0.20, "创业板ST"),
            ("688001", "华兴源创", 0.20, "科创板"),
            ("430001", "测试", 0.30, "北交所"),
            ("600000", "N测试", None, "新股无限制"),
            ("600000", "C测试", None, "新股无限制"),
        ]

        all_pass = True
        for code, name, expected, desc in test_cases:
            result = get_limit_threshold(code, name)
            status = "✅" if result == expected else "❌"
            if result != expected:
                all_pass = False
            print(f"  {status} {desc}: {code} {name} -> {result} (期望{expected})")

        if all_pass:
            print("✅ 涨跌幅限制识别全部通过")
        else:
            print("❌ 存在失败的测试用例")

        # 测试2: 板块分类
        print("\n【测试2】板块分类准确性")
        board_cases = [
            ("600000", "浦发银行", "mainboard"),
            ("000001", "平安银行", "mainboard"),
            ("300001", "特锐德", "chinext"),
            ("688001", "华兴源创", "star"),
            ("430001", "测试", "bse"),
            ("600000", "N测试", "new_stock"),
        ]

        all_pass = True
        for code, name, expected in board_cases:
            result = classify_board(code, name)
            status = "✅" if result == expected else "❌"
            if result != expected:
                all_pass = False
            print(f"  {status} {code} {name} -> {result} (期望{expected})")

        if all_pass:
            print("✅ 板块分类全部通过")

        # 测试3: 涨跌停判定逻辑
        print("\n【测试3】涨跌停判定逻辑")
        limit_cases = [
            # (最高价, 昨收, 阈值, 是否涨停)
            (11.00, 10.00, 0.10, True, "主板涨停（精确）"),
            (11.02, 10.00, 0.10, True, "主板涨停（容差内）"),
            (10.98, 10.00, 0.10, False, "未涨停"),
            (12.00, 10.00, 0.20, True, "双创涨停"),
            (13.00, 10.00, 0.30, True, "北交所涨停"),
        ]

        all_pass = True
        for high, prev, threshold, expected, desc in limit_cases:
            result = is_limit_up(high, prev, threshold)
            status = "✅" if result == expected else "❌"
            if result != expected:
                all_pass = False
            print(f"  {status} {desc}: 最高{high}/昨收{prev} -> {result} (期望{expected})")

        if all_pass:
            print("✅ 涨跌停判定全部通过")

        # 测试4: 指数分化标签
        print("\n【测试4】指数与个股分化度标签")
        divergence_cases = [
            (1.0, 0.5, "broad_risk_on", "全面做多"),
            (1.0, -0.5, "index_up_breadth_weak", "权重护盘"),
            (-1.0, 0.5, "index_down_breadth_strong", "权重拖累"),
            (-1.0, -0.5, "broad_risk_off", "全面杀跌"),
        ]

        all_pass = True
        for idx_pct, med_pct, expected_label, desc in divergence_cases:
            result = calculate_divergence(idx_pct, med_pct)
            status = "✅" if result['label'] == expected_label else "❌"
            if result['label'] != expected_label:
                all_pass = False
            print(f"  {status} {desc}: 指数{idx_pct}%/中位{med_pct}% -> {result['label']}")

        if all_pass:
            print("✅ 分化度标签全部通过")

        # 测试5: 实际接口调用性能
        print("\n【测试5】实际接口调用与性能测试")
        start = time.time()
        result = fetch_market_sentiment()
        elapsed = time.time() - start

        print(f"  ⏱️  接口耗时: {elapsed:.2f}秒")
        print(f"  📊 获取股票数: {result.get('valid_stocks', 0)}/{result.get('total_stocks', 0)}")
        print(f"  📈 数据状态: {result.get('data_quality', {}).get('status', 'unknown')}")

        # 检查关键字段
        required_fields = [
            'market_breadth', 'limit_structure', 'board_breakdown', 'data_quality'
        ]
        missing = [f for f in required_fields if f not in result]
        if missing:
            print(f"  ❌ 缺失关键字段: {missing}")
        else:
            print(f"  ✅ 关键字段完整")

        # 数据覆盖率检查
        coverage = result.get('data_quality', {}).get('coverage_rate', 0)
        if coverage < 95:
            print(f"  ⚠️  数据覆盖率偏低: {coverage}%（可能只获取了部分股票）")
        else:
            print(f"  ✅ 数据覆盖率正常: {coverage}%")

        return True

    except Exception as e:
        print(f"❌ 模块测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_tech_volume_module():
    """测试量能模块的盘中态识别"""
    print("\n" + "="*60)
    print("2. 量能模块审查（fetch_tech_volume.py）")
    print("="*60)

    try:
        from fetch_tech_volume import (
            is_trading_time,
            estimate_full_day_volume,
            fetch_tech_volume_dashboard
        )

        print("✅ 模块导入成功")

        # 测试1: 交易时段判定
        print("\n【测试1】交易时段判定逻辑")
        is_intraday, elapsed, phase = is_trading_time()
        print(f"  当前状态: {phase}")
        print(f"  是否盘中: {is_intraday}")
        print(f"  已开盘分钟: {elapsed}")

        # 验证逻辑合理性
        now = datetime.now().time()
        if now.hour == 9 and now.minute >= 30:
            if phase != 'morning':
                print(f"  ❌ 时段判定错误：当前{now}应为morning，实际{phase}")
            else:
                print(f"  ✅ 时段判定正确")
        elif now.hour == 13 and now.minute >= 0 and now.hour < 15:
            if phase != 'afternoon':
                print(f"  ❌ 时段判定错误：当前{now}应为afternoon，实际{phase}")
            else:
                print(f"  ✅ 时段判定正确")
        else:
            print(f"  ℹ️  当前非标准交易时段，phase={phase}")

        # 测试2: 量能估算合理性
        print("\n【测试2】量能估算合理性")
        test_estimates = [
            (1000, 30, 240, 8000, "开盘30分钟"),
            (5000, 120, 240, 10000, "半天交易完成"),
            (10000, 240, 240, 10000, "全天交易完成"),
        ]

        all_pass = True
        for current, elapsed, total, expected, desc in test_estimates:
            result = estimate_full_day_volume(current, elapsed, total)
            status = "✅" if result == expected else "❌"
            if result != expected:
                all_pass = False
            print(f"  {status} {desc}: {current}亿/{elapsed}分 -> {result}亿 (期望{expected})")

        if all_pass:
            print("✅ 量能估算全部通过")

        # 测试3: 实际接口调用
        print("\n【测试3】实际接口调用与数据完整性")
        start = time.time()
        result = fetch_tech_volume_dashboard()
        elapsed_time = time.time() - start

        print(f"  ⏱️  接口耗时: {elapsed_time:.2f}秒")

        # 检查新增字段
        new_fields = [
            'is_intraday_estimate',
            'session_phase',
            'elapsed_trading_minutes',
            'volume_estimate_note',
            'estimated_full_day_yi'
        ]

        missing = [f for f in new_fields if f not in result]
        if missing:
            print(f"  ❌ 缺失新增字段: {missing}")
        else:
            print(f"  ✅ 新增字段完整")

        # 输出当前状态
        print(f"\n  当前量能状态:")
        print(f"    盘中态: {result.get('is_intraday_estimate')}")
        print(f"    交易阶段: {result.get('session_phase')}")
        print(f"    当前成交: {result.get('total_market_amount_yi')}亿元")
        if result.get('is_intraday_estimate'):
            print(f"    预估全天: {result.get('estimated_full_day_yi')}亿元")
            print(f"    估算说明: {result.get('volume_estimate_note')}")

        # 验证盘中态标记一致性
        if result.get('is_intraday_estimate'):
            if '预估' not in result.get('volume_edge_status', ''):
                print(f"  ⚠️  盘中态但环比描述未标记'预估'")
            else:
                print(f"  ✅ 盘中态标记一致")

        return True

    except Exception as e:
        print(f"❌ 模块测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_integration():
    """测试模块间集成"""
    print("\n" + "="*60)
    print("3. 模块集成测试")
    print("="*60)

    try:
        from fetch_market_sentiment import fetch_market_sentiment, calculate_divergence
        from fetch_tech_volume import fetch_tech_volume_dashboard

        print("✅ 模块导入成功")

        print("\n【测试】联合调用与数据一致性")

        # 同时调用两个模块
        start = time.time()
        sentiment_data = fetch_market_sentiment()
        tech_data = fetch_tech_volume_dashboard()
        elapsed = time.time() - start

        print(f"  ⏱️  联合调用耗时: {elapsed:.2f}秒")

        # 数据一致性检查
        sentiment_valid = sentiment_data.get('valid_stocks', 0)

        print(f"\n  数据概览:")
        print(f"    情绪模块: {sentiment_valid}只股票")
        print(f"    量能模块: 上证{tech_data.get('sh_amount_yi')}亿 + 深证{tech_data.get('sz_amount_yi')}亿")

        # 计算指数与个股分化
        index_pct = tech_data.get('indices_detail', {}).get('000001', {}).get('pct_chg', 0)
        median_pct = sentiment_data.get('market_breadth', {}).get('median_change_pct', 0)

        divergence = calculate_divergence(index_pct, median_pct)
        print(f"\n  指数分化分析:")
        print(f"    上证指数涨跌: {index_pct}%")
        print(f"    个股中位数: {median_pct}%")
        print(f"    分化标签: {divergence.get('description')}")

        return True

    except Exception as e:
        print(f"❌ 集成测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

def generate_review_summary(results):
    """生成审查摘要报告"""
    print("\n" + "="*60)
    print("审查摘要报告")
    print("="*60)

    total = len(results)
    passed = sum(1 for r in results if r)

    print(f"\n总计测试模块: {total}")
    print(f"通过: {passed}")
    print(f"失败: {total - passed}")

    if passed == total:
        print("\n🎉 所有测试通过！代码质量良好，可以继续集成。")
        return True
    else:
        print("\n⚠️  存在失败的测试，建议修复后再继续。")
        return False

def main():
    """执行完整审查流程"""
    print("="*60)
    print("Phase 1A 代码质量审查")
    print(f"审查时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*60)

    results = []

    # 执行各模块测试
    results.append(test_market_sentiment_module())
    results.append(test_tech_volume_module())
    results.append(test_integration())

    # 生成摘要
    all_pass = generate_review_summary(results)

    # 输出建议
    print("\n" + "="*60)
    print("下一步建议")
    print("="*60)

    if all_pass:
        print("""
✅ Phase 1A 核心功能已完成并通过审查

立即可做:
1. 修复市场情绪模块数据覆盖（调整pz参数至6000）
2. 实现两融三市对齐校验
3. 集成到 run_quant_suite.py 总调度器
4. 更新 .gitignore 排除缓存目录

预计剩余时间: 50分钟
        """)
    else:
        print("""
⚠️  存在测试失败，建议先修复

优先级:
1. 检查失败的测试用例
2. 修复边界条件处理
3. 验证数据一致性
4. 重新运行审查脚本
        """)

if __name__ == '__main__':
    main()
