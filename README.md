# casesheet

> The test-case table QA already writes, in. Runnable Playwright specs (TypeScript, JavaScript or pytest), out, and the results written back into the sheet. Chinese or English steps, no LLM, zero dependencies.

[![npm](https://img.shields.io/npm/v/casesheet)](https://www.npmjs.com/package/casesheet)
[![test](https://github.com/caiqianha/casesheet/actions/workflows/test.yml/badge.svg)](https://github.com/caiqianha/casesheet/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

English · [中文](#中文)

![casesheet demo: check, build, run, report](assets/demo.gif)

Most teams keep their test cases in a spreadsheet: ID, title, steps, expected result. Most automation projects then rewrite every one of those rows by hand into code, and the two drift apart within a month. casesheet makes the sheet the source of truth: it reads Markdown tables, CSV and Excel, understands the plain sentences testers write ("点击 登录 按钮", "click the Login button", "跳转到 /dashboard"), and emits Playwright tests that keep the case ID, the original step text and the source row. Steps it cannot understand are not silently dropped: they become `test.fixme` with the sentence in the message.

```
| 用例编号 | 用例名称           | 操作步骤                                                    | 预期结果                              |
|---------|------------------|----------------------------------------------------------|-------------------------------------|
| TC-001  | 正确账号密码登录成功 | 1. 打开 /login<br>2. 在用户名框输入 admin<br>3. 输入 密码: 123456<br>4. 点击 登录 按钮 | 跳转到 /dashboard<br>显示 欢迎回来, admin |
```

```bash
npx casesheet build cases.md          # → tests/casesheet/*.spec.ts
npx playwright test tests/casesheet
# or, in one go, and fill the 实际结果 column of the sheet with PASS / FAIL: … / FIXME: …
npx casesheet run cases.md --into cases.xlsx
```

```ts
test('[TC-001] 正确账号密码登录成功', { tag: ['@P0'], annotation: [{ type: 'source', description: 'cases.md:5' }] }, async ({ page }) => {
  await test.step('1. 打开 /login', async () => {
    await page.goto('/login');
  });
  await test.step('2. 在用户名框输入 admin', async () => {
    await ui.fill(page, '用户名', 'admin');
  });
  await test.step('3. 输入 密码: 123456', async () => {
    await ui.fill(page, '密码', '123456');
  });
  await test.step('4. 点击 登录 按钮', async () => {
    await ui.click(page, '登录', 'button');
  });
  await test.step('预期 4: 跳转到 /dashboard', async () => {
    await expect(page).toHaveURL(ui.url('/dashboard', 'url'));
  });
  await test.step('预期 4: 显示 欢迎回来, admin', async () => {
    await expect(ui.text(page, '欢迎回来, admin')).toBeVisible();
  });
});
```

The whole example in [`examples/login.md`](examples/login.md) runs green against [`examples/site`](examples/site) in CI, in both TypeScript and JavaScript output (`npm run e2e`).

## Install

```bash
npm i -D casesheet          # or: npx casesheet ...
```

Node 18+. Generated specs need `@playwright/test` 1.51 or newer in your project.

## How it works

1. **Read the sheet.** `.md` (tables), `.csv` / `.tsv`, `.json`, `.xlsx`. Columns are found by header, in Chinese or English: 编号/ID, 标题/Title, 模块/Module, 前置条件/Precondition, 步骤/Steps, 预期结果/Expected, 优先级/Priority, 标签/Tags, 测试数据/Data, 备注/Notes. Only a steps column is required. A Markdown heading above a table becomes the module name when there is no module column.
2. **Split steps.** `1.` / `1、` / `1）` / `步骤1:` numbering, one step per line, or `1.打开 2.输入 3.点击` on one line, or `；`-separated. Expected results line up with steps by number, then by position, otherwise they attach to the last step.
3. **Parse each sentence** with an ordered list of patterns (no NLP, no model). `casesheet grammar` prints every pattern:

   | Steps | 中文 | English |
   |---|---|---|
   | open a page | 打开 /login · 打开 登录页 | open /login · go to the login page |
   | fill a field | 在 用户名 中输入 admin · 输入 密码: 123456 | fill username with admin · type "x" into the password field |
   | click | 点击 登录 按钮 · 点击「忘记密码」链接 · 双击 · 右键点击 | click the Login button · double click · right click |
   | select / check | 在 城市 中选择 北京 · 勾选 记住我 · 取消勾选 | select Beijing from the city dropdown · check / uncheck Remember me |
   | keyboard | 按下 回车 · 按 Esc 键 · 按下 ctrl+s | press Enter |
   | others | 上传 a.png 到 头像 · 悬停 · 等待 2 秒 · 等待 列表 加载完成 · 刷新页面 · 返回上一页 · 滚动到底部 · 截图 · 关闭弹窗 | upload · hover · wait 2 seconds · reload · go back · scroll to bottom · screenshot · close the dialog |

   | Expected results | 中文 | English |
   |---|---|---|
   | text visible / hidden | 显示 登录成功 · 提示「密码错误」 · 不显示 删除 按钮 · 加载中 消失 | see Welcome back · "Invalid password" is shown · Delete button is not visible · the spinner disappears |
   | URL | 跳转到 /dashboard · 跳转到首页 · URL 包含 dashboard · 仍在 登录页 | redirected to /home · url contains dashboard · stays on the login page |
   | state | 提交 按钮不可用 · 记住我 已勾选 · 用户名 输入框的值为 admin · 标题为 后台首页 | the Submit button is disabled · Remember me is checked · the Email field contains a@b.c · title is Dashboard |

4. **Emit specs.** One `.spec.ts` per sheet (or per module with `--split module`), a `_casesheet.ts` helper next to them, and `casesheet.map.json` (case ID → spec file and line). Test titles are `[ID] title`, priority and tags become Playwright tags (`--grep @P0`), the source row is an annotation.
5. **Run with Playwright** as usual, or with `casesheet run`, which builds, runs `npx playwright test` and prints a per-case report. `casesheet report results.json` turns any Playwright JSON output into that table; `--csv out.csv` saves it, `--into 用例.xlsx` writes it back into the sheet (see below).

## What happens to sentences it does not understand

- A **step** it cannot parse becomes `test.fixme(true, 'unrecognized step: 登录系统')`. The test is reported as fixme, never as a false pass.
- An **expected result** it cannot parse becomes a `manual check` annotation: the test still runs and the report lists what a human still has to verify. `--strict` turns these into fixme too.
- `casesheet check cases.md` lists both without writing files and exits 1 when a step is unknown, so you can gate sheets in CI or in review.

Most "unknown" steps are project shorthand ("登录系统", "sign in"). Define them once as a macro:

```json
{
  "routes": { "登录页": "/login", "首页": "/dashboard", "login page": "/login" },
  "macros": { "登录系统": ["打开 登录页", "输入 用户名 {{CASESHEET_USER}}", "输入 密码 {{CASESHEET_PASS}}", "点击 登录 按钮"] }
}
```

`casesheet.config.json` also holds `out`, `lang` (`ts` | `js` | `py`), `split`, `strict` and `rules`. `{{NAME}}` in any value reads `process.env.NAME` at run time, so credentials never live in the sheet.

### Custom rules

When a macro is not enough, because the sentence carries a value or needs code the grammar does not have, add a rule. Rules are regular expressions tried **before** the built-in grammar, in order; `code` is emitted inside the step, with `page`, `expect` and `ui` in scope:

```json
{
  "rules": [
    {
      "name": "审批通过",
      "match": "^审批通过\\s*[:：]?\\s*(.+)$",
      "kind": "step",
      "code": "await ui.click(page, $1, 'link');\nawait ui.click(page, '通过', 'button');",
      "py": "ui.click(page, $1, \"link\")\nui.click(page, \"通过\", \"button\")"
    },
    { "match": "^toast (.+)$", "flags": "i", "kind": "expect", "code": "await expect(page.locator('.toast')).toHaveText($1);" }
  ]
}
```

- `$1`, `$2`, … are the regex groups inserted as string literals (so a group holding `{{USER}}` still becomes an environment lookup); `$1raw` inserts the text verbatim (for numbers or code).
- `kind` is `step` or `expect`; `flags` are regex flags; `name` is what `casesheet check` / `grammar` show.
- `py` is the template used by `--lang py`. Without it, a step matched by the rule becomes a fixme in Python output and an expectation becomes a manual check.
- `casesheet grammar` lists the rules of the current config in their own section; `casesheet check` counts their matches as recognised.

### Data-driven cases

If the data column (测试数据 / Data) has **two or more** lines of `k=v; k2=v2` (or a JSON object per line), casesheet generates one test per line, titled `[TC-001] title (1/3)`, `(2/3)`, …:

| 用例编号 | 用例名称 | 操作步骤 | 预期结果 | 测试数据 |
|---|---|---|---|---|
| TC-020 | 用 {{user}} 登录 | 1. 打开 /login<br>2. 输入 用户名 {{user}}<br>3. 输入 密码 {{pass}}<br>4. 点击 登录 | 显示 {{msg}} | user=admin; pass=123456; msg=欢迎回来<br>user=guest; pass={{GUEST_PASS}}; msg=无权限 |

`{{k}}` in the title, steps and expectations is filled from the data line first, then from the environment (`{{GUEST_PASS}}` above still reads `process.env.GUEST_PASS`). A single-line data cell is kept as an annotation, as before. `casesheet.map.json` and `casesheet report` group the variants back under the base ID; a case fails when any of its rows fails and the report says which (`failed: 2/3`).

## Run and write the results back

```bash
npx casesheet run cases.md --into cases.xlsx                 # build + npx playwright test + report + write-back
npx casesheet run cases.md -- --grep @P0 --headed            # everything after -- goes to playwright test
npx casesheet report results.json --into cases.xlsx          # from an existing JSON run
```

- `run` builds into the configured out dir, runs `npx playwright test <out dir>` with your reporters plus `json` (written to `<out dir>/results.json`), prints the same table as `report`, and exits with the runner's code. If `@playwright/test` is not installed in the project it prints the install hint and exits 2.
- `--into <sheet>` fills the **实际结果 / Actual** column (created at the end when missing, reused when present: 实际结果 / 执行结果 / Actual Result …) with `PASS`, `FAIL: <first error line>`, `FIXME: <reason>`, `SKIPPED` or `FLAKY`, and a **状态 / Status** column when the sheet has one. Rows are matched by case ID. `.xlsx` (only the target worksheet changes; styles, other sheets and shared strings are left as they are), `.csv` / `.tsv` and `.md` tables are supported.
- The sheet is never overwritten: the output is `<name>.result.<ext>` next to it, or `--out file` (`--result file` for `run`), or `--in-place` when you really mean it.

## Python output

`casesheet build --lang py` (or `run --lang py`) emits pytest + [playwright-python](https://playwright.dev/python/) specs instead: `test_<sheet>.py` files with `def test_tc_001_title(page: Page, record_property)`, a `_casesheet.py` port of the `ui` helper (`fill`, `click`, `text`, `select`, `check`, `upload`, `close_dialog`, `open`, `url`, `env`, `manual`) and a `conftest.py` that registers the markers and writes `results.json` in the same shape Playwright's JSON reporter uses, so `casesheet report` and `--into` work unchanged.

```bash
pip install pytest pytest-playwright && playwright install chromium
npx casesheet run cases.md --lang py --into cases.xlsx -- --base-url http://localhost:3000
# or: npx casesheet build cases.md --lang py && pytest tests/casesheet --base-url http://localhost:3000
```

Priority and tags become pytest markers (`-m P0`). Unknown steps call `pytest.skip` through `ui.fixme` (reported as fixme, never as a pass; `pytest.fail` with `--strict`), unknown expectations are recorded with `record_property("manual", …)`. Macros, routes, `{{ENV}}` placeholders, data rows and custom rules (via their `py` template) behave as in the TypeScript output. `run --lang py` uses `python3` (`CASESHEET_PYTHON` overrides it) and exits 2 with a hint when pytest-playwright is missing.

## How elements are found

The generated code calls a small helper instead of raw selectors, because a sheet says "用户名", not `#login-form input:nth-child(2)`:

- `ui.fill(page, '用户名', ...)` tries label, placeholder, `name`/`id`, ARIA textbox, then an input inside or next to a `<label>` with that text, **in that order** (not DOM order), and waits for one to exist.
- `ui.click(page, '登录', 'button')` prefers an exact button or link name, then text.
- `ui.text(page, '登录成功')` matches visible text anywhere, including ARIA alerts, which is how toasts are usually announced.
- `ui.open(page, '个人中心')` is what "进入 个人中心" becomes when no route is configured: it clicks a link, button or menu item with that name, and fails with a hint to add a route if there is none.
- Candidates are filtered to visible elements, so a hidden duplicate in a closed drawer does not win.

If your app needs something else, edit `_casesheet.ts` (or `_casesheet.py`): it is plain Playwright and regenerated only when you run `build` again (keep your copy under a different name and change the import if you customise heavily).

## Commands

```
casesheet build <sheet...> [-o dir] [--lang ts|js|py] [--split module] [--strict] [--sheet name] [--config file]
casesheet run   <sheet...> [build options] [--into sheet [--result file | --in-place]] [-- <playwright / pytest args>]
casesheet check <sheet...> [--strict]
casesheet report <results.json> [--csv out.csv] [--into sheet [--out file | --in-place]]
casesheet grammar [--json]
casesheet init [dir]
```

## Why not …

- **Gherkin / Cucumber.** You still write step definitions by hand, and testers have to learn Given/When/Then. casesheet reads the table they already maintain and ships the step definitions.
- **An LLM that writes the tests.** Non-deterministic, costs money per run, and you cannot review 400 generated files. casesheet is a compiler: same sheet, same code, diffable.
- **Playwright codegen.** Great for one flow, but the recording has no case ID, no expected-result mapping and nothing to hand back to QA.

## Limits

- Pattern matching, not understanding. Sentences outside the grammar are reported, not guessed. Open an issue with the sentence; adding a pattern is a one-line regex plus a test.
- Element lookup is by accessible name and text. Apps without labels, placeholders or ARIA names need `_casesheet.ts` adjusted or `data-testid` attributes exposed as labels.
- `.xlsx` only (first sheet by default). Legacy `.xls` must be saved as `.xlsx`. Merged cells are read as their top-left value.
- Preconditions are compiled when they parse ("打开 /login"), otherwise kept as comments.
- Write-back re-serialises `.csv` files (quoting only where needed) and re-joins the touched Markdown table rows; `.xlsx` cells are written as inline strings, which Excel, LibreOffice and Numbers read fine but which do not go through the shared-string table.
- Custom rules need a `py` template to be used by `--lang py`.

## Development

```bash
npm test          # node:test, no install
npm run e2e       # installs Playwright into ./.e2e and runs examples/login.md against examples/site
npm run e2e:js    # same, JavaScript output
npm run e2e:py    # pytest + playwright-python in a venv under ./.e2e/pyenv, same sheet, same outcome
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a sentence pattern.

---

## 中文

**casesheet 把测试人员已经在写的用例表直接变成可运行的 Playwright 脚本（TypeScript / JavaScript / pytest），跑完再把结果回填到表里。** 支持 Markdown 表格、CSV、Excel（.xlsx）；步骤和预期结果用中文或英文自然语句写（「点击 登录 按钮」「跳转到 /dashboard」），不调用大模型，零依赖，同一张表每次生成的代码完全一致。

### 快速开始

```bash
npx casesheet init              # 生成 cases/example.md 和 casesheet.config.json
npx casesheet check cases/example.md    # 看哪些步骤能识别、哪些不能，不写文件
npx casesheet build cases/example.md    # 生成 tests/casesheet/*.spec.ts
npx playwright test tests/casesheet
npx casesheet run cases/example.md --into 用例.xlsx      # 一条命令：生成 + 运行 + 报告 + 回填 用例.result.xlsx
npx casesheet report results.json --csv 结果.csv --into 用例.xlsx   # 已有 JSON 结果时单独回填
```

Playwright 配置里要有 `use: { baseURL: '...' }`，「打开 /login」才知道打开哪台服务器。`run` 后面接 `--`，再往后的参数原样传给 `playwright test`（如 `-- --grep @P0 --headed`）；项目里没装 `@playwright/test` 时会打印安装提示并以 2 退出。

### 表格怎么写

- 表头按名字识别：用例编号 / 用例名称 / 模块 / 前置条件 / 操作步骤 / 预期结果 / 优先级 / 标签 / 测试数据 / 备注，中英文都行，只有「步骤」列是必须的。Markdown 里表格上方的标题会当作模块名。
- 步骤一行一条，`1.` `1、` `1）` `步骤1:` 都能识别；写在一行里的「1.打开 2.输入 3.点击」或用「；」分隔也可以。
- 预期结果如果也编了号，按编号对应到步骤；没编号按顺序对应；对不上就全部挂到最后一步。
- 值里写 `{{USER}}` 会在运行时读环境变量 `USER`，账号密码不用进表格。
- 「打开 登录页」这类页面名，在 `casesheet.config.json` 的 `routes` 里映射到路径；「登录系统」这类项目黑话，在 `macros` 里展开成几步。
- 带参数的团队黑话写成 `rules`：`{ "match": "^审批通过\\s*(.+)$", "kind": "step", "code": "await ui.click(page, $1, 'link');" }`，正则优先于内置句式按顺序匹配，`$1` 以字符串字面量代入（里面的 `{{VAR}}` 仍走环境变量），`$1raw` 原样代入，`py` 字段给 Python 输出用。`casesheet grammar` 会单独列出当前配置的规则。
- **数据驱动**：测试数据列写两行以上 `user=admin; pass=123456`（或每行一个 JSON 对象），每行生成一个用例 `[TC-001] 标题 (1/2)`，步骤里的 `{{user}}` 先从该行取值，取不到再读环境变量；只有一行时行为不变。`casesheet.map.json` 和 `report` 仍按原编号归组，任一行失败整条用例算失败并指出是哪一行。
- **结果回填**：`run --into 用例.xlsx` 或 `report results.json --into 用例.xlsx` 按用例编号把 `PASS` / `FAIL: 第一行错误` / `FIXME: 原因` / `SKIPPED` / `FLAKY` 写进「实际结果」列（没有就在表头末尾新建，有「状态」列也一并填）。支持 .xlsx（只改目标工作表，样式、其它 sheet 不动）、.csv/.tsv、.md。默认写到 `用例.result.xlsx`，不覆盖原表；`--out 文件`（run 里是 `--result 文件`）指定路径，`--in-place` 才原地改。
- **Python 输出**：`--lang py` 生成 pytest + playwright-python 的 `test_*.py`、`_casesheet.py`（同一套 `ui` 定位助手）和 `conftest.py`（写出与 Playwright JSON 同构的 `results.json`，所以 `report` / `--into` 照用）。`pip install pytest pytest-playwright && playwright install chromium`，然后 `casesheet run cases.md --lang py -- --base-url http://localhost:3000`。识别不了的步骤用 `pytest.skip`（报告里是 fixme；`--strict` 下改为 `pytest.fail`），识别不了的预期记到 `record_property("manual", …)`。

### 识别不了的句子怎么办

- **步骤**识别不了：生成 `test.fixme(true, 'unrecognized step: …')`，报告里是 fixme，不会假通过。
- **预期**识别不了：生成 `manual check` 标注，脚本照跑，报告里列出需要人工确认的点；加 `--strict` 则同样变成 fixme。
- `casesheet check` 不写文件，只列出这两类，有未识别步骤就返回 1，可以放在 CI 或评审环节。
- `casesheet grammar` 打印全部支持的句式。缺的句式欢迎提 issue，加一条正则加一条测试即可。

### 元素怎么定位

生成的代码不写选择器，而是调用旁边的 `_casesheet.ts`：输入框按 label → placeholder → name/id → ARIA → `<label>` 内部或相邻的 input 的**优先级**找（不是 DOM 顺序），按钮优先精确的按钮/链接名，文本在页面任意可见位置匹配（含 ARIA alert，也就是大多数 toast）。页面有特殊情况直接改这个文件。

示例 `examples/login.md` 在 CI 里对 `examples/site` 真实跑通（TS、JS 和 pytest 三种输出，并回填到 `login.xlsx` 的副本），`npm run e2e` / `e2e:js` / `e2e:py` 可以本地复现。

## License

MIT © 才浅 (caiqianha)
