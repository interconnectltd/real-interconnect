/**
 * 認証関連 (forgot/login/resend) のレスポンス時間を定数化する util。
 * Wave1 sec audit (2026-05-07): タイミング side-channel での email enumeration 対策。
 *
 * React Compiler purity rules を回避するため、時刻 / 乱数アクセスは
 * **コンポーネント外** にまとめて隔離する。
 */
export async function enforceMinimumDelay(
  startMs: number,
  targetMs = 800,
  jitterMs = 400,
): Promise<void> {
  const now = Date.now();
  const elapsed = now - startMs;
  const target = targetMs + Math.floor(Math.random() * jitterMs);
  const wait = target - elapsed;
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
}

export function nowMs(): number {
  return Date.now();
}
