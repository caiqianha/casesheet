import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main, reporterArgs } from "../src/cli.js";
import { parseXlsx } from "../src/readers/xlsx.js";

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const fixture = path.join(root, "test", "fixtures", "results.json");
const sheet = path.join(root, "examples", "login.md");

function fakeIo({ status = 0, write = true, probe = 0 } = {}) {
  const calls = [];
  const log = [];
  return {
    calls,
    log,
    io: {
      log: (s) => log.push(String(s)),
      canResolve: () => true,
      spawnSync: (cmd, args, opts) => {
        calls.push({ cmd, args, opts });
        if (args[0] === "-c") return { status: probe };
        const results = opts.env.PLAYWRIGHT_JSON_OUTPUT_NAME || opts.env.CASESHEET_RESULTS;
        if (write) fs.copyFileSync(fixture, results);
        return { status };
      },
    },
  };
}

test("reporterArgs keeps the user's reporters and adds json", () => {
  assert.deepEqual(reporterArgs([]), ["--reporter=list,json"]);
  assert.deepEqual(reporterArgs(["--grep", "@P0"]), ["--reporter=list,json", "--grep", "@P0"]);
  assert.deepEqual(reporterArgs(["--reporter=dot", "--headed"]), ["--reporter=dot,json", "--headed"]);
  assert.deepEqual(reporterArgs(["--reporter", "html,json"]), ["--reporter=html,json"]);
});

test("run: builds, invokes npx playwright test with a json reporter, prints the report, writes back", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-run-"));
  const xlsx = path.join(dir, "cases.xlsx");
  fs.copyFileSync(path.join(root, "examples", "login.xlsx"), xlsx);
  const out = path.join(dir, "out");
  const f = fakeIo();
  const code = await main(["run", sheet, "-o", out, "--config", path.join(root, "examples", "casesheet.config.json"), "--into", xlsx, "--result", path.join(dir, "filled.xlsx"), "--", "--grep", "@P0", "--reporter=dot"], f.io);
  assert.equal(code, 0, f.log.join("\n"));
  assert.ok(fs.existsSync(path.join(out, "login.spec.ts")));
  assert.equal(f.calls.length, 1);
  const [call] = f.calls;
  assert.match(call.cmd, /^npx(\.cmd)?$/);
  assert.deepEqual(call.args, ["playwright", "test", out, "--grep", "@P0", "--reporter=dot,json"], "out dir outside cwd stays absolute; the user's reporter list gains json");
  assert.equal(call.opts.env.PLAYWRIGHT_JSON_OUTPUT_NAME, path.join(out, "results.json"));
  assert.equal(call.opts.stdio, "inherit");
  const text = f.log.join("\n");
  assert.match(text, /\$ npx playwright test .*--grep @P0 --reporter=dot,json/);
  assert.match(text, /\? TC-011  fixme   退出登录  unrecognized step: 确认退出/);
  assert.match(text, /7 cases: 6 pass, 1 fixme/);
  assert.match(text, /wrote .*filled\.xlsx \(7 rows filled\)/);
  const t = parseXlsx(fs.readFileSync(path.join(dir, "filled.xlsx"))).tables[0];
  assert.equal(t.rows[0].cells.at(-1), "PASS");
  assert.ok(fs.existsSync(xlsx), "input sheet is still there");
  assert.equal(fs.readFileSync(xlsx).length, fs.readFileSync(path.join(root, "examples", "login.xlsx")).length, "and untouched");
});

test("run: exit code mirrors the runner; missing results is reported", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-run-"));
  let f = fakeIo({ status: 1 });
  assert.equal(await main(["run", sheet, "-o", path.join(dir, "a"), "--quiet"], f.io), 1);
  assert.match(f.log.join("\n"), /7 cases: 6 pass, 1 fixme/);
  f = fakeIo({ status: 130, write: false });
  assert.equal(await main(["run", sheet, "-o", path.join(dir, "b"), "--quiet"], f.io), 130);
  assert.match(f.log.join("\n"), /no .*results\.json was written \(runner exit code 130\)/);
});

test("run: @playwright/test missing → one-screen hint and exit 2, runner not started", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-run-"));
  const f = fakeIo();
  f.io.canResolve = () => false;
  assert.equal(await main(["run", sheet, "-o", dir, "--quiet"], f.io), 2);
  assert.equal(f.calls.length, 0);
  assert.match(f.log.join("\n"), /npm i -D @playwright\/test && npx playwright install chromium/);
});

test("run --lang py: probes python, runs pytest with CASESHEET_RESULTS, hints when pytest is missing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-run-py-"));
  let f = fakeIo();
  const out = path.join(dir, "py");
  const code = await main(["run", sheet, "--lang", "py", "-o", out, "--", "--base-url", "http://localhost:4173"], f.io);
  assert.equal(code, 0, f.log.join("\n"));
  for (const n of ["test_login.py", "_casesheet.py", "conftest.py", "casesheet.map.json"]) assert.ok(fs.existsSync(path.join(out, n)), n);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[0].args, ["-c", "import pytest, playwright, pytest_playwright"]);
  assert.deepEqual(f.calls[1].args, ["-m", "pytest", out, "-p", "no:cacheprovider", "--base-url", "http://localhost:4173"]);
  assert.equal(f.calls[1].opts.env.CASESHEET_RESULTS, path.join(out, "results.json"));
  assert.match(f.log.join("\n"), /7 cases: 6 pass, 1 fixme/);
  f = fakeIo({ probe: 1 });
  assert.equal(await main(["run", sheet, "--lang", "py", "-o", path.join(dir, "py2"), "--quiet"], f.io), 2);
  assert.equal(f.calls.length, 1);
  assert.match(f.log.join("\n"), /pip install pytest pytest-playwright/);
});
