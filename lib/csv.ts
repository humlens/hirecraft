/**
 * Minimal RFC 4180 CSV parser/serializer.
 * Serialising neutralises spreadsheet formula injection (cells starting with
 * = + - @ or control characters are prefixed with a single quote).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') {
        i++;
      }

      row.push(cell);
      cell = '';

      if (row.some((x) => x.trim() !== '')) {
        rows.push(row);
      }

      row = [];
    } else {
      cell += c;
    }
  }

  row.push(cell);

  if (row.some((x) => x.trim() !== '')) {
    rows.push(row);
  }

  return rows;
}

const FORMULA = /^[=+\-@\t\r]/;

export const csvCell = (value: unknown) => {
  let s = value == null ? '' : String(value);

  if (FORMULA.test(s)) {
    s = `'${s}`;
  }

  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (header: string[], rows: unknown[][]) =>
  [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
