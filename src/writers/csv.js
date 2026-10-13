// Rewrite a CSV / TSV with some cells changed. The file is re-serialised from the
// parsed table (same delimiter, BOM and line ending), quoting only where needed.
import { parseCsv, detectDelimiter } from "../readers/csv.js";

const quote = (v, d) => {
  const s = String(v ?? "");
  return s.includes(d) || /["\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** cells: Map<lineNumber, Map<colIndex, string>>; headers may grow (new column at the end). */
export function patchCsv(text, cells, { delimiter, newHeaders = [] } = {}) {
  const bom = text.charCodeAt(0) === 0xfeff;
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  const body = bom ? text.slice(1) : text;
  const d = delimiter || detectDelimiter(body.split(/\r?\n/)[0] || "");
  const { tables } = parseCsv(body, d);
  if (!tables.length) return text;
  const t = tables[0];
  const headers = [...t.headers, ...newHeaders];
  const width = headers.length;
  const lines = [headers.map((h) => quote(h, d)).join(d)];
  for (const row of t.rows) {
    const vals = row.cells.slice();
    while (vals.length < width) vals.push("");
    for (const [col, v] of cells.get(row.line) || []) vals[col] = v;
    lines.push(vals.map((v) => quote(v, d)).join(d));
  }
  return (bom ? "﻿" : "") + lines.join(eol) + eol;
}
