/**
 * リアルタイム通知システム統一JavaScript
 * 
 * 以下のファイルの機能を統合:
 * - realtime-notifications.js
 * - notifications-realtime-actions.js
 * - notifications-complete-implementation.js
 */

(function() {
    'use strict';

    // console.log('[RealtimeNotificationsUnified] リアルタイム通知モジュール初期化');

    // URL安全検証（http/httpsのみ許可）
    function sanitizeNotificationUrl(url) {
        if (!url) return '#';
        try {
            const parsed = new URL(url, window.location.origin);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                return parsed.href;
            }
        } catch (e) { /* invalid URL */ }
        return '#';
    }

    // グローバル変数
    let realtimeSubscriptions = {};
    let currentUserId = null;
    let notificationSound = null;

    // 初期化
    async function initialize() {
        // console.log('[RealtimeNotificationsUnified] 初期化開始');

        // Supabaseの準備を待つ
        await window.waitForSupabase();

        // 現在のユーザーを取得
        const user = await window.safeGetUser();
        if (!user) {
            console.error('[RealtimeNotificationsUnified] ユーザーが認証されていません');
            return;
        }

        currentUserId = user.id;
        // console.log('[RealtimeNotificationsUnified] ユーザーID:', currentUserId);

        // 通知音の準備
        setupNotificationSound();

        // リアルタイムサブスクリプションの設定
        setupAllSubscriptions();
    }

    // 通知音の準備
    function setupNotificationSound() {
        // notification.mp3が0バイトなので、音声機能を無効化
        // TODO: 実際の音声ファイルがアップロードされたら、この関数を元に戻す
        notificationSound = null;
        window.notificationSound = null;
        
        // 将来的に音声ファイルが準備できた場合のコード（コメントアウト）
        /*
        try {
            notificationSound = new Audio('/sounds/notification.mp3');
            notificationSound.volume = 0.5;
            notificationSound.addEventListener('error', (e) => {
                // 通知音エラーを静かに処理（コンソールに出力しない）
                // console.warn('[RealtimeNotifications] 通知音ファイルの読み込みに失敗しました。音声なしで続行します。');
                notificationSound = null;
            });
            window.notificationSound = notificationSound;
        } catch (error) {
            notificationSound = null;
        }
        */
    }

    // 全てのリアルタイムサブスクリプションを設定
    function setupAllSubscriptions() {
        // 通知テーブルの更新を監視
        setupNotificationSubscription();

        // メッセージテーブルの更新を監視
        setupMessageSubscription();

        // マッチングテーブルの更新を監視
        setupMatchingSubscription();

        // イベント参加者テーブルの更新を監視
        setupEventSubscription();

        // 紹介テーブルの更新を監視
        setupReferralSubscription();
    }

    // 通知テーブルのサブスクリプション
    function setupNotificationSubscription() {
        const channel = window.supabaseClient
            .channel('notification-changes')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'notifications',
                filter: `user_id=eq.${currentUserId}`
            }, (payload) => {
                handleNewNotification(payload.new);
            })
            .subscribe();

        realtimeSubscriptions.notifications = channel;
    }

    // メッセージテーブルのサブスクリプション
    function setupMessageSubscription() {
        const channel = window.supabaseClient
            .channel('message-changes')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'messages',
                filter: `receiver_id=eq.${currentUserId}`
            }, (payload) => {
                handleNewMessage(payload.new);
            })
            .subscribe();

        realtimeSubscriptions.messages = channel;
    }

    // マッチングテーブルのサブスクリプション
    function setupMatchingSubscription() {
        const channel = window.supabaseClient
            .channel('matching-changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'match_connections',
                filter: `user1_id=eq.${currentUserId}`
            }, (payload) => {
                handleMatchingUpdate(payload);
            })
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'match_connections',
                filter: `user2_id=eq.${currentUserId}`
            }, (payload) => {
                handleMatchingUpdate(payload);
            })
            .subscribe();

        realtimeSubscriptions.matches = channel;
    }

    // イベント参加者テーブルのサブスクリプション
    function setupEventSubscription() {
        const channel = window.supabaseClient
            .channel('event-changes')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'event_participants',
                filter: `user_id=eq.${currentUserId}`
            }, (payload) => {
                handleEventParticipation(payload.new);
            })
            .subscribe();

        realtimeSubscriptions.events = channel;
    }

    // 紹介テーブルのサブスクリプション
    function setupReferralSubscription() {
        const channel = window.supabaseClient
            .channel('referral-changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'invitations',
                filter: `inviter_id=eq.${currentUserId}`
            }, (payload) => {
                handleReferralUpdate(payload);
            })
            .subscribe();

        realtimeSubscriptions.referrals = channel;
    }

    // 新しい通知の処理
    async function handleNewNotification(notification) {
        // console.log('[RealtimeNotificationsUnified] 新しい通知:', notification);

        // トースト表示
        showNotificationToast(notification);

        // 通知音再生
        playNotificationSound();

        // バッジ更新
        updateNotificationBadge();

        // ブラウザ通知（許可されている場合）
        if (Notification.permission === 'granted') {
            showBrowserNotification(notification);
        }
    }

    // 新しいメッセージの処理
    async function handleNewMessage(message) {
        // console.log('[RealtimeNotificationsUnified] 新しいメッセージ:', message);

        // 送信者情報を取得
        const { data: sender } = await window.supabaseClient
            .from('user_profiles')
            .select('name')
            .eq('id', message.sender_id)
            .maybeSingle();

        // 通知を作成
        const notification = {
            type: 'message',
            title: `${sender?.name || '不明なユーザー'}さんから新しいメッセージ`,
            message: ((message.content || '')).substring(0, 50) + ((message.content || '').length > 50 ? '...' : ''),
            link: '/messages.html'
        };

        await createNotification(notification);
    }

    // マッチング更新の処理
    async function handleMatchingUpdate(payload) {
        // console.log('[RealtimeNotificationsUnified] マッチング更新:', payload);

        if (payload.eventType === 'INSERT') {
            // 相手のユーザー情報を取得
            const otherUserId = payload.new.user1_id === currentUserId 
                ? payload.new.user2_id 
                : payload.new.user1_id;

            const { data: otherUser } = await window.supabaseClient
                .from('user_profiles')
                .select('name, company')
                .eq('id', otherUserId)
                .maybeSingle();

            // 通知を作成
            const notification = {
                type: 'match',
                title: '新しいマッチングが成立しました！',
                message: `${otherUser?.company || ''}の${otherUser?.name || ''}さんとマッチングしました。`,
                link: '/matching.html',
                actions: [
                    { type: 'link', label: 'プロフィールを見る', url: `/members.html?id=${otherUserId}`, style: 'btn-primary' },
                    { type: 'link', label: 'メッセージを送る', url: `/messages.html?user=${otherUserId}`, style: 'btn-outline' }
                ]
            };

            await createNotification(notification);
        }
    }

    // イベント参加の処理
    async function handleEventParticipation(participation) {
        // console.log('[RealtimeNotificationsUnified] イベント参加:', participation);

        // イベント情報を取得
        const { data: event } = await window.supabaseClient
            .from('events')
            .select('title, event_date')
            .eq('id', participation.event_id)
            .maybeSingle();

        // 通知を作成
        const notification = {
            type: 'event',
            title: 'イベント参加申込が完了しました',
            message: `「${event?.title || ''}」への参加申込が受け付けられました。`,
            link: `/events.html?id=${participation.event_id}`,
            actions: [
                { type: 'link', label: 'イベント詳細を見る', url: `/events.html?id=${participation.event_id}`, style: 'btn-primary' }
            ]
        };

        await createNotification(notification);
    }

    // 紹介更新の処理
    async function handleReferralUpdate(payload) {
        // console.log('[RealtimeNotificationsUnified] 紹介更新:', payload);

        if (payload.eventType === 'UPDATE' && payload.new.status === 'completed') {
            // 紹介された人の情報を取得
            const { data: referredUser } = await window.supabaseClient
                .from('user_profiles')
                .select('name')
                .eq('id', payload.new.accepted_by)
                .maybeSingle();

            // 通知を作成
            const notification = {
                type: 'referral',
                title: '🎉 紹介報酬が確定しました！',
                message: `${referredUser?.name || ''}さんの面談が完了し、1,000ポイントを獲得しました。`,
                link: '/referral.html'
            };

            await createNotification(notification);
        }
    }

    // 通知を作成
    async function createNotification(notificationData) {
        try {
            const { data, error } = await window.supabaseClient
                .from('notifications')
                .insert({
                    user_id: currentUserId,
                    type: notificationData.type,
                    title: notificationData.title,
                    message: notificationData.message,
                    link: notificationData.link,
                    actions: notificationData.actions ? JSON.stringify(notificationData.actions) : null,
                    is_read: false
                })
                .select()
                .maybeSingle();

            if (error) throw error;

            // console.log('[RealtimeNotificationsUnified] 通知作成成功:', data);
            return data;

        } catch (error) {
            console.error('[RealtimeNotificationsUnified] 通知作成エラー:', error);
        }
    }

    // 通知トースト表示
    function showNotificationToast(notification) {
        const toast = document.createElement('div');
        toast.className = 'notification-toast';
        toast.innerHTML = `
            <div class="toast-icon ${notification.type}">
                ${getNotificationIcon(notification.type)}
            </div>
            <div class="toast-content">
                <div class="toast-title">${escapeHtml(notification.title)}</div>
                ${notification.message ? `<div class="toast-message">${escapeHtml(notification.message)}</div>` : ''}
            </div>
            <button class="toast-close" onclick="this.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        `;

        document.body.appendChild(toast);

        // アニメーション
        setTimeout(() => toast.classList.add('show'), 100);

        // 自動で消す
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 5000);

        // クリックでリンクに遷移（安全なURLのみ許可）
        if (notification.link) {
            const safeLink = sanitizeNotificationUrl(notification.link);
            if (safeLink !== '#') {
                toast.style.cursor = 'pointer';
                toast.addEventListener('click', (e) => {
                    if (!e.target.closest('.toast-close')) {
                        window.location.href = safeLink;
                    }
                });
            }
        }
    }

    // ブラウザ通知表示
    function showBrowserNotification(notification) {
        const options = {
            body: notification.message || '',
            icon: '/assets/notification-icon.png',
            badge: '/assets/notification-icon.png',
            tag: notification.id,
            requireInteraction: false
        };

        const browserNotification = new Notification(notification.title, options);

        browserNotification.onclick = () => {
            window.focus();
            if (notification.link) {
                const safeUrl = sanitizeNotificationUrl(notification.link);
                if (safeUrl !== '#') {
                    window.location.href = safeUrl;
                }
            }
            browserNotification.close();
        };
    }

    // 通知音再生
    function playNotificationSound() {
        if (notificationSound) {
            notificationSound.play().catch(e => {
                // console.log('[RealtimeNotificationsUnified] 通知音の再生に失敗:', e);
            });
        }
    }

    // 通知バッジ更新
    async function updateNotificationBadge() {
        try {
            const { count } = await window.supabaseClient
                .from('notifications')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', currentUserId)
                .eq('is_read', false);

            const badges = document.querySelectorAll('.notification-badge');
            badges.forEach(badge => {
                if (count > 0) {
                    badge.textContent = count > 99 ? '99+' : count;
                    badge.style.display = 'block';
                } else {
                    badge.style.display = 'none';
                }
            });

        } catch (error) {
            console.error('[RealtimeNotificationsUnified] バッジ更新エラー:', error);
        }
    }

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

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ブラウザ通知の許可を要求
    window.requestNotificationPermission = async function() {
        if ('Notification' in window && Notification.permission === 'default') {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                showNotificationToast({
                    type: 'system',
                    title: '通知が有効になりました',
                    message: '重要な更新をお知らせします'
                });
            }
        }
    };

    // 初期化実行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // クリーンアップ（beforeunloadの方がブラウザ互換性が高い）
    window.addEventListener('beforeunload', () => {
        Object.values(realtimeSubscriptions).forEach(subscription => {
            if (subscription && subscription.unsubscribe) {
                subscription.unsubscribe();
            }
        });
    });

})();