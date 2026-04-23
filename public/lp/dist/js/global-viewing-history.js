/**
 * Global Viewing History
 * 全ページで動作するプロフィール・マッチング詳細の閲覧履歴
 */

(function() {
    'use strict';
    
    // console.log('[GlobalViewingHistory] 閲覧履歴トラッキング初期化');
    
    // グローバル閲覧履歴管理
    window.GlobalViewingHistory = {
        storageKey: 'message_viewing_history',
        maxHistory: 10,
        
        // ユーザー情報を履歴に追加
        addUser(userId, userName, avatarUrl) {
            if (!userId || !userName) return;
            
            let history = this.getHistory();
            
            // 既存の履歴から同じユーザーを削除
            history = history.filter(item => item.userId !== userId);
            
            // 新しい履歴を先頭に追加
            history.unshift({
                userId,
                userName,
                avatarUrl: avatarUrl || 'assets/user-placeholder.svg',
                viewedAt: new Date().toISOString()
            });
            
            // 最大数を超えたら古いものを削除
            if (history.length > this.maxHistory) {
                history = history.slice(0, this.maxHistory);
            }
            
            localStorage.setItem(this.storageKey, JSON.stringify(history));
            // console.log('[GlobalViewingHistory] 履歴に追加:', userName);
        },
        
        // 履歴を取得
        getHistory() {
            const history = localStorage.getItem(this.storageKey);
            if (!history) return [];
            try { return JSON.parse(history); } catch (e) { return []; }
        },
        
        // プロフィール表示を監視
        trackViewProfile() {
            const original = window.viewProfile;
            if (original) {
                window.viewProfile = (userId) => {
                    // console.log('[GlobalViewingHistory] viewProfile:', userId);
                    
                    // 元の関数を実行
                    const result = original(userId);
                    
                    // 履歴に追加
                    setTimeout(() => {
                        this.captureUserInfo(userId);
                    }, 100);
                    
                    return result;
                };
            }
        },
        
        // マッチング詳細表示を監視
        trackShowDetailedReport() {
            const original = window.showDetailedReport;
            if (original) {
                window.showDetailedReport = (profileId) => {
                    // console.log('[GlobalViewingHistory] showDetailedReport:', profileId);
                    
                    // 元の関数を実行
                    const result = original(profileId);
                    
                    // 履歴に追加
                    setTimeout(() => {
                        this.captureUserInfo(profileId);
                    }, 100);
                    
                    return result;
                };
            }
        },
        
        // ユーザー情報を取得して履歴に保存
        captureUserInfo(userId) {
            // 様々な場所からユーザー情報を探す
            let userName = null;
            let avatarUrl = null;
            
            // 1. data属性から探す
            const elements = document.querySelectorAll(`[data-profile-id="${userId}"], [data-user-id="${userId}"]`);
            for (const el of elements) {
                if (!userName) {
                    userName = el.querySelector('.user-info h3')?.textContent ||
                              el.querySelector('h3')?.textContent ||
                              el.querySelector('.member-name')?.textContent ||
                              el.querySelector('.matching-card h3')?.textContent ||
                              el.querySelector('.profile-name')?.textContent;
                }
                if (!avatarUrl) {
                    avatarUrl = el.querySelector('img')?.src;
                }
                if (userName && avatarUrl) break;
            }
            
            // 2. グローバルデータから探す
            if (!userName && window.MPI?.profiles) {
                const profile = window.MPI.profiles.find(p => p.id === userId);
                if (profile) {
                    userName = profile.display_name || profile.name;
                    avatarUrl = profile.avatar_url;
                }
            }
            
            // 3. モーダルから探す
            if (!userName) {
                const modal = document.querySelector('.modal.show, #profileModal');
                if (modal) {
                    userName = modal.querySelector('.profile-name')?.textContent ||
                              modal.querySelector('h2')?.textContent;
                    avatarUrl = modal.querySelector('.profile-avatar img')?.src ||
                               modal.querySelector('img')?.src;
                }
            }
            
            // 履歴に追加
            if (userName) {
                this.addUser(userId, userName.trim(), avatarUrl);
            }
        },
        
        // 初期化
        init() {
            // 既存の関数を監視
            this.trackViewProfile();
            this.trackShowDetailedReport();
            
            // クリックイベントも監視
            document.addEventListener('click', (e) => {
                // プロフィールボタンをクリックした場合
                const profileBtn = e.target.closest('button[onclick*="viewProfile"], a[href*="profile.html"]');
                if (profileBtn) {
                    const card = profileBtn.closest('[data-profile-id], [data-user-id]');
                    if (card) {
                        const userId = card.dataset.profileId || card.dataset.userId;
                        if (userId) {
                            setTimeout(() => this.captureUserInfo(userId), 100);
                        }
                    }
                }
                
                // マッチング詳細ボタンをクリックした場合
                const detailBtn = e.target.closest('button[onclick*="showDetailedReport"]');
                if (detailBtn) {
                    const card = detailBtn.closest('[data-profile-id]');
                    if (card) {
                        const userId = card.dataset.profileId;
                        if (userId) {
                            setTimeout(() => this.captureUserInfo(userId), 100);
                        }
                    }
                }
            });
            
            // console.log('[GlobalViewingHistory] 初期化完了');
        }
    };
    
    // 初期化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.GlobalViewingHistory.init();
        });
    } else {
        window.GlobalViewingHistory.init();
    }
    
})();