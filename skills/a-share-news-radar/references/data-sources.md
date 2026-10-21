# 行情与资金流数据源

本文件记录**在本机实测可用**的免费数据源、接口形式与坑点。所有结论来自 2026-10-20 在 aliyun 47.81.56.238 的实测，不是文档抄录。

## 总览

| 数据 | 首选源 | 备选 | 实测状态 |
|---|---|---|---|
| 指数/个股实时快照 | 腾讯 `qt.gtimg.cn` | tushare `daily` | ✅ 可用 |
| 日K（任意深度） | 腾讯 `ifzq.gtimg.cn` | tushare `daily` | ✅ 可用 |
| 分时（逐分钟） | 腾讯 `web.ifzq.gtimg.cn` | — | ✅ 可用 |
| 分钟K m1/m5/m15/m30/m60 | 腾讯 `ifzq.gtimg.cn` | — | ✅ 可用 |
| 大单净量 / 资金流 | 新浪 `vip.stock.finance.sina.com.cn` | — | ✅ 可用（单只） |
| 交易日判断 | 腾讯 K线最后日期 | tushare `trade_cal` | ✅ 可用 |

## 不可用的源（不要浪费时间）

| 源 | 现象 |
|---|---|
| 东财 `push2his.eastmoney.com` | 间歇成功后持续 `RemoteDisconnected`，本机被稳定拦截 |
| 东财 `push2.eastmoney.com` | `502 Bad Gateway` |
| 新浪 `hq.sinajs.cn` | `403 Forbidden`（注意：与下面的 `vip.stock` 是两道不同防线） |
| 腾讯资金流 | `FundflowController` 不存在；`q=ff_sh600519` 返回 `pv_none_match` |
| tushare `moneyflow` / `moneyflow_hsgt` | 免费档返回「没有访问权限」 |

## 腾讯接口

### 1. 实时快照（20 只/请求）

```
https://qt.gtimg.cn/q=sh000001,sz399001,sz399006,sh600519
```

- 编码 **GBK**，需 `iconv` 或 `decode("gbk")`
- 每只返回一段 `v_<code>="..."`，字段以 `~` 分隔
- 常用字段下标：`[1]`名称 `[2]`代码 `[3]`现价 `[4]`昨收 `[5]`今开 `[31]`涨跌 `[32]`涨跌幅% `[33]`最高 `[34]`最低 `[36]`成交量 `[37]`成交额 `[38]`换手率 `[49]`量比

### 2. 日K（任意深度）

```
https://ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000001,day,,,320,qfq
```

- **必须用 `ifzq.gtimg.cn`（不带 `web.`）**。`web.ifzq.gtimg.cn` 取 5~10 条能过，取 60 条以上返回 **501 Not Implemented**
- 也可用显式日期区间：`param=sh000001,day,2026-01-01,2026-10-20,320,qfq`
- 返回 JSON：`data.<code>.qfqday`（前复权）或 `.day`，每条为 `[日期, 开, 收, 高, 低, 量]`
- 实测 60 条、190 条均正常

### 3. 分时（当日逐分钟）

```
https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=sh000001
```

- 返回 `data.<code>.data.data`，每条 `"0930 3718.44 3232258 5467558220.30"`
- 含义：**时间 / 价格 / 累计成交量 / 累计成交额**

### 4. 分钟K

```
https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=sh000001,m5,,10
```

- `m1` `m5` `m15` `m30` `m60` 五种周期均实测可用
- 每条 `[时间戳, 开, 收, 高, 低, 量, {}, 额]`

## 新浪资金流（大单净量）

`hq.sinajs.cn` 被 403，但 `vip.stock.finance.sina.com.cn` 可用。

### 当日四档资金

```
https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/MoneyFlow.ssi_ssfx_flzjtj?daima=sh600519
```

返回 `r0_in` `r0_out` `r0` / `r1_*` / `r2_*` / `r3_*`：

- `r0` = 超大单，`r1` = 大单，`r2` = 中单，`r3` = 小单
- 大单净量 = `(r0_in + r1_in) - (r0_out + r1_out)`，或直接用 `r0_in - r0_out` 作超大单净额

### 资金流历史

```
https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/MoneyFlow.ssl_qsfx_zjlrqs?daima=sh600519&num=120
```

- 实测 `num=120` 返回 120 个交易日
- 字段：`opendate` `trade` `changeratio` `turnover` `netamount`（净流入额）`r0_net`（超大单净额）`r0_ratio` `r0x_ratio`

### 限制

**只能单只查询**。逗号拼接多只只会返回第一只。20 只候选股需 20 次请求（约 25 秒），因此只对最终候选池（5~15 只）查询，不要对全市场查。

## tushare 免费档的额度真相

- `index_daily`：**1 次/分钟**，连续违规会**降级到 1 次/小时**
- `trade_cal`：同样会被降级
- `daily` 传 `trade_date` 单参数：**1 次返回全市场 5568 只**，这个额度相对宽松，适合批量回看
- `moneyflow` / `moneyflow_hsgt`：免费档无权限

**结论**：tushare 不要用来逐只取数，只用于「按日期批量取全市场」。

## 交易日判断（零成本）

不调 `trade_cal`，直接看腾讯日K最后一条日期：

- 盘后任务（16:00+）：最新 K线日期 == 今天 → 开市；否则休市
- 盘前任务（08:00）：最新 K线日期 == 上一交易日属正常，直接跑

实测：`最新K线日期 = 2026-10-20`，`今天 = 2026-10-20` → 已开市；近 5 个交易日 `10-14/15/16/19/20` 与真实日历一致。

## 使用纪律

- 腾讯、新浪都是**非官方网页接口**，无 SLA，可能随时改结构或加风控
- **只适合低频内部使用**（每天个位数到几十次请求），不要做分钟级轮询或对外分发
- 必须做本地缓存：接口异常时当天仍能用缓存出报告
- 必须做多源降级，不要只押一个源
