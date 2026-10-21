---
name: a-share-news-radar
description: A-share news investment direction radar for converting breaking news and events into short-term A-share sector themes and candidate stock pools. Use when Codex needs to produce a daily pre-market China A-share news radar, analyze event-to-industry impact chains, map news catalysts to A-share research candidates, or evaluate bullish/bearish implications from policy, technology, geopolitical, commodity, holiday, supply-chain, and public-sentiment events without giving buy/sell instructions.
---

# A股新闻投资方向雷达

把新闻转成 A 股研究线索。分两个阶段，**先按任务选分支，不要一次读完所有文件**。

## 路由：先确定走哪条分支

| 任务 | 时间窗口 | 读这些文件 |
|---|---|---|
| 盘前预期扫描 | 08:00–09:00，或前一日 20:00–22:00 | `workflow.md` + `workflow-phase1.md` |
| 盘后确认跟踪 | 16:00 之后 | `workflow.md` + `workflow-phase2.md` |
| 混合（既有落地又有预期） | 任意 | `workflow.md` + 两个 phase 文件 |

**Phase 1 不取行情**（尚未开盘）；**Phase 2 第一步必须取行情**。这是两个阶段最容易搞混的地方。

## 铁律

1. **行情一律走脚本** `scripts/market_snapshot.py`。禁止用 web_search 填写点位或涨跌幅；仅当脚本失败才可降级，且必须注明「数据来自搜索」
2. **公告一律走脚本** `scripts/announcements.py`（巨潮资讯）。要标「公告确认」必须能在巨潮查到原文，并给出 PDF 链接；只有媒体转述的不能标
3. **禁止编造**。取不到数就写「行情数据暂未获取」，不用「今日震荡走低」这类模糊描述顶替具体数字
4. **每只股票必须有一个证据标签**：`公告确认` / `业务归属` / `产业链推断` / `情绪映射` / `负面暴露` / `剔除`
5. **每只股票必须有多空方向**：`✅正面` / `⚠️负面` / `👀中性观察`。双向事件必须带条件，不得只写单边
6. **每个事件必须有失效条件**——什么情况下这个判断不成立
7. **必须列剔除/降级项**，用排除来展示纪律
8. **不给买卖建议**：不出现目标价、收益承诺、仓位或配置建议

## 运行环境

脚本需 **Python ≥ 3.7**，只用标准库，无需 pip 安装任何依赖。

首次使用先跑自检，确认本机网络能访问各数据源：

```bash
python3 scripts/doctor.py
```

- 退出码 0 = 全部可用
- 退出码 1 = 有降级（缺资金流或公告通道，仍可运行）
- 退出码 2 = 关键能力缺失（缺行情通道，不要硬跑）

## 脚本

| 脚本 | 用途 |
|---|---|
| `market_snapshot.py` | 行情入口：快照 / 日K / 分时 / 分钟K / 交易日 / 资金流 |
| `announcements.py` | 公告入口（巨潮）：全市场按日期+类别扫，或按股票查历史公告 |
| `score_events.py` | 结构化事件打分与候选排序（确定性，不靠模型拍脑袋） |
| `lint_report.py` | 交付前字段校验。退出码 0 才可推送 |
| `db.py` | 决策快照落库（SQLite），供 T+N 回看与命中率统计 |
| `doctor.py` | 环境与数据源自检 |
| `run_historical_cases.py` | 7 个历史回归用例，保护推理纪律 |

## 交付前自检（必做）

```bash
python3 scripts/lint_report.py report.md --phase phase2
```

- 退出码 **0** = 通过，可推送
- 退出码 **1** = 有警告，可推送但需人工确认
- 退出码 **2** = 不合格，**重写，不要推出去**

（若本机 `python3` 低于 3.7，换成显式路径，如 `/usr/bin/python3.11`。）

## 资源索引

| 文件 | 内容 |
|---|---|
| `references/workflow.md` | 两阶段共用的 13 步流程、推理规则、数据质量规则 |
| `references/workflow-phase1.md` | 盘前预期扫描的步骤与输出要求 |
| `references/workflow-phase2.md` | 盘后确认跟踪的步骤、输出要求、落库方法 |
| `references/source-policy.md` | S/A/B/C 来源分级，以及每级能支撑什么证据标签 |
| `references/event-taxonomy.md` | 7 类事件、传导逻辑、评分维度、历史校准 |
| `references/a-share-mapping.md` | 主题到候选股的种子映射。**只是备忘，不是事实来源** |
| `references/candidate-verification.md` | 动态发现、逐股核查、过期标的清理 |
| `references/calendar-scanning.md` | Phase 1 的 10 个日历维度与搜索关键词 |
| `references/report-template.md` | Template A（盘前）/ Template B（盘后） |
| `references/data-sources.md` | 接口清单、实测可用性、坑点 |
| `examples/sample-report.md` | 一份通过 lint 的完整报告样例，可作输出形状参照 |
| `fixtures/historical_cases.json` | 7 个校准用例（矿难/机器人/票房/IP/水产/关税/油价） |
