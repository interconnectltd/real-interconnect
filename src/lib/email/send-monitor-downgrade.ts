/**
 * モニター → 無料 ダウングレード通知メール。
 *
 * RESEND_API_KEY 未設定の場合は console.log にフォールバック (dev 用)。
 */

import { Resend } from "resend";

interface SendMonitorDowngradeEmailInput {
  email: string;
  name: string;
}

interface SendResult {
  sent: boolean;
  fallback: boolean;
  error?: string;
}

export async function sendMonitorDowngradeEmail(
  input: SendMonitorDowngradeEmailInput,
): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "noreply@inter-connect.app";

  if (!apiKey) {
    // dev fallback: 送信せず log に出す
    console.warn(
      "[send-monitor-downgrade] RESEND_API_KEY unset; falling back to console.log",
    );
    console.info("[send-monitor-downgrade] would send:", {
      from,
      to: input.email,
      name: input.name,
    });
    return { sent: false, fallback: true };
  }

  const html = renderHtml(input.name);
  const text = renderText(input.name);

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: input.email,
      subject: "【INTER CONNECT】会員ステータス変更のお知らせ",
      html,
      text,
    });
    if (error) {
      console.error("[send-monitor-downgrade] resend error:", error);
      return { sent: false, fallback: false, error: String(error) };
    }
    return { sent: true, fallback: false };
  } catch (e) {
    console.error("[send-monitor-downgrade] exception:", e);
    return { sent: false, fallback: false, error: String(e) };
  }
}

function renderHtml(name: string): string {
  return `
    <div style="font-family: -apple-system, 'Hiragino Kaku Gothic ProN', sans-serif; line-height: 1.7; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 24px;">
      <p>${escapeHtml(name)} 様</p>
      <p>
        いつも INTER CONNECT をご利用いただきありがとうございます。
      </p>
      <p>
        このたび、お客様のアカウントの会員区分が
        <strong>モニター会員から無料会員へ変更</strong>されました。
      </p>
      <p>
        モニター期間中にご利用いただいた機能のうち一部は、無料会員ではご利用いただけなくなります。
        引き続きフル機能をご利用になりたい場合は、Settings から有料プランへお申込みいただけます。
      </p>
      <p style="margin-top: 24px;">
        <a href="https://inter-connect.app/settings" style="display: inline-block; padding: 12px 24px; background-color: #2e9e8f; color: #fff; text-decoration: none; border-radius: 8px;">
          Settings を開く
        </a>
      </p>
      <p style="margin-top: 32px; color: #5c5b58; font-size: 13px;">
        ご不明点がございましたら、お気軽にお問い合わせください。
      </p>
      <hr style="border: none; border-top: 1px solid #e8e7e5; margin: 24px 0;">
      <p style="color: #7c7b77; font-size: 12px;">
        INTER CONNECT 運営<br>
        <a href="https://inter-connect.app" style="color: #7c7b77;">https://inter-connect.app</a>
      </p>
    </div>
  `;
}

function renderText(name: string): string {
  return `${name} 様

いつも INTER CONNECT をご利用いただきありがとうございます。

このたび、お客様のアカウントの会員区分がモニター会員から無料会員へ変更されました。

モニター期間中にご利用いただいた機能のうち一部は、無料会員ではご利用いただけなくなります。
引き続きフル機能をご利用になりたい場合は、Settings から有料プランへお申込みいただけます。

Settings: https://inter-connect.app/settings

ご不明点がございましたら、お気軽にお問い合わせください。

INTER CONNECT 運営
https://inter-connect.app
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
