/**
 * Download a generated receipt as a compact one-page PDF (letter size).
 */

import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

function safeFilename(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 120) || 'Pine-Flats-Receipt'
  );
}

export type DownloadReceiptOptions = {
  /** Suggested file name without extension */
  filename?: string;
  /** Element id of the receipt root (default tenant-receipt) */
  rootId?: string;
};

/**
 * Capture the on-screen receipt and download as a letter-size PDF,
 * scaled to fit one page.
 */
export async function downloadReceiptPdf(
  options: DownloadReceiptOptions = {}
): Promise<{ ok: true; filename: string } | { ok: false; error: string }> {
  const rootId = options.rootId || 'tenant-receipt';
  const root = document.getElementById(rootId);
  if (!root) {
    return {
      ok: false,
      error: 'Receipt not found on the page. Generate the receipt first.',
    };
  }

  // Temporarily expand off-screen-friendly styles for capture
  const prev = {
    maxWidth: root.style.maxWidth,
    width: root.style.width,
    boxShadow: root.style.boxShadow,
    border: root.style.border,
  };
  root.style.maxWidth = '7.5in';
  root.style.width = '7.5in';
  root.style.boxShadow = 'none';
  root.style.border = 'none';

  try {
    // Wait for images (logo) so PDF is complete
    const imgs = Array.from(root.querySelectorAll('img'));
    await Promise.all(
      imgs.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) {
              resolve();
              return;
            }
            img.onload = () => resolve();
            img.onerror = () => resolve();
            // timeout so we never hang
            setTimeout(() => resolve(), 2500);
          })
      )
    );

    const canvas = await html2canvas(root, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      scrollX: 0,
      scrollY: 0,
    });

    const imgData = canvas.toDataURL('image/png', 1.0);
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'in',
      format: 'letter',
      compress: true,
    });

    const pageWidth = 8.5;
    const pageHeight = 11;
    const margin = 0.4;
    const maxW = pageWidth - margin * 2;
    const maxH = pageHeight - margin * 2;

    // Fit entire receipt on one page
    let w = maxW;
    let h = (canvas.height / canvas.width) * w;
    if (h > maxH) {
      h = maxH;
      w = (canvas.width / canvas.height) * h;
    }
    const x = (pageWidth - w) / 2;
    const y = margin;

    pdf.addImage(imgData, 'PNG', x, y, w, h, undefined, 'FAST');

    const base = options.filename || 'Pine-Flats-Receipt';
    const filename = `${safeFilename(base)}.pdf`;
    pdf.save(filename);

    return { ok: true, filename };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Could not create PDF receipt',
    };
  } finally {
    root.style.maxWidth = prev.maxWidth;
    root.style.width = prev.width;
    root.style.boxShadow = prev.boxShadow;
    root.style.border = prev.border;
  }
}

/** @deprecated use downloadReceiptPdf — kept for any old imports */
export const downloadReceiptHtml = downloadReceiptPdf;
