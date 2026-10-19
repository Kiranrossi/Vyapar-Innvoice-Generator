import { whatsappNumber } from '@shared/calc.js';
import { saveBlob } from './pdf/InvoicePDF.jsx';

const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// On a phone the system share sheet sends the PDF itself to WhatsApp.
// On a computer WhatsApp links can't carry a file, so the PDF is downloaded
// and WhatsApp opens with the customer's chat and the message ready;
// the user drags the downloaded PDF into the chat.
// Returns 'shared' | 'opened' | 'cancelled'.
export async function shareOnWhatsApp({ blob, fileName, phone, text }) {
  const file = new File([blob], fileName, { type: 'application/pdf' });
  if (isPhone() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
    }
  }
  saveBlob(blob, fileName);
  const number = whatsappNumber(phone);
  const url = `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener');
  return 'opened';
}
