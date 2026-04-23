// ============================================================
// events-bundle.js
// Page-specific bundle for events.html
// ============================================================

// ============================================================
// Section: events-supabase.js
// ============================================================

/**
 * Events Supabase Integration
 * イベントデータのSupabase連携
 */

(function() {
    'use strict';

    class EventsSupabase {
        constructor() {
            this.currentFilter = 'upcoming';
            this.activeFilters = new Set(['all']);
            this.searchQuery = '';
            this.sortOrder = 'date_asc';
            this.eventsCache = new Map();
            this.participantsCache = new Map();
            this.cacheExpiry = 5 * 60 * 1000; // 5分
            this.allEvents = [];
            this.init();
        }

        init() {
            // 即座にイベントリスナーを設定（静的カード用）
            this.setupEventListeners();
            
            // EventModalの準備を待ってからカードリスナーを追加
            if (window.eventModal) {
                // 既に初期化済み
                setTimeout(() => {
                    this.attachCardEventListeners();
                }, 100);
            } else {
                // EventModalReadyイベントを待つ
                document.addEventListener('eventModalReady', () => {
                    this.attachCardEventListeners();
                });
                // フォールバック: 500ms後にも確認
                setTimeout(() => {
                    this.attachCardEventListeners();
                }, 500);
            }
            
            // supabaseReadyイベントを待ってから動的データを読み込み
            if (window.supabaseClient) {
                // console.log('[EventsSupabase] Supabase ready, loading events...');
                this.loadEvents();
                this.loadPastEvents();
            } else {
                // console.log('[EventsSupabase] Waiting for Supabase initialization...');
                // Supabaseクライアントがまだ初期化されていない場合は待機
                document.addEventListener('supabaseReady', () => {
                    // console.log('[EventsSupabase] Supabase client ready, initializing...');
                    this.loadEvents();
                    this.loadPastEvents();
                });
                
                // フォールバック: 3秒後にも確認
                setTimeout(() => {
                    if (window.supabaseClient && !this.eventsLoaded) {
                        // console.log('[EventsSupabase] Fallback: Loading events after timeout');
                        this.loadEvents();
                        this.loadPastEvents();
                    }
                }, 3000);
            }
        }

        setupEventListeners() {
            // フィルターボタンのイベントリスナー
            document.addEventListener('click', (e) => {
                if (e.target.classList.contains('filter-btn')) {
                    this.handleFilterChange(e.target);
                }
            });

            // 検索機能
            const searchInput = document.getElementById('eventSearchInput');
            if (searchInput) {
                let searchTimeout;
                searchInput.addEventListener('input', (e) => {
                    clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(() => {
                        this.searchQuery = e.target.value.trim();
                        this.applyFiltersAndSearch();
                    }, 300); // 300ms debounce
                });
            }

            // ソート機能
            const sortSelect = document.getElementById('eventSortSelect');
            if (sortSelect) {
                sortSelect.addEventListener('change', (e) => {
                    this.sortOrder = e.target.value;
                    this.applyFiltersAndSearch();
                });
            }
        }

        /**
         * イベントデータを読み込む
         */
        async loadEvents() {
            try {
                this.eventsLoaded = true; // フラグをセット
                this.showLoading();

                // キャッシュチェック
                const cacheKey = `events-${this.currentFilter}`;
                const cached = this.eventsCache.get(cacheKey);
                if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
                    this.renderEvents(cached.data);
                    return;
                }

                // Supabaseからイベントを取得
                const now = new Date().toISOString();
                let query = window.supabaseClient
                    .from('event_items')
                    .select('*')
                    .eq('is_public', true)
                    .eq('is_cancelled', false)
                    .order('event_date', { ascending: true });

                if (this.currentFilter === 'upcoming') {
                    query = query.gte('event_date', now);
                } else if (this.currentFilter === 'past') {
                    query = query.lt('event_date', now);
                }

                const { data: events, error } = await query;

                if (error) {
                    console.error('[EventsSupabase] Error loading events:', error);
                    this.showError('イベントの読み込みに失敗しました');
                    return;
                }

                // キャッシュに保存
                this.eventsCache.set(cacheKey, {
                    data: events,
                    timestamp: Date.now()
                });

                // 各イベントの参加者数を取得
                await this.loadParticipantCounts(events);

                // 全イベントを保存
                this.allEvents = events || [];

                // フィルターと検索を適用
                this.applyFiltersAndSearch();

            } catch (error) {
                console.error('[EventsSupabase] Error:', error);
                this.showError('エラーが発生しました');
            }
        }

        /**
         * 参加者数を取得
         */
        async loadParticipantCounts(events) {
            if (!events || events.length === 0) return;

            const eventIds = events.map(e => e.id);
            
            try {
                // 一括で参加者数を取得
                const { data: participants, error } = await window.supabaseClient
                    .from('event_participants')
                    .select('event_id')
                    .in('event_id', eventIds)
                    .in('status', ['registered', 'confirmed']);

                if (!error && participants) {
                    // イベントごとの参加者数をカウント
                    const counts = {};
                    participants.forEach(p => {
                        counts[p.event_id] = (counts[p.event_id] || 0) + 1;
                    });

                    // イベントデータに参加者数を追加
                    events.forEach(event => {
                        event.participant_count = counts[event.id] || 0;
                    });
                }
            } catch (error) {
                // console.error('[EventsSupabase] Error loading participant counts:', error);
            }
        }

        /**
         * イベントをレンダリング
         */
        renderEvents(events) {
            const container = document.querySelector('.events-grid');
            if (!container) return;

            // 検索結果の件数を表示
            this.updateResultCount(events.length);

            if (!events || events.length === 0) {
                const ctaBtn = this.searchQuery
                    ? '<button class="btn btn-secondary" style="margin-top:16px;" id="resetSearchBtn">検索をリセット</button>'
                    : '<a href="mailto:info@inter-connect.jp?subject=イベントリクエスト" class="btn btn-primary" style="margin-top:16px;">イベントをリクエスト</a>';
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-calendar-alt"></i>
                        <h3>イベントがありません</h3>
                        <p>${this.searchQuery ? '検索条件に一致するイベントが見つかりませんでした' : '現在表示できるイベントはありません'}</p>
                        ${ctaBtn}
                    </div>
                `;
                const resetBtn = document.getElementById('resetSearchBtn');
                if (resetBtn) {
                    resetBtn.addEventListener('click', () => {
                        const input = document.getElementById('eventSearchInput');
                        if (input) {
                            input.value = '';
                            input.dispatchEvent(new Event('input'));
                        }
                    });
                }
                return;
            }

            const eventsHTML = events.map(event => this.createEventCard(event)).join('');
            container.innerHTML = eventsHTML;

            // イベントカードにクリックイベントを追加
            this.attachCardEventListeners();
        }

        /**
         * 検索結果件数を更新
         */
        updateResultCount(count) {
            // 既存の結果カウントを探すか作成
            let countElement = document.querySelector('.search-result-count');
            if (!countElement) {
                countElement = document.createElement('div');
                countElement.className = 'search-result-count';
                const section = document.querySelector('.events-section');
                if (section) {
                    section.insertBefore(countElement, section.querySelector('.events-grid'));
                }
            }

            if (this.searchQuery || !this.activeFilters.has('all')) {
                countElement.textContent = `${count}件のイベントが見つかりました`;
                countElement.style.display = 'block';
            } else {
                countElement.style.display = 'none';
            }
        }

        /**
         * イベントカードを作成
         */
        createEventCard(event) {
            const eventDate = new Date(event.event_date);
            const dateStr = this.formatEventDate(eventDate, event.start_time, event.end_time);
            const isOnline = event.event_type === 'online';
            const isHybrid = event.event_type === 'hybrid';
            const location = isOnline ? event.online_url || 'オンライン' : event.location || '場所未定';
            const badgeClass = isOnline ? '' : 'event-badge-offline';
            const badgeText = isHybrid ? 'ハイブリッド' : (isOnline ? 'オンライン' : '対面');
            
            // 残席計算
            const participantCount = event.participant_count || 0;
            const maxParticipants = event.max_participants || '∞';
            const remainingSeats = maxParticipants === '∞' ? '∞' : Math.max(0, maxParticipants - participantCount);
            const isFull = maxParticipants !== '∞' && remainingSeats === 0;
            const isNearlyFull = maxParticipants !== '∞' && remainingSeats > 0 && remainingSeats <= 5;

            // 価格表示
            const priceText = event.price > 0 ? `${event.price.toLocaleString()}円` : '無料';

            // ボタンの状態
            let buttonHTML = '';
            if (isFull) {
                buttonHTML = '<button class="btn btn-secondary btn-block" disabled>満席</button>';
            } else if (isNearlyFull) {
                buttonHTML = '<button class="btn btn-outline btn-block">満席間近</button>';
            } else {
                buttonHTML = '<button class="btn btn-primary btn-block">参加申込</button>';
            }

            return `
                <div class="event-card" data-event-id="${event.id}">
                    <div class="event-image">
                        <img src="${window.escapeAttr(event.image_url || 'assets/user-placeholder.svg')}" alt="${this.escapeHtml(event.title)}" onerror="this.onerror=null; this.src='assets/user-placeholder.svg';">
                        <div class="event-badge ${badgeClass}">${badgeText}</div>
                    </div>
                    <div class="event-content">
                        <div class="event-date-tag">
                            <i class="fas fa-calendar"></i>
                            <span>${dateStr}</span>
                        </div>
                        <h3 class="event-title">${this.escapeHtml(event.title)}</h3>
                        <p class="event-description">
                            ${this.escapeHtml(event.description || 'イベントの詳細情報はまだ登録されていません。')}
                        </p>
                        <div class="event-meta">
                            <div class="meta-item">
                                ${isOnline ? '<i class="fas fa-globe"></i>' : '<i class="fas fa-map-marker-alt"></i>'}
                                <span>${this.escapeHtml(this.truncateText(location, 20))}</span>
                            </div>
                            <div class="meta-item">
                                <i class="fas fa-users"></i>
                                <span>参加者：${participantCount}/${maxParticipants}名</span>
                            </div>
                            <div class="meta-item">
                                ${event.price > 0 ? '<i class="fas fa-yen-sign"></i>' : '<i class="fas fa-tag"></i>'}
                                <span>${priceText}</span>
                            </div>
                        </div>
                        <div class="event-footer">
                            ${buttonHTML}
                        </div>
                    </div>
                </div>
            `;
        }

        /**
         * イベントカードにイベントリスナーを追加
         */
        attachCardEventListeners() {
            const cards = document.querySelectorAll('.event-card');
            // console.log('[EventsSupabase] Found', cards.length, 'event cards');
            
            cards.forEach(card => {
                // 既にリスナーが追加されている場合はスキップ
                if (card.dataset.listenerAdded === 'true') {
                    return;
                }
                
                // カード全体のクリックでモーダルを開く
                card.addEventListener('click', (e) => {
                    // イベントバブリングを停止
                    e.stopPropagation();
                    
                    // ボタンクリックは除外
                    if (!e.target.closest('button')) {
                        const eventId = card.dataset.eventId;
                        // console.log('[EventsSupabase] Card clicked, eventId:', eventId);
                        // console.log('[EventsSupabase] window.eventModal exists?', !!window.eventModal);
                        
                        // EventModalが存在するまで待つ
                        if (eventId) {
                            if (window.eventModal && typeof window.eventModal.show === 'function') {
                                // console.log('[EventsSupabase] Calling eventModal.show()');
                                window.eventModal.show(eventId);
                            } else {
                                console.error('[EventsSupabase] EventModal not ready, retrying...');
                                // 少し待ってからリトライ
                                setTimeout(() => {
                                    if (window.eventModal && typeof window.eventModal.show === 'function') {
                                        window.eventModal.show(eventId);
                                    } else {
                                        console.error('[EventsSupabase] EventModal still not available');
                                        if (window.showToast) {
                                            window.showToast('イベント詳細の表示に失敗しました', 'error');
                                        }
                                    }
                                }, 500);
                            }
                        } else {
                            console.error('[EventsSupabase] Missing eventId');
                        }
                    }
                });
                
                // リスナー追加済みフラグをセット
                card.dataset.listenerAdded = 'true';

                // 参加申込ボタン
                const button = card.querySelector('.btn-primary, .btn-outline');
                if (button) {
                    button.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const eventId = card.dataset.eventId;
                        this.handleEventRegistration(eventId, button);
                    });
                }
            });
        }

        /**
         * イベント参加申込処理
         */
        async handleEventRegistration(eventId, button) {
            try {
                // ユーザー認証チェック
                const user = await window.safeGetUser();
                if (!user || (user.user_metadata && user.user_metadata.isGuest)) {
                    if (window.showToast) {
                        window.showToast('ログインが必要です', 'warning');
                    }
                    window.location.href = 'login.html';
                    return;
                }

                // ボタンを無効化
                button.disabled = true;
                const originalText = button.innerHTML;
                button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 処理中...';

                // 既に参加登録しているかチェック
                const { data: existing } = await window.supabaseClient
                    .from('event_participants')
                    .select('id, status')
                    .eq('event_id', eventId)
                    .eq('user_id', user.id)
                    .maybeSingle();

                if (existing) {
                    if (existing.status === 'cancelled') {
                        // キャンセル済みの場合は再登録
                        const { error: updateError } = await window.supabaseClient
                            .from('event_participants')
                            .update({ 
                                status: 'registered',
                                registration_date: new Date().toISOString()
                            })
                            .eq('id', existing.id);

                        if (updateError) throw updateError;
                    } else {
                        if (window.showToast) {
                            window.showToast('既に参加登録済みです', 'info');
                        }
                        button.innerHTML = originalText;
                        button.disabled = false;
                        return;
                    }
                } else {
                    // 定員チェック（サーバーサイドにトリガーがないためクライアントで確認）
                    const { count: currentCount } = await window.supabaseClient
                        .from('event_participants')
                        .select('*', { count: 'exact', head: true })
                        .eq('event_id', eventId)
                        .neq('status', 'cancelled');

                    const maxParticipants = this.allEvents?.find(e => e.id === eventId)?.max_participants;
                    if (maxParticipants && currentCount >= maxParticipants) {
                        if (window.showToast) {
                            window.showToast('定員に達しています', 'warning');
                        }
                        button.innerHTML = originalText;
                        button.disabled = false;
                        return;
                    }

                    // 新規登録
                    const { error: insertError } = await window.supabaseClient
                        .from('event_participants')
                        .insert({
                            event_id: eventId,
                            user_id: user.id,
                            status: 'registered'
                        });

                    if (insertError) throw insertError;
                }

                // アクティビティ記録
                const eventCard = button.closest('[data-event-id]');
                const eventTitle = eventCard?.querySelector('.event-title, h3, h4')?.textContent || 'イベント';
                await window.supabaseClient
                    .from('activities')
                    .insert({
                        type: 'event_registered',
                        title: `「${eventTitle}」に参加登録しました`,
                        user_id: user.id
                    });

                // 成功通知
                button.innerHTML = '<i class="fas fa-check"></i> 申込完了';
                button.classList.remove('btn-primary', 'btn-outline');
                button.classList.add('btn-success');

                // イベントを再読み込み
                setTimeout(() => {
                    this.loadEvents();
                }, 2000);

            } catch (error) {
                console.error('[EventsSupabase] Registration error:', error);
                if (window.showToast) {
                    window.showToast('申込処理中にエラーが発生しました', 'error');
                }
                button.innerHTML = originalText;
                button.disabled = false;
            }
        }

        /**
         * 日付フォーマット
         */
        formatEventDate(date, startTime, endTime) {
            const dateStr = date.toLocaleDateString('ja-JP', {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                weekday: 'short'
            });

            if (startTime && endTime) {
                return `${dateStr} ${startTime.slice(0, 5)}-${endTime.slice(0, 5)}`;
            } else if (startTime) {
                return `${dateStr} ${startTime.slice(0, 5)}〜`;
            }
            return dateStr;
        }

        /**
         * テキストをトランケート
         */
        truncateText(text, maxLength) {
            if (!text || text.length <= maxLength) return text;
            return text.slice(0, maxLength) + '...';
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

        /**
         * ローディング表示
         */
        showLoading() {
            const container = document.querySelector('.events-grid');
            if (!container) return;

            container.innerHTML = `
                <div class="loading-state">
                    <i class="fas fa-spinner fa-spin fa-3x"></i>
                    <p>イベントを読み込んでいます...</p>
                </div>
            `;
        }

        /**
         * エラー表示
         */
        showError(message) {
            const container = document.querySelector('.events-grid');
            if (!container) return;

            container.innerHTML = `
                <div class="error-state">
                    <i class="fas fa-exclamation-circle fa-3x"></i>
                    <h3>エラー</h3>
                    <p>${window.escapeHTML ? window.escapeHTML(message) : message}</p>
                    <button class="btn btn-primary" onclick="window.eventsSupabase.loadEvents()">
                        再読み込み
                    </button>
                </div>
            `;
        }

        /**
         * フィルター変更処理
         */
        handleFilterChange(button) {
            const filter = button.dataset.filter;
            
            // すべてのフィルターボタンから active クラスを削除
            document.querySelectorAll('.filter-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            
            // 新しいフィルターセットを作成
            this.activeFilters.clear();
            
            if (filter === 'all') {
                this.activeFilters.add('all');
                button.classList.add('active');
            } else {
                // 複数フィルターの選択を許可
                if (button.classList.contains('active')) {
                    button.classList.remove('active');
                } else {
                    button.classList.add('active');
                }
                
                // アクティブなフィルターを収集
                document.querySelectorAll('.filter-btn.active').forEach(btn => {
                    if (btn.dataset.filter !== 'all') {
                        this.activeFilters.add(btn.dataset.filter);
                    }
                });
                
                // フィルターが何もない場合は「すべて」を選択
                if (this.activeFilters.size === 0) {
                    this.activeFilters.add('all');
                    document.querySelector('[data-filter="all"]').classList.add('active');
                }
            }
            
            this.applyFiltersAndSearch();
        }

        /**
         * フィルターと検索を適用
         */
        applyFiltersAndSearch() {
            let filteredEvents = [...this.allEvents];
            
            // フィルター適用
            if (!this.activeFilters.has('all')) {
                filteredEvents = filteredEvents.filter(event => {
                    let matchesType = true;
                    let matchesPrice = true;
                    
                    // オンライン/オフラインフィルター
                    const hasTypeFilter = this.activeFilters.has('online') || this.activeFilters.has('offline');
                    if (hasTypeFilter) {
                        matchesType = false;
                        if (this.activeFilters.has('online') && (event.event_type === 'online' || event.event_type === 'hybrid')) {
                            matchesType = true;
                        }
                        if (this.activeFilters.has('offline') && (event.event_type === 'offline' || event.event_type === 'hybrid')) {
                            matchesType = true;
                        }
                    }
                    
                    // 無料/有料フィルター
                    const hasPriceFilter = this.activeFilters.has('free') || this.activeFilters.has('paid');
                    if (hasPriceFilter) {
                        matchesPrice = false;
                        if (this.activeFilters.has('free') && event.price === 0) matchesPrice = true;
                        if (this.activeFilters.has('paid') && event.price > 0) matchesPrice = true;
                    }
                    
                    return matchesType && matchesPrice;
                });
            }
            
            // 検索フィルター適用
            if (this.searchQuery) {
                const query = this.searchQuery.toLowerCase();
                filteredEvents = filteredEvents.filter(event => {
                    return (
                        event.title?.toLowerCase().includes(query) ||
                        event.description?.toLowerCase().includes(query) ||
                        event.location?.toLowerCase().includes(query) ||
                        event.organizer_name?.toLowerCase().includes(query) ||
                        event.tags?.some(tag => tag.toLowerCase().includes(query))
                    );
                });
            }
            
            // ソート適用
            filteredEvents = this.sortEvents(filteredEvents);
            
            // レンダリング
            this.renderEvents(filteredEvents);
        }

        /**
         * イベントをソート
         */
        sortEvents(events) {
            const sorted = [...events];
            
            switch (this.sortOrder) {
                case 'date_asc':
                    sorted.sort((a, b) => new Date(a.event_date) - new Date(b.event_date));
                    break;
                case 'date_desc':
                    sorted.sort((a, b) => new Date(b.event_date) - new Date(a.event_date));
                    break;
                case 'popular':
                    sorted.sort((a, b) => (b.participant_count || 0) - (a.participant_count || 0));
                    break;
                case 'price_asc':
                    sorted.sort((a, b) => (a.price || 0) - (b.price || 0));
                    break;
                case 'price_desc':
                    sorted.sort((a, b) => (b.price || 0) - (a.price || 0));
                    break;
            }
            
            return sorted;
        }

        /**
         * 過去のイベントを読み込む
         */
        async loadPastEvents() {
            try {
                const container = document.querySelector('.past-events-list');
                if (!container) return;

                // ローディング表示
                container.innerHTML = `
                    <div class="loading-state">
                        <i class="fas fa-spinner fa-spin"></i>
                        <span>過去のイベントを読み込んでいます...</span>
                    </div>
                `;

                // Supabaseから過去のイベントを取得
                const now = new Date().toISOString();
                const { data: events, error } = await window.supabaseClient
                    .from('event_items')
                    .select('*')
                    .eq('is_public', true)
                    .lt('event_date', now)
                    .order('event_date', { ascending: false })
                    .limit(5);

                if (error) {
                    // console.error('[EventsSupabase] Error loading past events:', error);
                    container.innerHTML = '<p class="error-message">過去のイベントの読み込みに失敗しました</p>';
                    return;
                }

                if (!events || events.length === 0) {
                    container.innerHTML = '<p class="empty-message">過去のイベントはまだありません</p>';
                    return;
                }

                // 過去のイベントをレンダリング
                const pastEventsHTML = events.map(event => {
                    const eventDate = new Date(event.event_date);
                    const dateNum = eventDate.getDate();
                    const month = eventDate.getMonth() + 1;
                    const location = event.event_type === 'online' ? 'オンライン' : (event.location || '');

                    return `
                        <div class="past-event-item" data-event-id="${event.id}">
                            <div class="past-event-date">
                                <span class="date">${dateNum}</span>
                                <span class="month">${month}月</span>
                            </div>
                            <div class="past-event-info">
                                <h4>${this.escapeHtml(event.title)}</h4>
                                <p>参加者：${event.participant_count || 0}名${location ? ' | ' + this.escapeHtml(location) : ''}</p>
                            </div>
                            <div class="past-event-action">
                                <button class="btn btn-text past-event-detail-btn" data-event-id="${event.id}">
                                    詳細を見る
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');

                container.innerHTML = pastEventsHTML;
                
                // 過去イベント詳細ボタンにイベントリスナーを追加
                const detailButtons = container.querySelectorAll('.past-event-detail-btn');
                detailButtons.forEach(button => {
                    button.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const eventId = button.dataset.eventId;
                        if (eventId && window.eventModal) {
                            window.eventModal.show(eventId);
                        }
                    });
                });
                
                // 過去イベントアイテム全体のクリックハンドラー
                const pastEventItems = container.querySelectorAll('.past-event-item');
                pastEventItems.forEach(item => {
                    item.addEventListener('click', (e) => {
                        // イベントバブリングを停止
                        e.stopPropagation();
                    });
                });

                // 参加者数を取得
                await this.loadPastEventParticipants(events);

            } catch (error) {
                // console.error('[EventsSupabase] Error loading past events:', error);
            }
        }

        /**
         * 過去のイベントの参加者数を取得
         */
        async loadPastEventParticipants(events) {
            if (!events || events.length === 0) return;

            const eventIds = events.map(e => e.id);
            
            try {
                const { data: participants } = await window.supabaseClient
                    .from('event_participants')
                    .select('event_id')
                    .in('event_id', eventIds)
                    .in('status', ['registered', 'confirmed']);

                if (participants) {
                    const counts = {};
                    participants.forEach(p => {
                        counts[p.event_id] = (counts[p.event_id] || 0) + 1;
                    });

                    // DOMを更新
                    events.forEach(event => {
                        const count = counts[event.id] || 0;
                        const eventItem = document.querySelector(`[data-event-id="${event.id}"] .past-event-info p`);
                        if (eventItem) {
                            const location = event.event_type === 'online' ? 'オンライン' : (event.location || '');
                            eventItem.textContent = `参加者：${count}名${location ? ' | ' + location : ''}`;
                        }
                    });
                }
            } catch (error) {
                // console.error('[EventsSupabase] Error loading past event participants:', error);
            }
        }
    }

    // グローバルに公開
    window.EventsSupabase = EventsSupabase;
    window.eventsSupabase = new EventsSupabase();

    // console.log('[EventsSupabase] Module loaded');

})();

// ============================================================
// Section: event-modal.js
// ============================================================

/**
 * Event Modal Management
 * イベント詳細モーダルの管理
 */

(function() {
    'use strict';

    class EventModal {
        constructor() {
            this.modal = document.getElementById('eventDetailModal');
            this.modalTitle = document.getElementById('modalEventTitle');
            this.modalBody = document.getElementById('modalEventBody');
            this.eventActionBtn = document.getElementById('eventActionBtn');
            this.currentEvent = null;
            
            // DOM要素が見つからない場合のエラーチェック
            if (!this.modal) {
                console.error('[EventModal] モーダル要素が見つかりません: #eventDetailModal');
                return;
            }
            
            this.init();
        }

        escapeHtml(text) {
            if (text == null) return '';
            const div = document.createElement('div');
            div.textContent = String(text);
            return div.innerHTML;
        }

        init() {
            // モーダルオーバーレイクリックで閉じる
            const overlay = this.modal.querySelector('.modal-overlay');
            if (overlay) {
                overlay.addEventListener('click', () => this.close());
            }

            // アクションボタンのイベント
            if (this.eventActionBtn) {
                this.eventActionBtn.addEventListener('click', () => this.handleEventAction());
            }

            // console.log('[EventModal] Initialized');
        }

        /**
         * イベント詳細を表示
         */
        async show(eventId) {
            // console.log('[EventModal] Showing event:', eventId);
            
            // モーダルが存在しない場合は終了
            if (!this.modal) {
                console.error('[EventModal] モーダルが初期化されていません');
                return;
            }

            try {
                // ローディング状態を表示
                this.showLoading();
                this.modal.classList.add('show');

                // Supabaseからイベント詳細を取得
                const { data: event, error } = await window.supabaseClient
                    .from('event_items')
                    .select('*')
                    .eq('id', eventId)
                    .maybeSingle();

                if (error) {
                    console.error('[EventModal] Error fetching event:', error);
                    // console.error('[EventModal] Error details:', {
                    //     code: error.code,
                    //     message: error.message,
                    //     details: error.details,
                    //     hint: error.hint,
                    //     table: 'event_items',
                    //     eventId: eventId
                    // });
                    this.showError('イベント情報の取得に失敗しました');
                    return;
                }

                if (!event) {
                    this.showError('イベントが見つかりませんでした');
                    return;
                }

                this.currentEvent = event;
                // モーダルにイベントIDを保存
                if (this.modal) {
                    this.modal.dataset.eventId = eventId;
                }
                this.displayEventDetails(event);

                // 参加者数を取得
                await this.fetchParticipantsCount(eventId);

                // ユーザーの参加状況を確認
                await this.checkUserParticipation(eventId);

            } catch (error) {
                console.error('[EventModal] Error:', error);
                this.showError('エラーが発生しました');
            }
        }

        /**
         * イベント詳細を表示
         */
        displayEventDetails(event) {
            // タイトルを設定
            this.modalTitle.textContent = event.title || 'イベント詳細';

            // 日付のフォーマット
            const eventDate = new Date(event.event_date);
            const dateStr = eventDate.toLocaleDateString('ja-JP', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                weekday: 'long'
            });

            // ステータスの判定
            const now = new Date();
            const isUpcoming = eventDate > now;
            const isToday = eventDate.toDateString() === now.toDateString();
            
            let status = 'upcoming';
            let statusText = '開催予定';
            let statusClass = 'upcoming';
            
            if (isToday) {
                status = 'ongoing';
                statusText = '本日開催';
                statusClass = 'ongoing';
            } else if (!isUpcoming) {
                status = 'ended';
                statusText = '終了';
                statusClass = 'ended';
            }

            // 詳細コンテンツのHTML
            const detailHTML = `
                <div class="event-detail-content">
                    <!-- イベントヒーローセクション -->
                    <div class="event-hero">
                        <div class="event-date-large">
                            <div class="date">${eventDate.getDate()}</div>
                            <div class="month">${eventDate.getMonth() + 1}月</div>
                        </div>
                        <h2 class="event-title-large">${this.escapeHtml(event.title)}</h2>
                        <div class="event-meta">
                            <div class="event-meta-item">
                                <i class="fas fa-clock"></i>
                                <span>${this.escapeHtml(event.time || '時間未定')}</span>
                            </div>
                            <div class="event-meta-item">
                                <i class="fas fa-map-marker-alt"></i>
                                <span>${this.escapeHtml(event.location || '場所未定')}</span>
                            </div>
                            <div class="event-meta-item">
                                <span class="event-status ${statusClass}">
                                    ${statusText}
                                </span>
                            </div>
                        </div>
                    </div>

                    <!-- イベント説明 -->
                    <div class="event-info-section">
                        <h3><i class="fas fa-info-circle"></i> イベント概要</h3>
                        <p class="event-description">
                            ${this.escapeHtml(event.description || 'イベントの詳細情報はまだ登録されていません。')}
                        </p>
                    </div>

                    <!-- 参加者情報 -->
                    <div class="event-info-section">
                        <h3><i class="fas fa-users"></i> 参加者情報</h3>
                        <div class="event-stats">
                            <div class="event-stat">
                                <span class="event-stat-value" id="participantCount">-</span>
                                <span class="event-stat-label">参加者数</span>
                            </div>
                            <div class="event-stat">
                                <span class="event-stat-value">${event.max_participants || '∞'}</span>
                                <span class="event-stat-label">定員</span>
                            </div>
                            <div class="event-stat">
                                <span class="event-stat-value" id="remainingSeats">-</span>
                                <span class="event-stat-label">残席</span>
                            </div>
                        </div>
                        <div class="participant-list" id="participantList">
                            <!-- 参加者アバターがここに表示される -->
                        </div>
                    </div>

                    <!-- 詳細情報 -->
                    ${this.renderAdditionalInfo(event)}

                    <!-- タグ -->
                    ${this.renderTags(event)}
                </div>
            `;

            this.modalBody.innerHTML = detailHTML;

            // アクションボタンの設定
            this.updateActionButton(event, status);
        }

        /**
         * 追加情報のレンダリング
         */
        renderAdditionalInfo(event) {
            const info = [];

            if (event.organizer) {
                info.push(`
                    <div class="event-info-section">
                        <h3><i class="fas fa-user-tie"></i> 主催者</h3>
                        <p>${this.escapeHtml(event.organizer)}</p>
                    </div>
                `);
            }

            if (event.requirements) {
                info.push(`
                    <div class="event-info-section">
                        <h3><i class="fas fa-check-circle"></i> 参加条件</h3>
                        <p>${this.escapeHtml(event.requirements)}</p>
                    </div>
                `);
            }

            if (event.agenda) {
                info.push(`
                    <div class="event-info-section">
                        <h3><i class="fas fa-list-ul"></i> アジェンダ</h3>
                        <pre style="white-space: pre-wrap; font-family: inherit;">${this.escapeHtml(event.agenda)}</pre>
                    </div>
                `);
            }

            return info.join('');
        }

        /**
         * タグのレンダリング
         */
        renderTags(event) {
            if (!event.tags || event.tags.length === 0) {
                return '';
            }

            const tagsHTML = event.tags.map(tag =>
                `<span class="event-tag">${this.escapeHtml(tag)}</span>`
            ).join('');

            return `
                <div class="event-info-section">
                    <h3><i class="fas fa-tags"></i> タグ</h3>
                    <div class="event-tags">${tagsHTML}</div>
                </div>
            `;
        }

        /**
         * 参加者数を取得
         */
        async fetchParticipantsCount(eventId) {
            try {
                // event_participantsテーブルから参加者数を取得
                const { count, error } = await window.supabaseClient
                    .from('event_participants')
                    .select('*', { count: 'exact', head: true })
                    .eq('event_id', eventId)
                    .eq('status', 'confirmed');

                if (!error && count !== null) {
                    const participantCountEl = document.getElementById('participantCount');
                    const remainingSeatsEl = document.getElementById('remainingSeats');
                    
                    if (participantCountEl) {
                        participantCountEl.textContent = count;
                    }
                    
                    if (remainingSeatsEl && this.currentEvent.max_participants) {
                        const remaining = Math.max(0, this.currentEvent.max_participants - count);
                        remainingSeatsEl.textContent = remaining;
                        
                        // 満席の場合はボタンを無効化
                        if (remaining === 0) {
                            this.eventActionBtn.textContent = '満席';
                            this.eventActionBtn.disabled = true;
                            this.eventActionBtn.classList.remove('btn-primary');
                            this.eventActionBtn.classList.add('btn-secondary');
                        }
                    } else if (remainingSeatsEl) {
                        remainingSeatsEl.textContent = '∞';
                    }

                    // 参加者のプレビューを表示（最大5名）
                    await this.fetchParticipantPreviews(eventId);
                }
            } catch (error) {
                // console.error('[EventModal] Error fetching participants:', error);
            }
        }

        /**
         * 参加者プレビューを取得
         */
        async fetchParticipantPreviews(eventId) {
            try {
                const { data: participants, error } = await window.supabaseClient
                    .from('event_participants')
                    .select('user_id')
                    .eq('event_id', eventId)
                    .eq('status', 'confirmed')
                    .limit(5);

                if (!error && participants) {
                    const participantListEl = document.getElementById('participantList');
                    if (participantListEl) {
                        const avatarsHTML = participants.map((p, index) => {
                            // ユーザーIDの最初の2文字を使用
                            const initial = p.user_id ? p.user_id.substring(0, 2).toUpperCase() : '?';
                            return `
                                <div class="participant-avatar" title="参加者">
                                    ${initial}
                                </div>
                            `;
                        }).join('');

                        // 5人以上いる場合は+表示
                        const totalCount = parseInt(document.getElementById('participantCount').textContent);
                        const moreCount = totalCount - 5;
                        const moreHTML = moreCount > 0 ? `
                            <div class="participant-avatar participant-more">
                                +${moreCount}
                            </div>
                        ` : '';

                        participantListEl.innerHTML = avatarsHTML + moreHTML;
                    }
                }
            } catch (error) {
                // console.error('[EventModal] Error fetching participant previews:', error);
            }
        }

        /**
         * ユーザーの参加状況を確認
         */
        async checkUserParticipation(eventId) {
            try {
                const user = await window.safeGetUser();
                if (!user || (user.user_metadata && user.user_metadata.isGuest)) return;

                const { data: participation } = await window.supabaseClient
                    .from('event_participants')
                    .select('status')
                    .eq('event_id', eventId)
                    .eq('user_id', user.id)
                    .maybeSingle();

                if (participation && participation.status !== 'cancelled') {
                    this.eventActionBtn.textContent = '参加登録済み';
                    this.eventActionBtn.classList.remove('btn-primary');
                    this.eventActionBtn.classList.add('btn-success');
                    this.eventActionBtn.disabled = true;
                }
            } catch (error) {
                // エラーは無視（未参加として扱う）
                // console.log('[EventModal] User not registered for this event');
            }
        }

        /**
         * アクションボタンの更新
         */
        updateActionButton(event, status) {
            if (status === 'ended') {
                this.eventActionBtn.textContent = '終了済み';
                this.eventActionBtn.disabled = true;
                this.eventActionBtn.classList.remove('btn-primary');
                this.eventActionBtn.classList.add('btn-secondary');
            } else {
                this.eventActionBtn.textContent = '参加する';
                this.eventActionBtn.disabled = false;
                this.eventActionBtn.classList.add('btn-primary');
                this.eventActionBtn.classList.remove('btn-secondary', 'btn-success');
            }
        }

        /**
         * イベントアクションの処理
         */
        async handleEventAction() {
            if (!this.currentEvent || this.eventActionBtn.disabled) return;

            try {
                // ユーザー認証チェック
                const user = await window.safeGetUser();
                if (!user || (user.user_metadata && user.user_metadata.isGuest)) {
                    if (window.showToast) {
                        window.showToast('ログインが必要です', 'warning');
                    }
                    window.location.href = 'login.html';
                    return;
                }

                this.eventActionBtn.disabled = true;
                this.eventActionBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 処理中...';

                // 既に参加登録しているかチェック
                const { data: existing, error: checkError } = await window.supabaseClient
                    .from('event_participants')
                    .select('id, status')
                    .eq('event_id', this.currentEvent.id)
                    .eq('user_id', user.id)
                    .maybeSingle();
                
                if (checkError && checkError.code !== 'PGRST116') {
                    console.error('[EventModal] 参加状況確認エラー:', checkError);
                    throw checkError;
                }

                if (existing) {
                    if (existing.status === 'cancelled') {
                        // キャンセル済みの場合は再登録
                        const { error: updateError } = await window.supabaseClient
                            .from('event_participants')
                            .update({ 
                                status: 'registered',
                                registration_date: new Date().toISOString()
                            })
                            .eq('id', existing.id);

                        if (updateError) throw updateError;
                    } else {
                        if (window.showToast) {
                            window.showToast('既に参加登録済みです', 'info');
                        }
                        this.eventActionBtn.textContent = '参加登録済み';
                        this.eventActionBtn.classList.remove('btn-primary');
                        this.eventActionBtn.classList.add('btn-success');
                        return;
                    }
                } else {
                    // 定員チェック（サーバーサイドにトリガーがないためクライアントで確認）
                    if (this.currentEvent.max_participants) {
                        const { count: currentCount } = await window.supabaseClient
                            .from('event_participants')
                            .select('*', { count: 'exact', head: true })
                            .eq('event_id', this.currentEvent.id)
                            .neq('status', 'cancelled');

                        if (currentCount >= this.currentEvent.max_participants) {
                            if (window.showToast) {
                                window.showToast('定員に達しています', 'warning');
                            }
                            this.eventActionBtn.textContent = '満席';
                            this.eventActionBtn.disabled = true;
                            return;
                        }
                    }

                    // 新規登録
                    const { error: insertError } = await window.supabaseClient
                        .from('event_participants')
                        .insert({
                            event_id: this.currentEvent.id,
                            user_id: user.id,
                            status: 'registered'
                        });

                    if (insertError) throw insertError;
                }

                this.eventActionBtn.textContent = '参加登録済み';
                this.eventActionBtn.classList.remove('btn-primary');
                this.eventActionBtn.classList.add('btn-success');

                // 参加者数を再取得
                await this.fetchParticipantsCount(this.currentEvent.id);

            } catch (error) {
                console.error('[EventModal] Error handling action:', error);
                if (window.showToast) {
                    window.showToast('エラーが発生しました。もう一度お試しください。', 'error');
                }
                this.updateActionButton(this.currentEvent, 'upcoming');
            }
        }

        /**
         * ローディング表示
         */
        showLoading() {
            this.modalBody.innerHTML = `
                <div class="loading-state">
                    <div class="loading-spinner">
                        <i class="fas fa-spinner fa-spin"></i>
                    </div>
                    <div class="loading-message">イベント情報を読み込んでいます...</div>
                </div>
            `;
        }

        /**
         * エラー表示
         */
        showError(message) {
            this.modalBody.innerHTML = `
                <div class="error-state">
                    <div class="error-icon">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <div class="error-message">${message}</div>
                </div>
            `;
        }

        /**
         * モーダルを閉じる
         */
        close() {
            this.modal.classList.remove('show');
            this.currentEvent = null;
            
            // 少し待ってからコンテンツをクリア
            setTimeout(() => {
                this.modalBody.innerHTML = '';
                this.modalTitle.textContent = 'イベント詳細';
            }, 300);
        }
    }

    // グローバルに公開
    window.EventModal = EventModal;
    
    // DOM準備後に初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            const modal = new EventModal();
            // モーダル要素が正常に取得できた場合のみグローバルに設定
            if (modal.modal) {
                window.eventModal = modal;
                // dashboardUIが存在する場合のみ更新
                if (window.dashboardUI) {
                    updateDashboardUI();
                }
                // console.log('[EventModal] Initialized on DOMContentLoaded');
                
                // EventModalReadyイベントを発火
                const event = new CustomEvent('eventModalReady');
                document.dispatchEvent(event);
            } else {
                console.error('[EventModal] Failed to initialize - modal element not found');
            }
        });
    } else {
        // 既にDOMが準備できている場合
        setTimeout(() => {
            const modal = new EventModal();
            // モーダル要素が正常に取得できた場合のみグローバルに設定
            if (modal.modal) {
                window.eventModal = modal;
                // dashboardUIが存在する場合のみ更新
                if (window.dashboardUI) {
                    updateDashboardUI();
                }
                // console.log('[EventModal] Initialized immediately');
                
                // EventModalReadyイベントを発火
                const event = new CustomEvent('eventModalReady');
                document.dispatchEvent(event);
            } else {
                console.error('[EventModal] Failed to initialize - modal element not found');
            }
        }, 0);
    }
    
    function updateDashboardUI() {
        // dashboardUIのメソッドを更新
        if (window.dashboardUI) {
            window.dashboardUI.viewEventDetails = function(eventId) {
                if (window.eventModal) {
                    window.eventModal.show(eventId);
                }
            };
            
            window.dashboardUI.closeEventModal = function() {
                if (window.eventModal) {
                    window.eventModal.close();
                }
            };
        }
    }

    // console.log('[EventModal] Module loaded');

})();

// ============================================================
// Section: calendar-integration.js
// ============================================================

/**
 * カレンダー連携機能
 * 
 * 機能:
 * - イベントのカレンダー表示
 * - Googleカレンダー連携
 * - iCalエクスポート
 * - イベントリマインダー
 */

(function() {
    'use strict';

    // console.log('[CalendarIntegration] カレンダー連携機能初期化');

    // グローバル変数
    let currentUserId = null;
    let calendarInstance = null;
    let events = [];

    // 初期化
    async function initialize() {
        // console.log('[CalendarIntegration] 初期化開始');

        // Supabaseの準備を待つ
        await window.waitForSupabase();

        // 現在のユーザーを取得
        const user = await window.safeGetUser();
        if (!user || (user.user_metadata && user.user_metadata.isGuest)) {
            // ゲストモードではカレンダー統合をスキップ
            return;
        }

        currentUserId = user.id;
        // console.log('[CalendarIntegration] ユーザーID:', currentUserId);

        // カレンダー要素が存在する場合のみ初期化
        const calendarEl = document.getElementById('calendar');
        if (calendarEl) {
            initializeCalendar(calendarEl);
            await loadEvents();
        }

        // イベントリスナーの設定
        setupEventListeners();
    }

    // カレンダーの初期化（FullCalendar使用）
    function initializeCalendar(calendarEl) {
        // FullCalendarライブラリが読み込まれているか確認
        if (typeof FullCalendar === 'undefined') {
            console.error('[CalendarIntegration] FullCalendarライブラリが読み込まれていません');
            return;
        }

        calendarInstance = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            locale: 'ja',
            height: 'auto',
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,listMonth'
            },
            buttonText: {
                today: '今日',
                month: '月',
                week: '週',
                list: 'リスト'
            },
            events: [],
            eventClick: handleEventClick,
            dateClick: function(info) {
                // handleDateClick関数を安全に呼び出す
                if (typeof handleDateClick === 'function') {
                    handleDateClick(info);
                }
            },
            eventDisplay: 'block',
            eventColor: '#4a90e2',
            eventTextColor: '#ffffff',
            dayMaxEvents: 3,
            moreLinkText: '他 {0} 件',
            noEventsText: 'イベントはありません'
        });

        calendarInstance.render();
    }

    // イベントリスナーの設定
    function setupEventListeners() {
        // カレンダー表示ボタン
        const showCalendarBtn = document.getElementById('show-calendar-view');
        if (showCalendarBtn) {
            showCalendarBtn.addEventListener('click', () => {
                const calendarSection = document.getElementById('calendar-view');
                if (calendarSection) {
                    calendarSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    // カレンダーがまだ初期化されていない場合は初期化
                    if (!calendarInstance) {
                        const calendarEl = document.getElementById('calendar');
                        if (calendarEl) {
                            initializeCalendar(calendarEl);
                            loadEvents();
                        }
                    }
                }
            });
        }

        // Googleカレンダー連携ボタン
        const googleSyncBtn = document.getElementById('google-calendar-sync');
        if (googleSyncBtn) {
            googleSyncBtn.addEventListener('click', syncWithGoogleCalendar);
        }

        // iCalエクスポートボタン
        const exportBtn = document.getElementById('export-calendar');
        if (exportBtn) {
            exportBtn.addEventListener('click', exportToICal);
        }

        // ビュー切り替えボタン
        document.querySelectorAll('[data-calendar-view]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const view = e.target.dataset.calendarView;
                if (calendarInstance) {
                    calendarInstance.changeView(view);
                }
            });
        });
    }

    // イベントの読み込み
    async function loadEvents() {
        try {
            // まず参加しているイベントIDを取得
            const { data: participations, error: participationError } = await window.supabaseClient
                .from('event_participants')
                .select('event_id, status')
                .eq('user_id', currentUserId)
                .in('status', ['registered', 'confirmed']);

            if (participationError) throw participationError;

            if (!participations || participations.length === 0) {
                events = [];
                if (calendarInstance) {
                    calendarInstance.removeAllEvents();
                }
                return;
            }

            // イベントIDの配列を作成
            const eventIds = participations.map(p => p.event_id);

            // イベント詳細を別途取得
            const { data: eventItems, error: eventError } = await window.supabaseClient
                .from('event_items')
                .select(`
                    id,
                    title,
                    description,
                    event_date,
                    start_time,
                    end_time,
                    location,
                    event_type,
                    online_url,
                    organizer_id
                `)
                .in('id', eventIds);

            if (eventError) throw eventError;

            // 参加状態とイベント情報をマージ
            events = (eventItems || []).map(event => {
                const participation = participations.find(p => p.event_id === event.id);
                const startDateTime = combineDateTime(event.event_date, event.start_time);
                const endDateTime = combineDateTime(event.event_date, event.end_time);

                return {
                    id: event.id,
                    title: event.title,
                    start: startDateTime,
                    end: endDateTime,
                    description: event.description,
                    location: event.event_type === 'online' ? 'オンライン' : event.location,
                    extendedProps: {
                        isOnline: event.event_type === 'online' || event.event_type === 'hybrid',
                        meetingUrl: event.online_url,
                        organizerId: event.organizer_id,
                        attendanceStatus: participation ? participation.status : 'registered'
                    }
                };
            });

            // カレンダーにイベントを追加
            if (calendarInstance) {
                calendarInstance.removeAllEvents();
                calendarInstance.addEventSource(events);
            }

        } catch (error) {
            console.error('[CalendarIntegration] イベント読み込みエラー:', error);
            showError('イベントの読み込みに失敗しました');
        }
    }

    // 日付と時刻を結合
    function combineDateTime(date, time) {
        if (!date || !time) return null;
        return `${date}T${time}`;
    }

    // イベントクリック処理
    function handleEventClick(info) {
        const event = info.event;
        showEventModal(event);
    }

    // ユーティリティ関数：日付フォーマット
    function formatDate(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleDateString('ja-JP', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long'
        });
    }

    // ユーティリティ関数：時刻フォーマット
    function formatTime(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleTimeString('ja-JP', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    // ユーティリティ関数：HTMLエスケープ
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 日付クリック処理
    function handleDateClick(info) {
        try {
            // 新規イベント作成モーダルを表示
            // TODO: イベント作成機能は別途実装予定
            // console.log('[CalendarIntegration] 日付クリック:', info.dateStr);
            
            // イベント作成モーダルを表示（存在する場合）
            if (typeof window.showCreateEventModal === 'function') {
                window.showCreateEventModal(info.dateStr);
            } else {
                // モーダルが存在しない場合は、トースト通知で案内
                if (window.showToast) {
                    window.showToast(`${info.dateStr} のイベント作成機能は準備中です`, 'info');
                }
                // 暫定処理：イベントページへ遷移（confirm使用せず）
                // window.location.href = `events.html?action=create&date=${info.dateStr}`;
            }
        } catch (error) {
            // ドラッグ操作時のshowCreateEventModal未定義エラーを抑制
            // console.error('[CalendarIntegration] 日付クリックエラー:', error);
            // エラーが発生してもトースト通知は表示しない（UXを損なうため）
        }
    }

    // イベント詳細モーダル表示
    function showEventModal(event) {
        // 既存のモーダルがあれば削除
        const existingModal = document.querySelector('.calendar-event-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        const modal = document.createElement('div');
        modal.className = 'modal calendar-event-modal';
        
        // モーダルコンテンツを構築
        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';
        
        // ヘッダー
        const modalHeader = document.createElement('div');
        modalHeader.className = 'modal-header';
        
        const title = document.createElement('h2');
        title.textContent = event.title;
        modalHeader.appendChild(title);
        
        const closeButton = document.createElement('button');
        closeButton.className = 'close-button';
        closeButton.innerHTML = '<i class="fas fa-times"></i>';
        
        // イベントリスナーをクリーンアップ関数付きで追加
        const closeModal = () => {
            modal.classList.remove('active');
            setTimeout(() => {
                if (modal.parentNode) {
                    modal.remove();
                }
            }, 300); // アニメーション完了を待つ
        };
        
        closeButton.addEventListener('click', closeModal);
        modalHeader.appendChild(closeButton);
        
        modalContent.appendChild(modalHeader);
        
        // ボディ
        const modalBody = document.createElement('div');
        modalBody.className = 'modal-body';
        modalBody.innerHTML = `
            <div class="event-info">
                <div class="info-item">
                    <i class="fas fa-calendar"></i>
                    <span>${escapeHtml(formatDate(event.start))}</span>
                </div>
                <div class="info-item">
                    <i class="fas fa-clock"></i>
                    <span>${escapeHtml(formatTime(event.start))} - ${escapeHtml(formatTime(event.end))}</span>
                </div>
                <div class="info-item">
                    <i class="fas fa-map-marker-alt"></i>
                    <span>${escapeHtml(event.extendedProps.location || 'オンライン')}</span>
                </div>
                ${event.extendedProps.isOnline && event.extendedProps.meetingUrl ? `
                    <div class="info-item">
                        <i class="fas fa-video"></i>
                        <a href="${escapeHtml(event.extendedProps.meetingUrl)}" target="_blank">ミーティングリンク</a>
                    </div>
                ` : ''}
            </div>
            ${event.extendedProps.description ? `
                <div class="event-description">
                    <h4>詳細</h4>
                    <p>${escapeHtml(event.extendedProps.description)}</p>
                </div>
            ` : ''}
        `;
        modalContent.appendChild(modalBody);
        
        // フッター
        const modalFooter = document.createElement('div');
        modalFooter.className = 'modal-footer';
        
        const googleBtn = document.createElement('button');
        googleBtn.className = 'btn btn-outline';
        googleBtn.innerHTML = '<i class="fab fa-google"></i> Googleカレンダーに追加';
        googleBtn.addEventListener('click', () => {
            window.CalendarIntegration.addToGoogleCalendar(event.id);
        });
        modalFooter.appendChild(googleBtn);
        
        const detailBtn = document.createElement('button');
        detailBtn.className = 'btn btn-primary';
        detailBtn.innerHTML = '<i class="fas fa-info-circle"></i> 詳細を見る';
        detailBtn.addEventListener('click', () => {
            window.location.href = `events.html?id=${event.id}`;
        });
        modalFooter.appendChild(detailBtn);
        
        modalContent.appendChild(modalFooter);
        modal.appendChild(modalContent);
        
        document.body.appendChild(modal);
        modal.classList.add('active');
        
        // ESCキーでモーダルを閉じる
        const handleEscKey = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEscKey);
            }
        };
        document.addEventListener('keydown', handleEscKey);
        
        // モーダル外クリックで閉じる
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
                document.removeEventListener('keydown', handleEscKey);
            }
        });
    }

    // Googleカレンダー連携
    async function syncWithGoogleCalendar() {
        try {
            // Google Calendar APIの初期化
            if (!window.gapi) {
                showError('Google APIが読み込まれていません');
                return;
            }

            // 認証
            await gapi.load('client:auth2');
            
            // Google Calendar API設定
            // 注意: 本番環境では環境変数またはサーバー側で管理すること
            const GOOGLE_API_KEY = window.GOOGLE_CALENDAR_API_KEY || '';
            const GOOGLE_CLIENT_ID = window.GOOGLE_CALENDAR_CLIENT_ID || '';
            
            if (!GOOGLE_API_KEY || !GOOGLE_CLIENT_ID) {
                showError('Google Calendar連携が設定されていません');
                console.warn('[CalendarIntegration] Google API credentials not configured');
                return;
            }
            
            await gapi.client.init({
                apiKey: GOOGLE_API_KEY,
                clientId: GOOGLE_CLIENT_ID,
                discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
                scope: 'https://www.googleapis.com/auth/calendar.events'
            });

            // サインイン
            const googleAuth = gapi.auth2.getAuthInstance();
            if (!googleAuth.isSignedIn.get()) {
                await googleAuth.signIn();
            }

            // イベントを同期
            for (const event of events) {
                await addEventToGoogleCalendar(event);
            }

            showSuccess('Googleカレンダーとの同期が完了しました');

        } catch (error) {
            console.error('[CalendarIntegration] Google連携エラー:', error);
            showError('Googleカレンダーとの連携に失敗しました');
        }
    }

    // Googleカレンダーにイベント追加
    async function addEventToGoogleCalendar(event) {
        const googleEvent = {
            summary: event.title,
            description: event.description,
            start: {
                dateTime: event.start,
                timeZone: 'Asia/Tokyo'
            },
            end: {
                dateTime: event.end,
                timeZone: 'Asia/Tokyo'
            },
            location: event.extendedProps.location
        };

        if (event.extendedProps.isOnline && event.extendedProps.meetingUrl) {
            googleEvent.description += `\n\nミーティングURL: ${event.extendedProps.meetingUrl}`;
        }

        const request = gapi.client.calendar.events.insert({
            calendarId: 'primary',
            resource: googleEvent
        });

        await request.execute();
    }

    // 単一イベントをGoogleカレンダーに追加（URLスキーム使用）
    function addToGoogleCalendar(eventId) {
        const event = events.find(e => e.id === eventId);
        if (!event) return;

        const startDate = new Date(event.start).toISOString().replace(/-|:|\.\d\d\d/g, '');
        const endDate = new Date(event.end).toISOString().replace(/-|:|\.\d\d\d/g, '');
        
        const details = encodeURIComponent(event.description || '');
        const location = encodeURIComponent(event.extendedProps.location || '');
        const title = encodeURIComponent(event.title);

        const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startDate}/${endDate}&details=${details}&location=${location}`;
        
        window.open(url, '_blank');
    }

    // iCalエクスポート
    function exportToICal() {
        if (events.length === 0) {
            showError('エクスポートするイベントがありません');
            return;
        }

        let icalContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//INTERCONNECT//Event Calendar//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
`;

        events.forEach(event => {
            const uid = `${event.id}@interconnect.com`;
            const dtstart = formatICalDate(new Date(event.start));
            const dtend = formatICalDate(new Date(event.end));
            const created = formatICalDate(new Date());

            icalContent += `BEGIN:VEVENT
UID:${uid}
DTSTAMP:${created}
DTSTART:${dtstart}
DTEND:${dtend}
SUMMARY:${event.title}
DESCRIPTION:${(event.description || '').replace(/\n/g, '\\n')}
LOCATION:${event.extendedProps.location || 'オンライン'}
STATUS:CONFIRMED
END:VEVENT
`;
        });

        icalContent += 'END:VCALENDAR';

        // ダウンロード
        const blob = new Blob([icalContent], { type: 'text/calendar;charset=utf-8' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'interconnect-events.ics';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        showSuccess('カレンダーファイルをエクスポートしました');
    }

    // iCal日付フォーマット
    function formatICalDate(date) {
        return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    }

    // 日付フォーマット
    function formatDate(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('ja-JP', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long'
        });
    }

    // 時刻フォーマット
    function formatTime(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleTimeString('ja-JP', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    // ユーティリティ関数
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // グローバルAPIとして公開
    window.CalendarIntegration = {
        initialize,
        syncWithGoogleCalendar,
        exportToICal,
        addToGoogleCalendar,
        refresh: loadEvents
    };

    // 初期化実行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();

