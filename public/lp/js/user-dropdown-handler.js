/**
 * ユーザードロップダウンと通知メニューの統一ハンドラー
 * すべてのページで動作する統一された処理
 */

(function() {
    'use strict';


    // 初期化
    function initialize() {
        
        // ユーザープロファイルドロップダウン
        setupUserProfileDropdown();
        
        // 通知ドロップダウン
        setupNotificationDropdown();
        
        // ログアウトボタン
        setupLogoutButtons();
        
        // クリック外で閉じる処理
        setupOutsideClickHandler();
    }

    // ユーザープロファイルドロップダウンの設定
    function setupUserProfileDropdown() {
        const userProfiles = document.querySelectorAll('.user-profile');
        
        userProfiles.forEach((profile, index) => {
            // クリックイベントを設定
            profile.addEventListener('click', function(e) {
                e.stopPropagation();
                
                // 他のドロップダウンを閉じる
                closeAllDropdowns();
                
                // このドロップダウンをトグル
                const dropdown = this.querySelector('.user-dropdown');
                if (dropdown) {
                    const isOpen = dropdown.classList.contains('active');
                    if (isOpen) {
                        dropdown.classList.remove('active');
                        this.classList.remove('active');
                    } else {
                        dropdown.classList.add('active');
                        this.classList.add('active');
                    }
                } else {
                    console.error('[UserDropdown] user-dropdown要素が見つかりません');
                }
            });
        });
    }

    // 通知ドロップダウンの設定
    function setupNotificationDropdown() {
        const notificationBtns = document.querySelectorAll('.notification-wrapper .notification-btn');
        
        notificationBtns.forEach((btn, index) => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                
                // 他のドロップダウンを閉じる
                closeAllDropdowns();
                
                // 通知ドロップダウンをトグル
                const wrapper = this.closest('.notification-wrapper');
                const dropdown = wrapper?.querySelector('.notification-dropdown');
                
                if (dropdown) {
                    const isOpen = dropdown.classList.contains('active');
                    if (isOpen) {
                        dropdown.classList.remove('active');
                        wrapper.classList.remove('active');
                    } else {
                        // position:fixed のドロップダウンをベルボタン基準で配置
                        var btnRect = this.getBoundingClientRect();
                        var dropdownWidth = 360;
                        var viewportWidth = window.innerWidth;

                        dropdown.style.top = (btnRect.bottom + 8) + 'px';
                        // right/leftをリセット
                        dropdown.style.right = 'auto';
                        dropdown.style.left = 'auto';

                        // ベルボタンの中心を基準にして配置
                        var btnCenter = btnRect.left + btnRect.width / 2;
                        var idealLeft = btnCenter - dropdownWidth / 2;

                        // 画面右端からはみ出す場合は右寄せ
                        if (idealLeft + dropdownWidth > viewportWidth - 16) {
                            idealLeft = viewportWidth - dropdownWidth - 16;
                        }
                        // 画面左端からはみ出す場合は左寄せ
                        if (idealLeft < 16) {
                            idealLeft = 16;
                        }

                        dropdown.style.left = idealLeft + 'px';

                        dropdown.classList.add('active');
                        wrapper.classList.add('active');

                        loadNotifications(dropdown);
                    }
                } else {
                    console.error('[UserDropdown] notification-dropdown要素が見つかりません');
                }
            });
        });
        
        // すべて既読にするボタン
        const markAllReadBtns = document.querySelectorAll('.mark-all-read');
        markAllReadBtns.forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                markAllNotificationsAsRead();
            });
        });
    }

    // ログアウトボタンの設定
    function setupLogoutButtons() {
        const logoutBtns = document.querySelectorAll('#logoutBtn, [href="#"][onclick*="logout"]');
        
        logoutBtns.forEach((btn, index) => {
            // 既存のonclickを削除
            btn.onclick = null;
            
            btn.addEventListener('click', async function(e) {
                e.preventDefault();
                e.stopPropagation();

                if (await window.showConfirmModal('ログアウトしますか？', { confirmLabel: 'ログアウト' })) {
                    
                    try {
                        // グローバルなlogout関数を使用
                        if (typeof window.logout === 'function') {
                            await window.logout();
                        } else {
                            // フォールバック処理
                            const client = window.supabaseClient || window.supabase;
                            if (client) {
                                const { error } = await client.auth.signOut();
                                if (error) {
                                    console.error('[UserDropdown] ログアウトエラー:', error);
                                    throw error;
                                }
                            }
                            
                            // セッションクリア
                            sessionStorage.clear();
                            localStorage.removeItem('supabase.auth.token');
                            
                            // ログインページへリダイレクト
                            window.location.href = '/login.html';
                        }
                        
                    } catch (error) {
                        console.error('[UserDropdown] ログアウト失敗:', error);
                        if (window.showToast) {
                            window.showToast('ログアウトに失敗しました', 'error');
                        }
                    }
                }
            });
        });
    }

    // 外側クリックで閉じる処理
    function setupOutsideClickHandler() {
        document.addEventListener('click', function(e) {
            // ドロップダウン関連要素のクリックは無視
            if (e.target.closest('.user-dropdown') || 
                e.target.closest('.notification-dropdown') ||
                e.target.closest('.user-profile') ||
                e.target.closest('.notification-wrapper') ||
                e.target.closest('.notification-btn')) {
                return;
            }
            
            // モーダル、カレンダー、その他の重要な要素のクリックは無視
            if (e.target.closest('.modal') ||
                e.target.closest('.modal-content') ||
                e.target.closest('.fc-daygrid-day') ||  // FullCalendarの日付セル
                e.target.closest('.fc-button') ||        // FullCalendarのボタン
                e.target.closest('.fc-event') ||         // FullCalendarのイベント
                e.target.closest('.calendar-container') ||
                e.target.closest('.btn') ||              // すべてのボタン
                e.target.closest('button') ||            // すべてのbuttonタグ
                e.target.closest('a.sidebar-link') ||    // サイドバーリンク
                e.target.closest('input') ||             // 入力フィールド
                e.target.closest('select') ||            // セレクトボックス
                e.target.closest('textarea') ||          // テキストエリア
                e.target.closest('.event-card') ||       // イベントカード
                e.target.closest('.past-event-item') ||  // 過去のイベントアイテム
                e.target.closest('.event-content') ||    // イベントコンテンツ
                e.target.closest('.event-footer') ||     // イベントフッター
                e.target.closest('.past-event-action')) { // 過去イベントのアクション
                return;
            }
            
            // すべてのドロップダウンを閉じる
            closeAllDropdowns();
        });
    }

    // すべてのドロップダウンを閉じる
    function closeAllDropdowns() {
        // ユーザードロップダウン
        document.querySelectorAll('.user-profile.active').forEach(profile => {
            profile.classList.remove('active');
            const dropdown = profile.querySelector('.user-dropdown');
            if (dropdown) {
                dropdown.classList.remove('active');
            }
        });
        
        // 通知ドロップダウン
        document.querySelectorAll('.notification-wrapper.active').forEach(wrapper => {
            wrapper.classList.remove('active');
            const dropdown = wrapper.querySelector('.notification-dropdown');
            if (dropdown) {
                dropdown.classList.remove('active');
            }
        });
        
    }

    // 通知を読み込む
    async function loadNotifications(dropdownElement) {
        
        const notificationList = dropdownElement.querySelector('.notification-list');
        if (!notificationList) return;
        
        try {
            // Supabaseから通知を取得
            const client = window.supabaseClient || window.supabase;
            if (client) {
                const user = await window.safeGetUser();
                if (!user) {
                    return;
                }

                const { data: notifications, error } = await client
                    .from('notifications')
                    .select('*')
                    .eq('user_id', user.id)
                    .eq('is_read', false)
                    .order('created_at', { ascending: false })
                    .limit(5);
                
                if (error) throw error;
                
                if (notifications && notifications.length > 0) {
                    
                    // 通知を表示
                    notificationList.innerHTML = notifications.map(notif => `
                        <div class="notification-item" data-id="${notif.id}">
                            <div class="notification-icon ${notif.type || 'system'}">
                                <i class="fas fa-${getNotificationIcon(notif.type)}"></i>
                            </div>
                            <div class="notification-content">
                                <div class="notification-title">${escapeHtml(notif.title)}</div>
                                <div class="notification-time">${formatTime(notif.created_at)}</div>
                            </div>
                        </div>
                    `).join('');
                    
                    // 通知バッジを更新
                    updateNotificationBadge(notifications.length);
                } else {
                }
            }
        } catch (error) {
            console.error('[UserDropdown] 通知の読み込みエラー:', error);
        }
    }

    // すべての通知を既読にする
    async function markAllNotificationsAsRead() {
        
        try {
            const client = window.supabaseClient || window.supabase;
            if (client) {
                const user = await window.safeGetUser();
                if (!user) return;
                
                const { error } = await client
                    .from('notifications')
                    .update({ is_read: true })
                    .eq('user_id', user.id)
                    .eq('is_read', false);
                
                if (error) throw error;
                
                
                // UIを更新
                document.querySelectorAll('.notification-list').forEach(list => {
                    list.innerHTML = `
                        <div class="empty-notifications">
                            <i class="fas fa-bell-slash"></i>
                            <p>新しい通知はありません</p>
                        </div>
                    `;
                });
                
                // バッジを非表示
                updateNotificationBadge(0);
            }
        } catch (error) {
            console.error('[UserDropdown] 既読処理エラー:', error);
        }
    }

    // 通知バッジを更新
    function updateNotificationBadge(count) {
        const badges = document.querySelectorAll('.notification-badge');
        badges.forEach(badge => {
            if (count > 0) {
                badge.textContent = count > 99 ? '99+' : count;
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
        });
    }

    // ユーティリティ関数
    function getNotificationIcon(type) {
        const icons = {
            'event': 'calendar-alt',
            'message': 'envelope',
            'match': 'handshake',
            'system': 'bell',
            'referral': 'user-plus'
        };
        return icons[type] || 'bell';
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    function formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = Math.floor((now - date) / 1000);
        
        if (diff < 60) return 'たった今';
        if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
        if (diff < 604800) return `${Math.floor(diff / 86400)}日前`;
        
        return date.toLocaleDateString('ja-JP');
    }

    // DOMContentLoadedで初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();