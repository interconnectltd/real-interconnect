/**
 * LIFF (LINE Front-end Framework) 初期化スクリプト
 * LINEアプリ内で開いた場合に自動ログインを行う
 */

(function() {
    'use strict';

    // LIFF ID（LINE Developers Consoleで発行）
    // .env の VITE_LIFF_ID か、直接指定
    const LIFF_ID = window.LIFF_ID || '2009174893-SzFZ1PZM';

    // LIFF準備完了を通知するPromise
    let liffReadyResolve;
    window.liffReady = new Promise(function(resolve) {
        liffReadyResolve = resolve;
    });

    // LINEアプリ内かどうかのフラグ
    window.isLiffInClient = false;

    if (!LIFF_ID) {
        console.warn('[LIFF] LIFF_ID が未設定です。LIFF機能は無効です。');
        liffReadyResolve({ available: false, reason: 'no_liff_id' });
        return;
    }

    if (typeof liff === 'undefined') {
        console.warn('[LIFF] LIFF SDKが読み込まれていません。');
        liffReadyResolve({ available: false, reason: 'no_sdk' });
        return;
    }

    liff.init({ liffId: LIFF_ID })
        .then(function() {
            window.isLiffInClient = liff.isInClient();
            console.log('[LIFF] 初期化完了。LINEアプリ内:', window.isLiffInClient);

            if (!liff.isInClient()) {
                // ブラウザの場合は何もしない（既存OAuthフローを使用）
                liffReadyResolve({ available: true, inClient: false });
                return;
            }

            // LINEアプリ内: 自動ログイン処理
            if (!liff.isLoggedIn()) {
                // LINEログインを実行（LINEアプリ内なので自動的に認可される）
                liff.login();
                return;
            }

            // ログイン済み: プロフィール取得 → バックエンドで認証
            handleLiffLogin();
        })
        .catch(function(err) {
            console.error('[LIFF] 初期化エラー:', err);
            liffReadyResolve({ available: false, reason: 'init_error', error: err });
        });

    async function handleLiffLogin() {
        try {
            var accessToken = liff.getAccessToken();
            if (!accessToken) {
                console.error('[LIFF] アクセストークンが取得できません');
                liffReadyResolve({ available: true, inClient: true, loggedIn: false });
                return;
            }

            // 既にSupabaseセッションがある場合はスキップ
            if (window.supabaseClient) {
                var sessionResult = await window.supabaseClient.auth.getSession();
                if (sessionResult.data && sessionResult.data.session) {
                    console.log('[LIFF] 既存のSupabaseセッションあり。スキップ。');
                    liffReadyResolve({ available: true, inClient: true, loggedIn: true, skipped: true });
                    return;
                }
            }

            // バックエンドにLIFFアクセストークンを送信
            console.log('[LIFF] バックエンド認証を開始...');
            var response = await fetch('/.netlify/functions/line-auth-simple-v4', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ liff_access_token: accessToken })
            });

            if (!response.ok) {
                var errorData = await response.json().catch(function() { return {}; });
                console.error('[LIFF] バックエンド認証エラー:', errorData);
                liffReadyResolve({ available: true, inClient: true, loggedIn: false, error: errorData });
                return;
            }

            var data = await response.json();
            console.log('[LIFF] バックエンド認証成功:', data.user?.display_name);

            // Supabaseセッションを確立（magiclink token_hash経由）
            if (data.session && data.session.token_hash && window.supabaseClient) {
                var verifyResult = await window.supabaseClient.auth.verifyOtp({
                    type: 'magiclink',
                    token_hash: data.session.token_hash
                });

                if (verifyResult.error) {
                    console.error('[LIFF] OTP検証エラー:', verifyResult.error);
                } else {
                    console.log('[LIFF] Supabaseセッション確立完了');
                }
            }

            liffReadyResolve({ available: true, inClient: true, loggedIn: true, user: data.user });

            // 認証ページにいる場合 → プロフィール完了チェック後にリダイレクト
            var currentPage = window.location.pathname.split('/').pop();
            if (currentPage === 'login.html' || currentPage === '' || currentPage === 'index.html') {
                var redirectTo = data.redirect_to || 'dashboard.html';
                try {
                    var parsed = new URL(redirectTo, window.location.origin);
                    if (parsed.origin !== window.location.origin) redirectTo = 'dashboard.html';
                } catch (e) { redirectTo = 'dashboard.html'; }

                // LINEユーザーのプロフィール完了チェック
                if (window.supabaseClient && data.user && data.user.id) {
                    try {
                        var profileResult = await window.supabaseClient
                            .from('user_profiles')
                            .select('company')
                            .eq('id', data.user.id)
                            .maybeSingle();
                        if (!profileResult.data || !profileResult.data.company) {
                            sessionStorage.setItem('line_user_data', JSON.stringify({
                                name: data.user.display_name,
                                picture_url: data.user.picture_url
                            }));
                            redirectTo = 'register.html?mode=line';
                        }
                    } catch (e) {
                        console.error('[LIFF] Profile check error:', e);
                    }
                }

                window.location.href = redirectTo;
            } else if (currentPage === 'register.html') {
                // register.htmlではリダイレクトしない（LINEモードで入力中の可能性）
            }

        } catch (err) {
            console.error('[LIFF] ログイン処理エラー:', err);
            liffReadyResolve({ available: true, inClient: true, loggedIn: false, error: err });
        }
    }
})();
