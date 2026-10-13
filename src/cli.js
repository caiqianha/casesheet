import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { readTables } from "./readers/index.js";
import { tablesToCases } from "./cases.js";
import { loadConfig, LANGS } from "./config.js";
import { emitSpec, runtimeFor, specFileName, analyzeCase } from "./emit.js";
import { emitSpecPy, runtimePy, conftestPy } from "./emit-py.js";
import { grammarTable } from "./grammar.js";
import { readResults, toCsv, summarize, groupById } from "./report.js";
import { writeBack } from "./writeback.js";

const pkg = createRequire(import.meta.url)("../package.json");

const HELP = `casesheet ${pkg.version} — test-case tables in, Playwright specs out

Usage
  casesheet build <sheet...> [options]    generate specs (+ _casesheet helper and casesheet.map.json)
  casesheet run <sheet...> [options] [-- <runner args>]
                                          build, run the specs (npx playwright test / pytest), print the
                                          per-case report; --into writes results back into the sheet
  casesheet check <sheet...> [--strict]   parse only; list steps casesheet cannot turn into code
  casesheet report <results.json> [--csv out.csv] [--into sheet [--out file | --in-place]]
                                          per-case pass/fail table from the JSON results; --into fills the
                                          实际结果/actual (and 状态/status) column of an .xlsx / .csv / .md sheet
  casesheet grammar [--json]              every sentence pattern casesheet understands (中文 / English)
                                          plus the custom rules of casesheet.config.json, when present
  casesheet init [dir]                    write an example sheet and casesheet.config.json

Sheets: .md (tables), .csv / .tsv, .json, .xlsx. Columns are recognised by header
(编号/ID, 标题/Title, 模块/Module, 前置条件/Precondition, 步骤/Steps, 预期/Expected,
优先级/Priority, 标签/Tags, 测试数据/Data). Only a steps column is required.
A data column with several "k=v; k2=v2" (or JSON) lines gives one test per line;
{{k}} in steps is filled from the line first, then from the environment.

Options
  -o, --out <dir>      output directory (default: casesheet.config.json → out, else tests/casesheet)
  --lang ts|js|py      TypeScript (default), JavaScript, or pytest + playwright-python
  --js                 same as --lang js
  --split module       one spec file per module instead of per sheet
  --strict             unrecognised expectations become test.fixme (py: pytest.fail) instead of a "manual check"
  --sheet <name>       worksheet to read from an .xlsx (default: first)
  --config <file>      config file (default: ./casesheet.config.json)
  --into <sheet>       run / report: write PASS / FAIL: … / FIXME: … back into this sheet
  --out <file>         report --into: where to write (default: <sheet>.result.<ext>); run: see -o
  --result <file>      run --into: where to write the filled sheet (default: <sheet>.result.<ext>)
  --in-place           run / report --into: overwrite the sheet itself
  --quiet              only print problems
  -h, --help           this help
  -v, --version        print version

Docs: https://github.com/caiqianha/casesheet`;

const VALUE_OPTS = ["out", "split", "sheet", "config", "csv", "into", "lang", "result"];

export function parseArgs(argv) {
  const o = { _: [], passthrough: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      o.passthrough = argv.slice(i + 1);
      break;
    }
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v !== undefined) o[k] = v;
      else if (VALUE_OPTS.includes(k)) o[k] = argv[++i];
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

function configFor(o) {
  const cfg = loadConfig(o.config);
  if (o.out) cfg.out = o.out;
  if (o.js) cfg.lang = "js";
  if (o.lang) {
    if (!LANGS.includes(o.lang)) throw new Error(`--lang must be one of ${LANGS.join(", ")}`);
    cfg.lang = o.lang;
  }
  if (o.split) cfg.split = o.split;
  if (o.strict) cfg.strict = true;
  if (o.sheet) cfg.sheet = o.sheet;
  return cfg;
}

/** Shared by build and run: write specs + runtime + map, print the summary. */
function build(o, io, verb = "build") {
  if (!o._.length) throw new Error(`${verb}: give at least one sheet (casesheet ${verb} cases.md)`);
  const cfg = configFor(o);
  const py = cfg.lang === "py";
  const outDir = path.resolve(cfg.out);
  fs.mkdirSync(outDir, { recursive: true });
  const sources = loadCases(o._, cfg);
  const map = { generatedAt: new Date().toISOString(), out: rel(outDir), cases: [] };
  const total = { cases: 0, steps: 0, unknownSteps: [], unknownExpect: [], manual: 0, fixme: 0, files: [], tags: [] };
  for (const src of sources) {
    const groups = cfg.split === "module" ? [...new Set(src.cases.map((c) => c.module))].map((m) => [m, src.cases.filter((c) => c.module === m)]) : [[null, src.cases]];
    for (const [module, cases] of groups) {
      const name = specFileName(src.file, cfg, module);
      const { source, map: m, stats } = (py ? emitSpecPy : emitSpec)(cases, cfg, { sourceRel: src.rel });
      fs.writeFileSync(path.join(outDir, name), source);
      total.files.push(name);
      total.cases += stats.cases;
      total.steps += stats.steps;
      total.manual += stats.manual;
      total.fixme += stats.fixme;
      if (stats.tags) total.tags.push(...stats.tags);
      total.unknownSteps.push(...stats.unknownSteps.map((u) => ({ ...u, sheet: src.rel })));
      total.unknownExpect.push(...stats.unknownExpect.map((u) => ({ ...u, sheet: src.rel })));
      for (const e of m) map.cases.push({ ...e, spec: `${map.out}/${name}:${e.line}` });
    }
  }
  const extras = [];
  if (py) {
    fs.writeFileSync(path.join(outDir, "_casesheet.py"), runtimePy(cfg));
    fs.writeFileSync(path.join(outDir, "conftest.py"), conftestPy(total.tags));
    extras.push("_casesheet.py", "conftest.py");
  } else {
    const rtName = cfg.lang === "js" ? "_casesheet.js" : "_casesheet.ts";
    fs.writeFileSync(path.join(outDir, rtName), runtimeFor(cfg));
    extras.push(rtName);
  }
  fs.writeFileSync(path.join(outDir, "casesheet.map.json"), JSON.stringify(map, null, 2) + "\n");
  if (!o.quiet) {
    io.log(`casesheet: ${plural(total.cases, "case")}, ${plural(total.steps, "step")} → ${rel(outDir)}/ (${total.files.join(", ")}, ${extras.join(", ")}, casesheet.map.json)`);
  }
  printUnknown(total, io, cfg.strict);
  return { cfg, outDir, total };
}

function cmdBuild(o, io) {
  const { cfg, outDir } = build(o, io);
  if (!o.quiet) io.log(`next: ${cfg.lang === "py" ? `pytest ${rel(outDir)} --base-url http://localhost:3000` : `npx playwright test ${rel(outDir)}`}`);
  return 0;
}

function printUnknown(total, io, strict) {
  if (total.unknownSteps.length) {
    io.log(`\n${plural(total.unknownSteps.length, "step")} casesheet could not turn into code (marked test.fixme):`);
    for (const u of total.unknownSteps) io.log(`  [${u.id}] ${u.text}    (${u.sheet})`);
    io.log("  → rephrase with a known pattern (casesheet grammar), or define a macro or rule in casesheet.config.json");
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
        const rows = c.dataRows && c.dataRows.length > 1 ? `, ${c.dataRows.length} data rows` : "";
        io.log(`${flag} [${c.id}] ${c.title}  (${a.stepCount} steps, ${a.unknownSteps.length} unknown, ${a.unknownExpect.length} manual${rows})`);
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
  let cfg = null;
  try {
    cfg = loadConfig(o.config);
  } catch (e) {
    if (o.config) throw e;
  }
  const custom = (cfg && cfg.rules) || [];
  if (o.json) {
    io.log(JSON.stringify(rows.concat(custom.map((r) => ({ kind: "custom", id: r.name, match: r.match, flags: r.flags || "", rule: r.kind, code: r.code, py: r.py || null }))), null, 2));
    return 0;
  }
  if (custom.length) {
    io.log(`Custom rules (${rel(cfg._file)}, tried first, in order)\n`);
    for (const r of custom) io.log(`  ${r.kind.padEnd(7)} ${r.name === r.match ? "" : r.name + "  "}/${r.match}/${r.flags || ""}\n          → ${r.code.split("\n").join("\n            ")}`);
    io.log("");
  }
  io.log("Steps (actions)\n");
  for (const r of rows.filter((r) => r.kind === "action")) io.log(`  ${r.id.padEnd(14)} ${r.zh}\n  ${"".padEnd(14)} ${r.en}`);
  io.log("\nExpected results (assertions)\n");
  for (const r of rows.filter((r) => r.kind === "assert")) io.log(`  ${r.id.padEnd(14)} ${r.zh}\n  ${"".padEnd(14)} ${r.en}`);
  io.log("\nValues: {{NAME}} reads process.env.NAME. Page names (打开 登录页 / go to the login page) resolve through casesheet.config.json → routes.");
  if (!custom.length) io.log('Team shorthand: add { "rules": [{ "match": "^审批通过$", "kind": "step", "code": "await ui.click(page, \'通过\', \'button\');" }] } to casesheet.config.json.');
  return 0;
}

/** Print the per-case table (one line per case id, data rows collapsed) and the totals. */
export function printReport(rows, io) {
  const w = Math.max(2, ...rows.map((r) => r.id.length));
  const icon = { pass: "✓", fail: "✗", flaky: "~", fixme: "?", skipped: "-" };
  for (const r of rows) {
    const variants = r.rows > 1 ? ` (${r.rows} ${r.dataRows > 1 ? "data rows" : "runs"}${r.failed && r.failed.length ? `, failed: ${r.failed.join(", ")}` : ""})` : "";
    const tail = r.status === "fail" ? `  ${r.error}` : r.status === "fixme" ? `  ${r.fixme}` : r.manual.length ? `  manual: ${r.manual.join("; ")}` : "";
    io.log(`${icon[r.status] || " "} ${r.id.padEnd(w)}  ${r.status.padEnd(7)} ${r.title}${variants}${tail}`);
  }
  const s = summarize(rows);
  io.log(`\n${rows.length} cases: ` + Object.entries(s).map(([k, v]) => `${v} ${k}`).join(", "));
  return s;
}

function writeBackIfAsked(o, rows, io, outOpt) {
  if (!o.into) return;
  const r = writeBack(o.into, rows, { out: outOpt, inPlace: !!o["in-place"], sheet: o.sheet });
  io.log(`wrote ${rel(r.out)} (${plural(r.written, "row")} filled${r.unmatched.length ? `; no row for ${r.unmatched.join(", ")}` : ""})`);
}

function cmdReport(o, io) {
  const file = o._[0];
  if (!file) throw new Error("report: give the JSON results (npx playwright test --reporter=json > results.json, or casesheet run)");
  const rows = groupById(readResults(path.resolve(file)));
  if (o.csv) {
    fs.writeFileSync(path.resolve(o.csv), toCsv(rows));
    io.log(`wrote ${o.csv} (${rows.length} rows)`);
  }
  const s = printReport(rows, io);
  writeBackIfAsked(o, rows, io, o.result || o.out);
  return s.fail ? 1 : 0;
}

const canResolve = (id) => {
  try {
    createRequire(path.join(process.cwd(), "package.json")).resolve(id);
    return true;
  } catch {
    return false;
  }
};

/** User reporters are kept; json is added so results.json gets written. */
export function reporterArgs(passthrough) {
  const args = [...passthrough];
  let i = args.findIndex((a) => a === "--reporter" || a.startsWith("--reporter="));
  if (i < 0) return ["--reporter=list,json", ...args];
  const inline = args[i].includes("=");
  const value = inline ? args[i].slice("--reporter=".length) : args[i + 1] || "";
  const list = value.split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.includes("json")) list.push("json");
  args.splice(i, inline ? 1 : 2, `--reporter=${list.join(",")}`);
  return args;
}

const PW_HINT = `casesheet run needs @playwright/test in this project (it was not found from ${process.cwd()}).

  npm i -D @playwright/test && npx playwright install chromium

Then add a playwright.config.ts with use: { baseURL: 'http://localhost:3000' } so "打开 /login" knows which server to open,
or run the generated specs yourself: npx playwright test <out dir>.`;

const PY_HINT = `casesheet run --lang py needs pytest and pytest-playwright on the Python found as "python3" (set CASESHEET_PYTHON to use another one).

  python3 -m pip install pytest pytest-playwright && python3 -m playwright install chromium

Then: casesheet run cases.md --lang py -- --base-url http://localhost:3000`;

function cmdRun(o, io) {
  const spawn = io.spawnSync || spawnSync;
  const resolvable = io.canResolve || canResolve;
  const { cfg, outDir } = build(o, io, "run");
  const results = path.join(outDir, "results.json");
  fs.rmSync(results, { force: true });
  const py = cfg.lang === "py";
  let res;
  if (py) {
    const python = process.env.CASESHEET_PYTHON || (process.platform === "win32" ? "python" : "python3");
    const probe = spawn(python, ["-c", "import pytest, playwright, pytest_playwright"], { stdio: "ignore" });
    if (probe.error || probe.status !== 0) {
      io.log(PY_HINT);
      return 2;
    }
    const args = ["-m", "pytest", rel(outDir), "-p", "no:cacheprovider", ...o.passthrough];
    if (!o.quiet) io.log(`\n$ ${python} ${args.join(" ")}`);
    res = spawn(python, args, { stdio: "inherit", env: { ...process.env, CASESHEET_RESULTS: results } });
  } else {
    if (!resolvable("@playwright/test")) {
      io.log(PW_HINT);
      return 2;
    }
    const args = ["playwright", "test", rel(outDir), ...reporterArgs(o.passthrough)];
    if (!o.quiet) io.log(`\n$ npx ${args.join(" ")}`);
    res = spawn(process.platform === "win32" ? "npx.cmd" : "npx", args, { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: results } });
  }
  if (res.error) throw new Error(`could not start the test runner: ${res.error.message}`);
  if (!fs.existsSync(results)) {
    io.log(`\nno ${rel(results)} was written (runner exit code ${res.status}); nothing to report`);
    return res.status || 1;
  }
  io.log("");
  const rows = groupById(readResults(results));
  const s = printReport(rows, io);
  writeBackIfAsked(o, rows, io, o.result);
  if (res.status) return res.status;
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
    case "run":
      return cmdRun(o, io);
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
