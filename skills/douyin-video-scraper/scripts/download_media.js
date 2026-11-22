// 抓取 + 立即下载 mp4 + 抽 mp3 + 抽关键帧，写 manifest.json。
// 用法: node scripts/download_media.js <sec_uid> [输出目录] [--headful] [--max N]
//
// 为什么要在这里重新抓列表，而不是读 fetch_posts.js 存下的 posts.json：
//   视频直链 play_addr.url_list[0] 带签名，有时效。存下来以后再下会拿到 0KB。
//   实战路径是「拦截到列表 → 当场立刻下载」，所以本脚本把抓取和下载放一个流程里。
// fetch_posts.js 只用于先快速看元数据（标题/日期/摘要），不用于下载。
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const SU = args[0];
if (!SU) {
  console.error('用法: node scripts/download_media.js <sec_uid> [输出目录] [--headful] [--max N]');
  process.exit(1);
}
const positional = args.filter((a) => !a.startsWith('--')).slice(1);
const OUTDIR = positional[0] || 'all';
const HEADFUL = args.includes('--headful');
const maxIdx = args.indexOf('--max');
const MAX = maxIdx >= 0 ? parseInt(args[maxIdx + 1], 10) : 0;
const UDD = path.join(__dirname, '..', '.udd');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

function have(bin) {
  try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
}

(async () => {
  if (!have('ffmpeg')) { console.error('未找到 ffmpeg，请先安装并加入 PATH'); process.exit(2); }

  const ctx = await chromium.launchPersistentContext(UDD, {
    channel: 'chrome',
    headless: !HEADFUL,
    viewport: { width: 1400, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const pool = new Map();
  page.on('response', async (res) => {
    if (!/aweme\/v1\/web\/aweme\/post/.test(res.url())) return;
    try {
      const j = await res.json();
      (j.aweme_list || []).forEach((a) => pool.set(a.aweme_id, a));
    } catch (e) {}
  });

  try {
    await page.goto('https://www.douyin.com/user/' + SU, { waitUntil: 'commit', timeout: 45000 });
  } catch (e) { console.log('goto 提示:', e.message.split('\n')[0]); }
  await page.waitForTimeout(8000);

  let idle = 0;
  for (let i = 0; i < 30; i++) {
    const before = pool.size;
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(2200);
    if (pool.size === before) idle++; else idle = 0;
    if (idle >= 4) break;
    if (MAX && pool.size >= MAX) break;
  }
  console.log('抓到作品', pool.size, '条，开始下载（浏览器保持打开以保证签名新鲜）');
  await ctx.close().catch(() => {}); // 列表已拿到；下面立刻下载

  const rows = [...pool.values()].sort((a, b) => b.create_time - a.create_time);
  fs.mkdirSync(OUTDIR, { recursive: true });
  const manifest = [];
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    const n = i + 1;
    const d = new Date(a.create_time * 1000);
    const dt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const base = path.join(OUTDIR, `${String(n).padStart(2, '0')}_${dt}_${a.aweme_id}`);
    const url = ((a.video && a.video.play_addr && a.video.play_addr.url_list) || [])[0];
    let ok = false;
    if (url) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://www.douyin.com/' } });
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > 50000) { fs.writeFileSync(base + '.mp4', buf); ok = true; }
        }
      } catch (e) {}
    }
    let audioOk = false;
    if (ok) {
      try {
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', base + '.mp4', '-vn', '-ac', '1', '-ar', '16000', base + '.mp3']);
        audioOk = fs.existsSync(base + '.mp3') && fs.statSync(base + '.mp3').size > 2000;
        // 均匀抽 2 帧仅用于快速判断画面类型；精确的关键帧在成文阶段按关键词密抽。
        const dur = Math.round((a.duration || 0) / 1000);
        for (const [idx, frac] of [0.33, 0.66].entries()) {
          const t = Math.max(1, Math.round(dur * frac));
          execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(t), '-i', base + '.mp4',
            '-frames:v', '1', '-vf', 'scale=720:-1', '-q:v', '4', `${base}_f${idx + 1}.jpg`]);
        }
      } catch (e) {}
    }
    const sz = ok ? Math.round(fs.statSync(base + '.mp4').size / 1024) : 0;
    console.log(`[${n}/${rows.length}] ${dt} ${Math.round((a.duration || 0) / 1000)}s mp4=${sz}KB audio=${audioOk}`);
    manifest.push({
      n, date: dt, aweme_id: a.aweme_id, dur: Math.round((a.duration || 0) / 1000), base, ok, audio: audioOk,
      title: a.item_title, desc: a.desc, abstract: a.chapter_abstract,
      chapters: (a.chapter_list || []).map((c) => ({ t: Math.round((c.timestamp || 0) / 1000), d: c.desc, detail: c.detail })),
      stats: a.statistics,
    });
    fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 1), 'utf8'); // 每条即时落盘，防中断丢数据
  }
  console.log('完成，成功下载', manifest.filter((m) => m.ok).length, '/', rows.length, '-> manifest.json');
})().catch((e) => { console.error('ERR', e.message); process.exit(2); });
