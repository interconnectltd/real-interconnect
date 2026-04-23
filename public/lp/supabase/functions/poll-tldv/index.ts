import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SUPABASE_JWT_SECRET = Deno.env.get('SUPABASE_JWT_SECRET') ?? ''
const TLDV_API_KEY = Deno.env.get('TLDV_API_KEY') ?? ''

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// JWT署名検証（HMAC-SHA256）
async function verifyServiceRoleJWT(token: string): Promise<boolean> {
  try {
    if (!SUPABASE_JWT_SECRET) return false
    const parts = token.split('.')
    if (parts.length !== 3) return false
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(SUPABASE_JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    )
    // Base64URL → Uint8Array
    const sig = parts[2].replace(/-/g, '+').replace(/_/g, '/')
    const padded = sig + '='.repeat((4 - sig.length % 4) % 4)
    const sigBytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0))
    const data = encoder.encode(parts[0] + '.' + parts[1])
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, data)
    if (!valid) return false
    const payload = JSON.parse(atob(parts[1]))
    if (payload.role !== 'service_role') return false
    if (payload.exp && Date.now() / 1000 > payload.exp) return false
    return true
  } catch { return false }
}

// tl;dv APIからミーティング一覧を取得
async function fetchMeetings(page = 1, pageSize = 20): Promise<any> {
  const res = await fetch(
    `https://pasta.tldv.io/v1alpha1/meetings?page=${page}&pageSize=${pageSize}`,
    { headers: { 'x-api-key': TLDV_API_KEY } }
  )
  if (!res.ok) throw new Error(`tl;dv meetings API error: ${res.status}`)
  return await res.json()
}

// tl;dv APIからトランスクリプトを取得
async function fetchTranscript(meetingId: string): Promise<any> {
  const res = await fetch(
    `https://pasta.tldv.io/v1alpha1/meetings/${meetingId}/transcript`,
    { headers: { 'x-api-key': TLDV_API_KEY } }
  )
  if (!res.ok) throw new Error(`tl;dv transcript API error: ${res.status}`)
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

// ユーザープロフィールキャッシュ（リクエスト内で使い回し、N+1回避）
let _userProfilesCache: any[] | null = null

async function getAllUserProfiles(): Promise<any[]> {
  if (_userProfilesCache) return _userProfilesCache
  const { data } = await supabase
    .from('user_profiles')
    .select('id, name, full_name, email')
    .eq('is_active', true)
  _userProfilesCache = data ?? []
  return _userProfilesCache
}

// 多段階スピーカー紐付け（キャッシュ利用でN+1回避）
async function linkSpeakerToUser(
  speaker: string,
  invitees: any[],
  organizerEmail?: string
): Promise<{ userId: string | null, email: string | null }> {
  // Strategy 1: invitees配列から名前でメール取得 → user_idに解決
  const inviteeByName = invitees.find(
    (p: any) => p.name === speaker || p.display_name === speaker
  )
  if (inviteeByName?.email) {
    const candidates = await getAllUserProfiles()
    const match = candidates.find(c => c.email === inviteeByName.email)
    if (match) return { userId: match.id, email: inviteeByName.email }
    return { userId: null, email: inviteeByName.email }
  }

  const candidates = await getAllUserProfiles()
  const normalizedSpeaker = normalizeJapaneseName(speaker)

  // Strategy 2: organizer チェック
  if (organizerEmail) {
    const orgProfile = candidates.find(c => c.email === organizerEmail)
    if (orgProfile && (
      normalizeJapaneseName(orgProfile.name ?? '') === normalizedSpeaker ||
      normalizeJapaneseName(orgProfile.full_name ?? '') === normalizedSpeaker
    )) {
      return { userId: orgProfile.id, email: organizerEmail }
    }
  }

  // Strategy 3: 正規化名前マッチ
  const normalizedMatch = candidates.find(c =>
    normalizeJapaneseName(c.name ?? '') === normalizedSpeaker ||
    normalizeJapaneseName(c.full_name ?? '') === normalizedSpeaker
  )
  if (normalizedMatch) return { userId: normalizedMatch.id, email: normalizedMatch.email }

  // Strategy 3b: 姓のみ部分一致
  if (normalizedSpeaker.length >= 2) {
    const lastNameMatch = candidates.find(c => {
      const parts = (c.name ?? '').split(/[\s　]+/)
      return parts.some((part: string) => part.length >= 2 && normalizeJapaneseName(part) === normalizedSpeaker)
    })
    if (lastNameMatch) return { userId: lastNameMatch.id, email: lastNameMatch.email }
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

// ミーティングを処理
async function processMeeting(meeting: any): Promise<string | null> {
  const meetingId = meeting.id

  // 既に処理済みならスキップ
  const { data: existing } = await supabase
    .from('meeting_transcripts')
    .select('id')
    .eq('tldv_meeting_id', meetingId)
    .maybeSingle()

  if (existing) return null

  // トランスクリプトを取得
  let transcriptBody: any
  try {
    transcriptBody = await fetchTranscript(meetingId)
  } catch (e) {
    console.warn(`Could not fetch transcript for ${meetingId}:`, e)
    return null
  }

  const segments = transcriptBody?.data ?? transcriptBody?.transcript ?? transcriptBody?.segments ?? []
  if (!Array.isArray(segments) || segments.length === 0) {
    console.log(`No transcript segments for ${meetingId}, skipping`)
    return null
  }

  const fullText = segments
    .map((s: any) => `${s.speaker ?? ''}: ${s.text ?? ''}`)
    .join('\n')

  const speakers = [...new Set(segments.map((s: any) => s.speaker ?? ''))].filter(s => s !== '')
  const totalChars = fullText.length

  // meeting_transcriptsレコードを作成
  const { data: transcriptRecord, error: insertError } = await supabase
    .from('meeting_transcripts')
    .insert({
      tldv_meeting_id: meetingId,
      title: meeting.name ?? null,
      meeting_date: meeting.happenedAt ? new Date(meeting.happenedAt).toISOString() : null,
      duration_minutes: meeting.duration ? Math.floor(meeting.duration / 60) : null,
      raw_transcript: segments,
      full_text: fullText,
      word_count: totalChars,
      speaker_count: speakers.length,
      status: 'ready'
    })
    .select('id')
    .single()

  if (insertError || !transcriptRecord) {
    console.error(`Error creating transcript for ${meetingId}:`, insertError)
    return null
  }

  const transcriptId = transcriptRecord.id

  // 参加者レコードを作成（多段階スピーカー紐付け）
  const invitees = meeting.invitees ?? []
  const organizerEmail = meeting.organizer?.email ?? null
  for (const speaker of speakers) {
    const { userId, email } = await linkSpeakerToUser(speaker, invitees, organizerEmail)

    // 発言量を計算
    const speakerSegments = segments.filter((s: any) => s.speaker === speaker)
    const speakerWordCount = speakerSegments
      .reduce((sum: number, s: any) => sum + (s.text ?? '').length, 0)
    const speakerDuration = speakerSegments
      .reduce((sum: number, s: any) => {
        const start = s.startTime ?? 0
        const end = s.endTime ?? start
        return sum + (end - start)
      }, 0)

    const participantData = {
      transcript_id: transcriptId,
      user_id: userId,
      email: email,
      speaker_name: speaker,
      speaking_duration_seconds: Math.floor(speakerDuration),
      speaking_ratio: totalChars > 0 ? speakerWordCount / totalChars : 0,
      word_count: speakerWordCount,
      is_linked: !!userId
    }

    if (email) {
      await supabase
        .from('meeting_participants')
        .upsert(participantData, { onConflict: 'transcript_id,email' })
    } else {
      await supabase
        .from('meeting_participants')
        .insert(participantData)
    }
  }

  console.log(`Processed meeting: ${meeting.name}, ${speakers.length} speakers, ${totalChars} chars`)
  return transcriptId
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type'
      }
    })
  }

  try {
    // 認証チェック: 署名検証済みservice_role JWTのみ許可
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '') ?? ''
    if (!token || !(await verifyServiceRoleJWT(token))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // リクエストごとにユーザーキャッシュをリセット
    _userProfilesCache = null

    if (!TLDV_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'TLDV_API_KEY not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 最新ミーティングをページネーションで全件取得（最大100件/回）
    let allMeetings: any[] = []
    let page = 1
    const pageSize = 20
    const maxPages = 5 // 安全弁: 最大100件
    while (page <= maxPages) {
      const meetingsData = await fetchMeetings(page, pageSize)
      const pageResults = meetingsData.results ?? []
      allMeetings = allMeetings.concat(pageResults)
      if (pageResults.length < pageSize || !meetingsData.next) break
      page++
    }
    const meetings = allMeetings

    let processed = 0
    const newTranscriptIds: string[] = []

    for (const meeting of meetings) {
      const transcriptId = await processMeeting(meeting)
      if (transcriptId) {
        processed++
        newTranscriptIds.push(transcriptId)
      }
    }

    // 全ミーティング処理後にまとめてAI分析を呼び出し（レスポンス前に完了を待つ）
    if (newTranscriptIds.length > 0) {
      const analysisResults = await Promise.allSettled(
        newTranscriptIds.map(tid =>
          fetch(`${SUPABASE_URL}/functions/v1/analyze-transcript`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
            },
            body: JSON.stringify({ transcript_id: tid })
          })
        )
      )
      for (let i = 0; i < analysisResults.length; i++) {
        const r = analysisResults[i]
        if (r.status === 'fulfilled') {
          console.log(`Analysis triggered for ${newTranscriptIds[i]}`)
        } else {
          console.warn(`Analysis failed for ${newTranscriptIds[i]}:`, r.reason)
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_checked: meetings.length,
        new_processed: processed,
        transcript_ids: newTranscriptIds
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Poll error:', error)
    return new Response(
      JSON.stringify({ error: String(error?.message ?? error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
