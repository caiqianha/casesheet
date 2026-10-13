// Table rows → normalized case objects: { id, title, module, priority, tags,
// preconditions[], steps: [{ text, expected: [] }], source }
import { mapColumns } from "./columns.js";

const NUM = /^\s*(?:(?:step|步骤)\s*)?(\d{1,3})\s*[.、．)）:：\]】-]\s*(?!\d)/i;
const BULLET = /^\s*[-*•·]\s+/;

export function splitLines(cell) {
  if (!cell) return [];
  let text = String(cell).replace(/\r\n?/g, "\n");
  let lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  // "1.打开页面 2.输入账号 3.点击登录" on one line
  if (lines.length === 1) {
    const markers = lines[0].match(/(?:^|\s)\d{1,3}[.、．)）]\s*(?=[^\d\s])/g);
    if (markers && markers.length >= 2) lines = lines[0].split(/\s+(?=\d{1,3}[.、．)）]\s*[^\d\s])/).map((l) => l.trim()).filter(Boolean);
  }
  // "打开页面；输入账号；点击登录" on one line
  if (lines.length === 1 && /[;；]/.test(lines[0]) && !/["'“”‘’「」].*[;；].*["'“”‘’「」]/.test(lines[0])) {
    lines = lines[0].split(/[;；]/).map((l) => l.trim()).filter(Boolean);
  }
  return lines.map((l) => {
    const m = NUM.exec(l);
    const n = m ? Number(m[1]) : null;
    const text = (m ? l.slice(m[0].length) : l.replace(BULLET, "")).trim();
    return { n, text };
  });
}

export function alignExpected(steps, expected) {
  const out = steps.map((s) => ({ text: s.text, expected: [] }));
  if (!expected.length) return out;
  if (!out.length) return [{ text: "", expected: expected.map((e) => e.text) }];
  const numbered = expected.every((e) => e.n != null) && steps.every((s) => s.n != null);
  if (numbered) {
    for (const e of expected) {
      const i = out.findIndex((_, k) => steps[k].n === e.n);
      (i >= 0 ? out[i] : out[out.length - 1]).expected.push(e.text);
    }
    return out;
  }
  if (expected.length === out.length) {
    expected.forEach((e, i) => out[i].expected.push(e.text));
    return out;
  }
  for (const e of expected) out[out.length - 1].expected.push(e.text);
  return out;
}

// Data column → one object per line. "k=v; k2=v2" (also "k: v", "；" separators)
// or a JSON object per line. Returns [] when any line is not key/value data, so
// free-text notes in that column keep the old behaviour (a plain annotation).
export function parseDataRows(cell) {
  const lines = String(cell || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rows = lines.map(parseDataLine);
  return rows.every(Boolean) ? rows : [];
}

function parseDataLine(line) {
  if (/^\{[\s\S]*\}$/.test(line)) {
    try {
      const o = JSON.parse(line);
      if (o && typeof o === "object" && !Array.isArray(o)) return { line, vars: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? "" : String(v)])) };
    } catch {
      return null;
    }
  }
  const vars = {};
  let any = false;
  for (const pair of line.split(/[;；]/).map((p) => p.trim()).filter(Boolean)) {
    const m = /^([^=:：]+?)\s*[=:：]\s*(.*)$/.exec(pair);
    if (!m) return null;
    vars[m[1].trim()] = m[2].trim();
    any = true;
  }
  return any ? { line, vars } : null;
}

/** Replace {{k}} with the data row's value for every k the row defines; other placeholders stay for the env lookup. */
export function substitute(text, vars) {
  if (!vars || !text) return text;
  return String(text).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (all, k) => (k in vars ? vars[k] : all));
}

/** One case per data row ("[TC-001] title (1/3)"); a case without 2+ data rows is returned as is. */
export function caseVariants(c) {
  const rows = c.dataRows || [];
  if (rows.length < 2) return [{ ...c, variant: "" }];
  return rows.map((r, i) => ({
    ...c,
    title: substitute(c.title, r.vars),
    preconditions: c.preconditions.map((p) => substitute(p, r.vars)),
    steps: c.steps.map((s) => ({ ...s, text: substitute(s.text, r.vars), expected: s.expected.map((e) => substitute(e, r.vars)) })),
    data: r.line,
    variant: `${i + 1}/${rows.length}`,
  }));
}

const splitTags = (s) =>
  String(s || "")
    .split(/[,，;；|\s/]+/)
    .map((t) => t.trim().replace(/^[@#]/, ""))
    .filter(Boolean);

export function tableToCases(table, source) {
  const { map, extra } = mapColumns(table.headers);
  if (map.steps == null && map.title == null)
    throw new Error(`${source}: cannot find a steps column (headers: ${table.headers.join(" | ")})`);
  const cell = (row, f) => (map[f] == null ? "" : row.cells[map[f]] || "");
  const cases = [];
  let lastModule = table.heading || "";
  let auto = 0;
  for (const row of table.rows) {
    const stepsCell = cell(row, "steps");
    const title = cell(row, "title");
    if (!stepsCell && !title) continue;
    const module = cell(row, "module") || lastModule;
    if (cell(row, "module")) lastModule = cell(row, "module");
    const steps = alignExpected(splitLines(stepsCell), splitLines(cell(row, "expected")));
    auto++;
    const id = cell(row, "id") || `R${String(row.line).padStart(3, "0")}`;
    const c = {
      id,
      title: title || steps[0]?.text || id,
      module: module || "cases",
      priority: cell(row, "priority").trim(),
      tags: splitTags(cell(row, "tags")),
      preconditions: splitLines(cell(row, "precondition")).map((l) => l.text),
      data: cell(row, "data"),
      dataRows: parseDataRows(cell(row, "data")),
      notes: cell(row, "notes"),
      steps,
      extra: Object.fromEntries(extra.map((e) => [e.name, row.cells[e.index] || ""]).filter(([, v]) => v)),
      source: `${source}:${row.line}`,
    };
    cases.push(c);
  }
  return cases;
}

export function tablesToCases(tables, source) {
  return tables.flatMap((t) => tableToCases(t, source));
}
