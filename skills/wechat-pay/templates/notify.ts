/**
 * 微信支付回调通知处理模板
 * 路由：POST /api/pay/notify
 * 适用：Cloudflare Pages Functions
 *
 * 说明：
 *   1. 验证签名（防止伪造回调）
 *   2. AES-256-GCM 解密报文
 *   3. 核对金额和订单号
 *   4. 开通会员
 *   5. 返回 { "code": "SUCCESS" }（否则微信会持续重试）
 *
 * 重要：此接口无需用户登录验证（微信服务器直接调用）
 *       但必须验证微信签名，防止伪造攻击
 */

import {
  Env,
  verifyNotifySignature,
  decryptNotify,
  jsonResponse,
} from './_wxpay';
import { grantMembership } from './query';

interface NotifyBody {
  event_type: string;
  resource: {
    algorithm: string;
    ciphertext: string;
    nonce: string;
    associated_data: string;
  };
}

interface DecryptedTransaction {
  out_trade_no: string;         // 商户单号
  transaction_id: string;       // 微信交易号
  trade_state: string;          // 支付状态
  success_time: string;         // 支付完成时间
  amount: {
    total: number;              // 实际支付金额（分）
    payer_total: number;
  };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    // -------------------------------------------------------
    // Step 1: 读取回调请求体和签名 Header
    // -------------------------------------------------------
    const body = await request.text();
    const timestamp = request.headers.get('Wechatpay-Timestamp') || '';
    const nonce     = request.headers.get('Wechatpay-Nonce') || '';
    const signature = request.headers.get('Wechatpay-Signature') || '';

    // -------------------------------------------------------
    // Step 2: 验证签名（防伪造）
    // -------------------------------------------------------
    const isValid = await verifyNotifySignature(env, timestamp, nonce, body, signature);
    if (!isValid) {
      console.error('[pay/notify] 签名验证失败');
      return jsonResponse({ code: 'FAIL', message: '签名验证失败' }, 400);
    }

    // -------------------------------------------------------
    // Step 3: 解析事件类型
    // -------------------------------------------------------
    const notifyBody: NotifyBody = JSON.parse(body);

    // 只处理支付成功事件
    if (notifyBody.event_type !== 'TRANSACTION.SUCCESS') {
      return jsonResponse({ code: 'SUCCESS', message: '忽略' });
    }

    // -------------------------------------------------------
    // Step 4: AES-256-GCM 解密报文
    // -------------------------------------------------------
    const { resource } = notifyBody;
    const plainText = await decryptNotify(
      env,
      resource.ciphertext,
      resource.nonce,
      resource.associated_data
    );
    const transaction: DecryptedTransaction = JSON.parse(plainText);

    // -------------------------------------------------------
    // Step 5: 验证支付状态
    // -------------------------------------------------------
    if (transaction.trade_state !== 'SUCCESS') {
      return jsonResponse({ code: 'SUCCESS', message: '非支付成功状态' });
    }

    // -------------------------------------------------------
    // Step 6: 查询本地订单，验证金额
    // -------------------------------------------------------
    const order = await env.DB.prepare(
      'SELECT tier, amount FROM orders WHERE id = ?'
    ).bind(transaction.out_trade_no)
      .first<{ tier: string; amount: number }>();

    if (!order) {
      // 订单不存在（可能是其他系统的回调，忽略即可）
      return jsonResponse({ code: 'SUCCESS', message: '订单不存在' });
    }

    // TODO: 根据业务需要决定是否严格校验金额
    if (transaction.amount.total !== order.amount) {
      console.error(
        `[pay/notify] 金额不一致: 期望 ${order.amount} 分，实际 ${transaction.amount.total} 分`
      );
      return jsonResponse({ code: 'FAIL', message: '金额不一致' }, 400);
    }

    // -------------------------------------------------------
    // Step 7: 开通会员（幂等安全）
    // -------------------------------------------------------
    await grantMembership(
      env,
      transaction.out_trade_no,
      order.tier,
      transaction.transaction_id,
      transaction.success_time
    );

    // -------------------------------------------------------
    // Step 8: 返回成功（必须，否则微信持续重试）
    // -------------------------------------------------------
    return jsonResponse({ code: 'SUCCESS', message: '成功' });

  } catch (err) {
    console.error('[pay/notify] 处理异常:', err);
    // 返回 500 时微信会重试，适合可恢复的错误
    return jsonResponse({ code: 'FAIL', message: '处理失败' }, 500);
  }
};
