import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-tldv-signature',
}

// 環境変数（Supabase Edge Functionsが自動注入するURL/KEYに加え、カスタム変数を検証）
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const TLDV_WEBHOOK_SECRET = Deno.env.get('TLDV_WEBHOOK_SECRET') ?? ''
const TLDV_API_KEY = Deno.env.get('TLDV_API_KEY') ?? ''

// Supabaseクライアント初期化
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// 定数時間文字列比較（タイミング攻撃防止）
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const encoder = new TextEncoder()
  const aBuf = encoder.encode(a)
  const bBuf = encoder.encode(b)
  let diff = 0
  for (let i = 0; i < aBuf.length; i++) {
    diff |= aBuf[i] ^ bBuf[i]
  }
  return diff === 0
}

// Webhook署名の検証
async function verifyWebhookSignature(payload: string, signature: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const data = encoder.encode(payload)
  const key = encoder.encode(TLDV_WEBHOOK_SECRET)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, data)
  const computedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  return timingSafeEqual(signature, computedSignature)
}

// メールアドレスから招待を検索
async function findInvitationByEmail(email: string) {
  // ユーザーを検索
  const { data: userData } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (!userData) return null

  // 最新の未完了招待を検索
  const { data: invitation } = await supabase
    .from('invitations')
    .select('*')
    .eq('invitee_id', userData.id)
    .eq('status', 'registered')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return invitation
}

// 面談終了時の処理
async function processMeetingEnded(meetingData: any) {
  const { meeting_id, participants, duration_seconds, ended_at } = meetingData

  console.log(`Processing meeting ended: ${meeting_id}`)

  if (!Array.isArray(participants) || participants.length === 0) {
    console.log('No participants in meeting data, skipping')
    return
  }

  for (const participant of participants) {
    const invitation = await findInvitationByEmail(participant.email)
    
    if (invitation) {
      console.log(`Found invitation for ${participant.email}`)
      
      // tl:dv会議記録を作成
      const { error: recordError } = await supabase
        .from('tldv_meeting_records')
        .insert({
          meeting_id: meeting_id,
          invitee_email: participant.email,
          meeting_date: ended_at,
          duration_minutes: Math.floor(duration_seconds / 60),
          is_valid: duration_seconds >= 900 // 15分以上を有効とする
        })
      
      if (recordError) {
        console.error('Error creating meeting record:', recordError)
        continue
      }
      
      // 面談が有効な場合、報酬処理を実行
      if (duration_seconds >= 900) {
        const { error: rewardError } = await supabase
          .rpc('process_referral_reward', { p_invitation_id: invitation.id })
        
        if (rewardError) {
          console.error('Error processing reward:', rewardError)
        } else {
          console.log(`Reward processed for invitation ${invitation.id}`)
        }
      }
    }
  }
}

// 録画準備完了時の処理
async function processRecordingReady(recordingData: any) {
  const { meeting_id, recording_url, duration_seconds } = recordingData
  
  const { error } = await supabase
    .from('tldv_meeting_records')
    .update({ 
      recording_url: recording_url,
      duration_minutes: Math.floor(duration_seconds / 60)
    })
    .eq('meeting_id', meeting_id)
  
  if (error) {
    console.error('Error updating recording URL:', error)
  }
}

// tl;dv REST APIからトランスクリプト本文を取得
async function fetchTranscriptFromTldv(meetingId: string): Promise<any> {
  const res = await fetch(`https://pasta.tldv.io/v1alpha1/meetings/${meetingId}/transcript`, {
    headers: { 'x-api-key': TLDV_API_KEY }
  })
  if (!res.ok) {
    throw new Error(`tl;dv API error: ${res.status} ${res.statusText}`)
  }
  return await res.json()
}

// tl;dv REST APIからミーティング詳細を取得
async function fetchMeetingDetails(meetingId: string): Promise<any> {
  const res = await fetch(`https://pasta.tldv.io/v1alpha1/meetings/${meetingId}`, {
    headers: { 'x-api-key': TLDV_API_KEY }
  })
  if (!res.ok) {
    throw new Error(`tl;dv meeting API error: ${res.status} ${res.statusText}`)
  }
  return await res.json()
}

// メールアドレスからuser_idを解決
async function resolveUserId(email: string): Promise<string | null> {
  const { data } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle()
  return data?.id ?? null
}

// 日本語名正規化（全角→半角、空白除去、小文字化）
function normalizeJapaneseName(name: string): string {
  if (!name) return ''
  return name
    .replace(/[\s　]+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c =>
      String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .toLowerCase()
}

// 多段階スピーカー紐付け
async function linkSpeakerToUser(
  speaker: string,
  meetingParticipants: any[],
  organizerEmail?: string
): Promise<{ userId: string | null, email: string | null }> {
  // Strategy 1: 参加者リストから名前でメール取得
  const participantByName = meetingParticipants.find(
    (p: any) => p.name === speaker || p.display_name === speaker
  )
  if (participantByName?.email) {
    const userId = await resolveUserId(participantByName.email)
    if (userId) return { userId, email: participantByName.email }
    return { userId: null, email: participantByName.email }
  }

  // Strategy 2: organizer チェック
  if (organizerEmail) {
    const { data: orgProfile } = await supabase
      .from('user_profiles')
      .select('id, name, full_name')
      .eq('email', organizerEmail)
      .maybeSingle()
    if (orgProfile && (
      normalizeJapaneseName(orgProfile.name ?? '') === normalizeJapaneseName(speaker) ||
      normalizeJapaneseName(orgProfile.full_name ?? '') === normalizeJapaneseName(speaker)
    )) {
      return { userId: orgProfile.id, email: organizerEmail }
    }
  }

  // Strategy 3: user_profilesから正規化名前マッチ
  const { data: candidates } = await supabase
    .from('user_profiles')
    .select('id, name, full_name, email')
    .eq('is_active', true)

  if (candidates) {
    const normalizedSpeaker = normalizeJapaneseName(speaker)
    const normalizedMatch = candidates.find(c =>
      normalizeJapaneseName(c.name ?? '') === normalizedSpeaker ||
      normalizeJapaneseName(c.full_name ?? '') === normalizedSpeaker
    )
    if (normalizedMatch) return { userId: normalizedMatch.id, email: normalizedMatch.email }

    // 姓のみ部分一致
    if (normalizedSpeaker.length >= 2) {
      const lastNameMatch = candidates.find(c => {
        const parts = (c.name ?? '').split(/[\s　]+/)
        return parts.some((part: string) => part.length >= 2 && normalizeJapaneseName(part) === normalizedSpeaker)
      })
      if (lastNameMatch) return { userId: lastNameMatch.id, email: lastNameMatch.email }
    }
  }

  // Strategy 4: 過去のリンク実績参照
  const { data: previousLink } = await supabase
    .from('meeting_participants')
    .select('user_id, email')
    .eq('speaker_name', speaker)
    .eq('is_linked', true)
    .limit(1)
    .maybeSingle()

  if (previousLink?.user_id) {
    return { userId: previousLink.user_id, email: previousLink.email }
  }

  return { userId: null, email: null }
}

// 文字起こし準備完了時の処理（拡張版）
async function processTranscriptReady(transcriptData: any) {
  const { meeting_id, transcript_url } = transcriptData

  // 1. 既存: tldv_meeting_recordsにtranscript_urlを保存
  const { error: updateError } = await supabase
    .from('tldv_meeting_records')
    .update({ transcript_url: transcript_url })
    .eq('meeting_id', meeting_id)

  if (updateError) {
    console.error('Error updating transcript URL:', updateError)
  }

  // APIキーがなければ本文取得はスキップ
  if (!TLDV_API_KEY) {
    console.log('TLDV_API_KEY not set, skipping transcript fetch')
    return
  }

  // 冪等性チェック: 同じmeeting_idのトランスクリプトが既に処理済みならスキップ
  const { data: existingTranscript } = await supabase
    .from('meeting_transcripts')
    .select('id, status')
    .eq('tldv_meeting_id', meeting_id)
    .maybeSingle()

  if (existingTranscript) {
    console.log(`Transcript already exists for meeting ${meeting_id} (status: ${existingTranscript.status}), skipping`)
    return
  }

  // 2. tldv_meeting_recordsのIDを取得
  const { data: tldvRecord } = await supabase
    .from('tldv_meeting_records')
    .select('id')
    .eq('meeting_id', meeting_id)
    .maybeSingle()

  // 3. meeting_transcriptsにpendingレコードを作成
  const { data: transcriptRecord, error: insertError } = await supabase
    .from('meeting_transcripts')
    .insert({
      tldv_meeting_id: meeting_id,
      tldv_record_id: tldvRecord?.id ?? null,
      status: 'fetching'
    })
    .select('id')
    .single()

  if (insertError || !transcriptRecord) {
    console.error('Error creating transcript record:', insertError)
    return
  }

  const transcriptId = transcriptRecord.id

  try {
    // 4. tl;dv APIからトランスクリプト本文を取得
    const transcriptBody = await fetchTranscriptFromTldv(meeting_id)

    // 5. ミーティング詳細を取得（タイトル、日時、参加者メール等）
    let meetingDetails: any = {}
    try {
      meetingDetails = await fetchMeetingDetails(meeting_id)
    } catch (e) {
      console.warn('Could not fetch meeting details:', e)
    }

    // 6. トランスクリプトを解析してfull_textを構築
    const segments = Array.isArray(transcriptBody) ? transcriptBody
      : transcriptBody?.data ?? transcriptBody?.transcript ?? transcriptBody?.segments ?? []

    const fullText = segments
      .map((s: any) => `${s.speaker_name ?? s.speaker ?? ''}: ${s.text ?? s.content ?? ''}`)
      .join('\n')

    const speakers = [...new Set(segments.map((s: any) => s.speaker_name ?? s.speaker ?? ''))].filter(s => s !== '')
    const totalWords = fullText.length // 日本語は文字数ベース

    // 7. meeting_transcriptsを更新
    await supabase
      .from('meeting_transcripts')
      .update({
        title: meetingDetails.title ?? null,
        meeting_date: meetingDetails.started_at ?? meetingDetails.date ?? null,
        duration_minutes: meetingDetails.duration_seconds
          ? Math.floor(meetingDetails.duration_seconds / 60)
          : null,
        raw_transcript: segments,
        full_text: fullText,
        word_count: totalWords,
        speaker_count: speakers.length,
        status: 'ready',
        updated_at: new Date().toISOString()
      })
      .eq('id', transcriptId)

    // 8. 参加者レコードを作成（多段階スピーカー紐付け）
    const mdParticipants = meetingDetails.participants ?? meetingDetails.invitees ?? []
    const organizerEmail = meetingDetails.organizer?.email ?? null
    for (const speaker of speakers) {
      const { userId, email } = await linkSpeakerToUser(speaker, mdParticipants, organizerEmail)

      // スピーカーの発言量を計算
      const speakerSegments = segments.filter(
        (s: any) => (s.speaker_name ?? s.speaker) === speaker
      )
      const speakerWordCount = speakerSegments
        .reduce((sum: number, s: any) => sum + (s.text ?? s.content ?? '').length, 0)
      const speakerDuration = speakerSegments
        .reduce((sum: number, s: any) => {
          const start = s.start_time ?? s.startTime ?? 0
          const end = s.end_time ?? s.endTime ?? start
          return sum + (end - start)
        }, 0)

      const participantData = {
        transcript_id: transcriptId,
        user_id: userId,
        email: email,
        speaker_name: speaker,
        speaking_duration_seconds: Math.floor(speakerDuration),
        speaking_ratio: totalWords > 0 ? speakerWordCount / totalWords : 0,
        word_count: speakerWordCount,
        is_linked: !!userId
      }

      if (email) {
        // emailがある場合はemail基準でupsert
        await supabase
          .from('meeting_participants')
          .upsert(participantData, { onConflict: 'transcript_id,email' })
      } else {
        // emailがNULLの場合は既存レコードをspeaker_nameで確認
        const { data: existing } = await supabase
          .from('meeting_participants')
          .select('id')
          .eq('transcript_id', transcriptId)
          .eq('speaker_name', speaker)
          .is('email', null)
          .maybeSingle()

        if (existing) {
          await supabase
            .from('meeting_participants')
            .update(participantData)
            .eq('id', existing.id)
        } else {
          await supabase
            .from('meeting_participants')
            .insert(participantData)
        }
      }
    }

    console.log(`Transcript processed: ${meeting_id}, ${speakers.length} speakers, ${totalWords} chars`)

    // 9. analyze-transcript Edge Functionを非同期呼び出し（fire-and-forget）
    // awaitしないことでwebhookのタイムアウトを回避
    fetch(`${SUPABASE_URL}/functions/v1/analyze-transcript`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({ transcript_id: transcriptId })
    })
      .then(() => console.log(`Analysis triggered for transcript ${transcriptId}`))
      .catch(e => console.warn('Could not trigger analysis:', e))

  } catch (error) {
    // エラー時はステータスを更新
    await supabase
      .from('meeting_transcripts')
      .update({
        status: 'error',
        error_message: String(error?.message ?? error),
        updated_at: new Date().toISOString()
      })
      .eq('id', transcriptId)

    console.error('Error fetching transcript:', error)
  }
}

serve(async (req) => {
  // CORS対応
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 環境変数チェック
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !TLDV_WEBHOOK_SECRET) {
      console.error('Missing required environment variables')
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // リクエストボディを取得
    const payload = await req.text()

    // 署名検証
    const signature = req.headers.get('x-tldv-signature')
    if (!signature || !await verifyWebhookSignature(payload, signature)) {
      return new Response(
        JSON.stringify({ error: 'Invalid signature' }),
        { 
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }
    
    // イベントをパース
    const event = JSON.parse(payload)
    console.log(`Received tl:dv webhook: ${event.type}`)
    
    // イベントタイプに応じた処理
    switch (event.type) {
      case 'meeting.ended':
        await processMeetingEnded(event.data)
        break
      
      case 'recording.ready':
        await processRecordingReady(event.data)
        break
      
      case 'transcript.ready':
        await processTranscriptReady(event.data)
        break
      
      default:
        console.log(`Unhandled event type: ${event.type}`)
    }
    
    return new Response(
      JSON.stringify({ success: true }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
    
  } catch (error) {
    console.error('Webhook error:', error)
    return new Response(
      JSON.stringify({ error: String(error?.message ?? error) }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})