import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { pdfRupees, pdfSafe } from './text.js';

interface HealthOption {
  key: string;
  label: string;
}
interface ConsentClauses {
  safety: string[];
  policies: string[];
  conduct: string[];
  final: string[];
}
export interface ConsentSnapshot {
  healthOptions: HealthOption[];
  clauses: ConsentClauses;
}

export interface SignatureImage {
  bytes: Buffer;
  mime: string;
}

export interface ConsentPdfData {
  title: string;
  /** Consent record id + template version are printed in the footer of every page. */
  consentId: string;
  templateVersion?: number | null;
  status: 'DRAFT' | 'FINALIZED';
  studentName: string;
  studentCode?: string | null;
  mobile: string;
  email?: string | null;
  isMinor?: boolean;
  formDate: string;
  finalizedDate?: string | null;
  batchTiming?: string | null;
  emergencyContactName?: string | null;
  emergencyContactRelation?: string | null;
  emergencyContactPhone?: string | null;
  courseName?: string | null;
  planTitle?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  feeRupees?: number | null;
  paidRupees?: number | null;
  balanceRupees?: number | null;
  healthFlags: Record<string, boolean>;
  healthOther?: string | null;
  snapshot: ConsentSnapshot;
  studentSignature?: SignatureImage | null;
  studentSignedDate?: string | null;
  guardianSignature?: SignatureImage | null;
  guardianSignedDate?: string | null;
}

const TEAL = rgb(0.05, 0.58, 0.53);
const BLACK = rgb(0.1, 0.1, 0.1);
const GREY = rgb(0.45, 0.45, 0.45);
const MARGIN = 48;
const FOOTER_SPACE = 28;
const A4: [number, number] = [595, 842];

/** Generate the consent PDF (draft for printing/paper signature, or the finalized record). */
export async function generateConsentPdf(data: ConsentPdfData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(pdfSafe(font, `Consent form - ${data.studentName}`));
  doc.setCreator('Moksha Wellness Admin Panel');

  let page: PDFPage = doc.addPage(A4);
  const width = page.getWidth();
  let y = page.getHeight() - MARGIN;

  // Every draw goes through the *current* page — a new page replaces it.
  const ensure = (needed: number) => {
    if (y - needed < MARGIN + FOOTER_SPACE) {
      page = doc.addPage(A4);
      y = page.getHeight() - MARGIN;
    }
  };
  const text = (value: string, x: number, size: number, f: PDFFont = font, color = BLACK) => {
    page.drawText(pdfSafe(f, value), { x, y, size, font: f, color });
  };

  const wrap = (value: string, f: PDFFont, size: number, maxW: number): string[] => {
    const words = pdfSafe(f, value).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(test, size) > maxW && line) {
        lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  const paragraph = (value: string, f: PDFFont, size: number, color = BLACK, indent = 0) => {
    for (const line of wrap(value, f, size, width - MARGIN * 2 - indent)) {
      ensure(size + 4);
      page.drawText(line, { x: MARGIN + indent, y, size, font: f, color });
      y -= size + 4;
    }
  };

  const heading = (value: string) => {
    y -= 8;
    ensure(34); // keep a heading together with its first line
    text(value, MARGIN, 12, bold, TEAL);
    y -= 18;
  };

  const field = (label: string, value: string | null | undefined) => {
    ensure(16);
    const lbl = `${label}: `;
    text(lbl, MARGIN, 10, bold);
    text(value || '-', MARGIN + bold.widthOfTextAtSize(lbl, 10), 10);
    y -= 16;
  };

  // ── Title ──
  text('MOKSHA WELLNESS', MARGIN, 18, bold, TEAL);
  y -= 20;
  text('YOGA • PILATES • DANCE', MARGIN, 9);
  y -= 22;
  paragraph(data.title, bold, 12);
  if (data.status === 'DRAFT') {
    paragraph('DRAFT — not yet finalised. Print, sign and return to the studio.', bold, 9, rgb(0.75, 0.3, 0.05));
  }
  y -= 6;

  // ── Student details ──
  field('Student Name', data.studentName + (data.isMinor ? ' (minor)' : ''));
  if (data.studentCode) field('Student ID', data.studentCode);
  field('Mobile', data.mobile);
  if (data.email) field('Email', data.email);
  field('Date', data.formDate);
  field('Batch / Timing', data.batchTiming);
  field(
    'Emergency Contact',
    [
      data.emergencyContactName,
      data.emergencyContactRelation ? `(${data.emergencyContactRelation})` : '',
      data.emergencyContactPhone ?? '',
    ]
      .filter(Boolean)
      .join(' '),
  );

  // ── Fee details for the enrolled course ──
  if (data.courseName || data.feeRupees != null) {
    heading('COURSE & FEE DETAILS');
    field('Course', `${data.courseName ?? '-'}${data.planTitle ? ` - ${data.planTitle}` : ''}`);
    if (data.periodStart && data.periodEnd) field('Period', `${data.periodStart} to ${data.periodEnd}`);
    if (data.feeRupees != null) field('Fee', pdfRupees(data.feeRupees));
    if (data.paidRupees != null) field('Paid', pdfRupees(data.paidRupees));
    if (data.balanceRupees != null) field('Balance', pdfRupees(data.balanceRupees));
  }

  // ── Section 1 — health declaration ──
  heading('1. HEALTH & MEDICAL DECLARATION');
  for (const opt of data.snapshot.healthOptions) {
    ensure(14);
    text(`${data.healthFlags[opt.key] ? '[x]' : '[ ]'} ${opt.label}`, MARGIN, 9.5);
    y -= 14;
  }
  if (data.healthOther) paragraph(`Other: ${data.healthOther}`, font, 9.5);

  // ── Clause sections (wording comes verbatim from the consent template snapshot) ──
  const clauseSection = (title: string, items: string[]) => {
    heading(title);
    for (const item of items) paragraph(`•  ${item}`, font, 9.5, BLACK, 6);
  };
  clauseSection('2. CONSENT, SAFETY & PERSONAL RESPONSIBILITY', data.snapshot.clauses.safety);
  clauseSection('3. STUDIO POLICIES & OPERATIONAL CONSENT', data.snapshot.clauses.policies);
  clauseSection('4. STUDENT CODE OF CONDUCT — I AGREE TO', data.snapshot.clauses.conduct);
  clauseSection('5. FINAL ACKNOWLEDGEMENT & CONSENT', data.snapshot.clauses.final);

  // ── Signatures ──
  const embed = async (sig?: SignatureImage | null): Promise<PDFImage | null> => {
    if (!sig) return null;
    try {
      return sig.mime.includes('png') ? await doc.embedPng(sig.bytes) : await doc.embedJpg(sig.bytes);
    } catch {
      return null; // an unreadable image leaves a blank line to sign on paper
    }
  };

  const signatureRow = async (label: string, sig: SignatureImage | null | undefined, date: string | null | undefined) => {
    const img = await embed(sig);
    ensure(70);
    const lineY = y - 44;
    if (img) {
      const scale = Math.min(170 / img.width, 42 / img.height);
      page.drawImage(img, { x: MARGIN + 4, y: lineY + 2, width: img.width * scale, height: img.height * scale });
    }
    page.drawLine({ start: { x: MARGIN, y: lineY }, end: { x: MARGIN + 220, y: lineY }, thickness: 0.7, color: GREY });
    page.drawLine({ start: { x: MARGIN + 300, y: lineY }, end: { x: MARGIN + 440, y: lineY }, thickness: 0.7, color: GREY });
    if (date) page.drawText(pdfSafe(font, date), { x: MARGIN + 304, y: lineY + 4, size: 10, font, color: BLACK });
    page.drawText(pdfSafe(bold, label), { x: MARGIN, y: lineY - 12, size: 9, font: bold, color: BLACK });
    page.drawText('Date', { x: MARGIN + 300, y: lineY - 12, size: 9, font: bold, color: BLACK });
    y = lineY - 26;
  };

  y -= 8;
  ensure(100);
  text('SIGNATURES', MARGIN, 12, bold, TEAL);
  y -= 8;
  await signatureRow(`Student signature - ${data.studentName}`, data.studentSignature, data.studentSignedDate);
  if (data.isMinor || data.guardianSignature) {
    await signatureRow('Parent / Guardian signature', data.guardianSignature, data.guardianSignedDate);
  }
  await signatureRow('Trainer / Studio representative', null, null);

  // ── Footer on every page: form version, record reference, status, page numbers ──
  const pages = doc.getPages();
  const version = data.templateVersion != null ? `Form version v${data.templateVersion}` : 'Form version -';
  const state =
    data.status === 'FINALIZED' ? `Finalised${data.finalizedDate ? ` ${data.finalizedDate}` : ''}` : 'DRAFT';
  pages.forEach((p, i) => {
    const footer = pdfSafe(font, `${version}  |  Consent ref ${data.consentId.slice(0, 8)}  |  ${state}  |  Page ${i + 1} of ${pages.length}`);
    p.drawText(footer, { x: MARGIN, y: MARGIN - 14, size: 8, font, color: GREY });
  });

  return Buffer.from(await doc.save());
}
