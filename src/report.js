// Playwright JSON reporter output → per-case results, keyed by the [ID] in the title.
import fs from "node:fs";

export function readResults(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const rows = [];
  const walk = (suite, trail) => {
    for (const spec of suite.specs || []) {
      const m = /^\[(.+?)\]\s*(.*)$/.exec(spec.title);
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
          title: m ? m[2] : spec.title,
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

export function summarize(rows) {
  const by = {};
  for (const r of rows) by[r.status] = (by[r.status] || 0) + 1;
  return by;
}
