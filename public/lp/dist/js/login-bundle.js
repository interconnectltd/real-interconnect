// ============================================================
// Section: guest-login-handler.js
// ============================================================
/**
 * Guest Login Handler
 * ゲストログインボタンの処理
 */

(function() {
    'use strict';

    // console.log('[GuestLogin] ゲストログインハンドラー初期化');

    document.addEventListener('DOMContentLoaded', function() {
        // ゲストログインボタンを取得
        const guestButton = document.querySelector('.guest-button');

        if (guestButton) {
            // console.log('[GuestLogin] ゲストログインボタンを検出');

            // 既存のリンクを無効化してイベントハンドラーを追加
            guestButton.addEventListener('click', function(e) {
                e.preventDefault();
                // console.log('[GuestLogin] ゲストログインボタンがクリックされました');

                // ゲストモードフラグを設定
                sessionStorage.setItem('isGuestMode', 'true');

                // ゲストユーザー情報を設定
                const guestUser = {
                    id: 'guest-user',
                    email: 'guest@interconnect.jp',
                    name: 'ゲストユーザー',
                    isGuest: true,
                    created_at: new Date().toISOString()
                };

                // ローカルストレージに保存
                localStorage.setItem('currentUser', JSON.stringify(guestUser));

                // console.log('[GuestLogin] ゲストモード設定完了');

                // ダッシュボードへリダイレクト
                window.location.href = 'dashboard.html?guest=true';
            });
        } else {
            console.warn('[GuestLogin] ゲストログインボタンが見つかりません');
        }
    });

})();

// ============================================================
// Section: line-login-simple.js
// ============================================================
/**
 * LINE Login Simple Implementation
 * シンプルで確実に動作するLINEログイン実装
 */

(function() {
    'use strict';

    const LINE_CHANNEL_ID = '2009174893';
    const PRODUCTION_ORIGIN = 'https://inter-connect.app';
    const LINE_REDIRECT_URI = PRODUCTION_ORIGIN + '/line-callback.html';

    // console.log('📱 LINE Login Simple loaded');
    // console.log('   Channel ID:', LINE_CHANNEL_ID);
    // console.log('   Redirect URI:', LINE_REDIRECT_URI);

    // ランダム文字列生成（暗号学的に安全なランダム値を使用）
    function generateRandomString(length) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const array = new Uint32Array(length);
        crypto.getRandomValues(array);
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(array[i] % chars.length);
        }
        return result;
    }

    // LINEログイン処理
    function handleLineLogin(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        // LINEアプリ内（LIFF環境）の場合はLIFF経由でログイン
        if (window.isLiffInClient && typeof liff !== 'undefined' && liff.isInClient()) {
            console.log('[LINE Login] LINEアプリ内のためLIFFログインを使用');
            if (!liff.isLoggedIn()) {
                liff.login();
            }
            return;
        }

        // ブラウザの場合: 既存OAuth処理
        try {
            const state = generateRandomString(32);
            const nonce = generateRandomString(32);

            sessionStorage.setItem('line_state', state);

            const params = new URLSearchParams({
                response_type: 'code',
                client_id: LINE_CHANNEL_ID,
                redirect_uri: LINE_REDIRECT_URI,
                state: state,
                scope: 'profile openid email',
                nonce: nonce
            });

            const authUrl = `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
            window.location.href = authUrl;

        } catch (error) {
            console.error('LINE login error:', error);
            if (window.showToast) { window.showToast('LINEログインでエラーが発生しました。もう一度お試しください。', 'error'); } else { alert('LINEログインでエラーが発生しました。もう一度お試しください。'); }
        }
    }

    // ボタンの設定
    function setupLineButton() {
        const lineLoginBtn = document.getElementById('lineLoginBtn');
        const lineRegisterBtn = document.getElementById('lineRegisterBtn');

        if (lineLoginBtn) {
            // console.log('✅ LINE Login button found');

            // 既存のイベントリスナーをクリア
            const newButton = lineLoginBtn.cloneNode(true);
            lineLoginBtn.parentNode.replaceChild(newButton, lineLoginBtn);

            // 新しいイベントリスナーを追加
            newButton.addEventListener('click', handleLineLogin);

            // console.log('✅ LINE Login button setup complete');
        }

        if (lineRegisterBtn) {
            // console.log('✅ LINE Register button found');

            // 既存のイベントリスナーをクリア
            const newButton = lineRegisterBtn.cloneNode(true);
            lineRegisterBtn.parentNode.replaceChild(newButton, lineRegisterBtn);

            // 新しいイベントリスナーを追加
            newButton.addEventListener('click', handleLineLogin);

            // console.log('✅ LINE Register button setup complete');
        }
    }

    // 初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupLineButton);
    } else {
        // すでに読み込み済みの場合は即座に実行
        setTimeout(setupLineButton, 0);
    }

    // 念のため少し遅延させても実行
    setTimeout(setupLineButton, 100);

})();
