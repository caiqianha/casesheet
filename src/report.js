// Playwright JSON reporter output → per-case results, keyed by the [ID] in the title.
import fs from "node:fs";

export function readResults(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const rows = [];
  const walk = (suite, trail) => {
    for (const spec of suite.specs || []) {
      const m = /^\[(.+?)\]\s*(.*)$/.exec(spec.title);
      // "[TC-001] title (2/3)": one test per data row, grouped back under TC-001 by groupById()
      const v = m ? /^(.*?)\s*\((\d+\/\d+)\)$/.exec(m[2]) : null;
      for (const t of spec.tests || []) {
        const res = t.results || [];
        const last = res[res.length - 1] || {};
        const ann = t.annotations || [];
        const fixme = ann.find((a) => a.type === "fixme");
        const manual = ann.filter((a) => a.type === "manual check").map((a) => a.description);
        const source = ann.find((a) => a.type === "source")?.description || "";
        let status = t.status === "expected" ? "pass" : t.status === "unexpected" ? "fail" : t.status === "flaky" ? "flaky" : "skipped";
        if (fixme && status === "skipped") status = "fixme";
        const err = last.error?.message || (last.errors && last.errors[0]?.message) || "";
        rows.push({
          id: m ? m[1] : "",
          title: v ? v[1] : m ? m[2] : spec.title,
          variant: v ? v[2] : "",
          module: trail.filter(Boolean).join(" / ") || "",
          file: spec.file || suite.file || "",
          status,
          project: t.projectName || "",
          durationMs: res.reduce((a, r) => a + (r.duration || 0), 0),
          error: firstLine(err),
          fixme: fixme?.description || "",
          manual,
        });
      }
    }
    for (const s of suite.suites || []) walk(s, trail.concat(s.title));
  };
  for (const s of data.suites || []) walk(s, []);
  return rows;
}

const ANSI = /\u001b\[[0-9;]*m/g;
export function firstLine(s) {
  return String(s || "").replace(ANSI, "").split("\n").map((l) => l.trim()).filter(Boolean)[0] || "";
}

export function toCsv(rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = ["id", "module", "title", "status", "duration_ms", "error", "manual_checks", "file"];
  return [head.join(",")].concat(rows.map((r) => [r.id, r.module, r.title, r.status, r.durationMs, r.error, r.manual.join(" | "), r.file].map(esc).join(","))).join("\n") + "\n";
}

const RANK = { fail: 0, flaky: 1, fixme: 2, skipped: 3, pass: 4 };

/** One row per case id: data-row variants collapse into their base case (worst status wins). */
export function groupById(rows) {
  const out = [];
  const by = new Map();
  for (const r of rows) {
    const key = r.id || `${r.file}:${r.title}`;
    const g = by.get(key);
    if (!g) {
      const first = { ...r, manual: [...r.manual], rows: 1, dataRows: r.variant ? 1 : 0, failed: [] };
      if (r.variant && r.status === "fail") first.failed.push(r.variant);
      by.set(key, first);
      out.push(first);
      continue;
    }
    g.rows++;
    if (r.variant) g.dataRows++;
    g.durationMs += r.durationMs;
    for (const m of r.manual) if (!g.manual.includes(m)) g.manual.push(m);
    if (r.status === "fail" && r.variant) g.failed.push(r.variant);
    if ((RANK[r.status] ?? 9) < (RANK[g.status] ?? 9)) {
      g.status = r.status;
      g.error = r.error;
      g.fixme = r.fixme;
      g.variant = r.variant;
    } else if (r.status === g.status && !g.error && r.error) g.error = r.error;
  }
  return out;
}

export function summarize(rows) {
  const by = {};
  for (const r of rows) by[r.status] = (by[r.status] || 0) + 1;
  return by;
}
