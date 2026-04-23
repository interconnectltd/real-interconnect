/**
 * Core Utilities - INTERCONNECT
 * INTERCONNECT名前空間 + エラー防止 + DOM安全操作 + ストレージ安全アクセス + Nullチェック
 * 統合元: interconnect-core.js, error-prevention.js, safe-dom-utils.js, safe-storage.js, null-check-fixes.js
 */

(function() {
    'use strict';

    // ============================================================
    // Part 0: INTERCONNECT Namespace (interconnect-core.js + common.js)
    // ============================================================

    if (typeof window.INTERCONNECT === 'undefined') {
        window.INTERCONNECT = {
            version: '1.0.0',
            initialized: false,
            modules: {},
            utils: {},
            security: {},

            config: {
                debug: false,
                apiBaseUrl: window.location.origin,
                sessionTimeout: 30 * 60 * 1000,
                maxLoginAttempts: 5,
                lockoutTime: 15 * 60 * 1000
            },

            init: function() {
                if (this.initialized) return;
                this.initialized = true;
                const urlParams = new URLSearchParams(window.location.search);
                if (urlParams.get('debug') === 'true') {
                    this.config.debug = true;
                }
            },

            registerModule: function(name, module) {
                if (this.modules[name]) {
                    console.warn(`Module ${name} already registered`);
                    return false;
                }
                this.modules[name] = module;
                return true;
            },

            log: function(...args) {
                if (this.config.debug) {
                    // console.log('[INTERCONNECT]', ...args);
                }
            },

            error: function(...args) {
                console.error('[INTERCONNECT ERROR]', ...args);
            },

            // API Configuration
            apiUrl: window.SUPABASE_URL || '',
            apiKey: window.SUPABASE_ANON_KEY || '',

            formatCurrency: function(amount) {
                return new Intl.NumberFormat('ja-JP', {
                    style: 'currency',
                    currency: 'JPY'
                }).format(amount);
            },

            formatDate: function(date) {
                return new Intl.DateTimeFormat('ja-JP', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                }).format(new Date(date));
            },

            showNotification: function(message, type = 'info') {
                const notification = document.createElement('div');
                notification.className = `notification notification-${type}`;
                notification.textContent = message;
                document.body.appendChild(notification);
                setTimeout(() => notification.classList.add('show'), 10);
                setTimeout(() => {
                    notification.classList.remove('show');
                    setTimeout(() => notification.remove(), 300);
                }, 3000);
            },

            showLoading: function(element) {
                if (element) {
                    element.classList.add('loading');
                    element.disabled = true;
                }
            },

            hideLoading: function(element) {
                if (element) {
                    element.classList.remove('loading');
                    element.disabled = false;
                }
            },

            handleError: function(error) {
                console.error('Error:', error);
                const message = error.message || '予期しないエラーが発生しました';
                window.INTERCONNECT.showNotification(message, 'error');
            }
        };

        window.INTERCONNECT.init();
    }

    // ============================================================
    // Part 1: Error Prevention (error-prevention.js)
    // ============================================================

    // グローバルエラーハンドラー（本番環境では静かに処理）
    window.addEventListener('error', function(event) {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.error('Global error caught:', event.error);
        }
        event.preventDefault();
    });

    // Promiseの未処理エラーをキャッチ
    window.addEventListener('unhandledrejection', function(event) {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            console.error('Unhandled promise rejection:', event.reason);
        }
        event.preventDefault();
    });

    // 安全なDOM要素取得
    window.safeQuerySelector = function(selector, parent = document) {
        try {
            return parent.querySelector(selector);
        } catch (e) {
            console.error('Invalid selector:', selector);
            return null;
        }
    };


    // 安全なsetTimeout
    window.safeSetTimeout = function(callback, delay) {
        return setTimeout(function() {
            try {
                callback();
            } catch (error) {
                console.error('Error in setTimeout callback:', error);
            }
        }, delay);
    };

    // 安全なsetInterval
    const intervals = new Set();

    window.safeSetInterval = function(callback, delay) {
        const intervalId = setInterval(function() {
            try {
                callback();
            } catch (error) {
                console.error('Error in setInterval callback:', error);
                clearInterval(intervalId);
                intervals.delete(intervalId);
            }
        }, delay);

        intervals.add(intervalId);
        return intervalId;
    };

    // ページ離脱時のクリーンアップ
    window.addEventListener('beforeunload', function() {
        intervals.forEach(id => clearInterval(id));
        intervals.clear();
    });

    // デバウンス関数
    window.debounce = function(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                try {
                    func(...args);
                } catch (error) {
                    console.error('Error in debounced function:', error);
                }
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    };

    // スロットル関数
    window.throttle = function(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                try {
                    func.apply(this, args);
                } catch (error) {
                    console.error('Error in throttled function:', error);
                }
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    };

    // ============================================================
    // Part 2: Safe DOM Utilities (safe-dom-utils.js)
    // ============================================================

    const sanitizerDiv = document.createElement('div');

    const DANGEROUS_TAGS = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
    const EVENT_HANDLERS = /on\w+\s*=\s*["'][^"']*["']/gi;
    const JAVASCRIPT_PROTOCOL = /javascript:/gi;
    const DATA_BINDING = /{{\s*[\w.]+\s*}}/g;

    // 安全なHTML設定（完全サニタイズ版）
    window.safeSetHTML = function(element, html) {
        if (!element) return;

        if (html == null) {
            element.textContent = '';
            return;
        }

        const htmlString = String(html);

        let cleanHTML = htmlString
            .replace(DANGEROUS_TAGS, '')
            .replace(EVENT_HANDLERS, '')
            .replace(JAVASCRIPT_PROTOCOL, '')
            .replace(DATA_BINDING, '');

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(cleanHTML, 'text/html');

            const scripts = doc.querySelectorAll('script');
            scripts.forEach(script => script.remove());

            const allElements = doc.querySelectorAll('*');
            allElements.forEach(el => {
                Array.from(el.attributes).forEach(attr => {
                    if (attr.name.startsWith('on')) {
                        el.removeAttribute(attr.name);
                    }
                });
            });

            element.innerHTML = doc.body.innerHTML;
        } catch (e) {
            element.textContent = htmlString;
        }
    };


    // HTMLエスケープ
    window.escapeHTML = function(str) {
        if (str == null) return '';

        sanitizerDiv.textContent = String(str);
        return sanitizerDiv.innerHTML;
    };

    // HTML属性値エスケープ（onclick等のJS文字列コンテキスト用）
    window.escapeAttr = function(str) {
        if (str == null) return '';
        return String(str).replace(/&/g, '&amp;').replace(/'/g, '&#39;')
            .replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };


    // 既存のinnerHTML使用箇所を警告（デバッグモード時）
    if (window.DEBUG_MODE) {
        const originalInnerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
        Object.defineProperty(Element.prototype, 'innerHTML', {
            set: function(value) {
                console.warn('Direct innerHTML usage detected. Consider using safeSetHTML instead.');
                console.trace();
                originalInnerHTML.set.call(this, value);
            },
            get: originalInnerHTML.get
        });
    }

    // ============================================================
    // Part 3: Safe Storage (safe-storage.js)
    // ============================================================

    function isStorageAvailable(storage) {
        try {
            const testKey = '__storage_test__';
            storage.setItem(testKey, 'test');
            storage.removeItem(testKey);
            return true;
        } catch (e) {
            return false;
        }
    }

    class SafeStorage {
        constructor(storage) {
            this.storage = storage;
            this.available = storage ? isStorageAvailable(storage) : false;
            this.prefix = 'interconnect_';
        }

        _key(key) {
            return this.prefix + key;
        }

        getItem(key, defaultValue = null) {
            if (!this.available) {
                console.warn('Storage not available');
                return defaultValue;
            }

            try {
                const value = this.storage.getItem(this._key(key));
                return value !== null ? value : defaultValue;
            } catch (e) {
                console.error('Storage getItem error:', e);
                return defaultValue;
            }
        }

        getJSON(key, defaultValue = null) {
            const value = this.getItem(key);
            if (value === null) return defaultValue;

            try {
                return JSON.parse(value);
            } catch (e) {
                console.error('JSON parse error in storage:', e);
                return defaultValue;
            }
        }

        setItem(key, value) {
            if (!this.available) {
                console.warn('Storage not available');
                return false;
            }

            try {
                this.storage.setItem(this._key(key), String(value));
                return true;
            } catch (e) {
                if (e.name === 'QuotaExceededError') {
                    console.error('Storage quota exceeded');
                    this._cleanupOldData();
                    try {
                        this.storage.setItem(this._key(key), String(value));
                        return true;
                    } catch (retryError) {
                        console.error('Storage setItem retry failed:', retryError);
                        return false;
                    }
                }
                console.error('Storage setItem error:', e);
                return false;
            }
        }

        setJSON(key, value) {
            try {
                const jsonString = JSON.stringify(value);
                return this.setItem(key, jsonString);
            } catch (e) {
                console.error('JSON stringify error:', e);
                return false;
            }
        }

        removeItem(key) {
            if (!this.available) {
                console.warn('Storage not available');
                return false;
            }

            try {
                this.storage.removeItem(this._key(key));
                return true;
            } catch (e) {
                console.error('Storage removeItem error:', e);
                return false;
            }
        }

        clear() {
            if (!this.available) {
                console.warn('Storage not available');
                return false;
            }

            try {
                const keysToRemove = [];
                for (let i = 0; i < this.storage.length; i++) {
                    const key = this.storage.key(i);
                    if (key && key.startsWith(this.prefix)) {
                        keysToRemove.push(key);
                    }
                }

                keysToRemove.forEach(key => {
                    this.storage.removeItem(key);
                });

                return true;
            } catch (e) {
                console.error('Storage clear error:', e);
                return false;
            }
        }

        hasItem(key) {
            return this.getItem(key) !== null;
        }

        getSize() {
            if (!this.available) return 0;

            let size = 0;
            try {
                for (let i = 0; i < this.storage.length; i++) {
                    const key = this.storage.key(i);
                    if (key && key.startsWith(this.prefix)) {
                        const value = this.storage.getItem(key);
                        size += key.length + (value ? value.length : 0);
                    }
                }
            } catch (e) {
                console.error('Storage size calculation error:', e);
            }
            return size;
        }

        _cleanupOldData() {
            try {
                const timestampedKeys = [];

                for (let i = 0; i < this.storage.length; i++) {
                    const key = this.storage.key(i);
                    if (key && key.startsWith(this.prefix)) {
                        const value = this.storage.getItem(key);
                        try {
                            const data = JSON.parse(value);
                            if (data && data._timestamp) {
                                timestampedKeys.push({ key, timestamp: data._timestamp });
                            }
                        } catch (e) {
                            // JSONでない場合は無視
                        }
                    }
                }

                timestampedKeys.sort((a, b) => a.timestamp - b.timestamp);

                const removeCount = Math.ceil(timestampedKeys.length * 0.2);
                for (let i = 0; i < removeCount && i < timestampedKeys.length; i++) {
                    this.storage.removeItem(timestampedKeys[i].key);
                }
            } catch (e) {
                console.error('Cleanup error:', e);
            }
        }

        setItemWithTimestamp(key, value) {
            const data = {
                value: value,
                _timestamp: Date.now()
            };
            return this.setJSON(key, data);
        }

        getItemWithTimestamp(key, defaultValue = null) {
            const data = this.getJSON(key);
            if (data && data.value !== undefined) {
                return data.value;
            }
            return defaultValue;
        }

        setItemWithExpiry(key, value, expiryMs) {
            const data = {
                value: value,
                _expiry: Date.now() + expiryMs
            };
            return this.setJSON(key, data);
        }

        getItemWithExpiry(key, defaultValue = null) {
            const data = this.getJSON(key);
            if (data && data.value !== undefined && data._expiry) {
                if (Date.now() < data._expiry) {
                    return data.value;
                } else {
                    this.removeItem(key);
                }
            }
            return defaultValue;
        }
    }

    // グローバルに公開
    try {
        window.safeLocalStorage = new SafeStorage(typeof localStorage !== 'undefined' ? localStorage : null);
        window.safeSessionStorage = new SafeStorage(typeof sessionStorage !== 'undefined' ? sessionStorage : null);
    } catch (e) {
        console.error('SafeStorage initialization error:', e);
        window.safeLocalStorage = new SafeStorage(null);
        window.safeSessionStorage = new SafeStorage(null);
    }

    window.SafeStorage = {
        local: window.safeLocalStorage,
        session: window.safeSessionStorage
    };

    // ============================================================
    // Part 4: Null Check Fixes (null-check-fixes.js から統合)
    // ============================================================

    // 共通のnullチェック関数
    window.checkElement = function(element, elementName = 'Element') {
        if (!element) {
            console.warn(`${elementName} not found`);
            return false;
        }
        return true;
    };


    // JSONの安全なパース/文字列化（JSON.safeParse / JSON.safeStringify）
    window.JSON.safeParse = function(text, reviver) {
        try {
            return JSON.parse(text, reviver);
        } catch (e) {
            console.error('JSON parse error:', e);
            return null;
        }
    };

    window.JSON.safeStringify = function(value, replacer, space) {
        try {
            return JSON.stringify(value, replacer, space);
        } catch (e) {
            console.error('JSON stringify error:', e);
            return '';
        }
    };

    // ============================================================
    // Part 5: Confirm Modal (confirm() の代替)
    // ============================================================

    /**
     * カスタム確認モーダル
     * await showConfirmModal('メッセージ') → true/false
     */
    var confirmModalCounter = 0;

    window.showConfirmModal = function(message, options) {
        options = options || {};
        return new Promise(function(resolve) {
            var confirmLabel = options.confirmLabel || '確認';
            var cancelLabel = options.cancelLabel || 'キャンセル';
            var isDanger = options.danger || false;
            var resolved = false;

            // ユニークID生成（重複防止）
            var uid = 'confirm-modal-' + (++confirmModalCounter);

            // オーバーレイ
            var overlay = document.createElement('div');
            overlay.className = 'confirm-modal-overlay';

            // モーダル本体
            var modal = document.createElement('div');
            modal.className = 'confirm-modal';
            modal.setAttribute('role', 'alertdialog');
            modal.setAttribute('aria-modal', 'true');

            // メッセージ
            var msgEl = document.createElement('p');
            msgEl.id = uid;
            modal.setAttribute('aria-labelledby', uid);
            msgEl.className = 'confirm-modal-message';
            msgEl.textContent = message;

            // ボタンコンテナ
            var btnContainer = document.createElement('div');
            btnContainer.className = 'confirm-modal-buttons';

            var cancelBtn = document.createElement('button');
            cancelBtn.className = 'btn btn-outline confirm-modal-cancel';
            cancelBtn.textContent = cancelLabel;

            var confirmBtn = document.createElement('button');
            confirmBtn.className = isDanger
                ? 'btn confirm-modal-confirm confirm-modal-danger'
                : 'btn btn-primary confirm-modal-confirm';
            confirmBtn.textContent = confirmLabel;

            btnContainer.appendChild(cancelBtn);
            btnContainer.appendChild(confirmBtn);
            modal.appendChild(msgEl);
            modal.appendChild(btnContainer);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            var prevOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';

            // フォーカスをモーダルに移動
            confirmBtn.focus();

            function cleanup(result) {
                if (resolved) return;
                resolved = true;
                document.removeEventListener('keydown', onKeyDown);
                document.body.style.overflow = prevOverflow;
                overlay.classList.add('confirm-modal-closing');
                setTimeout(function() {
                    if (overlay.parentNode) {
                        overlay.parentNode.removeChild(overlay);
                    }
                }, 200);
                resolve(result);
            }

            confirmBtn.addEventListener('click', function() { cleanup(true); });
            cancelBtn.addEventListener('click', function() { cleanup(false); });
            overlay.addEventListener('click', function(e) {
                if (e.target === overlay) { cleanup(false); }
            });

            // Escape キーで閉じる
            function onKeyDown(e) {
                if (e.key === 'Escape') {
                    cleanup(false);
                }
            }
            document.addEventListener('keydown', onKeyDown);
        });
    };

})();
