// Write cells into one worksheet of an existing .xlsx without a dependency.
// Only the target sheet's XML changes; every other zip entry is carried over as
// is. Written text uses inline strings so sharedStrings.xml is left alone.
import { readZip } from "../readers/zip.js";
import { writeZip } from "./zip.js";
import { sheetTable } from "../readers/xlsx.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

export function colName(i) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function colIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    if (ch < "A" || ch > "Z") break;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

const cellXml = (ref, value, style) => `<c r="${ref}"${style ? ` s="${style}"` : ""} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;

/** cells: Map<rowNumber, Map<colIndex, string>>. Rows / cells that do not exist yet are created in order. */
export function patchSheetXml(xml, cells) {
  const open = xml.indexOf("<sheetData");
  if (open < 0) throw new Error("worksheet has no <sheetData>");
  const selfClosed = /^<sheetData\s*\/>/.test(xml.slice(open));
  const start = selfClosed ? open : xml.indexOf(">", open) + 1;
  const end = selfClosed ? open + xml.slice(open).indexOf("/>") + 2 : xml.indexOf("</sheetData>", start);
  const body = selfClosed ? "" : xml.slice(start, end);
  const rows = [];
  let auto = 0;
  for (const m of body.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(/\br="(\d+)"/.exec(m[1])?.[1] || auto + 1);
    auto = r;
    rows.push({ r, attrs: m[1], inner: m[2] || "", xml: m[0] });
  }
  const wanted = [...cells.keys()].sort((a, b) => a - b);
  const out = [];
  let maxCol = -1;
  let maxRow = 0;
  const emit = (row) => {
    const patch = cells.get(row.r);
    maxRow = Math.max(maxRow, row.r);
    if (!patch) {
      out.push(row.xml);
      return;
    }
    const existing = [];
    let ci = -1;
    for (const c of row.inner.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+)\d+"/.exec(c[1])?.[1];
      ci = ref ? colIndex(ref) : ci + 1;
      existing.push({ col: ci, xml: c[0], style: /\bs="(\d+)"/.exec(c[1])?.[1] });
    }
    const byCol = new Map(existing.map((c) => [c.col, c]));
    for (const [col, value] of patch) {
      const style = byCol.get(col)?.style;
      byCol.set(col, { col, xml: cellXml(`${colName(col)}${row.r}`, value, style) });
    }
    const merged = [...byCol.values()].sort((a, b) => a.col - b.col);
    maxCol = Math.max(maxCol, merged[merged.length - 1]?.col ?? -1);
    const attrs = row.attrs.replace(/\s+spans="[^"]*"/, "").replace(/\s+$/, "");
    out.push(`<row${/\br="/.test(attrs) ? attrs : ` r="${row.r}"${attrs}`}>${merged.map((c) => c.xml).join("")}</row>`);
  };
  let k = 0;
  for (const row of rows) {
    while (k < wanted.length && wanted[k] < row.r) emit({ r: wanted[k++], attrs: "", inner: "", xml: "" });
    if (k < wanted.length && wanted[k] === row.r) k++;
    emit(row);
  }
  while (k < wanted.length) emit({ r: wanted[k++], attrs: "", inner: "", xml: "" });
  let result = xml.slice(0, start) + (selfClosed ? "<sheetData>" : "") + out.join("") + (selfClosed ? "</sheetData>" : xml.slice(end));
  // keep <dimension> honest when a column or row was added
  result = result.replace(/<dimension ref="([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?"\s*\/>/, (all, c1, r1, c2, r2) => {
    const lastCol = Math.max(colIndex(c2 || c1), maxCol);
    const lastRow = Math.max(Number(r2 || r1), maxRow);
    return `<dimension ref="${c1}${r1}:${colName(lastCol)}${lastRow}"/>`;
  });
  return result;
}

/**
 * Patch cells of one worksheet (first, or by name) and return the new .xlsx Buffer.
 * cells: Map<rowNumber, Map<colIndex, string>>
 */
export function patchXlsx(buf, cells, { sheet } = {}) {
  const files = readZip(buf);
  const sheets = sheetTable(files);
  if (!sheets.length) throw new Error("workbook has no sheets");
  const pick = sheet ? sheets.find((s) => s.name === sheet) : sheets[0];
  if (!pick) throw new Error(`sheet "${sheet}" not found; have: ${sheets.map((s) => s.name).join(", ")}`);
  const xml = files.get(pick.path)?.toString("utf8");
  if (!xml) throw new Error(`sheet file ${pick.path} missing`);
  files.set(pick.path, Buffer.from(patchSheetXml(xml, cells), "utf8"));
  return writeZip(files);
}
