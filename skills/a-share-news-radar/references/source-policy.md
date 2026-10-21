# Source Policy

Use this reference to classify source quality before assigning evidence labels or candidate confidence. Prefer the strongest source that directly supports the stock-specific claim, not merely the strongest source about the broader event.

## Source Tiers

### S: Legal Disclosure And Exchange Sources

Use S-level for official, legally accountable disclosure:

- CNINFO / 巨潮资讯: company announcements, annual/interim/quarterly reports, regulatory letters, inquiry replies.
- Shanghai Stock Exchange, Shenzhen Stock Exchange, Beijing Stock Exchange disclosures.
- CSRC filings and official exchange supervision documents.
- Company announcements mirrored through official exchange disclosure systems.

Allowed labels from S-level evidence:

- `公告确认` when the disclosure directly confirms the link.
- `业务归属` when filings show the relevant business line, revenue, capacity, commodity exposure, or project.
- `剔除` when filings or exchange pages show delisting, suspension, ticker/name changes, or business restructuring.

### A: Company, Official Policy, And Primary Industry Sources

Use A-level for attributable primary sources that are not always legal disclosure:

- Company website, investor-relations page, official public account, official investor-relations replies.
- 互动易, 上证e互动, official earnings-briefing materials.
- Ministries, local governments, customs, energy regulators, industry regulators, and official policy documents.
- Commodity exchanges, industry associations, procurement/order announcements, official event or box-office data providers.

Allowed labels:

- `公告确认` only for directly attributable company/official statements.
- `业务归属` when the source shows direct operational exposure.
- `产业链推断` when the source supports an industry chain but not a company-specific order or revenue contribution.

### B: Reputable Financial And Industry Media

Use B-level for reputable media and industry reporting:

- 证券时报, 中国证券报, 上海证券报, 财联社, 第一财经, 每日经济新闻, 经济观察报, 21世纪经济报道.
- Named industry media, broker notes summarized by reputable outlets, and major commodity/industry data articles.

Allowed labels:

- `产业链推断` when media reports describe supply-chain relevance.
- `业务归属` only when the business exposure is obvious and independently verifiable.
- Do not use media alone for `公告确认`.

### C: Market Clues, Concept Pages, And Social Sources

Use C-level for clue discovery only:

- 东方财富概念页, 同花顺概念页, 雪球, 股吧, social media, unsourced screenshots, market rumor summaries.
- Search snippets, reposts, unattributed "market says" claims.

Allowed labels:

- `情绪映射` by default.
- `产业链推断` only after another source supports the business logic.
- Never use C-level sources alone for `直接受益`, `公告确认`, or `High` confidence.

## Practical Rules

- If a candidate has multiple sources, score the source that directly supports the candidate-specific claim.
- If the event source is S/A but the stock link comes only from a concept page, candidate source quality is C.
- If a company denies the market rumor through announcement or investor relations, downgrade to `剔除` or `情绪映射` and record the contradiction.
- If a source says "related concept" without business details, classify as `情绪映射`.
- If a source shows main-business exposure but not incremental impact, classify as `业务归属` with Medium confidence at most unless the event is large and direct.

