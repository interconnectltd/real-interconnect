/**
 * エラーハンドリングユーティリティ
 */

class APIError extends Error {
    constructor(message, statusCode = 500, details = null) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
        this.name = 'APIError';
    }
}

/**
 * エラーレスポンスを生成
 */
function createErrorResponse(error) {
    // ログ出力（本番環境では適切なロギングサービスに送信）
    console.error('API Error:', {
        message: error.message,
        stack: error.stack,
        details: error.details,
        timestamp: new Date().toISOString()
    });

    // クライアントに返すエラー情報（スタックトレースは含めない）
    const response = {
        error: error.message || 'Internal server error',
        timestamp: new Date().toISOString()
    };

    // 開発環境のみ詳細情報を含める
    if (process.env.NODE_ENV === 'development' && error.details) {
        response.details = error.details;
    }

    return {
        statusCode: error.statusCode || 500,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGINS || 'https://inter-connect.app',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'POST, OPTIONS'
        },
        body: JSON.stringify(response)
    };
}

/**
 * 非同期関数のエラーハンドリングラッパー
 */
function asyncHandler(fn) {
    return async (event, context) => {
        try {
            return await fn(event, context);
        } catch (error) {
            return createErrorResponse(error);
        }
    };
}

/**
 * 入力検証エラー
 */
class ValidationError extends APIError {
    constructor(message, field = null) {
        super(message, 400, { field });
        this.name = 'ValidationError';
    }
}

/**
 * 認証エラー
 */
class AuthenticationError extends APIError {
    constructor(message = 'Authentication failed') {
        super(message, 401);
        this.name = 'AuthenticationError';
    }
}

/**
 * 権限エラー
 */
class AuthorizationError extends APIError {
    constructor(message = 'Access denied') {
        super(message, 403);
        this.name = 'AuthorizationError';
    }
}

/**
 * リソースが見つからないエラー
 */
class NotFoundError extends APIError {
    constructor(resource = 'Resource') {
        super(`${resource} not found`, 404);
        this.name = 'NotFoundError';
    }
}

/**
 * レート制限エラー
 */
class RateLimitError extends APIError {
    constructor(message = 'Too many requests') {
        super(message, 429);
        this.name = 'RateLimitError';
    }
}

module.exports = {
    APIError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    RateLimitError,
    createErrorResponse,
    asyncHandler
};