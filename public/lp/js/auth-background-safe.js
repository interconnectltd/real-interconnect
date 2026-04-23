// Safe Particles.js Background for Auth Pages
document.addEventListener('DOMContentLoaded', function() {
    // 既存の背景要素があるかチェック
    if (document.getElementById('particles-js')) {
        return; // 既に存在する場合は何もしない
    }
    
    // Create canvas container
    const particlesContainer = document.createElement('div');
    particlesContainer.id = 'particles-js';
    particlesContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: -1;
        background: linear-gradient(135deg, #f0f7ff 0%, #e6f2ff 50%, #f0f7ff 100%);
    `;
    
    // 最初の要素として挿入
    if (document.body.firstChild) {
        document.body.insertBefore(particlesContainer, document.body.firstChild);
    } else {
        document.body.appendChild(particlesContainer);
    }

    // Load particles.js from CDN with error handling
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/particles.js/2.0.0/particles.min.js';
    
    script.onload = function() {
        // particles.jsが読み込まれたかチェック
        if (typeof particlesJS !== 'undefined') {
            initParticles();
        } else {
            console.warn('particlesJS is not defined');
            // フォールバック: シンプルなCSSアニメーション背景
            createCSSFallback();
        }
    };
    
    script.onerror = function() {
        console.error('Failed to load particles.js');
        // フォールバック: シンプルなCSSアニメーション背景
        createCSSFallback();
    };
    
    document.head.appendChild(script);

    // 追加の装飾要素（軽量版）
    createFloatingElements();
    
    // クリーンアップ処理
    window.addEventListener('beforeunload', cleanup);
});

// パーティクルの初期化
function initParticles() {
    try {
        particlesJS('particles-js', {
            particles: {
                number: {
                    value: 50, // パフォーマンスのため数を減らす
                    density: {
                        enable: true,
                        value_area: 1000
                    }
                },
                color: {
                    value: ['#0066ff', '#3b82f6', '#60a5fa']
                },
                shape: {
                    type: 'circle'
                },
                opacity: {
                    value: 0.3,
                    random: true,
                    anim: {
                        enable: true,
                        speed: 0.5,
                        opacity_min: 0.1,
                        sync: false
                    }
                },
                size: {
                    value: 3,
                    random: true,
                    anim: {
                        enable: true,
                        speed: 1,
                        size_min: 0.5,
                        sync: false
                    }
                },
                line_linked: {
                    enable: true,
                    distance: 150,
                    color: '#0066ff',
                    opacity: 0.15,
                    width: 1
                },
                move: {
                    enable: true,
                    speed: 0.5,
                    direction: 'none',
                    random: true,
                    straight: false,
                    out_mode: 'bounce',
                    bounce: false
                }
            },
            interactivity: {
                detect_on: 'canvas',
                events: {
                    onhover: {
                        enable: true,
                        mode: 'grab'
                    },
                    onclick: {
                        enable: false // クリックイベントを無効化
                    },
                    resize: true
                },
                modes: {
                    grab: {
                        distance: 120,
                        line_linked: {
                            opacity: 0.3
                        }
                    }
                }
            },
            retina_detect: true
        });
    } catch (error) {
        console.error('Error initializing particles:', error);
        createCSSFallback();
    }
}

// 浮遊する装飾要素を作成（軽量版）
function createFloatingElements() {
    const colors = ['#0066ff10', '#3b82f610', '#60a5fa10'];
    const elements = [];
    
    for (let i = 0; i < 3; i++) { // 数を減らす
        const element = document.createElement('div');
        element.className = 'floating-element';
        element.style.cssText = `
            position: fixed;
            width: ${Math.random() * 200 + 100}px;
            height: ${Math.random() * 200 + 100}px;
            background: radial-gradient(circle, ${colors[i % colors.length]} 0%, transparent 70%);
            border-radius: 50%;
            pointer-events: none;
            z-index: -1;
            opacity: 0.3;
            will-change: transform;
        `;
        
        // ランダムな初期位置
        element.style.left = `${Math.random() * 100}%`;
        element.style.top = `${Math.random() * 100}%`;
        
        // アニメーション
        const animation = element.animate([
            { 
                transform: 'translate(0, 0) scale(1)',
                opacity: 0.3
            },
            { 
                transform: `translate(${Math.random() * 100 - 50}px, ${Math.random() * 100 - 50}px) scale(1.2)`,
                opacity: 0.5
            },
            { 
                transform: 'translate(0, 0) scale(1)',
                opacity: 0.3
            }
        ], {
            duration: 20000 + i * 5000,
            iterations: Infinity,
            easing: 'ease-in-out'
        });
        
        elements.push({ element, animation });
        document.body.appendChild(element);
    }
    
    // グローバルに保存（クリーンアップ用）
    window.floatingElements = elements;
}

// CSSフォールバック
function createCSSFallback() {
    const style = document.createElement('style');
    style.textContent = `
        #particles-js::before {
            content: '';
            position: absolute;
            width: 200%;
            height: 200%;
            background-image: 
                radial-gradient(circle at 20% 80%, #0066ff15 0%, transparent 50%),
                radial-gradient(circle at 80% 20%, #3b82f615 0%, transparent 50%),
                radial-gradient(circle at 40% 40%, #60a5fa10 0%, transparent 50%);
            animation: floatBackground 20s ease-in-out infinite;
        }
        
        @keyframes floatBackground {
            0%, 100% { transform: translate(0, 0) rotate(0deg); }
            33% { transform: translate(-20px, -20px) rotate(120deg); }
            66% { transform: translate(20px, -20px) rotate(240deg); }
        }
    `;
    document.head.appendChild(style);
}

// クリーンアップ処理
function cleanup() {
    // アニメーションを停止
    if (window.floatingElements) {
        window.floatingElements.forEach(({ element, animation }) => {
            animation.cancel();
            element.remove();
        });
    }
    
    // パーティクルを停止
    if (window.pJSDom && window.pJSDom.length > 0 && window.pJSDom[0]) {
        if (window.pJSDom[0].pJS && 
            window.pJSDom[0].pJS.fn && 
            window.pJSDom[0].pJS.fn.vendors &&
            typeof window.pJSDom[0].pJS.fn.vendors.destroypJS === 'function') {
            window.pJSDom[0].pJS.fn.vendors.destroypJS();
        }
        window.pJSDom = [];
    }
}