import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStep, parseExpectation, grammarTable } from "../src/grammar.js";

const strip = (a) => {
  const { raw, rule, ...rest } = a;
  return rest;
};

const STEPS = [
  ["打开 /login", { type: "goto", target: "/login", isUrl: true }],
  ["访问 https://example.com/a?b=1", { type: "goto", target: "https://example.com/a?b=1", isUrl: true }],
  ["打开登录页", { type: "goto", target: "登录页", isUrl: false }],
  ["go to the login page", { type: "goto", target: "login page", isUrl: false }],
  ["open /login", { type: "goto", target: "/login", isUrl: true }],
  ["在用户名框输入 admin", { type: "fill", field: "用户名", value: "admin" }],
  ["在「手机号」中输入 13800000000", { type: "fill", field: "手机号", value: "13800000000" }],
  ["输入 密码: 123456", { type: "fill", field: "密码", value: "123456" }],
  ["输入 密码 123456", { type: "fill", field: "密码", value: "123456" }],
  ["输入用户名为 admin", { type: "fill", field: "用户名", value: "admin" }],
  ["fill username with admin", { type: "fill", field: "username", value: "admin" }],
  ['type "123456" into the password field', { type: "fill", field: "password", value: "123456" }],
  ["enter a@b.c in the Email field", { type: "fill", field: "Email", value: "a@b.c" }],
  ["清空 用户名", { type: "fill", field: "用户名", value: "" }],
  ["clear the username field", { type: "fill", field: "username", value: "" }],
  ["点击 登录 按钮", { type: "click", target: "登录", kind: "button" }],
  ["点击「忘记密码」链接", { type: "click", target: "忘记密码", kind: "link" }],
  ["点击 保存", { type: "click", target: "保存", kind: null }],
  ["click the Login button", { type: "click", target: "Login", kind: "button" }],
  ["click Forgot password", { type: "click", target: "Forgot password", kind: null }],
  ["双击 文件名", { type: "click", target: "文件名", kind: null, dbl: true }],
  ["右键点击 文件", { type: "click", target: "文件", kind: null, right: true }],
  ["按下 回车", { type: "press", key: "Enter" }],
  ["按 Esc 键", { type: "press", key: "Escape" }],
  ["press Enter", { type: "press", key: "Enter" }],
  ["按下 ctrl+s", { type: "press", key: "Control+S" }],
  ["勾选 记住我", { type: "check", label: "记住我", checked: true }],
  ["取消勾选 记住我", { type: "check", label: "记住我", checked: false }],
  ["check Remember me", { type: "check", label: "Remember me", checked: true }],
  ["uncheck Remember me", { type: "check", label: "Remember me", checked: false }],
  ["在 城市 中选择 北京", { type: "select", field: "城市", option: "北京" }],
  ["选择 性别 为 男", { type: "select", field: "性别", option: "男" }],
  ["select Beijing from the city dropdown", { type: "select", field: "city", option: "Beijing" }],
  ["选择 北京", { type: "click", target: "北京", kind: null }],
  ["上传 a.png 到 头像", { type: "upload", field: "头像", file: "a.png" }],
  ["上传 a.png", { type: "upload", field: null, file: "a.png" }],
  ["upload avatar.png to the Avatar field", { type: "upload", field: "Avatar", file: "avatar.png" }],
  ["悬停 头像", { type: "hover", target: "头像" }],
  ["hover over the avatar", { type: "hover", target: "avatar" }],
  ["等待 2 秒", { type: "wait", ms: 2000 }],
  ["等待500毫秒", { type: "wait", ms: 500 }],
  ["wait 1.5 seconds", { type: "wait", ms: 1500 }],
  ["等待 列表 加载完成", { type: "waitVisible", text: "列表" }],
  ["刷新页面", { type: "reload" }],
  ["reload the page", { type: "reload" }],
  ["返回上一页", { type: "back" }],
  ["滚动到底部", { type: "scrollBottom" }],
  ["滚动到 评论区", { type: "scroll", target: "评论区" }],
  ["截图", { type: "screenshot" }],
  ["关闭弹窗", { type: "closeDialog" }],
  ["close the dialog", { type: "closeDialog" }],
  ["验证 显示 登录成功", { type: "expectVisible", text: "登录成功", kind: null }],
  ["登录系统", { type: "unknown" }],
  ["do something odd", { type: "unknown" }],
];

const EXPECTS = [
  ["显示 登录成功", { type: "expectVisible", text: "登录成功", kind: null }],
  ["提示「用户名或密码错误」", { type: "expectVisible", text: "用户名或密码错误", kind: null }],
  ["页面显示 欢迎回来 字样", { type: "expectVisible", text: "欢迎回来", kind: null }],
  ["看到 欢迎回来, admin", { type: "expectVisible", text: "欢迎回来, admin", kind: null }],
  ["显示 提交 按钮", { type: "expectVisible", text: "提交", kind: "button" }],
  ["保存 按钮 显示", { type: "expectVisible", text: "保存", kind: "button" }],
  ["see Welcome back", { type: "expectVisible", text: "Welcome back", kind: null }],
  ['the message "Invalid password" is shown', { type: "expectVisible", text: "Invalid password", kind: null }],
  ["the page shows Welcome", { type: "expectVisible", text: "Welcome", kind: null }],
  ["不显示 删除 按钮", { type: "expectHidden", text: "删除", kind: "button" }],
  ["加载中 消失", { type: "expectHidden", text: "加载中", kind: null }],
  ["Delete button is not visible", { type: "expectHidden", text: "Delete", kind: "button" }],
  ["the spinner disappears", { type: "expectHidden", text: "spinner", kind: null }],
  ["should not see Admin menu", { type: "expectHidden", text: "Admin", kind: "menuitem" }],
  ["跳转到 /dashboard", { type: "expectUrl", target: "/dashboard", mode: "url" }],
  ["跳转到首页", { type: "expectUrl", target: "首页", mode: "route" }],
  ["仍在 登录页", { type: "expectUrl", target: "登录页", mode: "route" }],
  ["URL 包含 dashboard", { type: "expectUrl", target: "dashboard", mode: "contains" }],
  ["redirected to /home", { type: "expectUrl", target: "/home", mode: "url" }],
  ["stays on the login page", { type: "expectUrl", target: "login", mode: "route" }],
  ["url contains dashboard", { type: "expectUrl", target: "dashboard", mode: "contains" }],
  ["标题为 后台首页", { type: "expectTitle", text: "后台首页" }],
  ["title is Dashboard", { type: "expectTitle", text: "Dashboard" }],
  ["登录 按钮不可用", { type: "expectDisabled", target: "登录", kind: "button", disabled: true }],
  ["提交 按钮可用", { type: "expectDisabled", target: "提交", kind: "button", disabled: false }],
  ["the Submit button is disabled", { type: "expectDisabled", target: "Submit", kind: "button", disabled: true }],
  ["记住我 已勾选", { type: "expectChecked", label: "记住我", checked: true }],
  ["记住我 未勾选", { type: "expectChecked", label: "记住我", checked: false }],
  ["Remember me is checked", { type: "expectChecked", label: "Remember me", checked: true }],
  ["Remember me is unchecked", { type: "expectChecked", label: "Remember me", checked: false }],
  ["用户名 输入框的值为 admin", { type: "expectValue", field: "用户名", value: "admin" }],
  ["the Email field contains a@b.c", { type: "expectValue", field: "Email", value: "a@b.c" }],
  ["金额 显示为 100.00", { type: "expectVisible", text: "100.00", within: "金额" }],
  ["登录成功", { type: "unknown" }],
  ["login succeeds", { type: "unknown" }],
];

test("steps parse to the expected AST", () => {
  for (const [text, want] of STEPS) assert.deepEqual(strip(parseStep(text)), want, text);
});

test("expectations parse to the expected AST", () => {
  for (const [text, want] of EXPECTS) assert.deepEqual(strip(parseExpectation(text)), want, text);
});

test("every grammar rule has bilingual examples that parse with that rule", () => {
  const rows = grammarTable();
  assert.ok(rows.length >= 30);
  for (const r of rows) {
    for (const ex of [...r.zh.split(" · "), ...r.en.split(" · ")]) {
      const ast = r.kind === "action" ? parseStep(ex) : parseExpectation(ex);
      assert.notEqual(ast.type, "unknown", `${r.id}: "${ex}" did not parse`);
    }
  }
});
