// ============================================================
// matching-bundle.js
// Page-specific bundle for matching.html
// ============================================================

// ============================================================
// Section: matching-unified.js
// ============================================================

/**
 * マッチングシステム統一JavaScript
 * 
 * 機能:
 * - マッチング候補の表示
 * - コネクト申請
 * - プロフィール詳細表示
 * - ブックマーク機能
 * - フィルタリング・検索
 */

(function() {
    'use strict';

    // Supabaseの準備ができていない場合は待機
    if (!window.waitForSupabase || !window.supabaseClient) {
        console.error('[MatchingUnified] Supabaseの初期化を待機中...', {
            waitForSupabase: typeof window.waitForSupabase,
            supabaseClient: typeof window.supabaseClient
        });
        const retryCount = { count: 0, maxRetries: 50 };
        const retryInterval = setInterval(() => {
            retryCount.count++;
            if (window.waitForSupabase && window.supabaseClient) {
                clearInterval(retryInterval);
                console.error('[MatchingUnified] Supabaseが準備できました。初期化を開始します。', {
                    retryCount: retryCount.count
                });
                initializeMatchingSystem();
            } else if (retryCount.count >= retryCount.maxRetries) {
                clearInterval(retryInterval);
                console.error('[MatchingUnified] Supabaseの初期化がタイムアウトしました');
            }
        }, 100);
        return;
    }
    
    // 即座に初期化
    initializeMatchingSystem();
    
    function initializeMatchingSystem() {
        console.error('[MatchingUnified] マッチングシステム初期化開始', {
            timestamp: new Date().toISOString(),
            windowObjects: {
                supabaseClient: !!window.supabaseClient,
                waitForSupabase: !!window.waitForSupabase
            }
        });
        
        try {
        
        console.log('[MatchingUnified] マッチングシステム初期化処理中');
        
        // 他のレーダーチャート関数との競合を防ぐ
        if (window.drawRadarChart || window.drawRadarChartForUser) {
            console.warn('[MatchingUnified] 既存のレーダーチャート関数を検出。上書きします。');
            delete window.drawRadarChart;
            delete window.drawRadarChartForUser;
        }

    // グローバル変数
    let currentUserId = null;
    let matchingUsers = [];
    let currentPage = 1;
    const itemsPerPage = 12;
    // フィルター設定（LocalStorageから復元・永続化機能）
    let filters = loadFiltersFromStorage() || {
        industry: '',
        location: '',
        interest: '',
        skills: [],
        interests: [],
        sortBy: 'score',
        search: ''
    };
    
    // フィルター設定をLocalStorageから読み込む
    function loadFiltersFromStorage() {
        try {
            const saved = localStorage.getItem('matchingFilters');
            if (saved) {
                const parsed = JSON.parse(saved);
                return Object.assign({
                    industry: '',
                    location: '',
                    interest: '',
                    skills: [],
                    interests: [],
                    sortBy: 'score',
                    search: ''
                }, parsed);
            }
            return null;
        } catch (e) {
            return null;
        }
    }
    
    // フィルター設定をLocalStorageに保存
    function saveFiltersToStorage() {
        try {
            localStorage.setItem('matchingFilters', JSON.stringify(filters));
        } catch (e) {
            // 保存失敗は無視
        }
    }
    
    // タイマー管理用
    const activeTimers = new Set();
    
    // Canvas再試行カウントを管理するWeakMap
    const canvasRetryCount = new WeakMap();
    
    // スキル-課題マッピング定義
    const challengeSkillMapping = {
        // ============ 売上・収益の課題 ============
        '新規顧客獲得': {
            requiredSkills: [
                'デジタルマーケティング',
                'SNSマーケティング', 
                'SEO/SEM',
                'コンテンツマーケティング',
                'ブランディング',
                'PR・広報'
            ],
            weight: 30,
            keywords: ['顧客', '獲得', '集客', '新規開拓', 'リード']
        },
        
        '既存顧客単価': {
            requiredSkills: [
                'CRM',
                'データ分析',
                'マーケティング分析',
                '商品企画',
                'サービス開発',
                'プロダクトマネジメント'
            ],
            weight: 25,
            keywords: ['単価', 'アップセル', 'クロスセル', 'LTV']
        },
        
        '市場シェア拡大': {
            requiredSkills: [
                '市場開拓',
                '事業開発',
                '経営戦略立案',
                'M&A戦略',
                '事業提携・アライアンス'
            ],
            weight: 30,
            keywords: ['シェア', '拡大', '競争', '市場']
        },
        
        'リピート率向上': {
            requiredSkills: [
                'CRM',
                'カスタマーサクセス',
                'データ分析',
                'マーケティング分析',
                'UXデザイン'
            ],
            weight: 25,
            keywords: ['リピート', 'リテンション', '継続率', '顧客満足']
        },
        
        '新規事業開発': {
            requiredSkills: [
                '新規事業開発',
                '事業計画策定',
                'ビジネスモデル構築',
                '市場開拓',
                'プロダクトマネジメント'
            ],
            weight: 35,
            keywords: ['新規事業', '新サービス', 'イノベーション', '事業開発']
        },
        
        // ============ 組織・人材の課題 ============
        '人材採用': {
            requiredSkills: [
                '人材開発',
                '組織開発',
                '採用',
                'HRテック',
                '評価制度'
            ],
            weight: 25,
            keywords: ['採用', '人材', 'リクルート', '獲得']
        },
        
        '人材育成': {
            requiredSkills: [
                '人材開発',
                '組織開発',
                'コーチング',
                'マネジメント',
                '研修設計'
            ],
            weight: 20,
            keywords: ['育成', '教育', 'スキルアップ', '研修']
        },
        
        '組織文化': {
            requiredSkills: [
                '組織変革',
                '組織開発',
                'ビジョン構築',
                'チームビルディング',
                'ファシリテーション'
            ],
            weight: 25,
            keywords: ['文化', 'カルチャー', '風土', '組織']
        },
        
        '離職防止': {
            requiredSkills: [
                '組織文化',
                '評価制度',
                '人事制度',
                'エンゲージメント',
                '福利厚生設計'
            ],
            weight: 25,
            keywords: ['離職', '定着', 'retention', 'エンゲージメント']
        },
        
        '評価制度': {
            requiredSkills: [
                '人事評価制度',
                '組織開発',
                'KPI設計',
                'データ分析',
                '目標管理'
            ],
            weight: 20,
            keywords: ['評価', '人事制度', 'KPI', '目標']
        },
        
        // ============ 業務効率・DXの課題 ============
        'DX推進': {
            requiredSkills: [
                'DX推進',
                'AI・機械学習',
                'IoT',
                'クラウド',
                'ビッグデータ',
                'システム設計'
            ],
            weight: 35,
            keywords: ['DX', 'デジタル', '変革', 'transformation']
        },
        
        '業務自動化': {
            requiredSkills: [
                'RPA',
                'AI・機械学習',
                'システム設計',
                'プロセス改善',
                'BPR'
            ],
            weight: 30,
            keywords: ['自動化', 'RPA', '効率化', 'automation']
        },
        
        'システム統合': {
            requiredSkills: [
                'システム設計',
                'クラウド',
                'API開発',
                'データベース設計',
                'セキュリティ'
            ],
            weight: 25,
            keywords: ['システム', '統合', 'integration', 'API']
        },
        
        'データ活用': {
            requiredSkills: [
                'ビッグデータ',
                'データ分析',
                'BI',
                'データサイエンス',
                'マーケティング分析'
            ],
            weight: 30,
            keywords: ['データ', '分析', 'analytics', 'BI']
        },
        
        'セキュリティ': {
            requiredSkills: [
                'サイバーセキュリティ',
                'セキュリティ',
                'リスクマネジメント',
                'コンプライアンス',
                'ISMS'
            ],
            weight: 25,
            keywords: ['セキュリティ', 'リスク', 'セキュア', '情報保護']
        },
        
        // ============ 事業戦略・競争力の課題 ============
        '差別化戦略': {
            requiredSkills: [
                '経営戦略立案',
                'ブランディング',
                'マーケティング戦略',
                'プロダクト戦略',
                '競合分析'
            ],
            weight: 30,
            keywords: ['差別化', '競合', '優位性', 'ポジショニング']
        },
        
        'ブランディング': {
            requiredSkills: [
                'ブランディング',
                'PR・広報',
                'マーケティング',
                'コンテンツマーケティング',
                'デザイン思考'
            ],
            weight: 25,
            keywords: ['ブランド', 'ブランディング', '認知', 'イメージ']
        },
        
        '海外展開': {
            requiredSkills: [
                '海外事業',
                'グローバル展開',
                '国際ビジネス',
                '多言語対応',
                'クロスカルチャー'
            ],
            weight: 30,
            keywords: ['海外', 'グローバル', '国際', 'export']
        },
        
        'パートナーシップ': {
            requiredSkills: [
                '事業提携・アライアンス',
                'パートナーシップ構築',
                'ネゴシエーション',
                '契約交渉',
                'リレーション構築'
            ],
            weight: 25,
            keywords: ['提携', 'パートナー', 'アライアンス', '協業']
        }
    };
    
    // スキルの市場価値と希少性マップ
    const skillValueMap = {
        // 高価値・高需要スキル（80-100点）
        'AI・機械学習': { value: 95, rarity: 90, demand: 95 },
        'ブロックチェーン': { value: 85, rarity: 85, demand: 80 },
        'データサイエンス': { value: 90, rarity: 80, demand: 90 },
        'データ分析': { value: 85, rarity: 70, demand: 90 },
        'ビッグデータ': { value: 85, rarity: 75, demand: 85 },
        'M&A戦略': { value: 85, rarity: 90, demand: 75 },
        'IoT': { value: 80, rarity: 75, demand: 80 },
        'DX推進': { value: 90, rarity: 70, demand: 95 },
        'サイバーセキュリティ': { value: 85, rarity: 80, demand: 90 },
        
        // 中価値・安定需要スキル（60-79点）
        'デジタルマーケティング': { value: 75, rarity: 60, demand: 85 },
        'プロジェクト管理': { value: 70, rarity: 50, demand: 80 },
        'プロダクトマネジメント': { value: 75, rarity: 65, demand: 80 },
        'システム設計': { value: 75, rarity: 65, demand: 75 },
        'UI/UX': { value: 70, rarity: 60, demand: 75 },
        'ブランディング': { value: 70, rarity: 55, demand: 75 },
        'SNSマーケティング': { value: 65, rarity: 50, demand: 75 },
        'SEO/SEM': { value: 65, rarity: 55, demand: 70 },
        'CRM': { value: 70, rarity: 60, demand: 75 },
        '事業開発': { value: 75, rarity: 65, demand: 75 },
        '経営戦略立案': { value: 75, rarity: 70, demand: 70 },
        '人材開発': { value: 70, rarity: 60, demand: 75 },
        '組織開発': { value: 70, rarity: 65, demand: 70 },
        
        // 基礎スキル（40-59点）
        'コミュニケーション': { value: 50, rarity: 30, demand: 70 },
        'ビジネス': { value: 45, rarity: 25, demand: 65 },
        'マーケティング': { value: 55, rarity: 40, demand: 65 },
        'プレゼンテーション': { value: 55, rarity: 40, demand: 60 },
        'ネゴシエーション': { value: 60, rarity: 50, demand: 65 },
        'リーダーシップ': { value: 60, rarity: 45, demand: 70 },
        'チームワーク': { value: 50, rarity: 30, demand: 65 },
        
        // デフォルト値
        default: { value: 50, rarity: 50, demand: 50 }
    };
    
    // マッチングスコア計算関数をグローバルに公開（後で設定）
    window.matchingScoreFix = {
        calculateScore: calculateMatchingScore
    };
    
    // タイマー管理ヘルパー関数
    function setManagedTimeout(callback, delay) {
        const timerId = setTimeout(() => {
            activeTimers.delete(timerId);
            callback();
        }, delay);
        activeTimers.add(timerId);
        return timerId;
    }
    
    // 全タイマーのクリーンアップ
    function clearAllTimers() {
        activeTimers.forEach(timerId => clearTimeout(timerId));
        activeTimers.clear();
    }

    // 初期化
    async function initialize() {
        // console.log('[MatchingUnified] 初期化開始');

        try {
            // Supabaseの準備を待つ
            await window.waitForSupabase();

            // 現在のユーザーを取得
            const user = await window.safeGetUser();
            if (!user) {
                console.error('[MatchingUnified] ユーザーが認証されていません');
                // 開発環境でのみダミーデータを表示
                if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    displayDummyData();
                } else {
                    showLoginRequired();
                }
                return;
            }

            currentUserId = user.id;
            // console.log('[MatchingUnified] ユーザーID:', currentUserId);

            // イベントリスナーの設定
            setupEventListeners();

            // マッチング候補の読み込み
            await loadMatchingCandidates();
        } catch (error) {
            console.error('[MatchingUnified] 初期化エラー:', error);
            // 開発環境でのみダミーデータを表示
            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                displayDummyData();
            } else {
                showErrorMessage('初期化エラーが発生しました。ページを再読み込みしてください。');
            }
        }
    }

    // 検索フィールドを追加する関数（削除されたファイルから復元）
    function addSearchField() {
        const filtersSection = document.querySelector('.matching-filters');
        if (!filtersSection) return;
        
        // 既存の検索フィールドがあるかチェック
        if (filtersSection.querySelector('.search-field-group')) {
            return;
        }
        
        // 検索フィールドを最初に追加
        const searchFieldHTML = `
            <div class="filter-group search-field-group" style="grid-column: span 2;">
                <label>キーワード検索</label>
                <div style="position: relative;">
                    <input type="text" 
                           id="matching-search-input"
                           class="form-control" 
                           placeholder="名前、会社名、スキル、地域などで検索..."
                           style="
                               width: 100%;
                               padding: 10px 40px 10px 15px;
                               border: 1px solid #ddd;
                               border-radius: 8px;
                               font-size: 14px;
                           ">
                    <i class="fas fa-search" style="
                        position: absolute;
                        right: 15px;
                        top: 50%;
                        transform: translateY(-50%);
                        color: #999;
                        pointer-events: none;
                    "></i>
                </div>
            </div>
        `;
        
        // 最初の要素として追加
        filtersSection.insertAdjacentHTML('afterbegin', searchFieldHTML);
    }
    
    // イベントリスナーの設定
    function setupEventListeners() {
        // 検索フィールドを追加（削除されたファイルから復元）
        addSearchField();
        
        // 検索ボタン
        const searchBtn = document.querySelector('.matching-filters .btn-primary');
        if (searchBtn) {
            searchBtn.addEventListener('click', handleSearch);
        }
        
        // 検索フィールドのイベント
        const searchInput = document.getElementById('matching-search-input');
        if (searchInput) {
            let searchTimeout;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    filters.search = e.target.value.toLowerCase().trim();
                    currentPage = 1;
                    displayMatchingUsers();
                }, 300); // 300ms のデバウンス
            });
            
            // Enterキーでも検索
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    clearTimeout(searchTimeout);
                    filters.search = e.target.value.toLowerCase().trim();
                    currentPage = 1;
                    displayMatchingUsers();
                }
            });
        }

        // ソート選択
        const sortSelect = document.querySelector('.sort-options select');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                filters.sortBy = e.target.value;
                saveFiltersToStorage(); // フィルター保存
                displayMatchingUsers();
            });
        }
        
        // その他のフィルター変更時も保存
        document.querySelectorAll('.matching-filters select').forEach(select => {
            select.addEventListener('change', () => {
                if (select.name === 'industry') filters.industry = select.value;
                if (select.name === 'location') filters.location = select.value;
                if (select.name === 'interest') filters.interest = select.value;
                saveFiltersToStorage(); // フィルター保存
                currentPage = 1;
                displayMatchingUsers();
            });
        });

        // フィルター - 業界
        const industrySelect = document.querySelector('[name="industry"]');
        if (industrySelect) {
            industrySelect.addEventListener('change', (e) => {
                filters.industry = e.target.value;
                displayMatchingUsers();
            });
        }

        // フィルター - 地域
        const locationSelect = document.querySelector('[name="location"]');
        if (locationSelect) {
            locationSelect.addEventListener('change', (e) => {
                filters.location = e.target.value;
                displayMatchingUsers();
            });
        }

        // フィルター - 興味・関心
        const interestSelect = document.querySelector('[name="interest"]');
        if (interestSelect) {
            interestSelect.addEventListener('change', (e) => {
                filters.interest = e.target.value;
                displayMatchingUsers();
            });
        }

        // フィルター（その他の入力フィールド用）
        document.querySelectorAll('.filter-option input').forEach(input => {
            input.addEventListener('change', updateFilters);
        });
    }

    // マッチング候補の読み込み
    async function loadMatchingCandidates() {
        try {
            // console.log('[MatchingUnified] マッチング候補読み込み開始');
            
            const container = document.getElementById('matching-container');
            if (!container) {
                console.error('[MatchingUnified] matching-containerが見つかりません');
                return;
            }
            
            // 読み込み中表示（改善されたローディング演出）
            container.innerHTML = `
                <div class="loading-container">
                    <div class="loading-spinner">
                        <div class="spinner-ring"></div>
                        <div class="spinner-ring"></div>
                        <div class="spinner-ring"></div>
                    </div>
                    <p class="loading-text">マッチング候補を検索中...</p>
                </div>
            `;
            
            // 現在のユーザーID取得
            const user = await window.safeGetUser();
            if (!user) {
                container.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><h3>ログインが必要です</h3><p>マッチング機能を使うにはログインしてください</p><a href="login.html" class="btn btn-primary" style="margin-top:16px;">ログイン</a></div>';
                return;
            }
            
            currentUserId = user.id;
            console.log('[MatchingUnified] 現在のユーザーID:', currentUserId);
            
            // user_profilesテーブルから必要なカラムのみ取得（パフォーマンス改善）
            console.log('[MatchingUnified] user_profilesテーブルからデータ取得開始...');
            // 一時的にワイルドカードで全カラムを取得（存在しないカラムエラーを回避）
            const { data: allUsers, error } = await window.supabaseClient
                .from('user_profiles')
                .select('*')
                .limit(200); // パフォーマンス対策: 最大200件に制限
            
            console.log('[MatchingUnified] user_profilesテーブル応答:', {
                dataCount: allUsers ? allUsers.length : 0,
                hasError: !!error,
                errorMessage: error ? error.message : null,
                firstUser: allUsers && allUsers.length > 0 ? allUsers[0] : null,
                availableColumns: allUsers && allUsers.length > 0 ? Object.keys(allUsers[0]) : []
            });
            
            if (error) {
                console.error('[MatchingUnified] プロファイル取得エラー:', error);
                console.error('[MatchingUnified] エラー詳細:', {
                    message: error.message,
                    details: error.details,
                    hint: error.hint,
                    code: error.code,
                    fullError: JSON.stringify(error, null, 2)
                });
                
                // エラーメッセージから存在しないカラムを特定
                if (error.message && error.message.includes('does not exist')) {
                    console.error('[MatchingUnified] ⚠️ カラムが存在しません:', error.message);
                }
                // XSS対策: DOM操作で安全に挿入
                container.innerHTML = '';
                const errorDiv = document.createElement('div');
                errorDiv.className = 'empty-state';
                
                const icon = document.createElement('i');
                icon.className = 'fas fa-exclamation-triangle';
                
                const heading = document.createElement('h3');
                heading.textContent = 'データの取得に失敗しました';
                
                const paragraph = document.createElement('p');
                paragraph.textContent = error.message || 'user_profilesテーブルが存在しない可能性があります';
                
                const detail = document.createElement('small');
                detail.textContent = `エラーコード: ${error.code || 'unknown'}`;
                
                errorDiv.appendChild(icon);
                errorDiv.appendChild(heading);
                errorDiv.appendChild(paragraph);
                errorDiv.appendChild(detail);
                container.appendChild(errorDiv);
                
                // テーブル存在チェック（デバッグ用）
                console.log('[MatchingUnified] user_profilesテーブルの存在を確認中...');
                const { data: test } = await window.supabaseClient
                    .from('user_profiles')
                    .select('id')
                    .limit(1);
                if (test) {
                    console.log('[MatchingUnified] user_profilesテーブルは存在し、アクセス可能です');
                }
                return;
            }
            
            // 自分以外のユーザーをフィルタリング（user_profilesではidカラムを使用）
            const users = allUsers ? allUsers.filter(user => user.id !== currentUserId) : [];
            console.log('[MatchingUnified] フィルタリング後のユーザー数:', users.length, {
                originalCount: allUsers ? allUsers.length : 0,
                filteredCount: users.length,
                currentUserId: currentUserId
            });
            
            console.log('[MatchingUnified] 取得したユーザー詳細:', {
                totalUsers: users.length,
                sample: users.slice(0, 3).map(u => ({
                    id: u.id,
                    name: u.name,
                    company: u.company,
                    hasSkills: !!u.skills,
                    hasInterests: !!u.interests
                }))
            });
            
            if (!users || users.length === 0) {
                container.innerHTML = '<div class="empty-state"><i class="fas fa-users"></i><h3>マッチング候補が見つかりません</h3><p>条件を変更して再度お試しください</p><button class="btn btn-secondary" style="margin-top:16px;" onclick="location.reload()">フィルターをリセット</button></div>';
                return;
            }
            
            // 各ユーザーのコネクションステータスを取得（user_profilesではidカラムを使用）
            const userIds = users.map(u => u.id).filter(id => id); // null/undefinedを除外
            // console.log('[MatchingUnified] フィルタリング後のuserIds:', userIds);
            
            let connections = [];
            
            if (userIds.length > 0) {
                const { data: connectionsData, error: connError } = await window.supabaseClient
                    .from('connections')
                    .select('*');
                
                if (connError) {
                    console.error('[MatchingUnified] コネクション取得エラー:', connError);
                } else {
                    // JavaScriptでフィルタリング
                    connections = connectionsData ? connectionsData.filter(conn => 
                        (conn.user_id === currentUserId && userIds.includes(conn.connected_user_id)) ||
                        (userIds.includes(conn.user_id) && conn.connected_user_id === currentUserId)
                    ) : [];
                    // console.log('[MatchingUnified] 取得したconnections:', connections);
                }
            }
            
            // コネクションステータスをマップに格納
            const connectionMap = {};
            if (connections) {
                connections.forEach(conn => {
                    const otherUserId = conn.user_id === currentUserId ? conn.connected_user_id : conn.user_id;
                    connectionMap[otherUserId] = conn.status;
                });
            }
            
            // マッチングスコアを計算
            console.log('[MatchingUnified] マッチングスコア計算開始...');
            matchingUsers = await calculateMatchingScores(users);
            console.log('[MatchingUnified] マッチングスコア計算完了:', {
                count: matchingUsers.length,
                topScores: matchingUsers.slice(0, 3).map(u => ({
                    name: u.name,
                    score: u.matchingScore,
                    reasons: u.matchingReasons
                }))
            });
            
            // connectionMapを各ユーザーに追加
            matchingUsers.forEach(user => {
                user.connectionStatus = connectionMap[user.id] || null;
            });
            
            // 表示
            console.log('[MatchingUnified] 初回displayMatchingUsers呼び出し前:', {
                matchingUsersCount: matchingUsers.length,
                currentPage: currentPage,
                container: document.getElementById('matching-container') ? 'exists' : 'not found',
                firstThreeUsers: matchingUsers.slice(0, 3).map(u => ({
                    id: u.id,
                    name: u.name,
                    score: u.matchScore || u.matchingScore
                }))
            });
            
            // データがある場合のみ表示
            if (matchingUsers && matchingUsers.length > 0) {
                displayMatchingUsers();
                console.log('[MatchingUnified] 初回displayMatchingUsers呼び出し後');
            } else {
                console.error('[MatchingUnified] matchingUsersが空です！');
                const container = document.getElementById('matching-container');
                if (container) {
                    container.innerHTML = '<div class="empty-state"><i class="fas fa-users"></i><h3>マッチング候補が見つかりません</h3><button class="btn btn-secondary" style="margin-top:16px;" onclick="location.reload()">フィルターをリセット</button></div>';
                }
            }
            
            // カード内のイベントリスナーを設定
            setupCardEventListeners();

        } catch (error) {
            console.error('[MatchingUnified] エラー:', error);
            const container = document.getElementById('matching-container');
            if (container) {
                // XSS対策: DOM操作で安全に挿入
                container.innerHTML = '';
                const errorDiv = document.createElement('div');
                errorDiv.className = 'empty-state';
                
                const icon = document.createElement('i');
                icon.className = 'fas fa-exclamation-triangle';
                
                const heading = document.createElement('h3');
                heading.textContent = 'エラーが発生しました';
                
                const paragraph = document.createElement('p');
                paragraph.textContent = error.message;
                
                errorDiv.appendChild(icon);
                errorDiv.appendChild(heading);
                errorDiv.appendChild(paragraph);
                container.appendChild(errorDiv);
            }
        }
    }

    // スキルの質的評価を計算
    function calculateSkillQuality(skills) {
        if (!skills || skills.length === 0) return 0;
        
        // 配列でない場合の処理
        const skillArray = Array.isArray(skills) ? skills : 
            (typeof skills === 'string' ? skills.split(',').map(s => s.trim()) : []);
        
        if (skillArray.length === 0) return 0;
        
        let totalValue = 0;
        let totalRarity = 0;
        let totalDemand = 0;
        let count = 0;
        
        for (const skill of skillArray) {
            const skillData = skillValueMap[skill] || skillValueMap.default;
            totalValue += skillData.value;
            totalRarity += skillData.rarity;
            totalDemand += skillData.demand;
            count++;
        }
        
        if (count === 0) return 0;
        
        const avgValue = totalValue / count;
        const avgRarity = totalRarity / count;
        const avgDemand = totalDemand / count;
        
        // 加重平均（需要を重視）
        return Math.round(avgValue * 0.3 + avgRarity * 0.2 + avgDemand * 0.5) || 0;
    }
    
    // 学習機会スコアを計算（相手から学べる価値）
    function calculateLearningOpportunity(learner, teacher) {
        const learnerSkills = Array.isArray(learner.skills) ? learner.skills : 
            (learner.skills ? learner.skills.split(',').map(s => s.trim()) : []);
        const teacherSkills = Array.isArray(teacher.skills) ? teacher.skills : 
            (teacher.skills ? teacher.skills.split(',').map(s => s.trim()) : []);
        
        // 相手が持っていて自分が持っていないスキル
        const newSkills = teacherSkills.filter(s => !learnerSkills.includes(s));
        
        if (newSkills.length === 0) return 0;
        
        // スキルの価値で重み付け
        let totalValue = 0;
        for (const skill of newSkills) {
            const skillData = skillValueMap[skill] || skillValueMap.default;
            totalValue += skillData.value;
        }
        
        // 学習可能なスキル数と価値のバランス
        const avgValue = totalValue / newSkills.length;
        const countBonus = Math.min(newSkills.length * 5, 30); // 最大30点
        
        return Math.min(100, avgValue + countBonus);
    }
    
    // スキル-課題マッチング計算（新規追加）
    function calculateSkillChallengeMatch(userA, userB) {
        const result = {
            aHelpsB: 0,      // AがBを助けられる度合い
            bHelpsA: 0,      // BがAを助けられる度合い
            details: [],     // 詳細な補完関係
            totalScore: 0,   // 総合スコア
            balance: 0       // バランススコア
        };
        
        // Aのスキル、Bの課題を抽出
        const aSkills = Array.isArray(userA.skills) ? userA.skills : 
            (userA.skills ? userA.skills.split(',').map(s => s.trim()) : []);
        const bChallenges = Array.isArray(userB.business_challenges) ? 
            userB.business_challenges : 
            (userB.business_challenges ? userB.business_challenges.split(',').map(s => s.trim()) : []);
        
        // Bのスキル、Aの課題を抽出
        const bSkills = Array.isArray(userB.skills) ? userB.skills : 
            (userB.skills ? userB.skills.split(',').map(s => s.trim()) : []);
        const aChallenges = Array.isArray(userA.business_challenges) ? 
            userA.business_challenges : 
            (userA.business_challenges ? userA.business_challenges.split(',').map(s => s.trim()) : []);
        
        // A → B の支援度計算
        let aHelpsBScore = 0;
        let aHelpsBCount = 0;
        
        for (const challenge of bChallenges) {
            if (challengeSkillMapping[challenge]) {
                const mapping = challengeSkillMapping[challenge];
                const requiredSkills = mapping.requiredSkills;
                const matchedSkills = aSkills.filter(skill => 
                    requiredSkills.includes(skill)
                );
                
                if (matchedSkills.length > 0) {
                    const matchRate = matchedSkills.length / requiredSkills.length;
                    const weightedScore = matchRate * mapping.weight;
                    aHelpsBScore += weightedScore;
                    aHelpsBCount++;
                    
                    result.details.push({
                        direction: 'A→B',
                        challenge: challenge,
                        solver: userA.name || 'ユーザーA',
                        matchedSkills: matchedSkills,
                        matchRate: Math.round(matchRate * 100),
                        impact: mapping.weight
                    });
                }
            }
        }
        
        // B → A の支援度計算
        let bHelpsAScore = 0;
        let bHelpsACount = 0;
        
        for (const challenge of aChallenges) {
            if (challengeSkillMapping[challenge]) {
                const mapping = challengeSkillMapping[challenge];
                const requiredSkills = mapping.requiredSkills;
                const matchedSkills = bSkills.filter(skill => 
                    requiredSkills.includes(skill)
                );
                
                if (matchedSkills.length > 0) {
                    const matchRate = matchedSkills.length / requiredSkills.length;
                    const weightedScore = matchRate * mapping.weight;
                    bHelpsAScore += weightedScore;
                    bHelpsACount++;
                    
                    result.details.push({
                        direction: 'B→A',
                        challenge: challenge,
                        solver: userB.name || 'ユーザーB',
                        matchedSkills: matchedSkills,
                        matchRate: Math.round(matchRate * 100),
                        impact: mapping.weight
                    });
                }
            }
        }
        
        // 正規化（0-100スケール）
        result.aHelpsB = aHelpsBCount > 0 ? 
            Math.min(100, (aHelpsBScore / aHelpsBCount) * 3) : 0;
        result.bHelpsA = bHelpsACount > 0 ? 
            Math.min(100, (bHelpsAScore / bHelpsACount) * 3) : 0;
        
        // バランススコア（双方向の価値が均等なほど高い）
        result.balance = 100 - Math.abs(result.aHelpsB - result.bHelpsA);
        
        // スキルの質的評価を追加
        const aSkillQuality = calculateSkillQuality(aSkills);
        const bSkillQuality = calculateSkillQuality(bSkills);
        
        // 学習機会の評価を追加
        const aLearningOpp = calculateLearningOpportunity(userA, userB);
        const bLearningOpp = calculateLearningOpportunity(userB, userA);
        
        // 総合スコア（相互補完性を重視）
        const average = (result.aHelpsB + result.bHelpsA) / 2;
        const hasComplementarity = result.aHelpsB > 0 && result.bHelpsA > 0;
        
        // 質的評価を加味した最終スコア
        const qualityBonus = ((aSkillQuality + bSkillQuality) / 200) * 20; // 最大20点のボーナス
        const learningBonus = ((aLearningOpp + bLearningOpp) / 200) * 10; // 最大10点のボーナス
        
        result.totalScore = (hasComplementarity ?
            (average * 0.6 + result.balance * 0.2 + qualityBonus + learningBonus) :
            (average * 0.4 + qualityBonus + learningBonus)) || 0; // NaN防止
        
        // 追加情報を結果に含める
        result.skillQuality = {
            a: aSkillQuality,
            b: bSkillQuality
        };
        result.learningOpportunity = {
            aFromB: aLearningOpp,
            bFromA: bLearningOpp
        };
        
        return result;
    }
    
    // 個別のマッチングスコア計算（profile-detail-modalから呼び出し可能）
    function calculateMatchingScore(profileUser, currentUser) {
        if (!profileUser || !currentUser) return 50;
        
        // 新しい補完性スコアを取得
        const complementarity = calculateSkillChallengeMatch(currentUser, profileUser);
        
        let score = 0;
        
        // 補完性スコアを重視（40点満点）
        score += ((complementarity && complementarity.totalScore) || 0) * 0.4;
        
        // スキルの一致度（20点満点）
        if (profileUser.skills && currentUser.skills) {
            const profileSkills = Array.isArray(profileUser.skills) ? profileUser.skills : [];
            const currentSkills = Array.isArray(currentUser.skills) ? currentUser.skills : [];
            const commonSkills = profileSkills.filter(skill => currentSkills.includes(skill));
            score += Math.min((commonSkills.length / Math.max(profileSkills.length, 1)) * 20, 20);
        }
        
        // 興味の一致度（15点満点）
        if (profileUser.interests && currentUser.interests) {
            const profileInterests = Array.isArray(profileUser.interests) ? profileUser.interests : [];
            const currentInterests = Array.isArray(currentUser.interests) ? currentUser.interests : [];
            const commonInterests = profileInterests.filter(interest => currentInterests.includes(interest));
            score += Math.min((commonInterests.length / Math.max(profileInterests.length, 1)) * 15, 15);
        }
        
        // 業界の一致（10点）
        if (profileUser.industry && currentUser.industry && profileUser.industry === currentUser.industry) {
            score += 10;
        }
        
        // 地域の一致（10点）
        if (profileUser.location && currentUser.location && profileUser.location === currentUser.location) {
            score += 10;
        }
        
        // 基礎スコア（5点）
        score += 5;
        
        return Math.min(Math.round(score) || 0, 100);
    }
    
    // マッチングスコアの計算
    async function calculateMatchingScores(users) {
        try {
            // 現在のユーザーのプロフィール取得（自分のデータのみ）
            const { data: currentUserData } = await window.supabaseClient
                .from('user_profiles')
                .select(`
                    id,
                    skills,
                    interests,
                    business_challenges,
                    industry,
                    location
                `)
                .eq('id', currentUserId)
                .maybeSingle();
            
            const currentUser = currentUserData;

            console.error('[MatchingUnified] 現在のユーザーデータ:', {
                id: currentUser?.id,
                skills: currentUser?.skills,
                interests: currentUser?.interests,
                business_challenges: currentUser?.business_challenges,
                industry: currentUser?.industry,
                location: currentUser?.location
            });

            if (!currentUser) return users;

            // 各ユーザーのスコアを計算
            return users.map(user => {
                // 新しい補完性ベースのスコア計算
                const complementarity = calculateSkillChallengeMatch(currentUser, user);
                
                console.error('[MatchingUnified] マッチング計算対象ユーザー:', {
                    targetUserId: user.id,
                    targetName: user.name,
                    targetSkills: user.skills,
                    targetChallenges: user.business_challenges,
                    complementarityScore: complementarity.totalScore
                });
                
                let score = 0;
                const reasons = [];

                // 補完性スコアを最重要視（最大50点）
                score += (complementarity.totalScore * 0.5);
                
                // 補完性の詳細を理由に追加
                if (complementarity.aHelpsB > 0) {
                    reasons.push(`あなたが支援可能: ${Math.round(complementarity.aHelpsB)}%`);
                }
                if (complementarity.bHelpsA > 0) {
                    reasons.push(`相手が支援可能: ${Math.round(complementarity.bHelpsA)}%`);
                }
                
                // 補完性の詳細（上位2つ）
                if (complementarity.details.length > 0) {
                    complementarity.details.slice(0, 2).forEach(detail => {
                        reasons.push(`${detail.challenge}: ${detail.matchedSkills.slice(0, 2).join('、')}`);
                    });
                }

                // スキルの一致度（最大20点）
                const userSkills = Array.isArray(user.skills) ? user.skills : 
                    (user.skills ? user.skills.split(',').map(s => s.trim()) : []);
                const currentSkills = Array.isArray(currentUser.skills) ? currentUser.skills : 
                    (currentUser.skills ? currentUser.skills.split(',').map(s => s.trim()) : []);
                
                if (currentSkills.length > 0 && userSkills.length > 0) {
                    const commonSkills = currentSkills.filter(skill => 
                        userSkills.includes(skill)
                    );
                    if (commonSkills.length > 0) {
                        const skillScore = Math.min((commonSkills.length / Math.max(currentSkills.length, 1)) * 20, 20);
                        score += skillScore;
                        if (commonSkills.length > 0) {
                            reasons.push(`共通スキル: ${commonSkills.slice(0, 3).join('、')}`);
                        }
                    }
                }

                // 興味の一致度（最大15点）
                const userInterests = Array.isArray(user.interests) ? user.interests : 
                    (user.interests ? user.interests.split(',').map(s => s.trim()) : []);
                const currentInterests = Array.isArray(currentUser.interests) ? currentUser.interests : 
                    (currentUser.interests ? currentUser.interests.split(',').map(s => s.trim()) : []);
                
                if (currentInterests.length > 0 && userInterests.length > 0) {
                    const commonInterests = currentInterests.filter(interest => 
                        userInterests.includes(interest)
                    );
                    if (commonInterests.length > 0) {
                        const interestScore = Math.min((commonInterests.length / Math.max(currentInterests.length, 1)) * 15, 15);
                        score += interestScore;
                        if (commonInterests.length > 0) {
                            reasons.push(`共通の興味: ${commonInterests.slice(0, 2).join('、')}`);
                        }
                    }
                }

                // 業界の一致（最大10点）
                if (currentUser.industry && user.industry && currentUser.industry === user.industry) {
                    score += 10;
                    reasons.push(`同じ業界: ${user.industry}`);
                }

                // 地域の一致（最大5点）
                if (currentUser.location && user.location && currentUser.location === user.location) {
                    score += 5;
                    reasons.push(`同じ地域: ${user.location}`);
                }

                // スコアを0-100に正規化
                user.matchScore = Math.min(Math.round(score), 100);
                user.matchReasons = reasons;
                user.complementarityScore = complementarity; // 補完性スコアを保存

                console.error('[MatchingUnified] 最終マッチングスコア:', {
                    userId: user.id,
                    userName: user.name,
                    補完性スコア: complementarity.totalScore,
                    スキル一致スコア: commonSkills ? commonSkills.length : 0,
                    興味一致スコア: commonInterests ? commonInterests.length : 0,
                    最終スコア: user.matchScore,
                    理由: reasons
                });

                return user;
            });

        } catch (error) {
            console.error('[MatchingUnified] スコア計算エラー:', error);
            return users;
        }
    }

    // 補完性の判定
    function isComplementary(challenge, skill) {
        const complementaryPairs = {
            'DX推進': ['AI・機械学習', 'IoT', 'クラウド', 'ビッグデータ'],
            '新規顧客獲得': ['デジタルマーケティング', 'SNSマーケティング', 'SEO/SEM'],
            '人材採用': ['人材開発', '組織開発', '採用'],
            '新規事業開発': ['事業開発', 'ビジネスモデル構築', '市場開拓']
        };

        return complementaryPairs[challenge]?.includes(skill) || false;
    }

    // マッチングユーザーの表示
    function displayMatchingUsers() {
        console.log('[MatchingUnified] displayMatchingUsers開始', {
            totalUsers: matchingUsers.length,
            currentPage: currentPage,
            itemsPerPage: itemsPerPage
        });
        const container = document.getElementById('matching-container');
        if (!container) {
            console.error('[MatchingUnified] matching-containerが見つかりません', {
                documentBody: document.body ? 'exists' : 'not found',
                allIds: Array.from(document.querySelectorAll('[id]')).map(el => el.id)
            });
            return;
        }
        console.log('[MatchingUnified] matching-container見つかりました');

        // フィルタリング
        let filteredUsers = filterUsers(matchingUsers);
        console.log('[MatchingUnified] フィルタリング結果:', {
            フィルター前: matchingUsers.length,
            フィルター後: filteredUsers.length,
            filters: filters
        });

        // ソート
        filteredUsers = sortUsers(filteredUsers);

        // 結果カウント更新
        updateResultsCount(filteredUsers.length);

        if (filteredUsers.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-users-slash"></i>
                    <h3>マッチング候補が見つかりません</h3>
                    <p>フィルター条件を変更してお試しください</p>
                </div>
            `;
            updatePagination(0);
            return;
        }

        // ページネーション処理
        const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
        // 現在のページが総ページ数を超えている場合は1ページ目にリセット
        if (currentPage > totalPages) {
            currentPage = 1;
        }
        
        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const paginatedUsers = filteredUsers.slice(startIndex, endIndex);
        console.log('[MatchingUnified] ページネーション結果:', {
            currentPage: currentPage,
            totalPages: totalPages,
            startIndex: startIndex,
            endIndex: endIndex,
            表示ユーザー数: paginatedUsers.length,
            全体ユーザー数: filteredUsers.length
        });

        // マッチングカードの生成
        console.error('[MatchingUnified] カード生成開始:', paginatedUsers.length, '枚');
        const cardsHtml = paginatedUsers.map(user => {
            const card = createMatchingCard(user);
            console.error('[MatchingUnified] カード生成:', {
                userId: user.id,
                userName: user.name,
                cardLength: card.length
            });
            return card;
        }).join('');
        console.error('[MatchingUnified] カード生成完了, HTML長さ:', cardsHtml.length);
        
        // カードが空でないことを確認
        if (!cardsHtml || cardsHtml.trim() === '') {
            console.error('[MatchingUnified] カードHTMLが空です！');
            container.innerHTML = '<div class="error">カードの生成に失敗しました</div>';
            return;
        }
        
        container.innerHTML = `
            <div class="matching-grid">
                ${cardsHtml}
            </div>
        `;
        console.error('[MatchingUnified] DOMに挿入完了');
        
        // 実際に挿入されたことを確認
        const insertedCards = container.querySelectorAll('.matching-card');
        console.error('[MatchingUnified] 実際に挿入されたカード数:', insertedCards.length);
        
        // DOM要素の確認（デバッグ用）
        if (insertedCards.length === 0 && paginatedUsers.length > 0) {
            console.error('[MatchingUnified] ⚠️ カードが挿入されていません！');
            console.error('[MatchingUnified] グリッドコンテナの状態:', {
                exists: !!gridContainer,
                innerHTML長さ: gridContainer.innerHTML.length,
                childNodes数: gridContainer.childNodes.length,
                children数: gridContainer.children.length
            });
        }

        // ページネーションUI更新
        updatePagination(filteredUsers.length);

        // カード内のイベントリスナー設定
        setupCardEventListeners();
        
        // レーダーチャートを描画（少し遅延させて確実にCanvasが準備されるようにする）
        setManagedTimeout(() => {
            // console.log('[MatchingUnified] レーダーチャート描画を開始します。ユーザー数:', paginatedUsers.length);
            // 全てのCanvas要素が存在するか確認
            const canvasElements = container.querySelectorAll('canvas[id^="radar-"]');
            // console.log('[MatchingUnified] Canvas要素数:', canvasElements.length);
            
            // requestAnimationFrameを使用して順次描画（フリーズ防止）
            let currentIndex = 0;
            function drawNextChart() {
                if (currentIndex < paginatedUsers.length) {
                    // クロージャー問題を防ぐためユーザーデータをコピー（修正3）
                    const user = Object.assign({}, paginatedUsers[currentIndex]);
                    const userId = user.id;
                    // console.log(`[MatchingUnified] ユーザー ${currentIndex + 1}/${paginatedUsers.length} のレーダーチャート描画:`, userId);
                    drawRadarChartForUser(user);
                    currentIndex++;
                    requestAnimationFrame(drawNextChart);
                }
            }
            requestAnimationFrame(drawNextChart);
        }, 300);
    }

    // コネクトボタンのレンダリング
    function renderConnectButton(userId, connectionStatus) {
        if (connectionStatus === 'accepted') {
            return `<button class="btn btn-success connect-btn" disabled data-user-id="${userId}">
                        <i class="fas fa-check"></i> コネクト済み
                    </button>`;
        } else if (connectionStatus === 'pending') {
            return `<button class="btn btn-secondary connect-btn" disabled data-user-id="${userId}">
                        <i class="fas fa-clock"></i> 申請中
                    </button>`;
        } else {
            return `<button class="btn btn-primary connect-btn" data-user-id="${userId}">
                        <i class="fas fa-link"></i> コネクト
                    </button>`;
        }
    }

    // マッチングカードの作成
    function createMatchingCard(user) {
        try {
            console.log('[MatchingUnified] createMatchingCard開始:', {
                userId: user?.id,
                userName: user?.name,
                hasUser: !!user
            });
            
            if (!user) {
                console.error('[MatchingUnified] ユーザーデータがnullです');
                return '';
            }
            
            const matchScore = user.matchScore;
        // スキルデータの処理（配列または文字列）
        let skillsArray = [];
        if (Array.isArray(user.skills)) {
            skillsArray = user.skills;
        } else if (user.skills && typeof user.skills === 'string') {
            skillsArray = user.skills.split(',').map(s => s.trim());
        }
        const skills = skillsArray.slice(0, 3).length > 0 ? 
            skillsArray.slice(0, 3) : ['ビジネス', 'コミュニケーション', 'プロジェクト管理'];
        
        // 共通スキルを判定
        const commonSkills = ['ビジネス', 'コミュニケーション'];
        const hasCommonSkills = skills.some(skill => commonSkills.includes(skill));

        const userId = user.id;
        // Canvas用のIDを安全にエスケープ（HTML属性用）
        const safeCanvasId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
        
        // 補完性スコアの表示
        const complementarity = user.complementarityScore;
        const complementarityHTML = complementarity && (complementarity.aHelpsB > 0 || complementarity.bHelpsA > 0) ? `
            <div class="complementarity-display" style="padding: 10px; background: #f0f4ff; border-radius: 8px; margin: 10px 0;">
                <div class="complementarity-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <span class="complementarity-label" style="font-size: 12px; color: #666;">相互補完性</span>
                    <span class="complementarity-total" style="font-size: 16px; font-weight: bold; color: #4A90E2;">${Math.round(complementarity.totalScore)}%</span>
                </div>
                <div class="complementarity-directions" style="font-size: 11px; color: #555;">
                    ${complementarity.aHelpsB > 20 ? `
                        <div class="complement-arrow" style="margin: 2px 0;">
                            <i class="fas fa-arrow-right" style="color: #4A90E2; margin-right: 5px;"></i>
                            <span>支援可能: ${Math.round(complementarity.aHelpsB)}%</span>
                        </div>
                    ` : ''}
                    ${complementarity.bHelpsA > 20 ? `
                        <div class="complement-arrow" style="margin: 2px 0;">
                            <i class="fas fa-arrow-left" style="color: #E24A90; margin-right: 5px;"></i>
                            <span>支援受領: ${Math.round(complementarity.bHelpsA)}%</span>
                        </div>
                    ` : ''}
                </div>
                ${complementarity.details && complementarity.details.length > 0 ? `
                    <div class="complement-details" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e0e7ff;">
                        ${complementarity.details.slice(0, 1).map(detail => `
                            <div class="complement-detail-item" style="font-size: 10px; color: #666;">
                                <span class="challenge-label" style="font-weight: 500;">${escapeHtml(detail.challenge)}</span>:
                                <span class="match-percent" style="color: #4A90E2;">${detail.matchRate}%マッチ</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                ${complementarity.learningOpportunity && (complementarity.learningOpportunity.aFromB > 30 || complementarity.learningOpportunity.bFromA > 30) ? `
                    <div class="learning-opportunity" style="margin-top: 6px; padding: 4px; background: #fff8e1; border-radius: 4px;">
                        <span style="font-size: 10px; color: #f57c00;">
                            <i class="fas fa-graduation-cap" style="margin-right: 3px;"></i>
                            学習機会: ${Math.max(complementarity.learningOpportunity.aFromB, complementarity.learningOpportunity.bFromA)}%
                        </span>
                    </div>
                ` : ''}
            </div>
        ` : '';
        
        // マッチング理由の表示
        const reasons = user.matchReasons || [];
        const reasonsHTML = reasons.length > 0 && !complementarity ? `
            <div class="matching-reasons" style="padding: 8px; background: #f8f9fa; border-radius: 6px; margin: 8px 0;">
                ${reasons.slice(0, 2).map(reason => `<small style="display: block; font-size: 11px; color: #666; margin: 2px 0;">${escapeHtml(reason)}</small>`).join('')}
            </div>
        ` : '';
        
        return `
            <div class="matching-card enhanced" data-user-id="${userId}" data-profile-id="${userId}" style="position: relative;">
                <div class="matching-score">${matchScore != null ? matchScore + '%' : '--'}</div>
                ${user.picture_url ? 
                    `<img src="${sanitizeImageUrl(user.picture_url)}" alt="${escapeHtml(user.name)}" class="matching-avatar">` :
                    `<div class="matching-avatar-placeholder">
                        <i class="fas fa-user"></i>
                    </div>`
                }
                <h3>${escapeHtml(user.name || '名前未設定')}</h3>
                <p class="matching-title">${escapeHtml(user.position || '役職未設定')}</p>
                <p class="matching-company">${escapeHtml(user.company || '会社名未設定')}</p>
                
                <!-- 補完性スコア表示（新規追加） -->
                ${complementarityHTML}
                
                <!-- マッチング理由（補完性がない場合のみ） -->
                ${reasonsHTML}
                
                <div class="matching-tags">
                    ${skills.slice(0, 3).map(skill => `<span class="tag">${escapeHtml(skill)}</span>`).join('')}
                    ${skills.length > 3 ? `<span class="tag">+${skills.length - 3}</span>` : ''}
                </div>
                
                <!-- レーダーチャート -->
                <div class="matching-radar">
                    <canvas id="radar-${safeCanvasId}" width="260" height="260" data-original-user-id="${userId}"></canvas>
                </div>
                
                <div class="matching-actions">
                    <button class="btn btn-outline view-profile-btn btn-view override-btn-secondary" data-user-id="${userId}" data-profile-id="${userId}">
                        <i class="fas fa-user"></i> 詳細を見る
                    </button>
                    ${renderConnectButton(userId, user.connectionStatus)}
                </div>
                <button class="bookmark-btn" data-user-id="${userId}">
                    <i class="far fa-bookmark"></i>
                </button>
            </div>
        `;
        } catch (error) {
            console.error('[MatchingUnified] カード生成エラー:', error, user);
            return '';
        }
    }

    // カード内のイベントリスナー設定
    // イベントリスナーの設定フラグ
    let eventListenersSetup = false;
    
    function setupCardEventListeners() {
        console.error('[MatchingUnified] setupCardEventListeners呼び出し');
        
        // 既にイベントリスナーが設定されている場合はスキップ
        if (eventListenersSetup) {
            console.error('[MatchingUnified] イベントリスナーは既に設定済みです');
            return;
        }
        
        // イベントリスナーが設定済みであることをマーク
        eventListenersSetup = true;
        
        // プロフィール表示ボタン - イベント委譲を使用（一度だけ設定）
        console.error('[MatchingUnified] クリックイベントリスナーを登録');
        document.addEventListener('click', handleCardClick);
    }
    
    // カード内のクリックイベントを一元管理
    function handleCardClick(e) {
        console.error('[MatchingUnified] handleCardClick呼び出し:', {
            target: e.target,
            targetClass: e.target.className,
            targetTag: e.target.tagName
        });
        
        // プロフィール表示ボタン（btn-view, override-btn-secondary, view-profile-btnのすべてに対応）
        const profileBtn = e.target.closest('.view-profile-btn, .btn-view, .override-btn-secondary');
        if (profileBtn) {
            console.error('[MatchingUnified] プロフィールボタンクリック検出:', {
                profileBtn: profileBtn,
                userId: profileBtn.dataset.userId,
                profileId: profileBtn.dataset.profileId
            });
            
            // profile-detail-modal.jsも動作させるため、preventDefaultとstopPropagationを削除
            // e.preventDefault(); // 削除
            // e.stopPropagation(); // 削除
            
            // 連続クリック防止
            if (profileBtn.dataset.processing === 'true') {
                console.error('[MatchingUnified] 連続クリック防止');
                return;
            }
            profileBtn.dataset.processing = 'true';
            
            const userId = profileBtn.dataset.userId || profileBtn.dataset.profileId;
            console.error('[MatchingUnified] userId取得:', userId);
            
            if (userId) {
                console.error('[MatchingUnified] showUserProfile呼び出し前');
                // profile-detail-modal.jsが優先されるので、フォールバックとして動作
                // ProfileDetailModalが存在しない場合のみ実行
                if (!window.profileDetailModal) {
                    showUserProfile(userId);
                } else {
                    console.error('[MatchingUnified] ProfileDetailModalが存在するため、そちらに処理を委譲');
                }
                // 1秒後にフラグをリセット
                setTimeout(() => {
                    profileBtn.dataset.processing = 'false';
                }, 1000);
            }
            return;
        }
        
        // コネクトボタン
        const connectBtn = e.target.closest('.connect-btn');
        if (connectBtn && !connectBtn.dataset.listenerAttached) {
            e.preventDefault();
            e.stopPropagation();
            connectBtn.dataset.listenerAttached = 'true';
            const userId = connectBtn.dataset.userId;
            if (userId) {
                sendConnectRequest(userId);
            }
            return;
        }
        
        // ブックマークボタン
        const bookmarkBtn = e.target.closest('.bookmark-btn');
        if (bookmarkBtn && !bookmarkBtn.dataset.listenerAttached) {
            bookmarkBtn.dataset.listenerAttached = 'true';
            const userId = bookmarkBtn.dataset.userId;
            toggleBookmark(userId, bookmarkBtn);
            return;
        }
    }

    // ProfileDetailModalの読み込みを待機する関数
    async function waitForProfileModal(maxAttempts = 10) {
        for (let i = 0; i < maxAttempts; i++) {
            if (window.profileDetailModal && window.profileDetailModal.show) {
                return true;
            }
            // 100ms待機
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
    }

    // プロフィール詳細表示
    async function showUserProfile(userId) {
        console.error('[MatchingUnified] showUserProfile呼び出し:', userId);
        try {
            // プロフィール閲覧履歴を記録
            await recordProfileView(userId);

            // ProfileDetailModalの読み込みを待機（最大1秒）
            const modalAvailable = await waitForProfileModal();
            
            if (modalAvailable && window.profileDetailModal) {
                // ProfileDetailModalを使用（高機能版）
                await window.profileDetailModal.show(userId);
            } else {
                // フォールバック: 従来のモーダル表示
                const { data: users, error } = await window.supabaseClient
                    .from('user_profiles')
                    .select('*');
                
                if (error) {
                    console.error('[MatchingUnified] ユーザー取得エラー:', error);
                    showToast('ユーザー情報の取得に失敗しました', 'error');
                    return;
                }
                
                // idでフィルタリング（user_profilesテーブルではidカラムを使用）
                const user = users.find(u => u.id === userId);
                if (!user) {
                    console.error('[MatchingUnified] ユーザーが見つかりません:', userId);
                    showToast('ユーザーが見つかりません', 'error');
                    return;
                }

                // モーダルで表示
                showProfileModal(user);
            }

        } catch (error) {
            console.error('[MatchingUnified] プロフィール表示エラー:', error);
            showError('プロフィールの読み込みに失敗しました');
        }
    }

    // プロフィールモーダル表示
    function showProfileModal(user) {
        // 既存のモーダルがあれば削除
        const existingModal = document.querySelector('.profile-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        const modal = document.createElement('div');
        modal.className = 'modal profile-modal';
        modal.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content">
                <div class="modal-header">
                    <h2>プロフィール詳細</h2>
                    <button class="modal-close">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="profile-header">
                        ${user.picture_url ? 
                            `<img src="${sanitizeImageUrl(user.picture_url)}" alt="${escapeHtml(user.name)}" class="profile-avatar">` :
                            `<div class="profile-avatar-placeholder">
                                <i class="fas fa-user"></i>
                            </div>`
                        }
                        <div class="profile-info">
                            <h3>${escapeHtml(user.name || '名前未設定')}</h3>
                            <p class="profile-title">${escapeHtml(user.position || '')} @ ${escapeHtml(user.company || '')}</p>
                            ${user.email ? `<p class="profile-email"><i class="fas fa-envelope"></i> ${escapeHtml(user.email)}</p>` : ''}
                            ${user.phone ? `<p class="profile-phone"><i class="fas fa-phone"></i> ${escapeHtml(user.phone)}</p>` : ''}
                            ${user.line_id ? `<p class="profile-line"><i class="fab fa-line"></i> ${escapeHtml(user.line_id)}</p>` : ''}
                        </div>
                    </div>
                    
                    ${user.bio ? `
                        <div class="profile-section">
                            <h4>自己紹介</h4>
                            <p>${escapeHtml(user.bio)}</p>
                        </div>
                    ` : ''}
                    
                    ${user.skills && user.skills.length > 0 ? `
                        <div class="profile-section">
                            <h4>スキル・専門分野</h4>
                            <div class="tags-container">
                                ${user.skills.map(skill => `<span class="tag">${escapeHtml(skill)}</span>`).join('')}
                            </div>
                        </div>
                    ` : ''}
                    
                    ${user.interests && user.interests.length > 0 ? `
                        <div class="profile-section">
                            <h4>興味・関心</h4>
                            <div class="tags-container">
                                ${user.interests.map(interest => `<span class="tag">${escapeHtml(interest)}</span>`).join('')}
                            </div>
                        </div>
                    ` : ''}
                    
                    ${user.business_challenges && user.business_challenges.length > 0 ? `
                        <div class="profile-section">
                            <h4>ビジネス課題</h4>
                            <ul class="challenges-list">
                                ${user.business_challenges.map(challenge => `<li>${escapeHtml(challenge)}</li>`).join('')}
                            </ul>
                        </div>
                    ` : ''}
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary">閉じる</button>
                    <button class="btn btn-primary" data-user-id="${user.id}">
                        <i class="fas fa-link"></i> コネクト申請
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        
        // イベントハンドラーの設定
        // 閉じるボタン
        modal.querySelector('.modal-close').addEventListener('click', () => {
            modal.remove();
        });
        
        // 二次閉じるボタン
        modal.querySelector('.btn-secondary').addEventListener('click', () => {
            modal.remove();
        });
        
        // コネクト申請ボタン
        modal.querySelector('.btn-primary').addEventListener('click', (e) => {
            const userId = e.target.dataset.userId;
            sendConnectRequest(userId);
            modal.remove();
        });
        
        // 背景クリックで閉じる
        modal.querySelector('.modal-overlay').addEventListener('click', () => {
            modal.remove();
        });
        
        // ESCキーで閉じる
        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                modal.remove();
                document.removeEventListener('keydown', handleEsc);
            }
        };
        document.addEventListener('keydown', handleEsc);
    }

    // コネクト申請送信（強化版）
    async function sendConnectRequest(recipientId, button = null) {
        try {
            // console.log('[MatchingUnified] コネクト申請送信:', recipientId);
            
            // ボタンをローディング状態に
            let originalText = '';
            if (button) {
                originalText = button.innerHTML;
                button.disabled = true;
                button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 送信中...';
            }
            
            // 既存のコネクトを確認（シンプルなクエリに変更）
            const { data: allConnections } = await window.supabaseClient
                .from('connections')
                .select('*');
                
            // JavaScriptでフィルタリング
            const existingConnection = allConnections ? allConnections.find(conn =>
                (conn.user_id === currentUserId && conn.connected_user_id === recipientId) ||
                (conn.user_id === recipientId && conn.connected_user_id === currentUserId)
            ) : null;
            
            // エラーハンドリングを簡素化
            if (!allConnections) {
                console.error('[MatchingUnified] コネクションデータの取得に失敗');
            }

            if (existingConnection) {
                if (existingConnection.status === 'pending') {
                    showInfo('既にコネクト申請が送信されています');
                } else if (existingConnection.status === 'accepted') {
                    showInfo('既にコネクト済みです');
                }
                return;
            }

            // メッセージ入力モーダルを表示
            const message = await showMessageModal();
            if (message === null) return; // キャンセル

            // コネクト申請を作成
            const { error: insertError } = await window.supabaseClient
                .from('connections')
                .insert({
                    user_id: currentUserId,
                    connected_user_id: recipientId,
                    status: 'pending'
                });

            if (insertError) {
                console.error('[MatchingUnified] コネクト申請エラー:', insertError);
                showToast('コネクト申請の送信に失敗しました', 'error');
                return;
            }

            // 通知を送信
            await sendNotification(
                recipientId, 
                'connect_request', 
                '新しいコネクト申請', 
                message || 'コネクト申請が届いています',
                currentUserId,
                'connection'
            );

            // アクティビティを記録
            await recordActivity('connect_request', 'コネクト申請を送信しました', recipientId);

            // UIを更新
            updateConnectButton(recipientId, 'pending');
            showSuccess('コネクト申請を送信しました');

        } catch (error) {
            console.error('[MatchingUnified] コネクト申請エラー:', error);
            showError('コネクト申請の送信に失敗しました');
        }
    }

    // メッセージ入力モーダル
    function showMessageModal() {
        return new Promise((resolve) => {
            // 既存のモーダルがあれば削除
            const existingModal = document.querySelector('.message-modal');
            if (existingModal) {
                existingModal.remove();
            }
            
            const modal = document.createElement('div');
            modal.className = 'modal message-modal';
            modal.innerHTML = `
                <div class="modal-content compact">
                    <div class="modal-header">
                        <h3>コネクト申請メッセージ</h3>
                        <button class="modal-close">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <p>相手に送るメッセージを入力してください（任意）</p>
                        <textarea id="connect-message" rows="4" placeholder="はじめまして。ぜひコネクトさせていただければと思います。"></textarea>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary">キャンセル</button>
                        <button class="btn btn-primary" id="send-connect-btn">送信</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // イベントリスナー（once: trueで重複防止）
            modal.querySelector('#send-connect-btn').addEventListener('click', () => {
                const message = modal.querySelector('#connect-message').value.trim();
                modal.remove();
                resolve(message);
            }, { once: true });

            modal.querySelector('.modal-close').addEventListener('click', () => {
                modal.remove();
                resolve(null);
            }, { once: true });
            
            modal.querySelector('.btn-secondary').addEventListener('click', () => {
                modal.remove();
                resolve(null);
            }, { once: true });
        });
    }

    // プロフィール閲覧履歴の記録（削除済み - profile_viewsテーブルは使用しない）
    async function recordProfileView(viewedUserId) {
        // profile_viewsテーブルは存在しないため、この機能は無効化
        return;
    }

    // ブックマーク切り替え
    async function toggleBookmark(userId, buttonElement) {
        try {
            const isBookmarked = buttonElement.querySelector('i').classList.contains('fas');

            if (isBookmarked) {
                // ブックマーク削除
                const { error } = await window.supabaseClient
                    .from('bookmarks')
                    .delete()
                    .eq('user_id', currentUserId)
                    .eq('bookmarked_user_id', userId);

                if (error) {
                    console.error('[MatchingUnified] ブックマーク解除エラー:', error);
                    showToast('ブックマークの解除に失敗しました', 'error');
                    return;
                }

                buttonElement.querySelector('i').classList.remove('fas');
                buttonElement.querySelector('i').classList.add('far');
                showInfo('ブックマークを解除しました');

            } else {
                // ブックマーク追加
                const { error } = await window.supabaseClient
                    .from('bookmarks')
                    .insert({
                        user_id: currentUserId,
                        bookmarked_user_id: userId
                    });

                if (error) {
                    console.error('[MatchingUnified] ブックマーク追加エラー:', error);
                    showToast('ブックマークの追加に失敗しました', 'error');
                    return;
                }

                buttonElement.querySelector('i').classList.remove('far');
                buttonElement.querySelector('i').classList.add('fas');
                showSuccess('ブックマークに追加しました');
            }

        } catch (error) {
            console.error('[MatchingUnified] ブックマークエラー:', error);
            showError('ブックマークの更新に失敗しました');
        }
    }

    // フィルタリング（検索機能を含む拡張版）
    function filterUsers(users) {
        return users.filter(user => {
            // キーワード検索フィルター（名前、会社名、スキル、地域などで検索）
            if (filters.search && filters.search !== '') {
                const searchTerm = filters.search;
                const searchableFields = [
                    user.name?.toLowerCase() || '',
                    user.company?.toLowerCase() || '',
                    user.position?.toLowerCase() || '',
                    user.location?.toLowerCase() || '',
                    user.industry?.toLowerCase() || '',
                    user.bio?.toLowerCase() || '',
                    ...(user.skills || []).map(s => s.toLowerCase()),
                    ...(user.interests || []).map(i => i.toLowerCase())
                ].join(' ');
                
                if (!searchableFields.includes(searchTerm)) {
                    return false;
                }
            }
            
            // 業界フィルター
            if (filters.industry && filters.industry !== '') {
                // 業界の値をマッピング
                const industryMap = {
                    'tech': 'IT・テクノロジー',
                    'finance': '金融',
                    'healthcare': '医療・ヘルスケア',
                    'retail': '小売・流通'
                };
                const filterIndustry = industryMap[filters.industry] || filters.industry;
                if (user.industry !== filterIndustry && user.industry !== filters.industry) {
                    return false;
                }
            }

            // 地域フィルター
            if (filters.location && filters.location !== '') {
                // 地域の値をマッピング
                const locationMap = {
                    'tokyo': '東京',
                    'osaka': '大阪',
                    'nagoya': '名古屋',
                    'fukuoka': '福岡'
                };
                const filterLocation = locationMap[filters.location] || filters.location;
                if (user.location !== filterLocation && user.location !== filters.location) {
                    return false;
                }
            }

            // 興味・関心フィルター
            if (filters.interest && filters.interest !== '') {
                // 興味の値をマッピング
                const interestMap = {
                    'collaboration': '協業',
                    'investment': '投資',
                    'mentoring': 'メンタリング',
                    'networking': 'ネットワーキング'
                };
                const filterInterest = interestMap[filters.interest] || filters.interest;
                
                // user.interestsの配列にfilterInterestが含まれているかチェック
                if (user.interests && Array.isArray(user.interests)) {
                    const hasInterest = user.interests.some(interest => 
                        interest === filterInterest || interest === filters.interest
                    );
                    if (!hasInterest) return false;
                } else {
                    return false; // interestsがない場合は除外
                }
            }

            // スキルフィルター
            if (filters.skills.length > 0 && user.skills) {
                const hasSkill = filters.skills.some(skill => 
                    user.skills.includes(skill)
                );
                if (!hasSkill) return false;
            }

            // 興味フィルター（複数選択）
            if (filters.interests.length > 0 && user.interests) {
                const hasInterest = filters.interests.some(interest => 
                    user.interests.includes(interest)
                );
                if (!hasInterest) return false;
            }

            return true;
        });
    }

    // ソート
    function sortUsers(users) {
        const sorted = [...users];

        switch (filters.sortBy) {
            case 'score':
                sorted.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
                break;
            case 'newest':
                sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                break;
            case 'active':
                sorted.sort((a, b) => new Date(b.last_login_at) - new Date(a.last_login_at));
                break;
        }

        return sorted;
    }

    // フィルター更新
    function updateFilters() {
        // ページを1ページ目にリセット
        currentPage = 1;
        displayMatchingUsers();
    }

    // 検索処理（拡張版）
    function handleSearch() {
        // 検索フィールドからキーワードを取得
        const searchInput = document.getElementById('matching-search-input');
        if (searchInput) {
            filters.search = searchInput.value.toLowerCase().trim();
        }
        
        // フィルター設定を保存
        saveFiltersToStorage();
        
        // ページを1ページ目にリセット
        currentPage = 1;
        displayMatchingUsers();
    }

    // 結果カウント更新（拡張版）
    function updateResultsCount(count) {
        const countElement = document.querySelector('.results-count');
        if (countElement) {
            // 検索キーワードがある場合は検索結果として表示
            const searchInput = document.getElementById('matching-search-input');
            const searchTerm = searchInput?.value || '';
            
            if (searchTerm) {
                countElement.innerHTML = `<i class="fas fa-search"></i> "${window.escapeHTML(searchTerm)}" の検索結果: ${count}件`;
            } else {
                countElement.textContent = `${count}件のマッチング候補`;
            }
        }
    }

    // ページネーションボタンのハンドラー（グローバルに定義して再利用）
    function handlePrevPage() {
        if (currentPage > 1) {
            currentPage--;
            displayMatchingUsers();
            window.scrollTo({ top: 0, behavior: 'smooth' }); // スクロール位置をトップに
        }
    }

    function handleNextPage(totalPages) {
        if (currentPage < totalPages) {
            currentPage++;
            displayMatchingUsers();
            window.scrollTo({ top: 0, behavior: 'smooth' }); // スクロール位置をトップに
        }
    }

    // ページネーションUI更新
    function updatePagination(totalItems) {
        const pagination = document.querySelector('.pagination');
        if (!pagination) return;

        const totalPages = Math.ceil(totalItems / itemsPerPage);
        
        // 前へボタン
        const prevBtn = pagination.querySelector('.btn-outline:first-child');
        if (prevBtn) {
            prevBtn.disabled = currentPage <= 1;
            // removeEventListenerで既存のイベントをクリア
            const newPrevBtn = prevBtn.cloneNode(true);
            prevBtn.parentNode.replaceChild(newPrevBtn, prevBtn);
            newPrevBtn.addEventListener('click', handlePrevPage);
        }

        // 次へボタン
        const nextBtn = pagination.querySelector('.btn-outline:last-child');
        if (nextBtn) {
            nextBtn.disabled = currentPage >= totalPages;
            // removeEventListenerで既存のイベントをクリア
            const newNextBtn = nextBtn.cloneNode(true);
            nextBtn.parentNode.replaceChild(newNextBtn, nextBtn);
            newNextBtn.addEventListener('click', () => handleNextPage(totalPages));
        }

        // ページ番号
        const pageNumbers = pagination.querySelector('.page-numbers');
        if (pageNumbers) {
            pageNumbers.innerHTML = '';
            
            // 表示するページ番号の範囲を計算
            let startPage = Math.max(1, currentPage - 2);
            let endPage = Math.min(totalPages, startPage + 4);
            
            // 開始ページを調整
            if (endPage - startPage < 4) {
                startPage = Math.max(1, endPage - 4);
            }

            for (let i = startPage; i <= endPage; i++) {
                const pageBtn = document.createElement('button');
                pageBtn.className = `page-number ${i === currentPage ? 'active' : ''}`;
                pageBtn.textContent = i;
                // onclickの代わりにaddEventListenerを使用
                pageBtn.addEventListener('click', ((pageNum) => {
                    return () => {
                        currentPage = pageNum;
                        displayMatchingUsers();
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    };
                })(i));
                pageNumbers.appendChild(pageBtn);
            }
        }
    }

    // コネクトボタンの更新（重複定義のため削除 - 886行の定義を使用）
    // function updateConnectButton(userId, status) {
    //     const button = document.querySelector(`.connect-btn[data-user-id="${userId}"]`);
    //     if (!button) return;

    //     switch (status) {
    //         case 'pending':
    //             button.textContent = '申請中';
    //             button.disabled = true;
    //             button.classList.add('btn-disabled');
    //             break;
    //         case 'accepted':
    //             button.textContent = 'コネクト済み';
    //             button.disabled = true;
    //             button.classList.add('btn-success');
    //             break;
    //     }
    // }

    // 通知送信
    async function sendNotification(userId, type, title, content, relatedId = null, relatedType = null) {
        try {
            // console.log('[MatchingUnified] 通知送信:', { userId, type, title });
            
            const { error } = await window.supabaseClient
                .from('notifications')
                .insert({
                    user_id: userId,
                    type: type,
                    title: title,
                    message: content,
                    data: { category: 'matching', icon: 'fas fa-user-plus', related_id: relatedId, related_type: relatedType },
                    is_read: false
                });

            if (error) {
                console.error('[MatchingUnified] 通知送信エラー:', error);
                // 通知送信失敗はサイレントに処理（UIの流れを止めない）
            }
            // console.log('[MatchingUnified] 通知送信成功');
            
        } catch (error) {
            console.error('[MatchingUnified] 通知送信エラー:', error);
        }
    }

    // アクティビティを記録
    async function recordActivity(type, title, relatedUserId = null) {
        try {
            const { error } = await window.supabaseClient
                .from('activities')
                .insert({
                    type: type,
                    title: title,
                    user_id: currentUserId,
                    related_user_id: relatedUserId
                });

            if (error) {
                console.error('[MatchingUnified] アクティビティ記録エラー:', error);
                // アクティビティ記録失敗はサイレントに処理（UIの流れを止めない）
            }
            // console.log('[MatchingUnified] アクティビティ記録成功');
            
        } catch (error) {
            console.error('[MatchingUnified] アクティビティ記録エラー:', error);
        }
    }

    // コネクトボタンの状態を更新
    function updateConnectButton(userId, status) {
        const buttons = document.querySelectorAll(`.connect-btn[data-user-id="${userId}"]`);
        buttons.forEach(button => {
            if (status === 'pending') {
                button.disabled = true;
                // XSS対策: DOM操作で安全に挿入
                button.innerHTML = '';
                const clockIcon = document.createElement('i');
                clockIcon.className = 'fas fa-clock';
                button.appendChild(clockIcon);
                button.appendChild(document.createTextNode(' 申請中'));
                button.classList.remove('btn-primary');
                button.classList.add('btn-secondary');
            } else if (status === 'accepted') {
                button.disabled = true;
                // XSS対策: DOM操作で安全に挿入
                button.innerHTML = '';
                const checkIcon = document.createElement('i');
                checkIcon.className = 'fas fa-check';
                button.appendChild(checkIcon);
                button.appendChild(document.createTextNode(' コネクト済み'));
                button.classList.remove('btn-primary');
                button.classList.add('btn-success');
            }
        });
    }

    // ユーティリティ関数
    function escapeHtml(text) {
        if (!text) return '';
        const escapeMap = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
            '/': '&#x2F;'
        };
        return String(text).replace(/[&<>"'\/]/g, char => escapeMap[char]);
    }
    
    // ユーザーIDから一貫したスコアを生成（再描画でも同じ値）
    function generateConsistentScore(userId) {
        if (!userId) return 75;
        
        // userIdから疑似ランダムな値を生成（常に同じIDは同じ値）
        let hash = 0;
        for (let i = 0; i < userId.length; i++) {
            const char = userId.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        
        // 70-100の範囲に収める
        const score = 70 + (Math.abs(hash) % 31);
        return score;
    }
    
    // 画像URLのサニタイズ（XSS対策）
    function sanitizeImageUrl(url) {
        if (!url) return '';
        
        // javascript:, data:, vbscript: などの危険なスキームをブロック
        const dangerousSchemes = ['javascript:', 'data:', 'vbscript:', 'file:', 'about:'];
        const lowerUrl = url.toLowerCase().trim();
        
        for (const scheme of dangerousSchemes) {
            if (lowerUrl.startsWith(scheme)) {
                console.warn('[MatchingUnified] 危険なURLスキームをブロック:', scheme);
                return ''; // 安全なデフォルト画像URLまたは空文字を返す
            }
        }
        
        // 相対URLまたはhttps/httpのみ許可
        if (lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://') || lowerUrl.startsWith('/')) {
            return url;
        }
        
        // その他の場合は相対URLとして扱う
        return url;
    }

    function showSuccess(message) {
        showToast(message, 'success');
    }

    function showError(message) {
        showToast(message, 'error');
    }

    function showInfo(message) {
        showToast(message, 'info');
    }
    
    // ログイン要求メッセージを表示
    function showLoginRequired() {
        const container = document.getElementById('matching-container');
        if (container) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-lock"></i>
                    <h3>ログインが必要です</h3>
                    <p>マッチング機能を利用するにはログインしてください</p>
                    <a href="login.html" class="btn btn-primary">ログインページへ</a>
                </div>
            `;
        }
    }
    
    // エラーメッセージを表示
    function showErrorMessage(message) {
        const container = document.getElementById('matching-container');
        if (container) {
            container.innerHTML = '';
            const errorDiv = document.createElement('div');
            errorDiv.className = 'empty-state';
            
            const icon = document.createElement('i');
            icon.className = 'fas fa-exclamation-triangle';
            
            const heading = document.createElement('h3');
            heading.textContent = 'エラーが発生しました';
            
            const paragraph = document.createElement('p');
            paragraph.textContent = message;
            
            errorDiv.appendChild(icon);
            errorDiv.appendChild(heading);
            errorDiv.appendChild(paragraph);
            container.appendChild(errorDiv);
        }
    }

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        // XSS対策: innerHTMLではなくDOM操作で要素を構築
        const icon = document.createElement('i');
        icon.className = `fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}`;
        
        const span = document.createElement('span');
        span.textContent = message; // textContentで安全にテキストを設定
        
        toast.appendChild(icon);
        toast.appendChild(span);
        document.body.appendChild(toast);

        setManagedTimeout(() => toast.classList.add('show'), 100);
        setManagedTimeout(() => {
            toast.classList.remove('show');
            setManagedTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // 経験スコアを計算（実データベース）
    function calculateExperienceScore(user) {
        let score = 15; // 基準スコア（より差別化のため低めに設定）
        
        // 役職・肩書きによる加点（title フィールドを使用）
        if (user.position) {
            const titleText = user.position || '';
            // 役職レベルをより細かく評価（ユーザーごとの差別化）
            const titleLower = titleText.toLowerCase();
            
            // タイトルの長さと内容でハッシュ値を生成（個別化）
            let titleHash = 0;
            for (let i = 0; i < titleText.length; i++) {
                titleHash = ((titleHash << 5) - titleHash) + titleText.charCodeAt(i);
                titleHash = titleHash & titleHash;
            }
            const variation = (Math.abs(titleHash) % 10) / 10; // 0～0.9の範囲
            
            if (titleLower.includes('founder') || titleLower.includes('創業')) {
                score += 40 + variation * 5;
            } else if (titleLower.includes('ceo') || titleLower.includes('代表取締役')) {
                score += 38 + variation * 4;
            } else if (titleLower.includes('社長')) {
                score += 36 + variation * 4;
            } else if (titleLower.includes('cto') || titleLower.includes('cfo') || titleLower.includes('coo')) {
                score += 34 + variation * 3;
            } else if (titleLower.includes('執行役員') || titleLower.includes('取締役')) {
                score += 32 + variation * 3;
            } else if (titleLower.includes('vp') || titleLower.includes('vice president')) {
                score += 30 + variation * 3;
            } else if (titleLower.includes('director') || titleLower.includes('部長')) {
                score += 25 + variation * 2;
            } else if (titleLower.includes('manager') || titleLower.includes('マネージャー')) {
                score += 20 + variation * 2;
            } else if (titleLower.includes('課長')) {
                score += 18 + variation * 2;
            } else if (titleLower.includes('lead') || titleLower.includes('リーダー')) {
                score += 15 + variation * 2;
            } else if (titleLower.includes('主任') || titleLower.includes('チーフ')) {
                score += 12 + variation;
            } else if (titleLower.includes('senior') || titleLower.includes('シニア')) {
                score += 10 + variation;
            } else if (titleLower.includes('specialist') || titleLower.includes('スペシャリスト')) {
                score += 8 + variation;
            } else if (titleText.length > 0) {
                score += 5 + variation; // 何らかの役職がある
            }
        }
        
        // スキルの深さによる加点（より細分化）
        if (user.skills && Array.isArray(user.skills)) {
            const skillCount = user.skills.length;
            if (skillCount >= 15) {
                score += 25; // マスターレベル
            } else if (skillCount >= 12) {
                score += 22;
            } else if (skillCount >= 10) {
                score += 20; // エキスパートレベル
            } else if (skillCount >= 8) {
                score += 17;
            } else if (skillCount >= 7) {
                score += 15;
            } else if (skillCount >= 6) {
                score += 13;
            } else if (skillCount >= 5) {
                score += 11;
            } else if (skillCount >= 4) {
                score += 9;
            } else if (skillCount >= 3) {
                score += 7;
            } else if (skillCount >= 2) {
                score += 5;
            } else if (skillCount >= 1) {
                score += 3;
            }
        }
        
        // 会社情報による加点（実務経験の証）
        if (user.company && user.company.length > 10) {
            score += 10; // 詳細な会社情報
        } else if (user.company && user.company.length > 0) {
            score += 5;
        }
        
        // プロフィール完成度ボーナス
        if (user.bio && user.bio.length > 50) {
            score += 5;
        }
        
        // 複合評価（役職と会社の両方がある）
        if (user.position && user.company) {
            score += 5; // 信頼性ボーナス
        }
        
        return Math.min(score, 100);
    }
    
    // 活動スコアを計算（実データベース）
    function calculateActivityScore(user) {
        let score = 40; // 基準スコア
        
        // プロフィール完成度による加点（最大30点）
        let completionScore = 0;
        
        // bio の充実度
        if (user.bio) {
            if (user.bio.length > 100) {
                completionScore += 15;
            } else if (user.bio.length > 50) {
                completionScore += 10;
            } else if (user.bio.length > 0) {
                completionScore += 5;
            }
        }
        
        // プロフィール画像
        if (user.picture_url || user.avatar_url) {
            completionScore += 10;
        }
        
        // 連絡先情報の充実度
        if (user.phone || user.line_id) {
            completionScore += 5;
        }
        
        score += completionScore;
        
        // データの充実度による加点（最大30点）
        let dataScore = 0;
        
        // スキルの充実度
        if (user.skills && Array.isArray(user.skills)) {
            if (user.skills.length >= 5) {
                dataScore += 15;
            } else if (user.skills.length >= 3) {
                dataScore += 10;
            } else if (user.skills.length > 0) {
                dataScore += 5;
            }
        }
        
        // 興味・関心の充実度
        if (user.interests && Array.isArray(user.interests)) {
            if (user.interests.length >= 4) {
                dataScore += 15;
            } else if (user.interests.length >= 2) {
                dataScore += 10;
            } else if (user.interests.length > 0) {
                dataScore += 5;
            }
        }
        
        score += dataScore;
        
        return Math.min(score, 100);
    }
    
    // 業界スコアを計算（公平版）
    function calculateIndustryScore(user) {
        if (!user.industry) return 20; // 業界未設定の基礎スコア
        
        let score = 25; // 業界設定済みの基礎スコア
        
        // 業界の種類による基本スコア（業界によって差別化）
        const industryScoreMap = {
            'IT': 15, 'テクノロジー': 15, 'Tech': 15,
            '金融': 12, 'Finance': 12, '銀行': 12,
            '医療': 14, 'ヘルスケア': 14, 'Healthcare': 14,
            '製造': 10, '小売': 8, 'Retail': 8,
            'コンサル': 13, 'Consulting': 13,
            '不動産': 9, 'Real Estate': 9,
            'メディア': 11, 'Media': 11,
            '教育': 7, 'Education': 7
        };
        
        // 業界固有のスコアを加算
        let industryBonus = 5; // デフォルト
        for (const [key, value] of Object.entries(industryScoreMap)) {
            if (user.industry.includes(key)) {
                industryBonus = Math.max(industryBonus, value);
            }
        }
        score += industryBonus;
        
        // 業界情報の詳細度による加点
        const industryLength = user.industry.length;
        if (industryLength > 20) {
            score += 25; // 非常に詳細な業界情報
        } else if (industryLength > 15) {
            score += 20; // 詳細な業界情報
        } else if (industryLength > 8) {
            score += 15; // 標準的な業界情報
        } else if (industryLength > 0) {
            score += 10; // 簡潔な業界情報
        }
        
        // 業界経験の深さを評価（役職との相関）
        if (user.industry && user.position) {
            const titleText = (user.position || '').toLowerCase();
            if (titleText.includes('ceo') || titleText.includes('cto') || titleText.includes('cfo') || 
                titleText.includes('代表') || titleText.includes('社長') || titleText.includes('執行役員')) {
                score += 25; // 業界のトップリーダー
            } else if (titleText.includes('director') || titleText.includes('部長') || titleText.includes('manager')) {
                score += 18; // 業界の中堅リーダー
            } else if (titleText.includes('lead') || titleText.includes('主任') || titleText.includes('リーダー')) {
                score += 12; // 業界のチームリーダー
            } else if (titleText.length > 0) {
                score += 8; // 業界の実務者
            }
        }
        
        // 業界に関連するスキルの深さ
        if (user.industry && user.skills && Array.isArray(user.skills)) {
            const skillCount = user.skills.length;
            if (skillCount >= 10) {
                score += 20; // 業界マスター
            } else if (skillCount >= 7) {
                score += 15; // 業界エキスパート
            } else if (skillCount >= 5) {
                score += 10; // 業界スペシャリスト
            } else if (skillCount >= 3) {
                score += 5; // 業界プロフェッショナル
            }
        }
        
        return Math.min(score, 100);
    }
    
    // 地域スコアを計算（公平版）
    function calculateLocationScore(user) {
        if (!user.location) return 20; // 地域未設定の基礎スコア
        
        let score = 30; // 地域設定済みの基礎スコア
        
        // 地域情報の詳細度による加点（より差別化）
        const locationLength = user.location.length;
        if (locationLength > 15) {
            score += 40; // 非常に詳細な地域情報（例：東京都渋谷区神宮前）
        } else if (locationLength > 10) {
            score += 30; // 詳細な地域情報（例：東京都渋谷区）
        } else if (locationLength > 5) {
            score += 20; // 標準的な地域情報（例：東京都）
        } else if (locationLength > 0) {
            score += 10; // 簡潔な地域情報（例：東京）
        }
        
        // 地域の特性による加点（主要都市かどうか）
        const majorCities = ['東京', '大阪', '名古屋', '福岡', '札幌', '横浜', '神戸', '京都'];
        if (majorCities.some(city => user.location.includes(city))) {
            score += 15; // 主要都市ボーナス
        }
        
        // プロフィール充実度との相関
        if (user.location && user.company) {
            score += 15; // 地域と会社の両方が設定されている
        }
        
        // ビジネス活動の広がりを評価
        if (user.location && user.skills && user.skills.length > 5) {
            score += 10; // 地域とスキルの両方が充実
        }
        
        return Math.min(score, 100);
    }

    // スキルスコアを計算（質的評価）
    function calculateSkillScore(user) {
        if (!user.skills || !Array.isArray(user.skills) || user.skills.length === 0) {
            return 30; // スキル未設定の基礎スコア
        }
        
        let score = 40; // スキル設定済みの基礎スコア
        
        // スキルの数による段階的評価（最大30点）
        const skillCount = user.skills.length;
        if (skillCount >= 7) {
            score += 30; // 豊富なスキルセット
        } else if (skillCount >= 5) {
            score += 25;
        } else if (skillCount >= 3) {
            score += 20;
        } else if (skillCount >= 2) {
            score += 15;
        } else if (skillCount >= 1) {
            score += 10;
        }
        
        // スキルの専門性ボーナス（最大30点）
        // 技術系、ビジネス系、クリエイティブ系など多様性を評価
        const techSkills = ['プログラミング', 'AI', 'データ分析', 'システム設計', 'DX'];
        const businessSkills = ['経営戦略', 'マーケティング', '営業', 'ファイナンス', 'プロジェクト管理'];
        const creativeSkills = ['デザイン', 'ライティング', '企画', 'ブランディング', 'UI/UX'];
        
        let hasSpecialization = false;
        
        if (user.skills.some(skill => techSkills.some(tech => skill.includes(tech)))) {
            hasSpecialization = true;
        }
        if (user.skills.some(skill => businessSkills.some(biz => skill.includes(biz)))) {
            hasSpecialization = true;
        }
        if (user.skills.some(skill => creativeSkills.some(creative => skill.includes(creative)))) {
            hasSpecialization = true;
        }
        
        if (hasSpecialization) {
            score += 30;
        }
        
        return Math.min(score, 100);
    }
    
    // 興味スコアを計算（質的評価）
    function calculateInterestScore(user) {
        if (!user.interests || !Array.isArray(user.interests) || user.interests.length === 0) {
            return 30; // 興味未設定の基礎スコア
        }
        
        let score = 40; // 興味設定済みの基礎スコア
        
        // 興味の数による段階的評価（最大30点）
        const interestCount = user.interests.length;
        if (interestCount >= 5) {
            score += 30; // 幅広い興味
        } else if (interestCount >= 4) {
            score += 25;
        } else if (interestCount >= 3) {
            score += 20;
        } else if (interestCount >= 2) {
            score += 15;
        } else if (interestCount >= 1) {
            score += 10;
        }
        
        // 興味の多様性ボーナス（最大30点）
        // ビジネス、テクノロジー、社会貢献など幅広い関心を評価
        const hasBusinessInterest = user.interests.some(interest => 
            interest.includes('ビジネス') || interest.includes('経営') || interest.includes('起業')
        );
        const hasTechInterest = user.interests.some(interest => 
            interest.includes('AI') || interest.includes('DX') || interest.includes('テクノロジー')
        );
        const hasSocialInterest = user.interests.some(interest => 
            interest.includes('SDGs') || interest.includes('社会') || interest.includes('環境')
        );
        
        const diversityCount = [hasBusinessInterest, hasTechInterest, hasSocialInterest].filter(Boolean).length;
        score += diversityCount * 10;
        
        return Math.min(score, 100);
    }
    
    // 計算関数をグローバルに追加公開
    window.matchingScoreFix.calculateExperienceScore = calculateExperienceScore;
    window.matchingScoreFix.calculateActivityScore = calculateActivityScore;
    window.matchingScoreFix.calculateIndustryScore = calculateIndustryScore;
    window.matchingScoreFix.calculateLocationScore = calculateLocationScore;
    window.matchingScoreFix.calculateSkillScore = calculateSkillScore;
    window.matchingScoreFix.calculateInterestScore = calculateInterestScore;
    window.matchingScoreFix.calculateSkillChallengeMatch = calculateSkillChallengeMatch;
    window.matchingScoreFix.calculateSkillQuality = calculateSkillQuality;
    window.matchingScoreFix.calculateLearningOpportunity = calculateLearningOpportunity;

    // レーダーチャートを描画（拡張版：削除されたファイルから復元）
    function drawRadarChartForUser(user) {
        const userId = user.id;
        // Canvas用のIDを安全にエスケープ（同じロジックを使用）
        const safeCanvasId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
        // console.log('[MatchingUnified] レーダーチャート描画開始:', userId);
        const canvas = document.getElementById(`radar-${safeCanvasId}`);
        
        // data-original-user-idから正しいユーザーデータを取得（修正1）
        if (canvas && canvas.dataset.originalUserId) {
            const correctUserId = canvas.dataset.originalUserId;
            const correctUser = matchingUsers.find(u => u.id === correctUserId);
            if (correctUser) {
                user = correctUser; // 正しいユーザーデータで上書き
                // console.log('[MatchingUnified] data-original-user-idから正しいユーザーを取得:', correctUser.name);
            }
        }
        if (!canvas) {
            // 再試行回数を制限（無限ループ防止）
            let retryCount = canvasRetryCount.get(user) || 0;
            if (retryCount >= 3) {
                console.error('[MatchingUnified] Canvas要素が見つかりません（最大試行回数到達）:', `radar-${safeCanvasId}`);
                canvasRetryCount.delete(user); // メモリリーク防止
                return;
            }
            
            retryCount++;
            canvasRetryCount.set(user, retryCount);
            // console.log('[MatchingUnified] Canvas要素再試行:', retryCount, '回目');
            
            // 再試行
            setManagedTimeout(() => {
                const retryCanvas = document.getElementById(`radar-${safeCanvasId}`);
                if (retryCanvas) {
                    // console.log('[MatchingUnified] Canvas要素が見つかりました（再試行）');
                    drawRadarChartForUser(user);
                }
            }, 500);
            return;
        }
        
        // Canvas要素が見つかったら再試行カウントをクリア
        if (canvasRetryCount.has(user)) {
            canvasRetryCount.delete(user);
        }
        
        // 既に描画済みの場合でも、ユーザーIDが異なる場合は再描画（修正2）
        if (canvas.dataset.rendered === 'true' && canvas.dataset.renderedUserId === userId) {
            // console.log('[MatchingUnified] レーダーチャート既に描画済み（同じユーザー）:', safeCanvasId);
            return;
        }
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            console.error('[MatchingUnified] Canvas 2Dコンテキストの取得に失敗');
            return;
        }
        // console.log('[MatchingUnified] Canvas取得成功:', canvas.width, 'x', canvas.height);
        
        // 描画状態を保存
        ctx.save();
        
        // Retina/高DPIディスプレイ対応
        const dpr = window.devicePixelRatio || 1;
        
        // Canvas表示サイズを統一（profile-detail-modalと同じ260pxに）
        const displayWidth = 260;  // profile-detail-modalと統一
        const displayHeight = 260; // profile-detail-modalと統一
        
        // Canvasの実際のピクセルサイズを高DPI対応
        canvas.width = displayWidth * dpr;
        canvas.height = displayHeight * dpr;
        
        // CSSで表示サイズを設定
        canvas.style.width = displayWidth + 'px';
        canvas.style.height = displayHeight + 'px';
        
        // 描画コンテキストをスケール
        ctx.scale(dpr, dpr);
        
        // 描画用の座標（表示サイズベース）
        const centerX = displayWidth / 2;
        const centerY = displayHeight / 2;
        // 元のコード: const radius = Math.min(displayWidth, displayHeight) * 0.4;
        const radius = 100;  // profile-detail-modalと統一（固定値100px）
        const sides = 6;
        
        // クリア（実際のcanvasサイズでクリア - 修正4）
        ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
        
        // 背景色を設定（profile-detail-modalと統一）
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, displayWidth, displayHeight);
        
        // 背景の六角形グリッドを描画
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 1;
        
        // 5段階のグリッド
        for (let i = 1; i <= 5; i++) {
            ctx.beginPath();
            for (let j = 0; j <= sides; j++) {
                const angle = (Math.PI * 2 / sides) * j - Math.PI / 2;
                const x = centerX + Math.cos(angle) * (radius * i / 5);
                const y = centerY + Math.sin(angle) * (radius * i / 5);
                if (j === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.closePath();
            ctx.stroke();
        }
        
        // 軸線を描画
        ctx.strokeStyle = '#d0d0d0';
        for (let i = 0; i < sides; i++) {
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            const angle = (Math.PI * 2 / sides) * i - Math.PI / 2;
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;
            ctx.lineTo(x, y);
            ctx.stroke();
        }
        
        // ラベル
        const labels = ['スキル', '経験', '業界', '地域', '活動', '興味'];
        ctx.fillStyle = '#666';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        labels.forEach((label, i) => {
            const angle = (Math.PI * 2 / sides) * i - Math.PI / 2;
            const x = centerX + Math.cos(angle) * (radius + 20);  // profile-detail-modalと統一（+20）
            const y = centerY + Math.sin(angle) * (radius + 20);  // profile-detail-modalと統一（+20）
            ctx.fillText(label, x, y);
        });
        
        // データポイントを計算（質的評価を重視）
        const values = [
            calculateSkillScore(user), // スキル（質的評価：最大100点）
            calculateExperienceScore(user), // 経験（実データ：最大100点）
            calculateIndustryScore(user), // 業界（公平スコア：最大100点）
            calculateLocationScore(user), // 地域（公平スコア：最大100点）
            calculateActivityScore(user), // 活動（実データ：最大100点）
            calculateInterestScore(user) // 興味（質的評価：最大100点）
        ];
        
        // デバッグ用：各ユーザーのスコアを確認
        // console.log(`[RadarChart] ${user.name || 'Unknown'}のスコア:`, {
        //     name: user.name,
        //     position: user.position,
        //     position: user.position,
        //     skills: user.skills?.length || 0,
        //     スキル: values[0],
        //     経験: values[1],
        //     業界: values[2],
        //     地域: values[3],
        //     活動: values[4],
        //     興味: values[5]
        // });
        
        // データポリゴンを描画
        ctx.fillStyle = 'rgba(74, 144, 226, 0.3)';
        ctx.strokeStyle = '#4a90e2';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        values.forEach((value, i) => {
            const angle = (Math.PI * 2 / sides) * i - Math.PI / 2;
            const x = centerX + Math.cos(angle) * (radius * value / 100);
            const y = centerY + Math.sin(angle) * (radius * value / 100);
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        // データポイントを描画
        ctx.fillStyle = '#4a90e2';
        values.forEach((value, i) => {
            const angle = (Math.PI * 2 / sides) * i - Math.PI / 2;
            const x = centerX + Math.cos(angle) * (radius * value / 100);
            const y = centerY + Math.sin(angle) * (radius * value / 100);
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
        });
        
        // 描画状態を復元
        ctx.restore();
        
        // アクセシビリティ属性を追加（削除されたファイルから復元）
        // labelsは既に上で宣言済み
        const description = values.map((value, index) => 
            `${labels[index]}: ${Math.round(value)}%`
        ).join(', ');
        
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `レーダーチャート: ${description}`);
        canvas.setAttribute('tabindex', '0');
        
        // 描画完了フラグとユーザーIDを設定（修正2）
        canvas.dataset.rendered = 'true';
        canvas.dataset.renderedUserId = userId;
        
        // console.log('[MatchingUnified] レーダーチャート描画完了:', userId);
        // console.log('[MatchingUnified] Canvas表示状態:', {
        //     userId: userId,
        //     visible: canvasRect.width > 0 && canvasRect.height > 0,
        //     width: canvasRect.width,
        //     height: canvasRect.height,
        //     display: window.getComputedStyle(canvas).display,
        //     visibility: window.getComputedStyle(canvas).visibility
        // });
    }

    // ダミーデータを表示
    function displayDummyData() {
        // console.log('[MatchingUnified] ダミーデータを表示します');
        const dummyUsers = [
            {
                id: 'dummy1',
                name: 'りゅう',
                title: 'プロダクトマネージャー',
                position: 'シニアプロダクトマネージャー',
                company: '株式会社イノベーションテック',
                skills: ['プロジェクト管理', 'アジャイル開発', 'プロダクトマネジメント', 
                        'UI/UXデザイン', 'データ分析', 'SQL', 'Python', 
                        'マーケティング戦略', 'KPI設計', 'チームビルディング'],
                interests: ['プロダクト開発', 'スタートアップ', 'テクノロジートレンド', 
                           'デザイン思考', 'イノベーション'],
                industry: 'IT・テクノロジー・SaaS・プロダクト開発',
                location: '東京都渋谷区神宮前1-2-3',
                bio: 'プロダクトマネジメントに10年以上携わり、BtoBおよびBtoCの両方で成功を収めてきました。',
                business_challenges: ['プロダクトの成長戦略', 'ユーザー体験の改善', 'チーム生産性の向上']
            },
            {
                id: 'dummy2',
                name: 'guest',
                title: null,
                position: 'インターン',
                company: 'スタートアップA',
                skills: ['Excel', 'PowerPoint'],
                interests: ['ビジネス'],
                industry: '小売',
                location: '大阪',
                bio: '現在インターンとして勉強中です。',
                business_challenges: ['経験を積みたい']
            },
            {
                id: 'dummy3',
                name: '田中 太郎',
                position: 'エンジニア',
                company: 'テック株式会社',
                skills: ['プログラミング', 'AI', 'データ分析'],
                interests: ['AI', '機械学習'],
                industry: 'IT',
                location: '東京'
            },
            {
                id: 'dummy4',
                name: '山田 花子',
                position: 'デザイナー',
                company: 'クリエイティブ社',
                skills: ['UI/UX', 'グラフィックデザイン', 'ブランディング'],
                interests: ['デザイン', 'アート'],
                industry: 'デザイン',
                location: '大阪'
            },
            {
                id: 'dummy5',
                name: '佐藤 次郎',
                position: 'マーケター',
                company: 'マーケティング株式会社',
                skills: ['デジタルマーケティング', 'SEO', 'コンテンツ制作'],
                interests: ['マーケティング', 'グロース'],
                industry: 'マーケティング',
                location: '名古屋'
            },
            {
                id: 'dummy6',
                name: '鈴木 美咲',
                position: 'コンサルタント',
                company: 'コンサルティングファーム',
                skills: ['戦略立案', '事業開発', 'プロジェクト管理'],
                interests: ['ビジネス戦略', 'イノベーション'],
                industry: 'コンサルティング',
                location: '福岡'
            }
        ];

        matchingUsers = dummyUsers;
        // console.log('[MatchingUnified] ダミーユーザー数:', dummyUsers.length);
        displayMatchingUsers();
    }

    // 初期化実行（Supabase初期化を待つ）
    console.log('[MatchingUnified] 初期化判定開始:', {
        readyState: document.readyState,
        timestamp: new Date().toISOString(),
        hasSupabaseClient: !!window.supabaseClient,
        hasWaitForSupabase: !!window.waitForSupabase
    });
    
    if (document.readyState === 'loading') {
        console.log('[MatchingUnified] DOMContentLoadedイベントを待機');
        document.addEventListener('DOMContentLoaded', () => {
            // Supabase初期化完了を待つ
            console.log('[MatchingUnified] DOM読み込み完了、初期化を実行');
            setTimeout(() => {
                initialize();
            }, 500); // 他のスクリプトの初期化を待つ
        });
    } else {
        // 既にDOMが読み込まれている場合
        console.log('[MatchingUnified] DOM既に準備完了、初期化を実行');
        setTimeout(() => {
            initialize();
        }, 500); // 他のスクリプトの初期化を待つ
    }
    
    // AIスコアリング機能（削除されたファイルから復元）
    async function calculateAIScore(userId, targetUserId) {
        try {
            // ユーザーデータを取得
            const [userProfile, targetProfile] = await Promise.all([
                getUserProfile(userId),
                getUserProfile(targetUserId)
            ]);

            if (!userProfile || !targetProfile) {
                return { score: 50, breakdown: {} };
            }

            // 話題の類似性を計算（Jaccard係数）
            const topicScore = calculateTopicSimilarity(userProfile, targetProfile);
            
            // スキルマッチング
            const skillScore = calculateSkillMatch(userProfile, targetProfile);
            
            // 業界・地域の一致度
            const industryScore = userProfile.industry === targetProfile.industry ? 80 : 30;
            const locationScore = userProfile.location === targetProfile.location ? 80 : 30;
            
            // 総合スコア計算（重み付け）
            const finalScore = (
                topicScore * 0.3 +
                skillScore * 0.3 +
                industryScore * 0.2 +
                locationScore * 0.2
            );

            return {
                score: Math.round(finalScore),
                breakdown: {
                    topics: topicScore,
                    skills: skillScore,
                    industry: industryScore,
                    location: locationScore
                }
            };
        } catch (error) {
            console.error('[AIScoring] エラー:', error);
            return { score: 50, breakdown: {} };
        }
    }

    // 話題の類似性計算
    function calculateTopicSimilarity(user1, user2) {
        const interests1 = new Set(user1.interests || []);
        const interests2 = new Set(user2.interests || []);
        
        if (interests1.size === 0 || interests2.size === 0) return 50;
        
        const intersection = [...interests1].filter(x => interests2.has(x));
        const union = new Set([...interests1, ...interests2]);
        
        // Jaccard係数
        return Math.round((intersection.length / union.size) * 100);
    }

    // スキルマッチング計算
    function calculateSkillMatch(user1, user2) {
        const skills1 = new Set(user1.skills || []);
        const skills2 = new Set(user2.skills || []);
        
        if (skills1.size === 0 || skills2.size === 0) return 50;
        
        const commonSkills = [...skills1].filter(x => skills2.has(x));
        const complementaryScore = (skills1.size + skills2.size - commonSkills.length) / 
                                  (skills1.size + skills2.size);
        
        return Math.round(complementaryScore * 100);
    }

    // ユーザープロファイル取得
    async function getUserProfile(userId) {
        try {
            const { data, error } = await window.supabaseClient
                .from('user_profiles')
                .select('*')
                .eq('id', userId)
                .maybeSingle();
            
            return error ? null : data;
        } catch {
            return null;
        }
    }

    // グローバルに関数を公開（他のスクリプトから呼び出せるように）
        // グローバル公開は最小限に
        window.drawRadarChartForUser = drawRadarChartForUser;
        
        // ページアンロード時にタイマーをクリーンアップ
        window.addEventListener('beforeunload', () => {
            clearAllTimers();
        });
        
        // console.log('[MatchingUnified] スクリプト実行完了');
        
        } catch (error) {
            console.error('[MatchingUnified] スクリプト実行エラー:', error);
            console.error('[MatchingUnified] エラースタック:', error.stack);
        }
    } // initializeMatchingSystem終了

})();

// ============================================================
// Section: matching-filter-reset.js
// ============================================================

/**
 * マッチングフィルターリセット機能
 * 削除されたmatching-ux-improvements.jsから復元
 */

(function() {
    'use strict';
    
    // フィルターリセットボタンを追加
    function addResetButton() {
        const filtersContainer = document.querySelector('.matching-filters');
        if (!filtersContainer) return;
        
        // 既存のリセットボタンがあれば削除
        const existingReset = filtersContainer.querySelector('.filter-reset-wrapper');
        if (existingReset) existingReset.remove();
        
        const resetWrapper = document.createElement('div');
        resetWrapper.className = 'filter-reset-wrapper';
        resetWrapper.style.cssText = `
            display: inline-flex;
            align-items: center;
            gap: 10px;
            margin-left: auto;
        `;
        
        resetWrapper.innerHTML = `
            <button class="btn-reset" style="
                background: #e74c3c;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 8px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 14px;
                transition: all 0.3s ease;
            " onmouseover="this.style.background='#c0392b'" 
               onmouseout="this.style.background='#e74c3c'"
               onclick="window.resetMatchingFilters()">
                <i class="fas fa-redo"></i>
                フィルターをリセット
            </button>
            <div class="active-filters-display" id="activeFiltersDisplay" style="
                display: flex;
                gap: 5px;
                flex-wrap: wrap;
            "></div>
        `;
        
        filtersContainer.appendChild(resetWrapper);
    }
    
    // フィルターリセット機能
    window.resetMatchingFilters = function() {
        // セレクトボックスをリセット
        const selects = document.querySelectorAll('.matching-filters select');
        selects.forEach(select => {
            select.value = '';
            // changeイベントを手動で発火
            const event = new Event('change', { bubbles: true });
            select.dispatchEvent(event);
        });
        
        // 検索ボックスをリセット
        const searchInputs = document.querySelectorAll('.matching-filters input[type="text"], .matching-filters input[type="search"]');
        searchInputs.forEach(input => {
            input.value = '';
            const event = new Event('input', { bubbles: true });
            input.dispatchEvent(event);
        });
        
        // LocalStorageのフィルター設定をクリア
        localStorage.removeItem('matchingFilters');
        
        // アクティブフィルター表示を更新
        updateActiveFiltersDisplay();
        
        // フィルターボタンをクリック（再検索）
        const searchBtn = document.querySelector('.matching-filters .btn-primary');
        if (searchBtn) {
            searchBtn.click();
        }
        
        // トースト通知
        if (window.showToast) {
            window.showToast('フィルターをリセットしました', 'info');
        }
    };
    
    // アクティブなフィルターを表示
    function updateActiveFiltersDisplay() {
        const display = document.getElementById('activeFiltersDisplay');
        if (!display) return;
        
        const activeFilters = [];
        
        // セレクトボックスの値を確認
        document.querySelectorAll('.matching-filters select').forEach(select => {
            if (select.value && select.value !== '') {
                const label = select.previousElementSibling?.textContent || select.name;
                const option = select.options[select.selectedIndex];
                activeFilters.push({
                    label: label,
                    value: option.textContent,
                    element: select
                });
            }
        });
        
        // 検索ボックスの値を確認
        document.querySelectorAll('.matching-filters input[type="text"], .matching-filters input[type="search"]').forEach(input => {
            if (input.value && input.value !== '') {
                activeFilters.push({
                    label: '検索',
                    value: input.value,
                    element: input
                });
            }
        });
        
        // 表示を更新
        if (activeFilters.length > 0) {
            display.innerHTML = activeFilters.map(filter => `
                <span class="active-filter-tag" style="
                    background: #3498db;
                    color: white;
                    padding: 4px 8px;
                    border-radius: 12px;
                    font-size: 12px;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                ">
                    ${window.escapeHTML(filter.label)}: ${window.escapeHTML(filter.value)}
                    <button onclick="window.removeFilter(this, '${window.escapeAttr(filter.element.name || filter.element.id)}')" style="
                        background: none;
                        border: none;
                        color: white;
                        cursor: pointer;
                        padding: 0;
                        margin-left: 4px;
                        font-size: 14px;
                        line-height: 1;
                    ">×</button>
                </span>
            `).join('');
            display.style.display = 'flex';
        } else {
            display.innerHTML = '';
            display.style.display = 'none';
        }
    }
    
    // 個別フィルター削除
    window.removeFilter = function(button, elementIdentifier) {
        const element = document.querySelector(`[name="${elementIdentifier}"], #${elementIdentifier}`);
        if (element) {
            if (element.tagName === 'SELECT') {
                element.value = '';
            } else if (element.tagName === 'INPUT') {
                element.value = '';
            }
            
            // changeイベントを発火
            const event = new Event('change', { bubbles: true });
            element.dispatchEvent(event);
            
            // 再検索
            const searchBtn = document.querySelector('.matching-filters .btn-primary');
            if (searchBtn) {
                searchBtn.click();
            }
        }
        
        // 表示を更新
        updateActiveFiltersDisplay();
    };
    
    // フィルター変更を監視
    function setupFilterMonitoring() {
        const filtersContainer = document.querySelector('.matching-filters');
        if (!filtersContainer) return;
        
        // セレクトボックスの変更を監視
        filtersContainer.addEventListener('change', (e) => {
            if (e.target.tagName === 'SELECT') {
                updateActiveFiltersDisplay();
            }
        });
        
        // 入力フィールドの変更を監視
        filtersContainer.addEventListener('input', (e) => {
            if (e.target.tagName === 'INPUT') {
                updateActiveFiltersDisplay();
            }
        });
    }
    
    // 初期化
    function init() {
        // DOMContentLoadedで実行
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(() => {
                    addResetButton();
                    setupFilterMonitoring();
                    updateActiveFiltersDisplay();
                }, 500);
            });
        } else {
            setTimeout(() => {
                addResetButton();
                setupFilterMonitoring();
                updateActiveFiltersDisplay();
            }, 500);
        }
    }
    
    init();
    
})();

// ============================================================
// Section: matching-realtime-updates.js
// ============================================================

/**
 * マッチングリアルタイム更新機能
 * 新しいユーザーが登録された際にリアルタイムで更新
 */

(function() {
    'use strict';
    
    let realtimeSubscription = null;
    
    async function setupRealtimeUpdates() {
        // Supabaseの準備を待つ
        if (!window.supabaseClient) {
            setTimeout(setupRealtimeUpdates, 500);
            return;
        }
        
        try {
            // 既存のサブスクリプションをクリーンアップ
            if (realtimeSubscription) {
                await realtimeSubscription.unsubscribe();
            }
            
            // プロファイル更新をリアルタイムで監視
            realtimeSubscription = window.supabaseClient
                .channel('matching-profiles')
                .on('postgres_changes', {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'user_profiles'
                }, (payload) => {
                    handleProfileUpdate(payload);
                })
                .subscribe();
                
            // console.log('[MatchingRealtime] リアルタイム更新を開始しました');
            
        } catch (error) {
            console.error('[MatchingRealtime] セットアップエラー:', error);
        }
    }
    
    function handleProfileUpdate(payload) {
        const newProfile = payload.new;

        // matching.html でのみ表示更新
        if (!window.location.pathname.includes('matching')) return;
        if (!newProfile) return;

        updateProfileInList(newProfile);
    }
    
    // 既存カード内のテキストのみ更新（カード構造を保持）
    function updateProfileInList(profile) {
        const card = document.querySelector('[data-profile-id="' + profile.id + '"]');
        if (!card) return;

        // 名前（h3 直下）
        var h3 = card.querySelector('h3');
        if (h3) h3.textContent = profile.name || profile.full_name || h3.textContent;

        // 役職
        var titleEl = card.querySelector('.matching-title');
        if (titleEl && profile.position) titleEl.textContent = profile.position;

        // 会社
        var companyEl = card.querySelector('.matching-company');
        if (companyEl && profile.company) companyEl.textContent = profile.company;

        // アバター
        var imgEl = card.querySelector('.matching-avatar');
        if (imgEl && profile.picture_url) imgEl.src = profile.picture_url;
    }

    // アニメーションCSS追加
    function addAnimationStyles() {
        if (document.getElementById('realtime-animations')) return;
        
        const style = document.createElement('style');
        style.id = 'realtime-animations';
        style.textContent = `
            @keyframes slideInRight {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            
            @keyframes slideOutRight {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }
            
            @keyframes fadeInScale {
                from {
                    opacity: 0;
                    transform: scale(0.9);
                }
                to {
                    opacity: 1;
                    transform: scale(1);
                }
            }
            
            @keyframes fadeOutScale {
                from {
                    opacity: 1;
                    transform: scale(1);
                }
                to {
                    opacity: 0;
                    transform: scale(0.9);
                }
            }
            
            @keyframes pulse {
                0%, 100% {
                    transform: scale(1);
                }
                50% {
                    transform: scale(1.02);
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    // クリーンアップ（beforeunloadの方がブラウザ互換性が高い）
    window.addEventListener('beforeunload', () => {
        if (realtimeSubscription) {
            realtimeSubscription.unsubscribe();
            realtimeSubscription = null;
        }
    });
    
    // 初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            addAnimationStyles();
            setupRealtimeUpdates();
        });
    } else {
        addAnimationStyles();
        setupRealtimeUpdates();
    }
    
})();

// ============================================================
// Section: profile-modal-priority.js
// ============================================================

/**
 * プロフィールモーダル優先制御
 * profile-detail-modal.jsのイベントハンドラを優先させる
 */

(function() {
    'use strict';
    
    // DOMContentLoadedの後で実行
    function setupModalPriority() {
        // matching-unified.jsのイベントと共存させる（置き換えない）
        const container = document.getElementById('matching-container');
        if (container) {
            // 既存のイベントリスナーは残したまま、優先度の高いリスナーを追加
            container.addEventListener('click', function(e) {
                // プロフィールボタンの場合、処理を続行させる
                // stopImmediatePropagationを削除して、他のイベントハンドラーも動作するようにする
                if (e.target.classList.contains('view-profile-btn') || 
                    e.target.closest('.view-profile-btn') ||
                    e.target.classList.contains('btn-profile') ||
                    e.target.closest('.btn-profile') ||
                    e.target.classList.contains('btn-view') ||
                    e.target.closest('.btn-view')) {
                    // 何もせず、イベントを通過させる
                    // 両方のハンドラー（matching-unified.jsとprofile-detail-modal.js）を動作させる
                    return;
                }
            }, true); // キャプチャフェーズで実行（優先度を上げる）
        }
        
        // ProfileDetailModalが確実に初期化されるまで待つ
        let retryCount = 0;
        const checkModal = setInterval(() => {
            if (window.profileDetailModal) {
                clearInterval(checkModal);
                // console.log('[ProfileModalPriority] ProfileDetailModalが初期化されました');
                
                // グローバル関数として公開（互換性のため）
                window.showProfileModal = async function(userId) {
                    if (window.profileDetailModal && window.profileDetailModal.show) {
                        await window.profileDetailModal.show(userId);
                    }
                };
            } else if (retryCount++ > 50) {
                clearInterval(checkModal);
                console.warn('[ProfileModalPriority] ProfileDetailModalの初期化タイムアウト');
            }
        }, 100);
    }
    
    // ページ読み込み完了後に実行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupModalPriority);
    } else {
        // 既に読み込み済みの場合は少し遅延させて実行
        setTimeout(setupModalPriority, 100);
    }
    
})();

