/**
 * Supabase統一初期化モジュール
 * 
 * このファイルは全てのSupabase初期化を統合管理します
 * - supabase-client.js
 * - auth-supabase.js
 * - supabase-init-wait.js
 * の機能を1つに統合
 */

(function() {
    'use strict';

    // console.log('[SupabaseUnified] 統一初期化モジュール読み込み開始');

    // Supabase設定
    const SUPABASE_URL = 'https://zrddqaaaoerbguwxrlic.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpyZGRxYWFhb2VyYmd1d3hybGljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMTk0NjAsImV4cCI6MjA4Njc5NTQ2MH0.Z0LLFDeDq2zja_jQXeYWDYB1uZe1wGIP-7HmEoUc6qk';

    // 初期化フラグ
    let isInitialized = false;
    let authInitialized = false;

    // Supabaseクライアントの初期化を待つPromise
    window.waitForSupabase = function() {
        return new Promise((resolve) => {
            if (window.supabaseClient) {
                resolve(window.supabaseClient);
                return;
            }

            const checkInterval = setInterval(() => {
                if (window.supabaseClient) {
                    clearInterval(checkInterval);
                    resolve(window.supabaseClient);
                }
            }, 100);

            // 10秒でタイムアウト
            setTimeout(() => {
                clearInterval(checkInterval);
                resolve(null);
            }, 10000);
        });
    };

    // Supabase CDNを読み込み（バージョンピン + 重複防止）
    function loadSupabaseSDK() {
        return new Promise((resolve, reject) => {
            // HTML側で既にロード済みならスキップ
            if (typeof supabase !== 'undefined' && supabase.createClient) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.95.3';
            script.integrity = 'sha384-aRAaCbKYByQpx0fjPuC0PQ9P9moWMEsHXP9tyzP7tbyD5fPK6oTp+THsxdWiq02L';
            script.crossOrigin = 'anonymous';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    // Supabaseクライアントを初期化
    async function initializeSupabase() {
        if (isInitialized) {
            // console.log('[SupabaseUnified] 既に初期化済み');
            return;
        }

        try {
            // SDKを読み込み
            await loadSupabaseSDK();
            // console.log('[SupabaseUnified] Supabase SDK読み込み完了');

            // クライアントを作成
            window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true
                }
            });

            // 後方互換性のため両方の参照を設定
            window.supabase = window.supabaseClient;

            isInitialized = true;
            // console.log('[SupabaseUnified] Supabaseクライアント初期化完了');

            // 初期化完了イベントを発火
            window.dispatchEvent(new Event('supabaseReady'));

            // 認証機能を初期化
            initializeAuth();

            // 認証状態変更リスナーをセットアップ
            setupAuthStateListener();

        } catch (error) {
            console.error('[SupabaseUnified] 初期化エラー:', error);
        }
    }

    // 認証機能の初期化
    function initializeAuth() {
        if (authInitialized) return;
        authInitialized = true;

        // console.log('[SupabaseUnified] 認証機能初期化開始');

        // ログインフォームの処理
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', handleEmailLogin);
            // console.log('[SupabaseUnified] ログインフォームハンドラー設定完了');
        }

        // LINEログインボタンの処理は login-bundle.js (line-login-simple.js) に一本化
        // ここでは二重バインドを防ぐため何もしない

        // 認証状態をチェック
        checkAuthStatus();
    }

    // 安全なgetUserヘルパー（data が null でもクラッシュしない）
    window.safeGetUser = async function() {
        try {
            // ゲストモードの場合はゲストユーザーオブジェクトを返す
            if (sessionStorage.getItem('isGuestMode') === 'true') {
                return {
                    id: 'guest-user',
                    email: 'guest@interconnect.jp',
                    user_metadata: { name: 'ゲストユーザー', isGuest: true }
                };
            }
            if (!window.supabaseClient) return null;
            const { data, error } = await window.supabaseClient.auth.getUser();
            if (error || !data) return null;
            return data.user || null;
        } catch (e) {
            return null;
        }
    };

    // ログイン試行回数制限（クライアント側）
    let loginFailCount = 0;
    let loginLockUntil = 0;

    // メールアドレスでのログイン
    async function handleEmailLogin(e) {
        e.preventDefault();

        const submitButton = e.target.querySelector('button[type="submit"]');

        // ロックアウトチェック
        if (Date.now() < loginLockUntil) {
            const remainSec = Math.ceil((loginLockUntil - Date.now()) / 1000);
            showError(`ログイン試行回数が上限に達しました。${remainSec}秒後に再度お試しください。`);
            return;
        }

        const email = e.target.email.value;
        const password = e.target.password.value;

        // ローディング状態
        submitButton.classList.add('loading');
        submitButton.disabled = true;
        submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ログイン中...';

        try {
            const { data, error } = await window.supabaseClient.auth.signInWithPassword({
                email: email,
                password: password
            });

            if (error) {
                loginFailCount++;
                if (loginFailCount >= 3) {
                    loginLockUntil = Date.now() + 30000; // 30秒ロック
                    loginFailCount = 0;
                    showError('ログイン試行回数が上限に達しました。30秒後に再度お試しください。');
                } else {
                    showError('ログインに失敗しました: ' + error.message);
                }
                submitButton.classList.remove('loading');
                submitButton.disabled = false;
                submitButton.textContent = 'ログイン';
                return;
            }

            // ログイン成功時はカウンターリセット
            loginFailCount = 0;
            
            // ログイン成功
            // console.log('[SupabaseUnified] ログイン成功:', data.user.email);
            
            // ユーザー情報を保存
            localStorage.setItem('user', JSON.stringify({
                id: data.user.id,
                email: data.user.email,
                name: data.user.user_metadata?.name || email.split('@')[0]
            }));
            
            // ダッシュボードへリダイレクト
            window.location.href = 'dashboard.html';
            
        } catch (err) {
            console.error('[SupabaseUnified] ログインエラー:', err);
            showError('ログイン処理中にエラーが発生しました');
            submitButton.classList.remove('loading');
            submitButton.disabled = false;
            submitButton.textContent = 'ログイン';
        }
    }

    // LINEログインは login-bundle.js (line-login-simple.js) に一本化

    // 認証状態をチェック
    async function checkAuthStatus() {
        // 公開ページでは認証チェックをスキップ
        const currentPath = window.location.pathname;
        const publicPages = ['index.html', '/', '', 'login.html', 'register.html', 'forgot-password.html', 'reset-password.html', 'line-callback.html', 'invite.html'];
        const isPublicPage = publicPages.some(page => {
            if (page === '/' || page === '') {
                return currentPath === '/' || currentPath === '/index.html' || currentPath === '';
            }
            return currentPath.includes(page);
        });

        // 公開ページの場合は認証チェックをスキップ
        if (isPublicPage) {
            // console.log('[SupabaseUnified] 公開ページのため認証チェックをスキップ');
            return;
        }

        // ゲストモードの場合は認証チェックをスキップ
        if (sessionStorage.getItem('isGuestMode') === 'true') {
            // console.log('[SupabaseUnified] ゲストモードのため認証チェックをスキップ');
            return;
        }
        
        try {
            const { data: { user }, error } = await window.supabaseClient.auth.getUser();
            
            if (error) {
                // 401/403エラーの場合は認証が必要
                if (error.status === 401 || error.status === 403) {
                    // 保護されたページの場合はログインページへリダイレクト
                    const protectedPages = ['dashboard', 'members', 'events', 'messages', 'matching', 'profile', 'referral', 'notifications', 'settings', 'billing', 'activities'];
                    const currentPage = window.location.pathname.split('/').pop().replace('.html', '');
                    
                    if (protectedPages.includes(currentPage)) {
                        console.warn('[SupabaseUnified] 認証が必要です。ログインページへリダイレクトします。');
                        sessionStorage.setItem('redirectAfterLogin', window.location.href);
                        window.location.href = 'login.html';
                        return;
                    }
                }
                // 公開ページではエラーを無視
                return;
            }
            
            if (user) {
                // console.log('[SupabaseUnified] ログイン済みユーザー:', user.email);
                
                // ログインページの場合はダッシュボードへリダイレクト
                if (window.location.pathname.includes('login.html')) {
                    // リダイレクト先があれば優先
                    const redirectUrl = sessionStorage.getItem('redirectAfterLogin');
                    if (redirectUrl) {
                        sessionStorage.removeItem('redirectAfterLogin');
                        // 相対パスまたは同一オリジンのみ許可（オープンリダイレクト防止）
                        if (redirectUrl.startsWith('/') || redirectUrl.startsWith(window.location.origin)) {
                            window.location.href = redirectUrl;
                        } else {
                            window.location.href = 'dashboard.html';
                        }
                    } else {
                        window.location.href = 'dashboard.html';
                    }
                }
            }
        } catch (err) {
            // 公開ページではエラーを無視（ログも出さない）
            if (!isPublicPage) {
                console.error('[SupabaseUnified] 認証状態チェックエラー:', err);
            }
            // エラーが発生しても処理を継続
        }
    }

    // エラー表示（XSS修正: innerHTML → textContent + DOM構築）
    function showError(message) {
        const existingError = document.querySelector('.auth-error');
        if (existingError) {
            existingError.remove();
        }

        const errorDiv = document.createElement('div');
        errorDiv.className = 'auth-error';

        const icon = document.createElement('i');
        icon.className = 'fas fa-exclamation-circle';
        const span = document.createElement('span');
        span.textContent = message;
        errorDiv.appendChild(icon);
        errorDiv.appendChild(document.createTextNode(' '));
        errorDiv.appendChild(span);

        const form = document.getElementById('loginForm');
        if (form && form.parentNode) {
            form.parentNode.insertBefore(errorDiv, form);
        }

        // 5秒後に自動で削除
        setTimeout(() => errorDiv.remove(), 5000);
    }

    // 認証状態変更リスナー（セッション期限切れ時の自動リダイレクト、タブ間同期）
    let authStateUnsubscribe = null;

    function setupAuthStateListener() {
        if (!window.supabaseClient) return;

        const { data: { subscription } } = window.supabaseClient.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
                // ゲストモードでは何もしない
                if (sessionStorage.getItem('isGuestMode') === 'true') return;

                // 公開ページでは何もしない
                const currentPath = window.location.pathname;
                const publicPages = ['index.html', '/', '', 'login.html', 'register.html', 'forgot-password.html', 'reset-password.html', 'line-callback.html', 'invite.html'];
                const isPublicPage = publicPages.some(page => {
                    if (page === '/' || page === '') return currentPath === '/' || currentPath === '/index.html' || currentPath === '';
                    return currentPath.includes(page);
                });

                if (!isPublicPage) {
                    sessionStorage.setItem('redirectAfterLogin', window.location.href);
                    window.location.href = 'login.html';
                }
            }
        });

        authStateUnsubscribe = subscription;
    }

    // ページ離脱時にunsubscribe（メモリリーク防止）
    window.addEventListener('beforeunload', function() {
        if (authStateUnsubscribe && typeof authStateUnsubscribe.unsubscribe === 'function') {
            authStateUnsubscribe.unsubscribe();
        }
    });

    // グローバル関数として公開（LINEログインはlogin-bundle.jsに一本化）
    window.initializeAuth = initializeAuth;

    // 初期化を実行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeSupabase);
    } else {
        initializeSupabase();
    }

})();