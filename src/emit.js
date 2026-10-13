// Case AST → Playwright spec source.
import path from "node:path";
import { parseStep, parseExpectation } from "./grammar.js";
import { expandMacros } from "./config.js";
import { caseVariants } from "./cases.js";
import { RUNTIME_TS, toJs } from "./runtime.js";

const sq = (s) => "'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n") + "'";
const tl = (s) => String(s).replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${").replace(/\n/g, "\\n");

/** String literal; `{{VAR}}` becomes an environment lookup. */
export function lit(value) {
  const s = String(value ?? "");
  if (!/\{\{\s*[A-Za-z_][\w.-]*\s*\}\}/.test(s)) return sq(s);
  const parts = s.split(/(\{\{\s*[A-Za-z_][\w.-]*\s*\}\})/g);
  return "`" + parts.map((p) => {
    const m = /^\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}$/.exec(p);
    return m ? "${ui.env(" + sq(m[1]) + ")}" : tl(p);
  }).join("") + "`";
}

const roleArg = (kind) => (kind ? ", " + sq(kind) : "");

/** Custom-rule template: $1 → group as a string literal (lit), $1raw → group text verbatim. */
export function expandTemplate(tpl, groups, literal = lit) {
  return String(tpl)
    .replace(/\$(\d+)(raw)?/g, (_, n, raw) => (raw ? groups[Number(n)] ?? "" : literal(groups[Number(n)] ?? "")))
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l, i, a) => l || (i > 0 && i < a.length - 1));
}

export function codeFor(ast, ctx) {
  const routes = ctx.routes || {};
  switch (ast.type) {
    case "goto":
      if (ast.isUrl) return [`await page.goto(${lit(ast.target)});`];
      if (ast.target in routes) return [`await page.goto(${sq(routes[ast.target])});`];
      return [`await ui.open(page, ${sq(ast.target)});`];
    case "fill":
      return [`await ui.fill(page, ${sq(ast.field)}, ${lit(ast.value)});`];
    case "click": {
      const opts = ast.dbl ? ", { clickCount: 2 }" : ast.right ? ", { button: 'right' }" : "";
      if (opts && !ast.kind) return [`await ui.click(page, ${sq(ast.target)}, null${opts});`];
      return [`await ui.click(page, ${sq(ast.target)}${roleArg(ast.kind)}${opts});`];
    }
    case "press":
      return [`await page.keyboard.press(${sq(ast.key)});`];
    case "select":
      return [`await ui.select(page, ${sq(ast.field)}, ${lit(ast.option)});`];
    case "check":
      return [`await ui.check(page, ${sq(ast.label)}, ${ast.checked});`];
    case "hover":
      return [`await (await ui.pickAny(page, ${sq(ast.target)})).hover();`];
    case "upload":
      return [`await ui.upload(page, ${ast.field ? sq(ast.field) : "null"}, ${lit(ast.file)});`];
    case "wait":
      return [`await page.waitForTimeout(${ast.ms});`];
    case "waitVisible":
      return [`await expect(ui.text(page, ${sq(ast.text)})).toBeVisible({ timeout: 15000 });`];
    case "reload":
      return ["await page.reload();"];
    case "back":
      return ["await page.goBack();"];
    case "scroll":
      return [`await (await ui.pickAny(page, ${sq(ast.target)})).scrollIntoViewIfNeeded();`];
    case "scrollBottom":
      return ["await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));"];
    case "screenshot":
      return [`await page.screenshot({ path: test.info().outputPath(${sq(`step-${ctx.stepNo || 0}.png`)}), fullPage: true });`];
    case "closeDialog":
      return ["await ui.closeDialog(page);"];
    case "expectVisible":
      return [`await expect(ui.text(page, ${sq(ast.text)}${roleArg(ast.kind)})).toBeVisible();`];
    case "expectHidden":
      return [`await expect(ui.textAll(page, ${sq(ast.text)}${roleArg(ast.kind)})).toHaveCount(0);`];
    case "expectUrl":
      return [`await expect(page).toHaveURL(ui.url(${lit(ast.target)}, ${sq(ast.mode)}));`];
    case "expectTitle":
      return [`await expect(page).toHaveTitle(new RegExp(${sq(ast.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))}));`];
    case "expectValue":
      return [`await expect(await ui.pickField(page, ${sq(ast.field)})).toHaveValue(${lit(ast.value)});`];
    case "expectDisabled":
      return [`await expect(await ui.pickAny(page, ${sq(ast.target)}${roleArg(ast.kind)})).${ast.disabled ? "toBeDisabled" : "toBeEnabled"}();`];
    case "expectChecked":
      return [`await expect(await ui.pickCheck(page, ${sq(ast.label)})).${ast.checked ? "toBeChecked" : "not.toBeChecked"}();`];
    case "custom":
      return expandTemplate(ast.code, ast.groups);
    default:
      return null;
  }
}

/** Parse one case into a list of blocks the emitter and `check` both use. */
export function analyzeCase(c, cfg) {
  const steps = expandMacros(c.steps, cfg.macros);
  const blocks = [];
  const unknownSteps = [];
  const unknownExpect = [];
  const rules = cfg.rules || [];
  for (const p of c.preconditions) {
    const ast = parseStep(p, rules);
    blocks.push({ kind: "pre", text: p, ast });
    // unrecognised preconditions are only comments, never failures
  }
  let no = 0;
  steps.forEach((s) => {
    if (!s.macro || s.sub === 1) no++;
    const label = s.macro ? `${no}.${s.sub}` : String(no);
    if (s.text) {
      const ast = parseStep(s.text, rules);
      if (ast.type === "unknown") unknownSteps.push(s.text);
      blocks.push({ kind: "step", no, label, text: s.text, ast, macro: s.macro });
    }
    for (const e of s.expected) {
      const ast = parseExpectation(e, rules);
      if (ast.type === "unknown") unknownExpect.push(e);
      blocks.push({ kind: "expect", no, label: String(no), text: e, ast });
    }
  });
  return { blocks, unknownSteps, unknownExpect, stepCount: steps.filter((s) => s.text).length, sheetSteps: no };
}

/** "[TC-001] title", or "[TC-001] title (2/3)" for a data row. */
export const testTitle = (c) => `[${c.id}] ${c.title}${c.variant ? ` (${c.variant})` : ""}`;

function tagsFor(c) {
  const tags = [];
  if (c.priority) tags.push("@" + c.priority.replace(/\s+/g, ""));
  for (const t of c.tags) tags.push("@" + t.replace(/\s+/g, "-"));
  return [...new Set(tags)];
}

export function emitSpec(cases, cfg, meta) {
  const L = [];
  const rel = meta.sourceRel;
  L.push(`// Generated by casesheet from ${rel}. Do not edit by hand: change the sheet and run \`casesheet build\` again.`);
  L.push("import { test, expect } from '@playwright/test';");
  L.push(`import { ui } from './_casesheet';`);
  L.push("");
  const groups = new Map();
  for (const c of cases) {
    if (!groups.has(c.module)) groups.set(c.module, []);
    groups.get(c.module).push(c);
  }
  const map = [];
  const stats = { cases: 0, steps: 0, unknownSteps: [], unknownExpect: [], manual: 0, fixme: 0 };
  for (const [module, list] of groups) {
    L.push(`test.describe(${sq(module)}, () => {`);
    for (const base of list) {
      const variants = caseVariants(base);
      const entry = { id: base.id, title: base.title, module, source: base.source, line: L.length + 1 };
      if (variants.length > 1) entry.variants = [];
      map.push(entry);
      stats.cases++;
      for (const c of variants) {
        const { blocks, unknownSteps, unknownExpect, stepCount } = analyzeCase(c, cfg);
        if (c === variants[0]) {
          stats.steps += stepCount;
          stats.unknownSteps.push(...unknownSteps.map((t) => ({ id: c.id, text: t })));
          stats.unknownExpect.push(...unknownExpect.map((t) => ({ id: c.id, text: t })));
        }
        const tags = tagsFor(c);
        const ann = [{ type: "source", description: c.source }];
        if (c.data) ann.push({ type: "data", description: c.data });
        if (c.notes) ann.push({ type: "notes", description: c.notes });
        const details = `{ tag: [${tags.map(sq).join(", ")}], annotation: [${ann.map((a) => `{ type: ${sq(a.type)}, description: ${sq(a.description)} }`).join(", ")}] }`;
        const title = testTitle(c);
        if (c.variant) entry.variants.push({ data: c.variant, title: c.title, line: L.length + 1 });
        L.push(`  test(${sq(title)}, ${details}, async ({ page }) => {`);
        if (c.preconditions.length) {
          for (const b of blocks.filter((b) => b.kind === "pre")) {
            const code = b.ast.type === "unknown" || b.ast.type === "noop" ? null : codeFor(b.ast, { routes: cfg.routes });
            L.push(`    // 前置条件 / precondition: ${b.text}`);
            if (code) for (const line of code) L.push("    " + line);
          }
        }
        let lastMacro = null;
        for (const b of blocks) {
          if (b.kind === "pre") continue;
          if (b.kind === "step") {
            if (b.macro && b.macro !== lastMacro) L.push(`    // macro: ${b.macro}`);
            lastMacro = b.macro || null;
            if (b.ast.type === "unknown") {
              stats.fixme++;
              L.push(`    // casesheet could not parse this step. Implement it here, or add a macro for it in casesheet.config.json.`);
              L.push(`    test.fixme(true, ${sq(`unrecognized step: ${b.text}`)});`);
              continue;
            }
            const code = codeFor(b.ast, { routes: cfg.routes, stepNo: b.no });
            L.push(`    await test.step(${sq(`${b.label}. ${b.text}`)}, async () => {`);
            for (const line of code) L.push("      " + line);
            L.push("    });");
          } else {
            if (b.ast.type === "unknown") {
              if (cfg.strict) {
                stats.fixme++;
                L.push(`    test.fixme(true, ${sq(`unrecognized expectation: ${b.text}`)});`);
              } else {
                stats.manual++;
                L.push(`    ui.manual(${sq(b.text)}); // not automated: check by hand or rephrase in the sheet`);
              }
              continue;
            }
            const code = codeFor(b.ast, { routes: cfg.routes, stepNo: b.no });
            L.push(`    await test.step(${sq(`预期 ${b.no}: ${b.text}`)}, async () => {`);
            for (const line of code) L.push("      " + line);
            L.push("    });");
          }
        }
        L.push("  });");
        L.push("");
      }
    }
    if (L[L.length - 1] === "") L.pop();
    L.push("});");
    L.push("");
  }
  return { source: L.join("\n"), map, stats };
}

export function runtimeFor(cfg) {
  const routes = JSON.stringify(cfg.routes || {}, null, 2).replace(/\n/g, "\n");
  const ts = RUNTIME_TS.replace("__ROUTES__", routes);
  return cfg.lang === "js" ? toJs(ts) : ts;
}

export function specFileName(sourceFile, cfg, module) {
  const base = module ? module : path.basename(sourceFile, path.extname(sourceFile));
  if (cfg.lang === "py") {
    const safe = base.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "") || "cases";
    return `test_${/^\d/.test(safe) ? "_" + safe : safe}.py`;
  }
  const safe = base.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "cases";
  return `${safe}.spec.${cfg.lang === "js" ? "js" : "ts"}`;
}
