import {createKksTestAuf} from '../../supabase/functions/_shared/kksAuf.js';

export function downloadKksSample() {
  const createdAt = new Date('2026-11-13T10:30:00Z');
  const {orderBytes} = createKksTestAuf({
    clearBytes: new TextEncoder().encode("UNB+UNOC:3+123456789+999000111+20261113:1130+00001+E+SL345678S11++++0'UNZ+000000+00001'"),
    // Synthetic envelope header for checking the record format only.
    securedBytes: Uint8Array.of(48, 11, 6, 9, 42, 134, 72, 134, 247, 13, 1, 7, 3),
    recipientPhysicalIk: '999000222',
    transferNumber: 1,
    createdAt,
    sentAt: createdAt,
  });
  const url = URL.createObjectURL(new Blob([orderBytes], {type: 'application/octet-stream'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'MUSTER-NICHT-SENDEN.AUF';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
