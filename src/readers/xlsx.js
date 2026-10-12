// .xlsx reader without dependencies: shared strings, inline strings, numbers,
// booleans, formula results. Reads one sheet (first by default, or by name).
import { readZip } from "./zip.js";

const unesc = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

function textOf(xml) {
  // concatenates every <t>…</t> inside a <si> or <is> (rich text runs)
  let out = "";
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = re.exec(xml))) out += unesc(m[1]);
  return out;
}

export function listSheets(buf) {
  const files = readZip(buf);
  return sheetTable(files).map((s) => s.name);
}

function sheetTable(files) {
  const wb = files.get("xl/workbook.xml")?.toString("utf8") || "";
  const rels = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") || "";
  const relMap = new Map();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /Id="([^"]+)"/.exec(m[1])?.[1];
    const target = /Target="([^"]+)"/.exec(m[1])?.[1];
    if (id && target) relMap.set(id, target.replace(/^\/?(xl\/)?/, "xl/"));
  }
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = unesc(/name="([^"]*)"/.exec(m[1])?.[1] || "");
    const rid = /r:id="([^"]+)"/.exec(m[1])?.[1];
    const path = relMap.get(rid) || `xl/worksheets/sheet${sheets.length + 1}.xml`;
    sheets.push({ name, path });
  }
  return sheets;
}

function colIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    if (ch < "A" || ch > "Z") break;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

export function parseXlsx(buf, { sheet } = {}) {
  const files = readZip(buf);
  const sheets = sheetTable(files);
  if (!sheets.length) throw new Error("workbook has no sheets");
  const pick = sheet ? sheets.find((s) => s.name === sheet) : sheets[0];
  if (!pick) throw new Error(`sheet "${sheet}" not found; have: ${sheets.map((s) => s.name).join(", ")}`);
  const xml = files.get(pick.path)?.toString("utf8");
  if (!xml) throw new Error(`sheet file ${pick.path} missing`);
  const shared = [];
  const ss = files.get("xl/sharedStrings.xml")?.toString("utf8");
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));

  const grid = [];
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rnum = Number(/\br="(\d+)"/.exec(rm[1])?.[1] || grid.length + 1);
    const cells = [];
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const inner = cm[2] || "";
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const ci = ref ? colIndex(ref) : cells.length;
      const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
      let v = "";
      if (t === "s") v = shared[Number(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1])] ?? "";
      else if (t === "inlineStr") v = textOf(inner);
      else if (t === "b") v = /<v>1<\/v>/.test(inner) ? "TRUE" : "FALSE";
      else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        v = raw == null ? "" : unesc(raw);
      }
      cells[ci] = v.replace(/\r\n?/g, "\n").trim();
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] == null) cells[i] = "";
    grid.push({ cells, line: rnum });
  }
  const first = grid.findIndex((r) => r.cells.some((c) => c));
  if (first < 0) return { tables: [] };
  const headers = grid[first].cells.map((c) => c || "");
  const rows = grid
    .slice(first + 1)
    .filter((r) => r.cells.some((c) => c))
    .map((r) => {
      const cells = r.cells.slice();
      while (cells.length < headers.length) cells.push("");
      return { cells: cells.slice(0, headers.length), line: r.line };
    });
  return { tables: [{ headers, rows, heading: pick.name, line: grid[first].line }] };
}
