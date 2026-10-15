// templates/LoginModal.snippet.tsx
// 前端登录弹窗组件参考实现 (React + Tailwind CSS + Lucide Icons)
// 特性：双模式选项卡切换、弹窗内嵌微信官方二维码、视口精准裁剪不露底文字、postMessage无刷新平滑完成登录

import React, { useState, useEffect } from 'react';
import { X, Lock, User as UserIcon, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react';

interface User {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
}

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: User) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
}) => {
  const [loginMode, setLoginMode] = useState<'wechat' | 'account'>('wechat');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isWechatLoading, setIsWechatLoading] = useState(false);
  const [wechatUrl, setWechatUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 1. 监听来自扫码 iframe 的登录成功通信 (postMessage)
  useEffect(() => {
    if (!isOpen) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'WECHAT_LOGIN_SUCCESS') {
        const { token, user } = event.data;
        if (token && user) {
          // 保存登录态到 LocalStorage
          localStorage.setItem('auth_token', token);
          localStorage.setItem('auth_user', JSON.stringify(user));

          onLoginSuccess(user);
          onClose();
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isOpen, onLoginSuccess, onClose]);

  // 2. 拉取微信扫码嵌入链接
  const loadWechatQr = async () => {
    setIsWechatLoading(true);
    setErrorMessage(null);
    try {
      const resp = await fetch('/api/auth/wechat/url');
      const data = await resp.json();
      if (data.success && data.url) {
        setWechatUrl(data.url);
      } else {
        throw new Error(data.error || '获取二维码失败');
      }
    } catch (err: any) {
      setErrorMessage(err.message || '拉取微信授权二维码失败');
    } finally {
      setIsWechatLoading(false);
    }
  };

  // 弹窗打开或切换至微信扫码时自动加载
  useEffect(() => {
    if (isOpen && loginMode === 'wechat' && !wechatUrl) {
      loadWechatQr();
    }
  }, [isOpen, loginMode]);

  if (!isOpen) return null;

  // 账号密码登录提交
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await resp.json();
      if (data.success) {
        localStorage.setItem('auth_token', data.token);
        localStorage.setItem('auth_user', JSON.stringify(data.user));
        onLoginSuccess(data.user);
        onClose();
      } else {
        throw new Error(data.error || '登录失败');
      }
    } catch (err: any) {
      setErrorMessage(err.message || '登录异常');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden border">
        
        {/* 顶部标题栏 */}
        <div className="bg-gradient-to-r from-emerald-700 to-teal-800 px-6 pt-6 pb-5 text-white relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <h2 className="text-xl font-bold">用户登录</h2>
          <p className="text-xs text-emerald-100/90 mt-1">
            登录你的账号，同步云端数据与专属特权
          </p>
        </div>

        {/* 主体区 */}
        <div className="p-6 space-y-4">

          {/* 切换 Tab：微信扫码 / 账号密码 */}
          <div className="flex bg-gray-100 p-1 rounded-2xl border border-gray-200">
            <button
              type="button"
              onClick={() => setLoginMode('wechat')}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                loginMode === 'wechat' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              <span>微信扫码登录</span>
            </button>
            <button
              type="button"
              onClick={() => setLoginMode('account')}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                loginMode === 'account' ? 'bg-white text-emerald-800 shadow-sm' : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              <UserIcon className="w-4 h-4" />
              <span>账号密码登录</span>
            </button>
          </div>

          {/* 错误提示条 */}
          {errorMessage && (
            <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold flex items-center gap-2">
              <X className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* 🟢 模式 1：弹窗内嵌微信官方扫码（核心：300x300 iframe 结合 0.82 缩放与 280x270 视窗裁剪） */}
          {loginMode === 'wechat' && (
            <div className="flex flex-col items-center justify-center py-1">
              <div className="relative w-[280px] h-[270px] overflow-hidden rounded-2xl border-2 border-emerald-100 bg-white shadow-sm flex items-center justify-center">
                {isWechatLoading ? (
                  <div className="flex flex-col items-center justify-center p-6 text-center">
                    <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mb-3" />
                    <p className="text-xs text-gray-500 font-bold">正在拉取微信安全二维码...</p>
                  </div>
                ) : wechatUrl ? (
                  <iframe
                    src={wechatUrl}
                    title="微信扫码登录"
                    scrolling="no"
                    frameBorder="0"
                    className="w-[300px] h-[300px] shrink-0 scale-[0.82] origin-center pointer-events-auto"
                    sandbox="allow-scripts allow-top-navigation allow-same-origin allow-forms"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center p-4 text-center">
                    <p className="text-xs text-red-600 font-bold mb-3">{errorMessage || '二维码加载失败'}</p>
                    <button
                      onClick={loadWechatQr}
                      className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>点击重试</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between w-[280px] mt-2.5 px-1 text-xs">
                <span className="flex items-center gap-1.5 text-gray-500 font-bold">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  请使用手机微信「扫一扫」
                </span>
                <button
                  type="button"
                  onClick={loadWechatQr}
                  disabled={isWechatLoading}
                  className="text-emerald-700 hover:underline flex items-center gap-1 text-[11px] font-semibold"
                >
                  <RefreshCw className={`w-3 h-3 ${isWechatLoading ? 'animate-spin' : ''}`} />
                  <span>刷新</span>
                </button>
              </div>
            </div>
          )}

          {/* 🔑 模式 2：传统账号密码表单 */}
          {loginMode === 'account' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">用户名</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名"
                  className="w-full px-4 py-2.5 rounded-xl border bg-gray-50 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1.5">密码</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入密码"
                    className="w-full px-4 py-2.5 rounded-xl border bg-gray-50 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 p-1"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 rounded-2xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>立即登录</span>}
              </button>
            </form>
          )}

        </div>

      </div>
    </div>
  );
};
