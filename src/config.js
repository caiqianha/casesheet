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
  rules: [],
};

export const LANGS = ["ts", "js", "py"];

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
  if (data.lang != null && !LANGS.includes(data.lang)) throw new Error(`${file}: "lang" must be one of ${LANGS.join(", ")}`);
  if (data.routes && typeof data.routes !== "object") throw new Error(`${file}: "routes" must be an object of { "页面名": "/path" }`);
  if (data.macros) for (const [k, v] of Object.entries(data.macros)) if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new Error(`${file}: macro "${k}" must be an array of step strings`);
  if (data.rules != null) data.rules = validateRules(data.rules, file);
  return { ...DEFAULTS, ...data, _file: file };
}

// rules: [{ match, flags?, kind: "step" | "expect", code, py?, name? }], tried before the built-in grammar.
export function validateRules(rules, file = "casesheet.config.json") {
  if (!Array.isArray(rules)) throw new Error(`${file}: "rules" must be an array of { match, kind, code }`);
  return rules.map((r, i) => {
    const at = `rules[${i}]`;
    if (!r || typeof r !== "object" || Array.isArray(r)) throw new Error(`${file}: ${at} must be an object { match, kind, code }`);
    for (const k of Object.keys(r)) if (!["match", "flags", "kind", "code", "py", "name"].includes(k)) throw new Error(`${file}: ${at}.${k} is not a rule option (known: match, flags, kind, code, py, name)`);
    for (const k of ["match", "kind", "code"]) if (typeof r[k] !== "string" || !r[k]) throw new Error(`${file}: ${at}.${k} is required (a ${k === "kind" ? '"step" or "expect"' : "string"})`);
    if (r.kind !== "step" && r.kind !== "expect") throw new Error(`${file}: ${at}.kind must be "step" or "expect", got "${r.kind}"`);
    for (const k of ["flags", "py", "name"]) if (r[k] != null && typeof r[k] !== "string") throw new Error(`${file}: ${at}.${k} must be a string`);
    let re;
    try {
      re = new RegExp(r.match, r.flags || "");
    } catch (e) {
      throw new Error(`${file}: ${at}.match is not a valid regular expression: ${e.message}`);
    }
    return { ...r, name: r.name || r.match, re };
  });
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
