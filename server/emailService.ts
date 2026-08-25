import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { getContactInfo } from './contactStore';
import { getActiveProperty } from './propertiesStore';
import type { ParsedBooking } from './bookingUtils';
import type { PaymentRecord, Tenant, TenantPayment } from '../types';
import { atomicWriteJson } from './persist';
import { resolveSmtpForSending, getSmtpPublicStatus } from './smtpStore';
import { getGmailToken, isGmailTokenReady, getGmailPublicStatus } from './gmailTokenStore';

const DATA_DIR = path.join(process.cwd(), 'data');
const EMAIL_LOG_FILE = path.join(DATA_DIR, 'email-log.json');

export interface BookingReceiptContext {
  booking: ParsedBooking;
  siteLabel: string;
  siteNumber?: number;
  paid: boolean;
  receiptId?: string;
}

export type EmailSendMode = 'smtp' | 'gmail' | 'log';

export interface EmailSendResult {
  ok: boolean;
  mode: EmailSendMode;
  customerSent: boolean;
  parkSent: boolean;
  error?: string;
  logIds?: string[];
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function money(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDateKey(key: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
  const d = new Date(`${key}T12:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const a = new Date(`${checkIn}T12:00:00`);
  const b = new Date(`${checkOut}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b <= a) return 0;
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function isSmtpConfigured(): boolean {
  return resolveSmtpForSending().configured;
}

function getParkNotifyEmail(): string {
  const smtp = resolveSmtpForSending();
  if (smtp.parkNotifyEmail) return smtp.parkNotifyEmail;
  const fromEnv = (process.env.PARK_NOTIFY_EMAIL || process.env.PARK_EMAIL || '').trim();
  if (fromEnv) return fromEnv;
  const contact = getContactInfo();
  if (contact.email?.trim()) return contact.email.trim();
  return 'info@pineflatsrvpark.com';
}

function getFromAddress(): string {
  const smtp = resolveSmtpForSending();
  if (smtp.from) return smtp.from;
  const from = (process.env.SMTP_FROM || '').trim();
  if (from) return from;
  const park = getParkNotifyEmail();
  return `Pine Flats RV Park <${park}>`;
}

let cachedTransporter: Transporter | null = null;
let cachedTransportKey = '';

/** Call after SMTP settings change so the next send uses new credentials. */
export function resetEmailTransport() {
  cachedTransporter = null;
  cachedTransportKey = '';
}

function getTransporter(): Transporter | null {
  const smtp = resolveSmtpForSending();
  if (!smtp.configured) return null;
  const key = `${smtp.host}|${smtp.port}|${smtp.user}|${smtp.pass}|${smtp.secure}`;
  if (cachedTransporter && cachedTransportKey === key) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });
  cachedTransportKey = key;
  return cachedTransporter;
}

function appendEmailLog(entry: Record<string, unknown>) {
  ensureDataDir();
  let list: Record<string, unknown>[] = [];
  if (fs.existsSync(EMAIL_LOG_FILE)) {
    try {
      list = JSON.parse(fs.readFileSync(EMAIL_LOG_FILE, 'utf-8')) as Record<string, unknown>[];
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }
  }
  list.unshift(entry);
  // Keep last 100 for disk safety
  atomicWriteJson(EMAIL_LOG_FILE, list.slice(0, 100));
}

function buildReceiptText(ctx: BookingReceiptContext, forPark: boolean): string {
  const { booking, siteLabel, siteNumber, paid, receiptId } = ctx;
  const park = getContactInfo();
  const property = getActiveProperty();
  const nights = nightsBetween(booking.checkIn, booking.checkOut);
  const lines = [
    'PINE FLATS RV PARK — BOOKING RECEIPT',
    '====================================',
    '',
    receiptId ? `Receipt #: ${receiptId}` : null,
    `Property: ${property?.name ?? 'Pine Flats RV Park'}`,
    `Date: ${new Date().toLocaleString('en-US')}`,
    '',
    'GUEST',
    `  Name: ${booking.name}`,
    `  Email: ${booking.contactEmail || booking.email}`,
    `  Phone: ${booking.contactPhone || '—'}`,
    booking.contactRvType ? `  RV / vehicle: ${booking.contactRvType}` : null,
    booking.contactLicensePlate ? `  License plate: ${booking.contactLicensePlate}` : null,
    '',
    'STAY',
    `  Site: ${siteLabel}${siteNumber != null ? ` (#${siteNumber})` : ''}`,
    `  Rental type: ${booking.rentalType}`,
    `  Check-in: ${formatDateKey(booking.checkIn)}`,
    `  Check-out: ${formatDateKey(booking.checkOut)}`,
    nights > 0 ? `  Nights: ${nights}` : null,
    '',
    'PAYMENT',
    `  Status: ${paid ? 'Paid' : 'Payment pending'}`,
    paid ? `  Method: ${booking.paymentMethod}` : null,
    `  Total: ${money(booking.total)}`,
    '',
    forPark && booking.contactNotes ? `Guest notes: ${booking.contactNotes}` : null,
    forPark && booking.contactEmergency ? `Emergency contact: ${booking.contactEmergency}` : null,
    '',
    '—',
    park.contactName || 'Pine Flats Office',
    park.phone ? `Phone: ${park.phone}` : null,
    park.email ? `Email: ${park.email}` : null,
    park.address || null,
    park.tagline || null,
  ];
  return lines.filter(line => line != null).join('\n');
}

function buildReceiptHtml(ctx: BookingReceiptContext, forPark: boolean): string {
  const { booking, siteLabel, siteNumber, paid, receiptId } = ctx;
  const park = getContactInfo();
  const property = getActiveProperty();
  const nights = nightsBetween(booking.checkIn, booking.checkOut);
  const guestEmail = booking.contactEmail || booking.email;

  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:6px 0;color:#5A6355;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;width:38%;">${label}</td>
      <td style="padding:6px 0;color:#3D3730;font-size:14px;">${value}</td>
    </tr>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><title>Booking Receipt</title></head>
<body style="margin:0;padding:0;background:#F7F3F0;font-family:Georgia,serif;color:#3D3730;">
  <div style="max-width:560px;margin:24px auto;background:#ffffff;border:1px solid #E2D9D0;border-radius:16px;overflow:hidden;">
    <div style="background:#5A6355;color:#fff;padding:20px 24px;">
      <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.85;">Pine Flats RV Park</div>
      <div style="font-size:22px;margin-top:4px;">Booking Receipt</div>
      ${receiptId ? `<div style="font-size:12px;margin-top:8px;opacity:0.9;">Receipt # ${receiptId}</div>` : ''}
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px;font-size:14px;color:#5A6355;">
        ${forPark
          ? `New online booking for <strong style="color:#3D3730;">${escapeHtml(property?.name ?? 'Pine Flats')}</strong>.`
          : `Thank you for booking with us${booking.name ? `, ${escapeHtml(booking.name)}` : ''}! Here is your receipt.`}
      </p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        ${row('Property', escapeHtml(property?.name ?? 'Pine Flats RV Park'))}
        ${row('Site', escapeHtml(`${siteLabel}${siteNumber != null ? ` (#${siteNumber})` : ''}`))}
        ${row('Rental type', escapeHtml(booking.rentalType))}
        ${row('Check-in', escapeHtml(formatDateKey(booking.checkIn)))}
        ${row('Check-out', escapeHtml(formatDateKey(booking.checkOut)))}
        ${nights > 0 ? row('Nights', String(nights)) : ''}
        ${row('Guest', escapeHtml(booking.name))}
        ${row('Email', escapeHtml(guestEmail))}
        ${row('Phone', escapeHtml(booking.contactPhone || '—'))}
        ${booking.contactRvType ? row('RV / vehicle', escapeHtml(booking.contactRvType)) : ''}
        ${booking.contactLicensePlate ? row('License plate', escapeHtml(booking.contactLicensePlate)) : ''}
        ${row('Payment', paid ? `Paid · ${escapeHtml(booking.paymentMethod)}` : 'Payment pending')}
      </table>
      <div style="background:#FBF9F7;border:1px solid #E2D9D0;border-radius:12px;padding:16px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:13px;color:#5A6355;text-transform:uppercase;letter-spacing:0.08em;">Total</span>
        <span style="font-size:24px;color:#C29474;">${money(booking.total)}</span>
      </div>
      ${forPark && booking.contactNotes
        ? `<p style="margin:16px 0 0;font-size:13px;color:#5A6355;"><strong>Guest notes:</strong> ${escapeHtml(booking.contactNotes)}</p>`
        : ''}
      ${forPark && booking.contactEmergency
        ? `<p style="margin:8px 0 0;font-size:13px;color:#5A6355;"><strong>Emergency:</strong> ${escapeHtml(booking.contactEmergency)}</p>`
        : ''}
      <p style="margin:20px 0 0;font-size:12px;color:#5A6355;line-height:1.5;">
        ${escapeHtml(park.contactName || 'Pine Flats Office')}<br/>
        ${park.phone ? escapeHtml(park.phone) + '<br/>' : ''}
        ${park.email ? escapeHtml(park.email) + '<br/>' : ''}
        ${park.address ? escapeHtml(park.address) + '<br/>' : ''}
        ${park.tagline ? `<em>${escapeHtml(park.tagline)}</em>` : ''}
      </p>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function makeReceiptId(ctx: BookingReceiptContext): string {
  const site = String(ctx.siteNumber ?? ctx.booking.slotId).padStart(2, '0');
  const stamp = Date.now().toString().slice(-8);
  return `PF-BK-${site}-${stamp}`;
}

function encodeSubject(subject: string): string {
  // RFC 2047 for non-ascii subjects
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

function buildGmailRawMessage(opts: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}): string {
  const boundary = `pineflats_${Date.now().toString(36)}`;
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${encodeSubject(opts.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    opts.text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    opts.html,
    '',
    `--${boundary}--`,
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function sendViaGmailApi(
  to: string,
  subject: string,
  text: string,
  html: string
): Promise<{ ok: boolean; error?: string; gmailId?: string }> {
  if (!isGmailTokenReady()) {
    return { ok: false, error: 'Google Gmail not connected or token expired — sign in again on Media' };
  }
  const token = getGmailToken()!;
  const fromEmail = token.email;
  const from = `Pine Flats RV Park <${fromEmail}>`;
  const raw = buildGmailRawMessage({ from, to, subject, text, html });

  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      error?: { message?: string; code?: number };
    };
    if (!res.ok) {
      const msg =
        data.error?.message ||
        (res.status === 401
          ? 'Google session expired — sign in with Google again on Media'
          : `Gmail API error ${res.status}`);
      return { ok: false, error: msg };
    }
    return { ok: true, gmailId: data.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Gmail send failed' };
  }
}

async function deliver(
  to: string,
  subject: string,
  text: string,
  html: string,
  meta: Record<string, unknown>
): Promise<{ ok: boolean; mode: EmailSendMode; id: string; error?: string }> {
  const id = `em_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const transporter = getTransporter();

  if (transporter) {
    try {
      await transporter.sendMail({
        from: getFromAddress(),
        to,
        subject,
        text,
        html,
      });
      appendEmailLog({
        id,
        at: new Date().toISOString(),
        mode: 'smtp',
        to,
        subject,
        ok: true,
        ...meta,
      });
      return { ok: true, mode: 'smtp', id };
    } catch (err) {
      const smtpError = err instanceof Error ? err.message : 'SMTP send failed';
      console.warn(`[email] SMTP failed (${smtpError}); trying Gmail if connected…`);
      // Fall through to Gmail when Hotmail/Outlook blocks basic auth
      if (isGmailTokenReady()) {
        const gmail = await sendViaGmailApi(to, subject, text, html);
        if (gmail.ok) {
          appendEmailLog({
            id,
            at: new Date().toISOString(),
            mode: 'gmail',
            to,
            subject,
            ok: true,
            gmailId: gmail.gmailId,
            smtpFallback: smtpError,
            ...meta,
          });
          return { ok: true, mode: 'gmail', id };
        }
        appendEmailLog({
          id,
          at: new Date().toISOString(),
          mode: 'gmail',
          to,
          subject,
          ok: false,
          error: gmail.error,
          smtpError,
          ...meta,
        });
        return { ok: false, mode: 'gmail', id, error: gmail.error || smtpError };
      }
      appendEmailLog({
        id,
        at: new Date().toISOString(),
        mode: 'smtp',
        to,
        subject,
        ok: false,
        error: smtpError,
        ...meta,
      });
      return { ok: false, mode: 'smtp', id, error: smtpError };
    }
  }

  // No SMTP — prefer Gmail OAuth when the admin has signed in
  if (isGmailTokenReady()) {
    const gmail = await sendViaGmailApi(to, subject, text, html);
    if (gmail.ok) {
      appendEmailLog({
        id,
        at: new Date().toISOString(),
        mode: 'gmail',
        to,
        subject,
        ok: true,
        gmailId: gmail.gmailId,
        ...meta,
      });
      return { ok: true, mode: 'gmail', id };
    }
    appendEmailLog({
      id,
      at: new Date().toISOString(),
      mode: 'gmail',
      to,
      subject,
      text,
      html,
      ok: false,
      error: gmail.error,
      ...meta,
    });
    return { ok: false, mode: 'gmail', id, error: gmail.error };
  }

  // Nothing configured: log only
  appendEmailLog({
    id,
    at: new Date().toISOString(),
    mode: 'log',
    to,
    subject,
    text,
    html,
    ok: true,
    note:
      'Email not sent — connect Google on Media (Gmail) or configure SMTP. Receipt logged only.',
    ...meta,
  });
  console.log(`[email:log] Receipt for ${to}: ${subject}`);
  return { ok: true, mode: 'log', id };
}

/**
 * Send admin password recovery code to the backup email.
 */
export async function sendAdminRecoveryEmail(opts: {
  to: string;
  code: string;
  expiresAt: number;
}): Promise<{ ok: boolean; mode: EmailSendMode; error?: string }> {
  const expiresLocal = new Date(opts.expiresAt).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const subject = 'Pine Flats admin password recovery code';
  const text = [
    'You requested a password reset for the Pine Flats admin page.',
    '',
    `Your recovery code: ${opts.code}`,
    `Expires: ${expiresLocal}`,
    '',
    'On the admin login page, choose Forgot password, enter this code, and set a new password.',
    'If you did not request this, ignore this email.',
  ].join('\n');
  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#3D3730">
      <p>You requested a password reset for the <strong>Pine Flats admin page</strong>.</p>
      <p style="font-size:28px;letter-spacing:0.2em;font-weight:700;margin:24px 0">${escapeHtml(opts.code)}</p>
      <p>Expires: ${escapeHtml(expiresLocal)}</p>
      <p>On the admin login page, choose <strong>Forgot password</strong>, enter this code, and set a new password.</p>
      <p style="color:#5A6355;font-size:13px">If you did not request this, ignore this email.</p>
    </div>
  `;
  const result = await deliver(opts.to, subject, text, html, {
    kind: 'admin_recovery',
  });
  return { ok: result.ok, mode: result.mode, error: result.error };
}

/**
 * Email booking receipt to the customer and to Pine Flats.
 * Never throws — booking flow should continue even if mail fails.
 */
export async function sendBookingReceiptEmails(
  ctx: Omit<BookingReceiptContext, 'receiptId'> & { receiptId?: string }
): Promise<EmailSendResult> {
  const receiptId = ctx.receiptId || makeReceiptId(ctx);
  const full: BookingReceiptContext = { ...ctx, receiptId };
  const guestEmail = (full.booking.contactEmail || full.booking.email || '').trim().toLowerCase();
  const parkEmail = getParkNotifyEmail().toLowerCase();
  const propertyName = getActiveProperty()?.name ?? 'Pine Flats RV Park';
  const site = full.siteLabel;

  const logIds: string[] = [];
  let customerSent = false;
  let parkSent = false;
  let mode: EmailSendMode = isSmtpConfigured()
    ? 'smtp'
    : isGmailTokenReady()
      ? 'gmail'
      : 'log';
  const errors: string[] = [];

  if (guestEmail) {
    const subject = `Your booking receipt — ${site} · ${propertyName}`;
    const result = await deliver(
      guestEmail,
      subject,
      buildReceiptText(full, false),
      buildReceiptHtml(full, false),
      { kind: 'customer_receipt', receiptId, slotId: full.booking.slotId }
    );
    logIds.push(result.id);
    mode = result.mode;
    customerSent = result.ok;
    if (!result.ok && result.error) errors.push(`customer: ${result.error}`);
  } else {
    errors.push('customer: no email address');
  }

  if (parkEmail && parkEmail === guestEmail) {
    // Guest booked with the park address — one email covers both
    parkSent = customerSent;
  } else if (parkEmail) {
    const subject = `New booking receipt — ${full.booking.name} · ${site}`;
    const result = await deliver(
      parkEmail,
      subject,
      buildReceiptText(full, true),
      buildReceiptHtml(full, true),
      { kind: 'park_receipt', receiptId, slotId: full.booking.slotId }
    );
    logIds.push(result.id);
    mode = result.mode;
    parkSent = result.ok;
    if (!result.ok && result.error) errors.push(`park: ${result.error}`);
  } else {
    errors.push('park: no notify email configured');
  }

  return {
    ok: customerSent || parkSent,
    mode,
    customerSent,
    parkSent,
    error: errors.length ? errors.join('; ') : undefined,
    logIds,
  };
}

export function getEmailConfigStatus() {
  const smtpStatus = getSmtpPublicStatus();
  const gmail = getGmailPublicStatus();
  return {
    smtpConfigured: isSmtpConfigured(),
    gmailReady: gmail.ready,
    gmailEmail: gmail.email,
    canSend: isSmtpConfigured() || gmail.ready,
    parkNotifyEmail: getParkNotifyEmail(),
    from: getFromAddress(),
    smtp: smtpStatus,
    gmail,
  };
}

/**
 * Send a short test message to verify SMTP settings.
 */
export async function sendSmtpTestEmail(to?: string): Promise<{
  ok: boolean;
  mode: EmailSendMode;
  to: string;
  error?: string;
}> {
  const dest = (to || getParkNotifyEmail() || '').trim();
  if (!dest) {
    return {
      ok: false,
      mode: isSmtpConfigured() ? 'smtp' : isGmailTokenReady() ? 'gmail' : 'log',
      to: '',
      error: 'No test recipient email',
    };
  }
  const subject = 'Pine Flats email test';
  const text = [
    'This is a test email from Pine Flats RV Park.',
    'If you received this, email is working and receipt emails can be sent.',
    `Sent at: ${new Date().toLocaleString('en-US')}`,
  ].join('\n');
  const html = `<p>This is a test email from <strong>Pine Flats RV Park</strong>.</p>
    <p>If you received this, email is working and receipt emails can be sent.</p>
    <p style="color:#5A6355;font-size:12px">Sent at ${escapeHtml(new Date().toLocaleString('en-US'))}</p>`;
  const result = await deliver(dest, subject, text, html, { kind: 'smtp_test' });
  return {
    ok: result.ok,
    mode: result.mode,
    to: dest,
    error: result.error,
  };
}

/** Payment receipt for long-term / admin-recorded tenant payments */
export interface TenantPaymentReceiptContext {
  tenant: Tenant;
  payment: TenantPayment;
  record: PaymentRecord;
}

function makeTenantReceiptId(tenant: Tenant, record: PaymentRecord): string {
  const site = String(tenant.site || '0').padStart(2, '0');
  const shortId = record.id.replace(/\D/g, '').slice(-6) || record.id.slice(-6);
  return `PF-${site}-${shortId}`;
}

function buildTenantPaymentText(
  ctx: TenantPaymentReceiptContext,
  receiptId: string,
  forPark: boolean
): string {
  const { tenant, record } = ctx;
  const park = getContactInfo();
  const businessName = park.businessName || 'Pine Flats RV Park';
  const lines = [
    `${businessName.toUpperCase()} — PAYMENT RECEIPT`,
    '====================================',
    '',
    `Receipt #: ${receiptId}`,
    `Date issued: ${new Date().toLocaleString('en-US')}`,
    '',
    'CUSTOMER',
    `  Name: ${tenant.name}`,
    `  Space: ${tenant.site}`,
    `  Phone: ${tenant.phone || '—'}`,
    `  Email: ${tenant.email || '—'}`,
    tenant.address ? `  Address: ${tenant.address}` : null,
    '',
    'PAYMENT',
    `  Amount paid: ${money(record.amount)}`,
    `  Method: ${record.method || '—'}`,
    `  Payment date: ${formatDateKey(record.date)}`,
    record.note ? `  Note: ${record.note}` : null,
    `  Balance due after payment: ${money(ctx.payment.balanceDue ?? 0)}`,
    '',
    forPark ? 'Copy for park records.' : 'Thank you for your payment. Please keep this receipt for your records.',
    '',
    '—',
    park.contactName || 'Pine Flats Office',
    park.phone ? `Phone: ${park.phone}` : null,
    park.email ? `Email: ${park.email}` : null,
    park.address || null,
    park.tagline || null,
  ];
  return lines.filter(line => line != null).join('\n');
}

function buildTenantPaymentHtml(
  ctx: TenantPaymentReceiptContext,
  receiptId: string,
  forPark: boolean
): string {
  const { tenant, record, payment } = ctx;
  const park = getContactInfo();
  const businessName = park.businessName || 'Pine Flats RV Park';

  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:6px 0;color:#5A6355;font-size:12px;text-transform:uppercase;letter-spacing:0.06em;width:38%;">${label}</td>
      <td style="padding:6px 0;color:#3D3730;font-size:14px;">${value}</td>
    </tr>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><title>Payment Receipt</title></head>
<body style="margin:0;padding:0;background:#F7F3F0;font-family:Georgia,serif;color:#3D3730;">
  <div style="max-width:560px;margin:24px auto;background:#ffffff;border:1px solid #E2D9D0;border-radius:16px;overflow:hidden;">
    <div style="background:#5A6355;color:#fff;padding:20px 24px;">
      <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.85;">${escapeHtml(businessName)}</div>
      <div style="font-size:22px;margin-top:4px;">Payment Receipt</div>
      <div style="font-size:12px;margin-top:8px;opacity:0.9;">Receipt # ${escapeHtml(receiptId)}</div>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px;font-size:14px;color:#5A6355;">
        ${forPark
          ? `Payment recorded for <strong style="color:#3D3730;">${escapeHtml(tenant.name)}</strong> (Space ${escapeHtml(String(tenant.site))}).`
          : `Thank you for your payment${tenant.name ? `, ${escapeHtml(tenant.name)}` : ''}! Here is your receipt.`}
      </p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        ${row('Customer', escapeHtml(tenant.name))}
        ${row('Space', escapeHtml(String(tenant.site)))}
        ${tenant.phone ? row('Phone', escapeHtml(tenant.phone)) : ''}
        ${tenant.email ? row('Email', escapeHtml(tenant.email)) : ''}
        ${row('Payment date', escapeHtml(formatDateKey(record.date)))}
        ${row('Method', escapeHtml(record.method || '—'))}
        ${record.note ? row('Note', escapeHtml(record.note)) : ''}
      </table>
      <div style="background:#FBF9F7;border:1px solid #E2D9D0;border-radius:12px;padding:16px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:13px;color:#5A6355;text-transform:uppercase;letter-spacing:0.08em;">Amount paid</span>
        <span style="font-size:24px;color:#C29474;">${money(record.amount)}</span>
      </div>
      <p style="margin:12px 0 0;font-size:13px;color:#5A6355;">
        Balance due after this payment: <strong style="color:#3D3730;">${money(payment.balanceDue ?? 0)}</strong>
      </p>
      <p style="margin:20px 0 0;font-size:12px;color:#5A6355;line-height:1.5;">
        ${escapeHtml(park.contactName || 'Pine Flats Office')}<br/>
        ${park.phone ? escapeHtml(park.phone) + '<br/>' : ''}
        ${park.email ? escapeHtml(park.email) + '<br/>' : ''}
        ${park.address ? escapeHtml(park.address) + '<br/>' : ''}
        ${park.tagline ? `<em>${escapeHtml(park.tagline)}</em>` : ''}
      </p>
      <p style="margin:16px 0 0;font-size:16px;font-style:italic;text-align:center;color:#3D3730;">Thank you!</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Email payment receipt to the customer (and park) when a tenant payment is recorded.
 * Never throws — payment recording should succeed even if mail fails.
 */
export async function sendTenantPaymentReceiptEmails(
  ctx: TenantPaymentReceiptContext
): Promise<EmailSendResult> {
  const receiptId = makeTenantReceiptId(ctx.tenant, ctx.record);
  const guestEmail = (ctx.tenant.email || '').trim().toLowerCase();
  const parkEmail = getParkNotifyEmail().toLowerCase();
  const businessName = getContactInfo().businessName || 'Pine Flats RV Park';
  const site = `Space ${ctx.tenant.site}`;

  const logIds: string[] = [];
  let customerSent = false;
  let parkSent = false;
  let mode: EmailSendMode = isSmtpConfigured()
    ? 'smtp'
    : isGmailTokenReady()
      ? 'gmail'
      : 'log';
  const errors: string[] = [];

  if (guestEmail) {
    const subject = `Your payment receipt — ${site} · ${businessName}`;
    const result = await deliver(
      guestEmail,
      subject,
      buildTenantPaymentText(ctx, receiptId, false),
      buildTenantPaymentHtml(ctx, receiptId, false),
      {
        kind: 'tenant_payment_receipt',
        receiptId,
        tenantId: ctx.tenant.id,
        paymentRecordId: ctx.record.id,
      }
    );
    logIds.push(result.id);
    mode = result.mode;
    customerSent = result.ok;
    if (!result.ok && result.error) errors.push(`customer: ${result.error}`);
  } else {
    errors.push('customer: no email on tenant record');
  }

  if (parkEmail && parkEmail === guestEmail) {
    parkSent = customerSent;
  } else if (parkEmail) {
    const subject = `Payment received — ${ctx.tenant.name} · ${site} · ${money(ctx.record.amount)}`;
    const result = await deliver(
      parkEmail,
      subject,
      buildTenantPaymentText(ctx, receiptId, true),
      buildTenantPaymentHtml(ctx, receiptId, true),
      {
        kind: 'park_tenant_payment_receipt',
        receiptId,
        tenantId: ctx.tenant.id,
        paymentRecordId: ctx.record.id,
      }
    );
    logIds.push(result.id);
    mode = result.mode;
    parkSent = result.ok;
    if (!result.ok && result.error) errors.push(`park: ${result.error}`);
  } else {
    errors.push('park: no notify email configured');
  }

  return {
    ok: customerSent || parkSent,
    mode,
    customerSent,
    parkSent,
    error: errors.length ? errors.join('; ') : undefined,
    logIds,
  };
}
