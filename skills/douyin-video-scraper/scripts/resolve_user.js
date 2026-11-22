// 抖音号(unique_id) -> sec_uid
// 用法: node scripts/resolve_user.js <抖音号>
// 走 iesdouyin 公开接口，不改签名、不登录。
const UNIQUE = process.argv[2];

if (!UNIQUE) {
  console.error('用法: node scripts/resolve_user.js <抖音号>');
  console.error('例:   node scripts/resolve_user.js Bruce_Gold');
  process.exit(1);
}

const URL = 'https://www.iesdouyin.com/web/api/v2/user/info/?unique_id=' + encodeURIComponent(UNIQUE);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

(async () => {
  const r = await fetch(URL, { headers: { 'User-Agent': UA, 'Referer': 'https://www.douyin.com/' } });
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch (e) {
    console.error('接口返回的不是 JSON，原始片段:', text.slice(0, 200));
    process.exit(2);
  }
  const user = j.user || j;
  const secUid = user.sec_uid;
  if (!secUid) {
    console.error('未找到 sec_uid。可能抖音号不存在、已改名，或接口被风控。原始:', text.slice(0, 300));
    process.exit(3);
  }
  console.log(JSON.stringify({
    unique_id: UNIQUE,
    nickname: user.nickname || '',
    sec_uid: secUid,
    followers: user.follower_count ?? null,
    user_page: 'https://www.douyin.com/user/' + secUid,
  }, null, 2));
})().catch((e) => { console.error('请求失败:', e.message); process.exit(4); });
