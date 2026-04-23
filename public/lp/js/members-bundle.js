// ============================================================
// members-bundle.js
// Page-specific bundle for members.html
// ============================================================

// ============================================================
// Section: members-supabase.js
// ============================================================

/**
 * Members Supabase Integration
 * メンバーページのSupabase連携
 */

(function() {
    'use strict';


    class MembersSupabaseManager {
        constructor() {
            this.members = [];
            this.currentPage = 1;
            this.itemsPerPage = 12;
            this.totalMembers = 0;
            this.filters = {
                search: '',
                industry: '',
                role: '',
                skills: []
            };
            this.initialized = false;
        }

        async init() {
            if (this.initialized) return;
            
            try {
                // Supabase接続確認
                if (!window.supabaseClient) {
                    console.error('[MembersSupabase] Supabaseクライアントが見つかりません');
                    this.showFallbackUI();
                    return;
                }


                // 認証状態を確認
                const user = await window.safeGetUser();
                if (!user) {
                    this.showFallbackUI();
                    return;
                }

                this.currentUserId = user.id;
                this.initialized = true;
                
                await this.loadMembers();
                this.setupRealtimeSubscription();
                
            } catch (error) {
                console.error('[MembersSupabase] 初期化エラー:', error);
                this.showFallbackUI();
            }
        }

        /**
         * メンバーデータを読み込む
         */
        async loadMembers() {
            try {
                
                // ベースクエリ（user_profilesテーブルを使用 - active_usersはビュー）
                let query = window.supabaseClient
                    .from('user_profiles')
                    .select('*', { count: 'exact' })
                    .eq('is_active', true)
                    .neq('id', this.currentUserId); // 自分以外のメンバー

                // 検索フィルター（nameも検索対象に追加）
                if (this.filters.search) {
                    // サニタイズ: 特殊文字をエスケープ
                    const sanitizedSearch = this.filters.search.replace(/[%_\\]/g, '\\$&');
                    query = query.or(`name.ilike.%${sanitizedSearch}%,full_name.ilike.%${sanitizedSearch}%,company.ilike.%${sanitizedSearch}%,bio.ilike.%${sanitizedSearch}%`);
                }

                // 業界フィルター
                if (this.filters.industry) {
                    query = query.eq('industry', this.filters.industry);
                }

                // 役職フィルター（positionを使用）
                if (this.filters.role) {
                    // roleマッピング: executive->経営者・役員, manager->管理職など
                    const roleMap = {
                        'executive': ['CEO', 'CTO', 'CFO', '代表', '役員', '社長'],
                        'manager': ['部長', 'マネージャー', '課長', 'リーダー'],
                        'specialist': ['エンジニア', 'デザイナー', 'コンサルタント', '専門'],
                        'general': ['一般', 'スタッフ', 'メンバー']
                    };
                    
                    if (roleMap[this.filters.role]) {
                        const positions = roleMap[this.filters.role];
                        // サニタイズ: 各役職文字列をエスケープ
                        const sanitizedPositions = positions.map(pos => {
                            const sanitized = pos.replace(/[%_\\]/g, '\\$&');
                            return `position.ilike.%${sanitized}%`;
                        });
                        query = query.or(sanitizedPositions.join(','));
                    }
                }

                // スキルフィルター
                if (this.filters.skills.length > 0) {
                    query = query.contains('skills', this.filters.skills);
                }

                // ページネーション
                const from = (this.currentPage - 1) * this.itemsPerPage;
                const to = from + this.itemsPerPage - 1;
                query = query.range(from, to);

                // データ取得
                const { data, error, count } = await query;

                if (error) throw error;

                
                this.members = data || [];
                this.totalMembers = count || 0;

                // コネクション数を取得
                await this.loadConnectionCounts();

                // UIを更新
                this.updateMembersUI();
                this.updatePaginationUI();
                this.updateResultsCount();

            } catch (error) {
                console.error('[MembersSupabase] データ読み込みエラー:', error);
                this.showFallbackUI();
            }
        }

        /**
         * コネクション数を取得
         */
        async loadConnectionCounts() {
            try {
                const memberIds = this.members.map(m => m.id);
                
                if (memberIds.length === 0) return;
                
                // 各メンバーのコネクション数を取得
                const { data: connections, error } = await window.supabaseClient
                    .from('connections')
                    .select('user_id, connected_user_id')
                    .or(`user_id.in.(${memberIds.join(',')}),connected_user_id.in.(${memberIds.join(',')})`)
                    .eq('status', 'accepted');

                if (error) throw error;

                // コネクション数を集計
                const connectionCounts = {};
                memberIds.forEach(id => connectionCounts[id] = 0);

                connections?.forEach(conn => {
                    if (connectionCounts[conn.user_id] !== undefined) {
                        connectionCounts[conn.user_id]++;
                    }
                    if (connectionCounts[conn.connected_user_id] !== undefined) {
                        connectionCounts[conn.connected_user_id]++;
                    }
                });

                // メンバーデータに追加
                this.members = this.members.map(member => ({
                    ...member,
                    connectionCount: connectionCounts[member.id] || 0
                }));

            } catch (error) {
                console.error('[MembersSupabase] コネクション数取得エラー:', error);
            }
        }

        /**
         * メンバーUIを更新
         */
        updateMembersUI() {
            const grid = document.querySelector('.members-grid');
            if (!grid) return;

            // ローディングプレースホルダーを削除
            const loadingPlaceholder = grid.querySelector('.loading-placeholder');
            if (loadingPlaceholder) {
                loadingPlaceholder.remove();
            }

            if (this.members.length === 0) {
                grid.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-users"></i>
                        <h3>メンバーが見つかりません</h3>
                        <p>検索条件を変更してお試しください</p>
                    </div>
                `;
                return;
            }

            grid.innerHTML = this.members.map(member => this.createMemberCard(member)).join('');
            
            // プロフィールボタンにイベントリスナーを追加
            this.attachProfileButtonListeners();
        }
        
        /**
         * プロフィールボタンにイベントリスナーを追加
         */
        attachProfileButtonListeners() {
            document.querySelectorAll('.view-profile-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const memberId = btn.dataset.memberId;
                    if (!memberId) {
                        console.error('[MembersSupabase] No member ID found');
                        return false;
                    }
                    
                    // モーダル表示を試行
                    if (window.membersProfileModal && window.membersProfileModal.show) {
                        window.membersProfileModal.show(memberId);
                    } else {
                        console.error('[MembersSupabase] Modal not ready, retrying...');
                        setTimeout(() => {
                            if (window.membersProfileModal && window.membersProfileModal.show) {
                                window.membersProfileModal.show(memberId);
                            } else {
                                // モーダルが利用できない場合のみアラート表示
                                if (window.showToast) window.showToast('プロフィールを読み込み中です。もう一度お試しください。', 'warning');
                            }
                        }, 500);
                    }
                    
                    return false;
                });
            });
        }

        /**
         * メンバーカードを作成
         */
        createMemberCard(member) {
            const { 
                id, 
                name = '',
                full_name = '', 
                avatar_url = 'assets/user-placeholder.svg',
                position = '役職未設定',
                title = '',
                company = '会社未設定',
                industry = '',
                skills = [],
                connection_count = 0,
                is_online = false
            } = member;
            
            // 表示名とタイトルの決定
            const displayName = full_name || name || 'ユーザー';
            const displayTitle = title || position;

            // スキルタグを最大3つまで表示
            const displaySkills = skills.slice(0, 3);
            const hasMoreSkills = skills.length > 3;

            return `
                <div class="member-card" data-member-id="${id}" data-user-id="${id}">
                    <div class="member-header">
                        <div style="position: relative;">
                            <img src="${this.escapeHtml(avatar_url)}" 
                                 alt="${this.escapeHtml(displayName)}" 
                                 class="member-avatar"
                                 onerror="this.src='assets/user-placeholder.svg'">
                            ${is_online ? '<span class="online-indicator"></span>' : ''}
                        </div>
                        <div class="member-info">
                            <h3>${this.escapeHtml(displayName)}</h3>
                            <p class="member-title">${this.escapeHtml(displayTitle)}</p>
                            <p class="member-company">${this.escapeHtml(company)}</p>
                        </div>
                    </div>
                    ${displaySkills.length > 0 ? `
                        <div class="member-tags">
                            ${displaySkills.map(skill => `
                                <span class="tag">${this.escapeHtml(skill)}</span>
                            `).join('')}
                            ${hasMoreSkills ? `<span class="tag">+${skills.length - 3}</span>` : ''}
                        </div>
                    ` : ''}
                    <div class="member-stats">
                        <div class="stat">
                            <i class="fas fa-users"></i>
                            <span>${member.connectionCount || 0} コネクション</span>
                        </div>
                    </div>
                    <div class="member-actions">
                        <button class="btn btn-primary btn-small view-profile-btn" 
                                data-member-id="${id}"
                                type="button">
                            <i class="fas fa-user"></i>
                            <span class="btn-text">プロフィール</span>
                        </button>
                        <button class="btn btn-outline btn-small connect-btn" 
                                data-member-id="${id}"
                                data-member-name="${this.escapeHtml(displayName)}">
                            <i class="fas fa-plus"></i>
                            <span class="btn-text">コネクト</span>
                        </button>
                    </div>
                </div>
            `;
        }

        /**
         * ページネーションUIを更新
         */
        updatePaginationUI() {
            const pagination = document.querySelector('.pagination');
            if (!pagination) return;

            const totalPages = Math.ceil(this.totalMembers / this.itemsPerPage);
            
            // 前へボタン
            const prevButton = pagination.querySelector('button:first-child');
            if (prevButton) {
                prevButton.disabled = this.currentPage === 1;
                prevButton.onclick = () => this.changePage(this.currentPage - 1);
            }

            // 次へボタン
            const nextButton = pagination.querySelector('button:last-child');
            if (nextButton) {
                nextButton.disabled = this.currentPage === totalPages || totalPages === 0;
                nextButton.onclick = () => this.changePage(this.currentPage + 1);
            }

            // ページ番号
            const pageNumbers = pagination.querySelector('.page-numbers');
            if (pageNumbers) {
                pageNumbers.innerHTML = this.generatePageNumbers(totalPages);
            }
        }

        /**
         * ページ番号を生成
         */
        generatePageNumbers(totalPages) {
            if (totalPages === 0) return '';

            let html = '';
            const maxVisible = 5;
            let start = Math.max(1, this.currentPage - Math.floor(maxVisible / 2));
            let end = Math.min(totalPages, start + maxVisible - 1);

            if (end - start + 1 < maxVisible) {
                start = Math.max(1, end - maxVisible + 1);
            }

            for (let i = start; i <= end; i++) {
                html += `
                    <button class="page-number ${i === this.currentPage ? 'active' : ''}"
                            onclick="window.membersSupabase.changePage(${i})">
                        ${i}
                    </button>
                `;
            }

            return html;
        }

        /**
         * 結果数を更新
         */
        updateResultsCount() {
            const countElement = document.querySelector('.results-count');
            if (countElement) {
                countElement.innerHTML = `<span>${this.totalMembers}</span>名のメンバー`;
            }
        }

        /**
         * ページを変更
         */
        async changePage(page) {
            if (page < 1 || page === this.currentPage) return;
            
            this.currentPage = page;
            await this.loadMembers();
            
            // ページトップへスクロール
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        /**
         * リアルタイム購読を設定
         */
        setupRealtimeSubscription() {
            // プロフィール更新を監視
            this.profilesSubscription = window.supabaseClient
                .channel('public:user_profiles')
                .on('postgres_changes',
                    { event: 'UPDATE', schema: 'public', table: 'user_profiles' },
                    (payload) => this.handleProfileChange(payload)
                )
                .subscribe();
        }

        /**
         * プロフィール変更を処理
         */
        handleProfileChange(payload) {
            
            // 現在表示中のメンバーに変更があった場合は再読み込み
            const affectedMember = this.members.find(m => m.id === payload.new?.id || m.id === payload.old?.id);
            if (affectedMember) {
                this.loadMembers();
            }
        }

        /**
         * フォールバックUIを表示
         */
        showFallbackUI() {
            
            const grid = document.querySelector('.members-grid');
            if (!grid) return;
            
            // フォールバック用ダミーデータ
            const fallbackMembers = [
                {
                    id: 'fallback-1',
                    full_name: '山田 太郎',
                    avatar_url: 'assets/user-placeholder.svg',
                    title: '代表取締役CEO',
                    company: '株式会社テックイノベーション',
                    skills: ['IT', 'AI', 'DX推進'],
                    connectionCount: 0,
                    is_online: true
                },
                {
                    id: 'fallback-2',
                    full_name: '佐藤 花子',
                    avatar_url: 'assets/user-placeholder.svg',
                    title: 'マーケティング部長',
                    company: 'グローバルコマース株式会社',
                    skills: ['マーケティング', 'EC', 'グローバル'],
                    connectionCount: 0,
                    is_online: false
                },
                {
                    id: 'fallback-3',
                    full_name: '高橋 健一',
                    avatar_url: 'assets/user-placeholder.svg',
                    title: 'CTO',
                    company: 'デジタルソリューションズ',
                    skills: ['開発', 'クラウド', 'DevOps'],
                    connectionCount: 0,
                    is_online: true
                }
            ];
            
            this.members = fallbackMembers;
            this.totalMembers = fallbackMembers.length;
            
            // UIを更新
            this.updateMembersUI();
            this.updateResultsCount();
            
            // フォールバック時もイベントリスナーを追加
            setTimeout(() => {
                this.attachProfileButtonListeners();
            }, 100);
            
            // エラー表示を追加
            const errorBanner = document.createElement('div');
            errorBanner.className = 'error-banner';
            errorBanner.innerHTML = `
                <div class="error-content">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>データベースに接続できません。サンプルデータを表示しています。</span>
                    <button class="btn btn-small btn-primary" onclick="window.location.reload()">
                        再読み込み
                    </button>
                </div>
            `;
            
            const container = document.querySelector('.content-container');
            if (container && !container.querySelector('.error-banner')) {
                container.insertBefore(errorBanner, container.firstChild);
            }
        }

        /**
         * HTMLエスケープ
         */
        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text || '';
            return div.innerHTML;
        }

        /**
         * クリーンアップ
         */
        cleanup() {
            if (this.profilesSubscription) {
                window.supabaseClient.removeChannel(this.profilesSubscription);
            }
        }
    }

    // スタイルを追加
    const style = document.createElement('style');
    style.textContent = `
        /* オンラインインジケーター */
        .online-indicator {
            position: absolute;
            bottom: 5px;
            right: 5px;
            width: 16px;
            height: 16px;
            background-color: #4caf50;
            border: 3px solid white;
            border-radius: 50%;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }

        .member-card[data-member-id] {
            transition: all 0.3s ease;
        }

        /* 空の状態 */
        .empty-state {
            padding: 3rem;
            text-align: center;
            color: var(--text-secondary);
            grid-column: 1/-1;
        }

        .empty-state i {
            font-size: 3rem;
            margin-bottom: 1rem;
            opacity: 0.5;
        }

        .empty-state h3 {
            font-size: 1.25rem;
            margin-bottom: 0.5rem;
            color: var(--text-primary);
        }

        /* ローディング状態 */
        .loading-placeholder {
            grid-column: 1/-1;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 200px;
        }

        .loading-spinner {
            text-align: center;
            color: var(--text-secondary);
        }

        .loading-spinner i {
            font-size: 2rem;
            margin-bottom: 1rem;
            color: var(--primary-color);
        }

        .loading-spinner p {
            font-size: 1rem;
            margin: 0;
        }

        /* エラーバナー */
        .error-banner {
            background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
            border: 1px solid #f87171;
            border-radius: var(--radius-lg);
            padding: var(--space-lg);
            margin-bottom: var(--space-xl);
            box-shadow: 0 2px 8px rgba(248, 113, 113, 0.1);
        }

        .error-content {
            display: flex;
            align-items: center;
            gap: var(--space-md);
            flex-wrap: wrap;
        }

        .error-content i {
            color: #dc2626;
            font-size: 1.25rem;
            flex-shrink: 0;
        }

        .error-content span {
            flex: 1;
            color: #7f1d1d;
            font-weight: 500;
            min-width: 200px;
        }

        .error-content .btn {
            flex-shrink: 0;
        }

        /* モバイル対応 */
        @media (max-width: 768px) {
            .error-content {
                flex-direction: column;
                text-align: center;
            }

            .error-content span {
                min-width: auto;
            }
        }
    `;
    document.head.appendChild(style);

    // Supabaseの準備ができるまで待つ
    function initializeWhenReady() {
        if (window.supabaseClient) {
            window.membersSupabase = new MembersSupabaseManager();
            window.membersSupabase.init();
        } else {
            setTimeout(initializeWhenReady, 100);
        }
    }

    // supabaseReadyイベントを待つ
    if (window.supabaseClient) {
        initializeWhenReady();
    } else {
        window.addEventListener('supabaseReady', () => {
            initializeWhenReady();
        });
        // フォールバックとして500ms後に再チェック
        setTimeout(initializeWhenReady, 500);
    }

    // ページ離脱時のクリーンアップ
    window.addEventListener('beforeunload', () => {
        if (window.membersSupabase) {
            window.membersSupabase.cleanup();
        }
    });

})();

// ============================================================
// Section: members-search.js
// ============================================================

/**
 * Members Search & Filter
 * メンバー検索・フィルター機能
 */

(function() {
    'use strict';


    class MembersSearchManager {
        constructor() {
            this.searchInput = null;
            this.industrySelect = null;
            this.roleSelect = null;
            this.searchTimeout = null;
            this.init();
        }

        init() {
            this.setupElements();
            this.setupEventListeners();
            this.loadSavedFilters();
        }

        /**
         * DOM要素を設定
         */
        setupElements() {
            this.searchInput = document.querySelector('.search-input');
            this.industrySelect = document.querySelector('.filter-select[name="industry"]') || 
                                  document.querySelector('.filter-select:nth-of-type(1)');
            this.roleSelect = document.querySelector('.filter-select[name="role"]') || 
                              document.querySelector('.filter-select:nth-of-type(2)');

            // name属性を追加
            if (this.industrySelect && !this.industrySelect.name) {
                this.industrySelect.name = 'industry';
            }
            if (this.roleSelect && !this.roleSelect.name) {
                this.roleSelect.name = 'role';
            }
        }

        /**
         * イベントリスナーを設定
         */
        setupEventListeners() {
            // 検索入力
            if (this.searchInput) {
                this.searchInput.addEventListener('input', (e) => {
                    this.handleSearchInput(e.target.value);
                });

                // Enterキーでの検索
                this.searchInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        this.performSearch();
                    }
                });
            }

            // 業界フィルター
            if (this.industrySelect) {
                this.industrySelect.addEventListener('change', (e) => {
                    this.handleFilterChange('industry', e.target.value);
                });
            }

            // 役職フィルター
            if (this.roleSelect) {
                this.roleSelect.addEventListener('change', (e) => {
                    this.handleFilterChange('role', e.target.value);
                });
            }

            // 検索クリアボタンを追加
            this.addSearchClearButton();
        }

        /**
         * 検索入力を処理（デバウンス付き）
         */
        handleSearchInput(value) {
            // 既存のタイムアウトをクリア
            if (this.searchTimeout) {
                clearTimeout(this.searchTimeout);
            }

            // 検索文字列を更新
            if (window.membersSupabase) {
                window.membersSupabase.filters.search = value;
            }

            // 300ms後に検索実行
            this.searchTimeout = setTimeout(() => {
                this.performSearch();
            }, 300);

            // 検索フィルターを保存
            this.saveFilters();
        }

        /**
         * フィルター変更を処理
         */
        handleFilterChange(type, value) {
            if (window.membersSupabase) {
                window.membersSupabase.filters[type] = value;
                window.membersSupabase.currentPage = 1; // ページをリセット
                this.performSearch();
            }

            // フィルターを保存
            this.saveFilters();
        }

        /**
         * 検索を実行
         */
        async performSearch() {
            if (!window.membersSupabase) {
                console.error('[MembersSearch] Supabaseマネージャーが見つかりません');
                return;
            }

            // ローディング表示
            this.showLoading();

            try {
                await window.membersSupabase.loadMembers();
            } catch (error) {
                console.error('[MembersSearch] 検索エラー:', error);
                this.showError();
            } finally {
                this.hideLoading();
            }
        }

        /**
         * 検索クリアボタンを追加
         */
        addSearchClearButton() {
            if (!this.searchInput) return;

            const searchBox = this.searchInput.parentElement;
            if (!searchBox.querySelector('.search-clear')) {
                const clearButton = document.createElement('button');
                clearButton.className = 'search-clear';
                clearButton.innerHTML = '<i class="fas fa-times"></i>';
                clearButton.style.cssText = `
                    position: absolute;
                    right: 12px;
                    top: 50%;
                    transform: translateY(-50%);
                    background: none;
                    border: none;
                    color: var(--text-secondary);
                    cursor: pointer;
                    padding: 8px;
                    display: none;
                    transition: color 0.2s;
                `;
                
                clearButton.addEventListener('click', () => {
                    this.clearSearch();
                });

                searchBox.style.position = 'relative';
                searchBox.appendChild(clearButton);

                // 入力があるときのみ表示
                this.searchInput.addEventListener('input', (e) => {
                    clearButton.style.display = e.target.value ? 'block' : 'none';
                });
            }
        }

        /**
         * 検索をクリア
         */
        clearSearch() {
            if (this.searchInput) {
                this.searchInput.value = '';
                this.searchInput.dispatchEvent(new Event('input'));
            }
        }

        /**
         * フィルターをリセット
         */
        resetFilters() {
            // 検索をクリア
            this.clearSearch();

            // セレクトボックスをリセット
            if (this.industrySelect) this.industrySelect.value = '';
            if (this.roleSelect) this.roleSelect.value = '';

            // Supabaseフィルターをリセット
            if (window.membersSupabase) {
                window.membersSupabase.filters = {
                    search: '',
                    industry: '',
                    role: '',
                    skills: []
                };
                window.membersSupabase.currentPage = 1;
                this.performSearch();
            }

            // 保存されたフィルターをクリア
            localStorage.removeItem('memberFilters');
        }

        /**
         * フィルターを保存
         */
        saveFilters() {
            if (window.membersSupabase) {
                const filters = {
                    search: window.membersSupabase.filters.search,
                    industry: window.membersSupabase.filters.industry,
                    role: window.membersSupabase.filters.role
                };
                localStorage.setItem('memberFilters', JSON.stringify(filters));
            }
        }

        /**
         * 保存されたフィルターを読み込む
         */
        loadSavedFilters() {
            try {
                const saved = localStorage.getItem('memberFilters');
                if (saved) {
                    const filters = JSON.parse(saved);
                    
                    // UIに反映
                    if (this.searchInput && filters.search) {
                        this.searchInput.value = filters.search;
                    }
                    if (this.industrySelect && filters.industry) {
                        this.industrySelect.value = filters.industry;
                    }
                    if (this.roleSelect && filters.role) {
                        this.roleSelect.value = filters.role;
                    }

                    // Supabaseフィルターに反映
                    if (window.membersSupabase) {
                        Object.assign(window.membersSupabase.filters, filters);
                    }
                }
            } catch (error) {
                console.error('[MembersSearch] フィルター読み込みエラー:', error);
            }
        }

        /**
         * ローディング表示
         */
        showLoading() {
            const grid = document.querySelector('.members-grid');
            if (grid) {
                grid.style.opacity = '0.6';
                grid.style.pointerEvents = 'none';
            }
        }

        /**
         * ローディング非表示
         */
        hideLoading() {
            const grid = document.querySelector('.members-grid');
            if (grid) {
                grid.style.opacity = '1';
                grid.style.pointerEvents = '';
            }
        }

        /**
         * エラー表示
         */
        showError() {
            const grid = document.querySelector('.members-grid');
            if (grid) {
                grid.innerHTML = `
                    <div class="search-error" style="grid-column: 1/-1; text-align: center; padding: 3rem;">
                        <i class="fas fa-exclamation-circle" style="font-size: 3rem; color: var(--danger-color); margin-bottom: 1rem;"></i>
                        <h3>検索エラー</h3>
                        <p>検索中にエラーが発生しました。もう一度お試しください。</p>
                        <button class="btn btn-primary" onclick="window.membersSearch.performSearch()">
                            再試行
                        </button>
                    </div>
                `;
            }
        }

        /**
         * 高度な検索機能を追加（将来の拡張用）
         */
        setupAdvancedSearch() {
            // スキルタグ検索
            // 地域フィルター
            // 並び替え機能
            // 詳細検索モーダル
        }
    }

    // リセットボタンのスタイルを追加
    const style = document.createElement('style');
    style.textContent = `
        .search-clear:hover {
            color: var(--primary-color) !important;
        }

        .filter-reset {
            padding: 14px 24px;
            background: var(--danger-color);
            color: white;
            border: none;
            border-radius: 16px;
            font-size: 1rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.3s ease;
        }

        .filter-reset:hover {
            background: var(--danger-hover);
            transform: translateY(-2px);
            box-shadow: 0 8px 20px rgba(239, 68, 68, 0.3);
        }

        .members-grid {
            transition: opacity 0.3s ease;
        }

        /* 検索ハイライト */
        .search-highlight {
            background-color: #fef3c7;
            padding: 2px 4px;
            border-radius: 3px;
            font-weight: 500;
        }
    `;
    document.head.appendChild(style);

    // フィルターリセットボタンを追加
    const addResetButton = () => {
        const filterControls = document.querySelector('.filter-controls');
        if (filterControls && !filterControls.querySelector('.filter-reset')) {
            const resetButton = document.createElement('button');
            resetButton.className = 'filter-reset';
            resetButton.innerHTML = '<i class="fas fa-undo"></i> リセット';
            resetButton.onclick = () => window.membersSearch.resetFilters();
            filterControls.appendChild(resetButton);
        }
    };

    // DOMContentLoadedで実行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addResetButton);
    } else {
        addResetButton();
    }

    // グローバルインスタンス
    window.membersSearch = new MembersSearchManager();

})();

// ============================================================
// Section: members-connection.js
// ============================================================

/**
 * Members Connection Management
 * メンバーコネクション管理
 */

(function() {
    'use strict';


    class MembersConnectionManager {
        constructor() {
            this.currentUserId = null;
            this.connections = new Map();
            this.pendingRequests = new Set();
            this.init();
        }

        async init() {
            try {
                // 認証状態を確認
                if (window.supabaseClient) {
                    const user = await window.safeGetUser();
                    if (user) {
                        this.currentUserId = user.id;
                        await this.loadConnections();
                        this.setupEventListeners();
                        this.setupRealtimeSubscription();
                    }
                }
            } catch (error) {
                console.error('[MembersConnection] 初期化エラー:', error);
            }
        }

        /**
         * 既存のコネクションを読み込む
         */
        async loadConnections() {
            if (!window.supabaseClient) return;

            try {
                // 承認済みコネクション
                const { data: accepted } = await window.supabaseClient
                    .from('connections')
                    .select('*')
                    .or(`user_id.eq.${this.currentUserId},connected_user_id.eq.${this.currentUserId}`)
                    .eq('status', 'accepted');

                // ペンディングリクエスト
                const { data: pending } = await window.supabaseClient
                    .from('connections')
                    .select('*')
                    .or(`user_id.eq.${this.currentUserId},connected_user_id.eq.${this.currentUserId}`)
                    .eq('status', 'pending');

                // コネクション情報を整理
                accepted?.forEach(conn => {
                    const connectedId = conn.user_id === this.currentUserId ? 
                        conn.connected_user_id : conn.user_id;
                    this.connections.set(connectedId, 'connected');
                });

                pending?.forEach(conn => {
                    const connectedId = conn.user_id === this.currentUserId ? 
                        conn.connected_user_id : conn.user_id;
                    const status = conn.user_id === this.currentUserId ? 
                        'pending_sent' : 'pending_received';
                    this.connections.set(connectedId, status);
                    
                    if (status === 'pending_sent') {
                        this.pendingRequests.add(connectedId);
                    }
                });

                // UIを更新
                this.updateAllConnectionButtons();

            } catch (error) {
                console.error('[MembersConnection] コネクション読み込みエラー:', error);
            }
        }

        /**
         * イベントリスナーを設定
         */
        setupEventListeners() {
            // コネクトボタンのクリックイベント
            document.addEventListener('click', async (e) => {
                const connectBtn = e.target.closest('.connect-btn');
                if (connectBtn) {
                    e.preventDefault();
                    const memberId = connectBtn.dataset.memberId;
                    const memberName = connectBtn.dataset.memberName;
                    await this.handleConnectClick(memberId, memberName, connectBtn);
                }
            });
        }

        /**
         * コネクトボタンクリックを処理
         */
        async handleConnectClick(memberId, memberName, button) {
            if (!this.currentUserId || !window.supabaseClient) {
                this.showLoginPrompt();
                return;
            }
            if (sessionStorage.getItem('isGuestMode') === 'true') {
                if (window.showToast) window.showToast('この機能はゲストモードでは利用できません。', 'warning');
                return;
            }

            // 既にコネクト済みまたはペンディングの場合
            const status = this.connections.get(memberId);
            if (status === 'connected') {
                this.showMessage('既にコネクトしています', 'info');
                return;
            }
            if (status === 'pending_sent') {
                this.showMessage('既に申請を送信済みです', 'info');
                return;
            }
            if (status === 'pending_received') {
                // 受信した申請を承認
                await this.acceptConnection(memberId, memberName);
                return;
            }

            // 新規コネクト申請
            await this.sendConnectionRequest(memberId, memberName, button);
        }

        /**
         * コネクト申請を送信
         */
        async sendConnectionRequest(memberId, memberName, button) {
            try {
                // ボタンを無効化
                button.disabled = true;
                button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 送信中...';

                // 重複チェック
                const { data: existing } = await window.supabaseClient
                    .from('connections')
                    .select('id, status')
                    .or(`and(user_id.eq.${this.currentUserId},connected_user_id.eq.${memberId}),and(user_id.eq.${memberId},connected_user_id.eq.${this.currentUserId})`)
                    .maybeSingle();

                if (existing) {
                    throw new Error('既にコネクション申請済みです');
                }

                // コネクションレコードを作成
                const { data, error } = await window.supabaseClient
                    .from('connections')
                    .insert({
                        user_id: this.currentUserId,
                        connected_user_id: memberId,
                        status: 'pending',
                        created_at: new Date().toISOString()
                    })
                    .select()
                    .maybeSingle();

                if (error) {
                    // Supabaseエラーの詳細を解析
                    if (error.code === '23505') { // 重複エラー
                        throw new Error('既にコネクション申請済みです');
                    } else if (error.code === '23503') { // 外部キー制約エラー
                        throw new Error('ユーザーが見つかりません');
                    }
                    throw error;
                }

                // 通知を作成
                await this.createNotification(memberId, memberName, 'connection_request');

                // 状態を更新
                this.connections.set(memberId, 'pending_sent');
                this.pendingRequests.add(memberId);

                // UIを更新
                this.updateConnectionButton(memberId, 'pending_sent');
                this.showMessage(`${memberName}さんにコネクト申請を送信しました`, 'success');

            } catch (error) {
                console.error('[MembersConnection] 申請送信エラー:', error);
                this.showMessage('申請の送信に失敗しました', 'error');
                
                // ボタンを元に戻す
                button.disabled = false;
                button.innerHTML = '<i class="fas fa-plus"></i> <span class="btn-text">コネクト</span>';
            }
        }

        /**
         * コネクション申請を承認
         */
        async acceptConnection(memberId, memberName) {
            try {
                // コネクションステータスを更新
                const { error } = await window.supabaseClient
                    .from('connections')
                    .update({ status: 'accepted', responded_at: new Date().toISOString() })
                    .or(`user_id.eq.${memberId},connected_user_id.eq.${memberId}`)
                    .or(`user_id.eq.${this.currentUserId},connected_user_id.eq.${this.currentUserId}`);

                if (error) throw error;

                // 通知を作成
                await this.createNotification(memberId, memberName, 'connection_accepted');

                // 状態を更新
                this.connections.set(memberId, 'connected');
                this.updateConnectionButton(memberId, 'connected');
                
                this.showMessage(`${memberName}さんとコネクトしました`, 'success');

            } catch (error) {
                console.error('[MembersConnection] 承認エラー:', error);
                this.showMessage('承認に失敗しました', 'error');
            }
        }

        /**
         * 通知を作成
         */
        async createNotification(recipientId, memberName, type) {
            if (!window.supabaseClient) return;

            try {
                const messages = {
                    connection_request: `${memberName}さんからコネクト申請が届きました`,
                    connection_accepted: `${memberName}さんがコネクト申請を承認しました`
                };

                await window.supabaseClient
                    .from('notifications')
                    .insert({
                        user_id: recipientId,
                        type: type,
                        title: type === 'connection_request' ? 'コネクト申請' : 'コネクト承認',
                        message: messages[type],
                        data: { related_id: this.currentUserId },
                        is_read: false
                    });

            } catch (error) {
                console.error('[MembersConnection] 通知作成エラー:', error);
            }
        }

        /**
         * コネクションボタンを更新
         */
        updateConnectionButton(memberId, status) {
            const button = document.querySelector(`.connect-btn[data-member-id="${memberId}"]`);
            if (!button) return;

            switch (status) {
                case 'connected':
                    button.disabled = true;
                    button.className = 'btn btn-success btn-small';
                    button.innerHTML = '<i class="fas fa-check"></i> <span class="btn-text">コネクト済み</span>';
                    break;
                    
                case 'pending_sent':
                    button.disabled = true;
                    button.className = 'btn btn-secondary btn-small';
                    button.innerHTML = '<i class="fas fa-clock"></i> <span class="btn-text">申請中</span>';
                    break;
                    
                case 'pending_received':
                    button.disabled = false;
                    button.className = 'btn btn-primary btn-small';
                    button.innerHTML = '<i class="fas fa-user-plus"></i> <span class="btn-text">承認する</span>';
                    break;
                    
                default:
                    button.disabled = false;
                    button.className = 'btn btn-outline btn-small connect-btn';
                    button.innerHTML = '<i class="fas fa-plus"></i> <span class="btn-text">コネクト</span>';
            }
        }

        /**
         * 全てのコネクションボタンを更新
         */
        updateAllConnectionButtons() {
            this.connections.forEach((status, memberId) => {
                this.updateConnectionButton(memberId, status);
            });
        }

        /**
         * リアルタイム購読を設定
         */
        setupRealtimeSubscription() {
            if (!window.supabaseClient) return;

            // コネクションの変更を監視
            this.connectionsSubscription = window.supabaseClient
                .channel('connections_changes')
                .on('postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'connections',
                        filter: `user_id=eq.${this.currentUserId}`
                    },
                    (payload) => this.handleConnectionChange(payload)
                )
                .on('postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'connections',
                        filter: `connected_user_id=eq.${this.currentUserId}`
                    },
                    (payload) => this.handleConnectionChange(payload)
                )
                .subscribe();
        }

        /**
         * コネクション変更を処理
         */
        handleConnectionChange(payload) {
            
            // コネクション情報を再読み込み
            this.loadConnections();
        }

        /**
         * メッセージを表示
         */
        showMessage(message, type = 'info') {
            // トーストメッセージを作成
            const toast = document.createElement('div');
            toast.className = `toast toast-${type}`;
            toast.innerHTML = `
                <i class="fas fa-${type === 'success' ? 'check-circle' : 
                                  type === 'error' ? 'exclamation-circle' : 
                                  'info-circle'}"></i>
                ${message}
            `;
            
            document.body.appendChild(toast);
            
            // アニメーション
            setTimeout(() => toast.classList.add('show'), 10);
            setTimeout(() => {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }

        /**
         * ログインプロンプトを表示
         */
        showLoginPrompt() {
            this.showMessage('コネクトするにはログインが必要です', 'info');
            setTimeout(() => {
                window.location.href = 'login.html';
            }, 1500);
        }

        /**
         * クリーンアップ
         */
        cleanup() {
            if (this.connectionsSubscription) {
                window.supabaseClient.removeChannel(this.connectionsSubscription);
            }
        }
    }

    // スタイルを追加
    const style = document.createElement('style');
    style.textContent = `
        /* トーストメッセージ */
        .toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: white;
            padding: 16px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            display: flex;
            align-items: center;
            gap: 12px;
            opacity: 0;
            transform: translateY(20px);
            transition: all 0.3s ease;
            z-index: 10000;
            max-width: 350px;
        }

        .toast.show {
            opacity: 1;
            transform: translateY(0);
        }

        .toast i {
            font-size: 1.25rem;
        }

        .toast-success {
            border-left: 4px solid var(--success-color);
        }

        .toast-success i {
            color: var(--success-color);
        }

        .toast-error {
            border-left: 4px solid var(--danger-color);
        }

        .toast-error i {
            color: var(--danger-color);
        }

        .toast-info {
            border-left: 4px solid var(--primary-color);
        }

        .toast-info i {
            color: var(--primary-color);
        }

        /* ボタンスタイル */
        .btn-success {
            background: var(--success-color) !important;
            border-color: var(--success-color) !important;
            color: white !important;
            cursor: default !important;
        }

        .btn-secondary {
            background: var(--text-secondary) !important;
            border-color: var(--text-secondary) !important;
            color: white !important;
            cursor: default !important;
        }

        /* モバイル対応 */
        @media (max-width: 768px) {
            .toast {
                right: 10px;
                left: 10px;
                max-width: none;
            }
        }
    `;
    document.head.appendChild(style);

    // グローバルインスタンス
    window.membersConnection = new MembersConnectionManager();

    // window.sendConnectRequest をグローバルに公開（他ファイルから呼ばれる）
    window.sendConnectRequest = async function(userId) {
        if (window.membersConnection && window.membersConnection.currentUserId) {
            const btn = document.querySelector(`[data-member-id="${userId}"] .btn-primary`) || document.createElement('button');
            await window.membersConnection.sendConnectionRequest(userId, '', btn);
        }
    };

    // ページ離脱時のクリーンアップ
    window.addEventListener('beforeunload', () => {
        if (window.membersConnection) {
            window.membersConnection.cleanup();
        }
    });

})();

// ============================================================
// Section: members-view-mode.js
// ============================================================

/**
 * Members View Mode
 * メンバー表示モード切り替え
 */

(function() {
    'use strict';


    class MembersViewModeManager {
        constructor() {
            this.currentView = 'grid'; // grid or list
            this.viewButtons = null;
            this.membersContainer = null;
            this.init();
        }

        init() {
            this.setupElements();
            this.loadSavedView();
            this.setupEventListeners();
            this.applyCurrentView();
        }

        /**
         * DOM要素を設定
         */
        setupElements() {
            this.viewButtons = document.querySelectorAll('.view-mode button');
            this.membersContainer = document.querySelector('.members-grid');
        }

        /**
         * 保存されたビューを読み込む
         */
        loadSavedView() {
            const savedView = localStorage.getItem('membersViewMode');
            if (savedView && ['grid', 'list'].includes(savedView)) {
                this.currentView = savedView;
            }
        }

        /**
         * イベントリスナーを設定
         */
        setupEventListeners() {
            this.viewButtons.forEach((button, index) => {
                button.addEventListener('click', () => {
                    const newView = index === 0 ? 'grid' : 'list';
                    this.switchView(newView);
                });
            });
        }

        /**
         * ビューを切り替える
         */
        switchView(view) {
            if (view === this.currentView) return;

            this.currentView = view;
            localStorage.setItem('membersViewMode', view);
            
            // ボタンのアクティブ状態を更新
            this.updateButtonStates();
            
            // ビューを適用
            this.applyCurrentView();
            
            // アニメーション
            this.animateTransition();
        }

        /**
         * ボタンのアクティブ状態を更新
         */
        updateButtonStates() {
            this.viewButtons.forEach((button, index) => {
                if ((index === 0 && this.currentView === 'grid') || 
                    (index === 1 && this.currentView === 'list')) {
                    button.classList.add('active');
                } else {
                    button.classList.remove('active');
                }
            });
        }

        /**
         * 現在のビューを適用
         */
        applyCurrentView() {
            if (!this.membersContainer) return;

            if (this.currentView === 'list') {
                this.membersContainer.classList.remove('members-grid');
                this.membersContainer.classList.add('members-list');
                this.updateMemberCardsForList();
            } else {
                this.membersContainer.classList.remove('members-list');
                this.membersContainer.classList.add('members-grid');
                this.updateMemberCardsForGrid();
            }
        }

        /**
         * リスト表示用にカードを更新
         */
        updateMemberCardsForList() {
            const cards = this.membersContainer.querySelectorAll('.member-card');
            cards.forEach(card => {
                card.classList.add('list-view');
                
                // レイアウトを調整
                const header = card.querySelector('.member-header');
                const tags = card.querySelector('.member-tags');
                const stats = card.querySelector('.member-stats');
                const actions = card.querySelector('.member-actions');
                
                if (header) header.classList.add('list-header');
                if (tags) tags.classList.add('list-tags');
                if (stats) stats.classList.add('list-stats');
                if (actions) actions.classList.add('list-actions');
            });
        }

        /**
         * グリッド表示用にカードを更新
         */
        updateMemberCardsForGrid() {
            const cards = this.membersContainer.querySelectorAll('.member-card');
            cards.forEach(card => {
                card.classList.remove('list-view');
                
                // レイアウトクラスを削除
                const header = card.querySelector('.member-header');
                const tags = card.querySelector('.member-tags');
                const stats = card.querySelector('.member-stats');
                const actions = card.querySelector('.member-actions');
                
                if (header) header.classList.remove('list-header');
                if (tags) tags.classList.remove('list-tags');
                if (stats) stats.classList.remove('list-stats');
                if (actions) actions.classList.remove('list-actions');
            });
        }

        /**
         * トランジションアニメーション
         */
        animateTransition() {
            if (!this.membersContainer) return;

            this.membersContainer.style.opacity = '0';
            this.membersContainer.style.transform = 'scale(0.95)';
            
            setTimeout(() => {
                this.membersContainer.style.opacity = '1';
                this.membersContainer.style.transform = 'scale(1)';
            }, 150);
        }

        /**
         * 外部から呼び出し可能なビュー切り替え
         */
        setView(view) {
            if (['grid', 'list'].includes(view)) {
                this.switchView(view);
            }
        }
    }

    // リスト表示用のスタイルを追加
    const style = document.createElement('style');
    style.textContent = `
        /* リスト表示コンテナ */
        .members-list {
            display: flex;
            flex-direction: column;
            gap: var(--space-md);
            transition: all 0.3s ease;
        }

        /* リスト表示のメンバーカード */
        .member-card.list-view {
            display: flex;
            align-items: center;
            padding: var(--space-lg);
            gap: var(--space-lg);
            max-width: 100%;
        }

        .member-card.list-view:hover {
            transform: translateY(-2px);
        }

        /* リスト表示のヘッダー */
        .member-card.list-view .list-header {
            flex: 0 0 auto;
            margin-bottom: 0;
        }

        .member-card.list-view .member-avatar {
            width: 60px;
            height: 60px;
        }

        .member-card.list-view .member-info {
            min-width: 250px;
        }

        /* リスト表示のタグ */
        .member-card.list-view .list-tags {
            flex: 1;
            margin-bottom: 0;
            justify-content: flex-start;
        }

        /* リスト表示の統計 */
        .member-card.list-view .list-stats {
            flex: 0 0 auto;
            border: none;
            padding: 0;
            margin-bottom: 0;
            min-width: 150px;
        }

        /* リスト表示のアクション */
        .member-card.list-view .list-actions {
            flex: 0 0 auto;
            margin-top: 0;
            margin-left: auto;
        }

        /* モバイル対応 */
        @media (max-width: 1024px) {
            .member-card.list-view {
                flex-wrap: wrap;
            }

            .member-card.list-view .list-header {
                width: 100%;
            }

            .member-card.list-view .list-tags {
                width: 100%;
                order: 3;
            }

            .member-card.list-view .list-stats {
                order: 4;
            }

            .member-card.list-view .list-actions {
                width: 100%;
                order: 5;
                margin-top: var(--space-md);
            }
        }

        @media (max-width: 768px) {
            .member-card.list-view {
                padding: var(--space-md);
            }

            .member-card.list-view .member-avatar {
                width: 50px;
                height: 50px;
            }

            .member-card.list-view .member-info h3 {
                font-size: 1.125rem;
            }

            .member-card.list-view .list-actions {
                flex-direction: column;
                gap: var(--space-sm);
            }

            .member-card.list-view .list-actions .btn {
                width: 100%;
            }
        }

        /* アニメーション */
        .members-grid,
        .members-list {
            transition: opacity 0.3s ease, transform 0.3s ease;
        }

        /* ボタンアクティブ状態の強調 */
        .view-mode button.active {
            background: var(--primary-color);
            color: white;
            border-color: var(--primary-color);
            box-shadow: 0 2px 8px rgba(0, 102, 255, 0.3);
        }
    `;
    document.head.appendChild(style);

    // グローバルインスタンス
    window.membersViewMode = new MembersViewModeManager();

    // Supabaseマネージャーが更新された時に再適用
    if (window.membersSupabase) {
        const originalUpdateUI = window.membersSupabase.updateMembersUI;
        window.membersSupabase.updateMembersUI = function() {
            originalUpdateUI.call(this);
            if (window.membersViewMode) {
                window.membersViewMode.applyCurrentView();
            }
        };
    }

})();

// ============================================================
// Section: member-profile-preview.js
// ============================================================

/**
 * Member Profile Preview
 * メンバープロフィールのホバープレビュー機能
 */

(function() {
    'use strict';

    class MemberProfilePreview {
        constructor() {
            this.previewElement = null;
            this.currentTarget = null;
            this.hideTimeout = null;
            this.showTimeout = null;
            this.isPreviewHovered = false;
            this.cache = new Map();
            this.cacheExpiry = 5 * 60 * 1000; // 5分
            
            this.init();
        }

        init() {
            this.createPreviewElement();
            this.setupEventListeners();
        }

        /**
         * プレビュー要素を作成
         */
        createPreviewElement() {
            this.previewElement = document.createElement('div');
            this.previewElement.className = 'profile-preview';
            this.previewElement.innerHTML = `
                <div class="profile-preview-content">
                    <div class="profile-preview-loading">
                        <i class="fas fa-spinner fa-spin"></i>
                    </div>
                </div>
            `;
            document.body.appendChild(this.previewElement);
        }

        /**
         * イベントリスナーを設定
         */
        setupEventListeners() {
            // メンバーカードのホバーイベントを監視
            document.addEventListener('mouseenter', (e) => {
                // e.targetがElementであることを確認
                if (!e.target || !e.target.nodeType || e.target.nodeType !== 1) return;
                
                const memberCard = e.target.closest('.member-card');
                if (memberCard && !memberCard.closest('.profile-preview')) {
                    this.handleMouseEnter(memberCard);
                }
            }, true);

            document.addEventListener('mouseleave', (e) => {
                // e.targetがElementであることを確認
                if (!e.target || !e.target.nodeType || e.target.nodeType !== 1) return;
                
                const memberCard = e.target.closest('.member-card');
                if (memberCard && memberCard === this.currentTarget) {
                    this.handleMouseLeave();
                }
            }, true);

            // プレビュー自体のホバーイベント
            this.previewElement.addEventListener('mouseenter', () => {
                this.isPreviewHovered = true;
                this.cancelHide();
            });

            this.previewElement.addEventListener('mouseleave', () => {
                this.isPreviewHovered = false;
                this.scheduleHide();
            });

            // スクロール時は非表示
            window.addEventListener('scroll', () => {
                this.hidePreview();
            }, { passive: true });

            // クリックで非表示
            document.addEventListener('click', (e) => {
                // e.targetがElementであることを確認
                if (!e.target || !e.target.nodeType || e.target.nodeType !== 1) return;
                
                // closestメソッドが使用可能か確認
                if (typeof e.target.closest === 'function') {
                    if (!e.target.closest('.member-card') && !e.target.closest('.profile-preview')) {
                        this.hidePreview();
                    }
                }
            });
            
            // プレビュー内のボタンクリックイベント
            this.previewElement.addEventListener('click', (e) => {
                // e.targetがElementであることを確認
                if (!e.target || !e.target.nodeType || e.target.nodeType !== 1) return;
                
                // closestメソッドが使用可能か確認
                if (typeof e.target.closest !== 'function') return;
                
                if (e.target.closest('.preview-profile-btn')) {
                    e.preventDefault();
                    e.stopPropagation();
                    const btn = e.target.closest('.preview-profile-btn');
                    const userId = btn.dataset.userId;
                    
                    // モーダル表示を試行
                    if (window.membersProfileModal && window.membersProfileModal.show) {
                        window.membersProfileModal.show(userId);
                        this.hidePreview(); // プレビューを閉じる
                    } else if (window.showMemberProfileModal) {
                        window.showMemberProfileModal(userId);
                        this.hidePreview();
                    } else {
                        // フォールバック：モーダルが利用できない場合のみプロフィールページへ
                        console.warn('[ProfilePreview] Modal not available, redirecting to profile page');
                        window.location.href = `profile.html?user=${userId}`;
                    }
                } else if (e.target.closest('.preview-message-btn')) {
                    e.preventDefault();
                    e.stopPropagation();
                    const btn = e.target.closest('.preview-message-btn');
                    const userId = btn.dataset.userId;
                    window.location.href = `messages.html?user=${userId}`;
                }
            });
        }

        /**
         * マウスエンター処理
         */
        handleMouseEnter(memberCard) {
            this.currentTarget = memberCard;
            this.cancelHide();
            
            // 少し遅延してから表示（誤操作防止）
            this.showTimeout = setTimeout(() => {
                this.showPreview(memberCard);
            }, 300);
        }

        /**
         * マウスリーブ処理
         */
        handleMouseLeave() {
            clearTimeout(this.showTimeout);
            if (!this.isPreviewHovered) {
                this.scheduleHide();
            }
        }

        /**
         * プレビューを表示
         */
        async showPreview(memberCard) {
            const userId = memberCard.dataset.userId;
            if (!userId) return;

            // キャッシュチェック
            const cached = this.cache.get(userId);
            if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
                this.displayPreview(memberCard, cached.data);
                return;
            }

            // ローディング表示
            this.displayLoading(memberCard);

            try {
                // Supabaseからユーザー情報を取得
                const client = window.supabaseClient || window.supabase;
                if (!client) {
                    console.error('[ProfilePreview] No Supabase client found');
                    return;
                }
                
                const { data: userData, error } = await client
                    .from('user_profiles')
                    .select(`
                        id,
                        name,
                        full_name,
                        email,
                        company,
                        position,
                        industry,
                        bio,
                        skills,
                        avatar_url,
                        is_online,
                        last_login_at
                    `)
                    .eq('id', userId)
                    .maybeSingle();

                if (error) throw error;

                // キャッシュに保存
                this.cache.set(userId, {
                    data: userData,
                    timestamp: Date.now()
                });

                this.displayPreview(memberCard, userData);

            } catch (error) {
                console.error('[ProfilePreview] Error fetching user data:', error);
                this.displayError();
            }
        }

        /**
         * ローディング表示
         */
        displayLoading(memberCard) {
            const rect = memberCard.getBoundingClientRect();
            this.positionPreview(rect);
            
            this.previewElement.classList.add('visible');
            const content = this.previewElement.querySelector('.profile-preview-content');
            content.innerHTML = `
                <div class="profile-preview-loading">
                    <i class="fas fa-spinner fa-spin"></i>
                </div>
            `;
        }

        /**
         * プレビューコンテンツを表示
         */
        displayPreview(memberCard, userData) {
            if (this.currentTarget !== memberCard) return;

            const rect = memberCard.getBoundingClientRect();
            this.positionPreview(rect);

            const content = this.previewElement.querySelector('.profile-preview-content');
            
            // オンラインステータス
            const isOnline = this.checkOnlineStatus(userData.last_login_at);
            const onlineClass = isOnline ? 'online' : 'offline';
            const onlineText = isOnline ? 'オンライン' : 'オフライン';

            // スキルタグ
            const skillsHTML = userData.skills ? 
                userData.skills.slice(0, 3).map(skill => 
                    `<span class="skill-tag">${this.escapeHtml(skill)}</span>`
                ).join('') : '';

            content.innerHTML = `
                <div class="profile-preview-header">
                    <div class="preview-avatar">
                        <img src="${userData.avatar_url || 'assets/user-placeholder.svg'}" 
                             alt="${this.escapeHtml(userData.name || 'User')}"
                             onerror="this.src='assets/user-placeholder.svg'">
                        <span class="status-indicator ${onlineClass}"></span>
                    </div>
                    <div class="preview-info">
                        <h4>${this.escapeHtml(userData.full_name || userData.name || 'ユーザー')}</h4>
                        <p class="preview-position">${this.escapeHtml(userData.position || '役職未設定')}</p>
                        <p class="preview-company">${this.escapeHtml(userData.company || '会社未設定')}</p>
                    </div>
                </div>
                
                ${userData.bio ? `
                    <div class="profile-preview-bio">
                        <p>${this.escapeHtml(this.truncateText(userData.bio, 100))}</p>
                    </div>
                ` : ''}
                
                ${skillsHTML ? `
                    <div class="profile-preview-skills">
                        ${skillsHTML}
                        ${userData.skills.length > 3 ? `<span class="skill-more">+${userData.skills.length - 3}</span>` : ''}
                    </div>
                ` : ''}
                
                <div class="profile-preview-footer">
                    <div class="preview-stat">
                        <i class="fas fa-circle ${onlineClass}"></i>
                        <span>${onlineText}</span>
                    </div>
                    <div class="preview-stat">
                        <i class="fas fa-briefcase"></i>
                        <span>${this.escapeHtml(userData.industry || '業界未設定')}</span>
                    </div>
                </div>
                
                <div class="profile-preview-actions">
                    <button class="btn btn-sm btn-primary preview-profile-btn" data-user-id="${userData.id}">
                        <i class="fas fa-user"></i> プロフィールを見る
                    </button>
                    <button class="btn btn-sm btn-outline preview-message-btn" data-user-id="${userData.id}">
                        <i class="fas fa-envelope"></i> メッセージ
                    </button>
                </div>
            `;

            this.previewElement.classList.add('visible');
        }

        /**
         * エラー表示
         */
        displayError() {
            const content = this.previewElement.querySelector('.profile-preview-content');
            content.innerHTML = `
                <div class="profile-preview-error">
                    <i class="fas fa-exclamation-circle"></i>
                    <p>プロフィールを読み込めませんでした</p>
                </div>
            `;
        }

        /**
         * プレビューの位置を調整
         */
        positionPreview(targetRect) {
            const previewRect = this.previewElement.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const margin = 10;

            let left = targetRect.right + margin;
            let top = targetRect.top;

            // 右側に表示スペースがない場合は左側に表示
            if (left + previewRect.width > viewportWidth - margin) {
                left = targetRect.left - previewRect.width - margin;
            }

            // 左側にも表示スペースがない場合は下に表示
            if (left < margin) {
                left = targetRect.left;
                top = targetRect.bottom + margin;
            }

            // 下に表示する場合、画面外にはみ出さないよう調整
            if (top + previewRect.height > viewportHeight - margin) {
                top = viewportHeight - previewRect.height - margin;
            }

            // 最小値の保証
            left = Math.max(margin, left);
            top = Math.max(margin, top);

            this.previewElement.style.left = `${left}px`;
            this.previewElement.style.top = `${top}px`;
        }

        /**
         * プレビューを非表示にするスケジュール
         */
        scheduleHide() {
            this.cancelHide();
            this.hideTimeout = setTimeout(() => {
                if (!this.isPreviewHovered) {
                    this.hidePreview();
                }
            }, 300);
        }

        /**
         * 非表示のキャンセル
         */
        cancelHide() {
            if (this.hideTimeout) {
                clearTimeout(this.hideTimeout);
                this.hideTimeout = null;
            }
        }

        /**
         * プレビューを非表示
         */
        hidePreview() {
            this.previewElement.classList.remove('visible');
            this.currentTarget = null;
            this.cancelHide();
            clearTimeout(this.showTimeout);
        }

        /**
         * オンラインステータスをチェック
         */
        checkOnlineStatus(lastLoginAt) {
            if (!lastLoginAt) return false;
            const lastLogin = new Date(lastLoginAt);
            const now = new Date();
            const diffMinutes = (now - lastLogin) / (1000 * 60);
            return diffMinutes < 5; // 5分以内ならオンライン
        }

        /**
         * テキストを切り詰める
         */
        truncateText(text, maxLength) {
            if (!text || text.length <= maxLength) return text;
            return text.substring(0, maxLength) + '...';
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
    window.MemberProfilePreview = MemberProfilePreview;
    
    // DOMContentLoaded時に初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            new MemberProfilePreview();
        });
    } else {
        new MemberProfilePreview();
    }

})();

// ============================================================
// Section: advanced-search.js
// ============================================================

/**
 * 高度な検索機能
 * 
 * 機能:
 * - 複数条件での絞り込み検索
 * - リアルタイム検索結果更新
 * - 検索履歴の保存
 * - 検索条件の保存・読み込み
 */

(function() {
    'use strict';


    // グローバル変数
    let currentUserId = null;
    let searchFilters = {
        keyword: '',
        industry: [],
        skills: [],
        interests: [],
        businessChallenges: [],
        location: '',
        hasProfileImage: false,
        lastLoginDays: 0,
        sortBy: 'relevance',
        page: 1,
        limit: 20
    };

    // 検索可能なオプション
    const searchOptions = {
        industries: [
            'IT・テクノロジー', '金融', '製造業', '小売・流通', '医療・ヘルスケア',
            '不動産・建設', '教育', 'メディア・広告', 'コンサルティング', 'その他'
        ],
        skills: [
            'AI・機械学習', 'ブロックチェーン', 'IoT', 'クラウド', 'ビッグデータ',
            'セキュリティ', 'モバイル開発', 'Web開発', 'データ分析', 'UI/UX',
            'プロジェクト管理', 'マーケティング', '営業', '財務・会計', '人事'
        ],
        interests: [
            '新規事業開発', 'DX推進', 'グローバル展開', 'M&A', 'IPO',
            'SDGs', 'ESG投資', 'スタートアップ', 'イノベーション', '地方創生'
        ],
        businessChallenges: [
            '新規顧客獲得', '既存顧客単価', 'Web集客・SNS活用', '営業力強化', '新規事業開発',
            '人材採用', '人材育成', '離職防止', 'マネジメント育成', '評価制度',
            'DX推進', '業務プロセス改善', 'システム統合', 'データ活用', 'AI・自動化',
            'ブランディング', '資金調達', '事業承継', '海外展開', 'パートナーシップ', '法務・コンプライアンス'
        ],
        locations: [
            '東京', '大阪', '名古屋', '福岡', '札幌', '仙台', '広島', '京都', 'その他'
        ]
    };

    // 初期化
    async function initialize() {

        // Supabaseの準備を待つ
        await window.waitForSupabase();

        // 現在のユーザーを取得
        const user = await window.safeGetUser();
        if (!user) {
            console.error('[AdvancedSearch] ユーザーが認証されていません');
            return;
        }

        currentUserId = user.id;

        // 検索UIを構築
        buildSearchUI();

        // イベントリスナーの設定
        setupEventListeners();

        // 保存された検索条件を読み込み
        loadSavedFilters();
    }

    // 検索UIの構築
    function buildSearchUI() {
        const searchContainer = document.querySelector('.advanced-search-container');
        if (!searchContainer) {
            return;
        }

        searchContainer.innerHTML = `
            <div class="search-header">
                <h2>高度な検索</h2>
                <button class="btn btn-outline btn-sm" onclick="window.AdvancedSearch.toggleFilters()">
                    <i class="fas fa-sliders-h"></i> フィルター
                </button>
            </div>

            <div class="search-bar">
                <input type="text" id="search-keyword" placeholder="名前、会社名、スキルなどで検索..." 
                       class="form-input" value="${searchFilters.keyword}">
                <button class="btn btn-primary" onclick="window.AdvancedSearch.search()">
                    <i class="fas fa-search"></i> 検索
                </button>
            </div>

            <div class="search-filters" id="search-filters" style="display: none;">
                <div class="filter-section">
                    <h3>業界</h3>
                    <div class="filter-tags">
                        ${searchOptions.industries.map(industry => `
                            <label class="filter-tag">
                                <input type="checkbox" name="industry" value="${industry}">
                                <span>${industry}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>

                <div class="filter-section">
                    <h3>スキル・専門分野</h3>
                    <div class="filter-tags">
                        ${searchOptions.skills.map(skill => `
                            <label class="filter-tag">
                                <input type="checkbox" name="skills" value="${skill}">
                                <span>${skill}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>

                <div class="filter-section">
                    <h3>興味・関心</h3>
                    <div class="filter-tags">
                        ${searchOptions.interests.map(interest => `
                            <label class="filter-tag">
                                <input type="checkbox" name="interests" value="${interest}">
                                <span>${interest}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>

                <div class="filter-section">
                    <h3>ビジネス課題</h3>
                    <div class="filter-tags">
                        ${searchOptions.businessChallenges.map(challenge => `
                            <label class="filter-tag">
                                <input type="checkbox" name="businessChallenges" value="${challenge}">
                                <span>${challenge}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>

                <div class="filter-section">
                    <h3>地域</h3>
                    <select id="location-filter" class="form-select">
                        <option value="">すべての地域</option>
                        ${searchOptions.locations.map(location => `
                            <option value="${location}">${location}</option>
                        `).join('')}
                    </select>
                </div>

                <div class="filter-section">
                    <h3>その他の条件</h3>
                    <label class="filter-option">
                        <input type="checkbox" id="has-profile-image">
                        <span>プロフィール画像あり</span>
                    </label>
                    <label class="filter-option">
                        <span>最終ログイン：</span>
                        <select id="last-login-days" class="form-select inline">
                            <option value="0">すべて</option>
                            <option value="1">1日以内</option>
                            <option value="7">1週間以内</option>
                            <option value="30">1ヶ月以内</option>
                            <option value="90">3ヶ月以内</option>
                        </select>
                    </label>
                </div>

                <div class="filter-actions">
                    <button class="btn btn-outline" onclick="window.AdvancedSearch.resetFilters()">
                        <i class="fas fa-redo"></i> リセット
                    </button>
                    <button class="btn btn-primary" onclick="window.AdvancedSearch.applyFilters()">
                        <i class="fas fa-check"></i> 適用
                    </button>
                </div>
            </div>

            <div class="search-results" id="search-results">
                <!-- 検索結果がここに表示されます -->
            </div>
        `;
    }

    // イベントリスナーの設定
    function setupEventListeners() {
        // キーワード検索のリアルタイム更新
        const keywordInput = document.getElementById('search-keyword');
        if (keywordInput) {
            let debounceTimer;
            keywordInput.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    searchFilters.keyword = e.target.value;
                    if (e.target.value.length >= 2 || e.target.value.length === 0) {
                        search();
                    }
                }, 500);
            });

            // Enterキーで検索
            keywordInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    search();
                }
            });
        }
    }

    // フィルターの表示切り替え
    function toggleFilters() {
        const filtersDiv = document.getElementById('search-filters');
        if (filtersDiv) {
            filtersDiv.style.display = filtersDiv.style.display === 'none' ? 'block' : 'none';
        }
    }

    // フィルターの適用
    function applyFilters() {
        // チェックボックスの値を収集
        searchFilters.industry = Array.from(document.querySelectorAll('input[name="industry"]:checked'))
            .map(cb => cb.value);
        searchFilters.skills = Array.from(document.querySelectorAll('input[name="skills"]:checked'))
            .map(cb => cb.value);
        searchFilters.interests = Array.from(document.querySelectorAll('input[name="interests"]:checked'))
            .map(cb => cb.value);
        searchFilters.businessChallenges = Array.from(document.querySelectorAll('input[name="businessChallenges"]:checked'))
            .map(cb => cb.value);

        // その他の条件
        searchFilters.location = document.getElementById('location-filter').value;
        searchFilters.hasProfileImage = document.getElementById('has-profile-image').checked;
        searchFilters.lastLoginDays = parseInt(document.getElementById('last-login-days').value);

        // 検索実行
        search();

        // フィルターを保存
        saveFilters();
    }

    // フィルターのリセット
    function resetFilters() {
        // すべてのチェックボックスをクリア
        document.querySelectorAll('.search-filters input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
        });

        // セレクトボックスをリセット
        document.getElementById('location-filter').value = '';
        document.getElementById('last-login-days').value = '0';

        // フィルターオブジェクトをリセット
        searchFilters = {
            ...searchFilters,
            industry: [],
            skills: [],
            interests: [],
            businessChallenges: [],
            location: '',
            hasProfileImage: false,
            lastLoginDays: 0
        };

        // 検索実行
        search();
    }

    // 検索実行
    async function search() {
        try {
            showLoading();

            // クエリの構築
            let query = window.supabaseClient
                .from('user_profiles')
                .select('*')
                .neq('id', currentUserId);

            // キーワード検索
            if (searchFilters.keyword) {
                // PostgRESTフィルター特殊文字をサニタイズ
                const safeKeyword = searchFilters.keyword.replace(/[%_,.()"\\]/g, '');
                if (safeKeyword) {
                    query = query.or(`name.ilike.%${safeKeyword}%,company.ilike.%${safeKeyword}%,bio.ilike.%${safeKeyword}%`);
                }
            }

            // 業界フィルター
            if (searchFilters.industry.length > 0) {
                query = query.in('industry', searchFilters.industry);
            }

            // 地域フィルター
            if (searchFilters.location) {
                query = query.eq('location', searchFilters.location);
            }

            // プロフィール画像フィルター
            if (searchFilters.hasProfileImage) {
                query = query.not('picture_url', 'is', null);
            }

            // 最終ログインフィルター
            if (searchFilters.lastLoginDays > 0) {
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - searchFilters.lastLoginDays);
                query = query.gte('last_login_at', cutoffDate.toISOString());
            }

            // ソート
            switch (searchFilters.sortBy) {
                case 'newest':
                    query = query.order('created_at', { ascending: false });
                    break;
                case 'active':
                    query = query.order('last_login_at', { ascending: false });
                    break;
                default:
                    // relevance sorting would require full-text search
                    break;
            }

            // ページネーション
            const from = (searchFilters.page - 1) * searchFilters.limit;
            const to = from + searchFilters.limit - 1;
            query = query.range(from, to);

            // 実行
            const { data: users, error, count } = await query;

            if (error) throw error;

            // スキル、興味、ビジネス課題でのフィルタリング（クライアントサイド）
            let filteredUsers = users || [];

            if (searchFilters.skills.length > 0) {
                filteredUsers = filteredUsers.filter(user => 
                    user.skills && searchFilters.skills.some(skill => user.skills.includes(skill))
                );
            }

            if (searchFilters.interests.length > 0) {
                filteredUsers = filteredUsers.filter(user => 
                    user.interests && searchFilters.interests.some(interest => user.interests.includes(interest))
                );
            }

            if (searchFilters.businessChallenges.length > 0) {
                filteredUsers = filteredUsers.filter(user => {
                    if (!user.business_challenges) return false;
                    // JSONB {challenges:[...]} 形式にも対応
                    let bc = user.business_challenges;
                    if (typeof bc === 'object' && !Array.isArray(bc) && Array.isArray(bc.challenges)) {
                        bc = bc.challenges;
                    }
                    if (!Array.isArray(bc)) return false;
                    return searchFilters.businessChallenges.some(challenge => bc.includes(challenge));
                });
            }

            // 結果を表示
            displayResults(filteredUsers, count);

            // 検索履歴を保存
            saveSearchHistory();

        } catch (error) {
            console.error('[AdvancedSearch] 検索エラー:', error);
            showError('検索中にエラーが発生しました');
        } finally {
            hideLoading();
        }
    }

    // 検索結果の表示
    function displayResults(users, totalCount) {
        const resultsDiv = document.getElementById('search-results');
        if (!resultsDiv) return;

        if (users.length === 0) {
            resultsDiv.innerHTML = `
                <div class="no-results">
                    <i class="fas fa-search"></i>
                    <h3>検索結果が見つかりませんでした</h3>
                    <p>検索条件を変更してお試しください</p>
                </div>
            `;
            return;
        }

        resultsDiv.innerHTML = `
            <div class="results-header">
                <span class="results-count">${users.length}件の結果</span>
                <select class="form-select" onchange="window.AdvancedSearch.changeSort(this.value)">
                    <option value="relevance">関連性順</option>
                    <option value="newest">新着順</option>
                    <option value="active">アクティブ順</option>
                </select>
            </div>
            <div class="results-grid">
                ${users.map(user => createUserCard(user)).join('')}
            </div>
        `;
    }

    // URLプロトコル検証（http/httpsのみ許可）
    function sanitizeImageUrl(url) {
        if (!url) return '';
        try {
            const parsed = new URL(url, window.location.origin);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'data:') {
                return parsed.href;
            }
        } catch (e) { /* invalid URL */ }
        return '';
    }

    // ユーザーカードの作成
    function createUserCard(user) {
        const safeImageUrl = sanitizeImageUrl(user.picture_url);
        return `
            <div class="user-card" data-user-id="${window.escapeAttr(user.id)}">
                <div class="user-avatar">
                    ${safeImageUrl ?
                        `<img src="${window.escapeAttr(safeImageUrl)}" alt="${escapeHtml(user.name || '')}">` :
                        `<div class="avatar-placeholder"><i class="fas fa-user"></i></div>`
                    }
                </div>
                <div class="user-info">
                    <h3>${escapeHtml(user.name || '名前未設定')}</h3>
                    <p class="user-title">${escapeHtml(user.position || '')} @ ${escapeHtml(user.company || '')}</p>
                    ${user.skills && user.skills.length > 0 ? `
                        <div class="user-tags">
                            ${user.skills.slice(0, 3).map(skill => 
                                `<span class="tag">${escapeHtml(skill)}</span>`
                            ).join('')}
                        </div>
                    ` : ''}
                </div>
                <div class="user-actions">
                    <button class="btn btn-outline btn-sm" onclick="window.location.href='profile.html?user=${window.escapeAttr(user.id)}'">
                        <i class="fas fa-user"></i> プロフィール
                    </button>
                    <button class="btn btn-primary btn-sm" onclick="window.AdvancedSearch.sendConnect('${window.escapeAttr(user.id)}')">
                        <i class="fas fa-link"></i> コネクト
                    </button>
                </div>
            </div>
        `;
    }

    // ソート変更
    function changeSort(sortBy) {
        searchFilters.sortBy = sortBy;
        search();
    }

    // コネクト申請送信
    async function sendConnect(userId) {
        if (window.sendConnectRequest) {
            await window.sendConnectRequest(userId);
        } else {
            showError('コネクト機能が利用できません');
        }
    }

    // フィルターの保存
    function saveFilters() {
        localStorage.setItem('searchFilters', JSON.stringify(searchFilters));
    }

    // 保存されたフィルターの読み込み
    function loadSavedFilters() {
        const saved = localStorage.getItem('searchFilters');
        if (saved) {
            try {
                searchFilters = { ...searchFilters, ...JSON.parse(saved) };
                // UIに反映
                applyFiltersToUI();
            } catch (e) {
                console.error('[AdvancedSearch] フィルター読み込みエラー:', e);
            }
        }
    }

    // フィルターをUIに反映
    function applyFiltersToUI() {
        // キーワード
        const keywordInput = document.getElementById('search-keyword');
        if (keywordInput) keywordInput.value = searchFilters.keyword;

        // チェックボックス
        searchFilters.industry.forEach(value => {
            const cb = document.querySelector(`input[name="industry"][value="${value}"]`);
            if (cb) cb.checked = true;
        });

        searchFilters.skills.forEach(value => {
            const cb = document.querySelector(`input[name="skills"][value="${value}"]`);
            if (cb) cb.checked = true;
        });

        searchFilters.interests.forEach(value => {
            const cb = document.querySelector(`input[name="interests"][value="${value}"]`);
            if (cb) cb.checked = true;
        });

        searchFilters.businessChallenges.forEach(value => {
            const cb = document.querySelector(`input[name="businessChallenges"][value="${value}"]`);
            if (cb) cb.checked = true;
        });

        // セレクトボックス
        const locationSelect = document.getElementById('location-filter');
        if (locationSelect) locationSelect.value = searchFilters.location;

        const lastLoginSelect = document.getElementById('last-login-days');
        if (lastLoginSelect) lastLoginSelect.value = searchFilters.lastLoginDays;

        // その他
        const hasImageCb = document.getElementById('has-profile-image');
        if (hasImageCb) hasImageCb.checked = searchFilters.hasProfileImage;
    }

    // 検索履歴の保存
    async function saveSearchHistory() {
        try {
            await window.supabaseClient
                .from('search_history')
                .insert({
                    user_id: currentUserId,
                    search_query: searchFilters.keyword,
                    filters: searchFilters,
                    searched_at: new Date().toISOString()
                });
        } catch (error) {
            console.error('[AdvancedSearch] 検索履歴保存エラー:', error);
        }
    }

    // ローディング表示
    function showLoading() {
        const resultsDiv = document.getElementById('search-results');
        if (resultsDiv) {
            resultsDiv.innerHTML = `
                <div class="loading">
                    <i class="fas fa-spinner fa-spin"></i>
                    <span>検索中...</span>
                </div>
            `;
        }
    }

    function hideLoading() {
        // ローディング表示は結果表示で上書きされる
    }

    // ユーティリティ関数
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function showError(message) {
        showToast(message, 'error');
    }

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <i class="fas fa-${type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        `;
        document.body.appendChild(toast);

        setTimeout(() => toast.classList.add('show'), 100);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // グローバルAPIとして公開
    window.AdvancedSearch = {
        initialize,
        search,
        toggleFilters,
        applyFilters,
        resetFilters,
        changeSort,
        sendConnect
    };

    // 初期化実行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();

