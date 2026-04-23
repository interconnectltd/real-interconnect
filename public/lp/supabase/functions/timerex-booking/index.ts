import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? 'https://inter-connect.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TIMEREX_API_URL = 'https://api.timerex.jp/v1'
const TIMEREX_API_KEY = Deno.env.get('TIMEREX_API_KEY') ?? ''

serve(async (req) => {
  // CORSの処理
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ユーザー認証チェック
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Authorization header required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const token = authHeader.substring(7)

    // Supabase anon client でJWTを検証
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token)

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // リクエストボディから referralCode のみ取得（userId はJWTから取得）
    const { referralCode } = await req.json()
    const userId = user.id
    const userEmail = user.email ?? ''
    const userName = user.user_metadata?.display_name ?? user.user_metadata?.name ?? ''

    console.log('Creating TimeRex booking session:', {
      referralCode,
      userId,
      userEmail,
      userName
    })

    // TimeRexの予約セッションを作成
    const sessionResponse = await fetch(`${TIMEREX_API_URL}/booking-sessions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TIMEREX_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        bookingPageId: Deno.env.get('TIMEREX_BOOKING_PAGE_ID') || 'interconnect-consultation',
        prefill: {
          name: userName,
          email: userEmail
        },
        customFields: {
          referral_code: referralCode || 'DIRECT',
          user_id: userId,
          source: 'interconnect'
        },
        metadata: {
          userId: userId,
          source: 'interconnect',
          timestamp: new Date().toISOString()
        }
      })
    })

    if (!sessionResponse.ok) {
      const errorText = await sessionResponse.text()
      console.error('TimeRex API error:', errorText)
      throw new Error(`TimeRex API error: ${sessionResponse.status}`)
    }

    const session = await sessionResponse.json()
    console.log('TimeRex session created:', session)

    // Supabase service role clientでDB保存
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // セッション情報をデータベースに保存
    const { error: dbError } = await supabase.from('booking_sessions').insert({
      session_id: session.id,
      user_id: userId,
      user_email: userEmail,
      referral_code: referralCode || 'DIRECT',
      status: 'pending',
      session_data: session,
      created_at: new Date().toISOString()
    })

    if (dbError) {
      console.error('Error saving session to database:', dbError)
      // データベースエラーでもTimeRexのURLは返す
    }

    return new Response(
      JSON.stringify({
        success: true,
        sessionId: session.id,
        bookingUrl: session.bookingUrl || session.url,
        embedUrl: session.embedUrl
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    )

  } catch (error) {
    console.error('Error creating booking session:', error)

    return new Response(
      JSON.stringify({
        success: false,
        error: 'Failed to create booking session'
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    )
  }
})
