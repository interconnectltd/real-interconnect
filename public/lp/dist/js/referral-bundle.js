// ============================================================
// referral-bundle.js
// Page-specific bundle for referral.html
// ============================================================

// ============================================================
// Section: cashout-modal.js
// ============================================================

/**
 * キャッシュアウトモーダル管理
 */

class CashoutModal {
    constructor() {
        this.modal = null;
        this.availablePoints = 0;
        this.minCashoutAmount = 10000; // 最小換金額: 10,000ポイント
        this.taxRate = 0.1021; // 源泉徴収税率: 10.21%
        this.init();
    }

    init() {
        // モーダルHTML作成
        this.createModal();
        // イベントリスナー設定
        this.setupEventListeners();
    }

    createModal() {
        const modalHtml = `
            <div class="modal" id="cashoutModal">
                <div class="modal-overlay"></div>
                <div class="modal-content cashout-modal">
                    <div class="modal-header">
                        <h2>ポイント換金申請</h2>
                        <button class="modal-close">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    
                    <div class="modal-body">
                        <!-- 利用可能ポイント -->
                        <div class="cashout-info-card">
                            <div class="info-label">利用可能ポイント</div>
                            <div class="info-value" id="modalAvailablePoints">0 pt</div>
                        </div>
                        
                        <!-- 換金額入力 -->
                        <div class="form-group">
                            <label for="cashoutAmount">換金ポイント数</label>
                            <div class="input-with-unit">
                                <input type="number" 
                                       id="cashoutAmount" 
                                       min="${this.minCashoutAmount}" 
                                       step="1000"
                                       placeholder="${this.minCashoutAmount.toLocaleString()}">
                                <span class="unit">pt</span>
                            </div>
                            <small class="form-help">
                                最小換金額: ${this.minCashoutAmount.toLocaleString()}ポイント（1,000ポイント単位）
                            </small>
                        </div>
                        
                        <!-- 換金計算結果 -->
                        <div class="cashout-calculation" id="cashoutCalculation" style="display: none;">
                            <h3>換金内訳</h3>
                            <div class="calculation-row">
                                <span>換金ポイント</span>
                                <span id="calcPoints">0 pt</span>
                            </div>
                            <div class="calculation-row">
                                <span>換金額（税込）</span>
                                <span id="calcGrossAmount">¥0</span>
                            </div>
                            <div class="calculation-row tax">
                                <span>源泉徴収税（10.21%）</span>
                                <span id="calcTax">-¥0</span>
                            </div>
                            <div class="calculation-row total">
                                <span>振込予定額</span>
                                <span id="calcNetAmount">¥0</span>
                            </div>
                        </div>
                        
                        <!-- 振込先情報 -->
                        <div class="bank-info-section">
                            <h3>振込先情報</h3>
                            
                            <div class="form-group">
                                <label for="bankName">金融機関名 <span class="required">*</span></label>
                                <input type="text" id="bankName" placeholder="例：みずほ銀行" required>
                            </div>
                            
                            <div class="form-row">
                                <div class="form-group">
                                    <label for="branchName">支店名 <span class="required">*</span></label>
                                    <input type="text" id="branchName" placeholder="例：東京支店" required>
                                </div>
                                <div class="form-group">
                                    <label for="branchCode">支店コード</label>
                                    <input type="text" id="branchCode" placeholder="例：001" maxlength="3">
                                </div>
                            </div>
                            
                            <div class="form-row">
                                <div class="form-group">
                                    <label for="accountType">口座種別 <span class="required">*</span></label>
                                    <select id="accountType" required>
                                        <option value="">選択してください</option>
                                        <option value="普通">普通</option>
                                        <option value="当座">当座</option>
                                        <option value="貯蓄">貯蓄</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="accountNumber">口座番号 <span class="required">*</span></label>
                                    <input type="text" id="accountNumber" placeholder="例：1234567" maxlength="7" required>
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label for="accountHolder">口座名義（カナ） <span class="required">*</span></label>
                                <input type="text" id="accountHolder" placeholder="例：ヤマダ タロウ" required>
                                <small class="form-help">全角カタカナ・スペースで入力してください</small>
                            </div>
                        </div>
                        
                        <!-- 注意事項 -->
                        <div class="cashout-notice">
                            <h3><i class="fas fa-exclamation-circle"></i> 注意事項</h3>
                            <ul>
                                <li>換金申請後のキャンセルはできません</li>
                                <li>振込手数料は弊社が負担いたします</li>
                                <li>振込は申請から5営業日以内に行われます</li>
                                <li>源泉徴収票は年末に発行されます</li>
                                <li>本人確認が必要な場合はご連絡することがあります</li>
                            </ul>
                        </div>
                        
                        <!-- 同意チェックボックス -->
                        <div class="form-group">
                            <label class="checkbox-label">
                                <input type="checkbox" id="cashoutAgree">
                                <span>上記の注意事項を確認し、換金申請を行うことに同意します</span>
                            </label>
                        </div>
                    </div>
                    
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="window.cashoutModal.close()">
                            キャンセル
                        </button>
                        <button class="btn btn-primary" id="submitCashout" disabled>
                            換金申請する
                        </button>
                    </div>
                </div>
            </div>
        `;

        // モーダルをDOMに追加
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        this.modal = document.getElementById('cashoutModal');
    }

    setupEventListeners() {
        // モーダルクローズ
        this.modal.querySelector('.modal-close').addEventListener('click', () => this.close());
        this.modal.querySelector('.modal-overlay').addEventListener('click', () => this.close());

        // 換金額入力時の計算
        const amountInput = document.getElementById('cashoutAmount');
        amountInput.addEventListener('input', () => this.calculateCashout());

        // フォーム入力チェック
        const inputs = this.modal.querySelectorAll('input[required], select[required]');
        inputs.forEach(input => {
            input.addEventListener('input', () => this.checkFormValidity());
        });

        // 同意チェックボックス
        document.getElementById('cashoutAgree').addEventListener('change', () => this.checkFormValidity());

        // 申請ボタン
        document.getElementById('submitCashout').addEventListener('click', () => this.submitCashout());

        // 口座名義のカナ入力制限
        document.getElementById('accountHolder').addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^ァ-ヶー\s]/g, '');
        });

        // 数字入力制限
        ['branchCode', 'accountNumber'].forEach(id => {
            document.getElementById(id).addEventListener('input', (e) => {
                e.target.value = e.target.value.replace(/[^0-9]/g, '');
            });
        });
    }

    open(availablePoints) {
        this.availablePoints = availablePoints;
        document.getElementById('modalAvailablePoints').textContent = `${(availablePoints || 0).toLocaleString()} pt`;
        
        // 最大値を設定
        const amountInput = document.getElementById('cashoutAmount');
        amountInput.max = availablePoints;
        
        // モーダル表示
        this.modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    close() {
        this.modal.classList.remove('show');
        document.body.style.overflow = '';
        
        // フォームリセット
        this.modal.querySelectorAll('input, select').forEach(input => {
            if (input.type === 'checkbox') {
                input.checked = false;
            } else {
                input.value = '';
            }
        });
        
        // 計算結果を非表示
        document.getElementById('cashoutCalculation').style.display = 'none';
        document.getElementById('submitCashout').disabled = true;
    }

    calculateCashout() {
        const amountInput = document.getElementById('cashoutAmount');
        const amount = parseInt(amountInput.value) || 0;
        
        if (amount >= this.minCashoutAmount && amount <= this.availablePoints) {
            // 計算
            const grossAmount = amount; // 1ポイント = 1円
            const tax = Math.floor(grossAmount * this.taxRate);
            const netAmount = grossAmount - tax;
            
            // 表示更新
            document.getElementById('calcPoints').textContent = `${amount.toLocaleString()} pt`;
            document.getElementById('calcGrossAmount').textContent = `¥${grossAmount.toLocaleString()}`;
            document.getElementById('calcTax').textContent = `-¥${tax.toLocaleString()}`;
            document.getElementById('calcNetAmount').textContent = `¥${netAmount.toLocaleString()}`;
            
            document.getElementById('cashoutCalculation').style.display = 'block';
        } else {
            document.getElementById('cashoutCalculation').style.display = 'none';
        }
        
        this.checkFormValidity();
    }

    checkFormValidity() {
        const amount = parseInt(document.getElementById('cashoutAmount').value) || 0;
        const bankName = document.getElementById('bankName').value.trim();
        const branchName = document.getElementById('branchName').value.trim();
        const accountType = document.getElementById('accountType').value;
        const accountNumber = document.getElementById('accountNumber').value.trim();
        const accountHolder = document.getElementById('accountHolder').value.trim();
        const agreed = document.getElementById('cashoutAgree').checked;
        
        const isValid = 
            amount >= this.minCashoutAmount &&
            amount <= this.availablePoints &&
            amount % 1000 === 0 && // 1,000ポイント単位
            bankName &&
            branchName &&
            accountType &&
            accountNumber &&
            accountHolder &&
            agreed;
        
        document.getElementById('submitCashout').disabled = !isValid;
    }

    async submitCashout() {
        const submitButton = document.getElementById('submitCashout');
        submitButton.disabled = true;
        submitButton.textContent = '申請中...';
        
        try {
            const amount = parseInt(document.getElementById('cashoutAmount').value);
            const bankInfo = {
                bank_name: document.getElementById('bankName').value.trim(),
                branch_name: document.getElementById('branchName').value.trim(),
                branch_code: document.getElementById('branchCode').value.trim(),
                account_type: document.getElementById('accountType').value,
                account_number: document.getElementById('accountNumber').value.trim(),
                account_holder: document.getElementById('accountHolder').value.trim()
            };
            
            // キャッシュアウト申請を作成
            const user = await window.safeGetUser();
            if (!user) throw new Error('ユーザー情報が取得できません');

            // 二重送信防止
            if (this._cashoutSubmitting) {
                this.showToast('処理中です。しばらくお待ちください', 'info');
                return;
            }
            this._cashoutSubmitting = true;

            let cashoutId = null;
            try {
                const { data, error } = await window.supabaseClient
                    .from('cashout_requests')
                    .insert({
                        user_id: user.id,
                        amount: amount,
                        gross_amount: amount,
                        tax_amount: Math.floor(amount * this.taxRate),
                        net_amount: amount - Math.floor(amount * this.taxRate),
                        bank_info: bankInfo,
                        status: 'pending'
                    })
                    .select()
                    .maybeSingle();

                if (error) throw error;
                cashoutId = data?.id;

                // ポイント残高を更新
                const { error: pointError } = await window.supabaseClient
                    .rpc('deduct_user_points', {
                        p_user_id: user.id,
                        p_amount: amount
                    });

                if (pointError) {
                    // ポイント減算失敗時、cashout_requestsをキャンセルに戻す
                    if (cashoutId) {
                        await window.supabaseClient
                            .from('cashout_requests')
                            .update({ status: 'cancelled' })
                            .eq('id', cashoutId);
                    }
                    throw pointError;
                }
            } finally {
                this._cashoutSubmitting = false;
            }
            
            // 成功メッセージ
            this.showToast('換金申請が完了しました', 'success');
            
            // モーダルを閉じる
            this.close();
            
            // ページをリロード
            setTimeout(() => {
                window.location.reload();
            }, 1500);
            
        } catch (error) {
            console.error('換金申請エラー:', error);
            this.showToast(error.message || '換金申請に失敗しました', 'error');
            
            submitButton.disabled = false;
            submitButton.textContent = '換金申請する';
        }
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
            <span>${message}</span>
        `;
        
        Object.assign(toast.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            background: type === 'success' ? '#10b981' : '#ef4444',
            color: 'white',
            padding: '16px 24px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            zIndex: '10001',
            animation: 'slideInRight 0.3s ease'
        });
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

// グローバルに公開
window.cashoutModal = new CashoutModal();

// ============================================================
// Section: referral-unified.js
// ============================================================

/**
 * 紹介システム統一JavaScript
 * 
 * 以下のファイルの機能を統合:
 * - referral-enhanced.js
 * - referral-enhanced-fix.js
 * - referral-table-fix.js
 * - referral-security-fix.js
 * - referral-link-fix-final.js
 * - force-correct-userid.js
 * - fix-delete-link.js
 */

(function() {
    'use strict';

    // console.log('[ReferralUnified] 紹介システム統一モジュール初期化');

    // グローバル変数
    let currentUserId = null;
    let referralLinks = [];
    let referralStats = {
        availablePoints: 0,
        totalEarned: 0,
        referralCount: 0,
        conversionRate: 0
    };

    // 初期化
    async function initialize() {
        // console.log('[ReferralUnified] 初期化開始');

        // Supabaseの準備を待つ
        await window.waitForSupabase();

        // 現在のユーザーを取得
        const user = await window.safeGetUser();
        if (!user) {
            console.error('[ReferralUnified] ユーザーが認証されていません');
            window.location.href = '/login.html';
            return;
        }

        currentUserId = user.id;
        // console.log('[ReferralUnified] ユーザーID:', currentUserId);

        // イベントリスナーの設定
        setupEventListeners();

        // データの読み込み
        await loadReferralData();
    }

    // イベントリスナーの設定
    function setupEventListeners() {
        // リンク作成ボタン
        const createLinkBtn = document.getElementById('create-link-btn');
        if (createLinkBtn) {
            createLinkBtn.addEventListener('click', showLinkForm);
        }

        // ステータスフィルター
        const statusFilter = document.getElementById('status-filter');
        if (statusFilter) {
            statusFilter.addEventListener('change', filterReferrals);
        }

        // キャッシュアウトボタン
        const cashoutBtn = document.getElementById('cashout-btn');
        if (cashoutBtn) {
            cashoutBtn.addEventListener('click', openCashoutModal);
        }
    }

    // 紹介データの読み込み
    async function loadReferralData() {
        try {
            // ポイント情報を取得
            await loadUserPoints();

            // 紹介リンクを取得
            await loadReferralLinks();

            // 紹介履歴を取得
            await loadReferralHistory();

            // キャッシュアウト履歴を取得
            await loadCashoutHistory();

        } catch (error) {
            console.error('[ReferralUnified] データ読み込みエラー:', error);
        }
    }

    // ユーザーポイントの読み込み
    async function loadUserPoints() {
        try {
            const { data, error } = await window.supabaseClient
                .from('user_points')
                .select('*')
                .eq('user_id', currentUserId)
                .maybeSingle();

            if (error) throw error;

            if (data) {
                referralStats.availablePoints = data.available_points || 0;
                referralStats.totalEarned = data.total_earned || 0;

                // UI更新
                updateElement('available-points', referralStats.availablePoints.toLocaleString());
                updateElement('total-earned', referralStats.totalEarned.toLocaleString());

                // キャッシュアウトボタンの有効/無効
                const cashoutBtn = document.getElementById('cashout-btn');
                if (cashoutBtn) {
                    cashoutBtn.disabled = referralStats.availablePoints < 5000;
                }
            }
        } catch (error) {
            console.error('[ReferralUnified] ポイント情報取得エラー:', error);
        }
    }

    // 紹介リンクの読み込み
    async function loadReferralLinks() {
        try {
            const { data, error } = await window.supabaseClient
                .from('invite_links')
                .select('*')
                .eq('created_by', currentUserId)
                .order('created_at', { ascending: false });

            if (error) throw error;

            referralLinks = data || [];
            displayReferralLinks();

        } catch (error) {
            console.error('[ReferralUnified] 紹介リンク取得エラー:', error);
        }
    }

    // 紹介履歴の読み込み
    async function loadReferralHistory() {
        try {
            const { data, error } = await window.supabaseClient
                .from('v_referral_history')
                .select('*')
                .eq('inviter_id', currentUserId)
                .order('accepted_at', { ascending: false });

            if (error) throw error;

            const referrals = data || [];
            
            // 統計を計算
            referralStats.referralCount = referrals.length;
            const completedCount = referrals.filter(r => r.status === 'completed').length;
            referralStats.conversionRate = referrals.length > 0 
                ? Math.round((completedCount / referrals.length) * 100) 
                : 0;

            // UI更新
            updateElement('referral-count', referralStats.referralCount);
            updateElement('conversion-rate', referralStats.conversionRate);

            // 履歴を表示
            displayReferralHistory(referrals);

        } catch (error) {
            console.error('[ReferralUnified] 紹介履歴取得エラー:', error);
        }
    }

    // キャッシュアウト履歴の読み込み
    async function loadCashoutHistory() {
        try {
            const { data, error } = await window.supabaseClient
                .from('cashout_requests')
                .select('*')
                .eq('user_id', currentUserId)
                .order('created_at', { ascending: false });

            if (error) throw error;

            displayCashoutHistory(data || []);

        } catch (error) {
            console.error('[ReferralUnified] キャッシュアウト履歴取得エラー:', error);
        }
    }

    // 紹介リンクの表示
    function displayReferralLinks() {
        const linksList = document.getElementById('links-list');
        if (!linksList) return;

        if (referralLinks.length === 0) {
            linksList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-link"></i>
                    <p>まだ紹介リンクがありません</p>
                    <p class="text-muted">「新しいリンクを作成」ボタンから始めましょう</p>
                </div>
            `;
            return;
        }

        linksList.innerHTML = referralLinks.map(link => `
            <div class="link-item" data-link-id="${link.id}">
                <div class="link-header">
                    <div class="link-info">
                        <h3>${escapeHtml(link.description || '名称未設定')}</h3>
                        <p class="link-code">コード: ${link.link_code}</p>
                    </div>
                    <div class="link-stats">
                        <span class="stat">
                            <i class="fas fa-users"></i>
                            ${link.referral_count || 0}人紹介
                        </span>
                        <span class="stat">
                            <i class="fas fa-chart-line"></i>
                            ${link.conversion_count || 0}人成約
                        </span>
                    </div>
                </div>
                <div class="link-url">
                    <input type="text" readonly value="${window.location.origin}/register.html?ref=${link.link_code}" 
                           id="link-${link.id}" class="link-input">
                </div>
                <div class="link-actions">
                    <button class="btn btn-secondary copy-btn" onclick="copyLink('${window.escapeAttr(link.id)}')">
                        <i class="fas fa-copy"></i> コピー
                    </button>
                    <button class="btn btn-primary share-btn" onclick="openShareModal('${window.escapeAttr(link.link_code)}')">
                        <i class="fas fa-share-alt"></i> 共有
                    </button>
                    <button class="btn btn-danger delete-btn" onclick="deleteLink('${window.escapeAttr(link.id)}')">
                        <i class="fas fa-trash"></i> 削除
                    </button>
                </div>
            </div>
        `).join('');
    }

    // 紹介履歴の表示
    function displayReferralHistory(referrals) {
        const referralList = document.getElementById('referral-list');
        if (!referralList) return;

        if (referrals.length === 0) {
            referralList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-history"></i>
                    <p>まだ紹介履歴がありません</p>
                </div>
            `;
            return;
        }

        referralList.innerHTML = referrals.map(referral => {
            const statusInfo = getStatusInfo(referral.status);
            return `
                <div class="history-item">
                    <div class="history-header">
                        <div class="user-info">
                            <i class="fas fa-user-circle"></i>
                            <div>
                                <p class="user-name">${escapeHtml(referral.invitee_name || '未設定')}</p>
                                <p class="user-email">${escapeHtml(referral.invitee_email || '')}</p>
                            </div>
                        </div>
                        <div class="status-badge ${statusInfo.class}">
                            ${statusInfo.icon} ${statusInfo.text}
                        </div>
                    </div>
                    <div class="history-details">
                        <p class="date">
                            <i class="fas fa-calendar"></i>
                            ${formatDate(referral.sent_at || referral.created_at)}
                        </p>
                        ${referral.accepted_at ? `
                            <p class="completed-date">
                                <i class="fas fa-check-circle"></i>
                                登録日: ${formatDate(referral.accepted_at)}
                            </p>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    // キャッシュアウト履歴の表示
    function displayCashoutHistory(cashouts) {
        const cashoutList = document.getElementById('cashout-list');
        if (!cashoutList) return;

        if (cashouts.length === 0) {
            cashoutList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-money-check-alt"></i>
                    <p>まだ出金履歴がありません</p>
                </div>
            `;
            return;
        }

        cashoutList.innerHTML = cashouts.map(cashout => {
            const statusInfo = getCashoutStatusInfo(cashout.status);
            return `
                <div class="cashout-item">
                    <div class="cashout-header">
                        <div class="amount-info">
                            <p class="amount">¥${(cashout.amount || 0).toLocaleString()}</p>
                            <p class="tax">源泉税: ¥${(cashout.tax_amount || 0).toLocaleString()}</p>
                        </div>
                        <div class="status-badge ${statusInfo.class}">
                            ${statusInfo.icon} ${statusInfo.text}
                        </div>
                    </div>
                    <div class="cashout-details">
                        <p class="date">
                            <i class="fas fa-calendar"></i>
                            申請日: ${formatDate(cashout.created_at)}
                        </p>
                        ${cashout.processed_at ? `
                            <p class="processed-date">
                                <i class="fas fa-check-circle"></i>
                                処理日: ${formatDate(cashout.processed_at)}
                            </p>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    // リンク作成フォームの表示
    function showLinkForm() {
        const form = document.getElementById('link-form');
        if (form) {
            form.style.display = 'block';
            document.getElementById('link-description').focus();
        }
    }

    // リンク作成のキャンセル
    window.cancelLinkCreation = function() {
        const form = document.getElementById('link-form');
        if (form) {
            form.style.display = 'none';
            document.getElementById('link-description').value = '';
        }
    };

    // 紹介リンクの作成
    window.createReferralLink = async function() {
        const description = document.getElementById('link-description').value.trim();
        
        if (!description) {
            // alert('リンクの説明を入力してください');
            if (window.showError) {
                showError('リンクの説明を入力してください');
            }
            return;
        }

        try {
            // リンクコードを生成
            const linkCode = generateLinkCode();

            // データベースに保存
            const { data, error } = await window.supabaseClient
                .from('invite_links')
                .insert({
                    created_by: currentUserId, // created_byカラムのみ使用
                    link_code: linkCode,
                    description: description,
                    is_active: true,
                    referral_count: 0,
                    conversion_count: 0
                })
                .select()
                .maybeSingle();

            if (error) throw error;

            // リストに追加
            referralLinks.unshift(data);
            displayReferralLinks();

            // フォームをクリア
            cancelLinkCreation();

            // 成功メッセージ
            showNotification('紹介リンクを作成しました', 'success');

        } catch (error) {
            console.error('[ReferralUnified] リンク作成エラー:', error);
            // alert('リンクの作成に失敗しました');
            if (window.showError) {
                showError('リンクの作成に失敗しました');
            }
        }
    };

    // リンクのコピー
    window.copyLink = function(linkId) {
        const input = document.getElementById(`link-${linkId}`);
        if (input) {
            input.select();
            document.execCommand('copy');
            showNotification('リンクをコピーしました', 'success');
        }
    };

    // 共有モーダルを開く（後方の完全版定義に委譲）
    window.openShareModal = window.openShareModal || function(linkCode) {
        window.currentShareLink = `${window.location.origin}/register.html?ref=${linkCode}`;
        const modal = document.getElementById('share-modal');
        if (modal) {
            modal.classList.add('active');
        }
    };

    // リンクの削除
    window.deleteLink = async function(linkId) {
        if (!await window.showConfirmModal('このリンクを削除してもよろしいですか？', { confirmLabel: '削除', danger: true })) {
            return;
        }

        try {
            const { error } = await window.supabaseClient
                .from('invite_links')
                .delete()
                .eq('id', linkId)
                .eq('created_by', currentUserId);

            if (error) throw error;

            // リストから削除
            referralLinks = referralLinks.filter(link => link.id !== linkId);
            displayReferralLinks();

            showNotification('リンクを削除しました', 'success');

        } catch (error) {
            console.error('[ReferralUnified] リンク削除エラー:', error);
            // alert('リンクの削除に失敗しました');
            if (window.showError) {
                showError('リンクの削除に失敗しました');
            }
        }
    };

    // 紹介履歴のフィルタリング
    function filterReferrals() {
        const filterValue = document.getElementById('status-filter').value;
        // console.log('[ReferralUnified] フィルター:', filterValue);
        // フィルタリング処理を実装
    }

    // キャッシュアウトモーダルを開く
    function openCashoutModal() {
        if (window.cashoutModal && window.cashoutModal.open) {
            window.cashoutModal.open();
        }
    }

    // ユーティリティ関数
    function generateLinkCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 8; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    function updateElement(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('ja-JP', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    function getStatusInfo(status) {
        const statusMap = {
            pending: { text: '登録待ち', icon: '⏳', class: 'status-pending' },
            registered: { text: '登録済み', icon: '✅', class: 'status-registered' },
            completed: { text: '面談完了', icon: '🎉', class: 'status-completed' },
            cancelled: { text: 'キャンセル', icon: '❌', class: 'status-cancelled' }
        };
        return statusMap[status] || { text: '不明', icon: '❓', class: 'status-unknown' };
    }

    function getCashoutStatusInfo(status) {
        const statusMap = {
            pending: { text: '処理中', icon: '⏳', class: 'status-pending' },
            approved: { text: '承認済み', icon: '✅', class: 'status-approved' },
            completed: { text: '送金完了', icon: '💰', class: 'status-completed' },
            rejected: { text: '却下', icon: '❌', class: 'status-rejected' }
        };
        return statusMap[status] || { text: '不明', icon: '❓', class: 'status-unknown' };
    }

    function showNotification(message, type = 'info') {
        // 通知の表示（実装は既存の通知システムに依存）
        // console.log(`[ReferralUnified] ${type}: ${message}`);
    }

    // 初期化実行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();

// ============================================================
// Section: share-modal-handler.js
// ============================================================

/**
 * シェアモーダルハンドラー
 * 各SNSへのシェア機能の実装
 */

(function() {
    'use strict';

    // console.log('[ShareModal] ハンドラー初期化');

    // 現在の紹介リンクURL
    let currentShareUrl = '';
    let currentShareText = '';

    // 初期化
    function initialize() {
        // console.log('[ShareModal] 初期化開始');
        
        // デフォルトのシェアテキストを設定
        const shareMessageElement = document.getElementById('share-message');
        if (shareMessageElement) {
            currentShareText = shareMessageElement.value;
        }
        
        // 現在のページURLまたは紹介リンクを取得
        setupShareUrl();
    }

    // シェアURLの設定
    function setupShareUrl() {
        // 紹介リンクが表示されている場合はそれを使用
        const inviteLinkElement = document.querySelector('.invite-link-url');
        if (inviteLinkElement) {
            currentShareUrl = inviteLinkElement.textContent;
            // console.log('[ShareModal] 紹介リンクを使用:', currentShareUrl);
        } else {
            // なければ現在のページURL
            currentShareUrl = window.location.href;
            // console.log('[ShareModal] 現在のページURLを使用:', currentShareUrl);
        }
    }

    // シェアモーダルを開く
    window.openShareModal = function(linkUrl) {
        // console.log('[ShareModal] モーダルを開く:', linkUrl);
        
        if (linkUrl) {
            currentShareUrl = linkUrl;
        }
        
        const modal = document.getElementById('share-modal');
        if (modal) {
            modal.classList.add('active');
            document.body.style.overflow = 'hidden';
            
            // テキストエリアの内容を更新
            updateShareMessage();
        } else {
            console.error('[ShareModal] share-modal要素が見つかりません');
        }
    };

    // シェアモーダルを閉じる
    window.closeShareModal = function() {
        // console.log('[ShareModal] モーダルを閉じる');
        
        const modal = document.getElementById('share-modal');
        if (modal) {
            modal.classList.remove('active');
            document.body.style.overflow = '';
        }
    };

    // シェアメッセージを更新
    function updateShareMessage() {
        const shareMessageElement = document.getElementById('share-message');
        if (shareMessageElement) {
            // URLを含めたメッセージに更新
            const baseMessage = `経営者向けAI活用コミュニティ「INTERCONNECT」をご存知ですか？

AIを活用した次世代のビジネスマッチングサービスで、経営者同士の出会いから新しいビジネスチャンスが生まれています。

今なら無料面談を受けられるので、ぜひこちらのリンクからご登録ください。`;
            
            shareMessageElement.value = baseMessage;
            currentShareText = baseMessage;
        }
    }

    // Twitterでシェア
    window.shareToTwitter = function() {
        // console.log('[ShareModal] Twitterでシェア');
        
        const text = encodeURIComponent(currentShareText);
        const url = encodeURIComponent(currentShareUrl);
        const hashtags = encodeURIComponent('INTERCONNECT,AI活用,ビジネスマッチング');
        
        const twitterUrl = `https://twitter.com/intent/tweet?text=${text}&url=${url}&hashtags=${hashtags}`;
        
        window.open(twitterUrl, '_blank', 'width=600,height=400');
        
        // アナリティクス記録
        trackShare('twitter');
    };

    // LINEでシェア
    window.shareToLine = function() {
        // console.log('[ShareModal] LINEでシェア');
        
        const text = encodeURIComponent(`${currentShareText}\n\n${currentShareUrl}`);
        const lineUrl = `https://line.me/R/msg/text/?${text}`;
        
        // モバイルの場合はアプリを開く
        if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
            window.location.href = lineUrl;
        } else {
            window.open(lineUrl, '_blank', 'width=600,height=400');
        }
        
        // アナリティクス記録
        trackShare('line');
    };

    // Facebookでシェア
    window.shareToFacebook = function() {
        // console.log('[ShareModal] Facebookでシェア');
        
        const url = encodeURIComponent(currentShareUrl);
        const quote = encodeURIComponent(currentShareText);
        
        const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${url}&quote=${quote}`;
        
        window.open(facebookUrl, '_blank', 'width=600,height=400');
        
        // アナリティクス記録
        trackShare('facebook');
    };

    // メールでシェア
    window.shareByEmail = function() {
        // console.log('[ShareModal] メールでシェア');
        
        const subject = encodeURIComponent('INTERCONNECTのご紹介');
        const body = encodeURIComponent(`${currentShareText}\n\n詳細はこちら:\n${currentShareUrl}`);
        
        const mailtoUrl = `mailto:?subject=${subject}&body=${body}`;
        
        window.location.href = mailtoUrl;
        
        // アナリティクス記録
        trackShare('email');
    };

    // コピー機能（追加）
    window.copyShareLink = function() {
        // console.log('[ShareModal] リンクをコピー');
        
        const tempInput = document.createElement('input');
        tempInput.value = currentShareUrl;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
        
        // フィードバック表示
        showCopyFeedback();
        
        // アナリティクス記録
        trackShare('copy');
    };

    // コピー完了フィードバック
    function showCopyFeedback() {
        const button = event.target.closest('button');
        if (button) {
            const originalText = button.innerHTML;
            button.innerHTML = '<i class="fas fa-check"></i><span>コピーしました！</span>';
            button.classList.add('success');
            
            setTimeout(() => {
                button.innerHTML = originalText;
                button.classList.remove('success');
            }, 2000);
        }
    }

    // シェアアナリティクス
    function trackShare(platform) {
        // console.log(`[ShareModal] ${platform}でシェアされました`);
        
        // Google Analytics
        if (typeof gtag !== 'undefined') {
            gtag('event', 'share', {
                method: platform,
                content_type: 'referral_link',
                item_id: currentShareUrl
            });
        }
        
        // Supabaseに記録
        if (window.supabaseClient) {
            recordShareActivity(platform);
        }
    }

    // Supabaseにシェア活動を記録
    async function recordShareActivity(platform) {
        try {
            const user = await window.safeGetUser();
            if (!user) return;
            
            const { error } = await window.supabaseClient
                .from('share_activities')
                .insert({
                    user_id: user.id,
                    platform: platform,
                    share_url: currentShareUrl,
                    shared_at: new Date().toISOString()
                });
            
            if (error) {
                console.error('[ShareModal] シェア記録エラー:', error);
            } else {
                // console.log('[ShareModal] シェア活動を記録しました');
            }
        } catch (error) {
            console.error('[ShareModal] シェア記録エラー:', error);
        }
    }

    // モーダル外クリックで閉じる
    document.addEventListener('click', function(e) {
        const modal = document.getElementById('share-modal');
        if (modal && e.target === modal) {
            closeShareModal();
        }
    });

    // ESCキーで閉じる
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            const modal = document.getElementById('share-modal');
            if (modal && modal.classList.contains('active')) {
                closeShareModal();
            }
        }
    });

    // 初期化実行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();

