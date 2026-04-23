// ==========================================
// プロファイル詳細モーダル機能（統合版）
// profile-detail-modal.js + members-profile-modal.js を統合
// ==========================================

(function() {
    'use strict';

    // console.log('[ProfileDetailModal] 初期化開始');

    class ProfileDetailModal {
        constructor() {
            this.modal = null;
            this.currentProfileId = null;
            this.currentUserProfile = null;
            this.isLoading = false;
            this.init();
        }

        async init() {
            // 現在のユーザー情報を取得
            try {
                // Supabase初期化を待つ
                if (typeof window.waitForSupabase === 'function') {
                    await window.waitForSupabase();
                }

                if (!window.supabaseClient || !window.supabaseClient.auth) {
                    // console.log('[ProfileDetailModal] Waiting for Supabase initialization...');
                    // 初期化をスキップして後で再試行
                    window.addEventListener('supabaseReady', () => this.init());
                    return;
                }
                const user = await window.safeGetUser();
                if (user) {
                    const { data } = await window.supabaseClient
                        .from('user_profiles')
                        .select('*')
                        .eq('id', user.id)
                        .maybeSingle();
                    this.currentUserProfile = data;
                }
            } catch (error) {
                console.error('[ProfileDetailModal] 現在のユーザー取得エラー:', error);
            }

            // モーダルのスタイルを追加
            this.addStyles();

            // イベントリスナーを設定
            this.attachEventListeners();
        }

        addStyles() {
            if (document.getElementById('profile-detail-modal-styles')) return;

            const styles = document.createElement('style');
            styles.id = 'profile-detail-modal-styles';
            styles.textContent = `
                .profile-detail-modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.7);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10000;
                    padding: 20px;
                    opacity: 0;
                    transition: opacity 0.3s ease;
                    backdrop-filter: blur(5px);
                }

                .profile-detail-modal.show {
                    opacity: 1;
                }

                .profile-detail-content {
                    background: white;
                    border-radius: 16px;
                    max-width: 800px;
                    width: 100%;
                    max-height: 90vh;
                    overflow-y: auto;
                    overflow-x: hidden;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                    transform: translateY(20px);
                    transition: transform 0.3s ease;
                    -webkit-overflow-scrolling: touch;
                    position: relative;
                }

                .profile-detail-modal.show .profile-detail-content {
                    transform: translateY(0);
                }

                .profile-detail-header {
                    position: relative;
                    padding: 40px;
                    background: linear-gradient(135deg, #4A90E2 0%, #357ABD 100%);
                    color: white;
                    text-align: center;
                    border-radius: 16px 16px 0 0;
                }

                .profile-detail-close {
                    position: absolute;
                    top: 20px;
                    right: 20px;
                    background: rgba(255, 255, 255, 0.2);
                    border: none;
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    font-size: 24px;
                    color: white;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .profile-detail-close:hover {
                    background: rgba(255, 255, 255, 0.3);
                    transform: scale(1.1);
                }

                .profile-detail-avatar {
                    width: 120px;
                    height: 120px;
                    border-radius: 50%;
                    border: 4px solid white;
                    margin-bottom: 20px;
                    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
                }

                .profile-detail-name {
                    font-size: 32px;
                    font-weight: 700;
                    margin: 10px 0;
                }

                .profile-detail-title {
                    font-size: 18px;
                    opacity: 0.9;
                    margin-bottom: 20px;
                }

                .profile-detail-score {
                    display: inline-block;
                    background: rgba(255, 255, 255, 0.2);
                    padding: 10px 30px;
                    border-radius: 30px;
                    font-size: 24px;
                    font-weight: 600;
                }

                .profile-detail-body {
                    padding: 40px;
                }

                .profile-detail-section {
                    margin-bottom: 40px;
                }

                .profile-detail-section-title {
                    font-size: 20px;
                    font-weight: 600;
                    color: #2c3e50;
                    margin-bottom: 20px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }

                .profile-detail-section-title i {
                    color: #4A90E2;
                }

                .profile-detail-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                    gap: 20px;
                }

                .profile-detail-item {
                    background: #f8f9fa;
                    padding: 20px;
                    border-radius: 12px;
                }

                .profile-detail-label {
                    font-size: 14px;
                    color: #6c757d;
                    margin-bottom: 5px;
                }

                .profile-detail-value {
                    font-size: 16px;
                    color: #2c3e50;
                    font-weight: 500;
                }

                .profile-detail-bio {
                    background: #f8f9fa;
                    padding: 20px;
                    border-radius: 12px;
                    line-height: 1.8;
                    color: #495057;
                }

                .profile-detail-tags {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 10px;
                }

                .profile-detail-tag {
                    padding: 8px 16px;
                    border-radius: 20px;
                    font-size: 14px;
                    font-weight: 500;
                }

                .profile-detail-tag.skill {
                    background: #e3f2fd;
                    color: #1976d2;
                }

                .profile-detail-tag.interest {
                    background: #f3e5f5;
                    color: #7b1fa2;
                }

                .profile-detail-matching {
                    background: #f0f4ff;
                    padding: 30px;
                    border-radius: 12px;
                    margin-bottom: 30px;
                }

                .profile-detail-radar {
                    width: 300px;
                    height: 300px;
                    margin: 20px auto;
                    background: white;
                    border-radius: 12px;
                    padding: 20px;
                    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
                }

                .profile-detail-actions {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 15px;
                    margin-top: 30px;
                }

                .profile-detail-btn {
                    padding: 12px 24px;
                    border: none;
                    border-radius: 8px;
                    font-size: 16px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                }

                .profile-detail-btn-primary {
                    background: #4A90E2;
                    color: white;
                }

                .profile-detail-btn-primary:hover {
                    background: #357ABD;
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(74, 144, 226, 0.3);
                }

                .profile-detail-btn-secondary {
                    background: #f0f0f0;
                    color: #2c3e50;
                }

                .profile-detail-btn-secondary:hover {
                    background: #e0e0e0;
                }

                .profile-detail-loading {
                    text-align: center;
                    padding: 100px;
                }

                .profile-detail-spinner {
                    border: 4px solid #f3f3f3;
                    border-top: 4px solid #4A90E2;
                    border-radius: 50%;
                    width: 60px;
                    height: 60px;
                    animation: spin 1s linear infinite;
                    margin: 0 auto 20px;
                }

                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }

                .profile-detail-empty {
                    text-align: center;
                    color: #999;
                    font-style: italic;
                    padding: 20px;
                }

                .profile-detail-tldv {
                    background: #fff8e1;
                    padding: 20px;
                    border-radius: 12px;
                    border: 1px solid #ffd54f;
                }

                .profile-detail-tldv-title {
                    color: #f57c00;
                    font-weight: 600;
                    margin-bottom: 10px;
                }

                @media (max-width: 768px) {
                    .profile-detail-content {
                        margin: 20px 0;
                        max-height: calc(100vh - 40px);
                    }

                    .profile-detail-header,
                    .profile-detail-body {
                        padding: 20px;
                    }

                    .profile-detail-name {
                        font-size: 24px;
                    }

                    .profile-detail-radar {
                        width: 250px;
                        height: 250px;
                    }
                }
            `;
            document.head.appendChild(styles);
        }

        attachEventListeners() {
            // 詳細ボタンのクリックイベント
            document.addEventListener('click', async (e) => {
                // プロフィールボタンのクリック処理（複数のクラスに対応）
                if (e.target.classList.contains('btn-profile') ||
                    e.target.closest('.btn-profile') ||
                    e.target.classList.contains('view-profile-btn') ||
                    e.target.closest('.view-profile-btn')) {

                    e.preventDefault();
                    // stopPropagationを削除 - matching-unified.jsのハンドラーも動作させる

                    const button = e.target.classList.contains('btn-profile') || e.target.classList.contains('view-profile-btn')
                        ? e.target
                        : (e.target.closest('.btn-profile') || e.target.closest('.view-profile-btn'));

                    const card = button.closest('.matching-card, .override-matching-card, [data-profile-id]');

                    if (card) {
                        const profileId = card.dataset.profileId ||
                                        card.getAttribute('data-profile-id') ||
                                        button.dataset.userId ||
                                        button.dataset.profileId;
                        if (profileId) {
                            console.error('[ProfileDetailModal] プロフィールボタンクリック - ID:', profileId);
                            await this.show(profileId);
                        }
                    }
                }

                // 既存の詳細ボタンクリック処理
                if (e.target.classList.contains('btn-view') ||
                    e.target.classList.contains('override-btn-secondary') ||
                    e.target.textContent === '詳細を見る') {

                    e.preventDefault();
                    e.stopPropagation();

                    const card = e.target.closest('[data-profile-id], .override-matching-card, .matching-card');
                    if (card) {
                        const profileId = card.dataset.profileId || card.getAttribute('data-profile-id');
                        if (profileId) {
                            await this.show(profileId);
                        }
                    }
                }
            });

            // ESCキーで閉じる
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.modal) {
                    this.close();
                }
            });
        }

        async show(profileId) {
            if (this.isLoading) return;

            this.isLoading = true;
            this.currentProfileId = profileId;

            // モーダルを作成
            this.createModal();

            try {
                // プロファイルデータを取得
                const { data: profile, error } = await window.supabaseClient
                    .from('user_profiles')
                    .select('*')
                    .eq('id', profileId)
                    .maybeSingle();

                if (error) throw error;

                // tl;dvデータを取得（テーブルが存在しない場合はスキップ）
                let meetingMinutes = null;
                try {
                    const { data, error } = await window.supabase
                        .from('meeting_minutes')
                        .select('*')
                        .eq('user_id', profileId)
                        .order('meeting_date', { ascending: false })
                        .limit(3);

                    if (!error) {
                        meetingMinutes = data;
                    }
                } catch (e) {
                    // console.log('[ProfileDetailModal] meeting_minutesテーブルは存在しません');
                }

                // マッチングスコアを計算
                let matchingScore = 50;
                if (window.matchingScoreFix && this.currentUserProfile) {
                    matchingScore = await window.matchingScoreFix.calculateScore(profile, this.currentUserProfile);
                } else if (profile.matchingScore) {
                    matchingScore = profile.matchingScore;
                }

                // コンテンツを表示
                this.displayProfile(profile, matchingScore, meetingMinutes);

            } catch (error) {
                console.error('[ProfileDetailModal] エラー:', error);
                this.showError(error.message);
            } finally {
                this.isLoading = false;
            }
        }

        createModal() {
            // 既存のモーダルがあれば削除
            if (this.modal) {
                this.modal.remove();
            }

            this.modal = document.createElement('div');
            this.modal.className = 'profile-detail-modal';
            this.modal.innerHTML = `
                <div class="profile-detail-content">
                    <div class="profile-detail-loading">
                        <div class="profile-detail-spinner"></div>
                        <p>プロファイルを読み込んでいます...</p>
                    </div>
                </div>
            `;

            // 外側クリックで閉じる
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) {
                    this.close();
                }
            });

            document.body.appendChild(this.modal);

            // アニメーション開始
            requestAnimationFrame(() => {
                this.modal.classList.add('show');
            });
        }

        displayProfile(profile, matchingScore, meetingMinutes) {
            const content = this.modal.querySelector('.profile-detail-content');

            // 共通要素の計算
            const commonSkills = this.getCommonElements(profile.skills, this.currentUserProfile?.skills);
            const commonInterests = this.getCommonElements(profile.interests, this.currentUserProfile?.interests);

            content.innerHTML = `
                <!-- ヘッダー -->
                <div class="profile-detail-header">
                    <button class="profile-detail-close" onclick="window.profileDetailModal.close()">×</button>
                    <img src="${profile.avatar_url ? window.escapeAttr(profile.avatar_url) : `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.name || 'User')}&background=4A90E2&color=fff&size=240`}"
                         alt="${window.escapeHTML(profile.name || 'User')}"
                         class="profile-detail-avatar">
                    <h2 class="profile-detail-name">${window.escapeHTML(profile.name || '名前未設定')}</h2>
                    <p class="profile-detail-title">
                        ${window.escapeHTML(profile.position || '役職未設定')}
                        ${profile.company ? `@ ${window.escapeHTML(profile.company)}` : ''}
                    </p>
                    <div class="profile-detail-score">
                        マッチング度: ${matchingScore}%
                    </div>
                </div>

                <!-- ボディ -->
                <div class="profile-detail-body">
                    <!-- マッチング詳細 -->
                    <div class="profile-detail-section">
                        <h3 class="profile-detail-section-title">
                            <i class="fas fa-chart-line"></i>
                            マッチング詳細
                        </h3>
                        <div class="profile-detail-matching">
                            <div class="profile-detail-grid">
                                <div class="profile-detail-item">
                                    <div class="profile-detail-label">共通のスキル</div>
                                    <div class="profile-detail-value">
                                        ${commonSkills.length > 0 ? commonSkills.map(s => window.escapeHTML(s)).join(', ') : 'なし'}
                                    </div>
                                </div>
                                <div class="profile-detail-item">
                                    <div class="profile-detail-label">共通の興味</div>
                                    <div class="profile-detail-value">
                                        ${commonInterests.length > 0 ? commonInterests.map(s => window.escapeHTML(s)).join(', ') : 'なし'}
                                    </div>
                                </div>
                                <div class="profile-detail-item">
                                    <div class="profile-detail-label">地域</div>
                                    <div class="profile-detail-value">
                                        ${this.getLocationMatch(profile.location, this.currentUserProfile?.location)}
                                    </div>
                                </div>
                                <div class="profile-detail-item">
                                    <div class="profile-detail-label">業界</div>
                                    <div class="profile-detail-value">
                                        ${this.getIndustryMatch(profile.industry, this.currentUserProfile?.industry)}
                                    </div>
                                </div>
                            </div>

                            <!-- レーダーチャート -->
                            <div class="profile-detail-radar" id="profile-detail-radar">
                                <canvas></canvas>
                            </div>
                        </div>
                    </div>

                    <!-- 基本情報 -->
                    <div class="profile-detail-section">
                        <h3 class="profile-detail-section-title">
                            <i class="fas fa-user"></i>
                            基本情報
                        </h3>
                        <div class="profile-detail-grid">
                            <div class="profile-detail-item">
                                <div class="profile-detail-label">会社</div>
                                <div class="profile-detail-value">${window.escapeHTML(profile.company || '未設定')}</div>
                            </div>
                            <div class="profile-detail-item">
                                <div class="profile-detail-label">役職</div>
                                <div class="profile-detail-value">${window.escapeHTML(profile.position || '未設定')}</div>
                            </div>
                            <div class="profile-detail-item">
                                <div class="profile-detail-label">業界</div>
                                <div class="profile-detail-value">${window.escapeHTML(profile.industry || '未設定')}</div>
                            </div>
                            <div class="profile-detail-item">
                                <div class="profile-detail-label">地域</div>
                                <div class="profile-detail-value">${window.escapeHTML(profile.location || '未設定')}</div>
                            </div>
                        </div>
                    </div>

                    <!-- 自己紹介 -->
                    ${profile.bio ? `
                        <div class="profile-detail-section">
                            <h3 class="profile-detail-section-title">
                                <i class="fas fa-comment-dots"></i>
                                自己紹介
                            </h3>
                            <div class="profile-detail-bio">
                                ${window.escapeHTML(profile.bio)}
                            </div>
                        </div>
                    ` : ''}

                    <!-- スキル -->
                    ${profile.skills && profile.skills.length > 0 ? `
                        <div class="profile-detail-section">
                            <h3 class="profile-detail-section-title">
                                <i class="fas fa-code"></i>
                                スキル
                            </h3>
                            <div class="profile-detail-tags">
                                ${profile.skills.map(skill => `
                                    <span class="profile-detail-tag skill">${window.escapeHTML(skill)}</span>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}

                    <!-- 興味・関心 -->
                    ${profile.interests && profile.interests.length > 0 ? `
                        <div class="profile-detail-section">
                            <h3 class="profile-detail-section-title">
                                <i class="fas fa-heart"></i>
                                興味・関心
                            </h3>
                            <div class="profile-detail-tags">
                                ${profile.interests.map(interest => `
                                    <span class="profile-detail-tag interest">${window.escapeHTML(interest)}</span>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}

                    <!-- tl;dv情報 -->
                    ${meetingMinutes && meetingMinutes.length > 0 ? `
                        <div class="profile-detail-section">
                            <h3 class="profile-detail-section-title">
                                <i class="fas fa-video"></i>
                                最近のミーティング活動
                            </h3>
                            <div class="profile-detail-tldv">
                                <div class="profile-detail-tldv-title">
                                    tl;dv 議事録データ
                                </div>
                                ${meetingMinutes.map(minute => `
                                    <div style="margin-bottom: 15px;">
                                        <strong>${minute.meeting_title || '無題のミーティング'}</strong>
                                        <div style="color: #666; font-size: 14px;">
                                            ${new Date(minute.meeting_date).toLocaleDateString('ja-JP')}
                                        </div>
                                        ${minute.summary ? `<p style="margin-top: 5px;">${minute.summary}</p>` : ''}
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}

                    <!-- アクション -->
                    <div class="profile-detail-actions">
                        <button class="profile-detail-btn profile-detail-btn-primary"
                                onclick="window.profileDetailModal.sendConnect('${window.escapeAttr(profile.id)}')">
                            <i class="fas fa-link"></i>
                            コネクト申請
                        </button>
                        <button class="profile-detail-btn profile-detail-btn-secondary"
                                onclick="window.profileDetailModal.sendMessage('${window.escapeAttr(profile.id)}')">
                            <i class="fas fa-envelope"></i>
                            メッセージ送信
                        </button>
                        <button class="profile-detail-btn profile-detail-btn-secondary"
                                onclick="window.profileDetailModal.bookmark('${window.escapeAttr(profile.id)}')">
                            <i class="fas fa-bookmark"></i>
                            ブックマーク
                        </button>
                    </div>
                </div>
            `;

            // レーダーチャートを描画
            setTimeout(() => this.drawRadarChart(profile), 100);
        }

        getCommonElements(arr1, arr2) {
            if (!arr1 || !arr2) return [];
            return arr1.filter(item => arr2.includes(item));
        }

        getLocationMatch(loc1, loc2) {
            if (!loc1 || !loc2) return '不明';
            const s1 = window.escapeHTML(loc1), s2 = window.escapeHTML(loc2);
            if (loc1 === loc2) return `同じ地域 (${s1})`;
            return `${s1} ↔ ${s2}`;
        }

        getIndustryMatch(ind1, ind2) {
            if (!ind1 || !ind2) return '不明';
            const s1 = window.escapeHTML(ind1), s2 = window.escapeHTML(ind2);
            if (ind1 === ind2) return `同じ業界 (${s1})`;
            return `${s1} ↔ ${s2}`;
        }

        drawRadarChart(profile) {
            const canvas = document.querySelector('#profile-detail-radar canvas');
            if (!canvas) return;

            // 既に描画済みの場合はスキップ
            if (canvas.dataset.rendered === 'true') {
                // console.log('[ProfileDetailModal] レーダーチャート既に描画済み');
                return;
            }

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            // Retina/高DPIディスプレイ対応
            const dpr = window.devicePixelRatio || 1;

            // Canvas表示サイズ
            const displayWidth = 260;
            const displayHeight = 260;

            // 既存の属性をクリア
            canvas.removeAttribute('width');
            canvas.removeAttribute('height');

            // Canvasの実際のピクセルサイズを高DPI対応
            canvas.width = displayWidth * dpr;
            canvas.height = displayHeight * dpr;

            // CSSで表示サイズを設定
            canvas.style.width = displayWidth + 'px';
            canvas.style.height = displayHeight + 'px';

            // 描画コンテキストをスケール
            ctx.scale(dpr, dpr);

            const centerX = displayWidth / 2;
            const centerY = displayHeight / 2;
            const radius = 100;

            // 背景
            ctx.fillStyle = '#f8f9fa';
            ctx.fillRect(0, 0, displayWidth, displayHeight);

            // グリッド
            ctx.strokeStyle = '#e0e0e0';
            ctx.lineWidth = 1;

            for (let i = 1; i <= 5; i++) {
                ctx.beginPath();
                for (let j = 0; j < 6; j++) {
                    const angle = (Math.PI * 2 / 6) * j - Math.PI / 2;
                    const x = centerX + Math.cos(angle) * (radius * i / 5);
                    const y = centerY + Math.sin(angle) * (radius * i / 5);
                    if (j === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.closePath();
                ctx.stroke();
            }

            // 軸（matching-unified.jsと同じ順序）
            const labels = ['スキル', '経験', '業界', '地域', '活動', '興味'];
            ctx.fillStyle = '#666';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';

            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI * 2 / 6) * i - Math.PI / 2;
                const x = centerX + Math.cos(angle) * (radius + 20);
                const y = centerY + Math.sin(angle) * (radius + 20);
                ctx.fillText(labels[i], x, y);
            }

            // データ（matching-unified.jsの計算関数を使用）
            let values;
            if (window.matchingScoreFix &&
                window.matchingScoreFix.calculateExperienceScore &&
                window.matchingScoreFix.calculateActivityScore &&
                window.matchingScoreFix.calculateIndustryScore &&
                window.matchingScoreFix.calculateLocationScore &&
                window.matchingScoreFix.calculateSkillScore &&
                window.matchingScoreFix.calculateInterestScore) {
                // matching-unified.jsの計算関数を使用（質的評価）
                values = [
                    window.matchingScoreFix.calculateSkillScore(profile), // スキル（質的評価）
                    window.matchingScoreFix.calculateExperienceScore(profile), // 経験（実データ）
                    window.matchingScoreFix.calculateIndustryScore(profile), // 業界（公平スコア）
                    window.matchingScoreFix.calculateLocationScore(profile), // 地域（公平スコア）
                    window.matchingScoreFix.calculateActivityScore(profile), // 活動（実データ）
                    window.matchingScoreFix.calculateInterestScore(profile) // 興味（質的評価）
                ];
            } else {
                // フォールバック（matching-unified.jsが読み込まれていない場合）
                values = [
                    Math.min((profile.skills?.length || 0) * 20, 100),
                    50, // 経験（固定値）
                    profile.industry ? 80 : 30,
                    profile.location ? 80 : 30,
                    50, // 活動（固定値）
                    Math.min((profile.interests?.length || 0) * 25, 100)
                ];
            }

            // データポリゴン
            ctx.fillStyle = 'rgba(74, 144, 226, 0.3)';
            ctx.strokeStyle = '#4A90E2';
            ctx.lineWidth = 2;
            ctx.beginPath();

            values.forEach((value, i) => {
                const angle = (Math.PI * 2 / 6) * i - Math.PI / 2;
                const x = centerX + Math.cos(angle) * (radius * Math.min(value, 100) / 100);
                const y = centerY + Math.sin(angle) * (radius * Math.min(value, 100) / 100);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });

            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // 描画完了フラグを設定
            canvas.dataset.rendered = 'true';
        }

        async sendConnect(profileId) {
            try {
                const user = await window.safeGetUser();
                if (!user) {
                    if (window.showToast) window.showToast('ログインが必要です', 'warning');
                    return;
                }

                // 既存のコネクションをチェック
                const { data: existing } = await window.supabaseClient
                    .from('connections')
                    .select('*')
                    .eq('user_id', user.id)
                    .eq('connected_user_id', profileId)
                    .maybeSingle();

                if (existing) {
                    if (window.showToast) window.showToast('既にコネクト申請済みです', 'warning');
                    return;
                }

                // コネクト申請
                const { error } = await window.supabaseClient
                    .from('connections')
                    .insert({
                        user_id: user.id,
                        connected_user_id: profileId,
                        status: 'pending'
                    });

                if (error) throw error;

                if (window.showToast) window.showToast('コネクト申請を送信しました！', 'success');
                this.close();

            } catch (error) {
                console.error('[ProfileDetailModal] コネクト申請エラー:', error);
                if (window.showToast) window.showToast('コネクト申請の送信に失敗しました', 'error');
            }
        }

        sendMessage(profileId) {
            // メッセージページへ遷移
            window.location.href = `messages.html?to=${profileId}`;
        }

        async bookmark(profileId) {
            try {
                const user = await window.safeGetUser();
                if (!user) {
                    if (window.showToast) window.showToast('ログインが必要です', 'warning');
                    return;
                }

                // ブックマーク機能（仮実装）
                if (window.showToast) window.showToast('ブックマーク機能は準備中です', 'info');

            } catch (error) {
                console.error('[ProfileDetailModal] ブックマークエラー:', error);
            }
        }

        showError(message) {
            const content = this.modal.querySelector('.profile-detail-content');
            content.innerHTML = `
                <div class="profile-detail-loading">
                    <i class="fas fa-exclamation-circle" style="font-size: 48px; color: #e74c3c; margin-bottom: 20px;"></i>
                    <p>エラーが発生しました</p>
                    <p style="color: #999; font-size: 14px; margin-top: 10px;">${window.escapeHTML ? window.escapeHTML(message) : message}</p>
                    <button class="profile-detail-btn profile-detail-btn-secondary"
                            onclick="window.profileDetailModal.close()"
                            style="margin-top: 20px;">
                        閉じる
                    </button>
                </div>
            `;
        }

        close() {
            if (this.modal) {
                // Canvas描画フラグをリセット
                const canvas = this.modal.querySelector('#profile-detail-radar canvas');
                if (canvas) {
                    canvas.dataset.rendered = 'false';
                }

                this.modal.classList.remove('show');
                setTimeout(() => {
                    this.modal.remove();
                    this.modal = null;
                    this.currentProfileId = null;
                }, 300);
            }
        }
    }

    // グローバル公開
    window.profileDetailModal = new ProfileDetailModal();

    // ==========================================
    // 後方互換エイリアス（members-profile-modal.js互換）
    // ==========================================
    window.ProfileDetailModal = ProfileDetailModal;
    window.membersProfileModal = window.profileDetailModal;
    window.showMemberProfileModal = function(userId) {
        if (window.profileDetailModal) {
            window.profileDetailModal.show(userId);
        }
    };

})();
