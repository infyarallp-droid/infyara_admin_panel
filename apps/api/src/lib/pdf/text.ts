import type { PDFFont } from 'pdf-lib';

// pdf-lib's built-in fonts (Helvetica etc.) can only encode WinAnsi characters.
// Drawing anything else — notably the rupee sign "₹" — throws
// `WinAnsi cannot encode "₹"`, which is what turned consent finalisation into
// an Internal Server Error. Every dynamic string goes through pdfSafe() first.

const charsets = new WeakMap<PDFFont, Set<number>>();

// Keyed by code point so no invisible characters live in this source file.
const REPLACEMENTS = new Map<number, string>([
  [0x20b9, 'Rs. '], // rupee sign
  [0x2011, '-'], // non-breaking hyphen
  [0x2212, '-'], // minus sign
  [0x00a0, ' '], // non-breaking space
  [0x200b, ''], // zero-width space
]);

/** Make any text drawable with a standard PDF font: map known symbols, strip accents, replace the rest with "?". */
export function pdfSafe(font: PDFFont, text: string | null | undefined): string {
  if (!text) return '';
  let set = charsets.get(font);
  if (!set) {
    set = new Set(font.getCharacterSet());
    charsets.set(font, set);
  }
  let out = '';
  for (const ch of text.replace(/[\r\n\t]+/g, ' ')) {
    const code = ch.codePointAt(0)!;
    const mapped = REPLACEMENTS.get(code);
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    if (set.has(code)) {
      out += ch;
      continue;
    }
    // Try the unaccented base letter(s) before giving up on the character.
    const base = [...ch.normalize('NFKD')].filter((c) => set!.has(c.codePointAt(0)!)).join('');
    out += base || '?';
  }
  return out;
}

/** Rupee amount for PDFs, e.g. "Rs. 2,300.00". */
export const pdfRupees = (n: number) =>
  `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
