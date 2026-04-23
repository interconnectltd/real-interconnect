/**
 * Dashboard JavaScript
 */

(function() {
    'use strict';

    // updateUserInfoの実行を管理（グローバルフラグでシングルトン化）
    if (!window._updateUserInfoState) {
        window._updateUserInfoState = {
            isRunning: false,
            lastRun: 0,
            minInterval: 5000 // 5秒間隔
        };
    }
    
    let updateUserInfoSafe = function() {
        const now = Date.now();
        const state = window._updateUserInfoState;
        
        // 実行中または最小間隔内の場合はスキップ
        if (state.isRunning || (now - state.lastRun < state.minInterval)) {
            // console.log('[Dashboard] updateUserInfo スキップ (実行中または間隔内)');
            return;
        }
        
        state.isRunning = true;
        state.lastRun = now;
        updateUserInfo();
        
        // 実行完了後にフラグをリセット
        setTimeout(() => { 
            state.isRunning = false;
        }, 100);
    };

    document.addEventListener('DOMContentLoaded', function() {
        checkAuth();
        initSidebar();
        initUserMenu();
        updateUserInfoSafe();
        
        // ProfileSyncが準備できたら再度更新
        if (window.ProfileSync) {
            setTimeout(() => updateUserInfoSafe(), 1000);
        }
        
        // supabaseReadyイベントでも更新（DBからプロフィールを取得）
        window.addEventListener('supabaseReady', function() {
            setTimeout(() => updateUserInfoSafe(), 500);
            // DBからプロフィールを取得してlocalStorageを更新
            fetchUserProfileFromDB();
            
            // ダッシュボード更新システムを初期化
            if (window.dashboardUpdater) {
                // console.log('Dashboard: Initializing dashboard updater...');
                setTimeout(() => {
                    window.dashboardUpdater.init();
                }, 1000);
            }
        });
        
        // ダッシュボード更新システムが既に準備できている場合
        if (window.dashboardUpdater && window.supabaseClient) {
            // console.log('Dashboard: Dashboard updater already available, initializing...');
            setTimeout(() => {
                window.dashboardUpdater.init();
            }, 1500);
        }
    });

    /**
     * Check authentication
     * 認証はsupabase-unified.jsのprotectedPagesリスト(line:229)で処理済み。
     * 未ログインの場合はsupabase-unified.jsがlogin.htmlへリダイレクトする。
     */
    function checkAuth() {
        // no-op: supabase-unified.js handles redirect for protected pages
    }

    /**
     * Initialize sidebar
     */
    function initSidebar() {
        // Only initialize desktop sidebar toggle, not mobile menu toggle
        const sidebarToggle = document.querySelector('.sidebar .sidebar-toggle');
        const sidebar = document.querySelector('.sidebar');
        
        if (sidebarToggle && sidebar) {
            const sidebarToggleHandler = function() {
                sidebar.classList.toggle('show');
            };
            
            sidebarToggle.addEventListener('click', sidebarToggleHandler);
            
            // Close sidebar when clicking outside on mobile
            const outsideClickHandler = function(e) {
                if (window.innerWidth <= 1024 && 
                    !sidebar.contains(e.target) && 
                    sidebar.classList.contains('show')) {
                    sidebar.classList.remove('show');
                }
            };
            
            document.addEventListener('click', outsideClickHandler);
            
        }
    }

    /**
     * Initialize user menu
     */
    function initUserMenu() {
        const userMenuBtn = document.querySelector('.user-menu-btn');
        const userDropdown = document.querySelector('.user-dropdown');
        
        if (userMenuBtn && userDropdown) {
            const menuClickHandler = function(e) {
                e.stopPropagation();
                userDropdown.classList.toggle('show');
            };
            
            userMenuBtn.addEventListener('click', menuClickHandler);
            
            // Close dropdown when clicking outside
            const dropdownCloseHandler = function() {
                if (userDropdown) {
                    userDropdown.classList.remove('show');
                }
            };
            
            document.addEventListener('click', dropdownCloseHandler);
            
        }
    }

    /**
     * Update user information
     */
    function updateUserInfo() {
        // console.log('[Dashboard] updateUserInfo called at', new Date().toISOString());
        try {
            // まずlocalStorageから完全なユーザー情報を取得
            let userName = 'ゲスト';
            let userPicture = null;
            
            if (typeof Storage !== 'undefined') {
                const userDataStr = localStorage.getItem('user');
                // console.log('[Dashboard] Raw user data from localStorage:', userDataStr);
                if (userDataStr) {
                    try {
                        const userData = JSON.parse(userDataStr);
                        // console.log('[Dashboard] Parsed user data:', userData);
                        
                        // 名前の優先順位: name > display_name > emailの@前
                        userName = userData.name || userData.display_name || userData.email?.split('@')[0] || 'ゲスト';
                        
                        // LINE IDの場合の対処
                        if (userName.startsWith('line_') && userData.display_name && !userData.display_name.startsWith('line_')) {
                            userName = userData.display_name;
                            // 修正したデータを保存
                            userData.name = userData.display_name;
                            localStorage.setItem('user', JSON.stringify(userData));
                        }
                        
                        userPicture = userData.picture || userData.picture_url;
                        // console.log('[Dashboard] Extracted userName:', userName);
                        // console.log('[Dashboard] Extracted userPicture:', userPicture);
                    } catch (e) {
                        console.error('[Dashboard] Failed to parse user data:', e);
                    }
                }
                
                // フォールバック: sessionStorageのemail
                if (userName === 'ゲスト' || userName.startsWith('line_')) {
                    const userEmail = sessionStorage.getItem('userEmail');
                    // console.log('[Dashboard] Fallback to sessionStorage email:', userEmail);
                    if (userEmail && userEmail.includes('@')) {
                        userName = userEmail.split('@')[0];
                    }
                }
            }
            
            // Update all user name elements
            const userNameElements = document.querySelectorAll('.user-name');
            // console.log('Found user name elements:', userNameElements.length);
            if (userNameElements.length > 0) {
                userNameElements.forEach((element, index) => {
                    if (element) {
                        // console.log(`Updating element ${index}:`, element);
                        // console.log(`  Parent:`, element.parentElement);
                        // console.log(`  Old text:`, element.textContent);
                        element.textContent = userName;
                        // console.log(`  New text:`, element.textContent);
                    }
                });
            }
            
            // プロフィール画像も更新（存在する場合）
            if (userPicture) {
                const profileImages = document.querySelectorAll('.user-menu-btn img, .user-avatar img, .profile-pic img');
                profileImages.forEach(img => {
                    if (img) {
                        img.src = userPicture;
                        img.onerror = function() {
                            // 画像読み込みエラー時はデフォルト画像
                            this.src = 'assets/user-placeholder.svg';
                        };
                    }
                });
            }
        } catch (error) {
            console.error('ユーザー情報の更新エラー:', error);
        }
    }

    /**
     * Logout function は global-functions.js で定義済み
     * 重複を避けるためここでは定義しない
     */
    
    /**
     * DBからユーザープロフィールを取得してlocalStorageとUIを更新
     */
    async function fetchUserProfileFromDB() {
        try {
            const user = await window.safeGetUser();
            if (!user) return;

            const supabaseInstance = window.supabaseClient;
            if (!supabaseInstance) return;

            const { data: profile, error } = await supabaseInstance
                .from('user_profiles')
                .select('name, full_name, avatar_url')
                .eq('id', user.id)
                .maybeSingle();

            if (error || !profile) return;

            // localStorageを更新
            const userDataStr = localStorage.getItem('user');
            const userData = userDataStr ? JSON.parse(userDataStr) : {};

            if (profile.name || profile.full_name) {
                userData.name = profile.name || profile.full_name;
            }
            if (profile.avatar_url) {
                userData.picture = profile.avatar_url;
            }

            localStorage.setItem('user', JSON.stringify(userData));

            // UIを再更新
            updateUserInfo();
        } catch (error) {
            console.error('[Dashboard] DBプロフィール取得エラー:', error);
        }
    }

    // 紹介ポイントを読み込む関数
    async function loadReferralPoints() {
        try {
            // waitForSupabaseを使用して確実に初期化を待つ
            if (typeof window.waitForSupabase === 'function') {
                await window.waitForSupabase();
            }
            
            const supabaseInstance = window.supabaseClient;
            if (!supabaseInstance || !supabaseInstance.auth) {
                // console.log('[Dashboard] Supabase not initialized yet');
                return;
            }
            
            const user = await window.safeGetUser();
            if (!user) return;

            // ユーザーのポイント残高を取得
            const { data: points, error } = await supabaseInstance
                .from('user_points')
                .select('available_points')
                .eq('user_id', user.id)
                .maybeSingle();

            if (!error && points) {
                const pointsElement = document.getElementById('referral-points');
                if (pointsElement) {
                    pointsElement.textContent = (points.available_points || 0).toLocaleString() + ' pt';
                }
            }
        } catch (error) {
            console.error('紹介ポイントの読み込みエラー:', error);
            const pointsElement = document.getElementById('referral-points');
            if (pointsElement) {
                pointsElement.textContent = '0 pt';
            }
        }
    }

    // グローバルに公開
    window.loadReferralPoints = loadReferralPoints;

    // 初期化時に紹介ポイントも読み込む
    // supabaseReadyイベントを待つ
    window.addEventListener('supabaseReady', function() {
        // console.log('[Dashboard] supabaseReady event received, loading referral points');
        if (window.supabaseClient) {
            setTimeout(() => loadReferralPoints(), 500);
        }
    });
    
    // 既にsupabaseClientが初期化されている場合
    if (window.supabaseClient && !window.referralPointsLoaded) {
        window.referralPointsLoaded = true;
        setTimeout(() => loadReferralPoints(), 100);
    }

})();