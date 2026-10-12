// RFC 4180-ish CSV / TSV reader. Handles quotes, escaped quotes, newlines inside
// quotes, a UTF-8 BOM and auto-detects the delimiter (comma, tab or semicolon).

export function detectDelimiter(firstLine) {
  const counts = { ",": 0, "\t": 0, ";": 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

export function parseCsv(text, delimiter) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const d = delimiter || detectDelimiter(text.split(/\r?\n/)[0] || "");
  const rows = [];
  let row = [];
  let cur = "";
  let inQ = false;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else {
        if (ch === "\n") line++;
        cur += ch;
      }
    } else if (ch === '"') inQ = true;
    else if (ch === d) {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((c) => c.trim() !== "")) rows.push({ cells: row.map((c) => c.trim()), line: rowLine });
      row = [];
      line++;
      rowLine = line;
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== "")) rows.push({ cells: row.map((c) => c.trim()), line: rowLine });
  if (!rows.length) return { tables: [] };
  const headers = rows[0].cells;
  const body = rows.slice(1).map((r) => {
    const cells = r.cells.slice();
    while (cells.length < headers.length) cells.push("");
    return { cells: cells.slice(0, headers.length), line: r.line };
  });
  return { tables: [{ headers, rows: body, heading: "", line: 1 }] };
}
