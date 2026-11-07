/** Minimal RFC 4180 CSV for catalogue exchange. UTF-8 with optional BOM; "," or ";" delimiter (German Excel). */

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "") || row.length > 1) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const cell = (v: string | number | boolean | null | undefined) => {
  let s = v == null ? "" : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+@]/.test(s) || (/^-/.test(s) && !/^-?\d/.test(s))) s = `'${s}`;
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
