# Changelog

## 0.1.0 - 2026-10-12

First release.

- Readers: Markdown tables, CSV / TSV, JSON, `.xlsx` (first sheet or `--sheet`), all without dependencies.
- Column detection by header in Chinese and English; only a steps column is required.
- Step grammar: 21 action patterns and 9 assertion patterns in Chinese and English (`casesheet grammar`).
- Output: one `.spec.ts` (or `.spec.js`) per sheet or per module, a `_casesheet` runtime helper with priority-based locators, and `casesheet.map.json` for traceability.
- `{{VAR}}` placeholders, page-name routes and macros via `casesheet.config.json`.
- `check` for gating sheets in CI, `report` to turn Playwright's JSON into a per-case table / CSV, `init` to scaffold.
- Unrecognised steps become `test.fixme`; unrecognised expectations become a `manual check` annotation (or `fixme` with `--strict`).
