/**
 * 微信支付 Native 下单接口模板
 * 路由：POST /api/pay/create
 * 适用：Cloudflare Pages Functions
 *
 * TODO 标记的地方需要根据你的项目调整
 */

import {
  Env,
  wxRequest,
  generateOrderId,
  jsonResponse,
  handleOptions,
} from './_wxpay';

// =========================================================
// TODO: 修改为你的会员等级和对应金额（单位：分）
// =========================================================
const TIER_AMOUNT: Record<string, number> = {
  plus: 1,   // ¥0.01
  pro: 2,    // ¥0.02
};

// TODO: 修改为微信支付收银台显示的商品描述
const TIER_DESCRIPTION: Record<string, string> = {
  plus: 'LingoKids Plus 会员',
  pro: 'LingoKids Pro 会员',
};

interface NativeOrderResponse {
  code_url: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return handleOptions();

  try {
    // -------------------------------------------------------
    // Step 1: 验证用户身份（Session Token）
    // TODO: 替换为你的鉴权逻辑
    // -------------------------------------------------------
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return jsonResponse({ error: '未登录' }, 401);

    const session = await env.DB.prepare(
      'SELECT user_id FROM user_sessions WHERE token = ? AND expires_at > datetime("now")'
    ).bind(token).first<{ user_id: string }>();

    if (!session) return jsonResponse({ error: 'Session 已过期，请重新登录' }, 401);
    const userId = session.user_id;

    // -------------------------------------------------------
    // Step 2: 解析请求体，验证会员等级
    // -------------------------------------------------------
    const { tier } = await request.json<{ tier: string }>();
    const amount = TIER_AMOUNT[tier];

    if (!amount) {
      return jsonResponse({ error: `无效的会员等级: ${tier}` }, 400);
    }

    // -------------------------------------------------------
    // Step 3: 防重复下单（检查是否有未完成的订单）
    // TODO: 可根据业务需要调整逻辑
    // -------------------------------------------------------
    const existingOrder = await env.DB.prepare(
      `SELECT id, code_url FROM orders
       WHERE user_id = ? AND tier = ? AND status = 'pending' AND expires_at > datetime('now')`
    ).bind(userId, tier).first<{ id: string; code_url: string }>();

    if (existingOrder?.code_url) {
      // 返回已有的有效订单
      return jsonResponse({ orderId: existingOrder.id, codeUrl: existingOrder.code_url });
    }

    // -------------------------------------------------------
    // Step 4: 生成商户单号，写入数据库
    // -------------------------------------------------------
    const orderId = generateOrderId('LK'); // TODO: 修改前缀
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2小时后

    await env.DB.prepare(
      `INSERT INTO orders (id, user_id, tier, amount, status, expires_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`
    ).bind(orderId, userId, tier, amount, expiresAt).run();

    // -------------------------------------------------------
    // Step 5: 调微信 Native 下单 API
    // -------------------------------------------------------
    const orderBody = {
      appid: env.WXPAY_APPID,
      mchid: env.WXPAY_MCHID,
      description: TIER_DESCRIPTION[tier] || tier,
      out_trade_no: orderId,
      notify_url: env.WXPAY_NOTIFY_URL,
      amount: { total: amount, currency: 'CNY' },
    };

    const wxRes = await wxRequest<NativeOrderResponse>(
      env, 'POST', '/v3/pay/transactions/native', orderBody
    );

    // -------------------------------------------------------
    // Step 6: 保存 code_url，返回前端
    // -------------------------------------------------------
    await env.DB.prepare(
      'UPDATE orders SET code_url = ? WHERE id = ?'
    ).bind(wxRes.code_url, orderId).run();

    return jsonResponse({ orderId, codeUrl: wxRes.code_url });

  } catch (err) {
    console.error('[pay/create] 错误:', err);
    return jsonResponse({ error: '下单失败，请稍后重试' }, 500);
  }
};

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
