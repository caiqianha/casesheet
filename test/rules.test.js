import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig, validateRules } from "../src/config.js";
import { parseStep, parseExpectation } from "../src/grammar.js";
import { emitSpec, expandTemplate, analyzeCase } from "../src/emit.js";
import { emitSpecPy } from "../src/emit-py.js";
import { parseMarkdown } from "../src/readers/markdown.js";
import { tablesToCases } from "../src/cases.js";

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const bin = path.join(root, "bin", "casesheet.js");
const run = (args, opts = {}) => {
  try {
    return { code: 0, out: execFileSync("node", [bin, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
};
const base = () => loadConfig(null, os.tmpdir());

test("config: rules are validated with the key path in the message", () => {
  assert.throws(() => validateRules({}), /"rules" must be an array/);
  assert.throws(() => validateRules(["x"]), /rules\[0\] must be an object/);
  assert.throws(() => validateRules([{ kind: "step", code: "x" }]), /rules\[0\]\.match is required/);
  assert.throws(() => validateRules([{ match: "a", kind: "step" }]), /rules\[0\]\.code is required/);
  assert.throws(() => validateRules([{ match: "a", kind: "when", code: "x" }]), /rules\[0\]\.kind must be "step" or "expect", got "when"/);
  assert.throws(() => validateRules([{ match: "a", kind: "step", code: "x" }, { match: "(", kind: "step", code: "x" }]), /rules\[1\]\.match is not a valid regular expression/);
  assert.throws(() => validateRules([{ match: "a", kind: "step", code: "x", regex: "y" }]), /rules\[0\]\.regex is not a rule option/);
  assert.throws(() => validateRules([{ match: "a", kind: "step", code: "x", flags: 1 }]), /rules\[0\]\.flags must be a string/);
  const ok = validateRules([{ match: "^a$", flags: "i", kind: "step", code: "x" }]);
  assert.equal(ok[0].name, "^a$");
  assert.ok(ok[0].re.test("A"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-rules-"));
  fs.writeFileSync(path.join(dir, "casesheet.config.json"), JSON.stringify({ rules: [{ match: "(", kind: "step", code: "x" }] }));
  assert.throws(() => loadConfig(null, dir), /casesheet\.config\.json: rules\[0\]\.match is not a valid regular expression/);
  fs.writeFileSync(path.join(dir, "casesheet.config.json"), JSON.stringify({ lang: "rb" }));
  assert.throws(() => loadConfig(null, dir), /"lang" must be one of ts, js, py/);
});

test("custom rules are tried before the built-in grammar, in order, for steps and expectations", () => {
  const rules = validateRules([
    { name: "approve", match: "^审批通过\\s*(.+)$", kind: "step", code: "await ui.click(page, $1, 'link');" },
    { name: "loginBtn", match: "^点击 登录 按钮$", kind: "step", code: "await page.click('#b');" },
    { name: "toast", match: "^toast (.+)$", flags: "i", kind: "expect", code: "await expect(page.locator('.toast')).toHaveText($1);" },
  ]);
  const a = parseStep("审批通过 单号 A-1", rules);
  assert.equal(a.type, "custom");
  assert.equal(a.name, "approve");
  assert.deepEqual(a.groups, ["审批通过 单号 A-1", "单号 A-1"]);
  assert.equal(parseStep("点击 登录 按钮", rules).rule, "custom:loginBtn", "custom wins over the built-in click rule");
  assert.equal(parseStep("点击 登录 按钮").rule, "click", "without rules the grammar is unchanged");
  assert.equal(parseExpectation("TOAST saved", rules).name, "toast");
  assert.equal(parseStep("TOAST saved", rules).name, "toast", "expect rules also match in the steps column");
  assert.equal(parseStep("点击 保存", rules).rule, "click");
});

test("templates: $1 is a string literal (env placeholders kept), $1raw is verbatim, multi-line code", () => {
  assert.deepEqual(expandTemplate("await ui.click(page, $1, 'link');", ["", "A-1"]), ["await ui.click(page, 'A-1', 'link');"]);
  assert.deepEqual(expandTemplate("await x($1);", ["", "{{USER}}"]), ["await x(`${ui.env('USER')}`);"]);
  assert.deepEqual(expandTemplate("await page.waitForTimeout($1raw);\nawait page.click($2);", ["", "500", "it's"]), ["await page.waitForTimeout(500);", "await page.click('it\\'s');"]);
  assert.deepEqual(expandTemplate("a($3)", ["", "x"]), ["a('')"], "missing group is an empty string");
});

test("emitSpec / check count custom-rule matches as recognised; grammar lists them", () => {
  const md = "| 编号 | 步骤 | 预期 |\n|---|---|---|\n| T1 | 1. 打开 /a<br>2. 审批通过 单号 {{NO}} | toast 已通过 |\n";
  const cases = tablesToCases(parseMarkdown(md).tables, "r.md");
  const cfg = { ...base(), rules: validateRules([
    { name: "approve", match: "^审批通过\\s*(.+)$", kind: "step", code: "await ui.click(page, $1, 'link');\nawait ui.click(page, '通过', 'button');", py: "ui.click(page, $1, \"link\")\nui.click(page, \"通过\", \"button\")" },
    { match: "^toast (.+)$", kind: "expect", code: "await expect(page.locator('.toast')).toHaveText($1);" },
  ]) };
  const a = analyzeCase(cases[0], cfg);
  assert.deepEqual(a.unknownSteps, []);
  assert.deepEqual(a.unknownExpect, []);
  const { source, stats } = emitSpec(cases, cfg, { sourceRel: "r.md" });
  assert.equal(stats.fixme, 0);
  assert.equal(stats.manual, 0);
  assert.match(source, /await test\.step\('2\. 审批通过 单号 \{\{NO\}\}', async \(\) => \{\n      await ui\.click\(page, `单号 \$\{ui\.env\('NO'\)\}`, 'link'\);\n      await ui\.click\(page, '通过', 'button'\);\n    \}\);/);
  assert.match(source, /await expect\(page\.locator\('\.toast'\)\)\.toHaveText\('已通过'\);/);
  const py = emitSpecPy(cases, { ...cfg, lang: "py" }, { sourceRel: "r.md" });
  assert.match(py.source, /with ui\.step\("2\. 审批通过 单号 \{\{NO\}\}"\):\n        ui\.click\(page, f"单号 \{ui\.env\('NO'\)\}", "link"\)\n        ui\.click\(page, "通过", "button"\)/);
  assert.match(py.source, /ui\.manual\(record_property, "toast 已通过"\)/, "a rule without a py template is not automated in Python");
  assert.equal(py.stats.manual, 1);
  const pyStep = emitSpecPy(tablesToCases(parseMarkdown("| 步骤 |\n|---|\n| toast x |\n").tables, "p.md"), { ...cfg, lang: "py" }, { sourceRel: "p.md" });
  assert.match(pyStep.source, /ui\.fixme\(record_property, "custom rule \\"\^toast \(\.\+\)\$\\" has no \\"py\\" template in casesheet\.config\.json"\)/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-rules-cli-"));
  fs.writeFileSync(path.join(dir, "r.md"), md);
  fs.writeFileSync(path.join(dir, "casesheet.config.json"), JSON.stringify({ rules: [{ name: "approve", match: "^审批通过\\s*(.+)$", kind: "step", code: "await ui.click(page, $1, 'link');" }, { match: "^toast (.+)$", kind: "expect", code: "await expect(page.locator('.toast')).toHaveText($1);" }] }));
  let r = run(["check", "r.md"], { cwd: dir });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /2\/2 steps recognised, 0 expectations left to manual check/);
  r = run(["check", path.join(dir, "r.md"), "--config", path.join(root, "examples", "casesheet.config.json")], { cwd: root });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1 expectations? left to manual check/, "the example config has no toast rule");
  r = run(["grammar"], { cwd: dir });
  assert.equal(r.code, 0);
  assert.match(r.out, /^Custom rules \(casesheet\.config\.json, tried first, in order\)\n\n  step    approve  \/\^审批通过\\s\*\(\.\+\)\$\/\n          → await ui\.click\(page, \$1, 'link'\);\n  expect  \/\^toast \(\.\+\)\$\//);
  assert.match(r.out, /Steps \(actions\)/);
  r = run(["grammar", "--json"], { cwd: dir });
  const custom = JSON.parse(r.out).filter((x) => x.kind === "custom");
  assert.deepEqual(custom.map((x) => [x.id, x.rule]), [["approve", "step"], ["^toast (.+)$", "expect"]]);
  r = run(["grammar"], { cwd: root });
  assert.doesNotMatch(r.out, /Custom rules/);
  assert.match(r.out, /Team shorthand: add \{ "rules"/);
});
