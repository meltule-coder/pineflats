import fs from 'fs';
import path from 'path';
import { atomicWriteJson } from './persist';
import { resolveSmsForSending, toE164 } from './smsStore';

const DATA_DIR = path.join(process.cwd(), 'data');
const SMS_LOG_FILE = path.join(DATA_DIR, 'sms-log.json');

export type SmsSendResult = {
  ok: boolean;
  mode: 'twilio' | 'log';
  to?: string;
  sid?: string;
  error?: string;
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function appendSmsLog(entry: Record<string, unknown>) {
  ensureDataDir();
  let list: Record<string, unknown>[] = [];
  if (fs.existsSync(SMS_LOG_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(SMS_LOG_FILE, 'utf-8'));
      list = Array.isArray(raw) ? raw : [];
    } catch {
      list = [];
    }
  }
  list.unshift(entry);
  atomicWriteJson(SMS_LOG_FILE, list.slice(0, 100));
}

/**
 * Send an SMS via Twilio (or log if not configured).
 * Never throws — callers should not fail booking if SMS fails.
 */
export async function sendSms(body: string, toOverride?: string): Promise<SmsSendResult> {
  const sms = resolveSmsForSending();
  const to = toE164(toOverride || sms.alertTo);
  const from = toE164(sms.fromNumber);
  const text = String(body || '').trim().slice(0, 1500);

  if (!text) {
    return { ok: false, mode: sms.configured ? 'twilio' : 'log', error: 'Empty SMS body' };
  }

  if (!sms.configured || !sms.enabled) {
    const id = `sms_log_${Date.now()}`;
    appendSmsLog({
      id,
      at: new Date().toISOString(),
      mode: 'log',
      to: to || sms.alertTo,
      body: text,
      ok: true,
      note: 'SMS not configured — message logged only. Set Twilio in Settings → SMS alerts.',
    });
    console.log(`[sms:log] To ${to || sms.alertTo || '(none)'}: ${text}`);
    return {
      ok: true,
      mode: 'log',
      to: to || sms.alertTo,
      error: 'SMS not configured (logged only)',
    };
  }

  if (!to || !from) {
    return {
      ok: false,
      mode: 'twilio',
      error: 'Invalid To or From phone number (use +1… format)',
    };
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sms.accountSid)}/Messages.json`;
    const auth = Buffer.from(`${sms.accountSid}:${sms.authToken}`).toString('base64');
    const params = new URLSearchParams({
      To: to,
      From: from,
      Body: text,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = (await res.json().catch(() => ({}))) as {
      sid?: string;
      message?: string;
      error_message?: string;
      code?: number;
    };

    if (!res.ok) {
      const error =
        data.error_message || data.message || `Twilio error ${res.status}`;
      appendSmsLog({
        id: `sms_err_${Date.now()}`,
        at: new Date().toISOString(),
        mode: 'twilio',
        to,
        body: text,
        ok: false,
        error,
        code: data.code,
      });
      return { ok: false, mode: 'twilio', to, error };
    }

    appendSmsLog({
      id: data.sid || `sms_${Date.now()}`,
      at: new Date().toISOString(),
      mode: 'twilio',
      to,
      body: text,
      ok: true,
      sid: data.sid,
    });
    return { ok: true, mode: 'twilio', to, sid: data.sid };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'SMS send failed';
    appendSmsLog({
      id: `sms_err_${Date.now()}`,
      at: new Date().toISOString(),
      mode: 'twilio',
      to,
      body: text,
      ok: false,
      error,
    });
    return { ok: false, mode: 'twilio', to, error };
  }
}

export type BookingSmsContext = {
  guestName: string;
  siteLabel: string;
  checkIn: string;
  checkOut: string;
  total?: number;
  paymentMethod?: string;
  channel?: string;
};

function money(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(n);
}

/** Short alert for online (or phone) bookings. */
export async function sendBookingSmsAlert(ctx: BookingSmsContext): Promise<SmsSendResult> {
  const total =
    ctx.total != null && Number.isFinite(ctx.total) ? money(ctx.total) : '';
  const lines = [
    'Pine Flats: new online booking',
    ctx.guestName ? `Guest: ${ctx.guestName}` : null,
    ctx.siteLabel ? `Site: ${ctx.siteLabel}` : null,
    ctx.checkIn && ctx.checkOut ? `${ctx.checkIn} → ${ctx.checkOut}` : null,
    total ? `Total: ${total}` : null,
    ctx.paymentMethod ? `Paid: ${ctx.paymentMethod}` : null,
  ].filter(Boolean);
  return sendSms(lines.join('\n'));
}

export async function sendSmsTest(to?: string): Promise<SmsSendResult> {
  return sendSms(
    `Pine Flats SMS test OK at ${new Date().toLocaleString('en-US')}. Booking alerts will use this number.`,
    to
  );
}
