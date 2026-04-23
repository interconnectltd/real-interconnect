/**
 * Activities Page JavaScript
 * アクティビティ一覧ページの機能実装
 */

(function() {
    'use strict';

    // 状態管理
    const state = {
        activities: [],
        filteredActivities: [],
        currentPage: 0,
        pageSize: 20,
        isLoading: false,
        filters: {
            type: '',
            period: ''
        },
        stats: {
            total: 0,
            today: 0,
            week: 0
        }
    };

    // DOM要素
    const elements = {
        activityList: document.getElementById('activityList'),
        loadingState: document.getElementById('loadingState'),
        emptyState: document.getElementById('emptyState'),
        errorState: document.getElementById('errorState'),
        loadMoreContainer: document.getElementById('loadMoreContainer'),
        loadMoreBtn: document.getElementById('loadMoreBtn'),
        filterSection: document.getElementById('filterSection'),
        filterToggle: document.getElementById('filterToggle'),
        refreshBtn: document.getElementById('refreshBtn'),
        activityTypeFilter: document.getElementById('activityTypeFilter'),
        periodFilter: document.getElementById('periodFilter'),
        applyFilter: document.getElementById('applyFilter'),
        clearFilter: document.getElementById('clearFilter'),
        totalActivities: document.getElementById('totalActivities'),
        todayActivities: document.getElementById('todayActivities'),
        weekActivities: document.getElementById('weekActivities'),
        modal: document.getElementById('activityModal'),
        modalBody: document.getElementById('modalBody')
    };

    /**
     * 初期化
     */
    async function init() {
        // console.log('[Activities] Initializing...');
        
        // イベントリスナーの設定
        setupEventListeners();
        
        // データの読み込み
        await loadActivities();
    }

    /**
     * イベントリスナーの設定
     */
    function setupEventListeners() {
        // フィルタートグル
        elements.filterToggle.addEventListener('click', toggleFilter);
        
        // リフレッシュボタン
        elements.refreshBtn.addEventListener('click', refreshActivities);
        
        // フィルター適用
        elements.applyFilter.addEventListener('click', applyFilters);
        elements.clearFilter.addEventListener('click', clearFilters);
        
        // もっと見るボタン
        elements.loadMoreBtn.addEventListener('click', loadMore);
        
        // モーダル外クリックで閉じる
        elements.modal.addEventListener('click', (e) => {
            if (e.target === elements.modal) {
                closeActivityModal();
            }
        });
    }

    /**
     * アクティビティの読み込み
     */
    async function loadActivities() {
        if (state.isLoading) return;
        
        state.isLoading = true;
        showLoadingState();
        
        try {
            // Supabaseからアクティビティを取得（activitiesテーブル）
            const { data: rawData, error } = await window.supabaseClient
                .from('activities')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(1000);

            // activitiesテーブルのカラム名をactivities.jsの想定形式に変換
            const data = (rawData || []).map(a => ({
                ...a,
                activity_type: a.type,
                activity_data: a.title ? { description: a.title } : null
            }));
            
            if (error) throw error;
            
            state.activities = data || [];
            
            // 統計を計算
            calculateStats();
            
            // フィルターを適用
            applyFiltersToData();
            
            // 最初のページを表示
            displayActivities();
            
        } catch (error) {
            console.error('[Activities] Error loading activities:', error);
            showErrorState();
        } finally {
            state.isLoading = false;
        }
    }

    /**
     * 統計の計算
     */
    function calculateStats() {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        
        state.stats.total = state.activities.length;
        state.stats.today = 0;
        state.stats.week = 0;
        
        state.activities.forEach(activity => {
            const activityDate = new Date(activity.created_at);
            
            if (activityDate >= today) {
                state.stats.today++;
            }
            if (activityDate >= weekAgo) {
                state.stats.week++;
            }
        });
        
        // UIに反映
        elements.totalActivities.textContent = state.stats.total;
        elements.todayActivities.textContent = state.stats.today;
        elements.weekActivities.textContent = state.stats.week;
    }

    /**
     * フィルターの適用
     */
    function applyFiltersToData() {
        state.filteredActivities = state.activities.filter(activity => {
            // タイプフィルター
            if (state.filters.type && activity.activity_type !== state.filters.type) {
                return false;
            }
            
            // 期間フィルター
            if (state.filters.period) {
                const activityDate = new Date(activity.created_at);
                const now = new Date();
                
                switch (state.filters.period) {
                    case 'today':
                        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                        if (activityDate < today) return false;
                        break;
                        
                    case 'week':
                        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                        if (activityDate < weekAgo) return false;
                        break;
                        
                    case 'month':
                        const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
                        if (activityDate < monthAgo) return false;
                        break;
                        
                    case '3months':
                        const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
                        if (activityDate < threeMonthsAgo) return false;
                        break;
                }
            }
            
            return true;
        });
        
        // ページをリセット
        state.currentPage = 0;
    }

    /**
     * アクティビティの表示
     */
    function displayActivities() {
        const start = 0;
        const end = (state.currentPage + 1) * state.pageSize;
        const activitiesToShow = state.filteredActivities.slice(start, end);
        
        if (activitiesToShow.length === 0) {
            showEmptyState();
            return;
        }
        
        // リストをクリア（初回のみ）
        if (state.currentPage === 0) {
            elements.activityList.innerHTML = '';
        }
        
        // アクティビティを追加
        activitiesToShow.forEach(activity => {
            const activityElement = createActivityElement(activity);
            elements.activityList.appendChild(activityElement);
        });
        
        // UIの状態を更新
        hideAllStates();
        elements.activityList.style.display = 'flex';
        
        // もっと見るボタンの表示制御
        if (end < state.filteredActivities.length) {
            elements.loadMoreContainer.style.display = 'block';
        } else {
            elements.loadMoreContainer.style.display = 'none';
        }
    }

    /**
     * アクティビティ要素の作成
     */
    function createActivityElement(activity) {
        const div = document.createElement('div');
        div.className = 'activity-item';
        div.setAttribute('data-id', activity.id);
        div.setAttribute('data-type', activity.activity_type);
        
        const icon = getActivityIcon(activity.activity_type);
        const description = getActivityDescription(activity);
        const timeAgo = formatTimeAgo(activity.created_at);
        
        div.innerHTML = `
            <div class="activity-icon">
                <i class="fas ${icon}"></i>
            </div>
            <div class="activity-content">
                <p>${window.escapeHTML ? window.escapeHTML(description) : description}</p>
                <div class="activity-meta">
                    <span class="activity-time">${timeAgo}</span>
                    <span class="activity-badge">${getActivityTypeLabel(activity.activity_type)}</span>
                </div>
            </div>
        `;
        
        // クリックイベント
        div.addEventListener('click', () => showActivityDetail(activity));
        
        return div;
    }

    /**
     * アクティビティアイコンの取得
     */
    function getActivityIcon(type) {
        const iconMap = {
            'member_join': 'fa-user-plus',
            'member_joined': 'fa-user-plus',
            'event_complete': 'fa-calendar-check',
            'event_completed': 'fa-calendar-check',
            'event_registered': 'fa-calendar-plus',
            'matching_success': 'fa-handshake',
            'connection_made': 'fa-link',
            'connect_request': 'fa-handshake',
            'profile_update': 'fa-user-edit',
            'message_sent': 'fa-envelope',
            'event_registration': 'fa-calendar-plus'
        };
        return iconMap[type] || 'fa-info-circle';
    }

    /**
     * アクティビティの説明文を取得
     */
    function getActivityDescription(activity) {
        // activity_dataがJSONB形式の場合
        if (activity.activity_data && activity.activity_data.description) {
            return activity.activity_data.description;
        }
        
        // フォールバック
        const descriptions = {
            'member_join': '新しいメンバーが参加しました',
            'event_complete': 'イベントが完了しました',
            'matching_success': 'マッチングが成立しました',
            'profile_update': 'プロフィールが更新されました',
            'message_sent': 'メッセージが送信されました',
            'event_registration': 'イベントに参加登録しました'
        };
        
        return descriptions[activity.activity_type] || activity.activity_type;
    }

    /**
     * アクティビティタイプのラベル
     */
    function getActivityTypeLabel(type) {
        const labels = {
            'member_join': '新規参加',
            'member_joined': '新規参加',
            'event_complete': 'イベント',
            'event_completed': 'イベント',
            'event_registered': 'イベント参加',
            'matching_success': 'マッチング',
            'connection_made': 'コネクト成立',
            'connect_request': 'コネクト申請',
            'profile_update': 'プロフィール',
            'message_sent': 'メッセージ',
            'event_registration': 'イベント参加'
        };
        return labels[type] || (window.escapeHTML ? window.escapeHTML(type) : type);
    }

    /**
     * 時間経過のフォーマット
     */
    function formatTimeAgo(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffMinutes < 1) return 'たった今';
        if (diffMinutes < 60) return `${diffMinutes}分前`;
        if (diffHours < 24) return `${diffHours}時間前`;
        if (diffDays < 7) return `${diffDays}日前`;
        
        return date.toLocaleDateString('ja-JP');
    }

    /**
     * アクティビティ詳細の表示
     */
    function showActivityDetail(activity) {
        const detailHTML = `
            <div class="activity-detail">
                <div class="detail-header">
                    <div class="detail-icon">
                        <i class="fas ${getActivityIcon(activity.activity_type)}"></i>
                    </div>
                    <div class="detail-info">
                        <h4>${window.escapeHTML ? window.escapeHTML(getActivityDescription(activity)) : getActivityDescription(activity)}</h4>
                        <p>${formatTimeAgo(activity.created_at)}</p>
                    </div>
                </div>
                
                <div class="detail-section">
                    <h5>アクティビティタイプ</h5>
                    <p>${getActivityTypeLabel(activity.activity_type)}</p>
                </div>
                
                <div class="detail-section">
                    <h5>日時</h5>
                    <p>${new Date(activity.created_at).toLocaleString('ja-JP')}</p>
                </div>
                
                ${activity.activity_data ? `
                    <div class="detail-section">
                        <h5>詳細情報</h5>
                        <pre style="white-space: pre-wrap;">${window.escapeHTML ? window.escapeHTML(JSON.stringify(activity.activity_data, null, 2)) : JSON.stringify(activity.activity_data, null, 2)}</pre>
                    </div>
                ` : ''}
                
                <div class="detail-section">
                    <h5>ID</h5>
                    <p style="font-family: monospace; font-size: 0.875rem;">${activity.id}</p>
                </div>
            </div>
        `;
        
        elements.modalBody.innerHTML = detailHTML;
        elements.modal.classList.add('show');
    }

    /**
     * フィルターのトグル
     */
    function toggleFilter() {
        if (elements.filterSection.style.display === 'none') {
            elements.filterSection.style.display = 'block';
        } else {
            elements.filterSection.style.display = 'none';
        }
    }

    /**
     * フィルターの適用
     */
    function applyFilters() {
        state.filters.type = elements.activityTypeFilter.value;
        state.filters.period = elements.periodFilter.value;
        
        applyFiltersToData();
        displayActivities();
        
        // フィルターセクションを閉じる
        elements.filterSection.style.display = 'none';
    }

    /**
     * フィルターのクリア
     */
    function clearFilters() {
        elements.activityTypeFilter.value = '';
        elements.periodFilter.value = '';
        
        state.filters.type = '';
        state.filters.period = '';
        
        applyFiltersToData();
        displayActivities();
    }

    /**
     * リフレッシュ
     */
    async function refreshActivities() {
        elements.refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        await loadActivities();
        elements.refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
    }

    /**
     * もっと見る
     */
    function loadMore() {
        state.currentPage++;
        displayActivities();
    }

    /**
     * UI状態の制御
     */
    function showLoadingState() {
        hideAllStates();
        elements.loadingState.style.display = 'flex';
    }

    function showEmptyState() {
        hideAllStates();
        elements.emptyState.style.display = 'flex';
    }

    function showErrorState() {
        hideAllStates();
        elements.errorState.style.display = 'flex';
    }

    function hideAllStates() {
        elements.loadingState.style.display = 'none';
        elements.emptyState.style.display = 'none';
        elements.errorState.style.display = 'none';
        elements.activityList.style.display = 'none';
        elements.loadMoreContainer.style.display = 'none';
    }

    /**
     * モーダルを閉じる
     */
    window.closeActivityModal = function() {
        elements.modal.classList.remove('show');
    };

    // Supabase準備完了後に初期化
    if (window.supabaseClient) {
        init();
    } else {
        window.addEventListener('supabaseReady', init);
    }

})();