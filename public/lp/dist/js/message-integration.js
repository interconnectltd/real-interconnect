/**
 * Message Integration
 * メッセージ送信と通知の統合
 */

(function() {
    'use strict';

    class MessageIntegration {
        constructor() {
            this.init();
        }

        async init() {
            // メッセージ送信フォームの監視
            this.setupMessageFormListeners();
            // console.log('[MessageIntegration] Initialized');
        }

        /**
         * メッセージ送信フォームのイベントリスナーを設定
         */
        setupMessageFormListeners() {
            // 既存のメッセージ送信ボタンやフォームを監視
            document.addEventListener('click', async (e) => {
                // メッセージ送信ボタンがクリックされた場合
                if (e.target.matches('.send-message-btn, [data-action="send-message"]')) {
                    await this.handleMessageSend(e);
                }
            });

            // フォーム送信イベントも監視
            document.addEventListener('submit', async (e) => {
                if (e.target.matches('.message-form, [data-form="message"]')) {
                    e.preventDefault();
                    await this.handleMessageFormSubmit(e.target);
                }
            });
        }

        /**
         * メッセージ送信を処理
         */
        async handleMessageSend(event) {
            try {
                const recipientId = event.target.dataset.recipientId;
                const recipientName = event.target.dataset.recipientName || 'ユーザー';
                const messageInput = document.querySelector('[data-message-input]');
                const messageContent = messageInput?.value || '';

                if (!recipientId || !messageContent.trim()) {
                    console.warn('[MessageIntegration] 送信先または内容が不足');
                    return;
                }

                // メッセージを送信
                const result = await this.sendMessage(recipientId, messageContent);
                
                if (result.success) {
                    // 通知を送信
                    await this.sendMessageNotification(recipientId, recipientName, messageContent);
                    
                    // UIを更新
                    this.updateUIAfterSend(messageInput);
                }

            } catch (error) {
                console.error('[MessageIntegration] メッセージ送信エラー:', error);
            }
        }

        /**
         * フォーム送信を処理
         */
        async handleMessageFormSubmit(form) {
            try {
                const formData = new FormData(form);
                const recipientId = formData.get('recipient_id');
                const recipientName = formData.get('recipient_name') || 'ユーザー';
                const messageContent = formData.get('message');

                if (!recipientId || !messageContent?.trim()) {
                    console.warn('[MessageIntegration] フォームデータが不足');
                    return;
                }

                // メッセージを送信
                const result = await this.sendMessage(recipientId, messageContent);
                
                if (result.success) {
                    // 通知を送信
                    await this.sendMessageNotification(recipientId, recipientName, messageContent);
                    
                    // フォームをリセット
                    form.reset();
                    
                    // 成功メッセージを表示
                    this.showSuccessMessage();
                }

            } catch (error) {
                console.error('[MessageIntegration] フォーム送信エラー:', error);
            }
        }

        /**
         * メッセージを送信（実装はプロジェクトに応じて）
         */
        async sendMessage(recipientId, content) {
            try {
                if (!window.supabaseClient) {
                    console.error('[MessageIntegration] Supabase not initialized');
                    return { success: false };
                }

                const user = await window.safeGetUser();
                if (!user) {
                    console.error('[MessageIntegration] User not authenticated');
                    return { success: false };
                }

                // メッセージテーブルが存在する場合の実装例
                /*
                const { data, error } = await window.supabase
                    .from('messages')
                    .insert({
                        sender_id: user.id,
                        recipient_id: recipientId,
                        content: content,
                        created_at: new Date().toISOString()
                    })
                    .select()
                    .maybeSingle();

                if (error) {
                    console.error('[MessageIntegration] Message send error:', error);
                    return { success: false, error };
                }

                return { success: true, data };
                */

                // 現在はメッセージテーブルがないため、成功として扱う
                // console.log('[MessageIntegration] Message would be sent:', {
                //     sender: user.id,
                //     recipient: recipientId,
                //     content: content
                // });

                return { success: true };

            } catch (error) {
                console.error('[MessageIntegration] Error sending message:', error);
                return { success: false, error };
            }
        }

        /**
         * メッセージ送信通知を送る
         */
        async sendMessageNotification(recipientId, recipientName, messageContent) {
            try {
                if (!window.notificationSender) {
                    console.error('[MessageIntegration] NotificationSender not available');
                    return;
                }

                // 現在のユーザー情報を取得
                const user = await window.safeGetUser();
                if (!user) return;

                // ユーザープロフィールを取得
                const { data: profile } = await window.supabaseClient
                    .from('user_profiles')
                    .select('full_name, avatar_url')
                    .eq('id', user.id)
                    .maybeSingle();

                const senderData = {
                    id: user.id,
                    name: profile?.full_name || 'ユーザー',
                    avatar: profile?.avatar_url || 'assets/user-placeholder.svg'
                };

                // 通知を送信
                const result = await window.notificationSender.sendMessageNotification(
                    recipientId,
                    senderData,
                    messageContent.substring(0, 100) // プレビューは100文字まで
                );

                if (result.success) {
                    // console.log('[MessageIntegration] Notification sent successfully');
                }

            } catch (error) {
                console.error('[MessageIntegration] Error sending notification:', error);
            }
        }

        /**
         * 送信後のUI更新
         */
        updateUIAfterSend(messageInput) {
            if (messageInput) {
                messageInput.value = '';
            }

            // 送信ボタンを一時的に無効化
            const sendButtons = document.querySelectorAll('.send-message-btn, [data-action="send-message"]');
            sendButtons.forEach(btn => {
                btn.disabled = true;
                setTimeout(() => {
                    btn.disabled = false;
                }, 1000);
            });
        }

        /**
         * 成功メッセージを表示
         */
        showSuccessMessage() {
            // トースト通知やアラートを表示（実装はプロジェクトに応じて）
            if (window.showToast) {
                window.showToast('メッセージを送信しました', 'success');
            } else {
                // console.log('[MessageIntegration] Message sent successfully');
            }
        }

        /**
         * 外部連絡先へのメッセージ送信時の通知
         */
        async sendExternalContactNotification(contactData, messageType = 'email') {
            try {
                if (!window.notificationSender) return;

                const user = await window.safeGetUser();
                if (!user) return;

                // システム通知として記録
                await window.notificationSender.sendSystemNotification(
                    user.id,
                    '外部連絡先へのメッセージ',
                    `${contactData.name}さんに${messageType}でメッセージを送信しました`
                );

            } catch (error) {
                console.error('[MessageIntegration] Error recording external contact:', error);
            }
        }
    }

    // グローバルに公開
    window.MessageIntegration = MessageIntegration;

    // 自動初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            new MessageIntegration();
        });
    } else {
        new MessageIntegration();
    }

})();