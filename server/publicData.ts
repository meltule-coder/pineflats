import { Slot } from '../types';
import { maintainSlots, TOTAL_SLOTS } from './slotsStore';
import { getPublishedPhotos } from './photosStore';
import { getContactInfo } from './contactStore';

/** Public site listing — no names, phones, emails, notes, or stay details. */
export interface PublicSiteListing {
  id: string;
  number: number;
  label: string;
  status: 'available';
  imageUrl?: string;
}

/**
 * Strip all guest/tenant/customer PII from a slot.
 * Only safe fields for the public website.
 */
export function toPublicAvailableSlot(slot: Slot): PublicSiteListing | null {
  if (slot.status !== 'available') return null;
  return {
    id: slot.id,
    number: slot.number,
    label: slot.label,
    status: 'available',
    imageUrl: slot.imageUrl,
  };
}

/** Availability payload for the public website (no private contact data). */
export function getPublicAvailability() {
  const slots = maintainSlots();
  const publicSlots = slots
    .map(toPublicAvailableSlot)
    .filter((s): s is PublicSiteListing => s !== null)
    .sort((a, b) => a.number - b.number);

  return {
    total: TOTAL_SLOTS,
    available: publicSlots.length,
    slots: publicSlots,
  };
}

export function getPublicSiteBundle() {
  return {
    availability: getPublicAvailability(),
    photos: getPublishedPhotos(),
    contact: getContactInfo(),
  };
}
