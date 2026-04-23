/**
 * Guest Mode Manager
 * ゲストログイン時にデモデータを表示する管理システム
 */

(function() {
    'use strict';

    // 二重初期化ガード
    if (window.GuestModeManager) return;

    // === デモデータ定義 ===
    const now = new Date().toISOString();
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const lastWeek = new Date(Date.now() - 7 * 86400000).toISOString();
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString();
    const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString();

    const DEMO_DATA = {
        user_profiles: [
            {
                id: 'guest-user', member_id: 'IC-00000', email: 'guest@interconnect.jp',
                name: 'ゲストユーザー', full_name: 'ゲストユーザー',
                company: 'サンプル株式会社', position: '代表取締役',
                industry: 'IT・テクノロジー', avatar_url: 'assets/user-placeholder.svg',
                picture_url: null, cover_url: null,
                bio: 'ゲストモードで閲覧中です。アカウント登録すると全機能をご利用いただけます。',
                skills: ['経営', 'マネジメント'], interests: ['AI', 'DX'],
                business_challenges: { challenges: [], challenges_detail: '' },
                budget_range: null,
                location: '東京都', phone: null, line_id: null,
                is_online: true, is_active: true, is_admin: false,
                connection_count: 2,
                last_login_at: now, created_at: now, updated_at: now
            },
            {
                id: 'demo-user-1', member_id: 'IC-00001', email: 'yamada@example.com',
                name: '山田 太郎', full_name: '山田 太郎',
                company: '株式会社テックイノベーション', position: '代表取締役CEO',
                industry: 'IT・テクノロジー', avatar_url: 'assets/user-placeholder.svg',
                picture_url: null, cover_url: null,
                bio: 'DX推進とAI技術を活用した新規事業開発に注力しています。スタートアップ支援にも積極的に取り組んでいます。',
                skills: ['AI', 'DX', 'IoT', '新規事業開発'],
                interests: ['AI・機械学習', 'ブロックチェーン', 'サステナビリティ'],
                business_challenges: { challenges: ['新規事業開発', 'DX推進'], challenges_detail: '' },
                budget_range: '100万円〜500万円',
                location: '東京都渋谷区', phone: '03-1234-5678', line_id: '@yamada_taro',
                is_online: true, is_active: true, is_admin: false,
                connection_count: 48,
                last_login_at: now, created_at: lastWeek, updated_at: now
            },
            {
                id: 'demo-user-2', member_id: 'IC-00002', email: 'sato@example.com',
                name: '佐藤 花子', full_name: '佐藤 花子',
                company: 'グローバルコマース株式会社', position: 'マーケティング部長',
                industry: '小売・EC', avatar_url: 'assets/user-placeholder.svg',
                picture_url: null, cover_url: null,
                bio: 'デジタルマーケティングとEC事業の拡大を推進。海外市場への展開も視野に入れています。',
                skills: ['マーケティング', 'EC', 'グローバル展開', 'データ分析'],
                interests: ['MarTech', 'D2C', 'クロスボーダーEC'],
                business_challenges: { challenges: ['海外展開', 'マーケティング強化'], challenges_detail: '' },
                budget_range: '50万円〜100万円',
                location: '東京都港区', phone: '03-2345-6789', line_id: '@sato_hanako',
                is_online: false, is_active: true, is_admin: false,
                connection_count: 35,
                last_login_at: yesterday, created_at: lastWeek, updated_at: yesterday
            },
            {
                id: 'demo-user-3', member_id: 'IC-00003', email: 'takahashi@example.com',
                name: '高橋 健一', full_name: '高橋 健一',
                company: 'デジタルソリューションズ', position: 'CTO',
                industry: 'IT・テクノロジー', avatar_url: 'assets/user-placeholder.svg',
                picture_url: null, cover_url: null,
                bio: 'クラウドネイティブなアーキテクチャで次世代システムを構築。セキュリティとDevOpsに精通。',
                skills: ['クラウド', 'DevOps', 'アーキテクチャ設計', 'セキュリティ'],
                interests: ['クラウドコンピューティング', 'DevOps', 'サイバーセキュリティ'],
                business_challenges: { challenges: ['技術力強化', 'セキュリティ対策'], challenges_detail: '' },
                budget_range: '100万円〜500万円',
                location: '大阪府大阪市', phone: '06-3456-7890', line_id: '@takahashi_k',
                is_online: true, is_active: true, is_admin: false,
                connection_count: 62,
                last_login_at: now, created_at: lastWeek, updated_at: now
            },
            {
                id: 'demo-user-4', member_id: 'IC-00004', email: 'tanaka@example.com',
                name: '田中 美咲', full_name: '田中 美咲',
                company: '株式会社ヘルステック', position: '取締役COO',
                industry: 'ヘルスケア', avatar_url: 'assets/user-placeholder.svg',
                picture_url: null, cover_url: null,
                bio: 'ヘルスケア×テクノロジーで医療の未来を変える。遠隔医療プラットフォームの開発をリード。',
                skills: ['ヘルスケア', '事業戦略', 'プロダクトマネジメント', '資金調達'],
                interests: ['ヘルステック', '遠隔医療', 'ウェルネス'],
                business_challenges: { challenges: ['事業拡大', '資金調達'], challenges_detail: '' },
                budget_range: '500万円以上',
                location: '東京都千代田区', phone: '03-4567-8901', line_id: '@tanaka_m',
                is_online: false, is_active: true, is_admin: false,
                connection_count: 29,
                last_login_at: yesterday, created_at: lastWeek, updated_at: yesterday
            },
            {
                id: 'demo-user-5', member_id: 'IC-00005', email: 'suzuki@example.com',
                name: '鈴木 大輔', full_name: '鈴木 大輔',
                company: 'フィンテックラボ株式会社', position: '代表取締役',
                industry: '金融・フィンテック', avatar_url: 'assets/user-placeholder.svg',
                picture_url: null, cover_url: null,
                bio: 'ブロックチェーン技術を活用した次世代金融サービスを開発。Web3領域にも注力中。',
                skills: ['フィンテック', 'ブロックチェーン', '経営戦略', '投資'],
                interests: ['Web3', 'DeFi', 'デジタル通貨'],
                business_challenges: { challenges: ['新規事業開発', '技術力強化'], challenges_detail: '' },
                budget_range: '100万円〜500万円',
                location: '東京都中央区', phone: '03-5678-9012', line_id: '@suzuki_d',
                is_online: true, is_active: true, is_admin: false,
                connection_count: 41,
                last_login_at: now, created_at: lastWeek, updated_at: now
            }
        ],

        user_points: [
            { id: 'demo-points-1', user_id: 'guest-user', available_points: 3500, total_earned: 5000, balance: 3500, pending_points: 0, referral_points_earned: 5000, referral_points_spent: 1500, created_at: lastWeek, updated_at: now }
        ],

        connections: [
            { id: 'demo-conn-1', user_id: 'guest-user', connected_user_id: 'demo-user-1', status: 'accepted', created_at: lastWeek, responded_at: lastWeek },
            { id: 'demo-conn-2', user_id: 'guest-user', connected_user_id: 'demo-user-2', status: 'accepted', created_at: lastWeek, responded_at: yesterday },
            { id: 'demo-conn-3', user_id: 'demo-user-3', connected_user_id: 'guest-user', status: 'pending', created_at: yesterday, responded_at: null }
        ],

        event_items: [
            {
                id: 'demo-event-1', title: 'AI×経営戦略セミナー2026',
                description: '最新のAI技術が経営にもたらすインパクトと、実践的な活用戦略について第一線の経営者が語ります。',
                event_date: nextWeek, start_time: '14:00', end_time: '16:00',
                event_type: 'online', location: null, online_url: 'https://zoom.us/j/example',
                price: 0, max_participants: 100, image_url: null,
                is_public: true, is_cancelled: false, organizer_id: 'demo-user-1'
            },
            {
                id: 'demo-event-2', title: 'DX推進リーダーズミートアップ',
                description: '各社のDX推進担当者が集まり、成功事例と失敗から学んだ教訓を共有するネットワーキングイベント。',
                event_date: nextMonth, start_time: '18:00', end_time: '20:30',
                event_type: 'offline', location: '東京都渋谷区 WeWork渋谷スクランブルスクエア', online_url: null,
                price: 3000, max_participants: 50, image_url: null,
                is_public: true, is_cancelled: false, organizer_id: 'demo-user-3'
            },
            {
                id: 'demo-event-3', title: 'スタートアップ資金調達ワークショップ',
                description: 'シリーズA〜Bの資金調達を成功させるための戦略とピッチ改善ワークショップ。',
                event_date: new Date(Date.now() + 14 * 86400000).toISOString(), start_time: '10:00', end_time: '12:00',
                event_type: 'online', location: null, online_url: 'https://zoom.us/j/example2',
                price: 0, max_participants: 80, image_url: null,
                is_public: true, is_cancelled: false, organizer_id: 'demo-user-5'
            }
        ],

        event_participants: [
            { id: 'demo-ep-1', event_id: 'demo-event-1', user_id: 'demo-user-1', status: 'confirmed', registration_date: lastWeek },
            { id: 'demo-ep-2', event_id: 'demo-event-1', user_id: 'demo-user-2', status: 'registered', registration_date: yesterday },
            { id: 'demo-ep-3', event_id: 'demo-event-1', user_id: 'demo-user-3', status: 'confirmed', registration_date: lastWeek },
            { id: 'demo-ep-4', event_id: 'demo-event-2', user_id: 'demo-user-1', status: 'confirmed', registration_date: yesterday },
            { id: 'demo-ep-5', event_id: 'demo-event-2', user_id: 'demo-user-4', status: 'registered', registration_date: now }
        ],

        activities: [
            { id: 'demo-act-1', user_id: 'guest-user', type: 'login', title: 'ログインしました', description: null, related_id: null, related_type: null, created_at: now },
            { id: 'demo-act-2', user_id: 'demo-user-1', type: 'event_registered', title: 'AI×経営戦略セミナー2026に参加登録', description: null, related_id: 'demo-event-1', related_type: 'event', created_at: yesterday },
            { id: 'demo-act-3', user_id: 'demo-user-2', type: 'connection_accepted', title: '山田 太郎さんとコネクト', description: null, related_id: 'demo-conn-1', related_type: 'connection', created_at: lastWeek },
            { id: 'demo-act-4', user_id: 'demo-user-3', type: 'profile_updated', title: 'プロフィールを更新', description: null, related_id: null, related_type: null, created_at: lastWeek }
        ],

        notifications: [
            { id: 'demo-notif-1', user_id: 'guest-user', type: 'connection_request', title: 'コネクトリクエスト', message: '高橋 健一さんからコネクトリクエストが届いています', link: '/connections.html', actions: null, is_read: false, created_at: yesterday },
            { id: 'demo-notif-2', user_id: 'guest-user', type: 'event_reminder', title: 'イベント参加リマインダー', message: 'AI×経営戦略セミナー2026が来週開催されます', link: '/events.html', actions: null, is_read: false, created_at: now },
            { id: 'demo-notif-3', user_id: 'guest-user', type: 'system', title: 'ようこそ', message: 'INTERCONNECTへようこそ！まずはプロフィールを充実させましょう', link: '/profile.html', actions: null, is_read: true, created_at: lastWeek }
        ],

        messages: [
            { id: 'demo-msg-1', sender_id: 'demo-user-1', receiver_id: 'guest-user', content: 'はじめまして！DXプロジェクトについてお話しできれば嬉しいです。', is_read: false, created_at: yesterday },
            { id: 'demo-msg-2', sender_id: 'demo-user-2', receiver_id: 'guest-user', content: 'マーケティング施策で何かお手伝いできることがあればご連絡ください。', is_read: true, created_at: lastWeek }
        ],

        invite_links: [
            { id: 'demo-invite-1', created_by: 'guest-user', link_code: 'DEMO-ABC123', description: 'デモ招待リンク', is_active: true, referral_count: 3, conversion_count: 2, created_at: lastWeek }
        ],

        v_referral_history: [
            { inviter_id: 'guest-user', invitee_name: '佐藤 花子', invitee_email: 'sato@example.com', status: 'accepted', sent_at: lastWeek, accepted_at: yesterday, created_at: lastWeek },
            { inviter_id: 'guest-user', invitee_name: '田中 美咲', invitee_email: 'tanaka@example.com', status: 'pending', sent_at: yesterday, accepted_at: null, created_at: yesterday }
        ],

        cashout_requests: [
            { id: 'demo-cashout-1', user_id: 'guest-user', amount: 1500, tax_amount: 153, status: 'completed', created_at: lastWeek, processed_at: yesterday }
        ],

        settings: [
            { user_id: 'guest-user', email_notifications: true, push_notifications: true, theme: 'light', language: 'ja' }
        ],

        invitations: [],
        search_history: [],
        share_activities: [],
        point_transactions: [
            { id: 'demo-pt-1', user_id: 'guest-user', points: 3000, reason: '紹介報酬（面談完了）', created_at: lastWeek },
            { id: 'demo-pt-2', user_id: 'guest-user', points: 2000, reason: '紹介報酬（面談完了）', created_at: yesterday },
            { id: 'demo-pt-3', user_id: 'guest-user', points: -1500, reason: 'ポイント換金', created_at: yesterday }
        ]
    };

    // === チェーン可能なモッククエリビルダー ===
    function createChainableMock(table) {
        const data = DEMO_DATA[table] || [];

        const result = () => ({ data: data, error: null, count: data.length });

        // 全メソッドが自分自身（chain）を返す汎用プロキシ
        const chain = {
            // 終端メソッド（Promiseを返す）
            then: (resolve) => resolve(result()),
            single:     async () => ({ data: data[0] || null, error: null }),
            maybeSingle: async () => ({ data: data[0] || null, error: null }),
            execute:    async () => ({ data: data, error: null, count: data.length }),
            csv:        async () => ({ data: '', error: null }),

            // チェーンメソッド（自身を返す）
            select:   () => chain,
            eq:       () => chain,
            neq:      () => chain,
            gt:       () => chain,
            gte:      () => chain,
            lt:       () => chain,
            lte:      () => chain,
            like:     () => chain,
            ilike:    () => chain,
            is:       () => chain,
            in:       () => chain,
            contains: () => chain,
            or:       () => chain,
            and:      () => chain,
            not:      () => chain,
            filter:   () => chain,
            match:    () => chain,
            order:    () => chain,
            limit:    () => chain,
            range:    () => chain,
            textSearch: () => chain,
            overlaps: () => chain,

            // 書き込み系（no-op）
            insert: async () => ({ data: null, error: null }),
            update: () => chain,
            upsert: async () => ({ data: null, error: null }),
            delete: () => chain,
        };

        return chain;
    }

    class GuestModeManager {
        constructor() {
            this.isGuestMode = false;
            this.init();
        }

        init() {
            this.checkGuestMode();
            if (this.isGuestMode) {
                window.INTERCONNECT_GUEST_MODE = true;
                this.setupGuestMode();
            }
        }

        checkGuestMode() {
            const guestModeFlag = sessionStorage.getItem('isGuestMode');
            const currentUser = localStorage.getItem('currentUser');

            if (guestModeFlag === 'true') {
                this.isGuestMode = true;
            } else if (currentUser) {
                try {
                    if (JSON.parse(currentUser).isGuest) {
                        this.isGuestMode = true;
                    }
                } catch (e) { /* ignore */ }
            }

            // ★5 Fix: URLパラメータ(?guest=true)でのゲストモード有効化を廃止
            // セキュリティリスク: 任意のURLでアクセスするだけで認証バイパス可能だったため
        }

        setupGuestMode() {
            // グローバルヘルパー
            window.checkGuestBlock = function() {
                if (sessionStorage.getItem('isGuestMode') === 'true') {
                    if (window.showToast) {
                        window.showToast('この機能はゲストモードでは利用できません。', 'warning');
                    } else {
                        alert('この機能はゲストモードでは利用できません。');
                    }
                    return true;
                }
                return false;
            };

            this.blockAdminAccess();
            this.blockInteractiveActions();
            this.interceptSupabaseQueries();
        }

        blockAdminAccess() {
            const currentPage = window.location.pathname.split('/').pop().replace('.html', '');
            const restrictedPages = ['admin', 'super-admin', 'settings', 'billing'];
            if (restrictedPages.includes(currentPage)) {
                if (window.showToast) { window.showToast('この機能はゲストモードでは利用できません。', 'warning'); } else { alert('この機能はゲストモードでは利用できません。'); }
                window.location.href = 'dashboard.html?guest=true';
            }
        }

        blockInteractiveActions() {
            const currentPage = window.location.pathname.split('/').pop().replace('.html', '');
            const publicPages = ['login', 'register', 'index', 'forgot-password', 'reset-password', 'line-callback', 'invite', ''];
            if (publicPages.includes(currentPage)) return;

            const setup = () => {
                const selectors = [
                    '.send-message-btn', '.connect-btn',
                    '.cashout-btn', '#cashoutBtn', '#cashout-btn', '.cashout-button',
                    '#sendMessageBtn', '#chatSendBtn',
                    '.event-register-btn', '.event-join-btn', '#eventActionBtn',
                    '.bookmark-btn',
                    '.profile-edit-btn', '#editProfileBtn',
                    '.save-profile-btn', '#saveProfileBtn', '#saveProfile'
                ];

                document.addEventListener('click', (e) => {
                    const target = e.target.closest(selectors.join(','));
                    if (target) {
                        e.preventDefault();
                        e.stopPropagation();
                        window.checkGuestBlock();
                    }
                }, true);

                const msgInput = document.querySelector('#messageInput, .message-input, .chat-input input, .chat-input textarea');
                if (msgInput) {
                    msgInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            window.checkGuestBlock();
                        }
                    }, true);
                }
            };

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', setup);
            } else {
                setup();
            }
        }

        interceptSupabaseQueries() {
            if (!window.supabaseClient) return;
            const originalFrom = window.supabaseClient.from.bind(window.supabaseClient);
            window.supabaseClient.from = (table) => {
                if (this.isGuestMode) {
                    return createChainableMock(table);
                }
                return originalFrom(table);
            };
        }
    }

    // グローバルに公開
    window.GuestModeManager = new GuestModeManager();

})();
