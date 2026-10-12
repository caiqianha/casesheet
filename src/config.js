import fs from "node:fs";
import path from "node:path";

export const DEFAULTS = {
  out: "tests/casesheet",
  lang: "ts",
  split: "file",
  strict: false,
  sheet: null,
  routes: {},
  macros: {},
};

export function loadConfig(explicit, cwd = process.cwd()) {
  const file = explicit ? path.resolve(cwd, explicit) : path.join(cwd, "casesheet.config.json");
  if (!fs.existsSync(file)) {
    if (explicit) throw new Error(`config file not found: ${file}`);
    return { ...DEFAULTS, _file: null };
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file}: ${e.message}`);
  }
  for (const k of Object.keys(data)) if (!(k in DEFAULTS) && k !== "$schema") throw new Error(`${file}: unknown option "${k}" (known: ${Object.keys(DEFAULTS).join(", ")})`);
  if (data.routes && typeof data.routes !== "object") throw new Error(`${file}: "routes" must be an object of { "页面名": "/path" }`);
  if (data.macros) for (const [k, v] of Object.entries(data.macros)) if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new Error(`${file}: macro "${k}" must be an array of step strings`);
  return { ...DEFAULTS, ...data, _file: file };
}

export function expandMacros(steps, macros, depth = 0) {
  if (!macros || !Object.keys(macros).length) return steps;
  const out = [];
  for (const s of steps) {
    const key = s.text.trim();
    const hit = macros[key] ?? macros[key.replace(/[。.;；]$/, "")];
    if (hit && depth < 3) {
      const inner = expandMacros(hit.map((t) => ({ text: t, expected: [] })), macros, depth + 1);
      inner.forEach((x, i) => out.push({ ...x, macro: key, sub: i + 1, last: i === inner.length - 1, expected: i === inner.length - 1 ? [...x.expected, ...s.expected] : x.expected }));
    } else out.push(s);
  }
  return out;
}
