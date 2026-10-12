import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseMarkdown } from "../src/readers/markdown.js";
import { parseCsv } from "../src/readers/csv.js";
import { parseJson } from "../src/readers/json.js";
import { parseXlsx, listSheets } from "../src/readers/xlsx.js";
import { readTables } from "../src/readers/index.js";
import { mapColumns } from "../src/columns.js";
import { splitLines, alignExpected, tablesToCases } from "../src/cases.js";
import { xlsx } from "./helpers/xlsx-writer.js";

test("markdown: tables, headings, <br>, escaped pipes", () => {
  const md = `# 登录\n\n| 编号 | 步骤 | 预期 |\n|---|---|---|\n| T1 | 1. 打开 /a<br>2. 点击 A \\| B | 显示 ok |\n\n## 其它\n\n| 编号 | 步骤 |\n|:--|:--|\n| T2 | 刷新页面 |\n`;
  const { tables } = parseMarkdown(md);
  assert.equal(tables.length, 2);
  assert.equal(tables[0].heading, "登录");
  assert.deepEqual(tables[0].headers, ["编号", "步骤", "预期"]);
  assert.equal(tables[0].rows[0].cells[1], "1. 打开 /a\n2. 点击 A | B");
  assert.equal(tables[0].rows[0].line, 5);
  assert.equal(tables[1].heading, "其它");
});

test("csv: quotes, embedded newlines, BOM, delimiter detection", () => {
  const csv = '﻿ID,Steps,Expected\nT1,"1. open /a\n2. click ""Go""",see ok\nT2,reload,\n';
  const { tables } = parseCsv(csv);
  assert.deepEqual(tables[0].headers, ["ID", "Steps", "Expected"]);
  assert.equal(tables[0].rows[0].cells[1], '1. open /a\n2. click "Go"');
  assert.equal(tables[0].rows[1].line, 4);
  const tsv = parseCsv("ID\tSteps\nT1\topen /a\n");
  assert.deepEqual(tsv.tables[0].rows[0].cells, ["T1", "open /a"]);
  const semi = parseCsv("ID;Steps\nT1;open /a;\n");
  assert.deepEqual(semi.tables[0].rows[0].cells, ["T1", "open /a"]);
});

test("json: array or { cases }, arrays joined by newline", () => {
  const { tables } = parseJson(JSON.stringify({ cases: [{ id: "T1", steps: ["open /a", "click Go"], expected: "see ok" }] }));
  assert.deepEqual(tables[0].headers, ["id", "steps", "expected"]);
  assert.equal(tables[0].rows[0].cells[1], "open /a\nclick Go");
  assert.throws(() => parseJson("{}"), /array of cases/);
});

test("xlsx: shared + inline strings, deflate and stored, sheet names", () => {
  const rows = [["编号", "步骤", "预期"], ["T1", "1. 打开 /a\n2. 点击 <Go> & \"run\"", "显示 ok"], ["", "", ""], ["T2", "刷新页面", ""]];
  for (const deflate of [true, false]) {
    const buf = xlsx(rows, { sheetName: "用例表", deflate });
    assert.deepEqual(listSheets(buf), ["用例表"]);
    const { tables } = parseXlsx(buf);
    assert.deepEqual(tables[0].headers, ["编号", "步骤", "预期"]);
    assert.equal(tables[0].rows.length, 2, "blank rows are skipped");
    assert.equal(tables[0].rows[0].cells[1], '1. 打开 /a\n2. 点击 <Go> & "run"');
    assert.equal(tables[0].rows[1].line, 4);
    assert.equal(tables[0].heading, "用例表");
  }
  assert.throws(() => parseXlsx(xlsx(rows), { sheet: "nope" }), /not found/);
});

test("readTables: dispatch by extension and helpful errors", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "casesheet-"));
  fs.writeFileSync(path.join(dir, "a.md"), "| 步骤 |\n|---|\n| 刷新页面 |\n");
  fs.writeFileSync(path.join(dir, "a.xlsx"), xlsx([["Steps"], ["reload"]]));
  assert.equal(readTables(path.join(dir, "a.md")).tables[0].rows[0].cells[0], "刷新页面");
  assert.equal(readTables(path.join(dir, "a.xlsx")).tables[0].rows[0].cells[0], "reload");
  fs.writeFileSync(path.join(dir, "a.xls"), "");
  assert.throws(() => readTables(path.join(dir, "a.xls")), /save it as \.xlsx/);
  assert.throws(() => readTables(path.join(dir, "a.docx")), /unsupported/);
});

test("columns: Chinese and English headers, extras kept", () => {
  const { map, extra } = mapColumns(["用例 ID", "用例名称", "所属模块", "前置条件", "操作步骤", "预期结果", "优先级", "标签", "测试数据", "备注", "负责人"]);
  assert.deepEqual(map, { id: 0, title: 1, module: 2, precondition: 3, steps: 4, expected: 5, priority: 6, tags: 7, data: 8, notes: 9 });
  assert.deepEqual(extra, [{ name: "负责人", index: 10 }]);
  const en = mapColumns(["Case ID", "Test Case", "Feature", "Pre-conditions", "Test Steps", "Expected Result", "Pri"]);
  assert.deepEqual(en.map, { id: 0, title: 1, module: 2, precondition: 3, steps: 4, expected: 5, priority: 6 });
});

test("steps: numbering styles, one-line lists, bullets", () => {
  assert.deepEqual(splitLines("1. 打开 /a\n2、点击 B\n3）输入 C\n步骤4: 刷新").map((l) => [l.n, l.text]), [[1, "打开 /a"], [2, "点击 B"], [3, "输入 C"], [4, "刷新"]]);
  assert.deepEqual(splitLines("1.打开登录页 2.输入账号 3.点击登录").map((l) => l.text), ["打开登录页", "输入账号", "点击登录"]);
  assert.deepEqual(splitLines("打开登录页；输入账号；点击登录").map((l) => l.text), ["打开登录页", "输入账号", "点击登录"]);
  assert.deepEqual(splitLines("- open /a\n* click B").map((l) => l.text), ["open /a", "click B"]);
  assert.deepEqual(splitLines("1. 输入金额 100.00 2. 点击 提交").map((l) => l.text), ["输入金额 100.00", "点击 提交"], "decimals are not step markers");
  assert.deepEqual(splitLines("100.00 元入账").map((l) => [l.n, l.text]), [[null, "100.00 元入账"]]);
  assert.deepEqual(splitLines(""), []);
});

test("expected alignment: by number, by index, else last step", () => {
  const steps = splitLines("1. a\n2. b\n3. c");
  const byNo = alignExpected(steps, splitLines("3. z\n1. x"));
  assert.deepEqual(byNo.map((s) => s.expected), [["x"], [], ["z"]]);
  const byIdx = alignExpected(steps, splitLines("x\ny\nz"));
  assert.deepEqual(byIdx.map((s) => s.expected), [["x"], ["y"], ["z"]]);
  const last = alignExpected(steps, splitLines("x\ny"));
  assert.deepEqual(last.map((s) => s.expected), [[], [], ["x", "y"]]);
});

test("tablesToCases: module from heading, generated ids, tags split", () => {
  const { tables } = parseMarkdown("## 登录\n\n| 标题 | 步骤 | 标签 |\n|---|---|---|\n| 登录成功 | 打开 /login | smoke, 回归 |\n| | | |\n");
  const cases = tablesToCases(tables, "x.md");
  assert.equal(cases.length, 1);
  assert.equal(cases[0].module, "登录");
  assert.equal(cases[0].id, "R005");
  assert.deepEqual(cases[0].tags, ["smoke", "回归"]);
  assert.equal(cases[0].source, "x.md:5");
  assert.throws(() => tablesToCases(parseMarkdown("| a | b |\n|---|---|\n| 1 | 2 |\n").tables, "y.md"), /steps column/);
});
