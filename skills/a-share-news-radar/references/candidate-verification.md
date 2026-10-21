# Candidate Verification

Use this reference before naming any stock in a daily A-share news radar. The seed mapping is a memory aid, not a current database.

Read `source-policy.md` first. Source quality determines how strongly a candidate can be labeled: C-level clues cannot by themselves support `公告确认`, `直接受益`, or `High` confidence.

## Candidate Discovery Order

For each event and theme, build the candidate pool in this order:

1. Start with direct event entities: named companies, suppliers, customers, project owners, affected mines/plants/products, and disclosed partners.
2. Search current sources for A-share companies tied to the product, commodity, policy, or supply chain.
3. Read the seed list in `a-share-mapping.md` to avoid missing common candidates.
4. Add newer or more relevant names discovered from current sources even if they are absent from the seed list.
5. Remove seed-list names when current evidence shows delisting, suspension, renamed ticker confusion, business pivot, weak relevance, or no A-share listing.

## Evidence Labels

Attach exactly one primary evidence label to every stock:

- `公告确认`: company filing, exchange announcement, annual/interim report, official procurement/order notice, or company investor-relations reply confirms the link.
- `业务归属`: the company's main business is directly exposed to the variable, such as airline fuel cost, coal price, gold price, box office, or scenic-area traffic.
- `产业链推断`: credible industry-chain logic exists, but customer, order, product share, or revenue contribution still needs verification.
- `情绪映射`: the stock is mainly a concept, region, theme, or sentiment proxy with weak business proof.
- `负面暴露`: the event may hurt costs, demand, supply, policy status, valuation, or risk appetite.
- `剔除`: do not include in the candidate pool except in a note explaining why it was removed.

If two labels seem possible, choose the weaker one unless current evidence clearly supports the stronger label.

Only use `公告确认` when the source is S-level or a clearly attributable A-level company/official source. Use `产业链推断` or `情绪映射` for media-only or market-concept candidates unless a stronger source confirms the link.

## Minimum Verification Checks

Before including a candidate:

- Confirm it is currently an A-share listed company and not delisted, long-suspended, or only an overseas/Hong Kong listing.
- Confirm the company name and ticker are current after any rename, restructuring, or ticker change.
- Confirm whether the link is direct revenue/cost exposure, disclosed supply-chain relationship, or only market concept.
- Check whether the catalyst is new or already traded for several sessions.
- Check for obvious contradictory news: clarification announcement, denial of cooperation, reduction in holdings, regulatory inquiry, or weak downstream demand.
- Assign `source_quality` as `S`, `A`, `B`, or `C` for each candidate. If multiple sources exist, use the strongest source that directly supports the claimed link, not merely the strongest article about the event.
- **Verify actual price action before assigning direction labels**: Before labeling a stock as `直接受益` or `负面暴露`, search for its recent price movement (today or last 5 trading days). If the logical direction conflicts with actual price action (e.g., commodity price dropped but stock rose), downgrade to `观察/核实` and note the divergence. Common reasons: market already priced in, forward-looking expectations, other catalysts, or mean reversion.

## Source Preference

Prefer sources in this order:

1. Exchange filings, company announcements, annual/interim reports, official policy documents, and procurement/order disclosures.
2. Company investor-relations replies or official public account statements.
3. Reputable financial media and industry media with named facts.
4. Market-sector pages and stock-forum summaries only as clue sources; verify before upgrading above `情绪映射`.

## Output Discipline

- Include no more than 3-6 candidates per group unless the user asks for a broad screen.
- Put weaker names in `Watch/verify`, not `Direct benefit`.
- Put a candidate in `Direct benefit` only when it has `公告确认` or clear `业务归属`.
- Include candidate confidence or score when using `scripts/score_events.py`.
- Explicitly say when a candidate is dynamically discovered outside the seed list.
- Explicitly say when a seed-list name was removed because it is stale or no longer listed.
- Do not imply that a candidate is investable merely because it appears in the report.
