import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseDataRows, caseVariants, substitute, tablesToCases } from "../src/cases.js";
import { parseMarkdown } from "../src/readers/markdown.js";
import { emitSpec, testTitle } from "../src/emit.js";
import { emitSpecPy } from "../src/emit-py.js";
import { loadConfig } from "../src/config.js";
import { readResults, groupById, summarize } from "../src/report.js";

const cfg = () => loadConfig(null, os.tmpdir());

test("parseDataRows: k=v lines, JSON lines, Chinese separators; free text is not data", () => {
  assert.deepEqual(parseDataRows("user=admin; pass=123456\nuser=bob; pass=000000").map((r) => r.vars), [{ user: "admin", pass: "123456" }, { user: "bob", pass: "000000" }]);
  assert.deepEqual(parseDataRows('{"user":"a","n":1}<br>user: b；pass：c').map((r) => r.vars), [{ user: "a", n: "1" }, { user: "b", pass: "c" }]);
  assert.deepEqual(parseDataRows("url=http://x/a?b=1").map((r) => r.vars), [{ url: "http://x/a?b=1" }]);
  assert.deepEqual(parseDataRows("测试账号\n密码 123"), []);
  assert.deepEqual(parseDataRows("user=a\n{bad json"), []);
  assert.deepEqual(parseDataRows(""), []);
  assert.equal(substitute("输入 用户名 {{ user }} / {{PASS}}", { user: "admin" }), "输入 用户名 admin / {{PASS}}");
});

test("caseVariants: one case per data row with placeholders resolved; single row unchanged", () => {
  const md = "# 登录\n\n| 编号 | 标题 | 步骤 | 预期 | 测试数据 |\n|---|---|---|---|---|\n| T1 | 用 {{user}} 登录 | 1. 打开 /login<br>2. 输入 用户名 {{user}}<br>3. 输入 密码 {{pass}} | 显示 {{msg}} | user=admin; pass=123456; msg=欢迎<br>user=bob; pass={{BOB_PASS}}; msg=错误 |\n| T2 | 单行 | 打开 /a | 显示 ok | user=admin |\n";
  const cases = tablesToCases(parseMarkdown(md).tables, "d.md");
  assert.equal(cases[0].dataRows.length, 2);
  const v = caseVariants(cases[0]);
  assert.deepEqual(v.map((x) => [x.variant, x.title, x.data]), [["1/2", "用 admin 登录", "user=admin; pass=123456; msg=欢迎"], ["2/2", "用 bob 登录", "user=bob; pass={{BOB_PASS}}; msg=错误"]]);
  assert.deepEqual(v[1].steps.map((s) => s.text), ["打开 /login", "输入 用户名 bob", "输入 密码 {{BOB_PASS}}"]);
  assert.deepEqual(v[0].steps[2].expected, ["显示 欢迎"]);
  assert.equal(testTitle(v[0]), "[T1] 用 admin 登录 (1/2)");
  assert.deepEqual(caseVariants(cases[1]).map((x) => [x.variant, x.title, x.data]), [["", "单行", "user=admin"]]);
});

test("emitSpec: data rows become separate tests, env placeholders still go through ui.env, map groups by id", () => {
  const md = "| 编号 | 标题 | 步骤 | 预期 | 数据 |\n|---|---|---|---|---|\n| T1 | 登录 | 1. 打开 /login<br>2. 输入 用户名 {{user}}<br>3. 输入 密码 {{pass}} | 显示 {{msg}} | user=admin; pass=123456; msg=欢迎<br>user=bob; pass={{BOB_PASS}}; msg=错误 |\n| T2 | 单行 | 打开 /a | 显示 ok | user=admin |\n";
  const cases = tablesToCases(parseMarkdown(md).tables, "d.md");
  const { source, map, stats } = emitSpec(cases, cfg(), { sourceRel: "d.md" });
  assert.match(source, /test\('\[T1\] 登录 \(1\/2\)', \{ tag: \[\], annotation: \[\{ type: 'source', description: 'd\.md:3' \}, \{ type: 'data', description: 'user=admin; pass=123456; msg=欢迎' \}\] \}/);
  assert.match(source, /test\('\[T1\] 登录 \(2\/2\)'/);
  assert.match(source, /await ui\.fill\(page, '用户名', 'admin'\);/);
  assert.match(source, /await ui\.fill\(page, '密码', `\$\{ui\.env\('BOB_PASS'\)\}`\);/, "row first, then env");
  assert.match(source, /toBeVisible\(\)/);
  assert.match(source, /ui\.text\(page, '错误'\)/);
  assert.match(source, /test\('\[T2\] 单行', \{ tag: \[\], annotation: \[\{ type: 'source', description: 'd\.md:4' \}, \{ type: 'data', description: 'user=admin' \}\] \}/, "single row keeps the old behaviour");
  assert.equal(stats.cases, 2);
  assert.equal(stats.steps, 4, "steps are counted once per case, not per data row");
  assert.equal(map.length, 2);
  assert.equal(map[0].id, "T1");
  assert.deepEqual(map[0].variants.map((v) => v.data), ["1/2", "2/2"]);
  assert.equal(map[0].line, map[0].variants[0].line);
  assert.equal(map[1].variants, undefined);
  const py = emitSpecPy(cases, { ...cfg(), lang: "py" }, { sourceRel: "d.md" });
  assert.match(py.source, /def test_t1_登录_1\(page: Page, record_property\):/);
  assert.match(py.source, /def test_t1_登录_2\(page: Page, record_property\):/);
  assert.match(py.source, /title="\[T1\] 登录 \(2\/2\)"/);
  assert.match(py.source, /ui\.fill\(page, "密码", f"\{ui\.env\('BOB_PASS'\)\}"\)/);
  assert.deepEqual(py.map[0].variants.map((v) => v.data), ["1/2", "2/2"]);
});

test("report: variant titles are read back and grouped under the base id, worst status wins", () => {
  const spec = (title, status, error) => ({ title, file: "d.spec.ts", tests: [{ status, annotations: [{ type: "source", description: "d.md:3" }], results: [{ status: status === "expected" ? "passed" : "failed", duration: 10, ...(error ? { error: { message: error } } : {}) }] }] });
  const json = { suites: [{ title: "d.spec.ts", suites: [{ title: "登录", specs: [spec("[T1] 登录 (1/3)", "expected"), spec("[T1] 登录 (2/3)", "unexpected", "Error: boom\n  at x"), spec("[T1] 登录 (3/3)", "expected"), spec("[T2] 单行", "expected")] }] }] };
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cs-data-")), "results.json");
  fs.writeFileSync(f, JSON.stringify(json));
  const rows = readResults(f);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.slice(0, 3).map((r) => [r.id, r.title, r.variant, r.status]), [["T1", "登录", "1/3", "pass"], ["T1", "登录", "2/3", "fail"], ["T1", "登录", "3/3", "pass"]]);
  assert.equal(rows[3].variant, "");
  const g = groupById(rows);
  assert.equal(g.length, 2);
  assert.equal(g[0].id, "T1");
  assert.equal(g[0].status, "fail");
  assert.equal(g[0].error, "Error: boom");
  assert.equal(g[0].rows, 3);
  assert.equal(g[0].dataRows, 3);
  assert.deepEqual(g[0].failed, ["2/3"]);
  assert.equal(g[0].durationMs, 30);
  assert.equal(g[0].module, "登录");
  assert.deepEqual(summarize(g), { fail: 1, pass: 1 });
  assert.deepEqual(summarize(rows), { pass: 3, fail: 1 });
});
