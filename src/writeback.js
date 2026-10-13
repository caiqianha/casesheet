// Write per-case results back into the sheet they came from (.xlsx, .csv / .tsv, .md).
import fs from "node:fs";
import path from "node:path";
import { readTables } from "./readers/index.js";
import { mapColumns } from "./columns.js";
import { patchXlsx } from "./writers/xlsx.js";
import { patchCsv } from "./writers/csv.js";
import { patchMarkdown } from "./writers/markdown.js";

const hasCjk = (s) => /[㐀-鿿]/.test(s);

/** Text for the 实际结果 / actual column. */
export function actualText(r) {
  if (r.status === "pass") return "PASS";
  if (r.status === "fail") return "FAIL" + (r.error ? `: ${r.error}` : "") + (r.failed && r.failed.length ? ` (${r.failed.join(", ")})` : "");
  if (r.status === "fixme") return "FIXME" + (r.fixme ? `: ${r.fixme}` : "");
  if (r.status === "flaky") return "FLAKY";
  return "SKIPPED";
}

export const statusText = (r) => ({ pass: "PASS", fail: "FAIL", fixme: "FIXME", flaky: "FLAKY" })[r.status] || "SKIPPED";

/** input → default output: 用例.xlsx → 用例.result.xlsx */
export function resultPath(file) {
  const ext = path.extname(file);
  return path.join(path.dirname(file), path.basename(file, ext) + ".result" + ext);
}

const rowId = (row, map) => (map.id == null ? "" : row.cells[map.id] || "") || `R${String(row.line).padStart(3, "0")}`;

/**
 * rows: report rows (one per case id, see report.groupById). Returns { out, written, unmatched }.
 * Never overwrites `file` unless inPlace is set.
 */
export function writeBack(file, rows, { out, inPlace = false, sheet } = {}) {
  const src = path.resolve(file);
  if (!fs.existsSync(src)) throw new Error(`sheet not found: ${file}`);
  const dest = inPlace ? src : path.resolve(out || resultPath(src));
  if (!inPlace && dest === src) throw new Error(`refusing to overwrite ${file}; pass --in-place to do that on purpose`);
  const ext = path.extname(src).toLowerCase();
  const { tables } = readTables(src, { sheet });
  if (!tables.length) throw new Error(`${file}: no table found`);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const cells = new Map();
  const addColumns = new Map();
  const put = (line, col, v) => {
    if (!cells.has(line)) cells.set(line, new Map());
    cells.get(line).set(col, v);
  };
  let written = 0;
  const matched = new Set();
  const tableList = ext === ".md" || ext === ".markdown" ? tables : tables.slice(0, 1);
  for (const t of tableList) {
    const { map } = mapColumns(t.headers);
    let actual = map.actual;
    const headerLine = t.line;
    if (actual == null) {
      actual = t.headers.length;
      const name = t.headers.some(hasCjk) ? "实际结果" : "Actual";
      if (ext === ".xlsx" || ext === ".xlsm") put(headerLine, actual, name);
      else addColumns.set(headerLine, [name]);
    }
    for (const row of t.rows) {
      const r = byId.get(rowId(row, map));
      if (!r) continue;
      matched.add(r.id);
      written++;
      put(row.line, actual, actualText(r));
      if (map.status != null) put(row.line, map.status, statusText(r));
    }
  }
  const unmatched = rows.filter((r) => !matched.has(r.id)).map((r) => r.id);
  let data;
  if (ext === ".xlsx" || ext === ".xlsm") data = patchXlsx(fs.readFileSync(src), cells, { sheet });
  else if (ext === ".md" || ext === ".markdown") data = patchMarkdown(fs.readFileSync(src, "utf8"), cells, addColumns);
  else if ([".csv", ".tsv", ".txt"].includes(ext)) data = patchCsv(fs.readFileSync(src, "utf8"), cells, { delimiter: ext === ".tsv" ? "\t" : undefined, newHeaders: [...addColumns.values()].flat() });
  else throw new Error(`${file}: cannot write results into a ${ext} file (use .xlsx, .csv, .tsv or .md)`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, data);
  return { out: dest, written, unmatched };
}
