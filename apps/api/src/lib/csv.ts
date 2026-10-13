// Minimal RFC-4180 CSV reader/writer (quoted fields, embedded commas/newlines,
// doubled quotes, CRLF or LF, optional UTF-8 BOM). Kept dependency-free on purpose.

/** UTF-8 byte-order mark: Excel writes it, and needs it to read UTF-8 correctly. */
const BOM = 0xfeff;

export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === BOM ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new Error('Unterminated quoted value — the file is not valid CSV');
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM so Excel opens the file as UTF-8; CRLF line endings for Excel.
  return String.fromCharCode(BOM) + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
