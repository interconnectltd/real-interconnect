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
        // console.log('Logout initiated');
        
        try {
            // Supabaseからログアウト - 両方の参照をチェック
            const client = window.supabaseClient || window.supabase;
            if (client) {
                const { error } = await client.auth.signOut();
                if (error) {
                    // console.error('Logout error:', error);
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
            // console.error('Logout failed:', error);
            // エラーが発生してもログインページへ
            window.location.href = '/login.html';
        }
    };
    
    /**
     * 登録フローのステップ管理（統一版）
     */
    let currentStep = 1;
    const totalSteps = 4; // 必要に応じて調整
    
    // nextStep関数の統一版（一度だけ定義）
    if (!window.nextStep) {
        window.nextStep = function() {
            // console.log('[nextStep] Function called');
            const currentStepElement = document.querySelector('.form-step.active');
            // console.log('[nextStep] Current active step element:', currentStepElement);
            
            if (!currentStepElement) {
                // console.error('[nextStep] No active step found!');
                return;
            }
            
            const currentStepNum = parseInt(currentStepElement.getAttribute('data-step'));
            // console.log('[nextStep] Current step number:', currentStepNum);
            
            const nextStepElement = document.querySelector(`.form-step[data-step="${currentStepNum + 1}"]`);
            // console.log('[nextStep] Next step element:', nextStepElement);
            
            // バリデーション - 複数の場所に定義があるため統合
            let isValid = true;
            
            // ステップ2の場合、「現状課題なし」の特別処理
            if (currentStepNum === 2) {
                // 各グループで「現状課題なし」がチェックされているテキストエリアは無効化
                document.querySelectorAll('.challenge-group').forEach(group => {
                    const noChallengeCheckbox = group.querySelector('input[value="現状課題なし"]:checked');
                    const textarea = group.querySelector('textarea');
                    if (noChallengeCheckbox && textarea) {
                        textarea.disabled = true;
                        textarea.removeAttribute('data-required');
                        textarea.setAttribute('data-no-validate', 'true');
                    }
                });
            }
            
            // register-strict-validation.jsの厳密なバリデーション
            if (typeof window.nextStepValidation === 'function') {
                // console.log('[nextStep] Using nextStepValidation');
                isValid = window.nextStepValidation();
                if (!isValid) {
                    return; // バリデーション失敗時はここで終了
                }
            }
            // registration-flow.jsのバリデーション
            else if (window.InterConnect && window.InterConnect.Registration && typeof window.InterConnect.Registration.validateCurrentStep === 'function') {
                // console.log('[nextStep] Using InterConnect.Registration.validateCurrentStep');
                isValid = window.InterConnect.Registration.validateCurrentStep(currentStepNum);
            }
            // グローバルのバリデーション
            else if (typeof validateCurrentStep === 'function') {
                // console.log('[nextStep] Using global validateCurrentStep');
                isValid = validateCurrentStep(currentStepNum);
            }
            // register-enhanced-validation.jsのバリデーション
            else if (typeof validateStep === 'function') {
                // console.log('[nextStep] Using validateStep');
                isValid = validateStep(currentStepNum);
            } else {
                // console.log('[nextStep] No validation function found');
            }
            
            // console.log('[nextStep] Validation result:', isValid);
            
            if (!isValid) {
                // console.log('[nextStep] Validation failed, stopping');
                return;
            }
            
            if (nextStepElement && currentStepNum < 5) {
                // console.log('[nextStep] Moving to next step');
                
                // 現在のステップを非表示
                currentStepElement.classList.remove('active');
                // console.log('[nextStep] Removed active from current step');
                
                // 次のステップを表示
                nextStepElement.classList.add('active');
                // console.log('[nextStep] Added active to next step');
                
                // プログレスインジケーターを更新
                updateProgressIndicator(currentStepNum + 1);
                
                currentStep = currentStepNum + 1;
                // console.log('[nextStep] Updated currentStep to:', currentStep);
                
                // スクロールを上部に
                window.scrollTo({ top: 0, behavior: 'smooth' });
                
                // ステップ変更イベントを発火
                window.dispatchEvent(new CustomEvent('stepChanged', { 
                    detail: { currentStep: currentStepNum + 1, totalSteps: 5 } 
                }));
                // console.log('[nextStep] Step change completed');
            } else {
                // console.log('[nextStep] Cannot move to next step - nextStepElement:', !!nextStepElement, 'currentStepNum:', currentStepNum);
            }
        };
    } else {
        // console.log('[GlobalFunctions] nextStep already defined');
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
        // console.log('[GlobalFunctions] DOMContentLoaded - Setting up button listeners');
        
        // data-action="next"のボタンにイベントを設定（重複防止）
        const nextButtons = document.querySelectorAll('[data-action="next"]');
        // console.log('[GlobalFunctions] Found next buttons:', nextButtons.length);
        
        nextButtons.forEach((button, index) => {
            // console.log(`[GlobalFunctions] Processing next button ${index}:`, button);
            // 既にリスナーが設定されていないか確認
            if (!button.dataset.listenerAdded) {
                button.dataset.listenerAdded = 'true';
                button.addEventListener('click', function(e) {
                    e.preventDefault();
                    // console.log('[GlobalFunctions] Next button clicked - calling nextStep()');
                    // console.log('[GlobalFunctions] Current active step:', document.querySelector('.form-step.active'));
                    window.nextStep();
                });
                // console.log(`[GlobalFunctions] Listener added to next button ${index}`);
            } else {
                // console.log(`[GlobalFunctions] Listener already exists on next button ${index}`);
            }
        });
        
        // data-action="prev"のボタンにイベントを設定（重複防止）
        const prevButtons = document.querySelectorAll('[data-action="prev"]');
        // console.log('[GlobalFunctions] Found prev buttons:', prevButtons.length);
        
        prevButtons.forEach((button, index) => {
            if (!button.dataset.listenerAdded) {
                button.dataset.listenerAdded = 'true';
                button.addEventListener('click', function(e) {
                    e.preventDefault();
                    // console.log('[GlobalFunctions] Prev button clicked');
                    window.prevStep();
                });
            }
        });
    })
    
    /**
     * 初期化完了を通知
     */
    // console.log('Global functions initialized');
    
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