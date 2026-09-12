import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

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
interface ConsentSnapshot {
  healthOptions: HealthOption[];
  clauses: ConsentClauses;
}

export interface ConsentPdfData {
  title: string;
  studentName: string;
  mobile: string;
  formDate: string;
  batchTiming?: string | null;
  emergencyContactName?: string | null;
  emergencyContactRelation?: string | null;
  courseName?: string | null;
  planTitle?: string | null;
  feeRupees?: number | null;
  paidRupees?: number | null;
  balanceRupees?: number | null;
  healthFlags: Record<string, boolean>;
  healthOther?: string | null;
  snapshot: ConsentSnapshot;
  studentSignatureUrl?: string | null;
  guardianSignatureUrl?: string | null;
}

const TEAL = rgb(0.05, 0.58, 0.53);
const BLACK = rgb(0.1, 0.1, 0.1);
const MARGIN = 48;

/** Generate the signed-consent PDF as a Buffer. */
export async function generateConsentPdf(data: ConsentPdfData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([595, 842]); // A4
  const width = page.getWidth();
  let y = page.getHeight() - MARGIN;

  const newPageIfNeeded = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([595, 842]);
      y = page.getHeight() - MARGIN;
    }
  };

  const wrap = (text: string, f: PDFFont, size: number, maxW: number): string[] => {
    const words = text.split(/\s+/);
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

  const drawParagraph = (text: string, f: PDFFont, size: number, color = BLACK, indent = 0) => {
    const lines = wrap(text, f, size, width - MARGIN * 2 - indent);
    for (const line of lines) {
      newPageIfNeeded(size + 4);
      page.drawText(line, { x: MARGIN + indent, y, size, font: f, color });
      y -= size + 4;
    }
  };

  const heading = (text: string) => {
    y -= 8;
    newPageIfNeeded(20);
    page.drawText(text, { x: MARGIN, y, size: 12, font: bold, color: TEAL });
    y -= 18;
  };

  // Title
  page.drawText('MOKSHA WELLNESS', { x: MARGIN, y, size: 18, font: bold, color: TEAL });
  y -= 20;
  page.drawText('YOGA • PILATES • DANCE', { x: MARGIN, y, size: 9, font, color: BLACK });
  y -= 22;
  drawParagraph(data.title, bold, 12);
  y -= 6;

  // Header fields
  const field = (label: string, value: string) => {
    newPageIfNeeded(16);
    page.drawText(`${label}: `, { x: MARGIN, y, size: 10, font: bold, color: BLACK });
    page.drawText(value || '—', {
      x: MARGIN + bold.widthOfTextAtSize(`${label}: `, 10),
      y,
      size: 10,
      font,
      color: BLACK,
    });
    y -= 16;
  };
  field('Student Name', data.studentName);
  field('Mobile', data.mobile);
  field('Date', data.formDate);
  field('Batch / Timing', data.batchTiming ?? '—');
  field(
    'Emergency Contact',
    `${data.emergencyContactName ?? '—'}${data.emergencyContactRelation ? ` (${data.emergencyContactRelation})` : ''}`,
  );

  // Fee details for the enrolled course
  if (data.courseName || data.feeRupees != null) {
    heading('COURSE & FEE DETAILS');
    field('Course', `${data.courseName ?? '—'}${data.planTitle ? ` — ${data.planTitle}` : ''}`);
    if (data.feeRupees != null) field('Fee', `₹${data.feeRupees.toLocaleString('en-IN')}`);
    if (data.paidRupees != null) field('Paid', `₹${data.paidRupees.toLocaleString('en-IN')}`);
    if (data.balanceRupees != null) field('Balance', `₹${data.balanceRupees.toLocaleString('en-IN')}`);
  }

  // Section 1 — health declaration
  heading('1. HEALTH & MEDICAL DECLARATION');
  for (const opt of data.snapshot.healthOptions) {
    newPageIfNeeded(14);
    const checked = data.healthFlags[opt.key] ? '[x]' : '[ ]';
    page.drawText(`${checked} ${opt.label}`, { x: MARGIN, y, size: 9.5, font, color: BLACK });
    y -= 14;
  }
  if (data.healthOther) drawParagraph(`Other: ${data.healthOther}`, font, 9.5);

  // Clause sections
  const clauseSection = (title: string, items: string[]) => {
    heading(title);
    for (const item of items) drawParagraph(`•  ${item}`, font, 9.5, BLACK, 6);
  };
  clauseSection('2. CONSENT, SAFETY & PERSONAL RESPONSIBILITY', data.snapshot.clauses.safety);
  clauseSection('3. STUDIO POLICIES & OPERATIONAL CONSENT', data.snapshot.clauses.policies);
  clauseSection('4. STUDENT CODE OF CONDUCT — I AGREE TO', data.snapshot.clauses.conduct);
  clauseSection('5. FINAL ACKNOWLEDGEMENT & CONSENT', data.snapshot.clauses.final);

  // Signatures
  await drawSignatures(doc, page, font, bold, data, () => {
    newPageIfNeeded(120);
    return y;
  }).then((used) => {
    y = used;
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

async function drawSignatures(
  doc: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  data: ConsentPdfData,
  reserve: () => number,
): Promise<number> {
  let y = reserve() - 20;
  page.drawText('Signatures', { x: MARGIN, y, size: 12, font: bold, color: TEAL });
  y -= 20;

  const embedSig = async (url?: string | null) => {
    if (!url || !url.startsWith('data:')) return null;
    try {
      const b64 = url.split(',')[1];
      const buf = Buffer.from(b64, 'base64');
      return url.includes('image/png') ? await doc.embedPng(buf) : await doc.embedJpg(buf);
    } catch {
      return null;
    }
  };

  const studentImg = await embedSig(data.studentSignatureUrl);
  page.drawText('Student Signature:', { x: MARGIN, y, size: 10, font: bold });
  if (studentImg) page.drawImage(studentImg, { x: MARGIN + 120, y: y - 20, width: 120, height: 40 });
  y -= 50;

  if (data.guardianSignatureUrl) {
    const guardianImg = await embedSig(data.guardianSignatureUrl);
    page.drawText('Parent/Guardian Signature:', { x: MARGIN, y, size: 10, font: bold });
    if (guardianImg) page.drawImage(guardianImg, { x: MARGIN + 160, y: y - 20, width: 120, height: 40 });
    y -= 50;
  }
  return y;
}
