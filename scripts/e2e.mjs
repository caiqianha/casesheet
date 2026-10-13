// End-to-end proof: generate specs from examples/login.md, run them with a real
// Playwright against examples/site, write the results back into examples/login.xlsx
// (to a copy under ./.e2e). Installs @playwright/test into ./.e2e (gitignored).
//   node scripts/e2e.mjs        TypeScript specs
//   node scripts/e2e.mjs --js   JavaScript specs
//   node scripts/e2e.mjs --py   pytest + playwright-python (venv in ./.e2e/pyenv)
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { readResults, summarize } from "../src/report.js";
import { parseXlsx } from "../src/readers/xlsx.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dir = path.join(root, ".e2e");
const bin = path.join(root, "bin", "casesheet.js");
const examples = path.join(root, "examples");
const env = { ...process.env, CASESHEET_USER: "admin", CASESHEET_PASS: "123456" };
const sh = (cmd, cwd = dir, extraEnv = {}) => {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", env: { ...env, ...extraEnv } });
};
const q = (p) => JSON.stringify(p);
fs.mkdirSync(dir, { recursive: true });

function assertOutcome(results, filled) {
  const s = summarize(readResults(results));
  console.log(`outcome: ${JSON.stringify(s)}`);
  if (s.pass !== 6 || s.fixme !== 1 || Object.keys(s).length !== 2) throw new Error(`expected 6 pass + 1 fixme, got ${JSON.stringify(s)}`);
  if (!fs.existsSync(filled)) throw new Error(`${filled} was not written`);
  const t = parseXlsx(fs.readFileSync(filled)).tables[0];
  const col = t.headers.indexOf("实际结果");
  if (col < 0) throw new Error(`no 实际结果 column in ${filled}: ${t.headers.join(" | ")}`);
  const values = t.rows.map((r) => r.cells[col]);
  console.log(`write-back: ${values.join(", ")}`);
  if (values.filter((v) => v === "PASS").length !== 6 || !values.some((v) => v.startsWith("FIXME: unrecognized step: 确认退出"))) throw new Error("write-back column does not match the run");
}

const waitFor = (url, tries = 50) =>
  new Promise((resolve, reject) => {
    const tick = () => http.get(url, (res) => (res.statusCode === 200 ? resolve() : retry())).on("error", retry);
    const retry = () => (--tries ? setTimeout(tick, 200) : reject(new Error(`${url} did not come up`)));
    tick();
  });

if (process.argv.includes("--py")) {
  const venv = path.join(dir, "pyenv");
  const python = process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
  if (!fs.existsSync(python)) {
    sh(`${process.env.PYTHON || "python3"} -m venv ${q(venv)}`);
    sh(`${q(python)} -m pip install --quiet --disable-pip-version-check pytest pytest-playwright`);
    sh(`${q(python)} -m playwright install ${process.env.CI ? "--with-deps " : ""}chromium`);
  }
  const out = path.join(dir, "pytests", "casesheet");
  fs.rmSync(out, { recursive: true, force: true });
  const filled = path.join(dir, "login.result.py.xlsx");
  fs.rmSync(filled, { force: true });
  const server = spawn("node", [path.join(examples, "serve.mjs")], { stdio: "inherit" });
  try {
    await waitFor("http://localhost:4173/login");
    sh(`node ${q(bin)} run login.md --lang py -o ${q(out)} --into login.xlsx --result ${q(filled)} -- --base-url http://localhost:4173`, examples, { CASESHEET_PYTHON: python });
    fs.copyFileSync(path.join(out, "results.json"), path.join(dir, "results.py.json"));
    assertOutcome(path.join(out, "results.json"), filled);
  } finally {
    server.kill();
  }
} else {
  if (!fs.existsSync(path.join(dir, "node_modules", "@playwright", "test"))) {
    if (!fs.existsSync(path.join(dir, "package.json"))) fs.writeFileSync(path.join(dir, "package.json"), '{ "name": "casesheet-e2e", "private": true }\n');
    sh("npm i -D @playwright/test@latest --no-audit --no-fund");
    sh(`npx playwright install ${process.env.CI ? "--with-deps " : ""}chromium`);
  }
  fs.writeFileSync(
    path.join(dir, "playwright.config.ts"),
    `import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  timeout: 20000,
  reporter: [['list'], ['json', { outputFile: 'results.json' }]],
  use: { baseURL: 'http://localhost:4173' },
  webServer: { command: 'node ${path.join(examples, "serve.mjs").replace(/\\/g, "/")}', url: 'http://localhost:4173/login', reuseExistingServer: true },
});
`,
  );
  fs.rmSync(path.join(dir, "tests"), { recursive: true, force: true });
  const lang = process.argv.includes("--js") ? "--js" : "";
  const out = path.join(dir, "tests", "casesheet");
  const filled = path.join(dir, "login.result.xlsx");
  fs.rmSync(filled, { force: true });
  // casesheet run = build + npx playwright test + report (+ write-back into a copy of the sheet)
  sh(`node ${q(bin)} run ../examples/login.md -o ${q(out)} ${lang} --config ../examples/casesheet.config.json --into ../examples/login.xlsx --result ${q(filled)}`);
  fs.copyFileSync(path.join(out, "results.json"), path.join(dir, "results.json"));
  sh(`node ${q(bin)} report results.json --csv results.csv`);
  assertOutcome(path.join(dir, "results.json"), filled);
}
