/**
 * Global Functions Manager
 * グローバル関数の重複を防ぐための統一管理
 */

(function() {
    'use strict';
    
    // グローバル名前空間の保護
    window.INTERCONNECT = window.INTERCONNECT || {};
    
    /**
     * ログアウト処理（統一版）
     */
    window.logout = async function() {
        
        try {
            // Supabaseからログアウト - 両方の参照をチェック
            const client = window.supabaseClient || window.supabase;
            if (client) {
                const { error } = await client.auth.signOut();
                if (error) {
                    throw error;
                }
            }
            
            // セッションクリア
            sessionStorage.clear();
            localStorage.removeItem('supabase.auth.token');
            
            // クッキーをクリア
            document.cookie.split(";").forEach(function(c) { 
                document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"); 
            });
            
            // ログインページへリダイレクト
            window.location.href = '/login.html';
            
        } catch (error) {
            // エラーが発生してもログインページへ
            window.location.href = '/login.html';
        }
    };
    
    /**
     * 登録フローのステップ管理（統一版）
     */
    let currentStep = 1;
    const totalSteps = 5;
    
    // nextStep関数の統一版（一度だけ定義）
    if (!window.nextStep) {
        window.nextStep = function() {
            const currentStepElement = document.querySelector('.form-step.active');
            
            if (!currentStepElement) {
                return;
            }
            
            const currentStepNum = parseInt(currentStepElement.getAttribute('data-step'));
            
            const nextStepElement = document.querySelector(`.form-step[data-step="${currentStepNum + 1}"]`);
            
            // バリデーション - 複数の場所に定義があるため統合
            let isValid = true;
            
            // register-strict-validation.jsの厳密なバリデーション
            if (typeof window.nextStepValidation === 'function') {
                isValid = window.nextStepValidation();
                if (!isValid) {
                    return; // バリデーション失敗時はここで終了
                }
            }
            // registration-flow.jsのバリデーション
            else if (window.InterConnect && window.InterConnect.Registration && typeof window.InterConnect.Registration.validateCurrentStep === 'function') {
                isValid = window.InterConnect.Registration.validateCurrentStep(currentStepNum);
            }
            // グローバルのバリデーション
            else if (typeof validateCurrentStep === 'function') {
                isValid = validateCurrentStep(currentStepNum);
            }
            // register-enhanced-validation.jsのバリデーション
            else if (typeof validateStep === 'function') {
                isValid = validateStep(currentStepNum);
            } else {
            }
            
            
            if (!isValid) {
                return;
            }
            
            if (nextStepElement && currentStepNum < 5) {
                
                // 現在のステップを非表示
                currentStepElement.classList.remove('active');
                
                // 次のステップを表示
                nextStepElement.classList.add('active');
                
                // プログレスインジケーターを更新
                updateProgressIndicator(currentStepNum + 1);
                
                currentStep = currentStepNum + 1;
                
                // スクロールを上部に
                window.scrollTo({ top: 0, behavior: 'smooth' });
                
                // ステップ変更イベントを発火
                window.dispatchEvent(new CustomEvent('stepChanged', { 
                    detail: { currentStep: currentStepNum + 1, totalSteps: 5 } 
                }));
            } else {
            }
        };
    } else {
    }
    
    // prevStep関数の統一版（一度だけ定義）
    if (!window.prevStep) {
        window.prevStep = function() {
            const currentStepElement = document.querySelector('.form-step.active');
            if (!currentStepElement) return;
            
            const currentStepNum = parseInt(currentStepElement.getAttribute('data-step'));
            const prevStepElement = document.querySelector(`.form-step[data-step="${currentStepNum - 1}"]`);
            
            if (prevStepElement && currentStepNum > 1) {
                // 現在のステップを非表示
                currentStepElement.classList.remove('active');
                
                // 前のステップを表示
                prevStepElement.classList.add('active');
                
                // プログレスインジケーターを更新
                updateProgressIndicator(currentStepNum - 1);
                
                currentStep = currentStepNum - 1;
                
                // ステップ変更イベントを発火
                window.dispatchEvent(new CustomEvent('stepChanged', { 
                    detail: { currentStep: currentStepNum - 1, totalSteps: 5 } 
                }));
            }
        };
    }
    
    /**
     * プログレスインジケーターの更新
     */
    function updateProgressIndicator(stepNum) {
        const progressSteps = document.querySelectorAll('.progress-step');
        
        progressSteps.forEach((step) => {
            const stepNumber = parseInt(step.getAttribute('data-step'));
            if (stepNumber <= stepNum) {
                step.classList.add('active');
            } else {
                step.classList.remove('active');
            }
        });
    }
    
    // data-action属性を使用したイベントリスナー設定
    document.addEventListener('DOMContentLoaded', function() {
        
        // data-action="next"のボタンにイベントを設定（重複防止）
        const nextButtons = document.querySelectorAll('[data-action="next"]');
        
        nextButtons.forEach((button, index) => {
            // 既にリスナーが設定されていないか確認
            if (!button.dataset.listenerAdded) {
                button.dataset.listenerAdded = 'true';
                button.addEventListener('click', function(e) {
                    e.preventDefault();
                    window.nextStep();
                });
            } else {
            }
        });
        
        // data-action="prev"のボタンにイベントを設定（重複防止）
        const prevButtons = document.querySelectorAll('[data-action="prev"]');
        
        prevButtons.forEach((button, index) => {
            if (!button.dataset.listenerAdded) {
                button.dataset.listenerAdded = 'true';
                button.addEventListener('click', function(e) {
                    e.preventDefault();
                    window.prevStep();
                });
            }
        });
    })
    
    /**
     * 初期化完了を通知
     */
    
    // 他のスクリプトが重複定義しないように警告
    Object.defineProperty(window, 'logout', {
        writable: false,
        configurable: false
    });
    
    // nextStep関数は後から上書き可能にする
    Object.defineProperty(window, 'nextStep', {
        writable: true,
        configurable: true
    });
    
    Object.defineProperty(window, 'prevStep', {
        writable: false,
        configurable: false
    });
    
})();