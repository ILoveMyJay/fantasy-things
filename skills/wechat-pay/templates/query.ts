/**
 * 微信支付查单接口模板（前端轮询 + 兜底查单）
 * 路由：GET /api/pay/query?orderId=xxx
 * 适用：Cloudflare Pages Functions
 *
 * 说明：前端每 3 秒轮询此接口
 *       - 先查本地数据库订单状态
 *       - 若仍 pending，主动调微信查单 API
 *       - 确认支付成功后自动开通会员（grantMembership）
 *
 * TODO 标记的地方需要根据你的项目调整
 */

import { Env, wxRequest, jsonResponse, handleOptions } from './_wxpay';

interface WxQueryResult {
  trade_state: 'SUCCESS' | 'NOTPAY' | 'CLOSED' | 'REFUND' | 'PAYERROR';
  transaction_id?: string;
  success_time?: string;
  amount?: { total: number };
  out_trade_no: string;
}

// =========================================================
// 核心：开通会员（支付确认后调用）
// 此函数同时被 notify.ts 复用
// TODO: 根据你的业务逻辑修改数据库操作
// =========================================================
export async function grantMembership(
  env: Env,
  orderId: string,
  tier: string,
  wxTradeNo: string,
  paidAt: string
): Promise<void> {
  // 获取订单信息
  const order = await env.DB.prepare(
    `SELECT user_id, amount, status FROM orders WHERE id = ?`
  ).bind(orderId).first<{ user_id: string; amount: number; status: string }>();

  if (!order || order.status === 'paid') {
    // 幂等：已处理过则跳过
    return;
  }

  const userId = order.user_id;

  // TODO: 根据会员等级计算有效期
  // 示例：30天月度会员
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // 使用事务批量执行（D1 batch 保证原子性）
  await env.DB.batch([
    // 1. 更新订单状态
    env.DB.prepare(
      `UPDATE orders SET status = 'paid', wx_trade_no = ?, paid_at = ? WHERE id = ? AND status = 'pending'`
    ).bind(wxTradeNo, paidAt, orderId),

    // 2. TODO: 写入你的订阅/会员表
    // 示例：写入 subscriptions 表
    env.DB.prepare(
      `INSERT OR REPLACE INTO subscriptions (id, user_id, tier, status, starts_at, expires_at, payment_ref)
       VALUES (?, ?, ?, 'active', datetime('now'), ?, ?)`
    ).bind(`sub_${orderId}`, userId, tier, expiresAt, orderId),

    // 3. TODO: 如有 users 表中的 tier 字段，同步更新
    // env.DB.prepare('UPDATE users SET tier = ? WHERE id = ?').bind(tier, userId),
  ]);
}

// =========================================================
// 查单接口
// =========================================================
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    // -------------------------------------------------------
    // Step 1: 鉴权
    // TODO: 替换为你的鉴权逻辑
    // -------------------------------------------------------
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return jsonResponse({ error: '未登录' }, 401);

    const session = await env.DB.prepare(
      'SELECT user_id FROM user_sessions WHERE token = ? AND expires_at > datetime("now")'
    ).bind(token).first<{ user_id: string }>();

    if (!session) return jsonResponse({ error: 'Session 已过期' }, 401);

    // -------------------------------------------------------
    // Step 2: 获取订单
    // -------------------------------------------------------
    const url = new URL(request.url);
    const orderId = url.searchParams.get('orderId');
    if (!orderId) return jsonResponse({ error: '缺少 orderId 参数' }, 400);

    const order = await env.DB.prepare(
      `SELECT id, user_id, tier, amount, status, wx_trade_no
       FROM orders WHERE id = ? AND user_id = ?`
    ).bind(orderId, session.user_id)
      .first<{ id: string; user_id: string; tier: string; amount: number; status: string; wx_trade_no: string }>();

    if (!order) return jsonResponse({ error: '订单不存在' }, 404);

    // 已支付，直接返回
    if (order.status === 'paid') {
      return jsonResponse({ status: 'paid', tier: order.tier });
    }

    // 已过期
    if (order.status === 'expired' || order.status === 'closed') {
      return jsonResponse({ status: order.status });
    }

    // -------------------------------------------------------
    // Step 3: 向微信主动查单（兜底）
    // -------------------------------------------------------
    const path = `/v3/pay/transactions/out-trade-no/${orderId}?mchid=${env.WXPAY_MCHID}`;
    const wxResult = await wxRequest<WxQueryResult>(env, 'GET', path);

    if (wxResult.trade_state === 'SUCCESS') {
      // 微信确认已支付，触发开通会员
      await grantMembership(
        env,
        orderId,
        order.tier,
        wxResult.transaction_id || '',
        wxResult.success_time || new Date().toISOString()
      );
      return jsonResponse({ status: 'paid', tier: order.tier });
    }

    // 未支付
    return jsonResponse({ status: 'pending' });

  } catch (err) {
    console.error('[pay/query] 错误:', err);
    return jsonResponse({ error: '查询失败' }, 500);
  }
};

export const onRequestOptions: PagesFunction<Env> = async () => handleOptions();
