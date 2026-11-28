---
name: ashare-alpha-cockpit
description: A股实证融合量化驾驶舱与解耦式个股买前风控闸门（ashare-alpha-cockpit v1.0）。融合 ashare-market-compass 与 ashare-quant-review 经 5 年零未来数据因果回测（2021–2026）与严格 Walk-Forward 样本外验证（2024–2026）筛选出的高胜率正交因子：L1 纠偏战略罗盘（周/日一目均衡表+VW-MACD × ERP非对称+反转PCR/假底否决+IM/IC滚仓基差分红护栏 × K=2/3非对称缓冲与双空防单票铁律）、L2 战术拐点引擎（左尾恐慌试仓探针 + 冲顶暴走封顶护栏 + 大阳线中轨 3/4 蓝灯 + TRIN奇点修正 + 7x24双源新闻雷达）、L3 双创风格控仓（TCR>40%放量滞涨风控）与 49 行业轮动，以及 Phase 2 解耦式个股趋势与盈亏比买前风控闸门。当需要研判A股大盘中期波段与仓位、盘后/尾盘量化复盘、追踪大阳线中轨与双创拥挤度、或审查任意个股买前趋势/相对强弱/结构止损/仓位上限时，激活此技能。
---

# 🧭 `ashare-alpha-cockpit` — A股实证融合量化驾驶舱 & 个股买前风控闸门

## 1. 核心定位与设计哲学

本技能由 **5 年零未来数据因果体检（Phase 0）+ 严格 Walk-Forward 样本外盲测（`2021–2023` IS → `2024–2026` OOS）** 实证锁定，彻底剔除两套旧系统中的失效/反相因子（如 `Em` 弹性比值、`IF_pct120` 极性倒挂、`ERP 0.8~1.5σ` 熊市接飞刀、`19-ETF` 条件加分器），保留并强化具备双体制稳健性的三层大盘架构与解耦式个股风控闸门：

- **L1 纠偏战略罗盘（定 2~8 周大波段与主仓位）**：
  - 主轴：上证 + 沪深300 周K/日K 一目均衡表 + VW-MACD + 布林/CCI；
  - 纠偏确认分（总权重 `3.5`）：`ERP (1.5)` 严卡 `≥+1.5σ / ≤-1.2σ` + `50/300 PCR (1.0)` 极性反转且保留 50 领先 300 假底否决 + `IM/IC 滚仓基差 120D分位 (1.0)` 附 **分红季绝对贴水底线 (`≥-5.0%`) 护栏**；
  - **双空防单票推翻铁律**：周空 + 日空时严禁单一非 ERP 因子把 `空` 软化成 `准备多`（彻底封堵 `2026-09-22` 类误判）；
  - **非对称确认缓冲 (`K=2` 默认 / `K=3` 低频)**：普通切态需连续 `K` 日确认，周/日双空硬破位 0 延迟当日切空。
- **L2 战术拐点与催化雷达（抓 V 底、防冲顶、看催化）**：
  - 极端左尾恐慌探针（全A真中位数 `≤-4%` / 5日 `≤-8%` / `IC ≤-25%`）→ 防守期 `40%` 有界试仓（`-5%` 硬止损、最长 10 日）；
  - 冲顶暴走护栏（`adv_ratio≥85% & adv_amt_ratio≥80% & 偏离MA20>+8%`，如 `2024-10-08`）→ 连续 3 日封顶 `50%`；
  - 大阳线中轨监测 + **精确 `3/4` 蓝灯**（严禁收紧为 4/4 AND）；
  - 新浪 + 东财 **7×24 双源免密快讯雷达**。
- **L3 成长风格叠加与 49 行业轮动**：
  - 科创50 / 创业板专属仓位叠加：`3/4 蓝灯` 提升至 `80%`，触发 **`双创 TCR > 40% 且放量滞涨`**（压至 `≤30%`）或 **`跌破大阳线中轨`**（压至 `≤20%`）立即风控减仓；
  - 新浪 49 一级行业领涨榜与主力资金净流入榜；
  - 19-ETF、两融原始 5D 变动、中美 10Y 60D 利差变化仅作纯观测展示（权重 `0.0`）。
- **Phase 2 解耦式个股趋势与买前风控闸门 (`stock_gate.py`)**：
  - 支持任意动态股票代码输入（或自动联动当日领涨行业龙头）；
  - 五维量化审查：周/日多周期趋势 + 20D/60D 相对强弱 RS + 形态与追高红灯（大阳线中轨/MA20支撑/VCP/偏离>12%拦截）+ 1D/3D/5D 主力资金（严格 ETF 防火墙）+ 结构止损与 R:R 盈亏比；
  - **单向耦合 L1 大盘仓位上限**：大盘 `空 (0%)` 时强制 `VETO` 严禁新开多仓，大盘多头期才放开单票至 `20%`。

---

## 2. 铁律与数据纪律

1. **零数据造假**：任何上游接口超时或缺失必须返回 `None` 并显式列示在 `missing_items`，绝不硬编码或静默回填历史默认值。
2. **强制 `module_dates` 跨日防污染门禁**：`tech / breadth / cffex` 等 T+0 核心模块若日期错位，自动标记 `CROSS_DAY_CONTAMINATED` 并拒绝写入污染台账；ERP/PCR/两融的法定 T-1 滞后显式标注 `EXPECTED_T1_LAG`。
3. **双层人性化输出**：每次研判必须同时给出 **【主波段定性】**（供低频持波段用户）与 **【精确目标仓位】**（五档阶梯：`0% / 20% / 30% / 40~50% / 100%`）。
4. **ETF 防火墙**：宽基/行业 ETF 严禁进入个股 DDX 风控闸门，统一遵循 L1/L3 指数仓位建议。

---

## 3. 快速执行命令

```bash
# 1. 首次使用建议回填 130 日纯净期指基差与 60 日上交所官方期权 PCR 底座
python skills/ashare-alpha-cockpit/scripts/run_cockpit.py --mode backfill --days 130

# 2. 每日盘后/尾盘全景驾驶舱（默认 K=2 缓冲，落盘 SQLite & CSV 台账）
python skills/ashare-alpha-cockpit/scripts/run_cockpit.py --mode daily

# 3. 低频稳健档（K=3 确认缓冲，更低换手、更浅回撤）
python skills/ashare-alpha-cockpit/scripts/run_cockpit.py --mode daily --k 3

# 4. 一体化全景 + 个股买前风控闸门（指定任意股票，或留空自动扫描今日领涨行业龙头）
python skills/ashare-alpha-cockpit/scripts/run_cockpit.py --mode full --stocks 688981,300750,002371

# 5. 独立审查个股风控闸门（自动读取最新台账 L1 仓位上限，或用 --l1-pos 指定）
python skills/ashare-alpha-cockpit/scripts/run_cockpit.py --mode stock --stocks 688981,600519

# 6. 查看历史决策台账（含跨日校验与波段状态）
python skills/ashare-alpha-cockpit/scripts/run_cockpit.py --mode ledger
```

---

## 4. 目录结构与延伸文档

- 配置文件：[cockpit_config.json](config/cockpit_config.json)、[etf_19_universe.json](config/etf_19_universe.json)
- 方法论与回测实证依据：[methodology.md](references/methodology.md)
- 自动化测试：`python -m pytest -q skills/ashare-alpha-cockpit/tests/test_cockpit.py`
