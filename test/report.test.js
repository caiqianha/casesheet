import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readResults, toCsv, summarize, firstLine } from "../src/report.js";

const fixture = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "results.json");

test("report: rows keyed by [ID], statuses, fixme reason, csv", () => {
  const rows = readResults(fixture);
  assert.equal(rows.length, 7);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId["TC-001"].status, "pass");
  assert.equal(byId["TC-001"].module, "登录模块");
  assert.equal(byId["TC-001"].title, "正确账号密码登录成功");
  assert.equal(byId["TC-011"].status, "fixme");
  assert.match(byId["TC-011"].fixme, /unrecognized step: 确认退出/);
  assert.deepEqual(summarize(rows), { pass: 6, fixme: 1 });
  const csv = toCsv(rows);
  assert.match(csv, /^id,module,title,status,duration_ms,error,manual_checks,file\n/);
  assert.match(csv, /TC-011,个人中心,退出登录,fixme/);
});

test("firstLine strips ANSI and blank lines", () => {
  assert.equal(firstLine("\n\u001b[31mError: boom\u001b[0m\n  at x"), "Error: boom");
});
