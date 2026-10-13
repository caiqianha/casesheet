# Changelog

## 0.2.0 - 2026-10-13

- **Result write-back.** `casesheet report results.json --into 用例.xlsx` (also `.csv` / `.tsv` / `.md`) fills the 实际结果 / Actual column (created at the end when missing, reused when present) with `PASS` / `FAIL: <first error line>` / `FIXME: <reason>` / `SKIPPED` / `FLAKY`, plus a 状态 / Status column when there is one. Output goes to `<name>.result.<ext>` unless `--out` / `--in-place`. Includes a dependency-free `.xlsx` writer that touches only the target worksheet (inline strings; other zip entries are carried over unchanged).
- **Custom rules** in `casesheet.config.json`: `rules: [{ match, flags?, kind: "step" | "expect", code, py?, name? }]`, tried before the built-in grammar in order; `$1` inserts a group as a string literal (env placeholders kept), `$1raw` verbatim. Validated with the key path in the error; listed by `casesheet grammar`; counted as recognised by `check`.
- **`casesheet run <sheets> [build options] [--into sheet] [-- playwright args]`**: build, `npx playwright test` with the user's reporters plus `json`, the per-case report, optional write-back; exit code mirrors the runner; exits 2 with an install hint when `@playwright/test` is missing.
- **Data-driven cases**: two or more `k=v; k2=v2` (or JSON) lines in the data column generate one test per line, titled `[ID] title (1/n)`; `{{k}}` is resolved from the line first, then from the environment. Map file and report group variants under the base ID.
- **Python target**: `--lang py` emits pytest + playwright-python specs (`test_*.py`), a `_casesheet.py` port of the `ui` helper and a `conftest.py` plugin that writes `results.json` in the Playwright JSON shape, so `report` / `--into` work unchanged. `run --lang py` drives pytest. Verified end to end in CI (`npm run e2e:py`).
- Column detection now distinguishes `actual` (实际结果 / Actual Result) from `status` (状态 / Status); `lang` is validated; `--lang` flag added; `--` after `run` separates runner arguments.

## 0.1.0 - 2026-10-12

First release.

- Readers: Markdown tables, CSV / TSV, JSON, `.xlsx` (first sheet or `--sheet`), all without dependencies.
- Column detection by header in Chinese and English; only a steps column is required.
- Step grammar: 21 action patterns and 9 assertion patterns in Chinese and English (`casesheet grammar`).
- Output: one `.spec.ts` (or `.spec.js`) per sheet or per module, a `_casesheet` runtime helper with priority-based locators, and `casesheet.map.json` for traceability.
- `{{VAR}}` placeholders, page-name routes and macros via `casesheet.config.json`.
- `check` for gating sheets in CI, `report` to turn Playwright's JSON into a per-case table / CSV, `init` to scaffold.
- Unrecognised steps become `test.fixme`; unrecognised expectations become a `manual check` annotation (or `fixme` with `--strict`).
