// ============================================================
// Section: homepage-perfect-final.js
// ============================================================
/**
 * Homepage Perfect Final
 * 完璧な最終版 - すべての競合を解決し、必要な機能を統合
 */

(function() {
    'use strict';

    // console.log('[PerfectFinal] 初期化開始');

    // グローバル状態管理
    const GlobalState = {
        initialized: false,
        loadingComplete: false,
        animationsStarted: false,
        scrollObserversSetup: false
    };

    // すべての競合スクリプトを無効化
    const DisableConflicts = {
        init() {
            // 競合する可能性のあるすべての関数を無効化
            const conflictingFunctions = [
                'observeLoadingScreen', 'initLoadingScreen', 'createLoadingScreen',
                'hideLoadingScreen', 'checkLoadingComplete', 'initHeroAnimation',
                'typewriterEffect', 'animateTitle', 'startPageAnimations',
                'initScrollAnimations', 'digitalTextEffect', 'LoadingManager',
                'UnifiedLoader', 'AllConflictsFix', 'initScrollEffects'
            ];

            conflictingFunctions.forEach(fn => {
                if (window[fn]) {
                    window[fn] = () => {}; // console.log(`[PerfectFinal] ${fn} は無効化されています`);
                }
            });

            // イベントリスナーの上書き
            this.overrideEventListeners();
        },

        overrideEventListeners() {
            // EventTarget.prototypeの上書きは危険なので削除
            // 代わりに特定の要素に対してのみ制御する
            const blockList = [
                'observeLoadingScreen', 'initLoadingScreen', 'createLoadingScreen',
                'hideLoadingScreen', 'checkLoadingComplete', 'initHeroAnimation',
                'typewriterEffect', 'animateTitle', 'startPageAnimations',
                'initScrollAnimations', 'digitalTextEffect', 'LoadingManager',
                'UnifiedLoader', 'AllConflictsFix'
            ];

            // 既存の競合関数を無効化するだけに留める
            blockList.forEach(fn => {
                if (window[fn] && typeof window[fn] === 'function') {
                    const originalName = `_original_${fn}`;
                    window[originalName] = window[fn];
                    window[fn] = () => {};
                }
            });
        }
    };

    // 完璧なローディング管理
    const PerfectLoader = {
        init() {
            if (GlobalState.initialized) return;
            GlobalState.initialized = true;

            const screen = document.getElementById('instantLoadingScreen');
            if (!screen || screen.style.display === 'none') {
                GlobalState.loadingComplete = true;
                this.onComplete();
                return;
            }

            // プログレスバーアニメーションを開始（段階的に）
            const bar = document.getElementById('loadingBar');
            if (bar) {
                setTimeout(() => bar.style.width = '40%', 50);
                setTimeout(() => bar.style.width = '80%', 150);
                setTimeout(() => bar.style.width = '100%', 250);
            }

            // 動画の追加（重複チェック付き）
            this.setupVideo(screen);

            // 完了処理のセットアップ
            this.setupCompletion(screen);
        },

        setupVideo(screen) {
            return;
        },

        setupCompletion(screen) {
            const minTime = 300;
            const self = this;

            const complete = () => {
                if (GlobalState.loadingComplete) return;
                GlobalState.loadingComplete = true;

                // ローディング画面の裏でボタン以外を非表示にする（フラッシュ防止）
                ['.section-badge', '.hero-title', '.hero-subtitle'].forEach(sel => {
                    const el = document.querySelector(sel);
                    if (el) { el.style.opacity = '0'; el.style.visibility = 'hidden'; }
                });

                // ローディング画面フェードアウト
                screen.style.transition = 'opacity 0.4s ease-out';
                screen.style.opacity = '0';

                // フェードアウト完了後にアニメーション開始
                setTimeout(() => {
                    screen.style.display = 'none';
                    document.body.style.overflow = '';
                    document.body.classList.add('loading-complete');
                    self.onComplete();
                }, 400);
            };

            setTimeout(() => {
                complete();
            }, minTime);
        },

        onComplete() {
            const screen = document.getElementById('instantLoadingScreen');
            if (screen) {
                screen.style.display = 'none';
            }

            PerfectAnimator.start();
            ScrollEffects.init();
        }
    };

    // 完璧なアニメーション管理
    const PerfectAnimator = {
        start() {
            if (GlobalState.animationsStarted) return;
            GlobalState.animationsStarted = true;

            // console.log('[PerfectFinal] アニメーション開始');

            // ヒーロー動画再生は main.js に任せる（重複防止）
            // const heroVideo = document.querySelector('.hero-video');
            // if (heroVideo) {
            //     heroVideo.play().catch(err => {});
            // }

            // タイトルアニメーション
            this.animateHeroTitle();

            // その他の要素フェードイン
            this.fadeInElements();
        },

        animateHeroTitle() {
            const elements = [
                { selector: '.section-badge', delay: 0 },
                { selector: '.hero-title', delay: 100 },
                { selector: '.hero-subtitle', delay: 600 }
            ];

            elements.forEach(item => {
                const element = document.querySelector(item.selector);
                if (element) {
                    const originalText = element.textContent;
                    const originalHTML = element.innerHTML;

                    const hasIcon = originalHTML.includes('<i');
                    let iconHTML = '';
                    if (hasIcon) {
                        const iconMatch = originalHTML.match(/<i[^>]*>.*?<\/i>/);
                        if (iconMatch) {
                            iconHTML = iconMatch[0] + ' ';
                        }
                    }

                    element.textContent = '';
                    element.style.visibility = 'visible';
                    element.style.opacity = '1';

                    setTimeout(() => {
                        this.typeWriter(element, originalText.trim(), iconHTML);
                    }, item.delay);
                }
            });
        },

        typeWriter(element, text, iconHTML = '') {
            let index = 0;
            const speed = 22;

            if (iconHTML) {
                element.innerHTML = iconHTML;
            }

            function type() {
                if (index < text.length) {
                    if (iconHTML) {
                        element.innerHTML = iconHTML + text.substring(0, index + 1);
                    } else {
                        element.textContent = text.substring(0, index + 1);
                    }
                    index++;
                    setTimeout(type, speed);
                } else {
                    if (element.classList.contains('hero-subtitle')) {
                        setTimeout(() => {
                            const buttons = document.querySelector('.hero-buttons');
                            if (buttons) {
                                buttons.style.opacity = '1';
                                buttons.style.visibility = 'visible';
                                buttons.style.transform = 'translateY(0)';
                            }
                        }, 100);
                    }
                }
            }

            type();
        },


        fadeInElements() {
            const elements = [
                '.section-badge',
                '.hero-buttons',
                '.scroll-indicator'
            ];

            elements.forEach((selector) => {
                const el = document.querySelector(selector);
                if (el) {
                    el.style.opacity = '1';
                    el.style.transform = 'none';
                    el.style.transition = 'none';
                    el.style.visibility = 'visible';
                }
            });
        }
    };

    // スクロールエフェクト（scroll-fade.jsの機能を統合）
    const ScrollEffects = {
        init() {
            if (GlobalState.scrollObserversSetup) return;
            GlobalState.scrollObserversSetup = true;

            // console.log('[PerfectFinal] スクロールエフェクト初期化');

            // フェードイン対象要素
            const fadeElements = document.querySelectorAll(
                '.service-card, .comparison-item, .case-study, .data-card, ' +
                '.pricing-card, .process-step, .faq-category, .news-month, ' +
                '.cta-card, .section-title, .section-description, .about-item, ' +
                '.feature-card, .event-card, .contact-item'
            );

            if (!('IntersectionObserver' in window)) {
                fadeElements.forEach(el => {
                    el.style.opacity = '1';
                    el.style.transform = 'none';
                });
                return;
            }

            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('visible');
                        observer.unobserve(entry.target);
                    }
                });
            }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

            fadeElements.forEach(el => observer.observe(el));

            // 数字カウントアップ
            this.setupCounters();
        },

        setupCounters() {
            const counterElements = document.querySelectorAll('.data-value');
            if (!counterElements.length) return;

            const performanceSection = document.querySelector('.performance-data');
            if (!performanceSection) return;

            const counterObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        counterElements.forEach(el => {
                            this.animateCounter(el, el.textContent);
                        });
                        counterObserver.unobserve(entry.target);
                        // メモリリーク防止: 全要素の監視解除後にObserverを破棄
                        counterObserver.disconnect();
                    }
                });
            }, { threshold: 0.3 });

            counterObserver.observe(performanceSection);
        },

        animateCounter(element, target) {
            const duration = 2000;
            const steps = 60;
            const stepDuration = duration / steps;
            const numericTarget = parseFloat(target.replace(/[^0-9.]/g, ''));
            let current = 0;

            element.textContent = '0';

            const counter = setInterval(() => {
                current += numericTarget / steps;

                if (current >= numericTarget) {
                    current = numericTarget;
                    element.textContent = target;
                    clearInterval(counter);
                } else {
                    const randomNum = Math.floor(Math.random() * numericTarget * 1.5);
                    element.textContent = randomNum + target.replace(/[0-9.]+/, '');
                }
            }, stepDuration);
        }
    };

    // 初期化実行
    DisableConflicts.init();

    // エラーハンドリング追加
    window.addEventListener('error', (e) => {
        // console.error('エラー検出:', e);
        // ローディング画面が残っている場合は強制削除
        const screen = document.getElementById('instantLoadingScreen');
        if (screen && screen.style.display !== 'none') {
            screen.style.display = 'none';
            document.body.style.overflow = '';
        }
    });

    // DOMContentLoadedで即初期化（loadイベントは28MB動画を待つため遅い）
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            PerfectLoader.init();
        });
    } else {
        PerfectLoader.init();
    }

})();

// ============================================================
// Section: referral-landing.js
// ============================================================
// 紹介リンクからのランディング処理
// console.log('=== 紹介リンク処理開始 ===');

(function() {
    // URLから紹介コードを取得
    const path = window.location.pathname;
    const referralMatch = path.match(/^\/invite\/([A-Z0-9]{4}-[A-Z0-9]{4})$/);

    if (referralMatch) {
        const referralCode = referralMatch[1];
        // console.log('[Referral] 紹介コード検出:', referralCode);

        // セッションストレージに保存
        sessionStorage.setItem('referral_code', referralCode);
        sessionStorage.setItem('referral_timestamp', new Date().toISOString());

        // Cookieにも保存（7日間有効）
        document.cookie = `referral_code=${referralCode}; path=/; max-age=${7 * 24 * 60 * 60}`;

        // 紹介リンクの使用履歴を記録
        recordReferralVisit(referralCode);

        // ホームページにリダイレクト（クエリパラメータ付き）
        window.location.href = `/?ref=${referralCode}`;
    } else {
        // クエリパラメータから紹介コードを確認
        const urlParams = new URLSearchParams(window.location.search);
        const refCode = urlParams.get('ref');

        if (refCode && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(refCode)) {
            // console.log('[Referral] クエリパラメータから紹介コード検出:', refCode);
            sessionStorage.setItem('referral_code', refCode);
            sessionStorage.setItem('referral_timestamp', new Date().toISOString());

            // 紹介バナーを表示
            showReferralBanner(refCode);
        }
    }

    // 紹介コードがある場合は、CTAボタンをカスタマイズ
    const referralCode = sessionStorage.getItem('referral_code');
    if (referralCode) {
        customizeCTAButtons(referralCode);
    }
})();

// 紹介リンクの訪問を記録
async function recordReferralVisit(code) {
    try {
        // Supabaseが初期化されるまで待つ
        await window.waitForSupabase();
        if (window.supabaseClient) {
            // invite_historyに記録
            const { error } = await window.supabaseClient
                .from('invite_history')
                .insert({
                    invite_link_id: await getInviteLinkId(code),
                    ip_address: null, // プライバシー保護のため記録しない
                    user_agent: navigator.userAgent
                });

            if (error) {
                console.error('[Referral] 訪問記録エラー:', error);
            }
        }
    } catch (error) {
        console.error('[Referral] 訪問記録エラー:', error);
    }
}

// 紹介コードからリンクIDを取得
async function getInviteLinkId(code) {
    try {
        const { data, error } = await window.supabaseClient
            .from('invite_links')
            .select('id')
            .eq('link_code', code)
            .maybeSingle();

        if (error) throw error;
        return data?.id || null;
    } catch (error) {
        console.error('[Referral] リンクID取得エラー:', error);
        return null;
    }
}

// 紹介バナーを表示
function showReferralBanner(code) {
    // 既存のバナーがあれば削除
    const existingBanner = document.getElementById('referral-banner');
    if (existingBanner) {
        existingBanner.remove();
    }

    // バナーHTML
    const bannerHTML = `
        <div id="referral-banner" class="referral-banner">
            <div class="referral-banner-content">
                <i class="fas fa-gift"></i>
                <span>特別招待リンクから訪問いただきました！</span>
                <span class="referral-code">招待コード: <span id="referral-code-display"></span></span>
                <button onclick="this.parentElement.parentElement.remove()" class="close-btn">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>
    `;

    // バナーを挿入
    document.body.insertAdjacentHTML('afterbegin', bannerHTML);

    // コードをtextContentで安全に設定
    const codeDisplay = document.getElementById('referral-code-display');
    if (codeDisplay) codeDisplay.textContent = code;

    // バナーのスタイルを追加
    if (!document.getElementById('referral-banner-styles')) {
        const styles = `
            <style id="referral-banner-styles">
                .referral-banner {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
                    color: white;
                    padding: 1rem;
                    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
                    z-index: 9999;
                    animation: slideDown 0.5s ease-out;
                }

                .referral-banner-content {
                    max-width: 1200px;
                    margin: 0 auto;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 1rem;
                    font-size: 1rem;
                    font-weight: 500;
                }

                .referral-code {
                    background: rgba(255, 255, 255, 0.2);
                    padding: 0.25rem 0.75rem;
                    border-radius: 20px;
                    font-family: monospace;
                }

                .close-btn {
                    background: none;
                    border: none;
                    color: white;
                    cursor: pointer;
                    padding: 0.5rem;
                    margin-left: auto;
                    opacity: 0.8;
                    transition: opacity 0.2s;
                }

                .close-btn:hover {
                    opacity: 1;
                }

                @keyframes slideDown {
                    from {
                        transform: translateY(-100%);
                    }
                    to {
                        transform: translateY(0);
                    }
                }

                /* ヘッダーがある場合のスペース調整 */
                body.has-referral-banner {
                    padding-top: 60px;
                }
            </style>
        `;
        document.head.insertAdjacentHTML('beforeend', styles);
    }

    // bodyにクラスを追加
    document.body.classList.add('has-referral-banner');
}

// CTAボタンをカスタマイズ
function customizeCTAButtons(referralCode) {
    // referralCode のバリデーション
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(referralCode)) return;

    // 面談予約ボタンを探して紹介コードを追加
    const ctaButtons = document.querySelectorAll('a[href*="register"], a[href*="signup"], button[onclick*="register"]');

    ctaButtons.forEach(button => {
        if (button.tagName === 'A') {
            // リンクの場合
            const url = new URL(button.href, window.location.origin);
            url.searchParams.set('ref', referralCode);
            button.href = url.toString();
        } else if (button.tagName === 'BUTTON') {
            // ボタンの場合、addEventListenerで安全に処理
            const safeCode = referralCode; // already validated above
            button.addEventListener('click', () => {
                sessionStorage.setItem('referral_code', safeCode);
            });
        }
    });

    // 「今すぐ始める」ボタンなどを探して更新
    document.querySelectorAll('.hero-cta, .cta-button, .start-button').forEach(button => {
        button.addEventListener('click', (e) => {
            // 紹介コードを確実に保持
            sessionStorage.setItem('referral_code', referralCode);
        });
    });
}


// console.log('=== 紹介リンク処理準備完了 ===');
