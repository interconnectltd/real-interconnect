/**
 * Forgot Password Functionality
 * パスワード再設定機能
 */

(function() {
    'use strict';
    
    // console.log('[ForgotPassword] 初期化開始');
    
    document.addEventListener('DOMContentLoaded', function() {
        const form = document.getElementById('forgotPasswordForm');
        const emailInput = document.getElementById('email');
        const submitButton = document.getElementById('submitButton');
        const buttonText = document.getElementById('buttonText');
        const loadingIcon = document.getElementById('loadingIcon');
        const statusMessage = document.getElementById('statusMessage');
        const messageText = document.getElementById('messageText');
        
        if (!form || !emailInput) {
            console.error('[ForgotPassword] 必要な要素が見つかりません');
            return;
        }
        
        // フォーム送信処理
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            // console.log('[ForgotPassword] フォーム送信開始');
            
            const email = emailInput.value.trim();
            
            if (!email) {
                showMessage('メールアドレスを入力してください', 'error');
                return;
            }
            
            if (!isValidEmail(email)) {
                showMessage('有効なメールアドレスを入力してください', 'error');
                return;
            }
            
            // ボタンを無効化してローディング表示
            submitButton.disabled = true;
            buttonText.style.display = 'none';
            loadingIcon.style.display = 'inline-block';
            
            try {
                // Supabaseを使用してパスワードリセットメールを送信
                if (window.supabaseClient) {
                    const { error } = await window.supabaseClient.auth.resetPasswordForEmail(email, {
                        redirectTo: `${window.location.origin}/reset-password.html`
                    });
                    
                    if (error) {
                        console.error('[ForgotPassword] エラー:', error);
                        
                        // エラーメッセージを日本語化
                        let errorMessage = 'エラーが発生しました。もう一度お試しください。';
                        
                        if (error.message.includes('not found')) {
                            errorMessage = 'このメールアドレスは登録されていません。';
                        } else if (error.message.includes('rate limit')) {
                            errorMessage = 'リクエストが多すぎます。しばらく待ってから再度お試しください。';
                        }
                        
                        showMessage(errorMessage, 'error');
                    } else {
                        // console.log('[ForgotPassword] メール送信成功');
                        showMessage('パスワード再設定用のメールを送信しました。メールボックスをご確認ください。', 'success');
                        
                        // フォームをリセット
                        form.reset();
                        
                        // 5秒後にログインページへリダイレクト
                        setTimeout(() => {
                            window.location.href = 'login.html';
                        }, 5000);
                    }
                } else {
                    // Supabaseが利用できない場合のデモモード
                    // console.log('[ForgotPassword] デモモード: メール送信をシミュレート');
                    
                    // デモ用の処理
                    await simulateEmailSending();
                    
                    showMessage('パスワード再設定用のメールを送信しました。メールボックスをご確認ください。', 'success');
                    
                    // フォームをリセット
                    form.reset();
                }
                
            } catch (error) {
                console.error('[ForgotPassword] 予期しないエラー:', error);
                showMessage('エラーが発生しました。もう一度お試しください。', 'error');
            } finally {
                // ボタンを有効化
                submitButton.disabled = false;
                buttonText.style.display = 'inline';
                loadingIcon.style.display = 'none';
            }
        });
        
        // メールアドレスの検証
        function isValidEmail(email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return emailRegex.test(email);
        }
        
        // メッセージ表示
        function showMessage(message, type) {
            statusMessage.style.display = 'block';
            messageText.textContent = message;
            
            // タイプに応じてスタイルを変更
            statusMessage.className = 'auth-message';
            if (type === 'error') {
                statusMessage.classList.add('error');
                statusMessage.querySelector('i').className = 'fas fa-exclamation-circle';
            } else if (type === 'success') {
                statusMessage.classList.add('success');
                statusMessage.querySelector('i').className = 'fas fa-check-circle';
            }
            
            // 10秒後に自動的に非表示
            setTimeout(() => {
                statusMessage.style.display = 'none';
            }, 10000);
        }
        
        // デモ用のメール送信シミュレーション
        async function simulateEmailSending() {
            return new Promise((resolve) => {
                setTimeout(resolve, 2000); // 2秒待機
            });
        }
    });
    
    // console.log('[ForgotPassword] 初期化完了');
    
})();