# A-Share News Radar Templates

Two templates for two phases. Use the appropriate one based on the report type.

---

## Template A: 盘前预期扫描（Phase 1）

Use for pre-market / previous-day scans. Focus on **upcoming events** and **预期影响**.

### Header

`A股预期扫描 | YYYY-MM-DD 盘前`

One-line scope note:

`范围：未来 1-3 个交易日确定性事件；市场：A股；定位：预期研究线索，不构成投资建议。`

### 预期概览

Write 2-4 bullets:

- 未来 1-3 个交易日的关键事件数量及分类（航天/会议/政策/财报/行业展等）
- 预计影响最大的 1-2 个事件
- 需要关注的联动方向
- 不确定性提示（如某事件日期未确认）

### 高优先级预期事件

For each upcoming event:

### N. 事件名称

- **时间**：确认日期及来源链接。标注「已确认」或「待确认」。
- **事件摘要**：一句话描述。
- **预期影响链**：`事件 -> 预期传导路径 -> 可能受益/受损主题`
- **预期路径区分**：
  - **第一波（预期行情）**：事件确认前可能提前反应的方向（通常在事件前 1-3 天）
  - **第二波（落地行情）**：事件落地后超预期/低于预期的方向（事件当天/次日）
- **受益主题方向**：主题/行业名称，而非具体股票。若已有明确映射，可标注。
- **受损主题方向**（如有）：同样以主题方向为主。
- **事件确定性**：高（已确认日期）/ 中（广泛报道但未确认）/ 低（传闻）
- **触发日期**：事件发生的具体日期。
- **失效条件**：什么情况下事件不会发生或影响改变。
- **行动建议**：
  - 提前布局（事件前 1-3 天）：[方向]
  - 事件当日观察：[方向]
  - 事件落地后确认：[方向]

### 低优先级 / 待观察

List events with lower certainty or weaker A-share linkage.

### 注意事项

`以上为预期研究线索，不是买卖建议。事件日期和具体影响需持续跟踪确认。实际市场反应可能因宏观环境、资金面、情绪等因素与预期偏离。`

---

## Template B: 盘后确认跟踪（Phase 2）

Use for post-close (16:00+) reports. Focus on **what actually happened** and **预期 vs 实际对比**.

### Header

`A股新闻投资方向雷达 | YYYY-MM-DD 盘后`

One-line scope note:

`范围：当日已落地事件 + 预期跟踪；市场：A股；定位：主题研究线索，不构成投资建议。`

## Market Pulse

Write 2-4 bullets:

- **必须包含主要股指数据**：上证指数、深证成指、创业板指的点位及涨跌幅。
- **必须标注数据来源和时间**：如"数据来源：东方财富，收盘数据"。
- **无法获取行情时**：明确写"行情数据暂未获取"，不要用模糊描述（如"今日震荡"）替代具体数字。
- Dominant policy or industry catalyst.
- Commodity/geopolitical signal if relevant.
- Crowded themes or risk warnings.

## 已落地事件分析

For each event that actually happened today:

### N. 事件名称

- Source: linked sources with dates.
- Fact: one sentence with confirmed facts only.
- Chain: `event -> transmission path -> sector/theme -> A-share candidates`.
- **预期 vs 实际对比**：
  - 盘前预期方向：[]
  - 实际反应方向：[]
  - 是否如期反应：是/否/部分。若未反应，分析原因。
  - 超预期因素：[]（如有）
- Beneficiary themes: direct and indirect.
- Possible losers: include only when relevant.
- A-share candidate pool: **每只股票必须标注多空方向列**。方向取值：`正面`（利好方向）/ `负面`（利空方向）/ `中性观察`（方向不确定或需事件落地后再定）。
  - 方向判定规则：`公告确认`、`业务归属`、`产业链推断` 通常映射 `正面`（若事件为利好）或 `负面`（若事件为利空）；`情绪映射` 默认 `中性观察`；`负面暴露` 固定 `负面`。事件本身是中性/双向（如谈判可能成/可能破）时，方向须注明条件，如 `正面（若休战延期+出口恢复）`、`负面（若管制加码）`。
  - Direct benefit: `ticker name [正面/负面/中性观察 | evidence label / source quality / confidence] - reason`。
  - Indirect benefit: `ticker name [方向 | evidence label / source quality / confidence] - reason`。
  - Watch/verify: `ticker name [方向 | evidence label / source quality / confidence] - reason`。
  - Possible losers: `ticker name [负面 | evidence label / source quality / confidence] - why the event may hurt it`。
  - **呈现形式**：候选池建议用表格，列依次为 `方向 | 股票 | 标签 | 来源 | 置信度 | 理由`，方向列放最前，正面用 ✅、负面用 ⚠️、中性观察用 👀 前缀便于扫读。
- Candidate changes: note newly discovered candidates outside the seed list, and seed-list names removed because they are stale, delisted, suspended, renamed, or weakly linked.
- Confidence: High / Medium / Low.
- Window: same day / 1-3 trading days / 1-2 weeks / policy or earnings cycle.
- Invalidation: what would make the thesis fail.
- Risks: crowding, rumor, weak linkage, demand, valuation, policy reversal.

## 未来预期事件扫描

If there are notable upcoming events, include this section using the same format as Template A's high-priority events.

## Dropped Or Deprioritized

List rumors, stale news, over-crowded moves, or weak A-share linkages briefly. This section is important because it shows discipline.

## Watchlist Hygiene

Close with:

`以上为研究线索，不是买卖建议。候选股票已按证据强弱和来源质量分层，但仍需继续核实公告、互动易/投资者关系回复、订单和收入占比、上市状态、估值位置、资金拥挤度与个人风险承受能力。`