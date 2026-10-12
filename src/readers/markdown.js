// Markdown tables → { tables: [{ headers, rows, heading, line }] }
// Several tables in one file are fine; the nearest heading above a table is kept
// so it can serve as the module name when the sheet has no module column.

function splitRow(line) {
  const s = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells.map(cleanCell);
}

export function cleanCell(c) {
  return c
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

const isSeparator = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function parseMarkdown(text) {
  const lines = text.split(/\r?\n/);
  const tables = [];
  let heading = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      heading = h[2].trim();
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const headers = splitRow(line);
      const rows = [];
      const start = i + 1;
      let j = i + 2;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (!l.trim() || !l.includes("|")) break;
        const cells = splitRow(l);
        while (cells.length < headers.length) cells.push("");
        rows.push({ cells: cells.slice(0, headers.length), line: j + 1 });
      }
      tables.push({ headers, rows, heading, line: start });
      i = j - 1;
    }
  }
  return { tables };
}
