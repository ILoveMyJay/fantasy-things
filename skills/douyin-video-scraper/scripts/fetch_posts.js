// 抓取抖音用户全部作品列表：真实 Chrome 打开主页，拦截 /aweme/v1/web/aweme/post/ 响应。
// 用法: node scripts/fetch_posts.js <sec_uid> [输出json] [--headful] [--max N]
// 首次: npm install playwright-core（需本机已装 Google Chrome）
//
// 关键：不逆向签名。页面自己带合法签名请求接口，我们只在旁边监听响应。
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const SU = args[0];
if (!SU) {
  console.error('用法: node scripts/fetch_posts.js <sec_uid> [输出json] [--headful] [--max N]');
  process.exit(1);
}
const positional = args.filter((a) => !a.startsWith('--')).slice(1);
const OUT = positional[0] || 'posts.json';
const HEADFUL = args.includes('--headful');
const maxIdx = args.indexOf('--max');
const MAX = maxIdx >= 0 ? parseInt(args[maxIdx + 1], 10) : 0;
const UDD = path.join(__dirname, '..', '.udd'); // 持久化浏览器用户数据，保留登录态

(async () => {
  const ctx = await chromium.launchPersistentContext(UDD, {
    channel: 'chrome',
    headless: !HEADFUL,
    viewport: { width: 1440, height: 950 },
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const pool = new Map(); // aweme_id -> aweme，天然去重
  page.on('response', async (res) => {
    if (!/aweme\/v1\/web\/aweme\/post/.test(res.url())) return;
    try {
      const j = await res.json();
      (j.aweme_list || []).forEach((a) => pool.set(a.aweme_id, a));
      console.log('[接口] 本批', (j.aweme_list || []).length, '条，累计去重', pool.size);
    } catch (e) {}
  });

  const url = 'https://www.douyin.com/user/' + SU;
  try {
    await page.goto(url, { waitUntil: 'commit', timeout: 60000 });
  } catch (e) {
    console.log('goto 提示:', e.message.split('\n')[0]);
  }
  await page.waitForTimeout(9000);

  // 滚动到底加载全部。若首屏就有登录墙，用 --headful 手动登录一次（登录态存 .udd）。
  let idle = 0;
  for (let i = 0; i < 30; i++) {
    const before = pool.size;
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(2500); // 频率控制：间隔 >= 2s
    if (pool.size === before) idle++; else idle = 0;
    if (idle >= 4) break;             // 连续 4 次无新增，认为到底
    if (MAX && pool.size >= MAX) break;
  }
  console.log('页面标题:', await page.title());
  await ctx.close().catch(() => {});

  const rows = [...pool.values()].sort((a, b) => b.create_time - a.create_time);
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 1), 'utf8');
  console.log('完成：抓到', rows.length, '条 ->', OUT);
  if (rows.length === 0) {
    console.warn('警告：0 条。检查 sec_uid 是否正确，或加 --headful 登录后重试。');
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(2); });
