# Phase 2：盘后确认跟踪

运行窗口 **16:00 之后**，确保拿到收盘数据。

**第一步必须取行情**——这是与 Phase 1 最关键的区别。

## 步骤

1. **取行情（必须第一步）**

   ```bash
   # 三大指数收盘
   /usr/bin/python3.11 scripts/market_snapshot.py snapshot 上证,深证,创业板

   # 候选股近期走势（用于验证方向、判断拥挤）
   /usr/bin/python3.11 scripts/market_snapshot.py metrics 600519,000001,300750

   # 需要看日内节奏时
   /usr/bin/python3.11 scripts/market_snapshot.py minute sh000001
   ```

   若脚本失败，先重试；仍失败才降级到 web_search，并在报告中注明「行情脚本不可用，数据来自搜索」

2. **公告与事件搜索**——指数样本股调整、重大公告、政策监管、资金面。
   若查到指数调整公告，**必须列出完整调入调出名单**，不能只写「待确认」

3. **已落地事件分析**——重点做**预期 vs 实际对比**：哪些如期反应、哪些未反应、哪些超预期。
   如果盘前已有预期扫描，优先对比那批事件

4. **候选池与多空方向**——按 `workflow.md` 的共用流程核查，每只股票必须有证据标签 + 方向 + 置信度

5. **资金流（可选）**——仅对最终候选池（5–15 只）查，新浪接口只支持单只

   ```bash
   /usr/bin/python3.11 scripts/market_snapshot.py fundflow 600519
   ```

6. **输出**——用 Template B

## 输出要求（Template B）

给 3–7 个最高优先级事件及实际影响跟踪，每个事件包含：

- 事件摘要 + 来源链接
- 影响链（一行）
- 受益与受损主题
- **预期 vs 实际对比**：哪些如期反应、哪些未反应、哪些超预期
- A 股候选池，分为直接受益 / 间接受益 / 观察核实 / 可能受损；
  每只股票必须含证据标签、来源质量、候选置信度、一句理由、**多空方向**
- 若强候选来自动态发现而非种子映射，或种子名单因过期/退市/停牌/弱关联被移除，需简短说明
- 置信度：High / Medium / Low
- 观察窗口：当日 / 1–3 个交易日 / 1–2 周 / 政策或财报周期
- 失效条件与主要风险

结尾附「观察池卫生」提示：不追未验证传闻、核对公告与估值、把雷达当作研究起点。

## 混合模式

既有当日确认事件、又有未来预期事件时，报告分两部分，中间用分隔线隔开：

1. **已落地事件分析**（Template B 格式）
2. **未来预期事件扫描**（Template A 格式）

## 常见错误

| 错误 | 后果 |
|---|---|
| 用 web_search 填指数点位 | 数据不可靠，且 `lint` 会要求标注来源 |
| 只写「今日震荡」不给数字 | 无法验证，`lint` 判 E-MARKET-VAGUE |
| 候选股只写名字不写方向 | `lint` 判 E-CANDIDATE-NODIR |
| 指数调整公告只写「待确认」 | 信息残缺，读者无法判断 |
| 对全市场查资金流 | 新浪只支持单只，会被限流且耗时 |

## 自检

```bash
/usr/bin/python3.11 scripts/lint_report.py report.md --phase phase2
```

## 落库（供 T+N 回看）

报告定稿后存入 SQLite，才能事后评估准不准：

```bash
/usr/bin/python3.11 scripts/db.py save \
  --trade-date 2026-10-20 --phase phase2 \
  --body-file report.md --candidates @candidates.json \
  --event-count 5 --market-opened --lint-status pass
```

候选股 JSON 结构：

```json
[
  {"ticker": "600519", "name": "贵州茅台", "group": "direct",
   "direction": "✅正面", "evidence_label": "业务归属",
   "source_quality": "A", "confidence": "High",
   "reason": "白酒龙头直接受益", "event_title": "消费刺激政策落地",
   "base_close": 1331.88}
]
```
