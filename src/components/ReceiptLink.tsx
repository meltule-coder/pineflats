import { useEffect, useState } from 'react';
import { FileText, ExternalLink } from 'lucide-react';

interface ReceiptLinkProps {
  spaceNumber: string;
  variant?: 'button' | 'inline';
  /** Open in-app tenant receipt page (preferred when tenant is known) */
  onViewReceipt?: () => void;
}

export function ReceiptLink({ spaceNumber, variant = 'button', onViewReceipt }: ReceiptLinkProps) {
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/receipts/space/${spaceNumber}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => setReceiptUrl(data?.url ?? null))
      .catch(() => setReceiptUrl(null));
  }, [spaceNumber]);

  if (onViewReceipt) {
    if (variant === 'inline') {
      return (
        <span className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={onViewReceipt}
            className="inline-flex items-center gap-1.5 text-xs text-[#5A6355] hover:text-[#3D3730] transition"
          >
            <FileText className="w-3.5 h-3.5" />
            View Receipt
          </button>
          {receiptUrl && (
            <a
              href={receiptUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-[#5A6355] hover:text-[#3D3730]"
              title="Google Doc receipt page"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </span>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onViewReceipt}
          className="flex items-center gap-2 bg-white border border-[#E2D9D0] text-[#5A6355] px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#FBF9F7] transition"
        >
          <FileText className="w-4 h-4" />
          View Receipt
        </button>
        {receiptUrl && (
          <a
            href={receiptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-white border border-[#E2D9D0] text-[#5A6355] px-3 py-2.5 rounded-xl text-xs font-medium hover:bg-[#FBF9F7] transition"
            title={`Google Doc page for space ${spaceNumber}`}
          >
            Doc
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    );
  }

  if (!receiptUrl) return null;

  if (variant === 'inline') {
    return (
      <a
        href={receiptUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-[#5A6355] hover:text-[#3D3730] transition"
      >
        <FileText className="w-3.5 h-3.5" />
        Receipt Page {spaceNumber}
        <ExternalLink className="w-3 h-3" />
      </a>
    );
  }

  return (
    <a
      href={receiptUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 bg-white border border-[#E2D9D0] text-[#5A6355] px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#FBF9F7] transition"
    >
      <FileText className="w-4 h-4" />
      Receipt Page {spaceNumber}
      <ExternalLink className="w-3.5 h-3.5" />
    </a>
  );
}