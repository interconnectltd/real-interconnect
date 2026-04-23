// ============================================================
// profile-bundle.js
// Page-specific bundle for profile.html
// ============================================================

// ============================================================
// Section: profile.js
// ============================================================

// Profile JavaScript
// console.log('profile.js loading started');

// 名前空間を使用してグローバル汚染を防ぐ
window.InterConnect = window.InterConnect || {};
// console.log('InterConnect namespace:', window.InterConnect);

window.InterConnect.Profile = {
    currentTab: 'about',
    profileData: null,
    isOwnProfile: true, // 自分のプロフィールかどうか
    targetUserId: null, // 表示対象のユーザーID
    currentUserId: null, // ログイン中のユーザーID
    profileCache: {}, // プロフィールデータのキャッシュ
    cacheExpiry: 5 * 60 * 1000, // 5分間のキャッシュ
    isLoading: false, // ローディング状態
    initialized: false, // 初期化済みフラグ
    
    // 初期化
    init: async function() {
        // console.log('[Profile] 初期化開始...');
        // console.log('[Profile] 現在のURL:', window.location.href);
        // console.log('[Profile] URLパラメータ:', window.location.search);
        
        // 重複初期化を防ぐ
        if (this.initialized || this.isLoading) {
            // console.log('[Profile] 既に初期化済みまたは初期化中');
            return;
        }
        
        this.isLoading = true;
        this.showLoadingState();
        
        try {
            // URLパラメータからユーザーIDを取得
            const urlParams = new URLSearchParams(window.location.search);
            const userId = urlParams.get('user');
            // console.log('[Profile] URLから取得したユーザーID:', userId);
            
            // 現在のユーザーIDを取得
            await this.getCurrentUser();
            // console.log('[Profile] 現在のユーザーID:', this.currentUserId);
        
        if (userId) {
            // userパラメータが指定されている場合
            if (userId !== this.currentUserId) {
                // 他のユーザーのプロフィール
                // console.log('[Profile] 他のユーザーのプロフィールを表示:', userId);
                this.isOwnProfile = false;
                this.targetUserId = userId;
                await this.loadOtherUserProfile(userId);
            } else {
                // 自分のプロフィール（userパラメータで指定された場合）
                // console.log('[Profile] 自分のプロフィールを表示 (userパラメータ指定)');
                this.isOwnProfile = true;
                this.targetUserId = this.currentUserId;
                await this.loadProfileData();
            }
        } else {
            // userパラメータがない場合は自分のプロフィール
            // console.log('[Profile] 自分のプロフィールを表示 (デフォルト)');
            this.isOwnProfile = true;
            this.targetUserId = this.currentUserId;
            await this.loadProfileData();
        }
        
            // UIの初期化
            this.updateUIMode();
            this.initializeTabs();
            this.initializeEditModal();
            
            this.initialized = true;
        } finally {
            this.isLoading = false;
            this.hideLoadingState();
        }
    },
    
    // 現在のユーザー情報を取得
    getCurrentUser: async function() {
        try {
            if (window.supabaseClient || window.supabase) {
                const client = window.supabaseClient || window.supabase;
                // authが存在するか確認
                if (client && client.auth && typeof client.auth.getUser === 'function') {
                    const { data, error } = await client.auth.getUser();
                    const user = data?.user;
                    if (user) {
                        this.currentUserId = user.id;
                        // console.log('[Profile] 現在のユーザーID:', this.currentUserId);
                        return;
                    }
                } else {
                    console.warn('[Profile] Supabase auth not available, using localStorage');
                }
            }
            
            // フォールバック: localStorageから取得
            const userStr = localStorage.getItem('user');
            if (userStr) {
                const userData = JSON.parse(userStr);
                this.currentUserId = userData.id;
            }
        } catch (error) {
            console.error('[Profile] ユーザー情報取得エラー:', error);
        }
    },
    
    // 他のユーザーのプロフィールを読み込む
    loadOtherUserProfile: async function(userId) {
        // console.log('[Profile] loadOtherUserProfile開始:', userId);
        try {
            // SQLインジェクション対策：UUIDの検証
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(userId)) {
                console.error('[Profile] 無効なユーザーID:', userId);
                this.showError('無効なユーザーIDです');
                return;
            }
            
            // キャッシュをチェック
            const cached = this.getFromCache(userId);
            if (cached) {
                // console.log('[Profile] キャッシュからデータを使用:', userId);
                this.profileData = cached;
                await this.checkConnectionStatus(userId);
                this.updateProfileInfo();
                return;
            }
            
            const client = window.supabaseClient || window.supabase;
            if (!client || typeof client.from !== 'function') {
                console.error('[Profile] Supabaseが初期化されていません');
                // フォールバック：localStorageから基本情報を取得
                this.showFallbackProfile(userId);
                return;
            }
            
            // user_profilesテーブルから他のユーザー情報を取得（公開情報のみ）
            const { data, error } = await client
                .from('user_profiles')
                .select(`
                    id,
                    name,
                    full_name,
                    email,
                    company,
                    position,
                    avatar_url,
                    industry,
                    skills,
                    bio,
                    is_online,
                    last_login_at
                `)
                .eq('id', userId)
                .eq('is_active', true)
                .maybeSingle();
            
            if (error) {
                console.error('[Profile] プロフィール取得エラー:', error);
                console.error('[Profile] エラー詳細:', {
                    message: error.message,
                    details: error.details,
                    hint: error.hint,
                    code: error.code
                });
                this.showError('ユーザーが見つかりません');
                return;
            }
            
            if (!data) {
                this.showError('ユーザーが見つかりません');
                return;
            }
            
            // console.log('[Profile] 他のユーザーデータ:', data);
            
            // プロフィールデータを設定
            this.profileData = {
                id: data.id,
                name: data.full_name || data.name || 'ユーザー',
                email: data.email,
                company: data.company || '未設定',
                position: data.position || '未設定',
                title: data.position || '役職未設定', // titleカラムは存在しないのでpositionを使用
                profileImage: data.avatar_url || 'assets/user-placeholder.svg',
                industry: data.industry || '未設定',
                skills: data.skills || [],
                bio: data.bio || '',
                connectionCount: 0, // 後で別途取得
                isOnline: data.is_online || false,
                lastLoginAt: data.last_login_at
            };
            
            // コネクション数を別途取得
            await this.loadConnectionCount(userId);
            
            // キャッシュに保存
            this.saveToCache(userId, this.profileData);
            
            // コネクションステータスを確認
            await this.checkConnectionStatus(userId);
            
            // UIを更新
            this.updateProfileInfo();
            
        } catch (error) {
            console.error('[Profile] プロフィール読み込みエラー:', error);
            this.showError('プロフィールの読み込みに失敗しました');
        }
    },
    
    // コネクション数を取得
    loadConnectionCount: async function(userId) {
        try {
            if (!window.supabaseClient) return;
            
            const { data, error } = await window.supabaseClient
                .from('connections')
                .select('id')
                .or(`user_id.eq.${userId},connected_user_id.eq.${userId}`)
                .eq('status', 'accepted');
            
            if (!error && data) {
                this.profileData.connectionCount = data.length;
                // console.log('[Profile] コネクション数:', data.length);
            }
        } catch (error) {
            console.error('[Profile] コネクション数取得エラー:', error);
        }
    },
    
    // コネクションステータスを確認
    checkConnectionStatus: async function(userId) {
        try {
            if (!window.supabaseClient || !this.currentUserId) return;
            
            const { data } = await window.supabaseClient
                .from('connections')
                .select('status')
                .or(`user_id.eq.${this.currentUserId},connected_user_id.eq.${this.currentUserId}`)
                .eq('user_id', userId)
                .eq('connected_user_id', userId)
                .maybeSingle();
            
            if (data) {
                this.connectionStatus = data.status;
                // console.log('[Profile] コネクションステータス:', this.connectionStatus);
            }
        } catch (error) {
            // console.log('[Profile] コネクションステータス確認エラー:', error);
        }
    },
    
    // プロフィールデータの読み込み（自分用）
    loadProfileData: async function() {
        try {
            // まずSupabaseから最新のユーザー情報を取得
            if (window.ProfileSync && window.ProfileSync.sync) {
                // console.log('Syncing profile from Supabase...');
                await window.ProfileSync.sync();
            }
            
            // Supabaseから自分のプロフィールデータも取得
            if (window.supabaseClient && this.currentUserId) {
                const { data, error } = await window.supabaseClient
                    .from('user_profiles')
                    .select('*')
                    .eq('id', this.currentUserId)
                    .maybeSingle();
                
                if (data && !error) {
                    // console.log('[Profile] 自分のSupabaseデータ:', data);
                    // Supabaseのデータを優先的に使用
                    if (!window.InterConnect.Profile.profileData) {
                        window.InterConnect.Profile.profileData = {};
                    }
                    window.InterConnect.Profile.profileData = {
                        ...window.InterConnect.Profile.profileData,
                        id: data.id,
                        name: data.full_name || data.name || window.InterConnect.Profile.profileData.name,
                        company: data.company || window.InterConnect.Profile.profileData.company,
                        position: data.position || window.InterConnect.Profile.profileData.position,
                        title: data.position || window.InterConnect.Profile.profileData.position, // titleはpositionのエイリアス
                        industry: data.industry || window.InterConnect.Profile.profileData.industry,
                        skills: data.skills || window.InterConnect.Profile.profileData.skills || [],
                        bio: data.bio || window.InterConnect.Profile.profileData.bio,
                        connectionCount: 0, // 後で別途取得
                        isOnline: data.is_online || false
                    };
                }
            }
            
            // localStorageからユーザー情報を取得
            const userStr = localStorage.getItem('user');
            if (userStr) {
                try {
                    const userData = JSON.parse(userStr);
                    // console.log('User data from sync:', userData);
                    
                    // プロフィールデータの初期化
                    if (!window.InterConnect.Profile.profileData) {
                        window.InterConnect.Profile.profileData = {};
                    }
                    
                    // Supabaseのデータでプロフィールを更新
                    window.InterConnect.Profile.profileData.name = userData.name || userData.display_name || '';
                    window.InterConnect.Profile.profileData.email = userData.email || '';
                    if (userData.picture || userData.picture_url) {
                        window.InterConnect.Profile.profileData.profileImage = userData.picture || userData.picture_url;
                    }
                } catch (e) {
                    console.error('Failed to parse user data:', e);
                }
            }
            
            // 既存のプロフィールデータも読み込む（追加情報用）
            const savedData = window.safeLocalStorage ? 
                window.safeLocalStorage.getJSON('userProfile', null) : 
                null;
            
            if (savedData) {
                // 既存データとマージ（Supabaseのデータを優先）
                window.InterConnect.Profile.profileData = {
                    ...savedData,
                    ...window.InterConnect.Profile.profileData
                };
                
                // デバッグ: 詳細フィールドの確認
                // console.log('Loaded profile data:', window.InterConnect.Profile.profileData);
                // console.log('revenue-details:', window.InterConnect.Profile.profileData['revenue-details']);
                // console.log('hr-details:', window.InterConnect.Profile.profileData['hr-details']);
                // console.log('dx-details:', window.InterConnect.Profile.profileData['dx-details']);
                // console.log('strategy-details:', window.InterConnect.Profile.profileData['strategy-details']);
            }
            
            // コネクション数を取得
            if (this.currentUserId) {
                await this.loadConnectionCount(this.currentUserId);
            }
            
            window.InterConnect.Profile.updateProfileInfo();
            
        } catch (error) {
            console.error('プロフィールデータの読み込みエラー:', error);
        }
    },
    
    // UIモードの更新
    updateUIMode: function() {
        // console.log('[Profile] UIモード更新 - isOwnProfile:', this.isOwnProfile);
        // console.log('[Profile] targetUserId:', this.targetUserId);
        // console.log('[Profile] connectionStatus:', this.connectionStatus);
        
        const editAvatarBtn = document.querySelector('.btn-edit-avatar');
        const editCoverBtn = document.querySelector('.btn-edit-cover');
        
        if (this.isOwnProfile) {
            // 自分のプロフィール
            // 編集ボタンを表示
            if (editAvatarBtn) editAvatarBtn.style.display = 'flex';
            if (editCoverBtn) editCoverBtn.style.display = 'flex';
        } else {
            // 他人のプロフィール
            // すべての編集ボタンを非表示
            if (editAvatarBtn) editAvatarBtn.style.display = 'none';
            if (editCoverBtn) editCoverBtn.style.display = 'none';
        }
    },
    
    // コネクト申請を送る
    sendConnectionRequest: async function() {
        try {
            if (!window.supabaseClient || !this.currentUserId || !this.targetUserId) {
                // alert('ログインが必要です');
                if (window.showError) {
                    showError('ログインが必要です');
                }
                return;
            }
            
            const { error } = await window.supabaseClient
                .from('connections')
                .insert({
                    user_id: this.currentUserId,
                    connected_user_id: this.targetUserId,
                    status: 'pending',
                    created_at: new Date().toISOString()
                });
            
            if (error) throw error;
            
            // alert('コネクト申請を送信しました');
            if (window.showSuccess) {
                showSuccess('コネクト申請を送信しました');
            }
            this.connectionStatus = 'pending';
            this.updateUIMode();
            
        } catch (error) {
            console.error('[Profile] コネクト申請エラー:', error);
            // alert('コネクト申請の送信に失敗しました');
            if (window.showError) {
                showError('コネクト申請の送信に失敗しました');
            }
        }
    },
    
    // メッセージを送る
    sendMessage: function() {
        // メッセージページへ遷移
        window.location.href = `messages.html?user=${this.targetUserId}`;
    },
    
    // エラー表示
    showError: function(message) {
        const container = document.querySelector('.profile-container');
        if (container) {
            container.innerHTML = `
                <div style="text-align: center; padding: 3rem;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #dc3545; margin-bottom: 1rem;"></i>
                    <h2 style="color: #dc3545; margin-bottom: 0.5rem;">エラー</h2>
                    <p style="color: #6c757d;">${typeof window.escapeHTML === 'function' ? window.escapeHTML(message) : message.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</p>
                    <a href="members.html" class="btn btn-primary" style="margin-top: 1rem;">メンバー一覧へ戻る</a>
                </div>
            `;
        }
    },
    
    // プロフィール情報の更新
    updateProfileInfo: function() {
        // console.log('updateProfileInfo called');
        const data = window.InterConnect.Profile.profileData;
        // console.log('Profile data:', data);
        
        if (!data) {
            // console.log('No profile data found');
            return;
        }
        
        // ユーザー名
        const userNameElements = document.querySelectorAll('.user-name, .profile-details h2');
        // console.log('User name elements found:', userNameElements.length);
        userNameElements.forEach(el => {
            if (el) el.textContent = data.name || 'ユーザー名';
        });
        
        // 会社名
        const companyElement = document.querySelector('.profile-company');
        if (companyElement) companyElement.textContent = data.company || '会社名';
        
        // 役職
        const positionElement = document.querySelector('.profile-title');
        if (positionElement) positionElement.textContent = data.position || '役職・肩書き';
        
        // 統計情報の更新
        this.updateProfileStats(data);
        
        // オンラインステータスの更新
        if (!this.isOwnProfile && data.isOnline !== undefined) {
            const onlineIndicator = document.querySelector('.online-indicator');
            if (onlineIndicator) {
                onlineIndicator.style.display = data.isOnline ? 'block' : 'none';
            }
        }
        
        // プロフィール画像の更新
        if (data.profileImage) {
            // プロフィールページのアバター画像
            const profileAvatar = document.querySelector('.profile-avatar img');
            if (profileAvatar) {
                profileAvatar.src = data.profileImage;
                profileAvatar.onerror = function() {
                    this.src = 'assets/user-placeholder.svg';
                };
                // console.log('Profile avatar updated:', data.profileImage);
            }
            
            // ヘッダーのユーザーアバター
            const headerAvatar = document.querySelector('.user-menu-btn img');
            if (headerAvatar) {
                headerAvatar.src = data.profileImage;
                headerAvatar.onerror = function() {
                    this.src = 'assets/user-placeholder.svg';
                };
                // console.log('Header avatar updated:', data.profileImage);
            }
        }
        
        // カバー画像の更新
        if (data.coverImage) {
            const coverImg = document.querySelector('.profile-cover img');
            if (coverImg) {
                coverImg.src = data.coverImage;
                coverImg.onerror = function() {
                    this.style.display = 'none';
                };
                // console.log('Cover image updated:', data.coverImage);
            }
        }
        
        // 基本情報タブの内容を更新
        this.updateAboutTab();
        
        // スキルタブの更新
        this.updateSkillsTab();
        
        // プロジェクトタブの更新
        this.updateProjectsTab();
        
        // コネクションタブの更新
        this.updateConnectionsTab();
    },
    
    // タブの初期化
    initializeTabs: function() {
        const tabButtons = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');
        
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = button.getAttribute('data-tab');
                
                // アクティブクラスの切り替え
                tabButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                
                // タブコンテンツの表示切り替え
                tabContents.forEach(content => {
                    if (content.getAttribute('data-tab') === targetTab) {
                        content.classList.add('active');
                    } else {
                        content.classList.remove('active');
                    }
                });
                
                window.InterConnect.Profile.currentTab = targetTab;
            });
        });
    },
    
    // 編集モーダルの初期化
    initializeEditModal: function() {
        if (!this.isOwnProfile) return; // 他人のプロフィールでは初期化しない
        
        // モーダルの閉じるボタン
        const closeButtons = document.querySelectorAll('[data-close-modal]');
        closeButtons.forEach(button => {
            button.addEventListener('click', () => {
                window.InterConnect.Profile.closeEditModal();
            });
        });
        
        // 保存ボタン
        const saveButton = document.getElementById('saveProfile');
        if (saveButton) {
            saveButton.addEventListener('click', () => {
                window.InterConnect.Profile.saveProfile();
            });
        }
        
        // ファイル入力の処理
        const avatarInput = document.getElementById('avatarInput');
        const coverInput = document.getElementById('coverInput');
        
        if (avatarInput) {
            avatarInput.addEventListener('change', (e) => {
                window.InterConnect.Profile.handleImageUpload(e, 'avatar');
            });
        }
        
        if (coverInput) {
            coverInput.addEventListener('change', (e) => {
                window.InterConnect.Profile.handleImageUpload(e, 'cover');
            });
        }
    },
    
    // 編集モーダルを開く
    openEditModal: function() {
        const modal = document.getElementById('profileEditModal') || document.getElementById('editProfileModal');
        if (!modal) return;

        // 現在のデータをフォームに反映
        const data = window.InterConnect.Profile.profileData || {};

        // HTML の id は edit-name, edit-company 等（profileEditModal内）
        const fields = {
            'edit-name': data.name || '',
            'edit-company': data.company || '',
            'edit-position': data.position || '',
            'edit-bio': data.bio || '',
            'edit-email': data.email || '',
            'edit-phone': data.phone || '',
            'edit-lineId': data.line_id || ''
        };
        Object.entries(fields).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        });

        // モーダルを表示
        modal.style.display = 'flex';
        setTimeout(() => { modal.classList.add('active'); }, 10);
    },

    // 編集モーダルを閉じる
    closeEditModal: function() {
        const modal = document.getElementById('profileEditModal') || document.getElementById('editProfileModal');
        if (!modal) return;
        modal.classList.remove('active');
        setTimeout(() => { modal.style.display = 'none'; }, 300);
    },

    // 事業課題モーダルを閉じる
    closeChallengesModal: function() {
        const modal = document.getElementById('challengesEditModal');
        if (!modal) return;
        modal.classList.remove('active');
        setTimeout(() => { modal.style.display = 'none'; }, 300);
    },

    // プロフィールを保存
    saveProfile: async function() {
        // HTML フォームの id に合わせて取得
        const nameInput = document.getElementById('edit-name');
        const companyInput = document.getElementById('edit-company');
        const positionInput = document.getElementById('edit-position');
        const bioInput = document.getElementById('edit-bio');
        const emailInput = document.getElementById('edit-email');
        const phoneInput = document.getElementById('edit-phone');
        const lineIdInput = document.getElementById('edit-lineId');

        if (!window.InterConnect.Profile.profileData) {
            window.InterConnect.Profile.profileData = {};
        }

        // データを更新
        if (nameInput) window.InterConnect.Profile.profileData.name = nameInput.value;
        if (companyInput) window.InterConnect.Profile.profileData.company = companyInput.value;
        if (positionInput) window.InterConnect.Profile.profileData.position = positionInput.value;
        if (bioInput) window.InterConnect.Profile.profileData.bio = bioInput.value;
        if (emailInput) window.InterConnect.Profile.profileData.email = emailInput.value;
        if (phoneInput) window.InterConnect.Profile.profileData.phone = phoneInput.value;
        if (lineIdInput) window.InterConnect.Profile.profileData.line_id = lineIdInput.value;

        // Supabaseに保存
        if (window.supabaseClient && this.currentUserId) {
            try {
                const updateData = {
                    name: window.InterConnect.Profile.profileData.name,
                    full_name: window.InterConnect.Profile.profileData.name,
                    company: window.InterConnect.Profile.profileData.company,
                    position: window.InterConnect.Profile.profileData.position,
                    bio: window.InterConnect.Profile.profileData.bio,
                    email: window.InterConnect.Profile.profileData.email,
                    phone: window.InterConnect.Profile.profileData.phone,
                    line_id: window.InterConnect.Profile.profileData.line_id,
                    updated_at: new Date().toISOString()
                };

                const { error } = await window.supabaseClient
                    .from('user_profiles')
                    .update(updateData)
                    .eq('id', this.currentUserId);

                if (error) {
                    console.error('[Profile] Supabase更新エラー:', error);
                }
            } catch (error) {
                console.error('[Profile] 保存処理エラー:', error);
            }
        }

        // localStorageにも保存（バックアップ）
        if (window.safeLocalStorage) {
            window.safeLocalStorage.setJSON('userProfile', window.InterConnect.Profile.profileData);
        }

        // UIを更新
        window.InterConnect.Profile.updateProfileInfo();

        // モーダルを閉じる
        window.InterConnect.Profile.closeEditModal();

        // 成功メッセージ
        if (window.showToast) {
            window.showToast('プロフィールを更新しました', 'success');
        }
    },

    // 事業課題を保存
    saveChallenges: async function() {
        const budgetInput = document.getElementById('edit-budget');

        if (!window.InterConnect.Profile.profileData) {
            window.InterConnect.Profile.profileData = {};
        }

        // チェックボックスから課題を収集
        const challenges = Array.from(
            document.querySelectorAll('#challengesEditForm input[name="challenges"]:checked')
        ).map(cb => cb.value);

        const businessChallenges = {
            challenges: challenges,
            revenue_details: document.getElementById('edit-revenue-details')?.value || '',
            hr_details: document.getElementById('edit-hr-details')?.value || '',
            dx_details: document.getElementById('edit-dx-details')?.value || '',
            strategy_details: document.getElementById('edit-strategy-details')?.value || ''
        };

        window.InterConnect.Profile.profileData.business_challenges = businessChallenges;
        if (budgetInput) window.InterConnect.Profile.profileData.budget_range = budgetInput.value;

        // Supabaseに保存
        if (window.supabaseClient && this.currentUserId) {
            try {
                const { error } = await window.supabaseClient
                    .from('user_profiles')
                    .update({
                        business_challenges: businessChallenges,
                        budget_range: window.InterConnect.Profile.profileData.budget_range,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', this.currentUserId);

                if (error) {
                    console.error('[Profile] 事業課題保存エラー:', error);
                }
            } catch (error) {
                console.error('[Profile] 事業課題保存処理エラー:', error);
            }
        }

        // localStorageにも保存
        if (window.safeLocalStorage) {
            window.safeLocalStorage.setJSON('userProfile', window.InterConnect.Profile.profileData);
        }

        // UIを更新
        window.InterConnect.Profile.updateProfileInfo();

        // モーダルを閉じる
        window.InterConnect.Profile.closeChallengesModal();

        if (window.showToast) {
            window.showToast('事業課題を更新しました', 'success');
        }
    },
    
    // 画像アップロードの処理
    handleImageUpload: function(event, type) {
        const file = event.target.files[0];
        if (!file) return;
        
        // ファイルサイズチェック（5MB以下）
        if (file.size > 5 * 1024 * 1024) {
            // alert('ファイルサイズは5MB以下にしてください');
            if (window.showError) {
                showError('ファイルサイズは5MB以下にしてください');
            }
            return;
        }
        
        // 画像ファイルチェック
        if (!file.type.startsWith('image/')) {
            // alert('画像ファイルを選択してください');
            if (window.showError) {
                showError('画像ファイルを選択してください');
            }
            return;
        }
        
        const reader = new FileReader();
        reader.onload = function(e) {
            if (!window.InterConnect.Profile.profileData) {
                window.InterConnect.Profile.profileData = {};
            }
            
            if (type === 'avatar') {
                window.InterConnect.Profile.profileData.profileImage = e.target.result;
                // プレビュー更新
                const preview = document.querySelector('.avatar-preview');
                if (preview) preview.style.backgroundImage = `url(${e.target.result})`;
            } else if (type === 'cover') {
                window.InterConnect.Profile.profileData.coverImage = e.target.result;
                // プレビュー更新
                const preview = document.querySelector('.cover-preview');
                if (preview) preview.style.backgroundImage = `url(${e.target.result})`;
            }
        };
        reader.readAsDataURL(file);
    },
    
    // 基本情報タブの更新
    updateAboutTab: function() {
        // console.log('updateAboutTab called');
        const data = window.InterConnect.Profile.profileData;
        if (!data) return;
        
        // 各フィールドを更新
        const bioElement = document.getElementById('profileBioDisplay');
        if (bioElement) bioElement.textContent = data.bio || '自己紹介が登録されていません。';
        
        // 売上情報の更新
        const revenueDetailElement = document.getElementById('revenueDetailText');
        if (revenueDetailElement) {
            const revenueDetail = data['revenue-details'] || '詳細情報なし';
            // console.log('Setting revenue detail:', revenueDetail);
            revenueDetailElement.textContent = revenueDetail;
        }
        
        // 人事課題の更新
        const hrDetailElement = document.getElementById('hrDetailText');
        if (hrDetailElement) {
            const hrDetail = data['hr-details'] || '詳細情報なし';
            // console.log('Setting HR detail:', hrDetail);
            hrDetailElement.textContent = hrDetail;
        }
        
        // DX推進状況の更新
        const dxDetailElement = document.getElementById('dxDetailText');
        if (dxDetailElement) {
            const dxDetail = data['dx-details'] || '詳細情報なし';
            // console.log('Setting DX detail:', dxDetail);
            dxDetailElement.textContent = dxDetail;
        }
        
        // 経営戦略の更新
        const strategyDetailElement = document.getElementById('strategyDetailText');
        if (strategyDetailElement) {
            const strategyDetail = data['strategy-details'] || '詳細情報なし';
            // console.log('Setting strategy detail:', strategyDetail);
            strategyDetailElement.textContent = strategyDetail;
        }
    },
    
    // スキルタブの更新
    updateSkillsTab: function() {
        const data = window.InterConnect.Profile.profileData;
        if (!data || !data.skills) return;
        
        const skillsContainer = document.querySelector('.skills-grid');
        if (!skillsContainer) return;
        
        // スキルを表示
        skillsContainer.innerHTML = data.skills.map(skill => `
            <div class="skill-item">
                <i class="fas fa-check-circle"></i>
                <span>${window.escapeHTML(skill)}</span>
            </div>
        `).join('');
    },
    
    // プロジェクトタブの更新
    updateProjectsTab: function() {
        // 実装予定
    },
    
    // コネクションタブの更新
    updateConnectionsTab: function() {
        // 実装予定
    },
    
    // プロフィール統計情報の更新
    updateProfileStats: function(data) {
        // console.log('[Profile] 統計情報更新:', data);
        
        // コネクション数
        const connectionCountEl = document.querySelector('.stat-value.connection-count');
        if (connectionCountEl && data.connectionCount !== undefined) {
            connectionCountEl.textContent = data.connectionCount;
        }
        
        // メッセージ数（今は固定値）
        const messageCountEl = document.querySelector('.stat-value.message-count');
        if (messageCountEl) {
            messageCountEl.textContent = data.messageCount || 0;
        }
        
        // マッチング率（今は固定値）
        const matchingRateEl = document.querySelector('.stat-value.matching-rate');
        if (matchingRateEl) {
            matchingRateEl.textContent = data.matchingRate || '0%';
        }
    },
    
    // キャッシュから取得
    getFromCache: function(userId) {
        const cached = this.profileCache[userId];
        if (cached && (Date.now() - cached.timestamp < this.cacheExpiry)) {
            return cached.data;
        }
        // 期限切れの場合は削除
        if (cached) {
            delete this.profileCache[userId];
        }
        return null;
    },
    
    // キャッシュに保存
    saveToCache: function(userId, data) {
        this.profileCache[userId] = {
            data: data,
            timestamp: Date.now()
        };
    },
    
    // キャッシュをクリア
    clearCache: function() {
        this.profileCache = {};
    },
    
    // ローディング状態を表示
    showLoadingState: function() {
        const container = document.querySelector('.profile-container');
        if (container && !container.querySelector('.loading-overlay')) {
            const overlay = document.createElement('div');
            overlay.className = 'loading-overlay';
            overlay.innerHTML = `
                <div class="loading-spinner">
                    <i class="fas fa-spinner fa-spin"></i>
                    <p>プロフィールを読み込んでいます...</p>
                </div>
            `;
            container.appendChild(overlay);
        }
    },
    
    // ローディング状態を非表示
    hideLoadingState: function() {
        const overlay = document.querySelector('.loading-overlay');
        if (overlay) {
            overlay.remove();
        }
    },
    
    // フォールバックプロフィール表示
    showFallbackProfile: function(userId) {
        // console.log('[Profile] フォールバックモードでプロフィール表示');
        
        // エラーバナーを表示
        const container = document.querySelector('.content-container');
        if (container && !container.querySelector('.warning-banner')) {
            const warningBanner = document.createElement('div');
            warningBanner.className = 'warning-banner';
            warningBanner.innerHTML = `
                <div class="warning-content">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>データベースに接続できません。一部の情報が表示されない可能性があります。</span>
                    <button class="btn btn-small btn-outline" onclick="window.location.reload()">
                        再読み込み
                    </button>
                </div>
            `;
            container.insertBefore(warningBanner, container.firstChild);
        }
        
        // 基本的なダミーデータを設定
        this.profileData = {
            id: userId,
            name: 'ユーザー情報を読み込み中...',
            company: '---',
            position: '---',
            title: '---',
            profileImage: 'assets/user-placeholder.svg',
            skills: [],
            bio: 'プロフィール情報を読み込めませんでした。',
            connectionCount: 0,
            isOnline: false
        };
        
        this.updateProfileInfo();
    }
};

// DOMContentLoadedイベントでプロフィール機能を初期化
document.addEventListener('DOMContentLoaded', function() {
    // console.log('DOMContentLoaded - initializing profile');
    // console.log('現在のURL:', window.location.href);
    // console.log('URLパラメータ:', window.location.search);
    
    // URLパラメータを早期に確認
    const urlParams = new URLSearchParams(window.location.search);
    const userParam = urlParams.get('user');
    // console.log('userパラメータ:', userParam);
    
    // Supabaseの準備を待つ
    function initWhenReady() {
        if (window.supabaseClient) {
            // console.log('Supabase準備完了、初期化開始');
            window.InterConnect.Profile.init();
        } else {
            // console.log('Supabase未準備、イベント待機');
            window.addEventListener('supabaseReady', () => {
                // console.log('supabaseReadyイベント受信、初期化開始');
                window.InterConnect.Profile.init();
            });
            // フォールバック
            setTimeout(() => {
                if (!window.InterConnect.Profile.initialized) {
                    // console.log('タイムアウトによる初期化');
                    window.InterConnect.Profile.init();
                }
            }, 1000);
        }
    }
    
    initWhenReady();
});

// console.log('profile.js loaded successfully');
// Cache buster: 1753750334


// ============================================================
// Section: profile-viewer.js
// ============================================================

/**
 * プロフィール閲覧機能
 * URLパラメータからユーザーIDを取得して他のユーザーのプロフィールを表示
 */

(function() {
    'use strict';

    class ProfileViewer {
        constructor() {
            this.targetUserId = null;
            this.isOwnProfile = false;
            this.init();
        }

        async init() {
            // Supabaseの準備を待つ
            if (!window.supabaseClient) {
                await window.waitForSupabase();
            }
            
            // URLパラメータからユーザーIDを取得
            const urlParams = new URLSearchParams(window.location.search);
            this.targetUserId = urlParams.get('id');

            if (!this.targetUserId) {
                // IDがない場合は自分のプロフィールを表示
                this.isOwnProfile = true;
                return;
            }

            // 現在のユーザーを取得
            const user = await window.safeGetUser();
            if (!user) {
                // console.log('[ProfileViewer] Not authenticated');
                return;
            }

            // 自分のプロフィールかチェック
            this.isOwnProfile = (user.id === this.targetUserId);

            if (!this.isOwnProfile) {
                // 他のユーザーのプロフィールを表示
                await this.loadOtherUserProfile();
                this.hideEditButtons();
            }
        }

        async loadOtherUserProfile() {
            try {
                // プロフィールデータを取得
                const { data: profile, error } = await window.supabaseClient
                    .from('user_profiles')
                    .select('id, name, email, company, position, avatar_url, bio, skills, interests, industry, location, phone, line_id')
                    .eq('id', this.targetUserId)
                    .maybeSingle();

                if (error) {
                    console.error('[ProfileViewer] Error loading profile:', error);
                    this.showError('プロフィールが見つかりません');
                    return;
                }

                if (!profile) {
                    this.showError('プロフィールが見つかりません');
                    return;
                }

                // プロフィール情報を表示
                this.displayProfile(profile);

            } catch (error) {
                console.error('[ProfileViewer] Error:', error);
                this.showError('プロフィールの読み込みに失敗しました');
            }
        }

        displayProfile(profile) {
            // 基本情報
            const updateElement = (selector, value) => {
                const element = document.querySelector(selector);
                if (element) {
                    element.textContent = value || '未設定';
                }
            };

            // 名前
            updateElement('.profile-name', profile.name || profile.email?.split('@')[0]);
            document.querySelectorAll('.user-name').forEach(el => {
                el.textContent = profile.name || profile.email?.split('@')[0] || 'ユーザー';
            });

            // 役職・会社
            updateElement('.profile-title', profile.position);
            updateElement('.profile-company', profile.company);

            // 自己紹介
            const bioElement = document.querySelector('.profile-bio p');
            if (bioElement) {
                bioElement.textContent = profile.bio || '自己紹介が設定されていません。';
            }

            // スキル
            const skillsContainer = document.querySelector('.profile-skills');
            if (skillsContainer && profile.skills) {
                skillsContainer.innerHTML = profile.skills.map(skill => 
                    `<span class="skill-tag">${this.escapeHtml(skill)}</span>`
                ).join('');
            }

            // アバター
            const avatarImg = document.querySelector('.profile-avatar img');
            if (avatarImg) {
                avatarImg.src = profile.avatar_url || 'assets/user-placeholder.svg';
                avatarImg.onerror = function() {
                    this.src = 'assets/user-placeholder.svg';
                };
            }

            // 業界・地域
            updateElement('[data-field="industry"]', this.getIndustryLabel(profile.industry));
            updateElement('[data-field="location"]', this.getLocationLabel(profile.location));

            // ヘッダータイトル
            const headerTitle = document.querySelector('.header-left h1');
            if (headerTitle) {
                headerTitle.textContent = `${profile.name || 'ユーザー'}のプロフィール`;
            }
        }

        hideEditButtons() {
            // 編集ボタンを非表示
            const editButtons = document.querySelectorAll('.btn-primary[onclick*="editProfile"], .btn-secondary[onclick*="editProfile"]');
            editButtons.forEach(btn => {
                btn.style.display = 'none';
            });

            // タブを非表示（他のユーザーのプロフィールでは基本情報のみ表示）
            const tabButtons = document.querySelectorAll('.tab-btn:not([onclick*="basic"])');
            tabButtons.forEach(btn => {
                btn.style.display = 'none';
            });

            // コネクトボタンを追加
            this.addConnectButton();
        }

        addConnectButton() {
            const profileHeader = document.querySelector('.profile-header');
            if (!profileHeader) return;

            const connectBtn = document.createElement('button');
            connectBtn.className = 'btn btn-primary';
            connectBtn.innerHTML = '<i class="fas fa-user-plus"></i> コネクト';
            connectBtn.onclick = () => this.sendConnectRequest();

            // 既存のボタンエリアを探す
            let buttonArea = profileHeader.querySelector('.profile-actions');
            if (!buttonArea) {
                buttonArea = document.createElement('div');
                buttonArea.className = 'profile-actions';
                buttonArea.style.marginTop = '20px';
                profileHeader.appendChild(buttonArea);
            }
            
            buttonArea.appendChild(connectBtn);
        }

        async sendConnectRequest() {
            if (window.matchingButtons && window.matchingButtons.sendConnectRequest) {
                await window.matchingButtons.sendConnectRequest(this.targetUserId);
            } else {
                if (window.showToast) window.showToast('コネクト機能が利用できません', 'error');
            }
        }

        showError(message) {
            const container = document.querySelector('.profile-content');
            if (container) {
                container.innerHTML = `
                    <div class="error-message" style="text-align: center; padding: 50px;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 48px; color: #dc3545; margin-bottom: 20px;"></i>
                        <h2>${window.escapeHTML ? window.escapeHTML(message) : message}</h2>
                        <a href="matching.html" class="btn btn-primary" style="margin-top: 20px;">マッチングページに戻る</a>
                    </div>
                `;
            }
        }

        getIndustryLabel(value) {
            const industries = {
                'tech': 'IT・テクノロジー',
                'finance': '金融',
                'healthcare': '医療・ヘルスケア',
                'retail': '小売・流通',
                'manufacturing': '製造業',
                'consulting': 'コンサルティング',
                'education': '教育',
                'real_estate': '不動産',
                'media': 'メディア・広告',
                'other': 'その他'
            };
            return industries[value] || value || '未設定';
        }

        getLocationLabel(value) {
            const locations = {
                'tokyo': '東京',
                'osaka': '大阪',
                'nagoya': '名古屋',
                'fukuoka': '福岡',
                'sapporo': '札幌',
                'sendai': '仙台',
                'hiroshima': '広島',
                'kyoto': '京都',
                'kobe': '神戸',
                'remote': 'リモート',
                'overseas': '海外',
                'other': 'その他'
            };
            return locations[value] || value || '未設定';
        }

        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    }

    // DOMContentLoaded後に初期化
    document.addEventListener('DOMContentLoaded', () => {
        new ProfileViewer();
    });

})();

// ============================================================
// Section: profile-image-upload.js
// ============================================================

/**
 * プロフィール画像アップロード機能
 * 
 * 機能:
 * - プロフィール画像のアップロード
 * - カバー画像のアップロード
 * - 画像のリサイズ・最適化
 * - Supabase Storageへの保存
 */

(function() {
    'use strict';

    // console.log('[ProfileImageUpload] プロフィール画像アップロード機能初期化');

    // グローバル変数
    let currentUserId = null;
    let selectedAvatarFile = null;
    let selectedCoverFile = null;

    // 初期化
    async function initialize() {
        // console.log('[ProfileImageUpload] 初期化開始');

        // Supabaseの準備を待つ
        await window.waitForSupabase();

        // 現在のユーザーを取得
        const user = await window.safeGetUser();
        if (!user) {
            console.error('[ProfileImageUpload] ユーザーが認証されていません');
            return;
        }

        currentUserId = user.id;
        // console.log('[ProfileImageUpload] ユーザーID:', currentUserId);

        // イベントリスナーの設定
        setupEventListeners();
    }

    // イベントリスナーの設定
    function setupEventListeners() {
        // アバター編集ボタン
        const avatarEditBtn = document.querySelector('.btn-edit-avatar');
        if (avatarEditBtn) {
            avatarEditBtn.addEventListener('click', openAvatarModal);
        }

        // カバー編集ボタン
        const coverEditBtn = document.querySelector('.btn-edit-cover');
        if (coverEditBtn) {
            coverEditBtn.addEventListener('click', openCoverModal);
        }

        // アバターアップロード入力
        const avatarInput = document.getElementById('avatar-upload');
        if (avatarInput) {
            avatarInput.addEventListener('change', handleAvatarSelect);
        }

        // カバーアップロード入力
        const coverInput = document.getElementById('cover-upload');
        if (coverInput) {
            coverInput.addEventListener('change', handleCoverSelect);
        }
    }

    // アバターモーダルを開く
    function openAvatarModal() {
        const modal = document.getElementById('avatarEditModal');
        if (modal) {
            modal.style.display = 'block';
            selectedAvatarFile = null;
            document.getElementById('avatar-preview').style.display = 'none';
            document.querySelector('#avatarEditModal .upload-placeholder').style.display = 'flex';
        }
    }

    // カバーモーダルを開く
    function openCoverModal() {
        const modal = document.getElementById('coverEditModal');
        if (modal) {
            modal.style.display = 'block';
            selectedCoverFile = null;
            document.getElementById('cover-preview').style.display = 'none';
            document.querySelector('#coverEditModal .upload-placeholder').style.display = 'flex';
        }
    }

    // アバター画像選択処理
    function handleAvatarSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        // ファイルサイズチェック（5MB以下）
        if (file.size > 5 * 1024 * 1024) {
            showError('ファイルサイズは5MB以下にしてください');
            event.target.value = '';
            return;
        }

        // 画像ファイルかチェック
        if (!file.type.startsWith('image/')) {
            showError('画像ファイルを選択してください');
            event.target.value = '';
            return;
        }

        selectedAvatarFile = file;

        // プレビュー表示
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('avatar-preview');
            const placeholder = document.querySelector('#avatarEditModal .upload-placeholder');
            if (preview && placeholder) {
                preview.src = e.target.result;
                preview.style.display = 'block';
                placeholder.style.display = 'none';
            }
        };
        reader.readAsDataURL(file);
    }

    // カバー画像選択処理
    function handleCoverSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        // ファイルサイズチェック（10MB以下）
        if (file.size > 10 * 1024 * 1024) {
            showError('ファイルサイズは10MB以下にしてください');
            event.target.value = '';
            return;
        }

        // 画像ファイルかチェック
        if (!file.type.startsWith('image/')) {
            showError('画像ファイルを選択してください');
            event.target.value = '';
            return;
        }

        selectedCoverFile = file;

        // プレビュー表示
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('cover-preview');
            const placeholder = document.querySelector('#coverEditModal .upload-placeholder');
            if (preview && placeholder) {
                preview.src = e.target.result;
                preview.style.display = 'block';
                placeholder.style.display = 'none';
            }
        };
        reader.readAsDataURL(file);
    }

    // アバター画像保存
    async function saveAvatarImage() {
        if (!selectedAvatarFile) {
            showError('画像を選択してください');
            return;
        }

        try {
            showLoading('アップロード中...');

            // 画像をリサイズ
            const resizedBlob = await resizeImage(selectedAvatarFile, 400, 400);

            // ファイル名を生成
            const timestamp = Date.now();
            const fileName = `${currentUserId}/avatar-${timestamp}.jpg`;

            // Supabase Storageにアップロード
            const { data, error } = await window.supabaseClient.storage
                .from('avatars')
                .upload(fileName, resizedBlob, {
                    contentType: 'image/jpeg',
                    upsert: true
                });

            if (error) throw error;

            // 公開URLを取得
            const { data: { publicUrl } } = window.supabaseClient.storage
                .from('avatars')
                .getPublicUrl(fileName);

            // ユーザー情報を更新
            const { error: updateError } = await window.supabaseClient
                .from('user_profiles')
                .update({ 
                    picture_url: publicUrl,
                    updated_at: new Date().toISOString()
                })
                .eq('id', currentUserId);

            if (updateError) throw updateError;

            // プロフィール画像を即座に更新
            updateAvatarDisplay(publicUrl);

            // モーダルを閉じる
            closeAvatarModal();

            hideLoading();
            showSuccess('プロフィール画像を更新しました');

        } catch (error) {
            console.error('[ProfileImageUpload] アバター保存エラー:', error);
            hideLoading();
            showError('画像のアップロードに失敗しました');
        }
    }

    // カバー画像保存
    async function saveCoverImage() {
        if (!selectedCoverFile) {
            showError('画像を選択してください');
            return;
        }

        try {
            showLoading('アップロード中...');

            // 画像をリサイズ
            const resizedBlob = await resizeImage(selectedCoverFile, 1200, 300);

            // ファイル名を生成
            const timestamp = Date.now();
            const fileName = `${currentUserId}/cover-${timestamp}.jpg`;

            // Supabase Storageにアップロード
            const { data, error } = await window.supabaseClient.storage
                .from('covers')
                .upload(fileName, resizedBlob, {
                    contentType: 'image/jpeg',
                    upsert: true
                });

            if (error) throw error;

            // 公開URLを取得
            const { data: { publicUrl } } = window.supabaseClient.storage
                .from('covers')
                .getPublicUrl(fileName);

            // ユーザー情報を更新
            const { error: updateError } = await window.supabaseClient
                .from('user_profiles')
                .update({ 
                    cover_url: publicUrl,
                    updated_at: new Date().toISOString()
                })
                .eq('id', currentUserId);

            if (updateError) throw updateError;

            // カバー画像を即座に更新
            updateCoverDisplay(publicUrl);

            // モーダルを閉じる
            closeCoverModal();

            hideLoading();
            showSuccess('カバー画像を更新しました');

        } catch (error) {
            console.error('[ProfileImageUpload] カバー保存エラー:', error);
            hideLoading();
            showError('画像のアップロードに失敗しました');
        }
    }

    // 画像リサイズ関数
    function resizeImage(file, maxWidth, maxHeight) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = new Image();
                img.onload = function() {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');

                    // アスペクト比を保持してリサイズ
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > maxWidth) {
                            height *= maxWidth / width;
                            width = maxWidth;
                        }
                    } else {
                        if (height > maxHeight) {
                            width *= maxHeight / height;
                            height = maxHeight;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;

                    // 画像を描画
                    ctx.drawImage(img, 0, 0, width, height);

                    // JPEGとして出力
                    canvas.toBlob((blob) => {
                        resolve(blob);
                    }, 'image/jpeg', 0.9);
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // アバター表示更新
    function updateAvatarDisplay(url) {
        // プロフィールページのアバター
        const profileAvatar = document.querySelector('.profile-avatar img');
        if (profileAvatar) {
            profileAvatar.src = url;
        }

        // ヘッダーのアバター
        const headerAvatar = document.querySelector('.user-menu-btn img');
        if (headerAvatar) {
            headerAvatar.src = url;
        }

        // その他のアバター表示
        document.querySelectorAll('.user-avatar img, .profile-pic img').forEach(img => {
            img.src = url;
        });
    }

    // カバー表示更新
    function updateCoverDisplay(url) {
        const coverImg = document.querySelector('.profile-cover img');
        if (coverImg) {
            coverImg.src = url;
        }
    }

    // モーダルを閉じる
    function closeAvatarModal() {
        const modal = document.getElementById('avatarEditModal');
        if (modal) {
            modal.style.display = 'none';
            selectedAvatarFile = null;
            document.getElementById('avatar-upload').value = '';
        }
    }

    function closeCoverModal() {
        const modal = document.getElementById('coverEditModal');
        if (modal) {
            modal.style.display = 'none';
            selectedCoverFile = null;
            document.getElementById('cover-upload').value = '';
        }
    }

    // ローディング表示
    function showLoading(message = 'Loading...') {
        // 既存のローディングを削除
        const existing = document.querySelector('.upload-loading');
        if (existing) existing.remove();

        const loading = document.createElement('div');
        loading.className = 'upload-loading';
        loading.innerHTML = `
            <div class="loading-content">
                <i class="fas fa-spinner fa-spin"></i>
                <span>${message}</span>
            </div>
        `;
        document.body.appendChild(loading);
    }

    function hideLoading() {
        const loading = document.querySelector('.upload-loading');
        if (loading) loading.remove();
    }

    // ユーティリティ関数
    function showSuccess(message) {
        showToast(message, 'success');
    }

    function showError(message) {
        showToast(message, 'error');
    }

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
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
    window.ProfileImageUpload = {
        saveAvatarImage,
        saveCoverImage,
        closeAvatarModal,
        closeCoverModal
    };

    // 初期化実行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();

