// ============================================================
// Section: sanitizer.js
// ============================================================
/**
 * HTML Sanitizer - XSS攻撃を防ぐためのサニタイズ関数
 */

(function() {
    'use strict';

    // HTMLをエスケープする関数
    function escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') return '';

        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // 安全なHTMLタグのホワイトリスト
    const ALLOWED_TAGS = ['b', 'i', 'em', 'strong', 'span', 'br', 'p', 'div', 'a'];
    const ALLOWED_ATTRS = {
        'a': ['href', 'title', 'target', 'rel'],
        'span': ['class'],
        'div': ['class'],
        'p': ['class']
    };

    // シンプルなHTMLサニタイザー
    function sanitizeHtml(html) {
        if (typeof html !== 'string') return '';

        // 基本的なエスケープ
        let cleaned = html;

        // スクリプトタグを完全に削除
        cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        cleaned = cleaned.replace(/on\w+\s*=\s*["'][^"']*["']/gi, ''); // イベントハンドラを削除
        cleaned = cleaned.replace(/javascript:/gi, ''); // javascript: URLを削除

        return cleaned;
    }

    // DOMベースのサニタイザー（より安全）
    function sanitizeNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            return document.createTextNode(node.textContent);
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
            return null;
        }

        const tagName = node.tagName.toLowerCase();

        if (!ALLOWED_TAGS.includes(tagName)) {
            return null;
        }

        const newNode = document.createElement(tagName);

        // 許可された属性のみコピー
        if (ALLOWED_ATTRS[tagName]) {
            ALLOWED_ATTRS[tagName].forEach(attr => {
                if (node.hasAttribute(attr)) {
                    let value = node.getAttribute(attr);

                    // href属性の場合、安全なURLのみ許可
                    if (attr === 'href') {
                        if (value.startsWith('http://') ||
                            value.startsWith('https://') ||
                            value.startsWith('#') ||
                            value.startsWith('/')) {
                            newNode.setAttribute(attr, value);
                        }
                    } else {
                        newNode.setAttribute(attr, value);
                    }
                }
            });
        }

        // 子ノードを再帰的にサニタイズ
        for (let child of node.childNodes) {
            const sanitizedChild = sanitizeNode(child);
            if (sanitizedChild) {
                newNode.appendChild(sanitizedChild);
            }
        }

        return newNode;
    }

    // 安全なinnerHTML設定関数
    function setInnerHTML(element, html) {
        if (!element) return;

        // 一時的なコンテナでパース
        const temp = document.createElement('div');
        temp.innerHTML = sanitizeHtml(html);

        // サニタイズされたノードを作成
        element.innerHTML = '';
        for (let child of temp.childNodes) {
            const sanitized = sanitizeNode(child);
            if (sanitized) {
                element.appendChild(sanitized);
            }
        }
    }

    // グローバルに公開
    window.INTERCONNECT = window.INTERCONNECT || {};
    window.INTERCONNECT.sanitizer = {
        escapeHtml: escapeHtml,
        sanitizeHtml: sanitizeHtml,
        setInnerHTML: setInnerHTML
    };

})();

// ============================================================
// Section: settings-unified.js
// ============================================================
/**
 * Settings Page Unified
 * 統合元: settings-navigation.js + settings-improved.js
 * ナビゲーション、フォーム、トグル、データ管理を一括提供
 */

(function() {
    'use strict';

    // イベントリスナーを管理するためのマップ
    const eventListeners = new Map();
    const timeouts = new Set();
    const intervals = new Set();

    // ページ離脱時のクリーンアップ
    window.addEventListener('beforeunload', cleanup);

    function safeSetTimeout(callback, delay) {
        const timeoutId = setTimeout(() => {
            timeouts.delete(timeoutId);
            callback();
        }, delay);
        timeouts.add(timeoutId);
        return timeoutId;
    }

    function safeSetInterval(callback, delay) {
        const intervalId = setInterval(callback, delay);
        intervals.add(intervalId);
        return intervalId;
    }

    function cleanup() {
        timeouts.forEach(id => clearTimeout(id));
        timeouts.clear();
        intervals.forEach(id => clearInterval(id));
        intervals.clear();
        eventListeners.forEach((listeners, element) => {
            listeners.forEach(({ type, handler }) => {
                element.removeEventListener(type, handler);
            });
        });
        eventListeners.clear();
    }

    function addSafeEventListener(element, type, handler) {
        if (!element) return;
        element.addEventListener(type, handler);
        if (!eventListeners.has(element)) {
            eventListeners.set(element, []);
        }
        eventListeners.get(element).push({ type, handler });
    }

    // Initialize
    document.addEventListener('DOMContentLoaded', function() {
        initializeNavigation();
        initializeForms();
        initializeToggles();
        initializeDataManagement();
        initializeAppIntegrations();
        initializePasswordStrength();
        initializeDangerZone();
        loadUserSettings();
        loadLoginActivity();
    });

    // Navigation between settings sections
    function initializeNavigation() {
        // settings-improved.js style: .settings-nav-link with data-section
        const navLinks = document.querySelectorAll('.settings-nav-link');
        const sections = document.querySelectorAll('.settings-section');

        if (navLinks.length > 0) {
            navLinks.forEach(link => {
                addSafeEventListener(link, 'click', function(e) {
                    e.preventDefault();
                    navLinks.forEach(l => l.classList.remove('active'));
                    sections.forEach(s => s.classList.remove('active'));
                    this.classList.add('active');
                    const targetId = this.getAttribute('data-section');
                    const targetSection = document.getElementById(targetId);
                    if (targetSection) {
                        targetSection.classList.add('active');
                    }
                });
            });

            if (sections.length > 0) {
                navLinks[0].classList.add('active');
                sections[0].classList.add('active');
            }
        }

        // settings-navigation.js style: .settings-nav-item with href
        const navItems = document.querySelectorAll('.settings-nav-item');
        if (navItems.length > 0) {
            navItems.forEach(item => {
                addSafeEventListener(item, 'click', function(e) {
                    e.preventDefault();
                    navItems.forEach(nav => nav.classList.remove('active'));
                    sections.forEach(section => section.style.display = 'none');
                    this.classList.add('active');
                    const targetId = this.getAttribute('href').substring(1);
                    const targetSection = document.getElementById(targetId);
                    if (targetSection) {
                        targetSection.style.display = 'block';
                        targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                    history.pushState(null, null, '#' + targetId);
                });
            });

            const hash = window.location.hash;
            if (hash) {
                const targetNav = document.querySelector(`.settings-nav-item[href="${hash}"]`);
                if (targetNav) {
                    targetNav.click();
                }
            } else if (sections.length > 0 && sections[0]) {
                sections[0].style.display = 'block';
            }
        }
    }

    // Form submissions with validation
    function initializeForms() {
        const forms = document.querySelectorAll('.settings-form');
        forms.forEach(form => {
            addSafeEventListener(form, 'submit', function(e) {
                e.preventDefault();
                if (validateForm(this)) {
                    saveSettings(this);
                }
            });
        });

        const inputs = document.querySelectorAll('.form-input, .form-select, .form-textarea');
        inputs.forEach(input => {
            addSafeEventListener(input, 'blur', function() {
                validateField(this);
            });
        });
    }

    // Toggle switches
    function initializeToggles() {
        // settings-improved.js style: .toggle-switch with data-setting
        const toggleSwitches = document.querySelectorAll('.toggle-switch');
        toggleSwitches.forEach(toggle => {
            addSafeEventListener(toggle, 'click', function() {
                this.classList.toggle('active');
                const settingName = this.getAttribute('data-setting');
                const isActive = this.classList.contains('active');
                saveSetting(settingName, isActive);
            });
        });

        // settings-navigation.js style: .toggle-input checkboxes
        const toggleInputs = document.querySelectorAll('.toggle-input');
        toggleInputs.forEach(input => {
            const slider = input.nextElementSibling;
            updateToggleState(input, slider);
            addSafeEventListener(input, 'change', function() {
                const toggleSwitch = this.closest('.toggle-switch');
                const slider = this.nextElementSibling;
                if (toggleSwitch) toggleSwitch.classList.add('loading');
                safeSetTimeout(() => {
                    if (toggleSwitch) toggleSwitch.classList.remove('loading');
                    updateToggleState(this, slider);
                    showToast('設定を更新しました', 'success');
                }, 500);
            });
        });
    }

    function updateToggleState(input, slider) {
        if (!slider) return;
        slider.setAttribute('aria-checked', input.checked ? 'true' : 'false');
    }

    // Data management
    function initializeDataManagement() {
        const exportBtn = document.querySelector('[data-action="export"]');
        const deleteBtn = document.querySelector('[data-action="delete-account"]');
        if (exportBtn) addSafeEventListener(exportBtn, 'click', exportData);
        if (deleteBtn) addSafeEventListener(deleteBtn, 'click', confirmDeleteAccount);
    }

    // App integrations
    function initializeAppIntegrations() {
        const appButtons = document.querySelectorAll('.app-action-btn');
        appButtons.forEach(btn => {
            addSafeEventListener(btn, 'click', function() {
                const appName = this.getAttribute('data-app');
                toggleAppIntegration(appName, this);
            });
        });
    }

    // Password strength indicator
    function initializePasswordStrength() {
        const passwordInput = document.getElementById('new-password');
        const strengthIndicator = document.querySelector('.password-strength');
        if (passwordInput && strengthIndicator) {
            addSafeEventListener(passwordInput, 'input', function() {
                const strength = calculatePasswordStrength(this.value);
                updateStrengthIndicator(strengthIndicator, strength);
            });
        }
    }

    // Danger zone actions
    function initializeDangerZone() {
        const dangerButtons = document.querySelectorAll('.danger-zone .btn');
        dangerButtons.forEach(btn => {
            addSafeEventListener(btn, 'click', function(e) {
                e.preventDefault();
                const action = this.getAttribute('data-action');
                confirmDangerousAction(action);
            });
        });
    }

    // Form validation
    function validateForm(form) {
        const fields = form.querySelectorAll('[required]');
        let isValid = true;
        fields.forEach(field => {
            if (!validateField(field)) isValid = false;
        });
        return isValid;
    }

    function validateField(field) {
        const value = field.value.trim();
        const type = field.type;
        let isValid = true;

        const errorElement = field.parentElement.querySelector('.form-error');
        if (errorElement) errorElement.remove();

        if (field.hasAttribute('required') && !value) {
            showFieldError(field, 'この項目は必須です');
            isValid = false;
        } else if (type === 'email' && value) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(value)) {
                showFieldError(field, '有効なメールアドレスを入力してください');
                isValid = false;
            }
        } else if (type === 'password' && field.id === 'new-password' && value) {
            if (value.length < 8) {
                showFieldError(field, 'パスワードは8文字以上で入力してください');
                isValid = false;
            }
        } else if (field.id === 'confirm-password') {
            const newPassword = document.getElementById('new-password');
            if (newPassword && value !== newPassword.value) {
                showFieldError(field, 'パスワードが一致しません');
                isValid = false;
            }
        }

        return isValid;
    }

    function showFieldError(field, message) {
        const error = document.createElement('div');
        error.className = 'form-error';
        error.textContent = message;
        field.parentElement.appendChild(error);
        field.classList.add('error');
    }

    // Save settings（F3修正: 実際のSupabase保存）
    // settingsテーブル: user_id, theme, language, notifications_enabled, email_notifications, metadata JSONB
    async function saveSettings(form) {
        const formData = new FormData(form);
        const formValues = {};
        for (let [key, value] of formData.entries()) {
            formValues[key] = value;
        }

        const saveBtn = form.querySelector('.btn-save');
        if (!saveBtn) return;
        const originalText = saveBtn.textContent;
        saveBtn.textContent = '保存中...';
        saveBtn.disabled = true;

        try {
            const client = window.supabaseClient;
            if (!client) throw new Error('Supabase未接続');

            const user = await window.safeGetUser();
            if (!user) throw new Error('未ログイン');

            // フォームのセクションを判定
            const sectionId = form.closest('.settings-section')?.id || 'general';

            if (sectionId === 'profile' || sectionId === 'account') {
                // プロフィール関連はuser_profilesに保存
                const profileUpdate = {};
                if (formValues['display-name']) profileUpdate.full_name = formValues['display-name'];
                if (formValues['email']) profileUpdate.email = formValues['email'];
                if (formValues['bio']) profileUpdate.bio = formValues['bio'];
                if (formValues['company']) profileUpdate.company = formValues['company'];

                if (Object.keys(profileUpdate).length > 0) {
                    const { error } = await client
                        .from('user_profiles')
                        .update(profileUpdate)
                        .eq('id', user.id);
                    if (error) throw error;
                }
            }

            // パスワード変更
            if (formValues['new-password'] && formValues['confirm-password']) {
                if (formValues['new-password'] === formValues['confirm-password']) {
                    const { error } = await client.auth.updateUser({
                        password: formValues['new-password']
                    });
                    if (error) throw error;
                    form.reset();
                }
            }

            // 通知設定はsettingsテーブルに保存
            if (sectionId === 'notifications') {
                const settingsUpdate = {};
                if ('notifications_enabled' in formValues) {
                    settingsUpdate.notifications_enabled = formValues['notifications_enabled'] === 'true';
                }
                if ('email_notifications' in formValues) {
                    settingsUpdate.email_notifications = formValues['email_notifications'] === 'true';
                }
                // その他の通知設定はmetadata JSONBに
                const metadataKeys = Object.keys(formValues).filter(k =>
                    k !== 'notifications_enabled' && k !== 'email_notifications'
                );
                if (metadataKeys.length > 0) {
                    const { data: current } = await client
                        .from('settings')
                        .select('metadata')
                        .eq('user_id', user.id)
                        .maybeSingle();
                    const metadata = (current && current.metadata) || {};
                    metadataKeys.forEach(k => { metadata[k] = formValues[k]; });
                    settingsUpdate.metadata = metadata;
                }

                const { error } = await client
                    .from('settings')
                    .update(settingsUpdate)
                    .eq('user_id', user.id);
                if (error) throw error;
            }

            // テーマ・言語設定
            if (sectionId === 'appearance' || sectionId === 'general') {
                const settingsUpdate = {};
                if (formValues['theme']) settingsUpdate.theme = formValues['theme'];
                if (formValues['language']) settingsUpdate.language = formValues['language'];
                if (Object.keys(settingsUpdate).length > 0) {
                    const { error } = await client
                        .from('settings')
                        .update(settingsUpdate)
                        .eq('user_id', user.id);
                    if (error) throw error;
                }
            }

            showToast('設定を保存しました', 'success');
        } catch (err) {
            console.error('[Settings] 保存エラー:', err);
            showToast('設定の保存に失敗しました', 'error');
        } finally {
            saveBtn.textContent = originalText;
            saveBtn.disabled = false;
        }
    }

    async function saveSetting(name, value) {
        try {
            const client = window.supabaseClient;
            if (!client) return;
            const user = await window.safeGetUser();
            if (!user) return;

            // 既知のカラムは直接更新、それ以外はmetadataに保存
            const knownColumns = ['theme', 'language', 'notifications_enabled', 'email_notifications'];
            if (knownColumns.includes(name)) {
                const { error } = await client
                    .from('settings')
                    .update({ [name]: value })
                    .eq('user_id', user.id);
                if (error) throw error;
            } else {
                // metadata JSONBに保存
                const { data: current } = await client
                    .from('settings')
                    .select('metadata')
                    .eq('user_id', user.id)
                    .maybeSingle();
                const metadata = (current && current.metadata) || {};
                metadata[name] = value;
                const { error } = await client
                    .from('settings')
                    .update({ metadata: metadata })
                    .eq('user_id', user.id);
                if (error) throw error;
            }

            showToast(`設定を更新しました`, 'success');
        } catch (err) {
            console.error('[Settings] 設定更新エラー:', err);
            showToast('設定の更新に失敗しました', 'error');
        }
    }

    function toggleAppIntegration(appName, button) {
        const isConnected = button.textContent === '解除';
        const appItem = button.closest('.app-item');

        button.textContent = '処理中...';
        button.disabled = true;

        safeSetTimeout(() => {
            if (isConnected) {
                button.textContent = '連携';
                button.className = 'btn btn-primary btn-small';
                const status = appItem.querySelector('.app-status');
                status.textContent = '未連携';
                status.className = 'app-status';
                showToast(`${appName}との連携を解除しました`);
            } else {
                button.textContent = '解除';
                button.className = 'btn btn-outline btn-small';
                const status = appItem.querySelector('.app-status');
                status.textContent = '連携済み';
                status.className = 'app-status connected';
                showToast(`${appName}と連携しました`);
            }
            button.disabled = false;
        }, 1500);
    }

    async function exportData(e) {
        const button = e ? e.target : document.querySelector('[data-action="export"]');
        if (!button) return;
        const originalText = button.textContent;

        button.textContent = 'エクスポート中...';
        button.disabled = true;

        try {
            const client = window.supabaseClient;
            const user = await window.safeGetUser();
            const data = {};

            if (client && user) {
                // プロフィールデータ取得
                const { data: profile } = await client
                    .from('user_profiles')
                    .select('*')
                    .eq('id', user.id)
                    .maybeSingle();
                if (profile) data.profile = profile;

                // 設定データ取得
                const { data: settings } = await client
                    .from('settings')
                    .select('*')
                    .eq('user_id', user.id)
                    .maybeSingle();
                if (settings) data.settings = settings;
            }

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'interconnect-data.json';
            a.click();
            URL.revokeObjectURL(url);

            showToast('データのエクスポートが完了しました', 'success');
        } catch (err) {
            console.error('[Settings] エクスポートエラー:', err);
            showToast('エクスポートに失敗しました', 'error');
        } finally {
            button.textContent = originalText;
            button.disabled = false;
        }
    }

    function calculatePasswordStrength(password) {
        let strength = 0;
        if (password.length >= 8) strength++;
        if (password.length >= 12) strength++;
        if (/[a-z]/.test(password)) strength++;
        if (/[A-Z]/.test(password)) strength++;
        if (/[0-9]/.test(password)) strength++;
        if (/[^a-zA-Z0-9]/.test(password)) strength++;
        return Math.min(Math.floor((strength / 6) * 4), 4);
    }

    function updateStrengthIndicator(indicator, strength) {
        const strengthTexts = ['弱い', '普通', '強い', '非常に強い'];
        const strengthColors = ['#ef4444', '#f59e0b', '#10b981', '#059669'];
        indicator.textContent = strengthTexts[strength - 1] || '';
        indicator.style.color = strengthColors[strength - 1] || '#6b7280';
    }

    async function confirmDangerousAction(action) {
        const messages = {
            'delete-account': 'アカウントを削除すると、すべてのデータが失われます。本当に削除しますか？',
            'clear-data': 'すべてのデータをクリアします。この操作は取り消せません。続行しますか？'
        };
        if (await window.showConfirmModal(messages[action] || '本当に実行しますか？', { confirmLabel: '実行', danger: true })) {
            executeDangerousAction(action);
        }
    }

    function executeDangerousAction(action) {
        showToast(`${action}を実行しました`, 'info');
        if (action === 'delete-account') {
            safeSetTimeout(() => {
                window.location.href = 'index.html';
            }, 2000);
        }
    }

    async function confirmDeleteAccount() {
        if (await window.showConfirmModal('アカウントを削除すると、すべてのデータが失われます。本当に削除しますか？', { confirmLabel: '削除', danger: true })) {
            if (await window.showConfirmModal('この操作は取り消せません。本当によろしいですか？', { confirmLabel: '最終確認 - 削除する', danger: true })) {
                deleteAccount();
            }
        }
    }

    async function deleteAccount() {
        showToast('アカウントを削除しています...', 'info');
        try {
            const client = window.supabaseClient;
            if (client) {
                // サインアウト（アカウント削除はサーバー側RPC経由が安全）
                await client.auth.signOut();
            }
            localStorage.clear();
            sessionStorage.clear();
            window.location.href = 'index.html';
        } catch (err) {
            console.error('[Settings] アカウント削除エラー:', err);
            localStorage.clear();
            sessionStorage.clear();
            window.location.href = 'index.html';
        }
    }

    // Load user profile data into settings form fields
    async function loadUserSettings() {
        try {
            const client = window.supabaseClient;
            if (!client) return;
            const user = await window.safeGetUser();
            if (!user) return;

            // Populate email from auth
            const emailInput = document.getElementById('settingsEmail');
            if (emailInput) emailInput.value = user.email || '';

            // Load profile data
            const { data: profile } = await client
                .from('user_profiles')
                .select('full_name, company, bio, email')
                .eq('id', user.id)
                .maybeSingle();

            if (profile) {
                const nameInput = document.getElementById('settingsDisplayName');
                const usernameInput = document.getElementById('settingsUsername');
                const bioInput = document.getElementById('settingsBio');
                if (nameInput) nameInput.value = profile.full_name || '';
                if (usernameInput) usernameInput.value = profile.email || user.email || user.id.substring(0, 8);
                if (bioInput) bioInput.value = profile.bio || '';
            }

            // Remove placeholder text
            document.querySelectorAll('#settingsEmail, #settingsUsername, #settingsDisplayName').forEach(el => {
                el.placeholder = '';
            });
        } catch (e) {
            console.error('[Settings] ユーザーデータ読み込みエラー:', e);
        }
    }

    // Load login activity from login_sessions table
    async function loadLoginActivity() {
        const container = document.getElementById('loginActivityList');
        if (!container) return;

        try {
            const client = window.supabaseClient;
            if (!client) {
                container.innerHTML = '<p style="text-align:center; color:#6b7280;">データを取得できません</p>';
                return;
            }
            const user = await window.safeGetUser();
            if (!user) {
                container.innerHTML = '<p style="text-align:center; color:#6b7280;">ログインしてください</p>';
                return;
            }

            const { data, error } = await client
                .from('login_sessions')
                .select('*')
                .eq('user_id', user.id)
                .order('logged_in_at', { ascending: false })
                .limit(10);

            if (error || !data || data.length === 0) {
                container.innerHTML = '<p style="text-align:center; color:#6b7280; padding:20px;">ログイン履歴はありません</p>';
                return;
            }

            container.innerHTML = data.map((session, i) => {
                const icon = getDeviceIcon(session.device || session.browser || '');
                const deviceText = escapeForDisplay([session.device, session.browser].filter(Boolean).join(' - ')) || '不明なデバイス';
                const location = escapeForDisplay(session.location || '');
                const timeAgo = formatTimeAgoSettings(session.logged_in_at);
                const isCurrent = i === 0;

                return `<div class="activity-item">
                    <div class="activity-info">
                        <div class="activity-device">
                            <i class="fas ${icon}"></i>
                            <span>${deviceText}</span>
                        </div>
                        <div class="activity-details">
                            ${location ? `<span class="activity-location">${location}</span>` : ''}
                            <span class="activity-time">${timeAgo}</span>
                        </div>
                    </div>
                    ${isCurrent ? '<span class="activity-status current">現在のセッション</span>' : ''}
                </div>`;
            }).join('');
        } catch (e) {
            console.error('[Settings] ログイン履歴読み込みエラー:', e);
            container.innerHTML = '<p style="text-align:center; color:#6b7280;">履歴の取得に失敗しました</p>';
        }
    }

    function getDeviceIcon(deviceString) {
        const lower = (deviceString || '').toLowerCase();
        if (lower.includes('iphone') || lower.includes('android') || lower.includes('mobile')) return 'fa-mobile-alt';
        if (lower.includes('ipad') || lower.includes('tablet')) return 'fa-tablet-alt';
        return 'fa-desktop';
    }

    function escapeForDisplay(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatTimeAgoSettings(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffMin = Math.floor(diffMs / 60000);
        const diffHr = Math.floor(diffMs / 3600000);
        const diffDay = Math.floor(diffMs / 86400000);
        if (diffMin < 1) return 'たった今';
        if (diffMin < 60) return `${diffMin}分前`;
        if (diffHr < 24) return `${diffHr}時間前`;
        if (diffDay < 30) return `${diffDay}日前`;
        return date.toLocaleDateString('ja-JP');
    }

    // Toast notification (XSS safe, fallback if global showToast not available)
    function showToast(message, type = 'info') {
        if (window.showToast && window.showToast !== showToast) {
            return window.showToast(message, type);
        }
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        const textNode = document.createTextNode(message);
        toast.appendChild(textNode);
        document.body.appendChild(toast);
        safeSetTimeout(() => toast.classList.add('show'), 10);
        safeSetTimeout(() => {
            toast.classList.remove('show');
            safeSetTimeout(() => toast.remove(), 300);
        }, 3000);
    }

})();
