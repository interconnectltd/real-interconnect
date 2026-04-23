// ============================================================
// Section: admin-referral.js
// ============================================================
/**
 * 紹介プログラム管理画面
 */

class AdminReferralManager {
    constructor() {
        this.currentTab = 'overview';
        this.charts = {};
        this.init();
    }

    async init() {
        // 管理者権限チェック
        await this.checkAdminAuth();

        // イベントリスナー設定
        this.setupEventListeners();

        // 初期データ読み込み
        await this.loadDashboardData();

        // リアルタイム更新の設定
        this.setupRealtimeUpdates();
    }

    async checkAdminAuth() {
        const user = await window.safeGetUser();
        if (!user) {
            window.location.href = '/admin-login.html';
            return;
        }

        // 管理者権限チェック
        const { data: profile } = await window.supabaseClient
            .from('user_profiles')
            .select('is_admin')
            .eq('id', user.id)
            .maybeSingle();

        if (!profile?.is_admin) {
            // alert('管理者権限がありません');
            if (window.showError) {
                window.showError('管理者権限がありません');
            }
            window.location.href = '/dashboard.html';
        }
    }

    setupEventListeners() {
        // タブ切り替え
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // フィルター
        document.getElementById('referral-status-filter')?.addEventListener('change', () => {
            this.filterReferrals();
        });

        document.getElementById('cashout-status-filter')?.addEventListener('change', () => {
            this.filterCashouts();
        });

        document.getElementById('fraud-severity-filter')?.addEventListener('change', () => {
            this.filterFraudFlags();
        });

        // 検索
        document.getElementById('referral-search')?.addEventListener('input', (e) => {
            this.searchReferrals(e.target.value);
        });

        // モーダルクローズ
        document.querySelector('.modal-close')?.addEventListener('click', () => {
            this.closeModal();
        });
    }

    switchTab(tabName) {
        // タブボタンの切り替え
        document.querySelectorAll('.tab-button').forEach(button => {
            button.classList.toggle('active', button.dataset.tab === tabName);
        });

        // タブコンテンツの切り替え
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.toggle('active', pane.id === `${tabName}-tab`);
        });

        this.currentTab = tabName;

        // タブ別のデータ読み込み
        switch (tabName) {
            case 'overview':
                this.loadOverviewData();
                break;
            case 'referrals':
                this.loadReferralsData();
                break;
            case 'cashouts':
                this.loadCashoutsData();
                break;
            case 'fraud':
                this.loadFraudData();
                break;
            case 'analytics':
                this.loadAnalyticsData();
                break;
        }
    }

    async loadDashboardData() {
        try {
            // 統計データの取得
            const [
                totalReferrers,
                successfulReferrals,
                totalRewards,
                suspiciousUsers
            ] = await Promise.all([
                this.getTotalReferrers(),
                this.getSuccessfulReferrals(),
                this.getTotalRewards(),
                this.getSuspiciousUsers()
            ]);

            // 統計表示を更新
            document.getElementById('total-referrers').textContent = totalReferrers.toLocaleString();
            document.getElementById('successful-referrals').textContent = successfulReferrals.toLocaleString();
            document.getElementById('total-rewards').textContent = `¥${totalRewards.toLocaleString()}`;
            document.getElementById('suspicious-users').textContent = suspiciousUsers.toLocaleString();

            // 概要データの読み込み
            await this.loadOverviewData();

        } catch (error) {
            console.error('ダッシュボードデータの読み込みエラー:', error);
            this.showNotification('データの読み込みに失敗しました', 'error');
        }
    }

    async getTotalReferrers() {
        const { count } = await window.supabaseClient
            .from('invite_links')
            .select('*', { count: 'exact', head: true })
            .gt('used_count', 0);
        return count || 0;
    }

    async getSuccessfulReferrals() {
        const { count } = await window.supabaseClient
            .from('invitations')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'completed');
        return count || 0;
    }

    async getTotalRewards() {
        const { data } = await window.supabaseClient
            .from('user_points')
            .select('total_earned');

        return data?.reduce((sum, user) => sum + (user.total_earned || 0), 0) || 0;
    }

    async getSuspiciousUsers() {
        const { count } = await window.supabaseClient
            .from('fraud_flags')
            .select('*', { count: 'exact', head: true })
            .eq('resolved', false);
        return count || 0;
    }

    async loadOverviewData() {
        // 最新の紹介活動
        await this.loadRecentActivity();

        // トップ紹介者
        await this.loadTopReferrers();
    }

    async loadRecentActivity() {
        try {
            const { data: activities } = await window.supabaseClient
                .from('invitations')
                .select(`
                    *,
                    inviter:profiles!invitations_inviter_id_fkey(name, company),
                    invitee:profiles!invitations_invitee_id_fkey(name, company)
                `)
                .order('created_at', { ascending: false })
                .limit(10);

            const activityHtml = activities?.map(activity => `
                <div class="activity-item">
                    <div class="activity-icon ${this.getActivityIconClass(activity.status)}">
                        <i class="${this.getActivityIcon(activity.status)}"></i>
                    </div>
                    <div class="activity-content">
                        <p class="activity-text">
                            <strong>${window.escapeHTML(activity.inviter?.name || '不明')}</strong> が
                            <strong>${window.escapeHTML(activity.invitee?.name || '未登録')}</strong> を招待
                        </p>
                        <p class="activity-time">${this.formatRelativeTime(activity.created_at)}</p>
                    </div>
                    <div class="activity-status">
                        <span class="status-badge ${activity.status}">
                            ${this.getStatusText(activity.status)}
                        </span>
                    </div>
                </div>
            `).join('') || '<p class="empty-state">活動履歴がありません</p>';

            document.getElementById('recent-activity').innerHTML = activityHtml;

        } catch (error) {
            console.error('最新活動の読み込みエラー:', error);
        }
    }

    async loadTopReferrers() {
        try {
            const { data: referrers } = await window.supabaseClient
                .rpc('get_top_referrers', { limit_count: 5 });

            const referrersHtml = referrers?.map((referrer, index) => `
                <div class="referrer-item">
                    <div class="referrer-rank">${index + 1}</div>
                    <div class="referrer-info">
                        <p class="referrer-name">${window.escapeHTML(referrer.user_name || '不明')}</p>
                        <p class="referrer-company">${window.escapeHTML(referrer.user_company || '未設定')}</p>
                    </div>
                    <div class="referrer-stats">
                        <span class="stat">
                            <i class="fas fa-user-plus"></i> ${referrer.total_referrals || 0}
                        </span>
                        <span class="stat">
                            <i class="fas fa-check-circle"></i> ${referrer.successful_referrals || 0}
                        </span>
                        <span class="stat">
                            <i class="fas fa-coins"></i> ${referrer.total_points_earned?.toLocaleString() || 0}pt
                        </span>
                    </div>
                </div>
            `).join('') || '<p class="empty-state">データがありません</p>';

            document.getElementById('top-referrers').innerHTML = referrersHtml;

        } catch (error) {
            console.error('トップ紹介者の読み込みエラー:', error);
        }
    }

    async loadReferralsData() {
        try {
            const { data: referrals } = await window.supabaseClient
                .from('invitations')
                .select(`
                    *,
                    inviter:profiles!invitations_inviter_id_fkey(name, email, company),
                    invitee:profiles!invitations_invitee_id_fkey(name, email, company)
                `)
                .order('created_at', { ascending: false });

            this.renderReferralsTable(referrals || []);

        } catch (error) {
            console.error('紹介一覧の読み込みエラー:', error);
        }
    }

    renderReferralsTable(referrals) {
        const tbody = document.querySelector('#referrals-table tbody');

        const html = referrals.map(referral => `
            <tr>
                <td>${this.formatDate(referral.created_at)}</td>
                <td>
                    <div class="user-info">
                        <span class="name">${window.escapeHTML(referral.inviter?.name || '不明')}</span>
                        <span class="email">${window.escapeHTML(referral.inviter?.email || '')}</span>
                    </div>
                </td>
                <td>
                    <div class="user-info">
                        <span class="name">${window.escapeHTML(referral.invitee?.name || '未登録')}</span>
                        <span class="email">${window.escapeHTML(referral.invitee?.email || '')}</span>
                    </div>
                </td>
                <td>
                    <span class="status-badge ${referral.status}">
                        ${this.getStatusText(referral.status)}
                    </span>
                </td>
                <td>
                    ${referral.reward_status === 'earned'
                        ? `<span class="reward-amount">${(referral.points_earned || 0).toLocaleString()}pt</span>`
                        : '<span class="text-muted">-</span>'
                    }
                </td>
                <td>
                    <button class="btn btn-sm btn-outline" onclick="adminReferral.viewReferralDetails('${referral.id}')">
                        詳細
                    </button>
                </td>
            </tr>
        `).join('');

        tbody.innerHTML = html || '<tr><td colspan="6" class="text-center">データがありません</td></tr>';
    }

    async loadCashoutsData() {
        try {
            const { data: cashouts } = await window.supabaseClient
                .from('cashout_requests')
                .select(`
                    *,
                    user:profiles!cashout_requests_user_id_fkey(name, email, company)
                `)
                .order('created_at', { ascending: false });

            this.renderCashoutsTable(cashouts || []);

        } catch (error) {
            console.error('キャッシュアウト一覧の読み込みエラー:', error);
        }
    }

    renderCashoutsTable(cashouts) {
        const tbody = document.querySelector('#cashouts-table tbody');

        const html = cashouts.map(cashout => `
            <tr>
                <td>${this.formatDate(cashout.created_at)}</td>
                <td>
                    <div class="user-info">
                        <span class="name">${window.escapeHTML(cashout.user?.name || '不明')}</span>
                        <span class="email">${window.escapeHTML(cashout.user?.email || '')}</span>
                    </div>
                </td>
                <td>¥${cashout.amount.toLocaleString()}</td>
                <td class="text-danger">-¥${(cashout.tax_amount || 0).toLocaleString()}</td>
                <td class="text-success">¥${(cashout.net_amount || 0).toLocaleString()}</td>
                <td>
                    <span class="status-badge ${cashout.status}">
                        ${this.getCashoutStatusText(cashout.status)}
                    </span>
                </td>
                <td>
                    <button class="btn btn-sm btn-outline" onclick="adminReferral.viewCashoutDetails('${cashout.id}')">
                        詳細
                    </button>
                    ${cashout.status === 'pending' ? `
                        <button class="btn btn-sm btn-success" onclick="adminReferral.approveCashout('${cashout.id}')">
                            承認
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="adminReferral.rejectCashout('${cashout.id}')">
                            却下
                        </button>
                    ` : ''}
                </td>
            </tr>
        `).join('');

        tbody.innerHTML = html || '<tr><td colspan="7" class="text-center">データがありません</td></tr>';
    }

    async loadFraudData() {
        // 不正フラグ一覧
        await this.loadFraudFlags();

        // IP統計
        await this.loadIPStats();
    }

    async loadFraudFlags() {
        try {
            const { data: flags } = await window.supabaseClient
                .from('fraud_flags')
                .select(`
                    *,
                    user:profiles!fraud_flags_user_id_fkey(name, email, company)
                `)
                .eq('resolved', false)
                .order('created_at', { ascending: false });

            const flagsHtml = flags?.map(flag => `
                <div class="fraud-flag-item ${flag.severity}">
                    <div class="flag-header">
                        <div class="flag-user">
                            <i class="fas fa-user"></i>
                            <span>${window.escapeHTML(flag.user?.name || '不明')} (${window.escapeHTML(flag.user?.email || '')})</span>
                        </div>
                        <div class="flag-meta">
                            <span class="severity-badge ${flag.severity}">
                                ${flag.severity === 'high' ? '高' : flag.severity === 'medium' ? '中' : '低'}
                            </span>
                            <span class="flag-type">${this.getFlagTypeText(flag.flag_type)}</span>
                        </div>
                    </div>
                    <div class="flag-details">
                        ${window.escapeHTML(flag.description || '')}
                    </div>
                    <div class="flag-actions">
                        <button class="btn btn-sm btn-primary" onclick="adminReferral.investigateUser('${flag.user_id}')">
                            調査
                        </button>
                        <button class="btn btn-sm btn-success" onclick="adminReferral.resolveFlag('${flag.id}')">
                            解決済みにする
                        </button>
                    </div>
                </div>
            `).join('') || '<p class="empty-state">不正フラグはありません</p>';

            document.getElementById('fraud-flags').innerHTML = flagsHtml;

        } catch (error) {
            console.error('不正フラグの読み込みエラー:', error);
        }
    }

    async loadIPStats() {
        try {
            const { data: ipStats } = await window.supabaseClient
                .from('ip_registration_stats')
                .select('*')
                .order('user_count', { ascending: false })
                .limit(20);

            const ipStatsHtml = ipStats?.map(stat => `
                <div class="ip-stat-item ${stat.user_count > 5 ? 'warning' : ''}">
                    <div class="ip-address">
                        <i class="fas fa-network-wired"></i>
                        <span>${window.escapeHTML(stat.ip_address)}</span>
                    </div>
                    <div class="ip-stats">
                        <span class="stat">
                            <i class="fas fa-users"></i> ${stat.user_count} ユーザー
                        </span>
                        <span class="stat">
                            <i class="fas fa-clock"></i>
                            ${this.formatDate(stat.first_registration)} 〜
                            ${this.formatDate(stat.last_registration)}
                        </span>
                    </div>
                    <button class="btn btn-sm btn-outline" onclick="adminReferral.viewIPDetails('${window.escapeAttr(stat.ip_address)}')">
                        詳細
                    </button>
                </div>
            `).join('') || '<p class="empty-state">データがありません</p>';

            document.getElementById('ip-stats').innerHTML = ipStatsHtml;

        } catch (error) {
            console.error('IP統計の読み込みエラー:', error);
        }
    }

    async loadAnalyticsData() {
        // チャートの初期化
        this.initializeCharts();

        // データの読み込み
        await this.updateAnalytics();
    }

    initializeCharts() {
        // 既存のチャートを破棄
        Object.values(this.charts).forEach(chart => chart.destroy());

        // チャート設定
        const chartOptions = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            }
        };

        // 紹介数推移チャート
        const referralsCtx = document.getElementById('referrals-chart').getContext('2d');
        this.charts.referrals = new Chart(referralsCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: '紹介数',
                    data: [],
                    borderColor: '#667eea',
                    backgroundColor: 'rgba(102, 126, 234, 0.1)',
                    tension: 0.4
                }]
            },
            options: chartOptions
        });

        // 報酬額推移チャート
        const rewardsCtx = document.getElementById('rewards-chart').getContext('2d');
        this.charts.rewards = new Chart(rewardsCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: '報酬額',
                    data: [],
                    backgroundColor: '#48bb78'
                }]
            },
            options: chartOptions
        });

        // 成功率推移チャート
        const successRateCtx = document.getElementById('success-rate-chart').getContext('2d');
        this.charts.successRate = new Chart(successRateCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: '成功率',
                    data: [],
                    borderColor: '#f56565',
                    backgroundColor: 'rgba(245, 101, 101, 0.1)',
                    tension: 0.4
                }]
            },
            options: {
                ...chartOptions,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100
                    }
                }
            }
        });

        // ユーザー別分布チャート
        const distributionCtx = document.getElementById('distribution-chart').getContext('2d');
        this.charts.distribution = new Chart(distributionCtx, {
            type: 'doughnut',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    backgroundColor: [
                        '#667eea',
                        '#48bb78',
                        '#f56565',
                        '#ed8936',
                        '#38b2ac'
                    ]
                }]
            },
            options: {
                ...chartOptions,
                plugins: {
                    legend: {
                        display: true,
                        position: 'right'
                    }
                }
            }
        });
    }

    async updateAnalytics() {
        const startDate = document.getElementById('analytics-start-date').value ||
                         new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const endDate = document.getElementById('analytics-end-date').value ||
                       new Date().toISOString().split('T')[0];

        try {
            // 分析データの取得
            const analyticsData = await window.supabaseClient
                .rpc('get_referral_analytics', {
                    start_date: startDate,
                    end_date: endDate
                });

            // チャートの更新
            this.updateChartsWithData(analyticsData.data);

        } catch (error) {
            console.error('分析データの読み込みエラー:', error);
        }
    }

    updateChartsWithData(data) {
        if (!data) return;

        // 紹介数推移
        if (data.daily_referrals) {
            this.charts.referrals.data.labels = data.daily_referrals.map(d => d.date);
            this.charts.referrals.data.datasets[0].data = data.daily_referrals.map(d => d.count);
            this.charts.referrals.update();
        }

        // 報酬額推移
        if (data.daily_rewards) {
            this.charts.rewards.data.labels = data.daily_rewards.map(d => d.date);
            this.charts.rewards.data.datasets[0].data = data.daily_rewards.map(d => d.amount);
            this.charts.rewards.update();
        }

        // 成功率推移
        if (data.success_rates) {
            this.charts.successRate.data.labels = data.success_rates.map(d => d.date);
            this.charts.successRate.data.datasets[0].data = data.success_rates.map(d => d.rate);
            this.charts.successRate.update();
        }

        // ユーザー別分布
        if (data.user_distribution) {
            this.charts.distribution.data.labels = data.user_distribution.map(d => d.name);
            this.charts.distribution.data.datasets[0].data = data.user_distribution.map(d => d.count);
            this.charts.distribution.update();
        }
    }

    setupRealtimeUpdates() {
        const client = window.supabaseClient;
        if (!client) return;

        // 紹介の更新を監視
        this._referralsChannel = client
            .channel('admin-referrals')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'invitations'
            }, () => {
                this.loadDashboardData();
            })
            .subscribe();

        // キャッシュアウトの更新を監視
        this._cashoutsChannel = client
            .channel('admin-cashouts')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'cashout_requests'
            }, () => {
                if (this.currentTab === 'cashouts') {
                    this.loadCashoutsData();
                }
            })
            .subscribe();
    }

    cleanup() {
        const client = window.supabaseClient;
        if (!client) return;
        if (this._referralsChannel) client.removeChannel(this._referralsChannel);
        if (this._cashoutsChannel) client.removeChannel(this._cashoutsChannel);
    }

    // ヘルパーメソッド
    getActivityIconClass(status) {
        const classes = {
            pending: 'pending',
            registered: 'info',
            completed: 'success',
            cancelled: 'danger'
        };
        return classes[status] || 'default';
    }

    getActivityIcon(status) {
        const icons = {
            pending: 'fas fa-clock',
            registered: 'fas fa-user-check',
            completed: 'fas fa-check-circle',
            cancelled: 'fas fa-times-circle'
        };
        return icons[status] || 'fas fa-circle';
    }

    getStatusText(status) {
        const texts = {
            pending: '招待中',
            registered: '登録済み',
            completed: '完了',
            cancelled: 'キャンセル'
        };
        return texts[status] || status;
    }

    getCashoutStatusText(status) {
        const texts = {
            pending: '申請中',
            approved: '承認済み',
            processing: '処理中',
            completed: '完了',
            rejected: '却下'
        };
        return texts[status] || status;
    }

    getFlagTypeText(type) {
        const texts = {
            duplicate_ip: '重複IP',
            rapid_registration: '大量登録',
            suspicious_pattern: '不審なパターン'
        };
        return texts[type] || type;
    }

    formatFlagDetails(details) {
        if (!details) return '';

        return Object.entries(details)
            .map(([key, value]) => `<p><strong>${window.escapeHTML(key)}:</strong> ${window.escapeHTML(String(value))}</p>`)
            .join('');
    }

    formatDate(dateString) {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleDateString('ja-JP', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatRelativeTime(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;

        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 60) return `${minutes}分前`;
        if (hours < 24) return `${hours}時間前`;
        return `${days}日前`;
    }

    showNotification(message, type = 'info') {
        // 通知表示の実装
    }

    // モーダル関連
    async viewReferralDetails(referralId) {
        // 紹介詳細をモーダルで表示
        const { data: referral } = await window.supabaseClient
            .from('invitations')
            .select(`
                *,
                inviter:profiles!invitations_inviter_id_fkey(*),
                invitee:profiles!invitations_invitee_id_fkey(*)
            `)
            .eq('id', referralId)
            .maybeSingle();

        this.showDetailModal('紹介詳細', this.renderReferralDetails(referral));
    }

    renderReferralDetails(referral) {
        return `
            <div class="detail-grid">
                <div class="detail-section">
                    <h3>紹介者情報</h3>
                    <p><strong>名前:</strong> ${window.escapeHTML(referral.inviter?.name || '不明')}</p>
                    <p><strong>会社:</strong> ${window.escapeHTML(referral.inviter?.company || '未設定')}</p>
                    <p><strong>メール:</strong> ${window.escapeHTML(referral.inviter?.email || '不明')}</p>
                </div>
                <div class="detail-section">
                    <h3>被紹介者情報</h3>
                    <p><strong>名前:</strong> ${window.escapeHTML(referral.invitee?.name || '未登録')}</p>
                    <p><strong>会社:</strong> ${window.escapeHTML(referral.invitee?.company || '未設定')}</p>
                    <p><strong>メール:</strong> ${window.escapeHTML(referral.invitee?.email || '不明')}</p>
                </div>
                <div class="detail-section">
                    <h3>紹介情報</h3>
                    <p><strong>招待コード:</strong> ${referral.invitation_code || '-'}</p>
                    <p><strong>作成日:</strong> ${this.formatDate(referral.created_at)}</p>
                    <p><strong>登録日:</strong> ${referral.registered_at ? this.formatDate(referral.registered_at) : '-'}</p>
                    <p><strong>完了日:</strong> ${referral.meeting_completed_at ? this.formatDate(referral.meeting_completed_at) : '-'}</p>
                </div>
            </div>
        `;
    }

    showDetailModal(title, content, actions = '') {
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = content;
        document.getElementById('modal-footer').innerHTML = actions || `
            <button class="btn btn-secondary" onclick="adminReferral.closeModal()">閉じる</button>
        `;
        document.getElementById('detail-modal').classList.add('show');
    }

    closeModal() {
        document.getElementById('detail-modal').classList.remove('show');
    }

    // アクション
    async approveCashout(cashoutId) {
        if (!await window.showConfirmModal('このキャッシュアウト申請を承認しますか？', { confirmLabel: '承認' })) return;

        try {
            const currentUser = await window.safeGetUser();
            if (!currentUser) return;

            const { error } = await window.supabaseClient
                .from('cashout_requests')
                .update({
                    status: 'approved',
                    approved_at: new Date().toISOString(),
                    processed_at: new Date().toISOString()
                })
                .eq('id', cashoutId);

            if (error) throw error;

            this.showNotification('キャッシュアウトを承認しました', 'success');
            this.loadCashoutsData();

        } catch (error) {
            console.error('承認エラー:', error);
            this.showNotification('承認に失敗しました', 'error');
        }
    }

    async rejectCashout(cashoutId) {
        const reason = prompt('却下理由を入力してください:');
        if (!reason) return;

        try {
            const currentUser = await window.safeGetUser();
            if (!currentUser) return;

            const { error } = await window.supabaseClient
                .from('cashout_requests')
                .update({
                    status: 'rejected',
                    rejection_reason: reason,
                    processed_at: new Date().toISOString()
                })
                .eq('id', cashoutId);

            if (error) throw error;

            // ポイントを返却
            const { data: cashout } = await window.supabaseClient
                .from('cashout_requests')
                .select('user_id, amount')
                .eq('id', cashoutId)
                .maybeSingle();

            await window.supabaseClient.rpc('add_user_points', {
                p_user_id: cashout.user_id,
                p_amount: cashout.amount
            });

            this.showNotification('キャッシュアウトを却下しました', 'success');
            this.loadCashoutsData();

        } catch (error) {
            console.error('却下エラー:', error);
            this.showNotification('却下に失敗しました', 'error');
        }
    }

    async resolveFlag(flagId) {
        if (!await window.showConfirmModal('このフラグを解決済みにしますか？', { confirmLabel: '解決済みにする' })) return;

        try {
            const currentUser = await window.safeGetUser();
            if (!currentUser) return;

            const { error } = await window.supabaseClient
                .from('fraud_flags')
                .update({
                    resolved: true,
                    resolved_at: new Date().toISOString(),
                    resolved_by: currentUser.id
                })
                .eq('id', flagId);

            if (error) throw error;

            this.showNotification('フラグを解決済みにしました', 'success');
            this.loadFraudData();

        } catch (error) {
            console.error('フラグ解決エラー:', error);
            this.showNotification('フラグの解決に失敗しました', 'error');
        }
    }

    async investigateUser(userId) {
        // ユーザー調査画面へ遷移
        window.location.href = `/admin-user-detail.html?id=${userId}`;
    }

    // データエクスポート
    async exportReferralData() {
        try {
            const { data } = await window.supabaseClient
                .from('invitations')
                .select(`
                    *,
                    inviter:profiles!invitations_inviter_id_fkey(name, email, company),
                    invitee:profiles!invitations_invitee_id_fkey(name, email, company)
                `)
                .order('created_at', { ascending: false });

            // CSVデータの作成
            const csv = this.convertToCSV(data);

            // ダウンロード
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `referral_data_${new Date().toISOString().split('T')[0]}.csv`;
            link.click();

        } catch (error) {
            console.error('エクスポートエラー:', error);
            this.showNotification('エクスポートに失敗しました', 'error');
        }
    }

    convertToCSV(data) {
        if (!data || data.length === 0) return '';

        const headers = [
            '作成日',
            '紹介者名',
            '紹介者メール',
            '紹介者会社',
            '被紹介者名',
            '被紹介者メール',
            '被紹介者会社',
            'ステータス',
            '登録日',
            '完了日'
        ];

        const rows = data.map(row => [
            this.formatDate(row.created_at),
            row.inviter?.name || '',
            row.inviter?.email || '',
            row.inviter?.company || '',
            row.invitee?.name || '',
            row.invitee?.email || '',
            row.invitee?.company || '',
            this.getStatusText(row.status),
            row.registered_at ? this.formatDate(row.registered_at) : '',
            row.meeting_completed_at ? this.formatDate(row.meeting_completed_at) : ''
        ]);

        return [headers, ...rows]
            .map(row => row.map(cell => `"${cell}"`).join(','))
            .join('\n');
    }
}

// 初期化
const adminReferral = new AdminReferralManager();

// グローバル関数
window.adminReferral = adminReferral;
window.exportReferralData = () => adminReferral.exportReferralData();
window.updateAnalytics = () => adminReferral.updateAnalytics();

// ページ離脱時にRealtime購読を解除
window.addEventListener('beforeunload', () => {
    if (adminReferral) adminReferral.cleanup();
});

// ============================================================
// Section: manual-meeting-confirmation.js
// ============================================================
/**
 * 管理者による手動面談確認機能
 */

class ManualMeetingConfirmation {
    constructor() {
        this.init();
    }

    init() {
        // 管理画面に確認ボタンを追加
        this.addConfirmationButtons();
    }

    addConfirmationButtons() {
        // 紹介一覧テーブルの各行に確認ボタンを追加
        document.querySelectorAll('.referral-row').forEach(row => {
            const status = row.dataset.status;
            const invitationId = row.dataset.invitationId;

            if (status === 'registered') {
                const actionCell = row.querySelector('.action-cell');
                const confirmBtn = document.createElement('button');
                confirmBtn.className = 'btn btn-success btn-sm';
                confirmBtn.innerHTML = '<i class="fas fa-check"></i> 面談確認';
                confirmBtn.onclick = () => this.openConfirmationModal(invitationId);
                actionCell.appendChild(confirmBtn);
            }
        });
    }

    openConfirmationModal(invitationId) {
        const modal = this.createConfirmationModal(invitationId);
        document.body.appendChild(modal);
        modal.classList.add('show');
    }

    createConfirmationModal(invitationId) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-overlay" onclick="this.parentElement.remove()"></div>
            <div class="modal-content">
                <div class="modal-header">
                    <h2>面談完了確認</h2>
                    <button class="modal-close" onclick="this.closest('.modal').remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="meeting-confirmation-form">
                        <div class="form-group">
                            <label>面談実施日時 <span class="required">*</span></label>
                            <input type="datetime-local" id="meeting-datetime" required>
                        </div>

                        <div class="form-group">
                            <label>面談方法 <span class="required">*</span></label>
                            <select id="meeting-method" required>
                                <option value="">選択してください</option>
                                <option value="zoom">Zoom</option>
                                <option value="google_meet">Google Meet</option>
                                <option value="teams">Microsoft Teams</option>
                                <option value="in_person">対面</option>
                                <option value="phone">電話</option>
                                <option value="other">その他</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label>面談時間（分） <span class="required">*</span></label>
                            <input type="number" id="meeting-duration" min="15" max="180" value="30" required>
                        </div>

                        <div class="form-group">
                            <label>確認方法 <span class="required">*</span></label>
                            <div class="checkbox-group">
                                <label>
                                    <input type="checkbox" name="verification" value="calendar_check">
                                    カレンダー確認済み
                                </label>
                                <label>
                                    <input type="checkbox" name="verification" value="recording_check">
                                    録画確認済み
                                </label>
                                <label>
                                    <input type="checkbox" name="verification" value="participant_feedback">
                                    参加者フィードバック確認済み
                                </label>
                                <label>
                                    <input type="checkbox" name="verification" value="meeting_notes">
                                    議事録確認済み
                                </label>
                            </div>
                        </div>

                        <div class="form-group">
                            <label>面談内容の要約</label>
                            <textarea id="meeting-summary" rows="4" placeholder="面談で話された内容の要約（任意）"></textarea>
                        </div>

                        <div class="form-group">
                            <label>管理者メモ <span class="required">*</span></label>
                            <textarea id="admin-notes" rows="3" required placeholder="確認の詳細や特記事項"></textarea>
                        </div>

                        <div class="alert alert-warning">
                            <i class="fas fa-exclamation-triangle"></i>
                            <strong>確認事項：</strong>
                            <ul>
                                <li>実際に面談が行われたことを確認しましたか？</li>
                                <li>紹介者と被紹介者の両方が参加しましたか？</li>
                                <li>面談時間は適切でしたか（最低15分以上）？</li>
                                <li>不正な申請の兆候はありませんか？</li>
                            </ul>
                        </div>

                        <div class="form-group">
                            <label class="checkbox-label">
                                <input type="checkbox" id="confirm-checkbox" required>
                                <span>上記の内容を確認し、報酬支払いを承認します</span>
                            </label>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">
                        キャンセル
                    </button>
                    <button class="btn btn-primary" onclick="manualConfirmation.confirmMeeting('${invitationId}', this)">
                        面談を確認して報酬を付与
                    </button>
                </div>
            </div>
        `;

        return modal;
    }

    async confirmMeeting(invitationId, button) {
        const form = document.getElementById('meeting-confirmation-form');
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        // 確認チェック
        const verificationMethods = Array.from(document.querySelectorAll('input[name="verification"]:checked'))
            .map(cb => cb.value);

        if (verificationMethods.length === 0) {
            if (window.showToast) window.showToast('少なくとも1つの確認方法を選択してください', 'warning');
            return;
        }

        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 処理中...';

        try {
            // 招待情報から被招待者IDを取得
            const { data: invData } = await window.supabaseClient
                .from('invitations')
                .select('invitee_id')
                .eq('id', invitationId)
                .maybeSingle();

            const confirmationData = {
                invitation_id: invitationId,
                user_id: invData?.invitee_id || null,
                meeting_datetime: document.getElementById('meeting-datetime').value,
                meeting_method: document.getElementById('meeting-method').value,
                duration_minutes: parseInt(document.getElementById('meeting-duration').value),
                verification_methods: verificationMethods,
                meeting_summary: document.getElementById('meeting-summary').value,
                admin_notes: document.getElementById('admin-notes').value,
                confirmed_at: new Date().toISOString()
            };

            // 1. 面談確認を記録
            const { error: confirmError } = await window.supabaseClient
                .from('meeting_confirmations')
                .insert(confirmationData);

            if (confirmError) throw confirmError;

            // 2. tl:dv会議記録をモックで作成（本来はAPIから取得）
            const { data: invitation } = await window.supabaseClient
                .from('invitations')
                .select('invitee_id, invitee:profiles!invitations_invitee_id_fkey(email)')
                .eq('id', invitationId)
                .maybeSingle();

            const { error: meetingError } = await window.supabaseClient
                .from('tldv_meeting_records')
                .insert({
                    meeting_id: `manual_${Date.now()}`,
                    invitee_email: invitation.invitee?.email || invitation.invitee_email,
                    meeting_date: confirmationData.meeting_datetime,
                    duration_minutes: confirmationData.duration_minutes,
                    is_valid: true
                });

            if (meetingError) throw meetingError;

            // 3. 報酬処理を実行
            const { data: result, error: rewardError } = await window.supabaseClient
                .rpc('process_referral_reward', { p_invitation_id: invitationId });

            if (rewardError) throw rewardError;

            // 成功通知
            this.showNotification('面談確認が完了し、報酬が付与されました', 'success');

            // モーダルを閉じる
            button.closest('.modal').remove();

            // テーブルを更新
            if (window.adminReferral) {
                window.adminReferral.loadReferralsData();
            }

        } catch (error) {
            console.error('面談確認エラー:', error);
            this.showNotification('エラーが発生しました: ' + error.message, 'error');
            button.disabled = false;
            button.innerHTML = '面談を確認して報酬を付与';
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
            <span>${message}</span>
        `;

        Object.assign(notification.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            padding: '1rem 1.5rem',
            background: type === 'success' ? '#48bb78' : '#f56565',
            color: 'white',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: '10000',
            animation: 'slideInRight 0.3s ease'
        });

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 5000);
    }
}

// 面談確認テーブルの作成
const createMeetingConfirmationsTable = `
CREATE TABLE IF NOT EXISTS meeting_confirmations (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    invitation_id UUID REFERENCES invitations(id) ON DELETE CASCADE,
    confirmed_by UUID REFERENCES auth.users(id),
    meeting_datetime TIMESTAMP WITH TIME ZONE NOT NULL,
    meeting_method TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    verification_methods TEXT[] NOT NULL,
    meeting_summary TEXT,
    admin_notes TEXT NOT NULL,
    confirmed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- インデックス
CREATE INDEX idx_meeting_confirmations_invitation_id ON meeting_confirmations(invitation_id);
CREATE INDEX idx_meeting_confirmations_confirmed_by ON meeting_confirmations(confirmed_by);

-- RLSポリシー
ALTER TABLE meeting_confirmations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins can manage meeting confirmations" ON meeting_confirmations
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
            AND profiles.is_admin = TRUE
        )
    );
`;

// グローバルに公開
window.manualConfirmation = new ManualMeetingConfirmation();
