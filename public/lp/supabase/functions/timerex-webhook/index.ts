import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createHmac } from "https://deno.land/std@0.168.0/node/crypto.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // CORSの処理
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // TimeRex Webhook署名検証
    const signature = req.headers.get('X-TimeRex-Signature')
    const body = await req.text()
    
    const webhookSecret = Deno.env.get('TIMEREX_WEBHOOK_SECRET')
    if (!webhookSecret || !signature) {
      console.error('Missing webhook secret or signature')
      return new Response('Unauthorized', {
        status: 401,
        headers: corsHeaders
      })
    }

    const expectedSignature = createHmac('sha256', webhookSecret)
      .update(body)
      .digest('hex')

    if (signature !== `sha256=${expectedSignature}`) {
      console.error('Invalid webhook signature')
      return new Response('Unauthorized', {
        status: 401,
        headers: corsHeaders
      })
    }
    
    const event = JSON.parse(body)
    console.log('TimeRex Webhook Event:', event)
    
    // Supabaseクライアント初期化
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    
    // イベントタイプに応じた処理
    switch (event.type) {
      case 'booking.created':
        await handleBookingCreated(supabase, event.data)
        break
        
      case 'booking.completed':
        await handleBookingCompleted(supabase, event.data)
        break
        
      case 'booking.cancelled':
        await handleBookingCancelled(supabase, event.data)
        break
        
      default:
        console.log('Unknown event type:', event.type)
    }
    
    return new Response(
      JSON.stringify({ success: true }),
      { 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        } 
      }
    )
    
  } catch (error) {
    console.error('Error processing webhook:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
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

// 予約作成時の処理
async function handleBookingCreated(supabase: any, booking: any) {
  console.log('Handling booking created:', booking)
  
  try {
    // 予約情報をデータベースに保存
    const { data, error } = await supabase.from('bookings').insert({
      booking_id: booking.id, // カラム名を修正
      session_ref: booking.sessionId || booking.session_id, // カラム名を修正
      user_email: booking.customer?.email || booking.email,
      user_name: booking.customer?.name || booking.name,
      staff_name: booking.staff?.name || 'INTERCONNECT担当者',
      scheduled_at: booking.scheduledAt || booking.start_time,
      duration_minutes: booking.duration || 30,
      consultation_type: booking.customFields?.consultation_type || '無料相談',
      consultation_details: booking.customFields?.consultation_details || '',
      referral_code: booking.customFields?.referral_code || 'DIRECT',
      meeting_url: booking.meetingUrl || booking.meeting_url, // カラム名を修正
      status: 'confirmed',
      created_at: new Date().toISOString()
    })
    
    if (error) {
      console.error('Error saving booking:', error)
      return
    }
    
    console.log('Booking saved successfully:', data)
    
    // 紹介者への通知（紹介コードがDIRECT以外の場合）
    const referralCode = booking.customFields?.referral_code
    if (referralCode && referralCode !== 'DIRECT') {
      await notifyReferrer(supabase, referralCode, {
        type: 'booking_created',
        bookingId: booking.id,
        customerEmail: booking.customer?.email || booking.email,
        scheduledAt: booking.scheduledAt || booking.start_time
      })
    }
    
  } catch (error) {
    console.error('Error in handleBookingCreated:', error)
  }
}

// 面談完了時の処理
async function handleBookingCompleted(supabase: any, booking: any) {
  console.log('Handling booking completed:', booking)
  
  try {
    // 予約ステータスを完了に更新
    const { error: updateError } = await supabase
      .from('bookings')
      .update({ 
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('booking_id', booking.id)
    
    if (updateError) {
      console.error('Error updating booking status:', updateError)
      return
    }
    
    // 紹介ポイントの付与
    const referralCode = booking.customFields?.referral_code
    if (referralCode && referralCode !== 'DIRECT') {
      await awardReferralPoints(supabase, referralCode, booking.id)
    }
    
  } catch (error) {
    console.error('Error in handleBookingCompleted:', error)
  }
}

// 予約キャンセル時の処理
async function handleBookingCancelled(supabase: any, booking: any) {
  console.log('Handling booking cancelled:', booking)
  
  try {
    // 予約ステータスをキャンセルに更新
    const { error } = await supabase
      .from('bookings')
      .update({ 
        status: 'cancelled',
        cancelled_at: new Date().toISOString()
      })
      .eq('booking_id', booking.id)
    
    if (error) {
      console.error('Error updating booking status:', error)
    }
    
  } catch (error) {
    console.error('Error in handleBookingCancelled:', error)
  }
}

// 紹介者への通知
async function notifyReferrer(supabase: any, referralCode: string, notification: any) {
  try {
    // 紹介者を特定
    const { data: invitation } = await supabase
      .from('invite_links')
      .select('created_by')
      .eq('link_code', referralCode)
      .eq('is_active', true)
      .maybeSingle()

    if (!invitation) {
      console.log('Referrer not found for code:', referralCode)
      return
    }
    
    // 通知を作成
    const { error } = await supabase
      .from('notifications')
      .insert({
        user_id: invitation.created_by,
        type: notification.type,
        title: '紹介による予約が入りました',
        message: `${notification.customerEmail}さんが面談を予約しました。日時: ${notification.scheduledAt}`,
        data: {
          booking_id: notification.bookingId,
          referral_code: referralCode,
          customer_email: notification.customerEmail
        },
        is_read: false,
        created_at: new Date().toISOString()
      })
    
    if (error) {
      console.error('Error creating notification:', error)
    } else {
      console.log('Notification sent to referrer:', invitation.created_by)
    }
    
  } catch (error) {
    console.error('Error in notifyReferrer:', error)
  }
}

// 紹介ポイントの付与
async function awardReferralPoints(supabase: any, referralCode: string, bookingId: string) {
  try {
    // 紹介者を特定
    const { data: invitation } = await supabase
      .from('invite_links')
      .select('created_by')
      .eq('link_code', referralCode)
      .eq('is_active', true)
      .maybeSingle()

    if (!invitation) {
      console.log('Referrer not found for points award:', referralCode)
      return
    }
    
    // ポイントを付与（1000ポイント）
    const { error: pointsError } = await supabase.rpc('add_referral_points', {
      p_referral_code: referralCode,
      p_points: 1000,
      p_reason: 'referral_meeting_completed',
      p_booking_id: bookingId
    })
    
    if (pointsError) {
      console.error('Error awarding points:', pointsError)
    } else {
      console.log('Points awarded to:', invitation.created_by)
      
      // ポイント付与の通知
      await supabase
        .from('notifications')
        .insert({
          user_id: invitation.created_by,
          type: 'points_awarded',
          title: '紹介ポイントを獲得しました',
          message: '面談完了により1,000ポイントを獲得しました！',
          data: {
            points: 1000,
            booking_id: bookingId,
            referral_code: referralCode
          },
          is_read: false,
          created_at: new Date().toISOString()
        })
    }
    
  } catch (error) {
    console.error('Error in awardReferralPoints:', error)
  }
}