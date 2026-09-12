import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

const TEAL = rgb(0.05, 0.58, 0.53);
const BLACK = rgb(0.1, 0.1, 0.1);
const GREY = rgb(0.5, 0.5, 0.5);
const MARGIN = 48;
const inr = (n: number) => `INR ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface InvoiceItemRow {
  description: string;
  qty: number;
  unitRupees: number;
  lineRupees: number;
}
export interface InvoicePdfData {
  invoiceNo: string;
  date: string;
  studentName: string;
  studentMobile?: string | null;
  items: InvoiceItemRow[];
  subtotalRupees: number;
  discountRupees: number;
  taxRupees: number;
  totalRupees: number;
  paidRupees: number;
  status: string;
}

function header(page: PDFPage, bold: PDFFont, font: PDFFont, title: string, y: number): number {
  page.drawText('MOKSHA WELLNESS', { x: MARGIN, y, size: 18, font: bold, color: TEAL });
  page.drawText('YOGA • PILATES • DANCE', { x: MARGIN, y: y - 16, size: 8, font, color: GREY });
  page.drawText(title, { x: page.getWidth() - MARGIN - bold.widthOfTextAtSize(title, 16), y, size: 16, font: bold, color: BLACK });
  return y - 40;
}

export async function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 842]);
  const width = page.getWidth();
  let y = page.getHeight() - MARGIN;

  y = header(page, bold, font, 'INVOICE', y);

  page.drawText(`Invoice No: ${data.invoiceNo}`, { x: MARGIN, y, size: 10, font: bold });
  page.drawText(`Date: ${data.date}`, { x: width - MARGIN - 120, y, size: 10, font });
  y -= 16;
  page.drawText(`Bill To: ${data.studentName}${data.studentMobile ? ` · ${data.studentMobile}` : ''}`, {
    x: MARGIN,
    y,
    size: 10,
    font,
  });
  y -= 24;

  // Table header
  const cols = { desc: MARGIN, qty: 360, unit: 410, line: 500 };
  page.drawRectangle({ x: MARGIN, y: y - 4, width: width - MARGIN * 2, height: 20, color: rgb(0.95, 0.97, 0.96) });
  page.drawText('Description', { x: cols.desc + 4, y, size: 9, font: bold });
  page.drawText('Qty', { x: cols.qty, y, size: 9, font: bold });
  page.drawText('Unit', { x: cols.unit, y, size: 9, font: bold });
  page.drawText('Amount', { x: cols.line, y, size: 9, font: bold });
  y -= 22;

  for (const it of data.items) {
    page.drawText(it.description.slice(0, 60), { x: cols.desc + 4, y, size: 9, font });
    page.drawText(String(it.qty), { x: cols.qty, y, size: 9, font });
    page.drawText(inr(it.unitRupees), { x: cols.unit, y, size: 9, font });
    page.drawText(inr(it.lineRupees), { x: cols.line, y, size: 9, font });
    y -= 16;
  }

  y -= 8;
  const totalsRow = (label: string, value: string, b = false) => {
    const f = b ? bold : font;
    page.drawText(label, { x: 380, y, size: 10, font: f });
    page.drawText(value, { x: cols.line, y, size: 10, font: f });
    y -= 16;
  };
  totalsRow('Subtotal', inr(data.subtotalRupees));
  if (data.discountRupees) totalsRow('Discount', `- ${inr(data.discountRupees)}`);
  if (data.taxRupees) totalsRow('Tax', inr(data.taxRupees));
  totalsRow('Total', inr(data.totalRupees), true);
  totalsRow('Paid', inr(data.paidRupees));
  totalsRow('Balance', inr(data.totalRupees - data.paidRupees), true);

  page.drawText(`Status: ${data.status}`, { x: MARGIN, y: y, size: 10, font: bold, color: TEAL });
  page.drawText('Thank you for practicing with Moksha Wellness.', {
    x: MARGIN,
    y: MARGIN,
    size: 9,
    font,
    color: GREY,
  });

  return Buffer.from(await doc.save());
}

export interface ReceiptPdfData {
  receiptNo: string;
  date: string;
  studentName: string;
  invoiceNo: string;
  amountRupees: number;
  mode: string;
  referenceNo?: string | null;
}

export async function generateReceiptPdf(data: ReceiptPdfData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([595, 400]);
  let y = page.getHeight() - MARGIN;

  y = header(page, bold, font, 'RECEIPT', y);

  const row = (label: string, value: string) => {
    page.drawText(label, { x: MARGIN, y, size: 10, font: bold });
    page.drawText(value, { x: MARGIN + 130, y, size: 10, font });
    y -= 20;
  };
  row('Receipt No', data.receiptNo);
  row('Date', data.date);
  row('Received From', data.studentName);
  row('Against Invoice', data.invoiceNo);
  row('Payment Mode', data.mode + (data.referenceNo ? ` (${data.referenceNo})` : ''));
  y -= 6;
  page.drawText(`Amount Received: ${inr(data.amountRupees)}`, { x: MARGIN, y, size: 13, font: bold, color: TEAL });

  page.drawText('This is a computer-generated receipt.', { x: MARGIN, y: MARGIN, size: 8, font, color: GREY });
  return Buffer.from(await doc.save());
}
