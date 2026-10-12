import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { readTables } from "./readers/index.js";
import { tablesToCases } from "./cases.js";
import { loadConfig } from "./config.js";
import { emitSpec, runtimeFor, specFileName, analyzeCase } from "./emit.js";
import { grammarTable } from "./grammar.js";
import { readResults, toCsv, summarize } from "./report.js";

const pkg = createRequire(import.meta.url)("../package.json");

const HELP = `casesheet ${pkg.version} — test-case tables in, Playwright specs out

Usage
  casesheet build <sheet...> [options]    generate specs (+ _casesheet helper and casesheet.map.json)
  casesheet check <sheet...> [--strict]   parse only; list steps casesheet cannot turn into code
  casesheet report <results.json> [--csv out.csv]
                                          per-case pass/fail table from Playwright's JSON reporter
  casesheet grammar [--json]              every sentence pattern casesheet understands (中文 / English)
  casesheet init [dir]                    write an example sheet and casesheet.config.json

Sheets: .md (tables), .csv / .tsv, .json, .xlsx. Columns are recognised by header
(编号/ID, 标题/Title, 模块/Module, 前置条件/Precondition, 步骤/Steps, 预期/Expected,
优先级/Priority, 标签/Tags, 测试数据/Data). Only a steps column is required.

Options
  -o, --out <dir>      output directory (default: casesheet.config.json → out, else tests/casesheet)
  --js                 emit .spec.js instead of .spec.ts
  --split module       one spec file per module instead of per sheet
  --strict             unrecognised expectations become test.fixme instead of a "manual check" annotation
  --sheet <name>       worksheet to read from an .xlsx (default: first)
  --config <file>      config file (default: ./casesheet.config.json)
  --quiet              only print problems
  -h, --help           this help
  -v, --version        print version

Docs: https://github.com/caiqianha/casesheet`;

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      o._.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v !== undefined) o[k] = v;
      else if (["out", "split", "sheet", "config", "csv"].includes(k)) o[k] = argv[++i];
      else o[k] = true;
    } else if (a === "-o") o.out = argv[++i];
    else if (a === "-h") o.help = true;
    else if (a === "-v") o.version = true;
    else if (a.startsWith("-") && a.length > 1) throw new Error(`unknown option ${a}`);
    else o._.push(a);
  }
  return o;
}

function loadCases(files, cfg) {
  const all = [];
  for (const f of files) {
    const file = path.resolve(f);
    if (!fs.existsSync(file)) throw new Error(`sheet not found: ${f}`);
    const { tables } = readTables(file, { sheet: cfg.sheet });
    if (!tables.length) throw new Error(`${f}: no table found`);
    const cases = tablesToCases(tables, path.basename(file));
    if (!cases.length) throw new Error(`${f}: table has no case rows`);
    all.push({ file, rel: path.relative(process.cwd(), file) || path.basename(file), cases });
  }
  return all;
}

const rel = (p) => { const r = path.relative(process.cwd(), p); return r && !r.startsWith("..") ? r : p; };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function cmdBuild(o, io) {
  if (!o._.length) throw new Error("build: give at least one sheet (casesheet build cases.md)");
  const cfg = loadConfig(o.config);
  if (o.out) cfg.out = o.out;
  if (o.js) cfg.lang = "js";
  if (o.split) cfg.split = o.split;
  if (o.strict) cfg.strict = true;
  if (o.sheet) cfg.sheet = o.sheet;
  const outDir = path.resolve(cfg.out);
  fs.mkdirSync(outDir, { recursive: true });
  const sources = loadCases(o._, cfg);
  const map = { generatedAt: new Date().toISOString(), out: rel(outDir), cases: [] };
  const total = { cases: 0, steps: 0, unknownSteps: [], unknownExpect: [], manual: 0, fixme: 0, files: [] };
  for (const src of sources) {
    const groups = cfg.split === "module" ? [...new Set(src.cases.map((c) => c.module))].map((m) => [m, src.cases.filter((c) => c.module === m)]) : [[null, src.cases]];
    for (const [module, cases] of groups) {
      const name = specFileName(src.file, cfg, module);
      const { source, map: m, stats } = emitSpec(cases, cfg, { sourceRel: src.rel });
      fs.writeFileSync(path.join(outDir, name), source);
      total.files.push(name);
      total.cases += stats.cases;
      total.steps += stats.steps;
      total.manual += stats.manual;
      total.fixme += stats.fixme;
      total.unknownSteps.push(...stats.unknownSteps.map((u) => ({ ...u, sheet: src.rel })));
      total.unknownExpect.push(...stats.unknownExpect.map((u) => ({ ...u, sheet: src.rel })));
      for (const e of m) map.cases.push({ ...e, spec: `${map.out}/${name}:${e.line}` });
    }
  }
  const rtName = cfg.lang === "js" ? "_casesheet.js" : "_casesheet.ts";
  fs.writeFileSync(path.join(outDir, rtName), runtimeFor(cfg));
  fs.writeFileSync(path.join(outDir, "casesheet.map.json"), JSON.stringify(map, null, 2) + "\n");
  if (!o.quiet) {
    io.log(`casesheet: ${plural(total.cases, "case")}, ${plural(total.steps, "step")} → ${rel(outDir)}/ (${total.files.join(", ")}, ${rtName}, casesheet.map.json)`);
  }
  printUnknown(total, io, cfg.strict);
  if (!o.quiet) io.log(`next: npx playwright test ${rel(outDir)}`);
  return 0;
}

function printUnknown(total, io, strict) {
  if (total.unknownSteps.length) {
    io.log(`\n${plural(total.unknownSteps.length, "step")} casesheet could not turn into code (marked test.fixme):`);
    for (const u of total.unknownSteps) io.log(`  [${u.id}] ${u.text}    (${u.sheet})`);
    io.log("  → rephrase with a known pattern (casesheet grammar), or define a macro in casesheet.config.json");
  }
  if (total.unknownExpect.length) {
    io.log(`\n${plural(total.unknownExpect.length, "expectation")} not automated (${strict ? "test.fixme" : "kept as a 'manual check' annotation"}):`);
    for (const u of total.unknownExpect) io.log(`  [${u.id}] ${u.text}    (${u.sheet})`);
  }
}

function cmdCheck(o, io) {
  if (!o._.length) throw new Error("check: give at least one sheet");
  const cfg = loadConfig(o.config);
  if (o.sheet) cfg.sheet = o.sheet;
  const sources = loadCases(o._, cfg);
  const total = { cases: 0, steps: 0, unknownSteps: [], unknownExpect: [] };
  for (const src of sources) {
    for (const c of src.cases) {
      const a = analyzeCase(c, cfg);
      total.cases++;
      total.steps += a.stepCount;
      total.unknownSteps.push(...a.unknownSteps.map((text) => ({ id: c.id, text, sheet: src.rel })));
      total.unknownExpect.push(...a.unknownExpect.map((text) => ({ id: c.id, text, sheet: src.rel })));
      if (!o.quiet) {
        const flag = a.unknownSteps.length ? "✗" : a.unknownExpect.length ? "~" : "✓";
        io.log(`${flag} [${c.id}] ${c.title}  (${a.stepCount} steps, ${a.unknownSteps.length} unknown, ${a.unknownExpect.length} manual)`);
      }
    }
  }
  const ok = total.steps - total.unknownSteps.length;
  io.log(`\n${plural(total.cases, "case")}, ${ok}/${total.steps} steps recognised, ${total.unknownExpect.length} expectations left to manual check`);
  printUnknown(total, io, o.strict);
  if (total.unknownSteps.length) return 1;
  if (o.strict && total.unknownExpect.length) return 1;
  return 0;
}

function cmdGrammar(o, io) {
  const rows = grammarTable();
  if (o.json) {
    io.log(JSON.stringify(rows, null, 2));
    return 0;
  }
  io.log("Steps (actions)\n");
  for (const r of rows.filter((r) => r.kind === "action")) io.log(`  ${r.id.padEnd(14)} ${r.zh}\n  ${"".padEnd(14)} ${r.en}`);
  io.log("\nExpected results (assertions)\n");
  for (const r of rows.filter((r) => r.kind === "assert")) io.log(`  ${r.id.padEnd(14)} ${r.zh}\n  ${"".padEnd(14)} ${r.en}`);
  io.log("\nValues: {{NAME}} reads process.env.NAME. Page names (打开 登录页 / go to the login page) resolve through casesheet.config.json → routes.");
  return 0;
}

function cmdReport(o, io) {
  const file = o._[0];
  if (!file) throw new Error("report: give Playwright's JSON output (npx playwright test --reporter=json > results.json)");
  const rows = readResults(path.resolve(file));
  if (o.csv) {
    fs.writeFileSync(path.resolve(o.csv), toCsv(rows));
    io.log(`wrote ${o.csv} (${rows.length} rows)`);
  }
  const w = Math.max(2, ...rows.map((r) => r.id.length));
  const icon = { pass: "✓", fail: "✗", flaky: "~", fixme: "?", skipped: "-" };
  for (const r of rows) {
    const tail = r.status === "fail" ? `  ${r.error}` : r.status === "fixme" ? `  ${r.fixme}` : r.manual.length ? `  manual: ${r.manual.join("; ")}` : "";
    io.log(`${icon[r.status] || " "} ${r.id.padEnd(w)}  ${r.status.padEnd(7)} ${r.title}${tail}`);
  }
  const s = summarize(rows);
  io.log(`\n${rows.length} cases: ` + Object.entries(s).map(([k, v]) => `${v} ${k}`).join(", "));
  return s.fail ? 1 : 0;
}

function cmdInit(o, io) {
  const dir = path.resolve(o._[0] || ".");
  fs.mkdirSync(path.join(dir, "cases"), { recursive: true });
  const sheet = path.join(dir, "cases", "example.md");
  const conf = path.join(dir, "casesheet.config.json");
  const here = path.dirname(new URL(import.meta.url).pathname);
  if (!fs.existsSync(sheet)) fs.copyFileSync(path.join(here, "..", "examples", "login.md"), sheet);
  else io.log(`kept existing ${path.relative(process.cwd(), sheet)}`);
  if (!fs.existsSync(conf)) fs.copyFileSync(path.join(here, "..", "examples", "casesheet.config.json"), conf);
  else io.log(`kept existing ${path.relative(process.cwd(), conf)}`);
  io.log(`ready. Next:\n  casesheet check cases/example.md\n  casesheet build cases/example.md\n  npx playwright test tests/casesheet\nSet baseURL in playwright.config.ts (use: { baseURL: 'http://localhost:3000' }) so "打开 /login" works.`);
  return 0;
}

export async function main(argv, io = console) {
  const o = parseArgs(argv);
  if (o.version) {
    io.log(pkg.version);
    return 0;
  }
  const cmd = o._.shift();
  if (o.help || !cmd || cmd === "help") {
    io.log(HELP);
    return 0;
  }
  switch (cmd) {
    case "build":
      return cmdBuild(o, io);
    case "check":
      return cmdCheck(o, io);
    case "grammar":
      return cmdGrammar(o, io);
    case "report":
      return cmdReport(o, io);
    case "init":
      return cmdInit(o, io);
    default:
      throw new Error(`unknown command "${cmd}" (try: casesheet --help)`);
  }
}
