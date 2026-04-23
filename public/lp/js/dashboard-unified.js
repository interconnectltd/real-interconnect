// ============================================================
// Section: dashboard-bundle.js
// ============================================================
/**
 * Dashboard Bundle
 * ダッシュボード関連のJavaScriptファイルを統合
 *
 * 含まれるモジュール:
 * - 初期ローディング
 * - データ処理
 * - 統計計算
 * - UI更新
 * - イベント処理
 * - モーダル管理
 */

(function() {
    'use strict';

    // ===================================
    // 初期ローディング
    // ===================================
    class DashboardLoader {
        constructor() {
            this.modules = new Map();
            this.loadOrder = [
                'stats',
                'events',
                'activities',
                'charts',
                'ui'
            ];
        }

        async init() {

            // 各モジュールを順番に初期化
            for (const moduleName of this.loadOrder) {
                await this.loadModule(moduleName);
            }

        }

        async loadModule(name) {
            try {
                switch (name) {
                    case 'stats':
                        this.modules.set('stats', new DashboardStats());
                        break;
                    case 'events':
                        this.modules.set('events', new DashboardEvents());
                        break;
                    case 'activities':
                        this.modules.set('activities', new DashboardActivities());
                        break;
                    case 'charts':
                        if (window.DashboardCharts) {
                            // 既存のチャートモジュールを使用
                            this.modules.set('charts', window.dashboardCharts);
                        }
                        break;
                    case 'ui':
                        this.modules.set('ui', new DashboardUI());
                        break;
                }
            } catch (error) {
                console.error(`[DashboardLoader] Error loading module ${name}:`, error);
            }
        }

        getModule(name) {
            return this.modules.get(name);
        }
    }

    // ===================================
    // 統計管理
    // ===================================
    class DashboardStats {
        constructor() {
            this.stats = {
                totalMembers: 0,
                monthlyEvents: 0,
                matchingSuccess: 0
            };
            this.init();
        }

        async init() {
            await this.loadStats();
            this.updateUI();
        }

        async loadStats() {
            try {
                if (!window.supabaseClient) return;

                // Calculator群が存在する場合はそちらに任せる（重複APIコール防止）
                if (window.dashboardMemberCalculator || window.dashboardEventCalculator || window.dashboardMatchingCalculator) {
                    return;
                }

                // メンバー数を取得
                const { count: memberCount } = await window.supabaseClient
                    .from('user_profiles')
                    .select('*', { count: 'exact', head: true });

                this.stats.totalMembers = memberCount || 0;

                // 今月のイベント数を取得
                const currentMonth = new Date().getMonth();
                const currentYear = new Date().getFullYear();

                const { data: events } = await window.supabaseClient
                    .from('events')
                    .select('*')
                    .gte('event_date', `${currentYear}-${(currentMonth + 1).toString().padStart(2, '0')}-01`)
                    .lte('event_date', `${currentYear}-${(currentMonth + 1).toString().padStart(2, '0')}-31`);

                this.stats.monthlyEvents = events?.length || 0;

                // マッチング成功数は0で初期化（Calculatorが後から正確な値を設定する）
                this.stats.matchingSuccess = 0;

            } catch (error) {
                console.error('[DashboardStats] Error loading stats:', error);
            }
        }

        updateUI() {
            // 統計値を更新（0の場合は「--」を表示）
            const statElements = {
                totalMembers: document.querySelector('.stat-card:nth-child(1) .stat-value'),
                monthlyEvents: document.querySelector('.stat-card:nth-child(2) .stat-value'),
                matchingSuccess: document.querySelector('.stat-card:nth-child(3) .stat-value')
            };

            Object.entries(statElements).forEach(([key, element]) => {
                if (element) {
                    const value = this.stats[key];
                    element.textContent = value > 0 ? value.toLocaleString() : '--';
                }
            });
        }
    }

    // ===================================
    // イベント管理
    // ===================================
    class DashboardEvents {
        constructor() {
            this.events = [];
            this.init();
        }

        async init() {
            await this.loadEvents();
            this.setupEventListeners();
        }

        async loadEvents() {
            try {
                if (!window.supabaseClient) return;

                const { data: events } = await window.supabaseClient
                    .from('events')
                    .select('*')
                    .eq('is_public', true)
                    .eq('is_cancelled', false)
                    .gte('event_date', new Date().toISOString())
                    .order('event_date', { ascending: true })
                    .limit(5);

                this.events = events || [];
                this.renderEvents();

            } catch (error) {
                console.error('[DashboardEvents] Error loading events:', error);
                this.events = [];
                this.renderEvents();
            }
        }

        renderEvents() {
            const container = document.querySelector('.event-list');
            if (!container) return;

            if (this.events.length === 0) {
                container.innerHTML = '<div class="empty-state"><i class="fas fa-calendar-alt"></i><p>予定されているイベントはありません</p><a href="events.html" class="btn btn-primary btn-small" style="margin-top:12px;">イベントを見る</a></div>';
                return;
            }

            container.innerHTML = this.events.map(event => {
                const date = new Date(event.event_date);
                return `
                    <div class="event-item" data-event-id="${event.id}">
                        <div class="event-date">
                            <div class="date">${date.getDate()}</div>
                            <div class="month">${date.getMonth() + 1}月</div>
                        </div>
                        <div class="event-details">
                            <h4>${this.escapeHtml(event.title)}</h4>
                            <p>${event.start_time}〜 ${event.event_type === 'online' ? 'オンライン開催' : this.escapeHtml(event.location || '')}</p>
                            <button class="btn-small btn-primary" onclick="dashboardBundle.showEventDetails(${event.id})">詳細を見る</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        setupEventListeners() {
            // イベント詳細モーダルの設定
            document.addEventListener('click', (e) => {
                if (e.target.matches('.event-item button')) {
                    const eventId = e.target.closest('.event-item').dataset.eventId;
                    this.showEventDetails(eventId);
                }
            });
        }

        showEventDetails(eventId) {
            const event = this.events.find(e => e.id == eventId);
            if (!event) return;

            // モーダル表示（既存のモーダル機能を使用）
            if (window.dashboardUI && window.dashboardUI.showEventModal) {
                window.dashboardUI.showEventModal(event);
            }
        }

        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    }

    // ===================================
    // アクティビティ管理
    // ===================================
    class DashboardActivities {
        constructor() {
            this.activities = [];
            this.init();
        }

        async init() {
            await this.loadActivities();
        }

        async loadActivities() {
            // activity-event-filter.jsの機能を使用
            if (window.activityEventFilter) {
                return; // 既存の実装を使用
            }

            // フォールバック: 空状態を表示
            const container = document.querySelector('.activity-list');
            if (container) {
                container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>まだアクティビティがありません</p><a href="matching.html" class="btn btn-primary btn-small" style="margin-top:12px;">マッチングを始める</a></div>';
            }
        }
    }

    // ===================================
    // UI管理
    // ===================================
    class DashboardUI {
        constructor() {
            this.init();
        }

        init() {
            this.setupEventModal();
            this.setupSidebarToggle();
        }

        setupEventModal() {
            // 既存のモーダル機能を統合
            this.modalOverlay = document.querySelector('.modal-overlay');
            this.modal = document.getElementById('eventDetailModal');
        }

        showEventModal(event) {
            if (!this.modal) return;

            const modalTitle = document.getElementById('modalEventTitle');
            const modalBody = document.getElementById('modalEventBody');

            if (modalTitle) modalTitle.textContent = event.title;
            if (modalBody) {
                // DOM構築（XSS防止のためinnerHTMLを使わない）
                modalBody.innerHTML = '';

                const datePara = document.createElement('p');
                const dateLabel = document.createElement('strong');
                dateLabel.textContent = '日時:';
                datePara.appendChild(dateLabel);
                datePara.appendChild(document.createTextNode(
                    ` ${new Date(event.event_date).toLocaleDateString('ja-JP')} ${event.start_time || ''}〜`
                ));
                modalBody.appendChild(datePara);

                const typePara = document.createElement('p');
                const typeLabel = document.createElement('strong');
                typeLabel.textContent = '形式:';
                typePara.appendChild(typeLabel);
                typePara.appendChild(document.createTextNode(
                    ` ${event.event_type === 'online' ? 'オンライン' : 'オフライン'}`
                ));
                modalBody.appendChild(typePara);

                if (event.description) {
                    const descPara = document.createElement('p');
                    const descLabel = document.createElement('strong');
                    descLabel.textContent = '説明:';
                    descPara.appendChild(descLabel);
                    descPara.appendChild(document.createTextNode(` ${event.description}`));
                    modalBody.appendChild(descPara);
                }
            }

            this.modal.classList.add('show');
        }

        closeEventModal() {
            if (this.modal) {
                this.modal.classList.remove('show');
            }
        }

        setupSidebarToggle() {
            const toggle = document.querySelector('.sidebar-toggle');
            const sidebar = document.querySelector('.sidebar');

            if (toggle && sidebar) {
                toggle.addEventListener('click', () => {
                    sidebar.classList.toggle('collapsed');
                });
            }
        }
    }

    // ===================================
    // バンドルの初期化
    // ===================================
    class DashboardBundle {
        constructor() {
            this.loader = new DashboardLoader();
            this.init();
        }

        async init() {
            await this.loader.init();

            // UIモジュールをグローバルに公開（Calculator群のモンキーパッチで参照される）
            window.dashboardUI = this.loader.getModule('ui');

            // グローバルメソッドを公開
            this.exposeMethods();
        }

        exposeMethods() {
            // 外部から呼び出せるメソッドを公開
            window.dashboardBundle = {
                showEventDetails: (eventId) => {
                    const events = this.loader.getModule('events');
                    if (events) events.showEventDetails(eventId);
                },
                closeEventModal: () => {
                    const ui = this.loader.getModule('ui');
                    if (ui) ui.closeEventModal();
                },
                refreshStats: async () => {
                    const stats = this.loader.getModule('stats');
                    if (stats) await stats.loadStats();
                }
            };
        }
    }

    // ページ離脱時のクリーンアップ
    function cleanupOnUnload() {
        // Chart.jsインスタンスの破棄
        if (window.dashboardCharts && window.dashboardCharts.charts) {
            Object.values(window.dashboardCharts.charts).forEach(chart => {
                if (chart && typeof chart.destroy === 'function') {
                    chart.destroy();
                }
            });
        }
        // DashboardUpcomingEventsの定期更新を停止
        if (window.dashboardUpcomingEvents && window.dashboardUpcomingEvents.updateInterval) {
            clearInterval(window.dashboardUpcomingEvents.updateInterval);
        }
    }

    window.addEventListener('beforeunload', cleanupOnUnload);

    // DOMContentLoaded時に初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            new DashboardBundle();
        });
    } else {
        new DashboardBundle();
    }

})();

// Section: dashboard-event-fix.js は削除済み
// DashboardEvents/DashboardCalculatorはIIFEスコープ内のクラスであり、
// window.DashboardEvents.prototypeは存在しないためパッチは無効だった。
// イベント取得はDashboardEvents.loadEvents()とDashboardUpcomingEventsが担当。

// ============================================================
// Section: dashboard-stats-initializer.js
// ============================================================
/**
 * Dashboard Stats Initializer
 * ダッシュボードの統計情報を初期化時に「読み込み中」状態にする
 */

(function() {
    'use strict';

    class DashboardStatsInitializer {
        constructor() {
            this.initialized = false;
        }

        /**
         * 統計カードを初期化
         */
        init() {
            if (this.initialized) return;


            // 各統計カードを「読み込み中」状態に設定
            this.setLoadingState();

            this.initialized = true;
        }

        /**
         * 読み込み中状態を設定
         */
        setLoadingState() {
            // 総メンバー数カード
            const memberCard = document.querySelector('.stats-container .stat-card:nth-child(1)');
            if (memberCard) {
                const statValue = memberCard.querySelector('.stat-value');
                const changeSpan = memberCard.querySelector('.stat-change span');

                if (statValue) {
                    statValue.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    statValue.style.fontSize = '24px';
                }
                if (changeSpan) {
                    changeSpan.textContent = '計算中...';
                }
            }

            // 今月のイベントカード
            const eventCard = document.querySelector('.stats-container .stat-card:nth-child(2)');
            if (eventCard) {
                const statValue = eventCard.querySelector('.stat-value');
                const changeSpan = eventCard.querySelector('.stat-change span');

                if (statValue) {
                    statValue.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    statValue.style.fontSize = '24px';
                }
                if (changeSpan) {
                    changeSpan.textContent = '計算中...';
                }
            }

            // マッチング成功数カード
            const matchingCard = document.querySelector('.stats-container .stat-card:nth-child(3)');
            if (matchingCard) {
                const statValue = matchingCard.querySelector('.stat-value');
                const changeSpan = matchingCard.querySelector('.stat-change span');

                if (statValue) {
                    statValue.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    statValue.style.fontSize = '24px';
                }
                if (changeSpan) {
                    changeSpan.textContent = '計算中...';
                }
            }
        }

        /**
         * エラー状態を設定
         */
        setErrorState(cardIndex, message = 'エラー') {
            const card = document.querySelector(`.stats-container .stat-card:nth-child(${cardIndex})`);
            if (!card) return;

            const statValue = card.querySelector('.stat-value');
            const changeSpan = card.querySelector('.stat-change span');
            const changeContainer = card.querySelector('.stat-change');

            if (statValue) {
                statValue.innerHTML = '--';
                statValue.style.fontSize = '';
            }
            if (changeSpan) {
                changeSpan.textContent = message;
            }
            if (changeContainer) {
                changeContainer.className = 'stat-change neutral';
            }
        }

        /**
         * 統計値を設定（アニメーション付き）
         */
        setStatValue(cardIndex, value, changeText, changeType = 'neutral') {
            const card = document.querySelector(`.stats-container .stat-card:nth-child(${cardIndex})`);
            if (!card) return;

            const statValue = card.querySelector('.stat-value');
            const changeSpan = card.querySelector('.stat-change span');
            const changeContainer = card.querySelector('.stat-change');
            const changeIcon = changeContainer?.querySelector('i');

            if (statValue) {
                // 元のフォントサイズに戻す
                statValue.style.fontSize = '';

                // カウントアップアニメーション
                this.animateValue(statValue, 0, value, 1000);
            }

            if (changeSpan) {
                changeSpan.textContent = changeText;
            }

            if (changeContainer) {
                changeContainer.className = `stat-change ${changeType}`;

                // アイコンも更新
                if (changeIcon) {
                    if (changeType === 'positive') {
                        changeIcon.className = 'fas fa-arrow-up';
                    } else if (changeType === 'negative') {
                        changeIcon.className = 'fas fa-arrow-down';
                    } else {
                        changeIcon.className = 'fas fa-minus';
                    }
                }
            }
        }

        /**
         * 数値アニメーション
         */
        animateValue(element, start, end, duration) {
            const startTime = performance.now();
            const endTime = startTime + duration;

            const update = () => {
                const now = performance.now();
                const progress = Math.min((now - startTime) / duration, 1);

                // イージング関数（ease-out）
                const easeOut = 1 - Math.pow(1 - progress, 3);
                const current = Math.floor(start + (end - start) * easeOut);

                element.textContent = this.formatNumber(current);

                if (progress < 1) {
                    requestAnimationFrame(update);
                } else {
                    element.textContent = this.formatNumber(end);
                }
            };

            requestAnimationFrame(update);
        }

        /**
         * 数値をフォーマット（3桁区切り）
         */
        formatNumber(num) {
            return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        }
    }

    // グローバルに公開
    window.dashboardStatsInitializer = new DashboardStatsInitializer();

    // 即座に初期化（DOMContentLoadedを待たない）
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.dashboardStatsInitializer.init();
        });
    } else {
        // 既に読み込み済みの場合は少し遅延して実行
        setTimeout(() => {
            window.dashboardStatsInitializer.init();
        }, 10);
    }


})();

// ============================================================
// Section: dashboard-member-calculator.js
// ============================================================
/**
 * Dashboard Member Calculator
 * メンバー統計の正確な計算
 */

(function() {
    'use strict';

    class DashboardMemberCalculator {
        constructor() {
            this.cache = new Map();
            this.cacheTTL = 30000; // 30秒
        }

        /**
         * メンバー統計を計算
         */
        async calculateMemberStats() {

            try {
                // 総メンバー数と先月の新規メンバー数を並行で取得
                const [totalMembers, lastMonthNewMembers, thisMonthNewMembers] = await Promise.all([
                    this.getTotalMemberCount(),
                    this.getMonthlyNewMembers(-1),  // 先月
                    this.getMonthlyNewMembers(0)     // 今月
                ]);

                // 前月比の計算
                let memberChangePercentage = 0;
                if (totalMembers > 0 && lastMonthNewMembers > 0) {
                    // 今月の新規メンバー数を先月と比較
                    memberChangePercentage = Math.round((thisMonthNewMembers / lastMonthNewMembers - 1) * 100);
                } else if (thisMonthNewMembers > 0) {
                    memberChangePercentage = 100;
                }

                // 変化のタイプを判定
                let changeType = 'neutral';
                if (memberChangePercentage > 0) {
                    changeType = 'positive';
                } else if (memberChangePercentage < 0) {
                    changeType = 'negative';
                }

                const stats = {
                    total_members: totalMembers,
                    new_members_this_month: thisMonthNewMembers,
                    new_members_last_month: lastMonthNewMembers,
                    member_change_percentage: Math.abs(memberChangePercentage),
                    member_change_type: changeType,
                    member_change_text: `${Math.abs(memberChangePercentage)}% 前月比`,
                    calculated_at: new Date().toISOString()
                };

                return stats;

            } catch (error) {
                console.error('[MemberCalculator] エラー:', error);
                return {
                    total_members: 0,
                    member_change_percentage: 0,
                    member_change_type: 'neutral',
                    member_change_text: 'エラー'
                };
            }
        }

        /**
         * 総メンバー数を取得
         */
        async getTotalMemberCount() {
            const cacheKey = 'total_members';

            // キャッシュチェック
            const cached = this.cache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
                return cached.value;
            }

            try {
                const { count, error } = await window.supabaseClient
                    .from('user_profiles')
                    .select('*', { count: 'exact', head: true });

                if (error) {
                    console.error('[MemberCalculator] プロファイル取得エラー:', error);
                    return 0;
                }

                const memberCount = count || 0;

                // キャッシュに保存
                this.cache.set(cacheKey, {
                    value: memberCount,
                    timestamp: Date.now()
                });

                return memberCount;

            } catch (error) {
                console.error('[MemberCalculator] getTotalMemberCount エラー:', error);
                return 0;
            }
        }

        /**
         * 特定月の新規メンバー数を取得
         */
        async getMonthlyNewMembers(monthOffset = 0) {
            const cacheKey = `new_members_month_${monthOffset}`;

            // キャッシュチェック
            const cached = this.cache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
                return cached.value;
            }

            try {
                const now = new Date();
                const targetMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
                const nextMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 1);

                // 月の開始日と終了日
                const startDate = this.formatDate(targetMonth);
                const endDate = this.formatDate(new Date(nextMonth - 1));


                const { count, error } = await window.supabaseClient
                    .from('user_profiles')
                    .select('*', { count: 'exact', head: true })
                    .gte('created_at', startDate)
                    .lte('created_at', endDate);

                if (error) {
                    console.error(`[MemberCalculator] 新規メンバー取得エラー:`, error);
                    return 0;
                }

                const newMemberCount = count || 0;

                // キャッシュに保存
                this.cache.set(cacheKey, {
                    value: newMemberCount,
                    timestamp: Date.now()
                });

                return newMemberCount;

            } catch (error) {
                console.error('[MemberCalculator] getMonthlyNewMembers エラー:', error);
                return 0;
            }
        }

        /**
         * 日付をYYYY-MM-DD形式にフォーマット
         */
        formatDate(date) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }
    }

    // グローバルに公開
    window.dashboardMemberCalculator = new DashboardMemberCalculator();

    // DashboardUIと統合
    if (window.dashboardUI) {
        const originalUpdateStatCards = window.dashboardUI.updateStatCards;

        window.dashboardUI.updateStatCards = async function(stats) {
            try {
                // メンバー統計を計算
                const memberStats = await window.dashboardMemberCalculator.calculateMemberStats();

                // 統計をマージ
                const enhancedStats = {
                    ...stats,
                    total_members: memberStats.total_members,
                    member_change_percentage: memberStats.member_change_percentage,
                    member_change_text: memberStats.member_change_text,
                    member_change_type: memberStats.member_change_type
                };

                // メンバーカード専用の更新
                const memberCard = document.querySelector('.stats-container .stat-card:nth-child(1)');
                if (memberCard) {
                    const statValue = memberCard.querySelector('.stat-value');
                    const changeSpan = memberCard.querySelector('.stat-change span');
                    const changeContainer = memberCard.querySelector('.stat-change');
                    const changeIcon = changeContainer?.querySelector('i');

                    if (statValue) {
                        // アニメーション付きで値を設定
                        if (window.dashboardStatsInitializer) {
                            window.dashboardStatsInitializer.setStatValue(
                                1,
                                memberStats.total_members,
                                memberStats.member_change_text,
                                memberStats.member_change_type
                            );
                        } else {
                            statValue.textContent = memberStats.total_members.toLocaleString();
                        }
                    }

                    if (changeSpan) {
                        changeSpan.textContent = memberStats.member_change_text;
                    }

                    if (changeContainer) {
                        changeContainer.className = `stat-change ${memberStats.member_change_type}`;

                        // アイコンも更新
                        if (changeIcon) {
                            if (memberStats.member_change_type === 'positive') {
                                changeIcon.className = 'fas fa-arrow-up';
                            } else if (memberStats.member_change_type === 'negative') {
                                changeIcon.className = 'fas fa-arrow-down';
                            } else {
                                changeIcon.className = 'fas fa-minus';
                            }
                        }
                    }
                }

                // 元の関数を呼び出し
                return originalUpdateStatCards.call(this, enhancedStats);

            } catch (error) {
                console.error('[MemberCalculator] updateStatCards エラー:', error);
                return originalUpdateStatCards.call(this, stats);
            }
        }.bind(window.dashboardUI);
    }


})();

// ============================================================
// Section: dashboard-event-calculator.js
// ============================================================
/**
 * Dashboard Event Calculator
 * イベント統計の正確な計算
 */

(function() {
    'use strict';

    class DashboardEventCalculator {
        constructor() {
            this.cache = new Map();
            this.cacheTTL = 30000; // 30秒
        }

        /**
         * イベント統計を計算
         */
        async calculateEventStats() {

            try {
                // 今月と先月のイベント数を並行で取得
                const [currentMonthEvents, lastMonthEvents] = await Promise.all([
                    this.getMonthlyEventCount(0),  // 今月
                    this.getMonthlyEventCount(-1)   // 先月
                ]);

                // イベント増減数
                const eventIncrease = currentMonthEvents - lastMonthEvents;

                // 増減率を計算
                let eventIncreasePercentage = 0;
                if (lastMonthEvents > 0) {
                    eventIncreasePercentage = Math.round((eventIncrease / lastMonthEvents) * 100);
                } else if (currentMonthEvents > 0) {
                    eventIncreasePercentage = 100; // 先月0で今月イベントがある場合は100%増
                }

                // 増減の表示テキストを生成
                let eventChangeText = '';
                let changeType = 'neutral';

                if (eventIncrease > 0) {
                    eventChangeText = `${eventIncrease}イベント増加`;
                    changeType = 'positive';
                } else if (eventIncrease < 0) {
                    eventChangeText = `${Math.abs(eventIncrease)}イベント減少`;
                    changeType = 'negative';
                } else {
                    eventChangeText = '変化なし';
                    changeType = 'neutral';
                }

                const stats = {
                    monthly_events: currentMonthEvents,
                    last_month_events: lastMonthEvents,
                    event_increase: eventIncrease,
                    event_increase_percentage: eventIncreasePercentage,
                    event_change_text: eventChangeText,
                    event_change_type: changeType,
                    calculated_at: new Date().toISOString()
                };

                return stats;

            } catch (error) {
                console.error('[EventCalculator] エラー:', error);
                return {
                    monthly_events: 0,
                    last_month_events: 0,
                    event_increase: 0,
                    event_increase_percentage: 0,
                    event_change_text: 'エラー',
                    event_change_type: 'neutral'
                };
            }
        }

        /**
         * 特定月のイベント数を取得
         * @param {number} monthOffset - 0は今月、-1は先月
         */
        async getMonthlyEventCount(monthOffset = 0) {
            const cacheKey = `events_month_${monthOffset}`;

            // キャッシュチェック
            const cached = this.cache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
                return cached.value;
            }

            try {
                const now = new Date();
                const targetMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
                const nextMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 1);

                // 月の開始日と終了日
                const startDate = this.formatDate(targetMonth);
                const endDate = this.formatDate(new Date(nextMonth - 1));


                // event_dateカラムを使用（正規スキーマ）
                const { count, error } = await window.supabaseClient
                    .from('events')
                    .select('*', { count: 'exact', head: true })
                    .gte('event_date', startDate)
                    .lte('event_date', endDate);

                if (error) {
                    console.error(`[EventCalculator] イベント取得エラー:`, error);
                    return 0;
                }

                const eventCount = count || 0;

                // キャッシュに保存
                this.cache.set(cacheKey, {
                    value: eventCount,
                    timestamp: Date.now()
                });

                return eventCount;

            } catch (error) {
                console.error('[EventCalculator] getMonthlyEventCount エラー:', error);
                return 0;
            }
        }

        /**
         * 日付をYYYY-MM-DD形式にフォーマット
         */
        formatDate(date) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        /**
         * イベントテーブルの構造を確認
         */
        async checkEventTableStructure() {
            try {
                const { data, error } = await window.supabaseClient
                    .from('events')
                    .select('*')
                    .limit(1);

                if (!error && data && data.length > 0) {
                    const columns = Object.keys(data[0]);

                    return {
                        hasEventDate: columns.includes('event_date'),
                        hasDate: columns.includes('date'),
                        columns: columns
                    };
                }

                return null;
            } catch (error) {
                console.error('[EventCalculator] テーブル構造確認エラー:', error);
                return null;
            }
        }
    }

    // グローバルに公開
    window.dashboardEventCalculator = new DashboardEventCalculator();

    // DashboardUIと統合
    if (window.dashboardUI) {
        const originalUpdateStatCards = window.dashboardUI.updateStatCards;

        window.dashboardUI.updateStatCards = async function(stats) {
            try {
                // イベント統計を計算
                const eventStats = await window.dashboardEventCalculator.calculateEventStats();

                // 統計をマージ
                const enhancedStats = {
                    ...stats,
                    monthly_events: eventStats.monthly_events,
                    event_increase: eventStats.event_increase,
                    event_change_text: eventStats.event_change_text,
                    event_change_type: eventStats.event_change_type
                };

                // イベントカード専用の更新
                const eventCard = document.querySelector('.stats-container .stat-card:nth-child(2)');
                if (eventCard) {
                    const statValue = eventCard.querySelector('.stat-value');
                    const changeSpan = eventCard.querySelector('.stat-change span');
                    const changeContainer = eventCard.querySelector('.stat-change');

                    if (statValue) {
                        statValue.textContent = eventStats.monthly_events;
                    }

                    if (changeSpan) {
                        changeSpan.textContent = eventStats.event_change_text;
                    }

                    if (changeContainer) {
                        changeContainer.className = `stat-change ${eventStats.event_change_type}`;
                    }
                }

                // 元の関数を呼び出し
                return originalUpdateStatCards.call(this, enhancedStats);

            } catch (error) {
                console.error('[EventCalculator] updateStatCards エラー:', error);
                return originalUpdateStatCards.call(this, stats);
            }
        }.bind(window.dashboardUI);
    }


})();

// ============================================================
// Section: dashboard-matching-calculator.js
// ============================================================
/**
 * Dashboard Matching Calculator
 * マッチング統計の正確な計算
 */

(function() {
    'use strict';

    class DashboardMatchingCalculator {
        constructor() {
            this.cache = new Map();
            this.cacheTTL = 30000; // 30秒
        }

        /**
         * マッチング統計を計算
         */
        async calculateMatchingStats() {

            try {
                // 今月と先月のマッチング数を並行で取得
                const [currentMonthMatches, lastMonthMatches] = await Promise.all([
                    this.getMonthlyMatchingCount(0),  // 今月
                    this.getMonthlyMatchingCount(-1)   // 先月
                ]);

                // 総マッチング成功数も取得
                const totalMatches = await this.getTotalMatchingCount();

                // 増減率を計算
                let matchingIncreasePercentage = 0;
                if (lastMonthMatches > 0) {
                    matchingIncreasePercentage = Math.round(((currentMonthMatches - lastMonthMatches) / lastMonthMatches) * 100);
                } else if (currentMonthMatches > 0) {
                    matchingIncreasePercentage = 100;
                }

                // 増減の表示テキストを生成
                let changeType = 'neutral';
                if (matchingIncreasePercentage > 0) {
                    changeType = 'positive';
                } else if (matchingIncreasePercentage < 0) {
                    changeType = 'negative';
                }

                const stats = {
                    matching_success: totalMatches,
                    monthly_matches: currentMonthMatches,
                    last_month_matches: lastMonthMatches,
                    matching_increase_percentage: Math.abs(matchingIncreasePercentage),
                    matching_change_type: changeType,
                    matching_change_text: `${Math.abs(matchingIncreasePercentage)}% ${matchingIncreasePercentage >= 0 ? '増加' : '減少'}`,
                    calculated_at: new Date().toISOString()
                };

                return stats;

            } catch (error) {
                console.error('[MatchingCalculator] エラー:', error);
                return {
                    matching_success: 0,
                    monthly_matches: 0,
                    matching_increase_percentage: 0,
                    matching_change_type: 'neutral',
                    matching_change_text: 'データなし'
                };
            }
        }

        /**
         * 総マッチング成功数を取得
         */
        async getTotalMatchingCount() {
            const cacheKey = 'total_matching_count';

            // キャッシュチェック
            const cached = this.cache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
                return cached.value;
            }

            try {
                // まずmatchingsテーブルを試す
                let { count, error } = await window.supabaseClient
                    .from('matchings')
                    .select('*', { count: 'exact', head: true });

                if (error) {
                    // user_activitiesテーブル: 個人のアクティビティログ（フォールバック）
                    const result = await window.supabaseClient
                        .from('user_activities')
                        .select('*', { count: 'exact', head: true })
                        .in('activity_type', ['matching_success', 'matching']);

                    count = result.count;
                    error = result.error;
                }

                const matchingCount = count || 0;

                // キャッシュに保存
                this.cache.set(cacheKey, {
                    value: matchingCount,
                    timestamp: Date.now()
                });

                return matchingCount;

            } catch (error) {
                console.error('[MatchingCalculator] getTotalMatchingCount エラー:', error);
                return 0;
            }
        }

        /**
         * 特定月のマッチング数を取得
         */
        async getMonthlyMatchingCount(monthOffset = 0) {
            const cacheKey = `matching_month_${monthOffset}`;

            // キャッシュチェック
            const cached = this.cache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
                return cached.value;
            }

            try {
                const now = new Date();
                const targetMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
                const nextMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 1);

                // 月の開始日と終了日
                const startDate = this.formatDate(targetMonth);
                const endDate = this.formatDate(new Date(nextMonth - 1));


                // まずmatchingsビューを試す（statusカラムなし）
                let { count, error } = await window.supabaseClient
                    .from('matchings')
                    .select('*', { count: 'exact', head: true })
                    .gte('created_at', startDate)
                    .lte('created_at', endDate);

                if (error) {
                    // user_activitiesテーブル: 個人のアクティビティログ（フォールバック）
                    const result = await window.supabaseClient
                        .from('user_activities')
                        .select('*', { count: 'exact', head: true })
                        .in('activity_type', ['matching_success', 'matching'])
                        .gte('created_at', startDate)
                        .lte('created_at', endDate);

                    count = result.count;
                    error = result.error;
                }

                const matchingCount = count || 0;

                // キャッシュに保存
                this.cache.set(cacheKey, {
                    value: matchingCount,
                    timestamp: Date.now()
                });
                return matchingCount;

            } catch (error) {
                console.error('[MatchingCalculator] getMonthlyMatchingCount エラー:', error);
                return 0;
            }
        }

        /**
         * 日付をYYYY-MM-DD形式にフォーマット
         */
        formatDate(date) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        /**
         * マッチングテーブルの構造を確認
         */
        async checkMatchingTableStructure() {
            try {
                // matchingsテーブル
                const { data: matchingData, error: matchingError } = await window.supabaseClient
                    .from('matchings')
                    .select('*')
                    .limit(1);

                if (!matchingError && matchingData && matchingData.length > 0) {
                } else {
                }

                // user_activitiesのマッチング関連データ
                const { data: activityData } = await window.supabaseClient
                    .from('user_activities')
                    .select('*')
                    .in('activity_type', ['matching_success', 'matching'])
                    .limit(5);

                if (activityData && activityData.length > 0) {
                }

            } catch (error) {
                console.error('[MatchingCalculator] テーブル構造確認エラー:', error);
            }
        }
    }

    // グローバルに公開
    window.dashboardMatchingCalculator = new DashboardMatchingCalculator();

    // DashboardUIと統合
    if (window.dashboardUI) {
        const originalUpdateStatCards = window.dashboardUI.updateStatCards;

        window.dashboardUI.updateStatCards = async function(stats) {
            try {
                // マッチング統計を計算
                const matchingStats = await window.dashboardMatchingCalculator.calculateMatchingStats();

                // 統計をマージ
                const enhancedStats = {
                    ...stats,
                    matching_success: matchingStats.matching_success,
                    matching_increase_percentage: matchingStats.matching_increase_percentage,
                    matching_change_text: matchingStats.matching_change_text,
                    matching_change_type: matchingStats.matching_change_type
                };

                // マッチングカード専用の更新
                const matchingCard = document.querySelector('.stats-container .stat-card:nth-child(3)');
                if (matchingCard) {
                    const statValue = matchingCard.querySelector('.stat-value');
                    const changeSpan = matchingCard.querySelector('.stat-change span');
                    const changeContainer = matchingCard.querySelector('.stat-change');
                    const changeIcon = changeContainer?.querySelector('i');

                    if (statValue) {
                        statValue.textContent = matchingStats.matching_success;
                    }

                    if (changeSpan) {
                        changeSpan.textContent = matchingStats.matching_change_text;
                    }

                    if (changeContainer) {
                        changeContainer.className = `stat-change ${matchingStats.matching_change_type}`;

                        // アイコンも更新
                        if (changeIcon) {
                            if (matchingStats.matching_change_type === 'positive') {
                                changeIcon.className = 'fas fa-arrow-up';
                            } else if (matchingStats.matching_change_type === 'negative') {
                                changeIcon.className = 'fas fa-arrow-down';
                            } else {
                                changeIcon.className = 'fas fa-minus';
                            }
                        }
                    }
                }

                // 元の関数を呼び出し
                return originalUpdateStatCards.call(this, enhancedStats);

            } catch (error) {
                console.error('[MatchingCalculator] updateStatCards エラー:', error);
                return originalUpdateStatCards.call(this, stats);
            }
        }.bind(window.dashboardUI);
    }


})();

// ============================================================
// Section: dashboard-upcoming-events.js
// ============================================================
/**
 * Dashboard Upcoming Events
 * 今後のイベントをデータベースから動的に取得・表示
 */

(function() {
    'use strict';

    class DashboardUpcomingEvents {
        constructor() {
            this.container = null;
            this.eventCache = null;
            this.cacheTime = null;
            this.cacheTTL = 60000; // 1分間キャッシュ
        }

        /**
         * 初期化
         */
        init() {

            // コンテナを探す
            this.findContainer();

            if (this.container) {
                this.loadUpcomingEvents();

                // 定期的に更新（5分ごと）
                if (this.updateInterval) {
                    clearInterval(this.updateInterval);
                }
                this.updateInterval = setInterval(() => {
                    this.loadUpcomingEvents();
                }, 300000);
            }
        }

        /**
         * コンテナ要素を探す
         */
        findContainer() {
            // 「今後のイベント」セクションを探す
            const headers = document.querySelectorAll('.card-header h3');
            for (const header of headers) {
                if (header.textContent.includes('今後のイベント')) {
                    const card = header.closest('.content-card');
                    if (card) {
                        this.container = card.querySelector('.event-list');
                        break;
                    }
                }
            }

            if (!this.container) {
                console.warn('[UpcomingEvents] イベントリストコンテナが見つかりません');
            }
        }

        /**
         * 今後のイベントを読み込み
         */
        async loadUpcomingEvents() {
            // キャッシュチェック
            if (this.eventCache && this.cacheTime && (Date.now() - this.cacheTime) < this.cacheTTL) {
                this.displayEvents(this.eventCache);
                return;
            }


            try {
                const now = new Date().toISOString();

                // event_itemsテーブルから取得（参加者数も含めて）
                let { data: events, error } = await window.supabaseClient
                    .from('event_items')
                    .select(`
                        *,
                        event_participants!left (
                            id,
                            status
                        )
                    `)
                    .gte('event_date', now)
                    .order('event_date', { ascending: true })
                    .limit(5);

                // event_itemsテーブルが存在しない場合、eventsテーブルで試す（後方互換性）
                if (error && (error.code === '42P01' || error.message.includes('event_items'))) {

                    const result = await window.supabaseClient
                        .from('events')
                        .select('*')
                        .gte('event_date', now)
                        .order('event_date', { ascending: true })
                        .limit(5);

                    events = result.data;
                    error = result.error;
                }

                if (error) {
                    console.error('[UpcomingEvents] イベント取得エラー:', error);
                    this.showError();
                    return;
                }


                // キャッシュに保存
                this.eventCache = events || [];
                this.cacheTime = Date.now();

                // イベントを表示
                this.displayEvents(events || []);

            } catch (error) {
                console.error('[UpcomingEvents] エラー:', error);
                this.showError();
            }
        }

        /**
         * イベントを表示
         */
        displayEvents(events) {
            if (!this.container) return;

            // コンテナをクリア
            this.container.innerHTML = '';

            if (!events || events.length === 0) {
                this.container.innerHTML = `
                    <div style="text-align: center; padding: 40px 20px; color: #999;">
                        <i class="fas fa-calendar-times" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                        <p>今後のイベントはありません</p>
                    </div>
                `;
                return;
            }

            // イベントをHTML化
            const eventsHTML = events.map(event => this.createEventHTML(event)).join('');
            this.container.innerHTML = eventsHTML;

            // イベントハンドラーを設定
            this.attachEventHandlers();
        }

        /**
         * イベントのHTMLを作成
         */
        createEventHTML(event) {
            const eventDate = new Date(event.event_date || event.date);
            const day = eventDate.getDate();
            const month = eventDate.getMonth() + 1;
            const monthName = this.getMonthName(month);
            const time = this.formatTime(eventDate);

            // タイトルとロケーション
            const title = event.title || event.name || 'イベント';
            const location = event.location || 'オンライン開催';

            // 参加者数（event_participantsのリレーションから取得）
            const participantCount = event.event_participants?.length || event.participant_count || event.participants?.length || 0;

            return `
                <div class="event-item" data-event-id="${event.id}">
                    <div class="event-date">
                        <div class="date">${day}</div>
                        <div class="month">${monthName}</div>
                    </div>
                    <div class="event-details">
                        <h4>${this.escapeHtml(title)}</h4>
                        <p class="event-info">
                            <i class="fas fa-clock"></i> ${time}
                            <i class="fas fa-map-marker-alt" style="margin-left: 12px;"></i> ${this.escapeHtml(location)}
                        </p>
                        ${participantCount > 0 ? `
                            <p class="event-participants">
                                <i class="fas fa-users"></i> ${participantCount}名参加予定
                            </p>
                        ` : ''}
                        <button class="btn-small btn-primary event-detail-btn">詳細を見る</button>
                    </div>
                </div>
            `;
        }

        /**
         * イベントハンドラーを設定
         */
        attachEventHandlers() {
            // 詳細ボタンのクリックイベント
            const detailButtons = this.container.querySelectorAll('.event-detail-btn');
            detailButtons.forEach(button => {
                button.addEventListener('click', (e) => {
                    const eventItem = e.target.closest('.event-item');
                    const eventId = eventItem?.dataset.eventId;

                    if (eventId) {
                        this.showEventDetail(eventId);
                    }
                });
            });
        }

        /**
         * イベント詳細を表示
         */
        async showEventDetail(eventId) {

            // event-detail-modal.jsの関数を呼び出し
            if (window.eventDetailModal && typeof window.eventDetailModal.show === 'function') {
                window.eventDetailModal.show(eventId);
            } else {
                // フォールバック: イベントページへ遷移
                window.location.href = `events.html#event-${eventId}`;
            }
        }

        /**
         * エラー表示
         */
        showError() {
            if (!this.container) return;

            this.container.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: #e74c3c;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                    <p>イベントの読み込みに失敗しました</p>
                    <button class="btn-small btn-secondary" onclick="window.dashboardUpcomingEvents.loadUpcomingEvents()">
                        再読み込み
                    </button>
                </div>
            `;
        }

        /**
         * 月名を取得
         */
        getMonthName(month) {
            const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月',
                              '7月', '8月', '9月', '10月', '11月', '12月'];
            return monthNames[month - 1] || `${month}月`;
        }

        /**
         * 時刻をフォーマット
         */
        formatTime(date) {
            const hours = date.getHours();
            const minutes = date.getMinutes();
            const minutesStr = minutes < 10 ? `0${minutes}` : minutes;
            return `${hours}:${minutesStr}〜`;
        }

        /**
         * HTMLエスケープ
         */
        escapeHtml(str) {
            if (!str) return '';
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        /**
         * イベントテーブルの構造を確認（デバッグ用）
         */
        async checkEventTableStructure() {
            try {
                // event_itemsテーブルから確認
                let { data, error } = await window.supabaseClient
                    .from('event_items')
                    .select('*')
                    .limit(1);

                // event_itemsが存在しない場合はeventsテーブルを確認
                if (error && (error.code === '42P01' || error.message.includes('event_items'))) {
                    const result = await window.supabaseClient
                        .from('events')
                        .select('*')
                        .limit(1);
                    data = result.data;
                    error = result.error;
                }

                if (!error && data && data.length > 0) {
                    const columns = Object.keys(data[0]);
                }
            } catch (error) {
                console.error('[UpcomingEvents] テーブル構造確認エラー:', error);
            }
        }
    }

    // グローバルに公開
    window.dashboardUpcomingEvents = new DashboardUpcomingEvents();

    // DOMContentLoadedで初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.dashboardUpcomingEvents.init();
        });
    } else {
        // 既に読み込み済みの場合
        setTimeout(() => {
            window.dashboardUpcomingEvents.init();
        }, 100);
    }


})();

// ============================================================
// Section: dashboard-fix-loading.js
// ============================================================
/**
 * Dashboard Loading Fix
 * ダッシュボードのローディング問題を修正
 */

(function() {
    'use strict';


    // Supabaseクライアントの初期化を待つ
    function waitForSupabase() {
        return new Promise((resolve) => {
            if (window.supabaseClient) {
                resolve();
                return;
            }

            // supabaseReadyイベントを待つ
            window.addEventListener('supabaseReady', () => {
                resolve();
            });

            // タイムアウト後も確認
            setTimeout(() => {
                if (window.supabaseClient) {
                    resolve();
                }
            }, 3000);
        });
    }

    // 統計データの初期化
    async function initializeStats() {
        await waitForSupabase();

        if (!window.supabaseClient) {
            console.error('[DashboardFix] Supabaseが初期化されていません');
            showFallbackData();
            return;
        }

        try {
            // 統計を更新
            if (window.dashboardMemberCalculator) {
                const memberStats = await window.dashboardMemberCalculator.calculateMemberStats();
                updateMemberCard(memberStats);
            }

            if (window.dashboardEventCalculator) {
                const eventStats = await window.dashboardEventCalculator.calculateEventStats();
                updateEventCard(eventStats);
            }

            if (window.dashboardMatchingCalculator) {
                const matchingStats = await window.dashboardMatchingCalculator.calculateMatchingStats();
                updateMatchingCard(matchingStats);
            }

        } catch (error) {
            console.error('[DashboardFix] 統計更新エラー:', error);
            showFallbackData();
        }
    }

    // メンバーカードの更新
    function updateMemberCard(stats) {
        const card = document.querySelector('.stats-container .stat-card:nth-child(1)');
        if (!card) return;

        const statValue = card.querySelector('.stat-value');
        const changeSpan = card.querySelector('.stat-change span');
        const changeContainer = card.querySelector('.stat-change');

        if (statValue) {
            statValue.textContent = stats.total_members || '0';
        }

        if (changeSpan) {
            changeSpan.textContent = stats.member_change_text || '0% 前月比';
        }

        if (changeContainer) {
            changeContainer.className = `stat-change ${stats.member_change_type || 'neutral'}`;
            const icon = changeContainer.querySelector('i');
            if (icon) {
                if (stats.member_change_type === 'positive') {
                    icon.className = 'fas fa-arrow-up';
                } else if (stats.member_change_type === 'negative') {
                    icon.className = 'fas fa-arrow-down';
                } else {
                    icon.className = 'fas fa-minus';
                }
            }
        }
    }

    // イベントカードの更新
    function updateEventCard(stats) {
        const card = document.querySelector('.stats-container .stat-card:nth-child(2)');
        if (!card) return;

        const statValue = card.querySelector('.stat-value');
        const changeSpan = card.querySelector('.stat-change span');
        const changeContainer = card.querySelector('.stat-change');

        if (statValue) {
            statValue.textContent = stats.events_this_month || '0';
        }

        if (changeSpan) {
            changeSpan.textContent = `${stats.event_change_count || 0}イベント増加`;
        }

        if (changeContainer) {
            changeContainer.className = `stat-change ${stats.event_change_type || 'neutral'}`;
        }
    }

    // マッチングカードの更新
    function updateMatchingCard(stats) {
        const card = document.querySelector('.stats-container .stat-card:nth-child(3)');
        if (!card) return;

        const statValue = card.querySelector('.stat-value');
        const changeSpan = card.querySelector('.stat-change span');
        const changeContainer = card.querySelector('.stat-change');

        if (statValue) {
            statValue.textContent = stats.total_connections || '0';
        }

        if (changeSpan) {
            changeSpan.textContent = stats.change_percentage
                ? `${Math.abs(stats.change_percentage)}% ${stats.change_percentage > 0 ? '増加' : '減少'}`
                : '0% 変化なし';
        }

        if (changeContainer) {
            changeContainer.className = `stat-change ${stats.change_type || 'neutral'}`;
        }
    }

    // フォールバックデータの表示
    function showFallbackData() {

        // 統計カードにデフォルト値を設定
        const statCards = document.querySelectorAll('.stat-card');

        if (statCards[0]) {
            const value = statCards[0].querySelector('.stat-value');
            const change = statCards[0].querySelector('.stat-change span');
            if (value) value.textContent = '0';
            if (change) change.textContent = 'データ取得中...';
        }

        if (statCards[1]) {
            const value = statCards[1].querySelector('.stat-value');
            const change = statCards[1].querySelector('.stat-change span');
            if (value) value.textContent = '0';
            if (change) change.textContent = 'データ取得中...';
        }

        if (statCards[2]) {
            const value = statCards[2].querySelector('.stat-value');
            const change = statCards[2].querySelector('.stat-change span');
            if (value) value.textContent = '0';
            if (change) change.textContent = 'データ取得中...';
        }
    }

    // 今後のイベントの修正
    async function fixUpcomingEvents() {
        await waitForSupabase();

        if (!window.supabaseClient) {
            console.error('[DashboardFix] Supabaseが利用できません');
            return;
        }

        // DashboardUpcomingEventsの再初期化
        if (window.dashboardUpcomingEvents) {
            try {
                await window.dashboardUpcomingEvents.loadUpcomingEvents();
            } catch (error) {
                console.error('[DashboardFix] イベント読み込みエラー:', error);

                // エラー時はダミーデータを表示
                const eventList = document.querySelector('.event-list');
                if (eventList) {
                    eventList.innerHTML = `
                        <div class="no-events" style="text-align: center; padding: 40px; color: #999;">
                            <i class="fas fa-calendar-times" style="font-size: 48px; margin-bottom: 16px;"></i>
                            <p>イベントデータを読み込めませんでした</p>
                        </div>
                    `;
                }
            }
        }
    }

    // リアルタイム通知の修正
    async function fixRealtimeNotifications() {
        await waitForSupabase();

        if (!window.supabaseClient) {
            console.error('[DashboardFix] Supabaseが利用できません');
            return;
        }

        // notifications-realtime-unified.js が初期化を担当するため、
        // ここでは重複初期化を行わない
    }

    // 初期化
    function init() {
        // DOMContentLoadedを待つ
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
            return;
        }


        // 各修正を実行
        Promise.all([
            initializeStats(),
            fixUpcomingEvents(),
            fixRealtimeNotifications()
        ]).then(() => {
        }).catch(error => {
            console.error('[DashboardFix] 修正中にエラー:', error);
        });
    }

    // 開始
    init();

})();

// ============================================================
// Section: dashboard-charts.js
// ============================================================
/**
 * Dashboard Charts
 * ダッシュボードのデータビジュアライゼーション
 */

(function() {
    'use strict';

    class DashboardCharts {
        constructor() {
            this.charts = {};
            this.chartColors = {
                primary: '#2563eb',
                secondary: '#10b981',
                accent: '#f59e0b',
                danger: '#ef4444',
                gray: '#6b7280'
            };

            this.init();
        }

        async init() {
            // Chart.jsが読み込まれているか確認
            if (typeof Chart === 'undefined') {
                console.warn('[DashboardCharts] Chart.js not loaded. Loading from CDN...');
                await this.loadChartJS();
            }

            // チャートコンテナを作成
            this.createChartContainers();

            // データを読み込んでチャートを作成
            await this.loadDataAndCreateCharts();

        }

        /**
         * Chart.jsを動的に読み込む
         */
        async loadChartJS() {
            return new Promise((resolve) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js';
                script.onload = resolve;
                document.head.appendChild(script);
            });
        }

        /**
         * チャートコンテナを作成
         */
        createChartContainers() {
            // 統計カードの後に新しいセクションを追加
            const mainContent = document.querySelector('.dashboard-content');
            if (!mainContent) return;

            const chartsSection = document.createElement('div');
            chartsSection.className = 'charts-section';
            chartsSection.innerHTML = `
                <div class="charts-grid">
                    <!-- メンバー成長チャート -->
                    <div class="chart-card">
                        <div class="chart-header">
                            <h3>メンバー成長推移</h3>
                            <select class="chart-period-select" data-chart="memberGrowth">
                                <option value="week">過去1週間</option>
                                <option value="month" selected>過去1ヶ月</option>
                                <option value="year">過去1年</option>
                            </select>
                        </div>
                        <div class="chart-body">
                            <canvas id="memberGrowthChart"></canvas>
                        </div>
                    </div>

                    <!-- イベント参加率チャート -->
                    <div class="chart-card">
                        <div class="chart-header">
                            <h3>イベント参加統計</h3>
                            <select class="chart-period-select" data-chart="eventStats">
                                <option value="week">今週</option>
                                <option value="month" selected>今月</option>
                                <option value="quarter">四半期</option>
                            </select>
                        </div>
                        <div class="chart-body">
                            <canvas id="eventStatsChart"></canvas>
                        </div>
                    </div>

                    <!-- 業界別分布チャート -->
                    <div class="chart-card">
                        <div class="chart-header">
                            <h3>業界別メンバー分布</h3>
                        </div>
                        <div class="chart-body">
                            <canvas id="industryChart"></canvas>
                        </div>
                    </div>

                    <!-- アクティビティヒートマップ -->
                    <div class="chart-card chart-card-wide">
                        <div class="chart-header">
                            <h3>週間アクティビティ</h3>
                        </div>
                        <div class="chart-body">
                            <canvas id="activityHeatmapChart"></canvas>
                        </div>
                    </div>
                </div>
            `;

            // 統計カードの後に挿入
            const statsContainer = document.querySelector('.stats-container');
            if (statsContainer && statsContainer.parentNode) {
                statsContainer.parentNode.insertBefore(chartsSection, statsContainer.nextSibling);
            }

            // イベントリスナーを設定
            chartsSection.querySelectorAll('.chart-period-select').forEach(select => {
                select.addEventListener('change', (e) => {
                    this.handlePeriodChange(e.target.dataset.chart, e.target.value);
                });
            });
        }

        /**
         * データを読み込んでチャートを作成
         */
        async loadDataAndCreateCharts() {
            // メンバー成長チャート
            await this.createMemberGrowthChart();

            // イベント参加統計チャート
            await this.createEventStatsChart();

            // 業界別分布チャート
            await this.createIndustryChart();

            // アクティビティヒートマップ
            await this.createActivityHeatmapChart();
        }

        /**
         * メンバー成長チャートを作成
         */
        async createMemberGrowthChart() {
            const ctx = document.getElementById('memberGrowthChart');
            if (!ctx) return;

            // ローディング表示
            this.showChartLoading('memberGrowthChart');

            // データを取得
            const data = await this.fetchMemberGrowthData('month');

            this.charts.memberGrowth = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: data.labels,
                    datasets: [{
                        label: '総メンバー数',
                        data: data.total,
                        borderColor: this.chartColors.primary,
                        backgroundColor: this.chartColors.primary + '20',
                        fill: true,
                        tension: 0.4
                    }, {
                        label: '新規メンバー',
                        data: data.new,
                        borderColor: this.chartColors.secondary,
                        backgroundColor: this.chartColors.secondary + '20',
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                usePointStyle: true,
                                padding: 20
                            }
                        },
                        tooltip: {
                            mode: 'index',
                            intersect: false,
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            titleColor: '#fff',
                            bodyColor: '#fff',
                            borderColor: '#ddd',
                            borderWidth: 1
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: {
                                color: 'rgba(0, 0, 0, 0.05)'
                            }
                        },
                        x: {
                            grid: {
                                display: false
                            }
                        }
                    }
                }
            });
        }

        /**
         * イベント参加統計チャートを作成
         */
        async createEventStatsChart() {
            const ctx = document.getElementById('eventStatsChart');
            if (!ctx) return;

            // ローディング表示
            this.showChartLoading('eventStatsChart');

            // データを取得
            const data = await this.fetchEventStatsData('month');

            this.charts.eventStats = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: data.labels,
                    datasets: [{
                        label: 'オンライン',
                        data: data.online,
                        backgroundColor: this.chartColors.primary,
                        borderRadius: 4
                    }, {
                        label: 'オフライン',
                        data: data.offline,
                        backgroundColor: this.chartColors.secondary,
                        borderRadius: 4
                    }, {
                        label: 'ハイブリッド',
                        data: data.hybrid,
                        backgroundColor: this.chartColors.accent,
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                usePointStyle: true,
                                padding: 20
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            stacked: true,
                            grid: {
                                color: 'rgba(0, 0, 0, 0.05)'
                            }
                        },
                        x: {
                            stacked: true,
                            grid: {
                                display: false
                            }
                        }
                    }
                }
            });
        }

        /**
         * 業界別分布チャートを作成
         */
        async createIndustryChart() {
            const ctx = document.getElementById('industryChart');
            if (!ctx) return;

            // ローディング表示
            this.showChartLoading('industryChart');

            // データを取得
            const data = await this.fetchIndustryData();

            this.charts.industry = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: data.labels,
                    datasets: [{
                        data: data.values,
                        backgroundColor: [
                            this.chartColors.primary,
                            this.chartColors.secondary,
                            this.chartColors.accent,
                            this.chartColors.danger,
                            this.chartColors.gray
                        ],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: {
                                usePointStyle: true,
                                padding: 20
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = ((value / total) * 100).toFixed(1);
                                    return `${label}: ${value}人 (${percentage}%)`;
                                }
                            }
                        }
                    }
                }
            });
        }

        /**
         * アクティビティヒートマップチャートを作成
         */
        async createActivityHeatmapChart() {
            const ctx = document.getElementById('activityHeatmapChart');
            if (!ctx) return;

            // ローディング表示
            this.showChartLoading('activityHeatmapChart');

            // データを取得
            const data = await this.fetchActivityHeatmapData();

            this.charts.activityHeatmap = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: ['月', '火', '水', '木', '金', '土', '日'],
                    datasets: data.datasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            callbacks: {
                                title: function(tooltipItems) {
                                    const item = tooltipItems[0];
                                    return `${item.label} ${item.dataset.label}時`;
                                },
                                label: function(context) {
                                    return `アクティビティ: ${context.parsed.y}件`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: {
                                color: 'rgba(0, 0, 0, 0.05)'
                            }
                        },
                        x: {
                            grid: {
                                display: false
                            }
                        }
                    }
                }
            });
        }

        /**
         * 期間変更を処理
         */
        handlePeriodChange(chartName, period) {
            switch (chartName) {
                case 'memberGrowth':
                    this.updateMemberGrowthChart(period);
                    break;
                case 'eventStats':
                    this.updateEventStatsChart(period);
                    break;
            }
        }

        /**
         * メンバー成長チャートを更新
         */
        async updateMemberGrowthChart(period) {
            const chart = this.charts.memberGrowth;
            if (!chart) return;

            this.showChartLoading('memberGrowthChart');
            const data = await this.fetchMemberGrowthData(period);
            chart.data.labels = data.labels;
            chart.data.datasets[0].data = data.total;
            chart.data.datasets[1].data = data.new;
            chart.update();
            this.hideChartLoading('memberGrowthChart');
        }

        /**
         * イベント統計チャートを更新
         */
        async updateEventStatsChart(period) {
            const chart = this.charts.eventStats;
            if (!chart) return;

            this.showChartLoading('eventStatsChart');
            const data = await this.fetchEventStatsData(period);
            chart.data.labels = data.labels;
            chart.data.datasets[0].data = data.online;
            chart.data.datasets[1].data = data.offline;
            chart.data.datasets[2].data = data.hybrid;
            chart.update();
            this.hideChartLoading('eventStatsChart');
        }

        /**
         * メンバー成長データを生成（ダミー）
         */
        generateMemberGrowthData(period) {
            const data = { labels: [], total: [], new: [] };
            let days = 30;

            switch (period) {
                case 'week':
                    days = 7;
                    break;
                case 'year':
                    days = 365;
                    break;
            }

            let total = 1000;
            const now = new Date();

            for (let i = days; i >= 0; i -= Math.max(1, Math.floor(days / 10))) {
                const date = new Date(now);
                date.setDate(date.getDate() - i);

                const newMembers = Math.floor(Math.random() * 10) + 5;
                total += newMembers;

                data.labels.push(date.toLocaleDateString('ja-JP', {
                    month: 'numeric',
                    day: 'numeric'
                }));
                data.total.push(total);
                data.new.push(newMembers);
            }

            return data;
        }

        /**
         * イベント統計データを生成（ダミー）
         */
        generateEventStatsData(period) {
            const data = { labels: [], online: [], offline: [], hybrid: [] };
            let items = 4;

            switch (period) {
                case 'week':
                    data.labels = ['月', '火', '水', '木', '金', '土', '日'];
                    items = 7;
                    break;
                case 'month':
                    data.labels = ['第1週', '第2週', '第3週', '第4週'];
                    items = 4;
                    break;
                case 'quarter':
                    data.labels = ['1月', '2月', '3月'];
                    items = 3;
                    break;
            }

            for (let i = 0; i < items; i++) {
                data.online.push(Math.floor(Math.random() * 20) + 10);
                data.offline.push(Math.floor(Math.random() * 15) + 5);
                data.hybrid.push(Math.floor(Math.random() * 10) + 2);
            }

            return data;
        }

        /**
         * アクティビティヒートマップデータを生成（ダミー）
         */
        generateActivityHeatmapData() {
            const hours = Array.from({ length: 24 }, (_, i) => i);
            const datasets = hours.map(hour => ({
                label: hour.toString(),
                data: Array.from({ length: 7 }, () => Math.floor(Math.random() * 50)),
                backgroundColor: this.getHeatmapColor(hour),
                borderWidth: 0,
                barPercentage: 1,
                categoryPercentage: 1
            }));

            return { datasets };
        }

        /**
         * ヒートマップの色を取得
         */
        getHeatmapColor(hour) {
            // 活動時間帯に応じて色を変える
            if (hour >= 9 && hour <= 18) {
                return this.chartColors.primary + '80';
            } else if (hour >= 6 && hour < 9 || hour > 18 && hour <= 22) {
                return this.chartColors.secondary + '60';
            } else {
                return this.chartColors.gray + '30';
            }
        }

        /**
         * チャートのローディングを表示
         */
        showChartLoading(chartId) {
            const chartCard = document.getElementById(chartId)?.closest('.chart-card');
            if (!chartCard) return;

            let loading = chartCard.querySelector('.chart-loading');
            if (!loading) {
                loading = document.createElement('div');
                loading.className = 'chart-loading';
                loading.innerHTML = '<i class="fas fa-spinner"></i>';
                chartCard.querySelector('.chart-body').appendChild(loading);
            }
            loading.style.display = 'flex';
        }

        /**
         * チャートのローディングを非表示
         */
        hideChartLoading(chartId) {
            const chartCard = document.getElementById(chartId)?.closest('.chart-card');
            if (!chartCard) return;

            const loading = chartCard.querySelector('.chart-loading');
            if (loading) {
                loading.style.display = 'none';
            }
        }

        /**
         * メンバー成長データを取得
         */
        async fetchMemberGrowthData(period) {
            try {
                if (window.supabaseClient) {
                    // Supabaseからメンバー成長データを取得
                    const { data, error } = await window.supabaseClient
                        .from('member_growth_stats')
                        .select('*')
                        .order('month', { ascending: true });

                    if (!error && data && data.length > 0) {
                        return this.processMemberGrowthData(data, period);
                    }
                }
            } catch (error) {
                console.error('[DashboardCharts] Error fetching member growth data:', error);
            }

            // フォールバックとしてダミーデータを使用
            return this.generateMemberGrowthData(period);
        }

        /**
         * メンバー成長データを処理
         */
        processMemberGrowthData(rawData, period) {
            const now = new Date();
            let startDate = new Date();

            switch (period) {
                case 'week':
                    startDate.setDate(now.getDate() - 7);
                    break;
                case 'month':
                    startDate.setDate(now.getDate() - 30);
                    break;
                case 'year':
                    startDate.setDate(now.getDate() - 365);
                    break;
            }

            const filteredData = rawData.filter(item => new Date(item.month) >= startDate);

            return {
                labels: filteredData.map(item => new Date(item.month).toLocaleDateString('ja-JP', {
                    month: 'numeric',
                    day: 'numeric'
                })),
                total: filteredData.map(item => item.total_members),
                new: filteredData.map(item => item.new_members)
            };
        }

        /**
         * イベント統計データを取得
         */
        async fetchEventStatsData(period) {
            try {
                if (window.supabaseClient) {
                    // Supabaseからイベント統計データを取得
                    const { data, error } = await window.supabaseClient
                        .from('event_stats')
                        .select('*')
                        .order('week', { ascending: true });

                    if (!error && data && data.length > 0) {
                        return this.processEventStatsData(data, period);
                    }
                }
            } catch (error) {
                console.error('[DashboardCharts] Error fetching event stats data:', error);
            }

            // フォールバックとしてダミーデータを使用
            return this.generateEventStatsData(period);
        }

        /**
         * イベント統計データを処理
         */
        processEventStatsData(rawData, period) {
            // イベントタイプ別に集計
            const stats = {
                labels: [],
                online: [],
                offline: [],
                hybrid: []
            };

            // periodに応じてデータをグループ化
            // ここでは簡略化のため、生データをそのまま使用
            rawData.forEach(item => {
                const weekDate = new Date(item.week);
                const label = weekDate.toLocaleDateString('ja-JP', {
                    month: 'numeric',
                    day: 'numeric'
                });

                if (!stats.labels.includes(label)) {
                    stats.labels.push(label);
                    stats.online.push(0);
                    stats.offline.push(0);
                    stats.hybrid.push(0);
                }

                const index = stats.labels.indexOf(label);
                switch (item.event_type) {
                    case 'online':
                        stats.online[index] = item.event_count;
                        break;
                    case 'offline':
                        stats.offline[index] = item.event_count;
                        break;
                    case 'hybrid':
                        stats.hybrid[index] = item.event_count;
                        break;
                }
            });

            return stats;
        }

        /**
         * 業界別データを取得
         */
        async fetchIndustryData() {
            try {
                if (window.supabaseClient) {
                    // Supabaseから業界別分布データを取得
                    const { data, error } = await window.supabaseClient
                        .from('industry_distribution')
                        .select('*')
                        .order('count', { ascending: false });

                    if (!error && data && data.length > 0) {
                        return {
                            labels: data.map(item => item.industry),
                            values: data.map(item => item.count)
                        };
                    }
                }
            } catch (error) {
                console.error('[DashboardCharts] Error fetching industry data:', error);
            }

            // フォールバックとしてダミーデータを使用
            return {
                labels: ['IT/テクノロジー', '金融', '製造業', 'サービス業', 'その他'],
                values: [35, 25, 20, 15, 5]
            };
        }

        /**
         * アクティビティヒートマップデータを取得
         */
        async fetchActivityHeatmapData() {
            try {
                if (window.supabaseClient) {
                    // 過去1週間のアクティビティを取得
                    const oneWeekAgo = new Date();
                    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

                    // activitiesテーブル: コミュニティ全体のアクティビティフィード
                    const { data, error } = await window.supabaseClient
                        .from('activities')
                        .select('created_at')
                        .gte('created_at', oneWeekAgo.toISOString())
                        .order('created_at', { ascending: true });

                    if (!error && data && data.length > 0) {
                        return this.processActivityHeatmapData(data);
                    }
                }
            } catch (error) {
                console.error('[DashboardCharts] Error fetching activity heatmap data:', error);
            }

            // フォールバックとしてダミーデータを使用
            return this.generateActivityHeatmapData();
        }

        /**
         * アクティビティヒートマップデータを処理
         */
        processActivityHeatmapData(activities) {
            // 時間別・曜日別に集計
            const heatmap = {};
            const days = ['月', '火', '水', '木', '金', '土', '日'];

            // 初期化
            for (let hour = 0; hour < 24; hour++) {
                heatmap[hour] = days.map(() => 0);
            }

            // アクティビティを集計
            activities.forEach(activity => {
                const date = new Date(activity.created_at);
                const hour = date.getHours();
                const dayIndex = date.getDay() === 0 ? 6 : date.getDay() - 1; // 日曜日を0から6に
                heatmap[hour][dayIndex]++;
            });

            // Chart.js用のデータセットに変換
            const datasets = Object.keys(heatmap).map(hour => ({
                label: hour.toString(),
                data: heatmap[hour],
                backgroundColor: this.getHeatmapColor(parseInt(hour)),
                borderWidth: 0,
                barPercentage: 1,
                categoryPercentage: 1
            }));

            return { datasets };
        }
    }

    // グローバルに公開
    window.DashboardCharts = DashboardCharts;

    // DOMContentLoaded時に初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.dashboardCharts = new DashboardCharts();
        });
    } else {
        window.dashboardCharts = new DashboardCharts();
    }

})();

// ============================================================
// Section: activity-event-filter.js
// ============================================================
/**
 * Activity & Event Filter
 * ダッシュボードのアクティビティとイベントのフィルタリング機能
 */

(function() {
    'use strict';

    class ActivityEventFilter {
        constructor() {
            this.activities = [];
            this.events = [];
            this.activityFilters = {
                type: 'all',
                timeRange: 'all'
            };
            this.eventFilters = {
                type: 'all',
                timeRange: 'upcoming'
            };

            this.init();
        }

        async init() {
            // DOM要素の存在確認
            if (!document.querySelector('.activity-list') && !document.querySelector('.event-list')) {
                console.warn('[ActivityEventFilter] Required DOM elements not found, skipping initialization');
                return;
            }

            // フィルターUI を作成
            this.createFilterUI();

            // データを読み込む
            await this.loadActivities();
            await this.loadEvents();

            // イベントリスナーを設定
            this.setupEventListeners();

        }

        /**
         * フィルターUIを作成
         */
        createFilterUI() {
            // アクティビティフィルター
            const activityCard = document.querySelector('.activity-list')?.closest('.content-card');
            if (activityCard) {
                const filterContainer = document.createElement('div');
                filterContainer.className = 'activity-filters';
                filterContainer.innerHTML = `
                    <select class="filter-select" id="activityTypeFilter">
                        <option value="all">すべてのアクティビティ</option>
                        <option value="member_joined">新規メンバー</option>
                        <option value="event_completed">イベント完了</option>
                        <option value="matching_success">マッチング成立</option>
                        <option value="message_sent">メッセージ</option>
                        <option value="connection_made">接続</option>
                    </select>
                    <select class="filter-select" id="activityTimeFilter">
                        <option value="all">全期間</option>
                        <option value="today">今日</option>
                        <option value="week">今週</option>
                        <option value="month">今月</option>
                    </select>
                `;

                const cardHeader = activityCard.querySelector('.card-header');
                cardHeader.appendChild(filterContainer);
            }

            // イベントフィルター
            const eventCard = document.querySelector('.event-list')?.closest('.content-card');
            if (eventCard) {
                const filterContainer = document.createElement('div');
                filterContainer.className = 'event-filters';
                filterContainer.innerHTML = `
                    <select class="filter-select" id="eventTypeFilter">
                        <option value="all">すべてのイベント</option>
                        <option value="online">オンライン</option>
                        <option value="offline">オフライン</option>
                        <option value="hybrid">ハイブリッド</option>
                    </select>
                    <select class="filter-select" id="eventTimeFilter">
                        <option value="upcoming">今後</option>
                        <option value="today">今日</option>
                        <option value="week">今週</option>
                        <option value="month">今月</option>
                        <option value="past">過去</option>
                    </select>
                `;

                const cardHeader = eventCard.querySelector('.card-header');
                const calendarBtn = cardHeader.querySelector('.btn-text');
                cardHeader.insertBefore(filterContainer, calendarBtn);
            }
        }

        /**
         * アクティビティを読み込む
         */
        async loadActivities() {
            try {
                // ローディング表示
                const container = document.querySelector('.activity-list');
                if (container) {
                    container.innerHTML = '<div class="filter-loading"><i class="fas fa-spinner"></i></div>';
                }

                if (window.supabaseClient && window.supabaseClient.from) {
                    // activitiesテーブル: コミュニティ全体のアクティビティフィード
                    const { data, error } = await window.supabaseClient
                        .from('activities')
                        .select('*')
                        .order('created_at', { ascending: false })
                        .limit(50);

                    if (!error && data && data.length > 0) {
                        // データを変換
                        this.activities = data.map(activity => this.transformActivity(activity));
                    } else {
                        this.activities = [];
                    }
                } else {
                    this.activities = [];
                }

                this.renderActivities();
            } catch (error) {
                console.error('[ActivityEventFilter] Error loading activities:', error);
                this.activities = [];
                this.renderActivities();
            }
        }

        /**
         * アクティビティデータを変換
         */
        /**
         * activitiesテーブルのレコードをUI用に変換
         * activitiesテーブルカラム: id, type, title, user_id, created_at
         */
        transformActivity(activity) {
            const iconMap = {
                'member_joined': 'fa-user-plus',
                'event_completed': 'fa-calendar-check',
                'matching_success': 'fa-handshake',
                'message_sent': 'fa-envelope',
                'connection_made': 'fa-link',
                'profile_updated': 'fa-user-edit',
                'event_created': 'fa-calendar-plus'
            };

            return {
                id: activity.id,
                type: activity.type,
                title: activity.title,
                user: activity.user_id,
                timestamp: new Date(activity.created_at),
                icon: iconMap[activity.type] || 'fa-bell'
            };
        }

        // getDummyActivities() 削除済み — 実データのみ使用

        /**
         * イベントを読み込む
         */
        async loadEvents() {
            try {
                // ローディング表示
                const container = document.querySelector('.event-list');
                if (container) {
                    container.innerHTML = '<div class="filter-loading"><i class="fas fa-spinner"></i></div>';
                }

                if (window.supabaseClient && window.supabaseClient.from) {
                    // イベントデータ + 参加者数をjoinクエリで一括取得（N+1防止）
                    const { data: events, error } = await window.supabaseClient
                        .from('event_items')
                        .select('*, event_participants!left(id, status)')
                        .eq('is_public', true)
                        .eq('is_cancelled', false)
                        .order('event_date', { ascending: true });

                    if (!error && events && events.length > 0) {
                        // joinデータから参加者数を計算
                        for (const event of events) {
                            event.participant_count = (event.event_participants || [])
                                .filter(p => p.status === 'registered').length;
                            delete event.event_participants;
                        }

                        this.events = events;
                    } else {
                        this.events = [];
                    }
                } else {
                    this.events = [];
                }

                this.renderEvents();
            } catch (error) {
                console.error('[ActivityEventFilter] Error loading events:', error);
                this.events = [];
                this.renderEvents();
            }
        }

        // getDummyEvents() 削除済み — 実データのみ使用

        /**
         * イベントリスナーを設定
         */
        setupEventListeners() {
            // アクティビティフィルター
            const activityTypeFilter = document.getElementById('activityTypeFilter');
            const activityTimeFilter = document.getElementById('activityTimeFilter');

            if (activityTypeFilter) {
                activityTypeFilter.addEventListener('change', (e) => {
                    this.activityFilters.type = e.target.value;
                    this.renderActivities();
                });
            }

            if (activityTimeFilter) {
                activityTimeFilter.addEventListener('change', (e) => {
                    this.activityFilters.timeRange = e.target.value;
                    this.renderActivities();
                });
            }

            // イベントフィルター
            const eventTypeFilter = document.getElementById('eventTypeFilter');
            const eventTimeFilter = document.getElementById('eventTimeFilter');

            if (eventTypeFilter) {
                eventTypeFilter.addEventListener('change', (e) => {
                    this.eventFilters.type = e.target.value;
                    this.renderEvents();
                });
            }

            if (eventTimeFilter) {
                eventTimeFilter.addEventListener('change', (e) => {
                    this.eventFilters.timeRange = e.target.value;
                    this.renderEvents();
                });
            }
        }

        /**
         * アクティビティをレンダリング
         */
        renderActivities() {
            const container = document.querySelector('.activity-list');
            if (!container) return;

            // フィルタリング
            let filteredActivities = this.filterActivities(this.activities);

            if (filteredActivities.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-inbox"></i>
                        <p>アクティビティがありません</p>
                    </div>
                `;
                return;
            }

            // レンダリング
            container.innerHTML = filteredActivities.map(activity => `
                <div class="activity-item" data-type="${activity.type}">
                    <div class="activity-icon">
                        <i class="fas ${activity.icon}"></i>
                    </div>
                    <div class="activity-content">
                        <p>${this.escapeHtml(activity.title)}</p>
                        <span class="activity-time">${this.formatTimeAgo(activity.timestamp)}</span>
                    </div>
                </div>
            `).join('');
        }

        /**
         * イベントをレンダリング
         */
        renderEvents() {
            const container = document.querySelector('.event-list');
            if (!container) return;

            // フィルタリング
            let filteredEvents = this.filterEvents(this.events);

            if (filteredEvents.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-calendar-alt"></i>
                        <p>イベントがありません</p>
                    </div>
                `;
                return;
            }

            // レンダリング
            container.innerHTML = filteredEvents.slice(0, 5).map(event => {
                const eventDate = new Date(event.event_date);
                const dateStr = eventDate.toLocaleDateString('ja-JP', {
                    month: 'numeric',
                    day: 'numeric',
                    weekday: 'short'
                });

                // イベントタイプのラベル
                const typeLabels = {
                    'online': '<span><i class="fas fa-globe"></i> オンライン</span>',
                    'offline': '<span><i class="fas fa-map-marker-alt"></i> オフライン</span>',
                    'hybrid': '<span><i class="fas fa-broadcast-tower"></i> ハイブリッド</span>'
                };

                return `
                    <div class="event-item" data-event-id="${event.id}">
                        <div class="event-date">
                            <span class="date">${eventDate.getDate()}</span>
                            <span class="month">${eventDate.getMonth() + 1}月</span>
                        </div>
                        <div class="event-info">
                            <h4>${this.escapeHtml(event.title)}</h4>
                            <p class="event-meta">
                                <span><i class="fas fa-users"></i> ${event.participant_count || 0}名参加</span>
                                ${typeLabels[event.event_type] || ''}
                            </p>
                        </div>
                    </div>
                `;
            }).join('');

            // クリックイベントを追加
            container.querySelectorAll('.event-item').forEach(item => {
                item.addEventListener('click', () => {
                    const eventId = item.dataset.eventId;
                    if (window.eventModal) {
                        window.eventModal.show(eventId);
                    } else {
                        window.location.href = `events.html#event-${eventId}`;
                    }
                });
            });
        }

        /**
         * アクティビティをフィルタリング
         */
        filterActivities(activities) {
            return activities.filter(activity => {
                // タイプフィルター
                if (this.activityFilters.type !== 'all' && activity.type !== this.activityFilters.type) {
                    return false;
                }

                // 時間範囲フィルター
                if (this.activityFilters.timeRange !== 'all') {
                    const now = new Date();
                    const activityDate = new Date(activity.timestamp);

                    switch (this.activityFilters.timeRange) {
                        case 'today':
                            if (activityDate.toDateString() !== now.toDateString()) return false;
                            break;
                        case 'week':
                            const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                            if (activityDate < weekAgo) return false;
                            break;
                        case 'month':
                            const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                            if (activityDate < monthAgo) return false;
                            break;
                    }
                }

                return true;
            });
        }

        /**
         * イベントをフィルタリング
         */
        filterEvents(events) {
            return events.filter(event => {
                // タイプフィルター
                if (this.eventFilters.type !== 'all' && event.event_type !== this.eventFilters.type) {
                    return false;
                }

                // 時間範囲フィルター
                const now = new Date();
                const eventDate = new Date(event.event_date);

                switch (this.eventFilters.timeRange) {
                    case 'upcoming':
                        if (eventDate < now) return false;
                        break;
                    case 'today':
                        if (eventDate.toDateString() !== now.toDateString()) return false;
                        break;
                    case 'week':
                        const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
                        if (eventDate < now || eventDate > weekFromNow) return false;
                        break;
                    case 'month':
                        const monthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
                        if (eventDate < now || eventDate > monthFromNow) return false;
                        break;
                    case 'past':
                        if (eventDate >= now) return false;
                        break;
                }

                return true;
            });
        }

        /**
         * 時間を相対表示にフォーマット
         */
        formatTimeAgo(date) {
            const now = new Date();
            const diff = now - date;
            const seconds = Math.floor(diff / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);

            if (seconds < 60) return 'たった今';
            if (minutes < 60) return `${minutes}分前`;
            if (hours < 24) return `${hours}時間前`;
            if (days < 7) return `${days}日前`;

            return date.toLocaleDateString('ja-JP');
        }

        /**
         * HTMLエスケープ
         */
        escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    }

    // グローバルに公開
    window.ActivityEventFilter = ActivityEventFilter;

    // DOMContentLoaded時に初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.activityEventFilter = new ActivityEventFilter();
        });
    } else {
        window.activityEventFilter = new ActivityEventFilter();
    }

})();
