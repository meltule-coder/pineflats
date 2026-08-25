import { Slot } from '../types';
import { maintainSlots, TOTAL_SLOTS } from './slotsStore';
import { getPublishedPhotos } from './photosStore';
import { getContactInfo } from './contactStore';
import { isSlotOpenForPublic, listPublicSiteBlocks } from './slotAvailability';

/** Public site listing — no names, phones, emails, notes, or stay details. */
export interface PublicSiteListing {
  id: string;
  number: number;
  label: string;
  status: 'available';
  imageUrl?: string;
}

export interface PublicAvailabilityOptions {
  /** Inclusive check-in YYYY-MM-DD */
  checkIn?: string | null;
  /** Exclusive check-out YYYY-MM-DD */
  checkOut?: string | null;
}

/**
 * Strip all guest/tenant/customer PII from a slot.
 * Only safe fields for the public website.
 */
export function toPublicAvailableSlot(
  slot: Slot,
  options?: PublicAvailabilityOptions
): PublicSiteListing | null {
  if (!isSlotOpenForPublic(slot, options?.checkIn, options?.checkOut)) return null;
  return {
    id: slot.id,
    number: slot.number,
    label: slot.label,
    status: 'available',
    imageUrl: slot.imageUrl,
  };
}

/** Availability payload for the public website (no private contact data). */
export function getPublicAvailability(options?: PublicAvailabilityOptions) {
  const slots = maintainSlots();
  const checkIn = options?.checkIn?.slice(0, 10) || null;
  const checkOut = options?.checkOut?.slice(0, 10) || null;
  const range =
    checkIn && checkOut && checkOut > checkIn
      ? { checkIn, checkOut }
      : undefined;

  const publicSlots = slots
    .map(s => toPublicAvailableSlot(s, range))
    .filter((s): s is PublicSiteListing => s !== null)
    .sort((a, b) => a.number - b.number);

  const blocks = listPublicSiteBlocks(slots);

  return {
    total: TOTAL_SLOTS,
    available: publicSlots.length,
    slots: publicSlots,
    /** Anonymized reserved/occupied date ranges — used to grey out calendar nights */
    blocks,
    checkIn: range?.checkIn ?? null,
    checkOut: range?.checkOut ?? null,
  };
}

export function getPublicSiteBundle(options?: PublicAvailabilityOptions) {
  return {
    availability: getPublicAvailability(options),
    photos: getPublishedPhotos(),
    contact: getContactInfo(),
  };
}
