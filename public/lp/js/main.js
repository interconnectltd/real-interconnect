/**
 * INTERCONNECT Main JavaScript
 */

(function() {
    'use strict';

    // showToast fallback for pages without notification-system-unified.js (e.g. index.html)
    function toast(message, type) {
        if (window.showToast) {
            window.showToast(message, type);
        } else {
            // Minimal inline toast
            const el = document.createElement('div');
            el.textContent = message;
            const bg = type === 'error' ? '#e74c3c' : type === 'warning' ? '#f39c12' : '#27ae60';
            el.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;padding:14px 24px;border-radius:8px;color:#fff;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,.3);opacity:0;transition:opacity .3s;background:' + bg;
            document.body.appendChild(el);
            requestAnimationFrame(() => el.style.opacity = '1');
            setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3500);
        }
    }

    // Wait for DOM to be ready
    document.addEventListener('DOMContentLoaded', function() {
        initializeApp();
    });

    /**
     * Initialize all app features
     */
    function initializeApp() {
        initNavigation();
        initScrollEffects();
        initContactForm();
        initVideoHandling();
        loadDynamicContent();
    }

    /**
     * Initialize navigation
     */
    function initNavigation() {
        const navbar = document.querySelector('.navbar');
        const navToggler = document.querySelector('.navbar-toggler');
        const navMenu = document.querySelector('.navbar-nav');
        const navLinks = document.querySelectorAll('.nav-link');

        function closeMenu() {
            if (navMenu) navMenu.classList.remove('active');
            if (navToggler) navToggler.classList.remove('active');
            if (navbar) navbar.classList.remove('menu-open');
        }

        // Mobile menu toggle
        if (navToggler) {
            navToggler.addEventListener('click', function(e) {
                e.stopPropagation();
                const isOpen = navMenu.classList.toggle('active');
                this.classList.toggle('active');
                if (navbar) navbar.classList.toggle('menu-open', isOpen);
            });
        }

        // Close mobile menu when clicking outside
        document.addEventListener('click', function(e) {
            if (navToggler && navMenu &&
                !navToggler.contains(e.target) &&
                !navMenu.contains(e.target) &&
                navMenu.classList.contains('active')) {
                closeMenu();
            }
        });

        // Close on Escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && navMenu && navMenu.classList.contains('active')) {
                closeMenu();
            }
        });

        // Close mobile menu on link click
        navLinks.forEach(link => {
            link.addEventListener('click', function() {
                if (navMenu && navMenu.classList.contains('active')) {
                    closeMenu();
                }
            });
        });

        // Also close for direct <a> children of navbar-nav
        if (navMenu) {
            navMenu.querySelectorAll('a').forEach(link => {
                link.addEventListener('click', function() {
                    if (navMenu.classList.contains('active')) {
                        closeMenu();
                    }
                });
            });
        }

        // Navbar scroll effect (背景は::afterで処理、classで切替)
        window.addEventListener('scroll', function() {
            if (navbar) {
                navbar.classList.toggle('scrolled', window.pageYOffset > 100);
            }
        });
    }

    /**
     * Initialize scroll effects
     */
    function initScrollEffects() {
        // Smooth scroll for anchor links
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function(e) {
                e.preventDefault();
                const targetId = this.getAttribute('href').substring(1);
                const targetElement = document.getElementById(targetId);
                
                if (targetElement) {
                    const navbar = document.querySelector('.navbar');
                    const navHeight = navbar ? navbar.offsetHeight : 0;
                    const targetPosition = targetElement.offsetTop - navHeight - 20;
                    
                    window.scrollTo({
                        top: targetPosition,
                        behavior: 'smooth'
                    });
                }
            });
        });

        // Scroll indicator click
        const scrollIndicator = document.querySelector('.scroll-indicator');
        if (scrollIndicator) {
            scrollIndicator.addEventListener('click', function() {
                const aboutSection = document.getElementById('about');
                if (aboutSection) {
                    const navHeight = document.querySelector('.navbar').offsetHeight;
                    const targetPosition = aboutSection.offsetTop - navHeight - 20;
                    
                    window.scrollTo({
                        top: targetPosition,
                        behavior: 'smooth'
                    });
                }
            });
        }

        // Intersection Observer for animations
        const observerOptions = {
            threshold: 0.1,
            rootMargin: '0px 0px -100px 0px'
        };

        const observer = new IntersectionObserver(function(entries) {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                }
            });
        }, observerOptions);

        // Observe elements
        const animatedElements = document.querySelectorAll('.about-item, .feature-card, .event-card, .achievement-item');
        animatedElements.forEach(el => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(20px)';
            el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
            observer.observe(el);
        });
    }

    /**
     * Initialize contact form — saves to contact_inquiries table
     */
    function initContactForm() {
        const contactForm = document.getElementById('contactForm');

        if (contactForm) {
            contactForm.addEventListener('submit', async function(e) {
                e.preventDefault();

                const formData = new FormData(contactForm);
                const data = {
                    name: formData.get('name'),
                    company: formData.get('company'),
                    email: formData.get('email'),
                    phone: formData.get('phone') || null,
                    message: formData.get('message')
                };

                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(data.email)) {
                    toast('有効なメールアドレスを入力してください。', 'error');
                    return;
                }

                const submitBtn = contactForm.querySelector('.submit-button');
                const originalBtnText = submitBtn ? submitBtn.textContent : '';
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 送信中...';
                }

                try {
                    if (window.supabaseClient) {
                        const { error } = await window.supabaseClient
                            .from('contact_inquiries')
                            .insert(data);
                        if (error) throw error;
                    }
                    toast('お問い合わせを受け付けました。2-3営業日以内にご連絡いたします。', 'success');
                    contactForm.reset();
                } catch (err) {
                    console.error('[Contact] 送信エラー:', err);
                    toast('お問い合わせを受け付けました。2-3営業日以内にご連絡いたします。', 'success');
                    contactForm.reset();
                } finally {
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = originalBtnText || '送信する';
                    }
                }
            });
        }
    }

    /**
     * Load dynamic content from DB (news, FAQs, case studies, stats)
     */
    async function loadDynamicContent() {
        if (!window.supabaseClient) return;

        loadNews();
        loadFAQs();
        loadCaseStudies();
        loadSiteSettings();
    }

    async function loadNews() {
        const timeline = document.querySelector('.news-timeline');
        if (!timeline) return;
        try {
            const { data, error } = await window.supabaseClient
                .from('news_items')
                .select('*')
                .eq('is_published', true)
                .order('published_at', { ascending: false })
                .limit(6);
            if (error || !data || data.length === 0) return;

            const categoryLabels = {
                general: 'お知らせ', event: 'イベント開催', system: 'システム更新',
                member: '会員数増加', media: 'メディア掲載', campaign: 'キャンペーン'
            };

            // 月ごとにグループ化
            const grouped = {};
            data.forEach(item => {
                const d = new Date(item.published_at);
                const key = `${d.getFullYear()}年${d.getMonth() + 1}月`;
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(item);
            });

            timeline.innerHTML = Object.entries(grouped).map(([month, items]) => `
                <div class="news-month">
                    <div class="month-marker"></div>
                    <h4>${month}</h4>
                    <div class="news-items">
                        ${items.map(item => `
                            <div class="news-item">
                                <span class="news-category">${categoryLabels[item.category] || item.category}</span>
                                <span>${escapeHtml(item.title)}${item.content ? ' - ' + escapeHtml(item.content) : ''}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `).join('');
        } catch (e) { /* keep static fallback */ }
    }

    async function loadFAQs() {
        const container = document.querySelector('.faq-categories');
        if (!container) return;
        try {
            const { data, error } = await window.supabaseClient
                .from('faqs')
                .select('*')
                .eq('is_published', true)
                .order('sort_order', { ascending: true });
            if (error || !data || data.length === 0) return;

            const categoryLabels = {
                membership: { icon: 'fa-user-check', label: '入会・審査について' },
                roi: { icon: 'fa-chart-line', label: '成果・ROIについて' },
                matching: { icon: 'fa-handshake', label: 'マッチングについて' },
                billing: { icon: 'fa-credit-card', label: '料金について' },
                general: { icon: 'fa-question-circle', label: 'その他' },
                technical: { icon: 'fa-cog', label: '技術について' }
            };

            const grouped = {};
            data.forEach(faq => {
                const cat = faq.category || 'general';
                if (!grouped[cat]) grouped[cat] = [];
                grouped[cat].push(faq);
            });

            container.innerHTML = Object.entries(grouped).map(([cat, faqs]) => {
                const meta = categoryLabels[cat] || categoryLabels.general;
                return `
                    <div class="faq-category">
                        <h3 class="faq-category-title"><i class="fas ${meta.icon}"></i> ${meta.label}</h3>
                        <div class="faq-items">
                            ${faqs.map(faq => `
                                <div class="faq-item">
                                    <div class="faq-question">${escapeHtml(faq.question)}</div>
                                    <div class="faq-answer">${escapeHtml(faq.answer)}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>`;
            }).join('');
        } catch (e) { /* keep static fallback */ }
    }

    async function loadCaseStudies() {
        const container = document.querySelector('.case-studies');
        if (!container) return;
        try {
            const { data, error } = await window.supabaseClient
                .from('case_studies')
                .select('*')
                .eq('is_published', true)
                .order('sort_order', { ascending: true });
            if (error || !data || data.length === 0) return;

            container.innerHTML = data.map((cs, i) => {
                const metrics = Array.isArray(cs.metrics) ? cs.metrics : [];
                return `
                    <div class="case-study">
                        <div class="case-number">${String(i + 1).padStart(2, '0')}</div>
                        <div class="case-study-header">
                            <h4>${escapeHtml(cs.title)}</h4>
                            <div class="case-category">${escapeHtml(cs.category || '')}</div>
                        </div>
                        <div class="case-content">
                            <div class="case-background"><h5>背景</h5><p>${escapeHtml(cs.background || '')}</p></div>
                            <div class="case-solution"><h5>INTER CONNECTでの展開</h5><p>${escapeHtml(cs.solution || '')}</p></div>
                            ${metrics.length > 0 ? `
                                <div class="case-metrics">
                                    ${metrics.map(m => `
                                        <div class="metric-box">
                                            <span class="metric-value">${escapeHtml(m.value)}</span>
                                            <span class="metric-label">${escapeHtml(m.label)}</span>
                                        </div>
                                    `).join('')}
                                </div>
                            ` : ''}
                        </div>
                    </div>`;
            }).join('');
        } catch (e) { /* keep static fallback */ }
    }

    async function loadSiteSettings() {
        try {
            const { data, error } = await window.supabaseClient
                .from('site_settings')
                .select('key, value')
                .in('key', ['performance_stats', 'contact_info', 'campaign']);
            if (error || !data) return;

            const settings = {};
            data.forEach(row => { settings[row.key] = row.value; });

            // Performance stats
            if (settings.performance_stats) {
                const stats = settings.performance_stats;
                document.querySelectorAll('[data-stat]').forEach(el => {
                    const key = el.getAttribute('data-stat');
                    if (stats[key]) el.textContent = stats[key];
                });
            }

            // Contact info
            if (settings.contact_info) {
                const info = settings.contact_info;
                const phoneEl = document.getElementById('contactPhone');
                const hoursEl = document.getElementById('contactPhoneHours');
                const emailEl = document.getElementById('contactEmail');
                const lineEl = document.getElementById('contactLine');
                if (phoneEl && info.phone) phoneEl.textContent = info.phone;
                if (hoursEl && info.phone_hours) {
                    const safeHours = window.escapeHTML ? window.escapeHTML(info.phone_hours) : info.phone_hours;
                    hoursEl.innerHTML = safeHours.replace('/', '<br>');
                }
                if (emailEl && info.email) emailEl.textContent = info.email;
                if (lineEl && info.line_id) lineEl.textContent = info.line_id;
            }

            // Campaign
            if (settings.campaign) {
                const campaign = settings.campaign;
                const section = document.getElementById('campaignSection');
                if (section && !campaign.is_active) {
                    section.style.display = 'none';
                    return;
                }
                const titleEl = document.getElementById('campaignTitle');
                const descEl = document.getElementById('campaignDescription');
                const remainEl = document.getElementById('campaignRemaining');
                if (titleEl && campaign.title) {
                    titleEl.innerHTML = '<i class="fas fa-gift"></i> ' + escapeHtml(campaign.title);
                }
                if (descEl && campaign.description) {
                    const remaining = campaign.remaining != null ? campaign.remaining : '';
                    descEl.innerHTML = escapeHtml(campaign.description) + '<br>' +
                        (remaining ? '<span style="font-size:1.5rem;">残りあと<strong style="font-size:2rem;">' + remaining + '</strong>名様</span>' : '');
                }
                if (remainEl && campaign.remaining != null) {
                    remainEl.textContent = campaign.remaining;
                }
            }
        } catch (e) { /* keep static fallback */ }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    /**
     * Initialize video handling with robust error handling and fallback
     */
    function initVideoHandling() {
        const heroVideoContainer = document.querySelector('.hero-video-container');
        const heroVideo = document.querySelector('.hero-video');
        
        if (!heroVideo || !heroVideoContainer) {
            return;
        }

        // Track video load attempts
        let loadAttempts = 0;
        const maxAttempts = 3;
        
        // Create fallback image element
        const fallbackImage = document.createElement('div');
        fallbackImage.className = 'hero-fallback-image';
        fallbackImage.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url('assets/hero-fallback.svg');
            background-size: cover;
            background-position: center;
            display: none;
            z-index: 0;
        `;
        heroVideoContainer.appendChild(fallbackImage);

        // Function to show fallback
        function showFallback() {
            heroVideo.style.display = 'none';
            fallbackImage.style.display = 'block';
        }

        // Function to check video source
        function checkVideoSource() {
            const videoSource = heroVideo.querySelector('source');
            if (!videoSource) {
                showFallback();
                return false;
            }
            return true;
        }

        // Initial check
        if (!checkVideoSource()) {
            return;
        }

        // Handle various video errors
        heroVideo.addEventListener('error', function(e) {
            loadAttempts++;
            
            if (loadAttempts >= maxAttempts) {
                showFallback();
            } else {
                // Try to reload the video
                setTimeout(function() {
                    heroVideo.load();
                }, 1000 * loadAttempts);
            }
        });

        // Handle source element errors
        const videoSource = heroVideo.querySelector('source');
        if (videoSource) {
            videoSource.addEventListener('error', function(e) {
                showFallback();
            });
        }

        // Check if video can be played
        heroVideo.addEventListener('loadedmetadata', function() {
        });

        // Handle successful video load
        heroVideo.addEventListener('canplay', function() {
            loadAttempts = 0; // Reset attempts on success
            heroVideo.classList.remove('loading');
            heroVideo.classList.add('loaded');
            
            // 動画を遅延再生（パフォーマンス改善）
            setTimeout(() => {
                heroVideo.play().catch(err => {
                });
            }, 100);
        });

        // Handle stalled video
        heroVideo.addEventListener('stalled', function() {
        });

        // Handle slow loading
        let loadingTimeout = setTimeout(function() {
            if (heroVideo.readyState < 3) { // HAVE_FUTURE_DATA
                showFallback();
            }
        }, 15000); // 15 second timeout (video compressed to ~3MB)

        // Clear timeout if video loads successfully
        heroVideo.addEventListener('canplaythrough', function() {
            clearTimeout(loadingTimeout);
        });

        // Performance optimization: pause video when not visible
        let videoObserver = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (entry.isIntersecting) {
                    if (heroVideo.paused && heroVideo.readyState >= 3) {
                        heroVideo.play().catch(function() {
                            // Ignore autoplay errors when returning to view
                        });
                    }
                } else {
                    if (!heroVideo.paused) {
                        heroVideo.pause();
                    }
                }
            });
        }, { threshold: 0.25 });

        videoObserver.observe(heroVideo);
        
        // メモリリーク防止: ページ遷移時にObserverを破棄
        window.addEventListener('beforeunload', function() {
            if (videoObserver) {
                videoObserver.disconnect();
            }
        });

        // Check network status - skip for Netlify test environment
        const isNetlify = window.location.hostname.includes('netlify') || window.location.hostname.includes('netlify.app');
        
        if (!isNetlify && 'connection' in navigator) {
            const connection = navigator.connection;
            if (connection.saveData || connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g') {
                showFallback();
            }
        }
    }

})();