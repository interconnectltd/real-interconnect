/**
 * 通知システム統一JavaScript
 * 
 * 以下のファイルの機能を統合:
 * - notifications.js
 * - notifications-supabase.js
 * - notifications-read-manager.js
 * - notifications-filter.js
 * - notifications-delete.js
 * - notifications-actions-fix.js
 * - notifications-complete-check.js
 * - notification-sender.js
 */

(function() {
    'use strict';

    // console.log('[NotificationsUnified] 通知システム統一モジュール初期化');

    // グローバル変数
    let currentUserId = null;
    let notifications = [];
    let currentFilter = 'all';
    let notificationSubscription = null;
    let notificationSound = null;  // 通知音用
    let selectedNotifications = new Set(); // 一括選択用
    let deleteInProgress = false; // 削除処理中フラグ

    // 初期化
    async function initialize() {
        // console.log('[NotificationsUnified] 初期化開始');

        // Supabaseの準備を待つ
        await window.waitForSupabase();

        // 現在のユーザーを取得
        const user = await window.safeGetUser();
        if (!user) {
            console.error('[NotificationsUnified] ユーザーが認証されていません');
            return;
        }

        currentUserId = user.id;
        // console.log('[NotificationsUnified] ユーザーID:', currentUserId);

        // イベントリスナーの設定
        setupEventListeners();

        // 通知の読み込み
        await loadNotifications();

        // リアルタイム更新の設定
        setupRealtimeSubscription();

        // 通知音の準備（削除されたファイルから復元）
        prepareNotificationSound();

        // ブラウザ通知の権限をリクエスト（削除されたファイルから復元）
        requestNotificationPermission();

        // 通知バッジの更新
        updateNotificationBadge();
    }

    // イベントリスナーの設定
    function setupEventListeners() {
        // フィルターボタン
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const filter = e.target.dataset.filter;
                setFilter(filter);
            });
        });

        // 全て既読にする
        const markAllReadBtn = document.querySelector('.mark-all-read');
        if (markAllReadBtn) {
            markAllReadBtn.addEventListener('click', markAllAsRead);
        }

        // 通知ベルボタン
        const notificationBtns = document.querySelectorAll('.notification-btn');
        notificationBtns.forEach(btn => {
            btn.addEventListener('click', toggleNotificationDropdown);
        });

        // ドロップダウン外クリックで閉じる
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.notification-wrapper')) {
                closeNotificationDropdown();
            }
        });

        // 通知アクションボタンのイベント委譲（XSS防止: onclickの代わりにdata属性を使用）
        document.addEventListener('click', (e) => {
            const actionBtn = e.target.closest('[data-notification-action]');
            if (actionBtn) {
                const actionName = actionBtn.dataset.notificationAction;
                if (actionName && typeof window[actionName] === 'function') {
                    window[actionName]();
                } else if (actionName) {
                    console.warn('[NotificationsUnified] Unknown action:', actionName);
                }
            }

            // 通知削除ボタン
            const deleteBtn = e.target.closest('[data-delete-notification]');
            if (deleteBtn) {
                const notificationId = deleteBtn.dataset.deleteNotification;
                if (notificationId) {
                    deleteNotification(notificationId);
                }
            }
        });
    }

    // 通知の読み込み
    async function loadNotifications() {
        try {
            const { data, error } = await window.supabaseClient
                .from('notifications')
                .select('*')
                .eq('user_id', currentUserId)
                .order('created_at', { ascending: false });

            if (error) throw error;

            notifications = data || [];
            displayNotifications();

        } catch (error) {
            console.error('[NotificationsUnified] 通知読み込みエラー:', error);
            if (window.showToast) {
                window.showToast('通知の読み込みに失敗しました', 'error');
            }
        }
    }

    // 通知の表示
    function displayNotifications() {
        const notificationList = document.querySelector('.notification-list');
        const notificationsPage = document.querySelector('.notifications-page');

        // フィルタリング
        const filteredNotifications = currentFilter === 'all' 
            ? notifications 
            : notifications.filter(n => n.type === currentFilter);

        // ドロップダウン内の通知表示
        if (notificationList) {
            if (filteredNotifications.length === 0) {
                notificationList.innerHTML = `
                    <div class="empty-notifications">
                        <i class="fas fa-bell-slash"></i>
                        <p>新しい通知はありません</p>
                    </div>
                `;
            } else {
                notificationList.innerHTML = filteredNotifications.slice(0, 5).map(notification => `
                    <div class="notification-item ${notification.is_read ? '' : 'unread'}" 
                         data-id="${notification.id}"
                         onclick="handleNotificationClick('${notification.id}')">
                        <div class="notification-icon ${notification.type}">
                            ${getNotificationIcon(notification.type)}
                        </div>
                        <div class="notification-content">
                            <p class="notification-title">${escapeHtml(notification.title)}</p>
                            <p class="notification-time">${formatTime(notification.created_at)}</p>
                        </div>
                    </div>
                `).join('');
            }
        }

        // 通知ページでの表示
        if (notificationsPage) {
            displayNotificationGroups(filteredNotifications);
        }

        // バッジ更新
        updateNotificationBadge();
    }

    // 通知をグループ化して表示
    function displayNotificationGroups(notifications) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        const groups = {
            today: [],
            yesterday: [],
            older: []
        };

        notifications.forEach(notification => {
            const date = new Date(notification.created_at);
            date.setHours(0, 0, 0, 0);

            if (date.getTime() === today.getTime()) {
                groups.today.push(notification);
            } else if (date.getTime() === yesterday.getTime()) {
                groups.yesterday.push(notification);
            } else {
                groups.older.push(notification);
            }
        });

        let html = '';

        if (groups.today.length > 0) {
            html += createNotificationGroup('今日', groups.today);
        }

        if (groups.yesterday.length > 0) {
            html += createNotificationGroup('昨日', groups.yesterday);
        }

        if (groups.older.length > 0) {
            html += createNotificationGroup('過去の通知', groups.older);
        }

        const container = document.querySelector('.notifications-page');
        if (container) {
            const existingContent = container.querySelector('.notifications-filters');
            container.innerHTML = existingContent.outerHTML + html;
        }
    }

    // 通知グループのHTML作成
    function createNotificationGroup(title, notifications) {
        return `
            <div class="notifications-group">
                <div class="group-header">${title}</div>
                ${notifications.map(notification => `
                    <div class="notification-item-full ${notification.is_read ? '' : 'unread'}" 
                         data-type="${notification.type}"
                         data-id="${notification.id}">
                        <div class="notification-icon ${notification.type}">
                            ${getNotificationIcon(notification.type)}
                        </div>
                        <div class="notification-details">
                            <div class="notification-title">
                                ${escapeHtml(notification.title)}
                            </div>
                            <div class="notification-time">${formatTime(notification.created_at)}</div>
                            ${notification.message ? `
                                <p class="notification-message">
                                    ${escapeHtml(notification.message)}
                                </p>
                            ` : ''}
                            ${notification.actions ? `
                                <div class="notification-actions">
                                    ${createNotificationActions(notification)}
                                </div>
                            ` : ''}
                        </div>
                        <button class="notification-delete" data-delete-notification="${escapeHtml(notification.id)}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // URL安全検証（http/httpsのみ許可）
    function sanitizeUrl(url) {
        if (!url) return '#';
        try {
            const parsed = new URL(url, window.location.origin);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                return parsed.href;
            }
        } catch (e) { /* invalid URL */ }
        return '#';
    }

    // CSSクラス名のサニタイズ（英数字・ハイフン・アンダースコアのみ）
    function sanitizeClassName(cls) {
        if (!cls) return 'btn-primary';
        return String(cls).replace(/[^a-zA-Z0-9\-_\s]/g, '') || 'btn-primary';
    }

    // 通知アクションの作成
    function createNotificationActions(notification) {
        if (!notification.actions) return '';

        try {
            const actions = typeof notification.actions === 'string'
                ? JSON.parse(notification.actions)
                : notification.actions;

            return actions.map(action => {
                const safeStyle = sanitizeClassName(action.style);
                const safeLabel = escapeHtml(action.label || '');
                if (action.type === 'link') {
                    const safeUrl = sanitizeUrl(action.url);
                    return `<a href="${safeUrl}" class="btn btn-small ${safeStyle}">${safeLabel}</a>`;
                } else if (action.type === 'button') {
                    const safeAction = escapeHtml(action.action || '');
                    return `<button class="btn btn-small ${safeStyle}" data-notification-action="${safeAction}">${safeLabel}</button>`;
                }
                return '';
            }).join(' ');
        } catch (error) {
            console.error('[NotificationsUnified] アクション解析エラー:', error);
            return '';
        }
    }

    // 通知クリック処理
    window.handleNotificationClick = async function(notificationId) {
        const notification = notifications.find(n => n.id === notificationId);
        if (!notification) return;

        // 既読にする
        if (!notification.is_read) {
            await markAsRead(notificationId);
        }

        // リンクがある場合は遷移（同一オリジンまたは相対パスのみ許可）
        if (notification.link) {
            const safeUrl = sanitizeUrl(notification.link);
            if (safeUrl !== '#') {
                window.location.href = safeUrl;
            }
        }
    };

    // 既読にする
    async function markAsRead(notificationId) {
        try {
            const { error } = await window.supabaseClient
                .from('notifications')
                .update({ is_read: true })
                .eq('id', notificationId);

            if (error) throw error;

            // ローカルデータ更新
            const notification = notifications.find(n => n.id === notificationId);
            if (notification) {
                notification.is_read = true;
                displayNotifications();
            }

        } catch (error) {
            console.error('[NotificationsUnified] 既読更新エラー:', error);
            if (window.showToast) {
                window.showToast('既読の更新に失敗しました', 'error');
            }
        }
    }

    // 全て既読にする
    async function markAllAsRead() {
        try {
            const unreadIds = notifications
                .filter(n => !n.is_read)
                .map(n => n.id);

            if (unreadIds.length === 0) return;

            const { error } = await window.supabaseClient
                .from('notifications')
                .update({ is_read: true })
                .in('id', unreadIds);

            if (error) throw error;

            // ローカルデータ更新
            notifications.forEach(n => {
                if (unreadIds.includes(n.id)) {
                    n.is_read = true;
                }
            });

            displayNotifications();
            showToast('すべての通知を既読にしました');

        } catch (error) {
            console.error('[NotificationsUnified] 全て既読エラー:', error);
            if (window.showToast) {
                window.showToast('既読処理に失敗しました', 'error');
            }
        }
    }

    // 通知削除
    window.deleteNotification = async function(notificationId) {
        if (!await window.showConfirmModal('この通知を削除してもよろしいですか？', { confirmLabel: '削除', danger: true })) return;

        try {
            const { error } = await window.supabaseClient
                .from('notifications')
                .delete()
                .eq('id', notificationId);

            if (error) throw error;

            // ローカルデータから削除
            notifications = notifications.filter(n => n.id !== notificationId);
            displayNotifications();
            showToast('通知を削除しました');

        } catch (error) {
            console.error('[NotificationsUnified] 削除エラー:', error);
            if (window.showToast) {
                window.showToast('通知の削除に失敗しました', 'error');
            }
        }
    };

    // フィルター設定
    function setFilter(filter) {
        currentFilter = filter;

        // ボタンのアクティブ状態を更新
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });

        displayNotifications();
    }

    // 通知バッジ更新
    function updateNotificationBadge() {
        const unreadCount = notifications.filter(n => !n.is_read).length;
        const badges = document.querySelectorAll('.notification-badge');

        badges.forEach(badge => {
            if (unreadCount > 0) {
                badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
        });
    }

    // 通知ドロップダウン切り替え
    function toggleNotificationDropdown(e) {
        e.stopPropagation();
        const dropdown = e.target.closest('.notification-wrapper').querySelector('.notification-dropdown');
        dropdown.classList.toggle('active');
    }

    // 通知ドロップダウンを閉じる
    function closeNotificationDropdown() {
        document.querySelectorAll('.notification-dropdown').forEach(dropdown => {
            dropdown.classList.remove('active');
        });
    }

    // リアルタイム更新の設定
    function setupRealtimeSubscription() {
        if (notificationSubscription) {
            notificationSubscription.unsubscribe();
        }

        notificationSubscription = window.supabaseClient
            .channel('notifications')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'notifications',
                filter: `user_id=eq.${currentUserId}`
            }, (payload) => {
                handleRealtimeUpdate(payload);
            })
            .subscribe();
    }

    // リアルタイム更新処理（拡張版：削除されたファイルから復元）
    function handleRealtimeUpdate(payload) {
        // console.log('[NotificationsUnified] リアルタイム更新:', payload.eventType);

        switch (payload.eventType) {
            case 'INSERT':
                notifications.unshift(payload.new);
                displayNotifications();
                showNotificationToast(payload.new);
                // 通知音を再生
                playNotificationSound();
                // ブラウザ通知を表示
                showBrowserNotification(payload.new);
                break;
            case 'UPDATE':
                const index = notifications.findIndex(n => n.id === payload.new.id);
                if (index !== -1) {
                    notifications[index] = payload.new;
                    displayNotifications();
                }
                break;
            case 'DELETE':
                notifications = notifications.filter(n => n.id !== payload.old.id);
                displayNotifications();
                break;
        }
    }

    // 通知トースト表示
    function showNotificationToast(notification) {
        showToast(notification.title, 'info');

        // 音を鳴らす
        if (window.notificationSound) {
            window.notificationSound.play().catch(e => {}); // console.log('通知音の再生に失敗:', e)
        }
    }

    // 通知送信機能
    window.sendNotification = async function(userId, type, title, message, link = null, actions = null) {
        try {
            const { data, error } = await window.supabaseClient
                .from('notifications')
                .insert({
                    user_id: userId,
                    type: type,
                    title: title,
                    message: message,
                    link: link,
                    actions: actions ? JSON.stringify(actions) : null,
                    is_read: false
                })
                .select()
                .maybeSingle();

            if (error) throw error;

            // console.log('[NotificationsUnified] 通知送信成功:', data);
            return data;

        } catch (error) {
            console.error('[NotificationsUnified] 通知送信エラー:', error);
            throw error;
        }
    };

    // ユーティリティ関数
    function getNotificationIcon(type) {
        const icons = {
            event: '<i class="fas fa-calendar-alt"></i>',
            message: '<i class="fas fa-envelope"></i>',
            match: '<i class="fas fa-handshake"></i>',
            system: '<i class="fas fa-bell"></i>',
            referral: '<i class="fas fa-user-plus"></i>',
            cashout: '<i class="fas fa-money-check-alt"></i>'
        };
        return icons[type] || '<i class="fas fa-bell"></i>';
    }

    function formatTime(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;

        if (diff < 60000) {
            return 'たった今';
        } else if (diff < 3600000) {
            return Math.floor(diff / 60000) + '分前';
        } else if (diff < 86400000) {
            return Math.floor(diff / 3600000) + '時間前';
        } else if (diff < 604800000) {
            return Math.floor(diff / 86400000) + '日前';
        } else {
            return date.toLocaleDateString('ja-JP');
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function showToast(message, type = 'success') {
        // トースト通知の実装（既存の実装に依存）
        // console.log(`[NotificationsUnified] Toast: ${type} - ${message}`);
        
        // 簡易的なトースト表示
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('show');
        }, 100);

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // 初期化実行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // 通知音を準備（削除されたファイルから復元）
    function prepareNotificationSound() {
        try {
            notificationSound = new Audio('data:audio/wav;base64,UklGRuIBAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YXEBAAAAAAEAAgADAAQABQAGAAcACAAPAA4ADQAMAAsACgAJAAMABAAFAAYABwAIAAkACgALAAwADQAOAA8ADwAOAA0ADAALAAoACQAIAAcABgAFAAQAAwACAA==');
            notificationSound.volume = 0.3;
        } catch (error) {
            // console.log('[NotificationsUnified] 通知音の準備に失敗');
        }
    }

    // 通知音を再生（削除されたファイルから復元）
    function playNotificationSound() {
        if (notificationSound && !document.hidden) {
            try {
                notificationSound.play().catch(() => {
                    // 自動再生がブロックされた場合は無視
                });
            } catch (error) {
                // エラーを無視
            }
        }
    }

    // ブラウザ通知の権限をリクエスト（削除されたファイルから復元）
    async function requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            try {
                await Notification.requestPermission();
            } catch (error) {
                // console.log('[NotificationsUnified] 通知権限のリクエストに失敗');
            }
        }
    }

    // ブラウザ通知を表示（削除されたファイルから復元）
    function showBrowserNotification(notification) {
        if ('Notification' in window && 
            Notification.permission === 'granted' && 
            document.hidden) {
            
            try {
                const browserNotification = new Notification(notification.title || '新しい通知', {
                    body: notification.message || '',
                    icon: '/assets/notification-icon.png',
                    badge: '/assets/notification-icon.png',
                    tag: notification.id,
                    requireInteraction: false,
                    silent: false
                });

                browserNotification.onclick = () => {
                    window.focus();
                    handleNotificationClick(notification.id);
                    browserNotification.close();
                };

                // 5秒後に自動的に閉じる
                setTimeout(() => browserNotification.close(), 5000);
                
            } catch (error) {
                // console.log('[NotificationsUnified] ブラウザ通知の表示に失敗');
            }
        }
    }

    // クリーンアップ
    window.addEventListener('beforeunload', () => {
        if (notificationSubscription) {
            notificationSubscription.unsubscribe();
        }
    });

})();