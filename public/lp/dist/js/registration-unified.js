// ============================================================
// Section: register-auth-check.js
// ============================================================
// 登録ページのログイン状態チェック
(function() {
    // console.log('[RegisterAuthCheck] 認証状態チェック開始');

    // Supabaseクライアントの初期化を待つ
    function checkAuthStatus() {
        if (!window.supabaseClient) {
            setTimeout(checkAuthStatus, 100);
            return;
        }

        // 現在のユーザーを確認
        window.supabaseClient.auth.getUser().then(async ({ data: { user } }) => {
            if (user) {
                if (await window.showConfirmModal('既にログイン済みです。ダッシュボードに移動しますか？', { confirmLabel: 'ダッシュボードへ' })) {
                    window.location.href = '/dashboard.html';
                } else {
                    if (await window.showConfirmModal('新規登録を行うには、一度ログアウトする必要があります。ログアウトしますか？', { confirmLabel: 'ログアウト' })) {
                        window.supabaseClient.auth.signOut().then(() => {
                            window.location.reload();
                        });
                    } else {
                        window.location.href = '/dashboard.html';
                    }
                }
            } else {
                // console.log('[RegisterAuthCheck] 未ログイン状態 - 登録ページ表示を継続');
            }
        }).catch(error => {
            console.error('[RegisterAuthCheck] 認証状態確認エラー:', error);
        });
    }

    // DOMContentLoadedを待つ
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkAuthStatus);
    } else {
        checkAuthStatus();
    }
})();

// ============================================================
// Section: register-referral-handler.js
// ============================================================
// 登録ページでの紹介コード処理
// console.log('=== 登録ページ紹介コード処理 ===');

(function() {
    // 紹介コードを取得（優先順位: URL > Session > Cookie）
    let referralCode = null;

    // 1. URLパラメータから取得
    const urlParams = new URLSearchParams(window.location.search);
    const urlRef = urlParams.get('ref');

    // 2. セッションストレージから取得
    const sessionRef = sessionStorage.getItem('referral_code');

    // 3. Cookieから取得
    const cookieRef = getCookie('referral_code');

    // 優先順位で決定
    referralCode = urlRef || sessionRef || cookieRef;

    if (referralCode) {
        // console.log('[Register] 紹介コード検出:', referralCode);

        // 隠しフィールドに設定
        const referralInput = document.getElementById('referral-code-input');
        if (referralInput) {
            referralInput.value = referralCode;
        } else {
            // 隠しフィールドを作成
            const hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.id = 'referral-code-input';
            hiddenInput.name = 'referral_code';
            hiddenInput.value = referralCode;

            const form = document.getElementById('registerForm');
            if (form) {
                form.appendChild(hiddenInput);
            }
        }

        // 紹介情報を表示
        showReferralInfo(referralCode);
    }
})();

// Cookie取得関数
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

// 紹介情報を表示
function showReferralInfo(code) {
    // 既存の情報があれば削除
    const existingInfo = document.getElementById('referral-info');
    if (existingInfo) {
        existingInfo.remove();
    }

    // 紹介情報HTML
    const infoHTML = `
        <div id="referral-info" class="referral-info">
            <i class="fas fa-gift"></i>
            <span>紹介コード適用中: <strong>${code}</strong></span>
        </div>
    `;

    // フォームの上に挿入
    const form = document.getElementById('registerForm');
    if (form) {
        form.insertAdjacentHTML('beforebegin', infoHTML);
    }

    // スタイルを追加
    if (!document.getElementById('referral-info-styles')) {
        const styles = `
            <style id="referral-info-styles">
                .referral-info {
                    background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
                    color: white;
                    padding: 1rem 1.5rem;
                    border-radius: 12px;
                    margin-bottom: 1.5rem;
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    box-shadow: 0 4px 12px rgba(79, 172, 254, 0.3);
                    animation: slideIn 0.5s ease-out;
                }

                .referral-info i {
                    font-size: 1.5rem;
                    opacity: 0.9;
                }

                .referral-info strong {
                    font-weight: 600;
                    background: rgba(255, 255, 255, 0.2);
                    padding: 0.25rem 0.5rem;
                    border-radius: 6px;
                    font-family: monospace;
                }

                @keyframes slideIn {
                    from {
                        opacity: 0;
                        transform: translateY(-20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
            </style>
        `;
        document.head.insertAdjacentHTML('beforeend', styles);
    }
}

// 旧 window.register ラッパーは削除（auth.js の simulateRegistration と競合していたため）
// 紹介コード処理は registration-unified.js 内の実 submit ハンドラで行われる

// 紹介登録を記録
async function recordReferralRegistration(code, userId) {
    try {
        if (!window.supabaseClient) {
            console.error('[Register] supabaseClientが利用できません');
            return;
        }

        // invite_linksから紹介者情報を取得
        const { data: inviteLink, error: linkError } = await window.supabaseClient
            .from('invite_links')
            .select('id, created_by')
            .eq('link_code', code)
            .maybeSingle();

        if (linkError || !inviteLink) {
            console.error('[Register] 紹介リンク取得エラー:', linkError);
            return;
        }

        // invitationsテーブルに記録
        const { error: invitationError } = await window.supabaseClient
            .from('invitations')
            .insert({
                inviter_id: inviteLink.created_by,
                invitee_email: null, // プライバシー保護
                invitation_code: code,
                status: 'registered',
                accepted_by: userId,
                accepted_at: new Date().toISOString(),
                invite_link_id: inviteLink.id
            });

        if (invitationError) {
            console.error('[Register] 招待記録エラー:', invitationError);
        } else {
            // console.log('[Register] 紹介登録を記録しました');

            // 成功メッセージを表示
            showSuccessMessage('紹介コードが適用されました！');
        }

    } catch (error) {
        console.error('[Register] 紹介登録記録エラー:', error);
    }
}

// 成功メッセージを表示
function showSuccessMessage(message) {
    const messageHTML = `
        <div class="referral-success-message">
            <i class="fas fa-check-circle"></i>
            <span>${message}</span>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', messageHTML);

    // アニメーション後に削除
    setTimeout(() => {
        const messageEl = document.querySelector('.referral-success-message');
        if (messageEl) {
            messageEl.remove();
        }
    }, 3000);

    // スタイルを追加
    if (!document.getElementById('referral-success-styles')) {
        const styles = `
            <style id="referral-success-styles">
                .referral-success-message {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: #10b981;
                    color: white;
                    padding: 1rem 1.5rem;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
                    animation: slideInRight 0.5s ease-out;
                    z-index: 9999;
                }

                .referral-success-message i {
                    font-size: 1.25rem;
                }

                @keyframes slideInRight {
                    from {
                        opacity: 0;
                        transform: translateX(50px);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(0);
                    }
                }
            </style>
        `;
        document.head.insertAdjacentHTML('beforeend', styles);
    }
}

// console.log('=== 登録ページ紹介コード処理準備完了 ===');

// ============================================================
// Section: event-listener-manager.js
// ============================================================
/**
 * Event Listener Manager
 * イベントリスナーの重複を防ぎ、メモリリークを防ぐための統一管理システム
 */

(function() {
    'use strict';

    // イベントリスナーの追跡
    const eventRegistry = new WeakMap();
    const globalListeners = new Map();

    /**
     * 安全にイベントリスナーを追加（重複防止）
     * @param {Element} element - 要素
     * @param {string} event - イベント名
     * @param {Function} handler - ハンドラー関数
     * @param {Object} options - オプション
     * @returns {Function} 削除用の関数
     */
    function addSafeEventListener(element, event, handler, options = {}) {
        if (!element || !event || !handler) return null;

        // 要素ごとのリスナーマップを取得または作成
        let elementListeners = eventRegistry.get(element);
        if (!elementListeners) {
            elementListeners = new Map();
            eventRegistry.set(element, elementListeners);
        }

        // イベントごとのハンドラーセットを取得または作成
        const eventKey = `${event}_${options.capture ? 'capture' : 'bubble'}`;
        let handlers = elementListeners.get(eventKey);
        if (!handlers) {
            handlers = new Set();
            elementListeners.set(eventKey, handlers);
        }

        // 既に同じハンドラーが登録されている場合はスキップ
        if (handlers.has(handler)) {
            // console.log(`[EventManager] Duplicate listener prevented for ${event}`);
            return () => removeSafeEventListener(element, event, handler, options);
        }

        // ハンドラーを登録
        handlers.add(handler);
        element.addEventListener(event, handler, options);

        // 削除用の関数を返す
        return () => removeSafeEventListener(element, event, handler, options);
    }

    /**
     * 安全にイベントリスナーを削除
     */
    function removeSafeEventListener(element, event, handler, options = {}) {
        if (!element || !event || !handler) return;

        const elementListeners = eventRegistry.get(element);
        if (!elementListeners) return;

        const eventKey = `${event}_${options.capture ? 'capture' : 'bubble'}`;
        const handlers = elementListeners.get(eventKey);
        if (!handlers) return;

        if (handlers.has(handler)) {
            handlers.delete(handler);
            element.removeEventListener(event, handler, options);

            // ハンドラーセットが空になったらクリーンアップ
            if (handlers.size === 0) {
                elementListeners.delete(eventKey);
            }

            // 要素のリスナーマップが空になったらクリーンアップ
            if (elementListeners.size === 0) {
                eventRegistry.delete(element);
            }
        }
    }

    /**
     * 委譲イベントリスナーの追加（パフォーマンス最適化）
     */
    function addDelegatedListener(parentSelector, eventType, childSelector, handler) {
        const parent = typeof parentSelector === 'string'
            ? document.querySelector(parentSelector)
            : parentSelector;

        if (!parent) return null;

        const delegatedHandler = function(e) {
            const target = e.target.closest(childSelector);
            if (target && parent.contains(target)) {
                handler.call(target, e);
            }
        };

        // グローバルリスナーとして登録
        const key = `${parentSelector}_${eventType}_${childSelector}`;
        if (globalListeners.has(key)) {
            // console.log(`[EventManager] Delegated listener already exists for ${key}`);
            return globalListeners.get(key).remove;
        }

        const removeFunc = addSafeEventListener(parent, eventType, delegatedHandler);
        globalListeners.set(key, { handler: delegatedHandler, remove: removeFunc });

        return removeFunc;
    }

    /**
     * DOMContentLoadedの重複を防ぐ
     */
    let domReadyHandlers = [];
    let domReady = false;

    function onDOMReady(handler) {
        if (domReady || document.readyState === 'complete' || document.readyState === 'interactive') {
            // 既にDOMが準備できている場合は即座に実行
            setTimeout(handler, 0);
        } else {
            domReadyHandlers.push(handler);
        }
    }

    // DOMContentLoadedを一度だけ登録
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            domReady = true;
            domReadyHandlers.forEach(handler => {
                try {
                    handler();
                } catch (e) {
                    console.error('[EventManager] Error in DOMReady handler:', e);
                }
            });
            domReadyHandlers = [];
        }, { once: true });
    } else {
        domReady = true;
    }

    /**
     * ページアンロード時のクリーンアップ
     */
    window.addEventListener('beforeunload', function() {
        // グローバルリスナーをクリーンアップ
        globalListeners.forEach(listener => {
            if (listener.remove) {
                listener.remove();
            }
        });
        globalListeners.clear();
    }, { once: true });

    /**
     * ユーティリティ：一度だけ実行されるイベントリスナー
     */
    function addOnceListener(element, event, handler, options = {}) {
        const onceHandler = function(e) {
            handler.call(this, e);
            removeSafeEventListener(element, event, onceHandler, options);
        };
        return addSafeEventListener(element, event, onceHandler, options);
    }

    /**
     * デバウンス付きイベントリスナー
     */
    function addDebouncedListener(element, event, handler, delay = 300, options = {}) {
        let timeoutId;
        const debouncedHandler = function(e) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => handler.call(this, e), delay);
        };
        return addSafeEventListener(element, event, debouncedHandler, options);
    }

    /**
     * スロットル付きイベントリスナー
     */
    function addThrottledListener(element, event, handler, limit = 300, options = {}) {
        let inThrottle;
        const throttledHandler = function(e) {
            if (!inThrottle) {
                handler.call(this, e);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
        return addSafeEventListener(element, event, throttledHandler, options);
    }

    // グローバルAPI公開
    window.EventManager = {
        add: addSafeEventListener,
        remove: removeSafeEventListener,
        delegate: addDelegatedListener,
        once: addOnceListener,
        debounce: addDebouncedListener,
        throttle: addThrottledListener,
        onReady: onDOMReady
    };

    // EventTarget.prototypeの上書きは危険なので削除
    // グローバルな影響を避けるため、必要な要素に対して個別にイベントリスナーを管理する
    // これによりシステム全体への予期しない影響を防ぐ

    // console.log('[EventManager] Event listener management system initialized');
})();

// ============================================================
// Section: register-enhanced-validation.js
// ============================================================
/**
 * Register Enhanced Validation
 * 新規登録ページの強化されたバリデーション機能
 */

(function() {
    'use strict';

    // console.log('[RegisterEnhancedValidation] 初期化開始');

    // 現在のステップ
    let currentStep = 1;

    // 文字数カウンター更新
    // この関数は無効化（register-char-count.js で統一処理）
    // function updateCharCount(textarea) {
    //     // 何もしない（register-char-count.js が処理）
    //     return;
    // }

    // 「現状課題なし」チェックボックスの処理（排他制御）
    function handleNoChallengeCheckbox(checkbox) {
        const group = checkbox.closest('.challenge-group');
        const otherCheckboxes = group.querySelectorAll('input[type="checkbox"][name="challenges"]:not([data-exclusive])');

        if (checkbox.checked) {
            otherCheckboxes.forEach(cb => {
                cb.checked = false;
            });
        }
    }

    // 課題チェックボックスの処理（排他制御）
    function handleChallengeCheckbox(checkbox) {
        const group = checkbox.closest('.challenge-group');
        const exclusiveCheckbox = group.querySelector('input[data-exclusive]');

        if (exclusiveCheckbox && exclusiveCheckbox.checked) {
            exclusiveCheckbox.checked = false;
        }
    }

    // バリデーション
    function validateStep(step) {
        const stepElement = document.querySelector(`.form-step[data-step="${step}"]`);
        if (!stepElement) return true;

        const errors = [];

        // 必須フィールドのチェック
        const requiredFields = stepElement.querySelectorAll('[data-required="true"]:not(:disabled)');
        requiredFields.forEach(field => {
            if (field.tagName === 'TEXTAREA') {
                const minLength = parseInt(field.getAttribute('minlength') || '0');
                if (field.value.trim().length < minLength) {
                    errors.push(`${field.closest('.form-group').querySelector('label').textContent.replace('*', '').trim()}は${minLength}文字以上で入力してください`);
                }
            } else if (field.type === 'checkbox') {
                if (!field.checked) {
                    errors.push('利用規約に同意してください');
                }
            } else if (field.type === 'file') {
                if (!field.files || field.files.length === 0) {
                    errors.push(`${field.closest('.form-group').querySelector('label').textContent.replace('*', '').trim()}を選択してください`);
                }
            } else {
                if (!field.value.trim()) {
                    errors.push(`${field.closest('.form-group').querySelector('label').textContent.replace('*', '').trim()}を入力してください`);
                }
            }
        });

        // ステップ2の特別なバリデーション
        if (step === 2) {
            const challengeGroups = stepElement.querySelectorAll('.challenge-group');
            challengeGroups.forEach(group => {
                const exclusiveChecked = group.querySelector('input[data-exclusive]:checked');
                const otherChallengesChecked = group.querySelectorAll('input[name="challenges"]:checked:not([data-exclusive])');

                if (!exclusiveChecked && otherChallengesChecked.length === 0) {
                    const groupTitle = group.querySelector('h4').textContent.trim();
                    errors.push(`${groupTitle}で項目を選択するか「現状課題なし」を選択してください`);
                }
            });

            // 予算の検証（任意、入力時のみフォーマットチェック）
            const budgetInput = stepElement.querySelector('#budget');
            if (budgetInput && budgetInput.value.trim() && !/^\d+$/.test(budgetInput.value.trim())) {
                errors.push('年間予算規模は数字のみで入力してください');
            }
        }

        // ステップ4の特別なバリデーション（PR欄）
        if (step === 4) {
            const checkedSkills = stepElement.querySelectorAll('input[name="skills"]:checked');
            const prTextarea = stepElement.querySelector('#skills-pr');
            // スキル選択時またはPR入力済みの場合のみ100文字チェック
            if (prTextarea && prTextarea.value.trim().length > 0 && prTextarea.value.trim().length < 100) {
                errors.push('スキル・専門分野のPRは100文字以上で入力してください');
            } else if (checkedSkills.length > 0 && prTextarea && prTextarea.value.trim().length < 100) {
                errors.push('スキルを選択した場合、PRは100文字以上で入力してください');
            }
        }

        // ステップ5の特別なバリデーション（詳細欄）
        if (step === 5) {
            const detailsTextarea = stepElement.querySelector('#interests-details');
            if (detailsTextarea && detailsTextarea.value.trim().length < 100) {
                errors.push('興味・困りごとの詳細は100文字以上で入力してください');
            }
        }

        // エラー表示
        if (errors.length > 0) {
            if (window.showToast) window.showToast(errors.join('、'), 'error');
            return false;
        }

        return true;
    }

    // 初期化
    function init() {
        // 文字数カウンターの初期化は無効化（register-char-count.jsが処理）

        // 初期状態のチェック - 「現状課題なし」がチェックされていたら処理
        document.querySelectorAll('input[data-exclusive]').forEach(checkbox => {
            if (checkbox.checked) {
                handleNoChallengeCheckbox(checkbox);
            }
        });

        // チェックボックスのイベントリスナー
        document.addEventListener('change', function(e) {
            if (e.target.matches('input[type="checkbox"][name="challenges"]')) {
                if (e.target.dataset.exclusive) {
                    handleNoChallengeCheckbox(e.target);
                } else {
                    handleChallengeCheckbox(e.target);
                }
            }
        });

        // 予算フィールドの数字のみ入力制限
        const budgetInput = document.getElementById('budget');
        if (budgetInput) {
            budgetInput.addEventListener('input', function() {
                this.value = this.value.replace(/[^\d]/g, '');
            });
        }

        // グローバル関数として公開
        window.validateStep = validateStep;
    }

    // DOMContentLoadedで初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // console.log('[RegisterEnhancedValidation] 初期化完了');

})();

// ============================================================
// Section: register-strict-validation.js
// ============================================================
/**
 * Register Strict Validation
 * 登録フォームの厳密なバリデーションとボタン制御
 */

(function() {
    'use strict';

    // console.log('[RegisterStrictValidation] 初期化開始');

    // バリデーション状態を管理
    const validationState = {
        step1: {
            name: false,
            company: false,
            industry: false,
            email: false,
            password: false,
            passwordConfirm: false
        },
        step2: {
            challenges: false
        },
        step3: {
            phone: false,
            lineId: false,
            lineQr: false,
            position: false
        },
        step4: {
            skillsPr: false
        },
        step5: {
            interestsDetails: false,
            agree: false
        }
    };

    // ステップごとの必須チェック項目
    const stepRequirements = {
        1: ['name', 'company', 'industry', 'email', 'password', 'passwordConfirm'],
        2: ['challenges'],
        3: ['phone', 'lineId', 'lineQr', 'position'],
        4: ['skillsPr'],
        5: ['interestsDetails', 'agree']
    };

    // 現在のステップのバリデーション状態をチェック
    function isStepValid(stepNum) {
        const requirements = stepRequirements[stepNum];
        if (!requirements) return false;

        const stepKey = `step${stepNum}`;
        const stepState = validationState[stepKey];

        // ステップ2の特別処理
        if (stepNum === 2) {
            // 各カテゴリで何か選択されているかチェック
            const challengeGroups = document.querySelectorAll('.form-step[data-step="2"] .challenge-group');
            for (const group of challengeGroups) {
                const anyChecked = group.querySelectorAll('input[name="challenges"]:checked');
                if (anyChecked.length === 0) return false;
            }
            return true;
        }

        // その他のステップは全ての必須項目をチェック
        return requirements.every(req => stepState[req]);
    }

    // ボタンの有効/無効を切り替え
    function updateButtonState(stepNum) {
        const stepElement = document.querySelector(`.form-step[data-step="${stepNum}"]`);
        if (!stepElement) return;

        const nextButton = stepElement.querySelector('.auth-button:not(.auth-button-outline)');
        if (!nextButton || nextButton.type === 'submit') return;

        const isValid = isStepValid(stepNum);

        // console.log(`[RegisterStrictValidation] Step ${stepNum} validation:`, {
        //     isValid,
        //     state: validationState[`step${stepNum}`]
        // });

        if (isValid) {
            nextButton.disabled = false;
            nextButton.classList.remove('disabled');
            nextButton.style.opacity = '1';
            nextButton.style.cursor = 'pointer';
        } else {
            nextButton.disabled = true;
            nextButton.classList.add('disabled');
            nextButton.style.opacity = '0.5';
            nextButton.style.cursor = 'not-allowed';
        }
    }

    // フィールドのバリデーション
    function validateField(field) {
        const stepElement = field.closest('.form-step');
        if (!stepElement) return;

        const stepNum = parseInt(stepElement.getAttribute('data-step'));
        const stepKey = `step${stepNum}`;
        let fieldKey = '';
        let isValid = false;

        // フィールドタイプごとの処理
        switch (field.id) {
            case 'name':
            case 'company':
                fieldKey = field.id;
                isValid = field.value.trim().length > 0;
                break;

            case 'industry':
                fieldKey = 'industry';
                isValid = field.value.trim().length > 0;
                break;

            case 'email':
                fieldKey = 'email';
                isValid = field.value.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field.value);
                break;

            case 'password':
                fieldKey = 'password';
                isValid = field.value.length >= 8;
                // パスワード変更時は確認フィールドも再検証
                const confirmField = document.getElementById('password-confirm');
                if (confirmField && confirmField.value) {
                    validateField(confirmField);
                }
                break;

            case 'password-confirm':
                fieldKey = 'passwordConfirm';
                const passwordField = document.getElementById('password');
                isValid = field.value.length >= 8 && field.value === passwordField.value;
                break;

            case 'budget':
                fieldKey = 'budget';
                isValid = /^\d+$/.test(field.value.trim()) && parseInt(field.value) > 0;
                break;

            case 'phone':
                fieldKey = 'phone';
                // 日本の電話番号形式（ハイフンあり/なし対応）
                const phoneDigits = field.value.replace(/[-\s]/g, '');
                isValid = /^0[0-9]{9,10}$/.test(phoneDigits);
                break;

            case 'line-id':
                fieldKey = 'lineId';
                isValid = field.value.trim().length > 0;
                break;

            case 'line-qr':
                fieldKey = 'lineQr';
                isValid = field.files && field.files.length > 0;
                break;

            case 'position':
                fieldKey = 'position';
                isValid = field.value.trim().length > 0;
                break;

            case 'skills-pr':
                fieldKey = 'skillsPr';
                isValid = field.value.trim().length >= 100;
                break;

            case 'interests-details':
                fieldKey = 'interestsDetails';
                isValid = field.value.trim().length >= 100;
                break;
        }

        if (fieldKey && validationState[stepKey]) {
            validationState[stepKey][fieldKey] = isValid;
        }

        updateButtonState(stepNum);
    }

    // チェックボックスのバリデーション
    function validateCheckboxes(stepNum) {
        const stepElement = document.querySelector(`.form-step[data-step="${stepNum}"]`);
        if (!stepElement) return;

        if (stepNum === 2) {
            // 各課題グループで少なくとも1つチェックされているか確認
            const groups = stepElement.querySelectorAll('.challenge-group');
            let allGroupsValid = true;

            groups.forEach(group => {
                const checkedBoxes = group.querySelectorAll('input[name="challenges"]:checked');
                if (checkedBoxes.length === 0) {
                    allGroupsValid = false;
                }
            });

            validationState.step2.challenges = allGroupsValid;
        } else if (stepNum === 4) {
            // スキルチェックボックスの確認
            const skillCheckboxes = stepElement.querySelectorAll('input[name="skills"]:checked');
            // スキルは任意なので、チェックボックスの状態は確認しない
            // ただし、スキルPRテキストエリアは必須なので、その状態はvalidateFieldで処理される
        } else if (stepNum === 5) {
            // 興味・関心チェックボックスの確認
            const interestCheckboxes = stepElement.querySelectorAll('input[name="interests"]:checked');
            // 興味・関心も任意なので、チェックボックスの状態は確認しない

            // 利用規約の同意
            const agreeCheckbox = stepElement.querySelector('input[name="agree"]');
            validationState.step5.agree = agreeCheckbox && agreeCheckbox.checked;
        }

        updateButtonState(stepNum);
    }

    // リアルタイム文字数カウンターの更新（register-char-count.jsと重複するため無効化）
    /*
    function updateCharCounter(textarea) {
        // IDベースでカウント要素を特定（より確実）
        const idMap = {
            'revenue-details': 'revenue-count',
            'hr-details': 'hr-count',
            'dx-details': 'dx-count',
            'strategy-details': 'strategy-count',
            'skills-pr': 'skills-pr-count',
            'interests-details': 'interests-details-count'
        };

        const countId = idMap[textarea.id];
        let countElement = countId ? document.getElementById(countId) : null;

        if (!countElement) {
            // フォールバック: 親要素から探す
            const countSpan = textarea.parentElement.querySelector('.char-count span');
            if (countSpan) {
                countElement = countSpan;
            } else {
                return;
            }
        }

        const currentLength = textarea.value.trim().length;
        const minLength = parseInt(textarea.getAttribute('minlength') || '0');

        countElement.textContent = currentLength;

        // 文字数に応じてスタイルを変更
        const charCountElement = countElement.closest('.char-count');
        if (charCountElement) {
            if (currentLength >= minLength) {
                charCountElement.style.color = '#10b981'; // 緑
            } else {
                charCountElement.style.color = '#ef4444'; // 赤
            }
        }

        // バリデーション実行
        validateField(textarea);
    }
    */

    // nextStep実行前のバリデーションフック
    // global-functions.jsのnextStepに処理を委譲
    // 既にwindow.nextStepValidationが定義されていない場合のみ設定
    if (!window.nextStepValidation) {
        window.nextStepValidation = function() {
            const currentStepElement = document.querySelector('.form-step.active');
            if (!currentStepElement) return false;

            const currentStepNum = parseInt(currentStepElement.getAttribute('data-step'));

            // 厳密なバリデーションチェック
            if (!isStepValid(currentStepNum)) {
                // エラーメッセージを表示
                const errors = [];
                const stepKey = `step${currentStepNum}`;
                const stepState = validationState[stepKey];

                // 各フィールドのエラーをチェック
                Object.keys(stepState).forEach(key => {
                    if (!stepState[key]) {
                        switch(key) {
                            case 'name': errors.push('お名前を入力してください'); break;
                            case 'company': errors.push('会社名を入力してください'); break;
                            case 'industry': errors.push('業種を選択してください'); break;
                            case 'email': errors.push('有効なメールアドレスを入力してください'); break;
                            case 'password': errors.push('パスワードは8文字以上で入力してください'); break;
                            case 'passwordConfirm': errors.push('パスワードが一致しません'); break;
                            case 'challenges': errors.push('各カテゴリーで少なくとも1つの課題を選択してください'); break;
                            case 'phone': errors.push('有効な電話番号を入力してください（例: 090-1234-5678）'); break;
                            case 'lineId': errors.push('LINE IDまたはURLを入力してください'); break;
                            case 'lineQr': errors.push('LINE QRコードをアップロードしてください'); break;
                            case 'position': errors.push('役職を入力してください'); break;
                            case 'skillsPr': errors.push('スキル・専門分野のPRを100文字以上で入力してください'); break;
                            case 'interestsDetails': errors.push('興味・困りごとの詳細を100文字以上で入力してください'); break;
                            case 'agree': errors.push('利用規約に同意してください'); break;
                        }
                    }
                });

                if (errors.length > 0) {
                    if (window.showToast) window.showToast('以下の項目を確認してください：' + errors.join('、'), 'error');
                    return false;
                }
            }

            // バリデーション成功を返す
            return true;
        };
    }

    // 初期化
    function init() {
        // 全てのステップのボタンを初期状態に設定
        // 初期状態では無効化しない（ユーザーが入力を始めてからバリデーション開始）
        // for (let i = 1; i <= 5; i++) {
        //     updateButtonState(i);
        // }

        // テキストフィールドとselectのイベントリスナー
        document.querySelectorAll('input[type="text"], input[type="email"], input[type="password"], input[type="tel"], select').forEach(field => {
            field.addEventListener('input', () => validateField(field));
            field.addEventListener('change', () => validateField(field));
            field.addEventListener('blur', () => validateField(field));
        });

        // budgetフィールド専用の処理（確実にイベントリスナーを追加）
        const budgetField = document.getElementById('budget');
        if (budgetField) {
            // console.log('[RegisterStrict] Adding validation to budget field');
            budgetField.addEventListener('input', () => validateField(budgetField));
            budgetField.addEventListener('blur', () => validateField(budgetField));
        }

        // テキストエリアのイベントリスナー
        // register-char-count.jsで処理するため、ここではバリデーションのみ
        // ただし、register-char-count.jsで既にcloneNodeしているので、ここでは追加しない

        // チェックボックスのイベントリスナー
        document.addEventListener('change', function(e) {
            if (e.target.matches('input[type="checkbox"][name="challenges"]')) {
                validateCheckboxes(2);
                updateButtonState(2);
            } else if (e.target.matches('input[name="skills"]')) {
                // スキルチェックボックスの変更時
                validateCheckboxes(4);
            } else if (e.target.matches('input[name="interests"]')) {
                // 興味・関心チェックボックスの変更時
                validateCheckboxes(5);
            } else if (e.target.matches('input[name="agree"]')) {
                // 利用規約の同意チェックボックス
                validateCheckboxes(5);
            }
        });

        // ファイル入力のイベントリスナー
        const fileInput = document.getElementById('line-qr');
        if (fileInput) {
            fileInput.addEventListener('change', () => validateField(fileInput));
        }

        // 初期バリデーション実行を削除（ユーザーが入力を始めてからバリデーション開始）
        // 値がすでに入力されているフィールドのみバリデーション実行
        document.querySelectorAll('.form-step.active input, .form-step.active textarea').forEach(field => {
            // 値がある場合のみバリデーション実行
            if (field.value && field.value.trim().length > 0) {
                validateField(field);
            }
        });

        // チェックボックスの初期状態も値がある場合のみ確認
        const activeStep = document.querySelector('.form-step.active');
        if (activeStep) {
            const stepNum = parseInt(activeStep.getAttribute('data-step'));
            // チェックボックスが選択されている場合のみバリデーション
            const hasChecked = activeStep.querySelector('input[type="checkbox"]:checked');
            if (hasChecked && (stepNum === 2 || stepNum === 5)) {
                validateCheckboxes(stepNum);
            }
        }

    }

    // DOMContentLoadedで初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // console.log('[RegisterStrictValidation] 初期化完了');

})();

// ============================================================
// Section: register-char-count.js
// ============================================================
/**
 * 登録フォームの文字カウント機能
 */

document.addEventListener('DOMContentLoaded', function() {
    // デバッグ用
    const DEBUG = false;
    // console.log('[CharCount] Initializing character count feature...');
    // console.log('[CharCount] DOMContentLoaded at:', new Date().toISOString());

    // 文字カウントが必要な要素の設定
    const charCountFields = [
        { id: 'skills-pr', countId: 'skills-pr-count', min: 100 },
        { id: 'interests-details', countId: 'interests-details-count', min: 100 }
    ];

    // 各フィールドにイベントリスナーを設定
    charCountFields.forEach(field => {
        const textarea = document.getElementById(field.id);
        const countElement = document.getElementById(field.countId);

        /* if (DEBUG) console.log(`[CharCount] Setting up ${field.id}:`, {
            textarea: !!textarea,
            countElement: !!countElement,
            textareaId: field.id,
            countId: field.countId,
            textareaDisabled: textarea ? textarea.disabled : 'N/A'
        }); */

        if (textarea && countElement) {
            updateCharCount(textarea, countElement, field.min);
            // console.log(`[CharCount] Initial count set for ${field.id}`);

            // 既存のイベントリスナーをクリアしてから新規追加
            // ただしcloneNodeは使わない（disabled状態もコピーされるため）

            // 既存のイベントリスナーを上書き
            const inputHandler = function(e) {
                // console.log(`[CharCount] Input event triggered for ${field.id}, length: ${this.value.length}`);
                const count = document.getElementById(field.countId);
                if (count) {
                    updateCharCount(this, count, field.min);
                    // console.log(`[CharCount] Updated count display to: ${this.value.length}`);
                } else {
                    // console.error(`[CharCount] Count element not found: ${field.countId}`);
                }
                // ローカルのバリデーション関数を呼び出し
                validateCharCountStep();
            };

            // inputイベントを両方の方法で設定（確実性のため）
            textarea.oninput = inputHandler;
            textarea.addEventListener('input', inputHandler);

            // デバッグ: リスナー追加後の確認
            // console.log(`[CharCount] Added input listener to ${field.id}, disabled: ${textarea.disabled}`);

            // デバッグ: getEventListenersがある場合は確認
            // if (typeof getEventListeners !== 'undefined') {
            //     // console.log(`[CharCount] Current listeners on ${field.id}:`, getEventListeners(textarea));
            // }

            // キーアップイベントは削除（inputイベントで十分）
        } else {
            if (DEBUG) console.error(`[CharCount] Missing elements for ${field.id}:`, {
                textarea: textarea,
                countElement: countElement
            });
        }
    });

    // 文字カウント更新関数
    function updateCharCount(textarea, countElement, minLength) {
        const currentLength = textarea.value.trim().length;
        countElement.textContent = currentLength;
        // console.log(`[updateCharCount] Setting ${countElement.id} to ${currentLength}`);

        // 親要素の.char-countを取得
        const charCountWrapper = countElement.closest('.char-count');
        if (charCountWrapper) {
            // textareaがdisabledの場合は非表示
            if (textarea.disabled) {
                charCountWrapper.style.display = 'none';
                return;
            } else {
                charCountWrapper.style.display = '';
            }

            // 初期状態（0文字）の場合はエラークラスを付けない
            if (currentLength === 0) {
                charCountWrapper.classList.remove('error');
                charCountWrapper.classList.remove('success');
            } else if (currentLength >= minLength) {
                charCountWrapper.classList.remove('error');
                charCountWrapper.classList.add('success');
            } else {
                charCountWrapper.classList.remove('success');
                charCountWrapper.classList.add('error');
            }
        }
    }

    // ステップバリデーション関数（ローカル用）
    function validateCharCountStep() {
        const activeStep = document.querySelector('.form-step.active');
        if (!activeStep) return;

        const stepNumber = activeStep.dataset.step;
        let isValid = true;

        // ステップごとのバリデーション
        switch(stepNumber) {
            case '1':
                // 基本情報
                isValid = validateBasicInfo();
                break;
            case '2':
                // 事業課題
                isValid = validateChallenges();
                break;
            case '3':
                // 連絡先
                isValid = validateContact();
                break;
            case '4':
                // スキル
                isValid = validateSkills();
                break;
            case '5':
                // 興味・関心
                isValid = validateInterests();
                break;
        }

        // 次へボタンの有効/無効切り替え
        const nextButton = activeStep.querySelector('.auth-button:not(.auth-button-outline)');
        if (nextButton && nextButton.textContent.includes('次へ')) {
            if (isValid) {
                nextButton.disabled = false;
                nextButton.classList.remove('disabled');
                nextButton.style.opacity = '';
                nextButton.style.cursor = '';
            } else {
                nextButton.disabled = true;
                nextButton.classList.add('disabled');
                nextButton.style.opacity = '0.5';
                nextButton.style.cursor = 'not-allowed';
            }
        }
    }

    // 基本情報のバリデーション
    function validateBasicInfo() {
        const requiredFields = ['name', 'company', 'industry', 'email', 'password', 'password-confirm'];
        let isValid = true;

        requiredFields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (!field || !field.value.trim()) {
                isValid = false;
            }
        });

        // パスワード一致確認
        const password = document.getElementById('password');
        const passwordConfirm = document.getElementById('password-confirm');
        if (password && passwordConfirm && password.value !== passwordConfirm.value) {
            isValid = false;
        }

        // メールアドレスの形式確認
        const email = document.getElementById('email');
        if (email && !isValidEmail(email.value)) {
            isValid = false;
        }

        return isValid;
    }

    // 事業課題のバリデーション
    function validateChallenges() {
        // 各カテゴリで少なくとも1つチェックされているか確認
        const challengeGroups = document.querySelectorAll('.form-step[data-step="2"] .challenge-group');
        for (const group of challengeGroups) {
            if (group.querySelectorAll('input[name="challenges"]:checked').length === 0) {
                return false;
            }
        }
        return true;
    }

    // 連絡先のバリデーション
    function validateContact() {
        const requiredFields = ['phone', 'line-id', 'position'];
        let isValid = true;

        requiredFields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (!field || !field.value.trim()) {
                isValid = false;
            }
        });

        // ファイルアップロードのチェック
        const fileInput = document.getElementById('line-qr');
        if (fileInput && !fileInput.files.length) {
            isValid = false;
        }

        return isValid;
    }

    // スキルのバリデーション
    function validateSkills() {
        const checkedSkills = document.querySelectorAll('input[name="skills"]:checked');

        // スキルが選択されている場合のみPRテキスト必須
        if (checkedSkills.length > 0) {
            const skillsPr = document.getElementById('skills-pr');
            if (!skillsPr || skillsPr.value.trim().length < 100) {
                return false;
            }
        }

        // PRテキストが入力されている場合は文字数チェック
        const skillsPr = document.getElementById('skills-pr');
        if (skillsPr && skillsPr.value.trim().length > 0 && skillsPr.value.trim().length < 100) {
            return false;
        }

        return true;
    }

    // 興味・関心のバリデーション
    function validateInterests() {
        // 少なくとも1つの興味が選択されているか
        const checkedInterests = document.querySelectorAll('input[name="interests"]:checked');
        if (checkedInterests.length === 0) {
            return false;
        }

        // 詳細テキストの文字数チェック
        const interestsDetails = document.getElementById('interests-details');
        if (!interestsDetails || interestsDetails.value.trim().length < 100) {
            return false;
        }

        // 利用規約への同意
        const agreeCheckbox = document.querySelector('input[name="agree"]');
        if (!agreeCheckbox || !agreeCheckbox.checked) {
            return false;
        }

        return true;
    }

    // ステップ2: 「現状課題なし」排他制御 + バリデーション更新
    document.querySelectorAll('input[name="challenges"]').forEach(cb => {
        cb.addEventListener('change', function() {
            const group = this.closest('.challenge-group');
            if (!group) return;

            if (this.dataset.exclusive && this.checked) {
                // 「現状課題なし」が選択 → 同グループの他を解除
                group.querySelectorAll('input[name="challenges"]:not([data-exclusive])').forEach(other => {
                    other.checked = false;
                });
            } else if (!this.dataset.exclusive && this.checked) {
                // 具体的な課題が選択 → 同グループの「現状課題なし」を解除
                const exclusive = group.querySelector('input[data-exclusive]');
                if (exclusive) exclusive.checked = false;
            }

            // ステップ2全体のバリデーション更新
            const allGroups = document.querySelectorAll('.form-step[data-step="2"] .challenge-group');
            let allValid = true;
            allGroups.forEach(g => {
                if (g.querySelectorAll('input[name="challenges"]:checked').length === 0) {
                    allValid = false;
                }
            });
            validationState.step2.challenges = allValid;
            updateButtonState(2);
        });
    });

    // ステップ4・5のバリデーション状態をリアルタイム更新
    const skillsPrField = document.getElementById('skills-pr');
    if (skillsPrField) {
        skillsPrField.addEventListener('input', function() {
            validationState.step4.skillsPr = validateSkills();
            updateButtonState(4);
        });
    }
    document.querySelectorAll('input[name="skills"]').forEach(cb => {
        cb.addEventListener('change', function() {
            validationState.step4.skillsPr = validateSkills();
            updateButtonState(4);
        });
    });

    const interestsDetailsField = document.getElementById('interests-details');
    if (interestsDetailsField) {
        interestsDetailsField.addEventListener('input', function() {
            validationState.step5.interestsDetails = this.value.trim().length >= 100;
            updateButtonState(5);
        });
    }
    document.querySelectorAll('input[name="interests"]').forEach(cb => {
        cb.addEventListener('change', function() {
            validationState.step5.interestsDetails = validateInterests();
            updateButtonState(5);
        });
    });
    const agreeCheckbox = document.querySelector('input[name="agree"]');
    if (agreeCheckbox) {
        agreeCheckbox.addEventListener('change', function() {
            validationState.step5.agree = this.checked;
            updateButtonState(5);
        });
    }

    // メールアドレスの形式確認
    function isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // 全ての入力フィールドに対してイベントリスナーを設定（textareaは除く、上で既に設定済み）
    const allInputs = document.querySelectorAll('#registerForm input:not([type="file"]), #registerForm select');
    allInputs.forEach(input => {
        input.addEventListener('input', validateCharCountStep);
        input.addEventListener('change', validateCharCountStep);
    });

    // 初期バリデーション実行を無効化（ユーザーが入力を始めてからバリデーション開始）
    // validateStep();

    // 初期表示は上で既に実行済みなので、ここでは重複実行しない

    // ファイルアップロード処理
    const fileInput = document.getElementById('line-qr');
    const filePreview = document.getElementById('qr-preview');
    // 選択されたQRファイルをグローバルに保持（signUp後にアップロード）
    window._selectedLineQrFile = null;

    if (fileInput && filePreview) {
        fileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                // ファイルサイズチェック（5MB以下）
                if (file.size > 5 * 1024 * 1024) {
                    if (window.showToast) window.showToast('ファイルサイズは5MB以下にしてください', 'error');
                    fileInput.value = '';
                    window._selectedLineQrFile = null;
                    return;
                }

                // ファイルタイプチェック
                if (!file.type.match(/^image\/(png|jpg|jpeg)$/i)) {
                    if (window.showToast) window.showToast('PNG、JPG、JPEG形式の画像をアップロードしてください', 'error');
                    fileInput.value = '';
                    window._selectedLineQrFile = null;
                    return;
                }

                // ファイル参照を保存
                window._selectedLineQrFile = file;

                // プレビュー表示
                const reader = new FileReader();
                reader.onload = function(e) {
                    filePreview.innerHTML = `<img src="${e.target.result}" alt="QRコードプレビュー">`;
                };
                reader.readAsDataURL(file);

                // ラベルテキスト更新
                const label = document.querySelector('label[for="line-qr"] span');
                if (label) {
                    label.textContent = file.name;
                }
            } else {
                window._selectedLineQrFile = null;
            }

            // バリデーション更新
            validateCharCountStep();
        });
    }
});

// ============================================================
// Section: registration-flow.js
// ============================================================
// Enhanced Registration Flow with Profile Integration

// 名前空間を使用してグローバル汚染を防ぐ
window.InterConnect = window.InterConnect || {};
window.InterConnect.Registration = {
    currentStep: 1,

    nextStep: function() {
        const currentStepElement = document.querySelector('.form-step.active');
        if (!currentStepElement) return;

        const currentStepNum = parseInt(currentStepElement.getAttribute('data-step'));

        if (window.InterConnect.Registration.validateCurrentStep(currentStepNum)) {
            window.InterConnect.Registration.moveToStep(currentStepNum + 1);
        }
    },

    prevStep: function() {
        const currentStepElement = document.querySelector('.form-step.active');
        if (!currentStepElement) return;

        const currentStepNum = parseInt(currentStepElement.getAttribute('data-step'));
        window.InterConnect.Registration.moveToStep(currentStepNum - 1);
    }
};

// global-functions.js の nextStep と連携するため、
// InterConnect.Registration の関数をグローバルからも呼べるようにする
// 関数が定義された後に設定されるように後で移動

// 関数を名前空間内に移動
window.InterConnect.Registration.moveToStep = function(step) {
    const currentStepElement = document.querySelector('.form-step.active');
    if (!currentStepElement) return;

    const currentStepNum = parseInt(currentStepElement.getAttribute('data-step'));

    if (step < 1 || step > 5) return;

    // 現在のステップを非表示
    const currentStep = document.querySelector(`.form-step[data-step="${currentStepNum}"]`);
    const currentProgress = document.querySelector(`.progress-step[data-step="${currentStepNum}"]`);

    if (currentStep) {
        currentStep.classList.remove('active');
        // 非アクティブなステップのrequired属性を一時的に無効化
        currentStep.querySelectorAll('[required]').forEach(field => {
            field.setAttribute('data-required', 'true');
            field.removeAttribute('required');
        });
    }
    if (currentProgress) currentProgress.classList.remove('active');

    // 完了したステップをマーク
    if (step > currentStepNum && currentProgress) {
        currentProgress.classList.add('completed');
    }

    // 新しいステップを表示
    const newStep = document.querySelector(`.form-step[data-step="${step}"]`);
    const progressStep = document.querySelector(`.progress-step[data-step="${step}"]`);

    if (newStep) {
        newStep.classList.add('active');
        // アクティブなステップのrequired属性を復元
        newStep.querySelectorAll('[data-required="true"]').forEach(field => {
            field.setAttribute('required', '');
            field.removeAttribute('data-required');
        });
    }
    if (progressStep) progressStep.classList.add('active');

    // アニメーション
    if (newStep) {
        if (step > currentStepNum) {
            newStep.classList.add('slide-right');
        } else {
            newStep.classList.add('slide-left');
        }
    }

    // スクロールトップ
    if (window.scrollTo) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // currentStepを更新
    window.InterConnect.Registration.currentStep = step;
};

// バリデーション関数も名前空間内に移動
window.InterConnect.Registration.validateCurrentStep = function(stepNum) {
    const currentStepElement = document.querySelector(`.form-step[data-step="${stepNum}"]`);
    if (!currentStepElement) return false;

    const requiredFields = currentStepElement.querySelectorAll('[required]');
    let isValid = true;

    requiredFields.forEach(field => {
        // 非表示の要素はスキップ
        if (field.offsetParent === null) return;

        if (!field.value.trim()) {
            window.InterConnect.Registration.showFieldError(field, '必須項目です');
            isValid = false;
        } else {
            window.InterConnect.Registration.clearFieldError(field);
        }
    });

    // ステップ固有のバリデーション
    if (stepNum === 1) {
        // メールアドレスの検証
        const email = document.getElementById('email');
        if (email && email.value && !window.InterConnect.Registration.validateEmail(email.value)) {
            window.InterConnect.Registration.showFieldError(email, '有効なメールアドレスを入力してください');
            isValid = false;
        }

        // パスワードの検証
        const password = document.getElementById('password');
        const passwordConfirm = document.getElementById('password-confirm');

        if (password && password.value.length < 8) {
            window.InterConnect.Registration.showFieldError(password, 'パスワードは8文字以上で入力してください');
            isValid = false;
        }

        if (password && passwordConfirm && password.value !== passwordConfirm.value) {
            window.InterConnect.Registration.showFieldError(passwordConfirm, 'パスワードが一致しません');
            isValid = false;
        }
    } else if (stepNum === 2) {
        // 少なくとも1つの課題を選択しているか確認
        const checkedChallenges = currentStepElement.querySelectorAll('input[name="challenges"]:checked');

        if (checkedChallenges.length === 0) {
            window.InterConnect.Registration.showToast('少なくとも1つの事業課題を選択してください', 'error');
            isValid = false;
        }

        // テキストエリアの文字数検証
        const textareas = currentStepElement.querySelectorAll('textarea[minlength]');
        textareas.forEach(textarea => {
            const minLength = parseInt(textarea.getAttribute('minlength'));
            if (textarea.value.trim().length < minLength) {
                window.InterConnect.Registration.showFieldError(textarea, `${minLength}文字以上入力してください`);
                isValid = false;
            }
        });

        // 予算の検証
        const budget = document.getElementById('budget');
        if (budget && (!budget.value || parseInt(budget.value) <= 0)) {
            window.InterConnect.Registration.showFieldError(budget, '有効な金額を入力してください');
            isValid = false;
        }
    }

    // 最初のエラーフィールドにスクロール
    if (!isValid) {
        const firstError = currentStepElement.querySelector('.form-group.error');
        if (firstError) {
            firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    return isValid;
};

// ヘルパー関数も名前空間内に移動

// 関数が定義された後にグローバルに公開
window.validateCurrentStep = window.InterConnect.Registration.validateCurrentStep;
window.moveToStep = window.InterConnect.Registration.moveToStep;
window.InterConnect.Registration.showFieldError = function(field, message) {
    if (!field) return;

    const formGroup = field.closest('.form-group');
    if (!formGroup) return;

    // 既にエラー状態の場合、shakeアニメーションを再トリガー
    if (formGroup.classList.contains('error')) {
        field.style.animation = 'none';
        field.offsetHeight; // reflow強制
        field.style.animation = '';
    }

    formGroup.classList.add('error');

    let errorElement = formGroup.querySelector('.error-message');
    if (!errorElement) {
        errorElement = document.createElement('div');
        errorElement.className = 'error-message';
        formGroup.appendChild(errorElement);
    }
    errorElement.textContent = message;
};

window.InterConnect.Registration.clearFieldError = function(field) {
    if (!field) return;

    const formGroup = field.closest('.form-group');
    if (!formGroup) return;

    formGroup.classList.remove('error');
    const errorElement = formGroup.querySelector('.error-message');
    if (errorElement) {
        errorElement.remove();
    }
};

window.InterConnect.Registration.validateEmail = function(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
};

window.InterConnect.Registration.showToast = function(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `registration-toast ${type}`;

    // アイコンを安全に作成
    const icon = document.createElement('i');
    const iconClass = type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle';
    icon.className = `fas ${iconClass}`;

    // メッセージを安全に作成
    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;

    // 要素を追加
    toast.appendChild(icon);
    toast.appendChild(messageSpan);

    Object.assign(toast.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        background: type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#0066ff',
        color: 'white',
        padding: '16px 24px',
        borderRadius: '12px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        fontSize: '16px',
        fontWeight: '500',
        zIndex: '10000',
        animation: 'slideInRight 0.3s ease'
    });

    if (document.body) {
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => {
                if (document.contains(toast)) {
                    toast.remove();
                }
            }, 300);
        }, 3000);
    }
};

document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('registerForm');
    if (!form) return;

    let currentStep = 1;
    const totalSteps = 5;

    // 招待コードの処理
    const urlParams = new URLSearchParams(window.location.search);
    const inviteCode = urlParams.get('invite') || sessionStorage.getItem('inviteCode');
    const inviterId = sessionStorage.getItem('inviterId');

    if (inviteCode) {
        // console.log('招待コードが検出されました:', inviteCode);
        // 招待情報を表示
        const inviteNotice = document.createElement('div');
        inviteNotice.className = 'invite-notice';
        const safeInviteCode = window.escapeHTML ? window.escapeHTML(inviteCode) : inviteCode.replace(/[<>&"']/g, '');
        inviteNotice.innerHTML = `
            <i class="fas fa-gift"></i>
            <span>招待コードが適用されています: <strong>${safeInviteCode}</strong></span>
        `;
        inviteNotice.style.cssText = `
            background: #f0f9ff;
            border: 1px solid #667eea;
            color: #667eea;
            padding: 12px 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 14px;
        `;

        const authForm = document.querySelector('.auth-form');
        if (authForm && authForm.parentElement) {
            authForm.parentElement.insertBefore(inviteNotice, authForm);
        }
    }

    // 初期化時に非アクティブなステップのrequired属性を無効化
    document.querySelectorAll('.form-step:not(.active)').forEach(step => {
        step.querySelectorAll('[required]').forEach(field => {
            field.setAttribute('data-required', 'true');
            field.removeAttribute('required');
        });
    });

    // スキル管理用の配列
    let selectedSkills = [];

    // 文字数カウント機能は register-char-count.js で統一処理するため無効化
    // registration-flow.js での処理は ID変換ロジックが不完全（skills-prなどに対応できない）
    /*
    const textareas = document.querySelectorAll('textarea[minlength]');
    textareas.forEach(textarea => {
        const counterId = textarea.id ? textarea.id.replace('-details', '-count') : null;
        const counterElement = counterId ? document.getElementById(counterId) : null;

        if (counterElement) {
            const inputHandler = function() {
                const charCount = this.value.length;
                const minLength = parseInt(this.getAttribute('minlength'));
                counterElement.textContent = charCount;

                if (counterElement.parentElement) {
                    const charCountWrapper = counterElement.parentElement;
                    if (charCount >= minLength) {
                        charCountWrapper.classList.add('valid');
                        charCountWrapper.classList.remove('invalid');
                    } else {
                        charCountWrapper.classList.add('invalid');
                        charCountWrapper.classList.remove('valid');
                    }
                }
            };

            textarea.addEventListener('input', inputHandler);

            // イベントリスナーのクリーンアップ用に保存
            textarea._inputHandler = inputHandler;
        }
    });
    */

    // ファイルアップロード機能
    const fileInput = document.getElementById('line-qr');
    const filePreview = document.getElementById('qr-preview');

    if (fileInput && filePreview) {
        fileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];

            if (file) {
                // ファイルサイズチェック（5MB）
                if (file.size > 5 * 1024 * 1024) {
                    window.InterConnect.Registration.showToast('ファイルサイズは5MB以下にしてください', 'error');
                    this.value = '';
                    return;
                }

                // ファイルタイプチェック
                const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg'];
                if (!allowedTypes.includes(file.type.toLowerCase())) {
                    window.InterConnect.Registration.showToast('PNG、JPG、JPEG形式の画像をアップロードしてください', 'error');
                    this.value = '';
                    return;
                }

                // ファイル名の安全性チェック
                const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '');
                if (safeFileName !== file.name) {
                    console.warn('Unsafe filename detected:', file.name);
                }

                // プレビュー表示
                const reader = new FileReader();
                reader.onload = function(e) {
                    if (filePreview) {
                        // 安全に画像を表示
                        filePreview.textContent = ''; // 既存のコンテンツをクリア
                        const img = document.createElement('img');
                        img.src = e.target.result;
                        img.alt = 'QR Code Preview';
                        filePreview.appendChild(img);
                        filePreview.classList.add('active');
                    }
                };
                reader.onerror = function(e) {
                    console.error('ファイル読み込みエラー:', e);
                    window.InterConnect.Registration.showToast('ファイルの読み込みに失敗しました', 'error');
                };
                reader.readAsDataURL(file);
            } else {
                if (filePreview) {
                    filePreview.textContent = ''; // 安全にクリア
                    filePreview.classList.remove('active');
                }
            }
        });
    }

    // ステップナビゲーション
    // global-functions.jsが既に[data-action="next"]と[data-action="prev"]を処理しているため、
    // ここではnext-stepとprev-stepのみ処理
    document.querySelectorAll('[data-action="next-step"], [data-action="prev-step"]').forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            const action = this.getAttribute('data-action');

            if (action === 'next-step') {
                if (window.InterConnect.Registration.validateCurrentStep(currentStep)) {
                    window.InterConnect.Registration.moveToStep(currentStep + 1);
                    currentStep = currentStep + 1;
                }
            } else if (action === 'prev-step') {
                window.InterConnect.Registration.moveToStep(currentStep - 1);
                currentStep = currentStep - 1;
            }
        });
    });

    // プログレスステップのクリックで任意のステップに移動
    document.querySelectorAll('.progress-step').forEach(step => {
        step.style.cursor = 'pointer';
        step.addEventListener('click', function() {
            const targetStep = parseInt(this.getAttribute('data-step'));
            if (targetStep && targetStep !== currentStep) {
                window.InterConnect.Registration.moveToStep(targetStep);
                currentStep = targetStep;
            }
        });
    });

    // ローカルのmoveToStep関数は削除（グローバルで定義済み）

    // ローカルのvalidateCurrentStep関数は削除（グローバルで定義済み）

    // 旧: simulateRegistration + 偽submitハンドラ + 1つ目のcollectFormData + saveProfileData 削除済み
    // 実際のSupabase登録は下方の handleRealRegistration で行う

    // ヘルパー関数は既にグローバルスコープで定義済み

    // リアルタイムバリデーション
    document.querySelectorAll('input[required]').forEach(input => {
        input.addEventListener('blur', function() {
            if (!this.value.trim()) {
                window.InterConnect.Registration.showFieldError(this, '必須項目です');
            } else {
                window.InterConnect.Registration.clearFieldError(this);
            }
        });
    });

    // パスワード確認のリアルタイムチェック
    const passwordConfirm = document.getElementById('password-confirm');
    if (passwordConfirm) {
        passwordConfirm.addEventListener('input', function() {
            const passwordElement = document.getElementById('password');
            if (passwordElement) {
                const password = passwordElement.value;
                if (this.value && this.value !== password) {
                    window.InterConnect.Registration.showFieldError(this, 'パスワードが一致しません');
                } else {
                    window.InterConnect.Registration.clearFieldError(this);
                }
            }
        });
    }

    // LINE登録ボタンの処理は削除（auth-supabase.jsで処理）
    // 競合を避けるため、ここでは何もしない
    // console.log('registration-flow.js: LINE button handling delegated to auth-supabase.js');
});

// ============================================================
// Section: register-with-invite.js
// ============================================================
/**
 * 招待コード付き登録処理
 */

(function() {
    'use strict';

    // 二重送信防止フラグ
    let isSubmitting = false;

    // 既存のregistration-flow.jsの登録処理をオーバーライド
    window.addEventListener('DOMContentLoaded', function() {
        const form = document.getElementById('registerForm');
        if (!form) return;

        // cloneNodeを使わずに、既存のイベントリスナーをオーバーライド
        // submitイベントをキャプチャフェーズで先に処理
        form.addEventListener('submit', handleRegistrationWithInvite, true);
    });

    async function handleRegistrationWithInvite(e) {
        e.preventDefault();
        e.stopImmediatePropagation(); // 他のsubmitリスナーの二重実行を防止

        // 二重送信防止
        if (isSubmitting) return;
        isSubmitting = true;

        const form = e.target;
        const submitButton = form.querySelector('button[type="submit"]');

        // フォームデータを収集
        const formData = collectFormData();

        // 招待コード情報を取得
        const urlParams = new URLSearchParams(window.location.search);
        const inviteCode = urlParams.get('invite') || sessionStorage.getItem('inviteCode');
        const inviterId = sessionStorage.getItem('inviterId');

        // ボタンをローディング状態に
        submitButton.disabled = true;
        submitButton.classList.add('loading');
        submitButton.textContent = '登録処理中...';

        try {
            // 必須フィールドの確認（ステップ自由移動で未入力のまま送信防止）
            const missingFields = [];
            if (!formData.name) missingFields.push('お名前（ステップ1）');
            if (!formData.company) missingFields.push('会社名（ステップ1）');
            if (!formData.industry) missingFields.push('業種（ステップ1）');
            if (!formData.email) missingFields.push('メールアドレス（ステップ1）');
            if (!formData.password) missingFields.push('パスワード（ステップ1）');

            const passwordConfirm = document.getElementById('password-confirm');
            if (passwordConfirm && formData.password && passwordConfirm.value !== formData.password) {
                missingFields.push('パスワード（確認）が一致しません');
            } else if (passwordConfirm && !passwordConfirm.value) {
                missingFields.push('パスワード確認（ステップ1）');
            }

            if (!formData.phone) missingFields.push('電話番号（ステップ3）');

            const termsCheckbox = document.getElementById('terms');
            if (termsCheckbox && !termsCheckbox.checked) {
                missingFields.push('利用規約への同意（ステップ5）');
            }

            if (missingFields.length > 0) {
                throw new Error('以下の項目が未入力です：\n' + missingFields.join('\n'));
            }

            // Supabaseクライアントの確認
            if (!window.supabaseClient) {
                throw new Error('システムが初期化されていません。ページを再読み込みしてください。');
            }

            // auth.signUpのエラーで既存ユーザーを判定（レースコンディション防止）
            const { data: authData, error: authError } = await window.supabaseClient.auth.signUp({
                email: formData.email,
                password: formData.password,
                options: {
                    data: {
                        name: formData.name,
                        company: formData.company,
                        position: formData.position,
                        phone: formData.phone,
                        line_id: formData.lineId
                    }
                }
            });

            if (authError) {
                // Supabaseのエラーメッセージを日本語化
                if (authError.message.includes('User already registered')) {
                    throw new Error('このメールアドレスは既に登録されています。');
                } else if (authError.message.includes('Password should be at least')) {
                    throw new Error('パスワードは8文字以上で入力してください。');
                } else if (authError.message.includes('Invalid email')) {
                    throw new Error('有効なメールアドレスを入力してください。');
                }
                throw authError;
            }

            // Supabaseのメール列挙防止: signUpがエラーなしで user: null を返す場合がある
            if (!authData || !authData.user) {
                throw new Error('このメールアドレスは既に登録されています。ログインページからお試しください。');
            }

            // プロフィール作成（user_profilesテーブルに保存）
            // handle_new_user()トリガーが先に基本行を作成する場合があるためupsertを使用
            const { error: profileError } = await window.supabaseClient
                .from('user_profiles')
                .upsert({
                    id: authData.user.id,
                    name: formData.name,
                    full_name: formData.name,
                    company: formData.company,
                    position: formData.position,
                    email: formData.email,
                    phone: formData.phone,
                    line_id: formData.lineId,
                    budget_range: formData.budget,
                    bio: formData['skills-pr'] || '', // bioカラムにスキルPRテキストを保存
                    skills: formData.skills,
                    interests: formData.interests,
                    business_challenges: {
                        challenges: formData.challenges || []
                    },
                    industry: formData.industry,
                    is_active: true,
                    is_online: true,
                    last_login_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }, { onConflict: 'id' });

            if (profileError) throw profileError;

            // LINE QRコード画像のアップロード
            if (window._selectedLineQrFile) {
                try {
                    const ext = window._selectedLineQrFile.name.split('.').pop();
                    const filePath = `line-qr/${authData.user.id}.${ext}`;
                    const { error: uploadError } = await window.supabaseClient.storage
                        .from('avatars')
                        .upload(filePath, window._selectedLineQrFile, { upsert: true });

                    if (uploadError) {
                        console.error('LINE QRアップロードエラー:', uploadError);
                        (window.showToast || function(m){alert(m)})('LINE QRコードのアップロードに失敗しました。プロフィール設定から再アップロードできます。', 'error');
                    } else {
                        const { data: urlData } = window.supabaseClient.storage
                            .from('avatars')
                            .getPublicUrl(filePath);

                        if (urlData?.publicUrl) {
                            await window.supabaseClient
                                .from('user_profiles')
                                .update({ line_qr_url: urlData.publicUrl })
                                .eq('id', authData.user.id);
                        }
                    }
                    window._selectedLineQrFile = null;
                } catch (qrError) {
                    console.error('LINE QRアップロードエラー:', qrError);
                    (window.showToast || function(m){alert(m)})('LINE QRコードのアップロードに失敗しました。プロフィール設定から再アップロードできます。', 'error');
                    window._selectedLineQrFile = null;
                }
            }

            // 招待コードがある場合の処理
            if (inviteCode && inviterId) {
                // console.log('招待コードを処理中:', inviteCode);

                // 招待記録を作成
                const { error: invitationError } = await window.supabaseClient
                    .from('invitations')
                    .insert({
                        inviter_id: inviterId,
                        invitee_id: authData.user.id,
                        invitee_email: formData.email,
                        status: 'registered',
                        invitation_code: inviteCode,
                        registered_at: new Date().toISOString()
                    });

                if (invitationError) {
                    // console.error('招待記録の作成エラー:', invitationError);
                    // エラーが発生しても登録処理は継続
                }

                // 招待リンクの使用回数を更新
                const { data: inviteLink } = await window.supabaseClient
                    .from('invite_links')
                    .select('id, used_count')
                    .eq('link_code', inviteCode)
                    .maybeSingle();

                if (inviteLink) {
                    await window.supabaseClient
                        .from('invite_links')
                        .update({
                            used_count: (inviteLink.used_count || 0) + 1,
                            last_used_at: new Date().toISOString()
                        })
                        .eq('id', inviteLink.id);
                }

                // セッションストレージをクリア
                sessionStorage.removeItem('inviteCode');
                sessionStorage.removeItem('inviterId');
            }

            // アクティビティ記録
            await window.supabaseClient
                .from('activities')
                .insert({
                    type: 'member_joined',
                    title: `${formData.name}さんがコミュニティに参加しました`,
                    user_id: authData.user.id
                });

            // 成功メッセージ
            (window.showToast || function(m){alert(m)})('登録が完了しました！メールをご確認ください。', 'success');

            // ユーザー情報を保存
            localStorage.setItem('user', JSON.stringify({
                id: authData.user.id,
                email: formData.email,
                name: formData.name,
                company: formData.company
            }));
            sessionStorage.setItem('isLoggedIn', 'true');

            // 認証状態を待ってからリダイレクト（メール確認後にログインページへ）
            const { data: { subscription } } = window.supabaseClient.auth.onAuthStateChange((event) => {
                if (event === 'SIGNED_IN') {
                    subscription.unsubscribe();
                    window.location.href = '/login.html';
                }
            });

            // フォールバック: 3秒後にログインページへ（メール確認待ちの場合）
            setTimeout(() => {
                subscription.unsubscribe();
                window.location.href = '/login.html';
            }, 3000);

        } catch (error) {
            // console.error('登録エラー:', error);
            (window.showToast || function(m){alert(m)})(error.message || '登録に失敗しました', 'error');

            submitButton.disabled = false;
            submitButton.classList.remove('loading');
            submitButton.textContent = '登録する';
            isSubmitting = false;
        }
    }

    function collectFormData() {
        const getElementValue = (id) => {
            const elem = document.getElementById(id);
            return elem ? elem.value : '';
        };

        return {
            // 基本情報
            name: getElementValue('name'),
            company: getElementValue('company'),
            industry: getElementValue('industry'),
            email: getElementValue('email'),
            password: getElementValue('password'),
            position: getElementValue('position'),

            // 事業課題
            challenges: Array.from(document.querySelectorAll('input[name="challenges"]:checked'))
                .map(cb => cb.value),
            budget: getElementValue('budget'),

            // 連絡先
            phone: getElementValue('phone'),
            lineId: getElementValue('line-id'),

            // スキル
            skills: Array.from(document.querySelectorAll('input[name="skills"]:checked'))
                .map(cb => cb.value),
            'skills-pr': getElementValue('skills-pr'),

            // 興味・関心
            interests: Array.from(document.querySelectorAll('input[name="interests"]:checked'))
                .map(cb => cb.value),
            'interests-details': getElementValue('interests-details'),

            // その他
            newsletter: document.querySelector('input[name="newsletter"]')?.checked || false
        };
    }

    // showToast関数は toast-unified-global.js で定義済み
    // 既存のshowToast関数を使用

})();

// ============================================================
// Section: password-toggle (register.html用)
// ============================================================
(function() {
    'use strict';
    if (window.passwordToggleInitialized) return;
    document.addEventListener('DOMContentLoaded', function() {
        document.querySelectorAll('.password-toggle').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                var wrapper = this.closest('.password-input-wrapper');
                var input = wrapper && wrapper.querySelector('input');
                var icon = this.querySelector('i');
                if (input && icon) {
                    if (input.type === 'password') {
                        input.type = 'text';
                        icon.classList.replace('fa-eye', 'fa-eye-slash');
                        this.setAttribute('aria-label', 'パスワードを非表示');
                    } else {
                        input.type = 'password';
                        icon.classList.replace('fa-eye-slash', 'fa-eye');
                        this.setAttribute('aria-label', 'パスワードを表示');
                    }
                }
            });
        });
        window.passwordToggleInitialized = true;
    });
})();
