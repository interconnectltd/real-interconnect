/**
 * アバターサイズ強制適用スクリプト
 * CSSの競合を完全に解決
 */

(function() {
    'use strict';
    
    // console.log('[AvatarEnforcer] 初期化開始');
    
    // サイズ定義
    const AVATAR_SIZES = {
        header: { width: 36, height: 36 },
        member: { width: 60, height: 60 },
        profile: { width: 120, height: 120 },
        message: { width: 32, height: 32 },
        sidebar: { width: 40, height: 40 },
        default: { width: 36, height: 36 }
    };
    
    // コンテキスト判定
    function getAvatarContext(element) {
        const parent = element.closest('.navbar, .header, .member-card, .profile-header, .message-item, .sidebar');
        
        if (!parent) return 'default';
        
        if (parent.classList.contains('navbar') || parent.classList.contains('header')) {
            return 'header';
        } else if (parent.classList.contains('member-card')) {
            return 'member';
        } else if (parent.classList.contains('profile-header')) {
            return 'profile';
        } else if (parent.classList.contains('message-item')) {
            return 'message';
        } else if (parent.classList.contains('sidebar')) {
            return 'sidebar';
        }
        
        return 'default';
    }
    
    // サイズ強制適用
    function enforceAvatarSizes() {
        const avatars = document.querySelectorAll('.user-avatar');
        let fixedCount = 0;
        
        avatars.forEach(avatar => {
            const context = getAvatarContext(avatar);
            const size = AVATAR_SIZES[context];
            
            // 現在のサイズを取得
            const currentWidth = avatar.offsetWidth;
            const currentHeight = avatar.offsetHeight;
            
            // サイズが異なる場合は修正
            if (currentWidth !== size.width || currentHeight !== size.height) {
                // console.warn(`[AvatarEnforcer] サイズ不一致検出:`, {
                //     element: avatar,
                //     context: context,
                //     current: `${currentWidth}x${currentHeight}`,
                //     expected: `${size.width}x${size.height}`,
                //     parent: avatar.parentElement?.className
                // });
                
                // インラインスタイルで強制（最高優先度）
                avatar.style.width = `${size.width}px`;
                avatar.style.height = `${size.height}px`;
                avatar.style.minWidth = `${size.width}px`;
                avatar.style.minHeight = `${size.height}px`;
                avatar.style.maxWidth = `${size.width}px`;
                avatar.style.maxHeight = `${size.height}px`;
                
                fixedCount++;
            }
            
            // デフォルト画像の処理
            if (avatar.src && avatar.src.includes('default-avatar')) {
                handleDefaultAvatar(avatar);
            }
            
            // データ属性を設定（デバッグ用）
            avatar.setAttribute('data-context', context);
            avatar.setAttribute('data-size', `${size.width}x${size.height}`);
        });
        
        if (fixedCount > 0) {
            // console.log(`[AvatarEnforcer] ${fixedCount}個のアバターサイズを修正`);
        }
        
        return fixedCount;
    }
    
    // デフォルトアバター処理
    function handleDefaultAvatar(avatar) {
        // ユーザー名からイニシャルを生成
        const userName = document.querySelector('.user-name')?.textContent || 'U';
        const initials = userName.split(' ').map(word => word[0]).join('').substring(0, 2);
        avatar.setAttribute('data-initials', initials.toUpperCase());
    }
    
    // CSS競合検出
    function detectCSSConflicts() {
        const stylesheets = Array.from(document.styleSheets);
        const conflicts = [];
        
        stylesheets.forEach(sheet => {
            try {
                const rules = Array.from(sheet.cssRules || sheet.rules || []);
                rules.forEach(rule => {
                    if (rule.selectorText && rule.selectorText.includes('user-avatar')) {
                        const styles = rule.style;
                        if (styles.width || styles.height) {
                            conflicts.push({
                                file: sheet.href?.split('/').pop() || 'inline',
                                selector: rule.selectorText,
                                width: styles.width,
                                height: styles.height
                            });
                        }
                    }
                });
            } catch (e) {
                // CORS制限によるアクセスエラーは無視
            }
        });
        
        if (conflicts.length > 0) {
            // console.warn('[AvatarEnforcer] CSS競合検出:', conflicts);
        }
        
        return conflicts;
    }
    
    // 動的に追加される要素を監視
    function observeAvatars() {
        const observer = new MutationObserver((mutations) => {
            let hasNewAvatars = false;
            
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) { // Element node
                        if (node.classList?.contains('user-avatar') || node.id === 'userAvatar') {
                            hasNewAvatars = true;
                        } else if (node.querySelector) {
                            const avatars = node.querySelectorAll('.user-avatar');
                            if (avatars.length > 0) {
                                hasNewAvatars = true;
                            }
                        }
                    }
                });
            });
            
            if (hasNewAvatars) {
                // console.log('[AvatarEnforcer] 新しいアバター要素を検出');
                setTimeout(enforceAvatarSizes, 100);
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
    
    // 初期化
    function initialize() {
        // console.log('[AvatarEnforcer] 実行開始');
        
        // CSS競合をチェック
        const conflicts = detectCSSConflicts();
        if (conflicts.length > 0) {
            // console.warn(`[AvatarEnforcer] ${conflicts.length}個のCSS競合を検出`);
        }
        
        // 初回適用
        const fixed = enforceAvatarSizes();
        
        // 画像読み込み後に再チェック
        document.querySelectorAll('.user-avatar').forEach(img => {
            if (img.tagName === 'IMG' && !img.complete) {
                img.addEventListener('load', () => {
                    const context = getAvatarContext(img);
                    const size = AVATAR_SIZES[context];
                    img.style.width = `${size.width}px`;
                    img.style.height = `${size.height}px`;
                });
            }
        });
        
        // 動的要素の監視開始
        observeAvatars();
        
        // ウィンドウリサイズ時の再適用
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(enforceAvatarSizes, 250);
        });
        
        // console.log('[AvatarEnforcer] 初期化完了');
    }
    
    // DOMContentLoaded後に実行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
    
    // さらに確実にするため、少し遅延して再実行
    setTimeout(initialize, 500);
    
    // グローバルAPIとして公開（デバッグ用）
    window.AvatarEnforcer = {
        enforce: enforceAvatarSizes,
        detectConflicts: detectCSSConflicts,
        getSizes: () => AVATAR_SIZES
    };
})();