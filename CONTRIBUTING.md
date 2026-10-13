# Contributing

casesheet is a zero-dependency Node CLI. `npm test` runs in a second; `npm run e2e` proves the generated specs still pass under a real Playwright.

## Adding a sentence pattern

1. Add a rule (or a regex to an existing rule) in `src/grammar.js`. Keep the `zh` / `en` examples current: a test checks that every example parses with its own rule.
2. Add the sentence to `test/grammar.test.js` with the AST you expect.
3. If it needs a new action type, add the emitter in `src/emit.js` and, if the runtime helper needs to change, `src/runtime.js` (TypeScript; `toJs()` must still strip every annotation you use — the test checks the JS output with `node --check`).
4. Run `npm test` and `npm run e2e`.

Order matters: rules are tried top to bottom and the first match wins. Put specific patterns before general ones.

## Ground rules

- No runtime dependencies. The readers (Markdown, CSV, JSON, XLSX) are hand-written on purpose.
- No LLM calls. The point is that the same sheet produces the same code every time.
- Everything in `examples/` must keep passing end to end against `examples/site`.
- Original content only, MIT licensed.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
