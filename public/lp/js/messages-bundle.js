// ============================================================
// Messages Chat System
// 1:1 メッセージ送受信 + リアルタイム更新
// ============================================================
(function() {
    'use strict';

    class ChatManager {
        constructor() {
            this.currentUserId = null;
            this.selectedUserId = null;
            this.conversations = [];
            this.messages = [];
            this.realtimeSubscription = null;
            this.profilesCache = {};
        }

        async init() {
            const user = await window.safeGetUser();
            if (!user) {
                window.location.href = 'login.html';
                return;
            }
            if (user.user_metadata && user.user_metadata.isGuest) {
                const container = document.querySelector('.messages-container, .chat-container, main');
                if (container) {
                    container.innerHTML = '<div class="empty-state" style="padding:60px 20px;text-align:center;"><i class="fas fa-comments" style="font-size:3rem;color:#ccc;margin-bottom:16px;"></i><h3>この機能はゲストモードでは利用できません。</h3><p>メッセージ機能を利用するにはアカウント登録してください</p><a href="register.html" class="btn btn-primary" style="margin-top:16px;">新規登録</a></div>';
                }
                return;
            }
            this.currentUserId = user.id;

            // 自分のプロフィールをキャッシュ
            const { data: myProfile } = await window.supabaseClient
                .from('user_profiles')
                .select('id, full_name, avatar_url')
                .eq('id', this.currentUserId)
                .maybeSingle();
            if (myProfile) this.profilesCache[myProfile.id] = myProfile;

            await this.loadConversations();
            this.setupUI();
            this.subscribeRealtime();

            // URLパラメータでユーザー指定がある場合はそのチャットを開く
            const params = new URLSearchParams(window.location.search);
            const targetUserId = params.get('user');
            if (targetUserId) {
                this.openConversation(targetUserId);
            }
        }

        // コネクション済みユーザー一覧 + 最新メッセージを読み込む
        async loadConversations() {
            try {
                // accepted なコネクションを取得
                const { data: connections, error: connError } = await window.supabaseClient
                    .from('connections')
                    .select('user_id, connected_user_id')
                    .eq('status', 'accepted');

                if (connError) throw connError;
                if (!connections || connections.length === 0) {
                    this.conversations = [];
                    this.renderConversations();
                    return;
                }

                // 相手のIDリストを作成
                const partnerIds = connections.map(c =>
                    c.user_id === this.currentUserId ? c.connected_user_id : c.user_id
                );

                // プロフィール取得
                const { data: profiles } = await window.supabaseClient
                    .from('user_profiles')
                    .select('id, full_name, company, avatar_url')
                    .in('id', partnerIds);

                if (profiles) {
                    profiles.forEach(p => { this.profilesCache[p.id] = p; });
                }

                // 自分の全メッセージを取得して最新メッセージを抽出
                const { data: allMessages } = await window.supabaseClient
                    .from('messages')
                    .select('sender_id, receiver_id, content, created_at, is_read')
                    .or(`sender_id.eq.${this.currentUserId},receiver_id.eq.${this.currentUserId}`)
                    .order('created_at', { ascending: false });

                // パートナーごとに最新メッセージを整理
                const lastMessageMap = {};
                const unreadCountMap = {};
                if (allMessages) {
                    for (const msg of allMessages) {
                        const partnerId = msg.sender_id === this.currentUserId ? msg.receiver_id : msg.sender_id;
                        if (!lastMessageMap[partnerId]) {
                            lastMessageMap[partnerId] = msg;
                        }
                        // 未読カウント
                        if (msg.receiver_id === this.currentUserId && !msg.is_read) {
                            unreadCountMap[partnerId] = (unreadCountMap[partnerId] || 0) + 1;
                        }
                    }
                }

                // 会話リスト作成
                this.conversations = partnerIds.map(pid => {
                    const profile = this.profilesCache[pid] || {};
                    const lastMsg = lastMessageMap[pid];
                    return {
                        userId: pid,
                        name: profile.full_name || 'ユーザー',
                        company: profile.company || '',
                        avatar: profile.avatar_url || 'assets/default-avatar.svg',
                        lastMessage: lastMsg ? lastMsg.content : null,
                        lastMessageAt: lastMsg ? new Date(lastMsg.created_at) : null,
                        unreadCount: unreadCountMap[pid] || 0
                    };
                });

                // 最新メッセージ順にソート（メッセージなしは末尾）
                this.conversations.sort((a, b) => {
                    if (!a.lastMessageAt && !b.lastMessageAt) return 0;
                    if (!a.lastMessageAt) return 1;
                    if (!b.lastMessageAt) return -1;
                    return b.lastMessageAt - a.lastMessageAt;
                });

                this.renderConversations();

            } catch (error) {
                console.error('[Chat] 会話リスト読み込みエラー:', error);
                this.conversations = [];
                this.renderConversations();
            }
        }

        renderConversations() {
            const container = document.getElementById('chatConversations');
            if (!container) return;

            if (this.conversations.length === 0) {
                container.innerHTML = `
                    <div class="chat-empty-conversations">
                        <i class="fas fa-user-friends"></i>
                        <p>コネクション済みのユーザーがいません</p>
                        <a href="matching.html" class="btn btn-small btn-primary">マッチングを始める</a>
                    </div>`;
                return;
            }

            container.innerHTML = this.conversations.map(conv => `
                <div class="chat-conv-item ${conv.userId === this.selectedUserId ? 'active' : ''}" data-user-id="${conv.userId}">
                    <img src="${this.escapeAttr(conv.avatar)}" alt="" class="chat-conv-avatar"
                         onerror="this.src='assets/default-avatar.svg'">
                    <div class="chat-conv-info">
                        <div class="chat-conv-top">
                            <span class="chat-conv-name">${this.escapeHtml(conv.name)}</span>
                            ${conv.lastMessageAt ? `<span class="chat-conv-time">${this.formatTimeShort(conv.lastMessageAt)}</span>` : ''}
                        </div>
                        <div class="chat-conv-bottom">
                            <span class="chat-conv-preview">${conv.lastMessage ? this.escapeHtml(conv.lastMessage.substring(0, 40)) : this.escapeHtml(conv.company || 'メッセージはまだありません')}</span>
                            ${conv.unreadCount > 0 ? `<span class="chat-conv-badge">${conv.unreadCount}</span>` : ''}
                        </div>
                    </div>
                </div>
            `).join('');

            // クリックイベント
            container.querySelectorAll('.chat-conv-item').forEach(item => {
                item.addEventListener('click', () => {
                    this.openConversation(item.dataset.userId);
                });
            });
        }

        async openConversation(userId) {
            // コネクション確認（未コネクションの相手にはメッセージ不可）
            const { data: conn } = await window.supabaseClient
                .from('connections')
                .select('id')
                .eq('status', 'accepted')
                .or(`and(user_id.eq.${this.currentUserId},connected_user_id.eq.${userId}),and(user_id.eq.${userId},connected_user_id.eq.${this.currentUserId})`)
                .maybeSingle();

            if (!conn) {
                if (window.showToast) {
                    window.showToast('コネクション済みのユーザーとのみメッセージができます', 'warning');
                }
                return;
            }

            this.selectedUserId = userId;

            // UIの表示切替
            const emptyState = document.getElementById('chatEmptyState');
            const thread = document.getElementById('chatThread');
            const chatContainer = document.getElementById('chatContainer');
            if (emptyState) emptyState.style.display = 'none';
            if (thread) thread.style.display = 'flex';
            if (chatContainer) chatContainer.classList.add('chat-active');

            // 会話リストのアクティブ状態を更新
            document.querySelectorAll('.chat-conv-item').forEach(item => {
                item.classList.toggle('active', item.dataset.userId === userId);
            });

            // ヘッダー情報を設定
            let profile = this.profilesCache[userId];
            if (!profile) {
                const { data } = await window.supabaseClient
                    .from('user_profiles')
                    .select('id, full_name, company, avatar_url')
                    .eq('id', userId)
                    .maybeSingle();
                if (data) {
                    profile = data;
                    this.profilesCache[userId] = data;
                }
            }

            const nameEl = document.getElementById('chatThreadName');
            const companyEl = document.getElementById('chatThreadCompany');
            const avatarEl = document.getElementById('chatThreadAvatar');
            const profileLink = document.getElementById('chatProfileLink');
            if (nameEl) nameEl.textContent = profile?.full_name || 'ユーザー';
            if (companyEl) companyEl.textContent = profile?.company || '';
            if (avatarEl) {
                avatarEl.src = profile?.avatar_url || 'assets/default-avatar.svg';
                avatarEl.onerror = function() { this.src = 'assets/default-avatar.svg'; };
            }
            if (profileLink) profileLink.href = `profile.html?user=${userId}`;

            // メッセージを読み込み
            await this.loadMessages(userId);

            // 入力欄にフォーカス
            const input = document.getElementById('chatInput');
            if (input) input.focus();
        }

        async loadMessages(userId) {
            const container = document.getElementById('chatMessages');
            if (!container) return;
            container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i></div>';

            try {
                const { data, error } = await window.supabaseClient
                    .from('messages')
                    .select('*')
                    .or(
                        `and(sender_id.eq.${this.currentUserId},receiver_id.eq.${userId}),and(sender_id.eq.${userId},receiver_id.eq.${this.currentUserId})`
                    )
                    .order('created_at', { ascending: true });

                if (error) throw error;
                this.messages = data || [];
                this.renderMessages();

                // 未読を既読にする
                this.markAsRead(userId);

            } catch (error) {
                console.error('[Chat] メッセージ読み込みエラー:', error);
                container.innerHTML = '<div class="chat-error"><p>メッセージの読み込みに失敗しました</p></div>';
            }
        }

        renderMessages() {
            const container = document.getElementById('chatMessages');
            if (!container) return;

            if (this.messages.length === 0) {
                container.innerHTML = `
                    <div class="chat-no-messages">
                        <i class="fas fa-hand-peace"></i>
                        <p>まだメッセージがありません。最初のメッセージを送ってみましょう！</p>
                    </div>`;
                return;
            }

            let lastDate = null;
            let html = '';

            for (const msg of this.messages) {
                const msgDate = new Date(msg.created_at);
                const dateStr = msgDate.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

                // 日付区切り
                if (dateStr !== lastDate) {
                    html += `<div class="chat-date-divider"><span>${dateStr}</span></div>`;
                    lastDate = dateStr;
                }

                const isMine = msg.sender_id === this.currentUserId;
                const timeStr = msgDate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

                html += `
                    <div class="chat-bubble ${isMine ? 'mine' : 'theirs'}">
                        <div class="chat-bubble-content">${this.escapeHtml(msg.content)}</div>
                        <div class="chat-bubble-meta">
                            <span class="chat-bubble-time">${timeStr}</span>
                            ${isMine && msg.is_read ? '<i class="fas fa-check-double chat-read-icon"></i>' : ''}
                        </div>
                    </div>`;
            }

            container.innerHTML = html;
            container.scrollTop = container.scrollHeight;
        }

        async sendMessage(content) {
            if (!content.trim() || !this.selectedUserId) return;

            try {
                // コネクション再確認（送信時にも確認）
                const { data: connCheck } = await window.supabaseClient
                    .from('connections')
                    .select('id')
                    .eq('status', 'accepted')
                    .or(`and(user_id.eq.${this.currentUserId},connected_user_id.eq.${this.selectedUserId}),and(user_id.eq.${this.selectedUserId},connected_user_id.eq.${this.currentUserId})`)
                    .maybeSingle();

                if (!connCheck) {
                    if (window.showToast) {
                        window.showToast('コネクションが無効になりました', 'error');
                    }
                    return;
                }
                const { data, error } = await window.supabaseClient
                    .from('messages')
                    .insert({
                        sender_id: this.currentUserId,
                        receiver_id: this.selectedUserId,
                        content: content.trim()
                    })
                    .select()
                    .maybeSingle();

                if (error) throw error;

                // メッセージを即座にUIに追加
                this.messages.push(data);
                this.renderMessages();

                // 会話リストの最新メッセージも更新
                const conv = this.conversations.find(c => c.userId === this.selectedUserId);
                if (conv) {
                    conv.lastMessage = content.trim();
                    conv.lastMessageAt = new Date(data.created_at);
                    this.renderConversations();
                }

                // 通知送信
                await window.supabaseClient
                    .from('notifications')
                    .insert({
                        user_id: this.selectedUserId,
                        type: 'new_message',
                        title: '新しいメッセージ',
                        message: `${this.profilesCache[this.currentUserId]?.full_name || 'ユーザー'}さんからメッセージが届きました`,
                        data: { related_id: this.currentUserId },
                        is_read: false
                    });

            } catch (error) {
                console.error('[Chat] メッセージ送信エラー:', error);
                if (window.showToast) {
                    window.showToast('メッセージの送信に失敗しました', 'error');
                }
            }
        }

        async markAsRead(userId) {
            try {
                await window.supabaseClient
                    .from('messages')
                    .update({ is_read: true })
                    .eq('sender_id', userId)
                    .eq('receiver_id', this.currentUserId)
                    .eq('is_read', false);

                // 会話リストの未読カウントをリセット
                const conv = this.conversations.find(c => c.userId === userId);
                if (conv) {
                    conv.unreadCount = 0;
                    this.renderConversations();
                }
            } catch (error) {
                console.error('[Chat] 既読更新エラー:', error);
            }
        }

        subscribeRealtime() {
            if (!window.supabaseClient) return;

            this.realtimeSubscription = window.supabaseClient
                .channel('messages-realtime')
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages',
                    filter: `receiver_id=eq.${this.currentUserId}`
                }, (payload) => {
                    const newMsg = payload.new;
                    // 現在開いている会話のメッセージなら即座に表示
                    if (newMsg.sender_id === this.selectedUserId) {
                        this.messages.push(newMsg);
                        this.renderMessages();
                        this.markAsRead(this.selectedUserId);
                    }
                    // 会話リストを更新
                    this.updateConversationPreview(newMsg);
                })
                .on('postgres_changes', {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'messages',
                    filter: `sender_id=eq.${this.currentUserId}`
                }, (payload) => {
                    // 既読状態の更新
                    const updated = payload.new;
                    const idx = this.messages.findIndex(m => m.id === updated.id);
                    if (idx !== -1) {
                        this.messages[idx].is_read = updated.is_read;
                        this.renderMessages();
                    }
                })
                .subscribe();
        }

        updateConversationPreview(msg) {
            const partnerId = msg.sender_id === this.currentUserId ? msg.receiver_id : msg.sender_id;
            const conv = this.conversations.find(c => c.userId === partnerId);
            if (conv) {
                conv.lastMessage = msg.content;
                conv.lastMessageAt = new Date(msg.created_at);
                if (msg.sender_id !== this.currentUserId && partnerId !== this.selectedUserId) {
                    conv.unreadCount = (conv.unreadCount || 0) + 1;
                }
                // 再ソート
                this.conversations.sort((a, b) => {
                    if (!a.lastMessageAt && !b.lastMessageAt) return 0;
                    if (!a.lastMessageAt) return 1;
                    if (!b.lastMessageAt) return -1;
                    return b.lastMessageAt - a.lastMessageAt;
                });
                this.renderConversations();
            } else {
                // 新規会話の場合はリロード
                this.loadConversations();
            }
        }

        setupUI() {
            // 送信フォーム
            const form = document.getElementById('chatForm');
            const input = document.getElementById('chatInput');
            const sendBtn = document.getElementById('chatSendBtn');

            if (form) {
                form.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const content = input.value;
                    if (!content.trim()) return;
                    input.value = '';
                    sendBtn.disabled = true;
                    await this.sendMessage(content);
                    sendBtn.disabled = !input.value.trim();
                    input.focus();
                });
            }

            if (input) {
                input.addEventListener('input', () => {
                    sendBtn.disabled = !input.value.trim();
                });
            }

            // 戻るボタン（モバイル用）
            const backBtn = document.getElementById('chatBackBtn');
            if (backBtn) {
                backBtn.addEventListener('click', () => {
                    const chatContainer = document.getElementById('chatContainer');
                    if (chatContainer) chatContainer.classList.remove('chat-active');
                    this.selectedUserId = null;
                    document.querySelectorAll('.chat-conv-item').forEach(i => i.classList.remove('active'));
                });
            }
        }

        // ユーティリティ
        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text || '';
            return div.innerHTML;
        }

        escapeAttr(text) {
            return (text || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        formatTimeShort(date) {
            const now = new Date();
            const diff = now - date;
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            if (days === 0) return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
            if (days === 1) return '昨日';
            if (days < 7) return `${days}日前`;
            return date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
        }

        destroy() {
            if (this.realtimeSubscription) {
                window.supabaseClient.removeChannel(this.realtimeSubscription);
            }
        }
    }

    // 初期化
    let chatManager = null;

    async function initChat() {
        if (window.waitForSupabase) {
            await window.waitForSupabase();
        }
        chatManager = new ChatManager();
        await chatManager.init();
        window.chatManager = chatManager;
    }

    // window.openChat をグローバルに公開
    window.openChat = function(userId) {
        if (chatManager && chatManager.currentUserId) {
            chatManager.openConversation(userId);
        } else {
            window.location.href = `messages.html?user=${encodeURIComponent(userId)}`;
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initChat);
    } else {
        initChat();
    }
})();
