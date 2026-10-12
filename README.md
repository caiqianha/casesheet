# casesheet

> The test-case table QA already writes, in. Runnable Playwright specs, out. Chinese or English steps, no LLM, zero dependencies.

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
npx casesheet build cases.md
npx playwright test tests/casesheet
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
5. **Run with Playwright** as usual. `casesheet report results.json --csv out.csv` turns the JSON reporter output back into a per-case table you can paste into the sheet.

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

`casesheet.config.json` also holds `out`, `lang` (`ts` | `js`), `split`, `strict`. `{{NAME}}` in any value reads `process.env.NAME` at run time, so credentials never live in the sheet.

## How elements are found

The generated code calls a small helper instead of raw selectors, because a sheet says "用户名", not `#login-form input:nth-child(2)`:

- `ui.fill(page, '用户名', ...)` tries label, placeholder, `name`/`id`, ARIA textbox, then an input inside or next to a `<label>` with that text, **in that order** (not DOM order), and waits for one to exist.
- `ui.click(page, '登录', 'button')` prefers an exact button or link name, then text.
- `ui.text(page, '登录成功')` matches visible text anywhere, including ARIA alerts, which is how toasts are usually announced.
- `ui.open(page, '个人中心')` is what "进入 个人中心" becomes when no route is configured: it clicks a link, button or menu item with that name, and fails with a hint to add a route if there is none.
- Candidates are filtered to visible elements, so a hidden duplicate in a closed drawer does not win.

If your app needs something else, edit `_casesheet.ts`: it is plain Playwright and regenerated only when you run `build` again (keep your copy under a different name and change the import if you customise heavily).

## Commands

```
casesheet build <sheet...> [-o dir] [--js] [--split module] [--strict] [--sheet name]
casesheet check <sheet...> [--strict]
casesheet report <results.json> [--csv out.csv]
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

## Development

```bash
npm test          # node:test, no install
npm run e2e       # installs Playwright into ./.e2e and runs examples/login.md against examples/site
npm run e2e:js    # same, JavaScript output
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a sentence pattern.

---

## 中文

**casesheet 把测试人员已经在写的用例表直接变成可运行的 Playwright 脚本。** 支持 Markdown 表格、CSV、Excel（.xlsx）；步骤和预期结果用中文或英文自然语句写（「点击 登录 按钮」「跳转到 /dashboard」），不调用大模型，零依赖，同一张表每次生成的代码完全一致。

### 快速开始

```bash
npx casesheet init              # 生成 cases/example.md 和 casesheet.config.json
npx casesheet check cases/example.md    # 看哪些步骤能识别、哪些不能，不写文件
npx casesheet build cases/example.md    # 生成 tests/casesheet/*.spec.ts
npx playwright test tests/casesheet
npx playwright test --reporter=json > results.json
npx casesheet report results.json --csv 结果.csv   # 按用例编号回填通过/失败
```

Playwright 配置里要有 `use: { baseURL: '...' }`，「打开 /login」才知道打开哪台服务器。

### 表格怎么写

- 表头按名字识别：用例编号 / 用例名称 / 模块 / 前置条件 / 操作步骤 / 预期结果 / 优先级 / 标签 / 测试数据 / 备注，中英文都行，只有「步骤」列是必须的。Markdown 里表格上方的标题会当作模块名。
- 步骤一行一条，`1.` `1、` `1）` `步骤1:` 都能识别；写在一行里的「1.打开 2.输入 3.点击」或用「；」分隔也可以。
- 预期结果如果也编了号，按编号对应到步骤；没编号按顺序对应；对不上就全部挂到最后一步。
- 值里写 `{{USER}}` 会在运行时读环境变量 `USER`，账号密码不用进表格。
- 「打开 登录页」这类页面名，在 `casesheet.config.json` 的 `routes` 里映射到路径；「登录系统」这类项目黑话，在 `macros` 里展开成几步。

### 识别不了的句子怎么办

- **步骤**识别不了：生成 `test.fixme(true, 'unrecognized step: …')`，报告里是 fixme，不会假通过。
- **预期**识别不了：生成 `manual check` 标注，脚本照跑，报告里列出需要人工确认的点；加 `--strict` 则同样变成 fixme。
- `casesheet check` 不写文件，只列出这两类，有未识别步骤就返回 1，可以放在 CI 或评审环节。
- `casesheet grammar` 打印全部支持的句式。缺的句式欢迎提 issue，加一条正则加一条测试即可。

### 元素怎么定位

生成的代码不写选择器，而是调用旁边的 `_casesheet.ts`：输入框按 label → placeholder → name/id → ARIA → `<label>` 内部或相邻的 input 的**优先级**找（不是 DOM 顺序），按钮优先精确的按钮/链接名，文本在页面任意可见位置匹配（含 ARIA alert，也就是大多数 toast）。页面有特殊情况直接改这个文件。

示例 `examples/login.md` 在 CI 里对 `examples/site` 真实跑通（TS 和 JS 两种输出），`npm run e2e` 可以本地复现。

## License

MIT © 才浅 (caiqianha)
