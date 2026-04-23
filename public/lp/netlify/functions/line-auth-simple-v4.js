/**
 * LINE Authentication Function (Simplified v4)
 * より堅牢なユーザー作成・更新処理
 */

const { checkRateLimit, getClientIP, isValidRedirectURL } = require('./utils/security');

exports.handler = async (event, context) => {
    console.log('=== LINE Auth Simple v4 Handler ===');
    console.log('Method:', event.httpMethod);

    // CORS: 許可オリジンのチェック
    const ALLOWED_ORIGINS = [
        'https://inter-connect.app',
        'http://localhost:8888',
        'http://localhost:3000'
    ];
    const requestOrigin = event.headers.origin || event.headers.Origin || '';
    const corsOrigin = ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGINS[0];

    const headers = {
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    // CORS対応
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // レート制限チェック
    const clientIP = getClientIP(event);
    const rateLimitResult = checkRateLimit(clientIP);
    if (!rateLimitResult.allowed) {
        console.warn('Rate limit exceeded for IP:', clientIP);
        return {
            statusCode: 429,
            headers: { ...headers, 'Retry-After': String(rateLimitResult.retryAfter) },
            body: JSON.stringify({ error: 'Too many requests. Please try again later.' })
        };
    }

    try {
        // リクエストボディの解析
        let body;
        try {
            body = JSON.parse(event.body);
        } catch (e) {
            console.error('Invalid JSON:', event.body);
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Invalid request body' })
            };
        }

        const { code, redirect_uri, liff_access_token } = body;

        // 2つのモード: OAuthコード or LIFFアクセストークン
        const isLiffMode = !!liff_access_token;

        if (!isLiffMode && (!code || !redirect_uri)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Missing required parameters' })
            };
        }

        // OAuthモード: redirect_uri のドメイン検証（オープンリダイレクト防止）
        if (!isLiffMode) {
            const ALLOWED_REDIRECT_DOMAINS = ['inter-connect.app', 'localhost'];
            if (!isValidRedirectURL(redirect_uri, ALLOWED_REDIRECT_DOMAINS)) {
                console.error('Invalid redirect_uri:', redirect_uri);
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Invalid redirect URI' })
                };
            }
        }

        console.log('Processing LINE auth:', isLiffMode ? 'LIFF mode' : 'OAuth mode');

        // 環境変数の確認
        const LINE_CHANNEL_ID = process.env.LINE_CHANNEL_ID;
        const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

        if (!isLiffMode && (!LINE_CHANNEL_ID || !LINE_CHANNEL_SECRET)) {
            console.error('Missing LINE credentials');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Server configuration error (LINE)' })
            };
        }

        if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
            console.error('Missing Supabase credentials');
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: 'Server configuration error (Supabase)' })
            };
        }

        let profile;

        if (isLiffMode) {
            // === LIFFモード: アクセストークンで直接プロフィール取得 ===
            console.log('Getting LINE profile via LIFF access token...');
            const profileResponse = await fetch('https://api.line.me/v2/profile', {
                headers: {
                    'Authorization': `Bearer ${liff_access_token}`
                }
            });

            if (!profileResponse.ok) {
                const errorText = await profileResponse.text();
                console.error('LIFF profile error:', profileResponse.status, errorText);
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: 'Failed to get user profile via LIFF token',
                        details: errorText
                    })
                };
            }

            profile = await profileResponse.json();
        } else {
            // === OAuthモード: 認可コードでトークン交換 → プロフィール取得 ===
            console.log('Getting LINE access token...');
            const tokenResponse = await fetch('https://api.line.me/oauth2/v2.1/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code: code,
                    redirect_uri: redirect_uri,
                    client_id: LINE_CHANNEL_ID,
                    client_secret: LINE_CHANNEL_SECRET
                })
            });

            if (!tokenResponse.ok) {
                const errorText = await tokenResponse.text();
                console.error('Token error:', tokenResponse.status, errorText);
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: 'Failed to get access token',
                        details: errorText
                    })
                };
            }

            const tokenData = await tokenResponse.json();
            console.log('Access token obtained');

            // LINEプロファイル取得
            console.log('Getting LINE profile...');
            const profileResponse = await fetch('https://api.line.me/v2/profile', {
                headers: {
                    'Authorization': `Bearer ${tokenData.access_token}`
                }
            });

            if (!profileResponse.ok) {
                const errorText = await profileResponse.text();
                console.error('Profile error:', profileResponse.status, errorText);
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({
                        error: 'Failed to get user profile',
                        details: errorText
                    })
                };
            }

            profile = await profileResponse.json();
        }
        console.log('LINE Profile:', {
            userId: profile.userId,
            displayName: profile.displayName
        });

        // Supabase処理
        try {
            const { createClient } = require('@supabase/supabase-js');
            const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

            console.log('Supabase client created');

            // メールアドレスの生成
            const lineEmail = `line_${profile.userId}@interconnect.com`;
            
            // ユーザーの作成または更新（より安全な方法）
            let authUser;
            let isNewUser = false;
            
            try {
                // まず、既存ユーザーを検索
                console.log('Searching for existing user with email:', lineEmail);
                const { data: { users }, error: listError } = await supabase.auth.admin.listUsers({
                    perPage: 1000
                });

                if (listError && listError.code !== 'resource_not_found') {
                    console.error('Error listing users:', listError);
                    throw listError;
                }

                const existingUser = users ? users.find(u => u.email === lineEmail) : null;
                
                if (existingUser) {
                    console.log('Existing user found:', existingUser.id);
                    authUser = existingUser;
                    
                    // ユーザーメタデータを更新
                    try {
                        const { data: updatedUser, error: updateError } = await supabase.auth.admin.updateUserById(
                            existingUser.id,
                            {
                                user_metadata: {
                                    ...existingUser.user_metadata,
                                    name: profile.displayName,
                                    picture: profile.pictureUrl,
                                    provider: 'line',
                                    line_user_id: profile.userId,
                                    last_login_at: new Date().toISOString()
                                }
                            }
                        );
                        
                        if (updateError) {
                            console.error('Error updating user metadata:', updateError);
                            // メタデータの更新エラーは無視して続行
                        } else if (updatedUser) {
                            authUser = updatedUser;
                        }
                    } catch (updateErr) {
                        console.error('Update metadata error:', updateErr);
                        // メタデータの更新エラーは無視して続行
                    }
                } else {
                    console.log('Creating new user...');
                    isNewUser = true;
                    
                    // 新規ユーザーを作成（エラーハンドリング改善）
                    try {
                        const { data: { user }, error: createError } = await supabase.auth.admin.createUser({
                            email: lineEmail,
                            email_confirm: true,
                            user_metadata: {
                                name: profile.displayName,
                                picture: profile.pictureUrl,
                                provider: 'line',
                                line_user_id: profile.userId,
                                created_via: 'line_login',
                                created_at: new Date().toISOString()
                            }
                        });
                        
                        if (createError) {
                            // ユーザーが既に存在する場合のエラーをチェック
                            if (createError.message && createError.message.includes('already been registered')) {
                                console.log('User already exists, attempting to find...');
                                // 再度検索を試みる
                                const { data: { users: retryUsers }, error: retryError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
                                
                                if (!retryError && retryUsers) {
                                    const foundUser = retryUsers.find(u => u.email === lineEmail);
                                    if (foundUser) {
                                        console.log('Found existing user on retry:', foundUser.id);
                                        authUser = foundUser;
                                        isNewUser = false;
                                    } else {
                                        throw new Error('User exists but cannot be found');
                                    }
                                } else {
                                    throw createError;
                                }
                            } else {
                                throw createError;
                            }
                        } else {
                            console.log('New user created:', user.id);
                            authUser = user;
                        }
                    } catch (createErr) {
                        console.error('Create user error:', createErr);
                        throw createErr;
                    }
                }
            } catch (authError) {
                console.error('Auth operation error:', authError);
                throw authError;
            }

            // Supabaseセッション用のマジックリンクトークンを生成
            let sessionToken = null;
            try {
                const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
                    type: 'magiclink',
                    email: lineEmail
                });

                if (!linkError && linkData?.properties?.hashed_token) {
                    sessionToken = {
                        token_hash: linkData.properties.hashed_token,
                        email: lineEmail
                    };
                    console.log('Session token generated for:', lineEmail);
                } else {
                    console.warn('Could not generate session token:', linkError?.message);
                }
            } catch (tokenErr) {
                console.warn('Session token generation error:', tokenErr.message);
            }

            // 成功レスポンス
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    success: true,
                    user: {
                        id: authUser.id,
                        email: lineEmail,
                        display_name: profile.displayName,
                        picture_url: profile.pictureUrl,
                        line_user_id: profile.userId,
                        is_new_user: isNewUser
                    },
                    session: sessionToken,
                    redirect_to: 'dashboard.html',
                    message: isNewUser ? 'New user created successfully' : 'User logged in successfully'
                })
            };

        } catch (supabaseError) {
            console.error('Supabase error:', supabaseError);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ 
                    error: 'Database error',
                    details: supabaseError.message || 'Unknown error',
                    type: 'SupabaseError'
                })
            };
        }

    } catch (error) {
        console.error('Function error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};