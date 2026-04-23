/**
 * Profile Sync with Supabase
 * プロフィール情報をSupabaseと同期
 */

(function() {
    'use strict';
    
    // Supabaseからユーザー情報を取得して更新
    async function syncUserProfile() {
        // Supabaseの初期化を待つ
        if (!window.supabaseClient) {
            // 少し待ってから再試行
            setTimeout(() => {
                if (window.supabaseClient) {
                    syncUserProfile();
                }
            }, 100);
            return;
        }
        
        try {
            // 現在のユーザーを取得
            const { data: { user }, error } = await window.supabaseClient.auth.getUser();
            
            if (error) {
                console.error('Error getting user:', error);
                return;
            }
            
            if (!user) {
                return;
            }
            
            
            // ユーザーメタデータから情報を取得
            const userData = {
                id: user.id,
                email: user.email,
                name: user.user_metadata?.name || user.user_metadata?.display_name || user.email?.split('@')[0],
                display_name: user.user_metadata?.display_name || user.user_metadata?.name,
                picture: user.user_metadata?.picture,
                picture_url: user.user_metadata?.picture_url,
                provider: user.user_metadata?.provider || 'email',
                line_user_id: user.user_metadata?.line_user_id
            };
            
            // LINE IDが名前として設定されている場合の対処
            if (userData.name && userData.name.startsWith('line_')) {
                if (userData.display_name && !userData.display_name.startsWith('line_')) {
                    userData.name = userData.display_name;
                }
            }
            
            
            // localStorageを更新
            localStorage.setItem('user', JSON.stringify(userData));
            
            // sessionStorageも更新
            sessionStorage.setItem('userEmail', user.email);
            sessionStorage.setItem('isLoggedIn', 'true');
            
            // DOMを更新
            updateUserDisplay(userData);
            
            return userData;
            
        } catch (err) {
            console.error('Profile sync error:', err);
        }
    }
    
    // ユーザー情報をDOMに反映
    function updateUserDisplay(userData) {
        
        // 名前の更新
        const userNameElements = document.querySelectorAll('.user-name');
        
        userNameElements.forEach((element, index) => {
            if (element) {
                const newName = userData.name || userData.display_name || 'ゲスト';
                element.textContent = newName;
            }
        });
        
        // プロフィール画像の更新
        const profileImages = document.querySelectorAll('.user-avatar img, .profile-pic img, .user-menu-btn img');
        profileImages.forEach(img => {
            if (img && (userData.picture_url || userData.picture)) {
                img.src = userData.picture_url || userData.picture;
                img.onerror = function() {
                    this.src = 'assets/user-placeholder.svg';
                };
            }
        });
        
        // メールアドレスの更新
        const emailElements = document.querySelectorAll('.user-email');
        emailElements.forEach(element => {
            if (element) {
                element.textContent = userData.email;
            }
        });
    }
    
    // プロフィール更新機能
    async function updateProfile(updates) {
        // Supabaseクライアントの初期化を待つ
        if (!window.supabaseClient) {
            // 初期化を待つ
            return new Promise((resolve) => {
                const checkInterval = setInterval(() => {
                    if (window.supabaseClient) {
                        clearInterval(checkInterval);
                        updateProfile(updates).then(resolve);
                    }
                }, 100);
                // 5秒でタイムアウト
                setTimeout(() => {
                    clearInterval(checkInterval);
                    resolve({ error: 'Supabase initialization timeout' });
                }, 5000);
            });
        }
        
        try {
            const { data, error } = await window.supabaseClient.auth.updateUser({
                data: updates
            });
            
            if (error) {
                console.error('Profile update error:', error);
                return { error };
            }
            
            
            // 更新後に同期
            await syncUserProfile();
            
            return { data };
            
        } catch (err) {
            console.error('Update profile error:', err);
            return { error: err };
        }
    }
    
    // 初期化
    function init() {
        
        // 即座にlocalStorageから読み込んで表示を更新
        const userStr = localStorage.getItem('user');
        if (userStr) {
            try {
                const userData = JSON.parse(userStr);
                updateUserDisplay(userData);
            } catch (e) {
                console.error('Failed to parse immediate user data:', e);
            }
        }
        
        // Supabaseが準備できたら同期
        if (window.supabaseClient) {
            syncUserProfile();
        } else {
            window.addEventListener('supabaseReady', syncUserProfile);
        }
        
        // 定期的に同期（5分ごと）
        setInterval(syncUserProfile, 5 * 60 * 1000);
    }
    
    // できるだけ早く初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    // さらに早く実行（DOMContentLoaded前）
    if (typeof Storage !== 'undefined') {
        const userStr = localStorage.getItem('user');
        if (userStr) {
            try {
                const userData = JSON.parse(userStr);
                
                // LINE IDが名前になっている場合の強制修正
                if (userData.name && userData.name.startsWith('line_')) {
                    if (userData.display_name && !userData.display_name.startsWith('line_')) {
                        userData.name = userData.display_name;
                    } else {
                        // display_nameもLINE IDの場合、デフォルト名を設定
                        userData.name = 'ユーザー';
                    }
                    // 修正したデータを保存
                    localStorage.setItem('user', JSON.stringify(userData));
                }
                
                // DOM要素を即座に更新（重複防止機能付き）
                if (!window._profileSyncLastUpdate || Date.now() - window._profileSyncLastUpdate > 1000) {
                    window._profileSyncLastUpdate = Date.now();
                    
                    const userNameElements = document.querySelectorAll('.user-name');
                    userNameElements.forEach((element, index) => {
                        if (element) {
                            const oldText = element.textContent;
                            element.textContent = userData.name || userData.display_name || 'ユーザー';
                        }
                    });
                }
                
                // DOMが準備できたらもう一度実行
                if (document.readyState === 'complete' || document.readyState === 'interactive') {
                    updateUserDisplay(userData);
                } else {
                    document.addEventListener('DOMContentLoaded', () => {
                        updateUserDisplay(userData);
                        // さらに確実にするため、少し遅延して再実行
                        setTimeout(() => updateUserDisplay(userData), 100);
                    });
                }
            } catch (e) {
                console.error('Early sync error:', e);
            }
        }
    }
    
    // 強制的にLINE IDを修正する関数
    function forceFixLineId() {
        const userStr = localStorage.getItem('user');
        if (userStr) {
            try {
                const userData = JSON.parse(userStr);
                
                // LINE IDを実際の名前に修正
                if (userData.name && userData.name.startsWith('line_')) {
                    if (userData.display_name && !userData.display_name.startsWith('line_')) {
                        userData.name = userData.display_name;
                    } else {
                        // line_プレフィックスの名前は一般表示に置換
                        userData.name = '会員';
                        userData.display_name = '会員';
                    }
                    localStorage.setItem('user', JSON.stringify(userData));
                }
                
                // DOM要素を強制更新
                const userNameElements = document.querySelectorAll('.user-name');
                userNameElements.forEach((element, index) => {
                    if (element) {
                        element.textContent = userData.name || 'ユーザー';
                    }
                });
                
                return userData;
            } catch (e) {
                console.error('[ProfileSync] Force fix error:', e);
            }
        }
    }

    // グローバルAPIとして公開
    window.ProfileSync = {
        sync: syncUserProfile,
        update: updateProfile,
        updateDisplay: updateUserDisplay,
        forceFixLineId: forceFixLineId
    };
    
    // 確実に実行するため、短い遅延後にも実行
    setTimeout(() => {
        const userStr = localStorage.getItem('user');
        if (userStr) {
            try {
                const userData = JSON.parse(userStr);
                
                // 遅延実行でも強制的にLINE IDをチェック・修正
                if (userData.name && userData.name.startsWith('line_')) {
                    if (userData.display_name && !userData.display_name.startsWith('line_')) {
                        userData.name = userData.display_name;
                    } else {
                        userData.name = 'ユーザー';
                    }
                    localStorage.setItem('user', JSON.stringify(userData));
                }
                
                updateUserDisplay(userData);
                
                // さらに強制的に DOM 要素を更新
                const userNameElements = document.querySelectorAll('.user-name');
                userNameElements.forEach(element => {
                    if (element && element.textContent.startsWith('line_')) {
                        element.textContent = userData.name || 'ユーザー';
                    }
                });
            } catch (e) {
                console.error('[ProfileSync] Delayed update error:', e);
            }
        }
    }, 500);
    
    // さらに確実にするため、1秒後にも実行
    setTimeout(() => {
        const userNameElements = document.querySelectorAll('.user-name');
        userNameElements.forEach(element => {
            if (element && element.textContent.startsWith('line_')) {
                const userStr = localStorage.getItem('user');
                if (userStr) {
                    try {
                        const userData = JSON.parse(userStr);
                        element.textContent = userData.name || userData.display_name || 'ユーザー';
                    } catch (e) {
                        element.textContent = 'ユーザー';
                    }
                }
            }
        });
    }, 1000);
    
})();