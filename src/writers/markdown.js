// Rewrite table cells in a Markdown file in place. Untouched lines stay byte
// identical; a new column is appended to every line of the table it belongs to.
import { isSeparator, splitRawRow } from "../readers/markdown.js";

const mdCell = (v) => String(v ?? "").replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|").trim();
const joinRow = (cells) => `| ${cells.map((c) => c.trim()).join(" | ")} |`;

/**
 * cells: Map<lineNumber (1-based, as the reader reports), Map<colIndex, string>>
 * addColumns: Map<headerLineNumber, [names]> — columns to append to that table.
 */
export function patchMarkdown(text, cells, addColumns = new Map()) {
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!(lines[i].includes("|") && i + 1 < lines.length && isSeparator(lines[i + 1]))) continue;
    const extra = addColumns.get(i + 1) || [];
    const width = splitRawRow(lines[i]).length + extra.length;
    if (extra.length) {
      lines[i] = joinRow([...splitRawRow(lines[i]), ...extra]);
      lines[i + 1] = joinRow([...splitRawRow(lines[i + 1]).map((c) => c.trim() || "---"), ...extra.map(() => "---")]);
    }
    let j = i + 2;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim() || !l.includes("|")) break;
      const patch = cells.get(j + 1);
      if (!patch && !extra.length) continue;
      const row = splitRawRow(l);
      while (row.length < width) row.push("");
      for (const [col, v] of patch || []) row[col] = mdCell(v);
      lines[j] = joinRow(row.slice(0, width));
    }
    i = j - 1;
  }
  return lines.join(eol);
}
