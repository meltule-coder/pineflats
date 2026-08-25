import { Slot } from '../types';

/** YYYY-MM-DD local date key. */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Normalize stay date strings to YYYY-MM-DD for safe string compares.
 * Accepts ISO, US M/D/YY, M/D/YYYY, MM-DD-YYYY, and "ongoing".
 * Returns null if empty/invalid (caller decides open-ended fallback).
 */
export function normalizeStayDateKey(raw?: string | null): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower === 'ongoing' || lower === 'open' || lower === 'indefinite') {
    return '9999-12-31';
  }

  // Already ISO YYYY-MM-DD (or longer ISO timestamp)
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (y >= 1970 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // US: M/D/YY, M/D/YYYY, M-D-YY, etc.
  const us = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (us) {
    let y = Number(us[3]);
    const m = Number(us[1]);
    const d = Number(us[2]);
    if (y < 100) y += y >= 70 ? 1900 : 2000; // 26 → 2026, 99 → 1999
    if (y >= 1970 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // Last resort: Date.parse (avoid for pure numbers)
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const dt = new Date(t);
    if (!Number.isNaN(dt.getTime())) return toDateKey(dt);
  }
  return null;
}

/**
 * Stay ranges use exclusive check-out (same as lodging nights).
 * Overlap if [aStart, aEnd) intersects [bStart, bEnd).
 * Inputs should be YYYY-MM-DD (callers normalize first).
 */
export function dateRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  const aS = normalizeStayDateKey(aStart) || aStart;
  const aE = normalizeStayDateKey(aEnd) || aEnd;
  const bS = normalizeStayDateKey(bStart) || bStart;
  const bE = normalizeStayDateKey(bEnd) || bEnd;
  if (!aS || !aE || !bS || !bE) return false;
  if (aE <= aS || bE <= bS) return false;
  return aS < bE && bS < aE;
}

/** True when occupancy has no definite checkout (monthly tenants, open stays). */
export function isOpenEndedOccupancy(slot: Slot): boolean {
  const end = String(slot.endDate || '').trim().toLowerCase();
  if (!end || end === 'ongoing' || end === 'open' || end === 'indefinite') return true;
  const norm = normalizeStayDateKey(slot.endDate);
  return !norm || norm === '9999-12-31';
}

/** Active hold on a slot from reservation / occupancy dates (checkout exclusive). */
export function getSlotHoldRange(slot: Slot): { start: string; end: string } | null {
  const start = normalizeStayDateKey(slot.startDate);
  let end = normalizeStayDateKey(slot.endDate);

  if (slot.status === 'maintenance') {
    return { start: start || '1970-01-01', end: end || '9999-12-31' };
  }

  if (slot.status === 'occupied') {
    // Monthly / open-ended tenants: fully blocked until admin frees the site
    if (isOpenEndedOccupancy(slot)) {
      return { start: start || '1970-01-01', end: '9999-12-31' };
    }
    if (start && end) return { start, end };
    // Occupied but unparseable dates — still block (safer than showing on website)
    return { start: start || '1970-01-01', end: end || '9999-12-31' };
  }

  if (slot.status === 'reserved') {
    if (start && end) return { start, end };
    // Reserved without dates → treat as fully blocked until cleared
    return { start: start || '1970-01-01', end: end || '9999-12-31' };
  }

  return null;
}

/**
 * Whether the public website may offer this site for booking.
 * - Without dates: hide reserved / occupied / maintenance (off the market for the stay).
 * - With dates: hide if the requested stay overlaps the hold.
 * - Occupied open-ended (monthly): never offered online.
 */
export function isSlotOpenForPublic(
  slot: Slot,
  checkIn?: string | null,
  checkOut?: string | null
): boolean {
  if (slot.status === 'maintenance') return false;

  if (slot.status === 'occupied') {
    // Open-ended / monthly tenants must never appear bookable
    if (isOpenEndedOccupancy(slot)) return false;
    const hold = getSlotHoldRange(slot);
    if (!hold) return false;
    const ci = normalizeStayDateKey(checkIn);
    const co = normalizeStayDateKey(checkOut);
    if (ci && co && co > ci) {
      return !dateRangesOverlap(ci, co, hold.start, hold.end);
    }
    // No valid public dates yet → keep occupied sites off the list
    return false;
  }

  if (slot.status === 'reserved') {
    // Reserved holds stay off the public website entirely (prevents overwrite / double-book)
    return false;
  }

  return slot.status === 'available';
}

/** Server-side guard for online / phone booking attempts. */
export function slotConflictForStay(
  slot: Slot,
  checkIn: string,
  checkOut: string,
  options?: { allowSameEmail?: string }
): string | null {
  if (slot.status === 'maintenance') {
    return 'This site is under maintenance';
  }
  if (slot.status === 'available') return null;

  // Occupied: block open-ended/monthly fully; otherwise only overlapping nights
  if (slot.status === 'occupied') {
    if (isOpenEndedOccupancy(slot)) {
      return 'This site is occupied';
    }
    const hold = getSlotHoldRange(slot);
    if (!hold) return 'This site is occupied';
    if (dateRangesOverlap(checkIn, checkOut, hold.start, hold.end)) {
      return 'This site is occupied for those dates';
    }
    return null;
  }

  if (slot.status === 'reserved') {
    const email = options?.allowSameEmail?.trim().toLowerCase();
    const slotEmail = (slot.contactEmail || '').trim().toLowerCase();
    if (email && slotEmail && email === slotEmail) {
      const hold = getSlotHoldRange(slot);
      if (hold && dateRangesOverlap(checkIn, checkOut, hold.start, hold.end)) {
        return null; // same guest refining same stay
      }
      if (hold && !dateRangesOverlap(checkIn, checkOut, hold.start, hold.end)) {
        return 'This site already has another reservation on different dates';
      }
      return null;
    }
    // Any other guest: reserved sites stay off the market so online booking
    // cannot overwrite a hold (avoids double booking the same site).
    const hold = getSlotHoldRange(slot);
    if (hold && dateRangesOverlap(checkIn, checkOut, hold.start, hold.end)) {
      return 'This site is reserved for those dates';
    }
    if (hold) {
      return 'This site is already reserved';
    }
    return 'This site is already reserved';
  }

  return 'This site is no longer available';
}

/** Anonymized blocks for public calendar (no guest names). */
export function listPublicSiteBlocks(slots: Slot[]): Array<{
  slotId: string;
  siteNumber: number;
  start: string;
  end: string;
}> {
  const out: Array<{ slotId: string; siteNumber: number; start: string; end: string }> = [];
  for (const slot of slots) {
    const hold = getSlotHoldRange(slot);
    if (!hold) continue;
    if (hold.end === '9999-12-31' && slot.status === 'occupied') {
      out.push({
        slotId: slot.id,
        siteNumber: slot.number,
        start: hold.start,
        end: hold.end,
      });
      continue;
    }
    // Skip fully expired holds (defensive; maintainSlots should clear these)
    try {
      const today = toDateKey(new Date());
      if (hold.end <= today) continue;
    } catch {
      /* keep */
    }
    out.push({
      slotId: slot.id,
      siteNumber: slot.number,
      start: hold.start,
      end: hold.end,
    });
  }
  return out;
}

/** True if date key falls on a night of the hold [start, end). */
export function dateKeyInHold(dateKey: string, start: string, end: string): boolean {
  return dateKey >= start && dateKey < end;
}
