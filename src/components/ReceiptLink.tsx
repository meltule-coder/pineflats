import { FileText } from 'lucide-react';

interface ReceiptLinkProps {
  spaceNumber: string;
  variant?: 'button' | 'inline';
  /** Open in-app tenant receipt page (preferred when tenant is known) */
  onViewReceipt?: () => void;
}

/** In-app receipt only — no external Google Doc links. */
export function ReceiptLink({ variant = 'button', onViewReceipt }: ReceiptLinkProps) {
  if (!onViewReceipt) return null;

  if (variant === 'inline') {
    return (
      <button
        type="button"
        onClick={onViewReceipt}
        className="inline-flex items-center gap-1.5 text-xs text-[#5A6355] hover:text-[#3D3730] transition"
      >
        <FileText className="w-3.5 h-3.5" />
        View Receipt
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onViewReceipt}
      className="flex items-center gap-2 bg-white border border-[#E2D9D0] text-[#5A6355] px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#FBF9F7] transition"
    >
      <FileText className="w-4 h-4" />
      View Receipt
    </button>
  );
}
