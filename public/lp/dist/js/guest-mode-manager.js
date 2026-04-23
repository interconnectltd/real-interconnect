/**
 * Guest Mode Manager
 * ゲストログイン時にデモデータを表示する管理システム
 */

(function() {
    'use strict';
    
    // console.log('[GuestMode] Guest Mode Manager 初期化');
    
    class GuestModeManager {
        constructor() {
            this.isGuestMode = false;
            this.init();
        }
        
        init() {
            // ゲストモードかどうかを判定
            this.checkGuestMode();
            
            // ゲストモードの場合はグローバルフラグを設定
            if (this.isGuestMode) {
                window.INTERCONNECT_GUEST_MODE = true;
                // console.log('[GuestMode] ゲストモードが有効です');
                this.setupGuestMode();
            }
        }
        
        checkGuestMode() {
            // セッションストレージからゲストモードフラグを確認
            const guestModeFlag = sessionStorage.getItem('isGuestMode');
            
            // ローカルストレージから現在のユーザー情報を確認
            const currentUser = localStorage.getItem('currentUser');
            
            if (guestModeFlag === 'true') {
                this.isGuestMode = true;
            } else if (currentUser) {
                try {
                    if (JSON.parse(currentUser).isGuest) {
                        this.isGuestMode = true;
                    }
                } catch (e) {
                    // 壊れたlocalStorageデータを無視
                }
            }
            
            // URLパラメータもチェック
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('guest') === 'true') {
                this.isGuestMode = true;
                sessionStorage.setItem('isGuestMode', 'true');
            }
        }
        
        setupGuestMode() {
            // ゲストモードでの管理者ページアクセスをブロック
            this.blockAdminAccess();

            // Supabaseのクエリをインターセプト
            this.interceptSupabaseQueries();

            // デモデータプロバイダーを設定
            this.setupDemoDataProviders();
        }

        blockAdminAccess() {
            const currentPage = window.location.pathname.split('/').pop().replace('.html', '');
            const restrictedPages = ['admin', 'super-admin', 'settings', 'billing'];

            if (restrictedPages.includes(currentPage)) {
                // ゲストユーザーは管理者ページにアクセス不可
                if (window.showToast) { window.showToast('ゲストモードではこのページにアクセスできません。', 'warning'); } else { alert('ゲストモードではこのページにアクセスできません。'); }
                window.location.href = 'dashboard.html?guest=true';
            }
        }
        
        interceptSupabaseQueries() {
            // window.supabaseが存在する場合、クエリをインターセプト
            if (window.supabaseClient) {
                const originalFrom = window.supabaseClient.from.bind(window.supabaseClient);
                
                window.supabaseClient.from = (table) => {
                    if (this.isGuestMode) {
                        // console.log(`[GuestMode] Supabaseクエリをインターセプト: ${table}`);
                        
                        // デモデータを返すモックオブジェクトを作成
                        return this.createMockQueryBuilder(table);
                    }
                    
                    return originalFrom(table);
                };
            }
        }
        
        createMockQueryBuilder(table) {
            const self = this;
            
            return {
                select: () => ({
                    eq: () => ({
                        single: async () => ({ data: self.getDemoData(table, 'single'), error: null }),
                        execute: async () => ({ data: self.getDemoData(table, 'multiple'), error: null })
                    }),
                    neq: () => ({
                        execute: async () => ({ data: self.getDemoData(table, 'multiple'), error: null })
                    }),
                    range: () => ({
                        execute: async () => ({ data: self.getDemoData(table, 'multiple'), error: null })
                    }),
                    execute: async () => ({ data: self.getDemoData(table, 'multiple'), error: null })
                }),
                insert: async () => ({ data: null, error: null }),
                update: async () => ({ data: null, error: null }),
                delete: async () => ({ data: null, error: null })
            };
        }
        
        getDemoData(table, type = 'multiple') {
            const demoData = {
                profiles: this.getDemoProfiles(),
                activities: this.getDemoActivities(),
                connections: this.getDemoConnections(),
                messages: this.getDemoMessages(),
                notifications: this.getDemoNotifications()
            };
            
            const data = demoData[table] || [];
            return type === 'single' ? data[0] || null : data;
        }
        
        getDemoProfiles() {
            return [
                {
                    id: 'demo-user-1',
                    email: 'yamada@example.com',
                    full_name: '山田 太郎',
                    company: '株式会社テックイノベーション',
                    position: '代表取締役CEO',
                    industry: 'IT・テクノロジー',
                    avatar_url: 'assets/user-placeholder.svg',
                    bio: 'DX推進とAI技術を活用した新規事業開発に注力しています。',
                    skills: ['AI', 'DX', 'IoT', '新規事業開発'],
                    interests: ['AI・機械学習', 'ブロックチェーン', 'サステナビリティ'],
                    is_online: true,
                    created_at: new Date().toISOString()
                },
                {
                    id: 'demo-user-2',
                    email: 'sato@example.com',
                    full_name: '佐藤 花子',
                    company: 'グローバルコマース株式会社',
                    position: 'マーケティング部長',
                    industry: '小売・EC',
                    avatar_url: 'assets/user-placeholder.svg',
                    bio: 'デジタルマーケティングとEC事業の拡大を推進しています。',
                    skills: ['マーケティング', 'EC', 'グローバル展開', 'データ分析'],
                    interests: ['MarTech', 'D2C', 'クロスボーダーEC'],
                    is_online: false,
                    created_at: new Date().toISOString()
                },
                {
                    id: 'demo-user-3',
                    email: 'takahashi@example.com',
                    full_name: '高橋 健一',
                    company: 'デジタルソリューションズ',
                    position: 'CTO',
                    industry: 'IT・テクノロジー',
                    avatar_url: 'assets/user-placeholder.svg',
                    bio: 'クラウドネイティブなアーキテクチャで次世代システムを構築。',
                    skills: ['クラウド', 'DevOps', 'アーキテクチャ設計', 'セキュリティ'],
                    interests: ['クラウドコンピューティング', 'DevOps', 'サイバーセキュリティ'],
                    is_online: true,
                    created_at: new Date().toISOString()
                }
            ];
        }
        
        getDemoActivities() {
            return [
                {
                    id: 'demo-activity-1',
                    type: 'event',
                    title: 'DXセミナー2024',
                    description: 'デジタルトランスフォーメーションの最新動向',
                    date: '2024-03-15',
                    participants: 45,
                    status: 'upcoming'
                },
                {
                    id: 'demo-activity-2',
                    type: 'event_completed',
                    title: 'AIビジネス活用セミナー',
                    description: 'AIを活用した業務効率化の事例紹介',
                    date: '2024-02-28',
                    participants: 68,
                    status: 'completed'
                }
            ];
        }
        
        getDemoConnections() {
            return [
                {
                    id: 'demo-conn-1',
                    requester_id: 'demo-user-1',
                    receiver_id: 'demo-user-2',
                    status: 'accepted',
                    created_at: new Date().toISOString()
                },
                {
                    id: 'demo-conn-2',
                    requester_id: 'demo-user-1',
                    receiver_id: 'demo-user-3',
                    status: 'accepted',
                    created_at: new Date().toISOString()
                }
            ];
        }
        
        getDemoMessages() {
            return [
                {
                    id: 'demo-msg-1',
                    sender_id: 'demo-user-2',
                    receiver_id: 'demo-user-1',
                    content: 'DXプロジェクトについてご相談があります。',
                    is_read: false,
                    created_at: new Date(Date.now() - 3600000).toISOString()
                }
            ];
        }
        
        getDemoNotifications() {
            return [
                {
                    id: 'demo-notif-1',
                    user_id: 'demo-user-1',
                    type: 'connection_request',
                    content: '新しいコネクションリクエストがあります',
                    is_read: false,
                    created_at: new Date().toISOString()
                }
            ];
        }
        
        setupDemoDataProviders() {
            // 各ページのデータプロバイダーを設定
            window.GuestModeDataProviders = {
                dashboard: this.getDashboardDemoData.bind(this),
                members: this.getMembersDemoData.bind(this),
                events: this.getEventsDemoData.bind(this),
                matching: this.getMatchingDemoData.bind(this)
            };
        }
        
        getDashboardDemoData() {
            return {
                stats: {
                    totalConnections: 156,
                    monthlyEvents: 15,
                    matchingSuccess: 89,
                    activeMembers: 2345
                },
                recentActivities: this.getDemoActivities(),
                upcomingEvents: this.getDemoActivities().filter(a => a.status === 'upcoming')
            };
        }
        
        getMembersDemoData() {
            return {
                members: this.getDemoProfiles(),
                totalCount: 156
            };
        }
        
        getEventsDemoData() {
            return {
                events: this.getDemoActivities(),
                totalCount: 24
            };
        }
        
        getMatchingDemoData() {
            return {
                candidates: this.getDemoProfiles().map(profile => ({
                    ...profile,
                    matchScore: Math.floor(Math.random() * 30) + 70,
                    commonInterests: ['AI', 'DX', 'イノベーション'],
                    matchReasons: ['業界が近い', 'スキルが補完的', '興味分野が一致']
                }))
            };
        }
    }
    
    // グローバルに公開
    window.GuestModeManager = new GuestModeManager();
    
})();