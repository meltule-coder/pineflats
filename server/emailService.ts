import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { getContactInfo } from './contactStore';
import { getActiveProperty } from './propertiesStore';
import type { ParsedBooking } from './bookingUtils';

const DATA_DIR = path.join(process.cwd(), 'data');
const EMAIL_LOG_FILE = path.join(DATA_DIR, 'email-log.json');

export interface BookingReceiptContext {
  booking: ParsedBooking;
  siteLabel: string;
  siteNumber?: number;
  paid: boolean;
  receiptId?: string;
}

export interface EmailSendResult {
  ok: boolean;
  mode: 'smtp' | 'log';
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
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getParkNotifyEmail(): string {
  const fromEnv = (process.env.PARK_NOTIFY_EMAIL || process.env.PARK_EMAIL || '').trim();
  if (fromEnv) return fromEnv;
  const contact = getContactInfo();
  if (contact.email?.trim()) return contact.email.trim();
  return 'info@pineflatsrv.com';
}

function getFromAddress(): string {
  const from = (process.env.SMTP_FROM || '').trim();
  if (from) return from;
  const park = getParkNotifyEmail();
  return `Pine Flats RV Park <${park}>`;
}

let cachedTransporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!isSmtpConfigured()) return null;
  if (cachedTransporter) return cachedTransporter;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    process.env.SMTP_SECURE === 'true'
    || process.env.SMTP_SECURE === '1'
    || port === 465;
  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
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
  fs.writeFileSync(EMAIL_LOG_FILE, JSON.stringify(list.slice(0, 100), null, 2));
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

async function deliver(
  to: string,
  subject: string,
  text: string,
  html: string,
  meta: Record<string, unknown>
): Promise<{ ok: boolean; mode: 'smtp' | 'log'; id: string; error?: string }> {
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
      const error = err instanceof Error ? err.message : 'SMTP send failed';
      appendEmailLog({
        id,
        at: new Date().toISOString(),
        mode: 'smtp',
        to,
        subject,
        ok: false,
        error,
        ...meta,
      });
      return { ok: false, mode: 'smtp', id, error };
    }
  }

  // No SMTP: still record the receipt email so ops can review / wire SMTP later
  appendEmailLog({
    id,
    at: new Date().toISOString(),
    mode: 'log',
    to,
    subject,
    text,
    html,
    ok: true,
    note: 'SMTP not configured — receipt logged only. Set SMTP_* env vars to send real email.',
    ...meta,
  });
  console.log(`[email:log] Receipt for ${to}: ${subject}`);
  return { ok: true, mode: 'log', id };
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
  let mode: 'smtp' | 'log' = isSmtpConfigured() ? 'smtp' : 'log';
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
  return {
    smtpConfigured: isSmtpConfigured(),
    parkNotifyEmail: getParkNotifyEmail(),
    from: getFromAddress(),
  };
}
