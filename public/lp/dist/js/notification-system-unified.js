/**
 * 統一通知システム
 * すべての通知関数を一箇所に集約
 * 
 * 問題: 29箇所で異なる通知実装が存在していた
 * 解決: このファイルに統一
 */

(function() {
    'use strict';

    // 通知タイプの定義
    const NOTIFICATION_TYPES = {
        SUCCESS: 'success',
        ERROR: 'error',
        WARNING: 'warning',
        INFO: 'info'
    };

    // デフォルト設定
    const DEFAULT_DURATION = 3000;
    const Z_INDEX = 999999; // 最前面

    // Toast通知の実装（メイン）
    function showToast(message, type = NOTIFICATION_TYPES.INFO, duration = DEFAULT_DURATION) {
        // 既存のトーストを削除
        const existingToast = document.querySelector('.toast-notification');
        if (existingToast) {
            existingToast.remove();
        }

        // トースト要素を作成
        const toast = document.createElement('div');
        toast.className = `toast-notification toast-${type}`;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 16px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: ${Z_INDEX};
            display: flex;
            align-items: center;
            gap: 12px;
            min-width: 300px;
            max-width: 500px;
            animation: slideIn 0.3s ease;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;

        // アイコンを設定
        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };

        // 色を設定
        const colors = {
            success: { bg: '#10b981', text: '#ffffff' },
            error: { bg: '#ef4444', text: '#ffffff' },
            warning: { bg: '#f59e0b', text: '#ffffff' },
            info: { bg: '#3b82f6', text: '#ffffff' }
        };

        const color = colors[type] || colors.info;
        toast.style.backgroundColor = color.bg;
        toast.style.color = color.text;

        // コンテンツを追加
        toast.innerHTML = `
            <span style="font-size: 20px;">${icons[type] || icons.info}</span>
            <span style="flex: 1;">${escapeHtml(message)}</span>
            <button onclick="this.parentElement.remove()" style="
                background: none;
                border: none;
                color: ${color.text};
                cursor: pointer;
                font-size: 20px;
                padding: 0;
                margin: 0;
                opacity: 0.8;
                transition: opacity 0.2s;
            " onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'">
                ✕
            </button>
        `;

        // DOMに追加
        document.body.appendChild(toast);

        // 自動削除
        if (duration > 0) {
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.style.animation = 'slideOut 0.3s ease';
                    setTimeout(() => toast.remove(), 300);
                }
            }, duration);
        }

        return toast;
    }

    // エイリアス関数
    function showSuccess(message, duration) {
        return showToast(message, NOTIFICATION_TYPES.SUCCESS, duration);
    }

    function showError(message, duration) {
        return showToast(message, NOTIFICATION_TYPES.ERROR, duration);
    }

    function showWarning(message, duration) {
        return showToast(message, NOTIFICATION_TYPES.WARNING, duration);
    }

    function showInfo(message, duration) {
        return showToast(message, NOTIFICATION_TYPES.INFO, duration);
    }

    // 旧関数名との互換性（段階的移行用）
    function showNotification(message, type = 'info') {
        return showToast(message, type);
    }

    // HTMLエスケープ
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // アニメーション用CSS追加
    if (!document.querySelector('#toast-animations')) {
        const style = document.createElement('style');
        style.id = 'toast-animations';
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(400px);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes slideOut {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(400px);
                    opacity: 0;
                }
            }
            
            /* レスポンシブ対応 */
            @media (max-width: 768px) {
                .toast-notification {
                    top: 10px !important;
                    right: 10px !important;
                    left: 10px !important;
                    min-width: auto !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // alert()の置き換え（自動）
    const originalAlert = window.alert;
    window.alert = function(message) {
        console.warn('[NotificationSystem] alert()は非推奨です。showToast()を使用してください。');
        showWarning(message, 5000);
        // 開発環境では元のalertも表示（デバッグ用）
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            originalAlert(message);
        }
    };

    // グローバルに公開
    window.NotificationSystem = {
        showToast,
        showSuccess,
        showError,
        showWarning,
        showInfo,
        showNotification, // 互換性用
        types: NOTIFICATION_TYPES
    };

    // 既存のグローバル関数を上書き（互換性保持）
    window.showToast = showToast;
    window.showSuccess = showSuccess;
    window.showError = showError;
    window.showWarning = showWarning;
    window.showInfo = showInfo;
    window.showNotification = showNotification;

    // console.log('[NotificationSystem] 統一通知システム初期化完了');

})();