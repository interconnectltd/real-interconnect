/**
 * セキュリティユーティリティ
 */

const crypto = require('crypto');

/**
 * CSRF対策: stateパラメータの生成
 */
function generateState() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * CSRF対策: stateパラメータの検証
 */
function validateState(providedState, expectedState) {
    if (!providedState || !expectedState) {
        return false;
    }
    // タイミング攻撃を防ぐため、crypto.timingSafeEqualを使用
    const provided = Buffer.from(providedState);
    const expected = Buffer.from(expectedState);
    
    if (provided.length !== expected.length) {
        return false;
    }
    
    return crypto.timingSafeEqual(provided, expected);
}

/**
 * リクエストの検証
 */
function validateRequest(event, requiredFields = []) {
    // HTTPメソッドの検証
    if (event.httpMethod === 'OPTIONS') {
        return {
            valid: false,
            response: {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGINS || 'https://inter-connect.app',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS'
                },
                body: ''
            }
        };
    }

    // Content-Typeの検証
    const contentType = event.headers['content-type'] || event.headers['Content-Type'];
    if (!contentType || !contentType.includes('application/json')) {
        return {
            valid: false,
            error: new Error('Content-Type must be application/json')
        };
    }

    // リクエストボディの解析
    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (error) {
        return {
            valid: false,
            error: new Error('Invalid JSON in request body')
        };
    }

    // 必須フィールドの検証
    for (const field of requiredFields) {
        if (!body[field]) {
            return {
                valid: false,
                error: new Error(`Missing required field: ${field}`)
            };
        }
    }

    return {
        valid: true,
        body
    };
}

/**
 * IP アドレスの取得
 */
function getClientIP(event) {
    // Netlifyのヘッダーから実際のIPを取得
    return event.headers['x-nf-client-connection-ip'] || 
           event.headers['x-forwarded-for']?.split(',')[0] || 
           'unknown';
}

/**
 * レート制限（簡易版）
 * 本番環境では Redis などの外部ストレージを使用すべき
 */
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1分
const RATE_LIMIT_MAX_REQUESTS = 10; // 1分あたり10リクエスト

function checkRateLimit(identifier) {
    const now = Date.now();
    const userRequests = rateLimitStore.get(identifier) || [];
    
    // 古いリクエストを削除
    const recentRequests = userRequests.filter(
        timestamp => now - timestamp < RATE_LIMIT_WINDOW
    );
    
    if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
        return {
            allowed: false,
            retryAfter: Math.ceil((recentRequests[0] + RATE_LIMIT_WINDOW - now) / 1000)
        };
    }
    
    // 新しいリクエストを記録
    recentRequests.push(now);
    rateLimitStore.set(identifier, recentRequests);
    
    // メモリリークを防ぐため、古いエントリを定期的に削除
    if (rateLimitStore.size > 1000) {
        const oldestAllowed = now - RATE_LIMIT_WINDOW;
        for (const [key, requests] of rateLimitStore.entries()) {
            if (requests[requests.length - 1] < oldestAllowed) {
                rateLimitStore.delete(key);
            }
        }
    }
    
    return { allowed: true };
}

/**
 * URLの検証
 */
function isValidRedirectURL(url, allowedDomains = []) {
    try {
        const parsed = new URL(url);
        
        // プロトコルの検証
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return false;
        }
        
        // ドメインの検証
        if (allowedDomains.length > 0) {
            return allowedDomains.some(domain => 
                parsed.hostname === domain || 
                parsed.hostname.endsWith(`.${domain}`)
            );
        }
        
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * XSS対策: HTMLエスケープ
 */
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

module.exports = {
    generateState,
    validateState,
    validateRequest,
    getClientIP,
    checkRateLimit,
    isValidRedirectURL,
    escapeHtml
};