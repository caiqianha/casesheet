import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readZip } from "../src/readers/zip.js";
import { parseXlsx } from "../src/readers/xlsx.js";
import { readTables } from "../src/readers/index.js";
import { writeZip, crc32 } from "../src/writers/zip.js";
import { patchSheetXml, patchXlsx, colName } from "../src/writers/xlsx.js";
import { patchCsv } from "../src/writers/csv.js";
import { patchMarkdown } from "../src/writers/markdown.js";
import { writeBack, resultPath, actualText } from "../src/writeback.js";
import { readResults, groupById } from "../src/report.js";
import { zip } from "./helpers/xlsx-writer.js";

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const fixture = path.join(root, "test", "fixtures", "results.json");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cs-wb-"));

function sampleRows() {
  const rows = groupById(readResults(fixture));
  const tc2 = rows.find((r) => r.id === "TC-002");
  tc2.status = "fail";
  tc2.error = "Error: expect(locator).toBeVisible() failed";
  return rows;
}

test("zip writer: round-trips through the reader, valid CRC, stored and deflated", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  const entries = new Map([["a.txt", Buffer.from("hello hello hello hello hello")], ["b.bin", Buffer.from([1, 2, 3])], ["dir/c.xml", Buffer.from("<x/>")]]);
  const buf = writeZip(entries);
  const back = readZip(buf);
  assert.deepEqual([...back.keys()], ["a.txt", "b.bin", "dir/c.xml"]);
  for (const [k, v] of entries) assert.ok(back.get(k).equals(v), k);
  assert.ok(writeZip(entries).equals(buf), "deterministic output");
});

test("patchSheetXml: replaces cells keeping style, adds cells and rows in order, fixes dimension and spans", () => {
  const xml = `<?xml version="1.0"?><worksheet><dimension ref="A1:C2"/><sheetData><row r="1" spans="1:3"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" s="2" t="s"><v>2</v></c></row><row r="2" spans="1:3"><c r="A2" t="s"><v>3</v></c><c r="C2" s="2"/></row><row r="4"><c r="A4" t="inlineStr"><is><t>x</t></is></c></row></sheetData><pageMargins left="0.7"/></worksheet>`;
  const cells = new Map([
    [1, new Map([[3, "实际结果"]])],
    [2, new Map([[2, "PASS"], [3, "ok"]])],
    [3, new Map([[0, "new row"]])],
    [5, new Map([[1, "tail <&>"]])],
  ]);
  const out = patchSheetXml(xml, cells);
  assert.match(out, /<dimension ref="A1:D5"\/>/);
  assert.match(out, /<row r="1"><c r="A1" t="s"><v>0<\/v><\/c><c r="B1" t="s"><v>1<\/v><\/c><c r="C1" s="2" t="s"><v>2<\/v><\/c><c r="D1" t="inlineStr"><is><t xml:space="preserve">实际结果<\/t><\/is><\/c><\/row>/);
  assert.match(out, /<row r="2"><c r="A2" t="s"><v>3<\/v><\/c><c r="C2" s="2" t="inlineStr"><is><t xml:space="preserve">PASS<\/t><\/is><\/c><c r="D2" t="inlineStr">/, "existing styled cell is reused");
  assert.match(out, /<\/row><row r="3"><c r="A3" t="inlineStr"><is><t xml:space="preserve">new row<\/t><\/is><\/c><\/row><row r="4">/, "missing row inserted in order");
  assert.match(out, /<row r="5"><c r="B5" t="inlineStr"><is><t xml:space="preserve">tail &lt;&amp;&gt;<\/t><\/is><\/c><\/row><\/sheetData><pageMargins/);
  assert.doesNotMatch(out, /spans=/);
  assert.equal(colName(0), "A");
  assert.equal(colName(27), "AB");
});

test("xlsx write-back into examples/login.xlsx: values re-read, other entries byte-identical", () => {
  const src = path.join(root, "examples", "login.xlsx");
  const dir = tmp();
  const rows = sampleRows();
  const r = writeBack(src, rows, { out: path.join(dir, "out.xlsx") });
  assert.equal(r.written, 7);
  assert.deepEqual(r.unmatched, []);
  const before = readZip(fs.readFileSync(src));
  const after = readZip(fs.readFileSync(r.out));
  assert.deepEqual([...after.keys()], [...before.keys()]);
  for (const [k, v] of before) if (k !== "xl/worksheets/sheet1.xml") assert.ok(after.get(k).equals(v), `${k} unchanged`);
  assert.ok(!after.get("xl/worksheets/sheet1.xml").equals(before.get("xl/worksheets/sheet1.xml")));
  const { tables } = parseXlsx(fs.readFileSync(r.out));
  assert.equal(tables[0].headers[tables[0].headers.length - 1], "实际结果");
  const col = tables[0].headers.length - 1;
  const byId = Object.fromEntries(tables[0].rows.map((row) => [row.cells[1], row.cells[col]]));
  assert.equal(byId["TC-001"], "PASS");
  assert.equal(byId["TC-002"], "FAIL: Error: expect(locator).toBeVisible() failed");
  assert.equal(byId["TC-011"], "FIXME: unrecognized step: 确认退出");
  assert.equal(tables[0].rows.length, 7, "no rows added or lost");
  // the original is untouched and the default output name gets .result
  assert.ok(readZip(fs.readFileSync(src)).get("xl/worksheets/sheet1.xml").equals(before.get("xl/worksheets/sheet1.xml")));
  assert.equal(resultPath("/x/用例.xlsx"), path.join("/x", "用例.result.xlsx"));
  assert.throws(() => writeBack(src, rows, { out: src }), /--in-place/);
  const copy = path.join(dir, "copy.xlsx");
  fs.copyFileSync(src, copy);
  const ip = writeBack(copy, rows, { inPlace: true });
  assert.equal(ip.out, copy);
  assert.equal(parseXlsx(fs.readFileSync(copy)).tables[0].rows[0].cells[col], "PASS");
});

test("xlsx write-back reuses existing actual / status columns and fills the status column too", () => {
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:D3"/><sheetData><row r="1" spans="1:4"><c r="A1" t="inlineStr"><is><t>编号</t></is></c><c r="B1" t="inlineStr"><is><t>步骤</t></is></c><c r="C1" t="inlineStr"><is><t>实际结果</t></is></c><c r="D1" t="inlineStr"><is><t>状态</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>TC-001</t></is></c><c r="B2" t="inlineStr"><is><t>刷新页面</t></is></c><c r="C2" s="1" t="inlineStr"><is><t>old</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>TC-002</t></is></c><c r="B3" t="inlineStr"><is><t>刷新页面</t></is></c></row></sheetData></worksheet>`;
  const files = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="用例" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ["xl/worksheets/sheet1.xml", sheet],
  ];
  const dir = tmp();
  const src = path.join(dir, "cases.xlsx");
  fs.writeFileSync(src, zip(files, { deflate: true }));
  const rows = [
    { id: "TC-001", status: "pass", error: "", fixme: "", manual: [] },
    { id: "TC-002", status: "fixme", error: "", fixme: "unrecognized step: x", manual: [] },
    { id: "TC-999", status: "pass", error: "", fixme: "", manual: [] },
  ];
  const r = writeBack(src, rows);
  assert.equal(r.out, path.join(dir, "cases.result.xlsx"));
  assert.equal(r.written, 2);
  assert.deepEqual(r.unmatched, ["TC-999"]);
  const { tables } = parseXlsx(fs.readFileSync(r.out));
  assert.deepEqual(tables[0].headers, ["编号", "步骤", "实际结果", "状态"], "no column added");
  assert.deepEqual(tables[0].rows.map((x) => x.cells), [["TC-001", "刷新页面", "PASS", "PASS"], ["TC-002", "刷新页面", "FIXME: unrecognized step: x", "FIXME"]]);
  const xml = readZip(fs.readFileSync(r.out)).get("xl/worksheets/sheet1.xml").toString();
  assert.match(xml, /<c r="C2" s="1" t="inlineStr">/, "cell style kept");
  assert.match(xml, /<dimension ref="A1:D3"\/>/);
  assert.equal(actualText({ status: "fail", error: "boom", failed: ["2/3"] }), "FAIL: boom (2/3)");
  assert.equal(actualText({ status: "flaky" }), "FLAKY");
  assert.equal(actualText({ status: "skipped" }), "SKIPPED");
});

test("csv write-back: appends Actual or reuses an existing column, keeps delimiter and BOM", () => {
  const dir = tmp();
  const rows = sampleRows();
  const r = writeBack(path.join(root, "examples", "login.en.csv"), rows, { out: path.join(dir, "en.csv") });
  assert.equal(r.written, 5);
  assert.deepEqual(r.unmatched, ["TC-010", "TC-011"]);
  const t = readTables(r.out).tables[0];
  assert.deepEqual(t.headers, ["ID", "Title", "Priority", "Precondition", "Steps", "Expected", "Actual"]);
  assert.equal(t.rows[0].cells[6], "PASS");
  assert.equal(t.rows[1].cells[6], "FAIL: Error: expect(locator).toBeVisible() failed");
  assert.equal(t.rows[0].cells[4], "1. open /login\n2. fill username with admin\n3. type \"123456\" into the password field\n4. click the Login button", "quoted multi-line cells survive");
  const src = path.join(dir, "s.tsv");
  fs.writeFileSync(src, "﻿编号\t步骤\t实际结果\r\nTC-001\t刷新页面\told\r\nTC-002\t刷新页面\t\r\n");
  const r2 = writeBack(src, rows);
  const text = fs.readFileSync(r2.out, "utf8");
  assert.equal(text, "﻿编号\t步骤\t实际结果\r\nTC-001\t刷新页面\tPASS\r\nTC-002\t刷新页面\tFAIL: Error: expect(locator).toBeVisible() failed\r\n");
  assert.equal(patchCsv("a,b\n1,2\n", new Map([[2, new Map([[1, 'x,"y"']])]])), 'a,b\n1,"x,""y"""\n');
});

test("markdown write-back: every table gets the column, untouched lines stay identical", () => {
  const dir = tmp();
  const rows = sampleRows();
  const src = path.join(root, "examples", "login.md");
  const r = writeBack(src, rows, { out: path.join(dir, "login.md") });
  assert.equal(r.written, 7);
  const before = fs.readFileSync(src, "utf8").split("\n");
  const after = fs.readFileSync(r.out, "utf8").split("\n");
  assert.equal(after.length, before.length);
  before.forEach((l, i) => {
    if (!l.includes("|")) assert.equal(after[i], l, `line ${i + 1}`);
  });
  const { tables } = readTables(r.out);
  assert.equal(tables.length, 2);
  assert.equal(tables[0].headers.at(-1), "实际结果");
  assert.equal(tables[1].headers.at(-1), "实际结果");
  assert.equal(tables[0].rows[1].cells.at(-1), "FAIL: Error: expect(locator).toBeVisible() failed");
  assert.equal(tables[1].rows[1].cells.at(-1), "FIXME: unrecognized step: 确认退出");
  assert.equal(tables[0].rows[0].cells[4], before[4].split("|")[5].trim().replace(/<br>/g, "\n"), "other cells untouched");
  const md = "# t\n\n| 编号 | 步骤 | 实际结果 |\n|---|---|---|\n| TC-001 | 刷新页面 | old |\n| TC-002 | 刷新页面 | |\n\ntext after\n";
  const out = patchMarkdown(md, new Map([[5, new Map([[2, "PASS"]])], [6, new Map([[2, "a|b\nc"]])]]));
  assert.equal(out, "# t\n\n| 编号 | 步骤 | 实际结果 |\n|---|---|---|\n| TC-001 | 刷新页面 | PASS |\n| TC-002 | 刷新页面 | a\\|b<br>c |\n\ntext after\n");
  assert.equal(readTables(path.join(dir, "x.md"), fs.writeFileSync(path.join(dir, "x.md"), out)).tables[0].rows[1].cells[2], "a|b\nc");
});

test("report --into via the CLI writes next to the sheet by default", async () => {
  const { main } = await import("../src/cli.js");
  const dir = tmp();
  const sheet = path.join(dir, "用例.xlsx");
  fs.copyFileSync(path.join(root, "examples", "login.xlsx"), sheet);
  const log = [];
  const code = await main(["report", fixture, "--into", sheet], { log: (s) => log.push(s) });
  assert.equal(code, 0);
  assert.ok(fs.existsSync(path.join(dir, "用例.result.xlsx")));
  assert.match(log.join("\n"), /7 rows filled/);
  assert.match(log.join("\n"), /7 cases: 6 pass, 1 fixme/);
  const t = parseXlsx(fs.readFileSync(path.join(dir, "用例.result.xlsx"))).tables[0];
  assert.equal(t.rows[6].cells.at(-1), "FIXME: unrecognized step: 确认退出");
});
