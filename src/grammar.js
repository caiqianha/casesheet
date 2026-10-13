// Step grammar: plain Chinese / English sentences → small action AST.
// No NLP, no LLM: ordered regular expressions. First match wins. Anything that
// does not match becomes { type: "unknown" } and is reported by `casesheet check`.

const Q = /^[\s"'“”‘’「」『』【】\[\]（）()《》<>]+|[\s"'“”‘’「」『』【】\[\]（）()《》<>,.，。;；!！]+$/g;
export const unquote = (s) => String(s ?? "").replace(Q, "").trim();

const KEYS = {
  回车: "Enter", 回车键: "Enter", enter: "Enter", return: "Enter",
  esc: "Escape", escape: "Escape", 退出键: "Escape",
  tab: "Tab", 制表符: "Tab",
  空格: "Space", 空格键: "Space", space: "Space",
  退格: "Backspace", 退格键: "Backspace", backspace: "Backspace",
  删除: "Delete", 删除键: "Delete", delete: "Delete", del: "Delete",
  上: "ArrowUp", 下: "ArrowDown", 左: "ArrowLeft", 右: "ArrowRight",
  上键: "ArrowUp", 下键: "ArrowDown", 左键: "ArrowLeft", 右键: "ArrowRight",
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
  arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight",
  home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown",
};
const keyName = (k) => {
  const raw = unquote(k).replace(/键$/, "");
  const low = raw.toLowerCase();
  if (KEYS[low]) return KEYS[low];
  if (KEYS[raw]) return KEYS[raw];
  if (/^f\d{1,2}$/i.test(raw)) return raw.toUpperCase();
  if (/\+/.test(raw)) return raw.split("+").map((p) => {
    const t = p.trim().toLowerCase();
    if (t === "ctrl" || t === "control") return "Control";
    if (t === "cmd" || t === "command" || t === "meta") return "Meta";
    if (t === "shift") return "Shift";
    if (t === "alt" || t === "option") return "Alt";
    return KEYS[t] || (t.length === 1 ? t.toUpperCase() : t[0].toUpperCase() + t.slice(1));
  }).join("+");
  return raw.length === 1 ? raw : null;
};
const KEY_RE = "(enter|return|回车键?|esc(?:ape)?|tab|空格键?|space|退格键?|backspace|删除键?|del(?:ete)?|arrow(?:up|down|left|right)|up|down|left|right|[上下左右]键?|home|end|page(?:up|down)|f\\d{1,2}|(?:ctrl|control|cmd|command|meta|shift|alt|option)\\s*\\+\\s*[\\w+]+)";

const looksLikeUrl = (s) => /^(https?:\/\/|\/|\.\/|#\/|\?)/i.test(s) || /^[\w.-]+\.(com|cn|net|org|io|dev|local)(\/|$)/i.test(s);
const clickKind = (w) => {
  if (!w) return null;
  const s = w.toLowerCase();
  if (/按钮|button|按键/.test(s)) return "button";
  if (/链接|link/.test(s)) return "link";
  if (/选项卡|标签页|页签|tab/.test(s)) return "tab";
  if (/菜单|menu/.test(s)) return "menuitem";
  return null;
};

// ---- actions -------------------------------------------------------------
const A = [
  {
    id: "press",
    zh: "按下 回车", en: "press Enter",
    re: [new RegExp(`^(?:按下?|敲击?|按键|键入|press|hit)\\s*[「"'“]?${KEY_RE}[」"'”]?\\s*(?:键)?$`, "i")],
    build: (m) => ({ type: "press", key: keyName(m[1]) }),
  },
  {
    id: "goto",
    zh: "打开 /login  ·  打开 登录页", en: "open /login  ·  go to the login page",
    re: [
      /^(?:打开|访问|进入|跳转到|跳转至|前往|导航到|加载)\s*(?:页面|网址|链接|地址|url)?\s*[:：]?\s*(.+?)\s*$/i,
      /^(?:open|go\s+to|goto|visit|navigate\s+to|load)\s+(?:the\s+)?(?:url\s+|page\s+)?(.+?)$/i,
    ],
    build: (m) => {
      const t = unquote(m[1]);
      return { type: "goto", target: t, isUrl: looksLikeUrl(t) };
    },
  },
  {
    id: "clear",
    zh: "清空 用户名", en: "clear the email field",
    re: [/^(?:清空|清除)\s*(.+?)\s*(?:输入框|文本框|框|字段|内容)?$/, /^clear\s+(?:the\s+)?(.+?)(?:\s+(?:field|input|box))?$/i],
    build: (m) => ({ type: "fill", field: unquote(m[1]), value: "" }),
  },
  {
    id: "fill",
    zh: "在 用户名 中输入 admin  ·  输入 密码: 123456  ·  输入 手机号 13800000000",
    en: "fill username with admin  ·  type \"admin\" into the username field",
    re: [
      /^(?:在|于)?\s*(.+?)\s*(?:中|里|内|处)?\s*(?:输入框|文本框|编辑框|框|字段|栏)?\s*(?:中|里|内)?\s*(?:输入|填写|填入|键入|录入)\s*[:：]?\s*(.+)$/,
      /^(?:输入|填写|填入|键入|录入)\s*(.+?)\s*(?:为|是|[:：=]|→|->)\s*(.+)$/,
      /^(?:输入|填写|填入|键入|录入)\s*(\S+?)\s+(.+)$/,
      /^(?:fill|type|enter|input|set)\s+(?:in|into)?\s*(?:the\s+)?(.+?)\s+(?:field\s+|input\s+|box\s+)?(?:with|as|to|=|:)\s+(.+)$/i,
      /^(?:fill|type|enter|input)\s+["“'](.+?)["”']\s+(?:in|into)\s+(?:the\s+)?(.+?)(?:\s+(?:field|input|box))?$/i,
      /^(?:fill|type|enter|input)\s+(.+?)\s+(?:in|into)\s+(?:the\s+)?(.+?)(?:\s+(?:field|input|box))?$/i,
    ],
    build: (m, rule, idx) => {
      if (idx === 4 || idx === 5) return { type: "fill", field: unquote(m[2]), value: unquote(m[1]) };
      return { type: "fill", field: unquote(m[1]).replace(/(输入框|文本框|框|字段|栏)$/, ""), value: unquote(m[2]) };
    },
  },
  {
    id: "uncheck",
    zh: "取消勾选 记住我", en: "uncheck Remember me",
    re: [/^(?:取消勾选|取消选中|去掉勾选|取消选择|反选)\s*(.+?)\s*(?:复选框|选项|勾选框)?$/, /^(?:uncheck|untick|deselect)\s+(?:the\s+)?(.+?)(?:\s+(?:checkbox|option|box))?$/i],
    build: (m) => ({ type: "check", label: unquote(m[1]), checked: false }),
  },
  {
    id: "select",
    zh: "在 城市 中选择 北京  ·  选择 性别 为 男", en: "select Beijing from the city dropdown",
    re: [
      /^(?:在|于)?\s*(.+?)\s*(?:下拉框|下拉列表|下拉菜单|下拉|选择框|选择器|列表)?\s*(?:中|里|内)\s*(?:选择|选中|选取|选)\s*[:：]?\s*(.+)$/,
      /^(?:选择|选中|选取|切换)\s*(.+?)\s*(?:下拉框|下拉)?\s*(?:为|是|[:：=]|→|->)\s*(.+)$/,
      /^(?:select|choose|pick)\s+["“']?(.+?)["”']?\s+(?:in|from)\s+(?:the\s+)?(.+?)(?:\s+(?:dropdown|select|list|menu|field))?$/i,
      /^(?:set|switch)\s+(?:the\s+)?(.+?)\s+(?:dropdown\s+|select\s+)?to\s+(.+)$/i,
    ],
    build: (m, rule, idx) => (idx === 2 ? { type: "select", field: unquote(m[2]), option: unquote(m[1]) } : { type: "select", field: unquote(m[1]), option: unquote(m[2]) }),
  },
  {
    id: "check",
    zh: "勾选 记住我", en: "check Remember me",
    re: [/^(?:勾选|打勾|勾上|选中)\s*(.+?)\s*(?:复选框|选项|勾选框|单选框)?$/, /^(?:check|tick)\s+(?:the\s+)?(.+?)(?:\s+(?:checkbox|option|box))?$/i],
    build: (m) => ({ type: "check", label: unquote(m[1]), checked: true }),
  },
  {
    id: "upload",
    zh: "上传 avatar.png 到 头像", en: "upload avatar.png to the Avatar field",
    re: [
      /^(?:上传|upload)\s*(?:文件|file)?\s*[:：]?\s*(.+?)\s+(?:到|至|给|to|into|in)\s+(?:the\s+)?(.+?)(?:\s+(?:field|input))?$/i,
      /^(?:在|于)?\s*(.+?)\s*(?:中|里|处)?\s*上传\s*(?:文件)?\s*[:：]?\s*(.+)$/,
      /^(?:上传|upload)\s*(?:文件|file)?\s*[:：]?\s*(.+)$/i,
    ],
    build: (m, rule, idx) => (idx === 1 ? { type: "upload", field: unquote(m[1]), file: unquote(m[2]) } : idx === 0 ? { type: "upload", field: unquote(m[2]), file: unquote(m[1]) } : { type: "upload", field: null, file: unquote(m[1]) }),
  },
  {
    id: "hover",
    zh: "悬停 头像", en: "hover over the avatar",
    re: [/^(?:鼠标)?(?:悬停|悬浮|移到|移动到|放到|停留)\s*(?:在|到|于)?\s*(.+?)\s*(?:上|上方|之上)?$/, /^(?:hover|mouse\s*over)\s*(?:over|on|at)?\s*(?:the\s+)?(.+)$/i],
    build: (m) => ({ type: "hover", target: unquote(m[1]) }),
  },
  {
    id: "dblclick",
    zh: "双击 文件名", en: "double click the file name",
    re: [/^双击\s*(.+)$/, /^(?:double[-\s]?click|dblclick)\s+(?:on\s+)?(?:the\s+)?(.+)$/i],
    build: (m) => ({ type: "click", target: unquote(m[1]), kind: null, dbl: true }),
  },
  {
    id: "rightclick",
    zh: "右键点击 文件", en: "right click the file",
    re: [/^(?:右键点击|右键单击|右击|右键)\s*(.+)$/, /^(?:right[-\s]?click)\s+(?:on\s+)?(?:the\s+)?(.+)$/i],
    build: (m) => ({ type: "click", target: unquote(m[1]), kind: null, right: true }),
  },
  {
    id: "closeDialog",
    zh: "关闭弹窗", en: "close the dialog",
    re: [/^(?:关闭|关掉)\s*(?:当前)?\s*(?:弹窗|弹框|对话框|提示框|模态框|窗口)$/, /^(?:close|dismiss)\s+(?:the\s+)?(?:dialog|modal|popup|alert)$/i],
    build: () => ({ type: "closeDialog" }),
  },
  {
    id: "click",
    zh: "点击 登录 按钮  ·  点击「忘记密码」链接", en: "click the Login button  ·  click Forgot password",
    re: [
      /^(?:点击|单击|点选|点按|轻触|点一下|点)\s*(?:页面上的|页面中的|页面|上的|的)?\s*(.+?)\s*(按钮|链接|菜单|菜单项|选项卡|标签页|页签|图标|tab|按键)?$/,
      /^(?:click|tap|hit)\s+(?:on\s+)?(?:the\s+)?(.+?)(?:\s+(button|link|tab|icon|menu|menu\s+item|option))?$/i,
    ],
    build: (m) => ({ type: "click", target: unquote(m[1]), kind: clickKind(m[2]) }),
  },
  {
    id: "choose",
    zh: "选择 北京", en: "choose Beijing",
    re: [/^(?:选择|选取|选)\s*(.+)$/, /^(?:select|pick|choose)\s+(?:the\s+)?(.+)$/i],
    build: (m) => ({ type: "click", target: unquote(m[1]), kind: null }),
  },
  {
    id: "waitVisible",
    zh: "等待 列表 加载完成", en: "wait for the list to appear",
    re: [/^(?:等待|等到|直到)\s*(.+?)\s*(?:出现|显示|加载完成|加载完毕|可见|渲染完成|消失)$/, /^wait\s+(?:for\s+|until\s+)?(?:the\s+)?(.+?)\s+(?:to\s+)?(?:appear|appears|show|shows|be\s+visible|is\s+visible|load|loads)$/i],
    build: (m, rule, idx, text) => ({ type: /消失$/.test(text) ? "expectHidden" : "waitVisible", text: unquote(m[1]) }),
  },
  {
    id: "wait",
    zh: "等待 2 秒", en: "wait 2 seconds",
    re: [/^(?:等待|等|暂停|延时|sleep|wait|pause)\s*(?:for\s+)?(\d+(?:\.\d+)?)\s*(秒钟?|s|sec|secs|seconds?|毫秒|ms|milliseconds?|分钟?|min|minutes?)?\s*$/i],
    build: (m) => {
      const n = Number(m[1]);
      const u = (m[2] || "s").toLowerCase();
      const ms = /^(毫秒|ms|millisecond)/.test(u) ? n : /^(分|min)/.test(u) ? n * 60000 : n * 1000;
      return { type: "wait", ms: Math.round(ms) };
    },
  },
  {
    id: "reload",
    zh: "刷新页面", en: "reload the page",
    re: [/^(?:刷新|重新加载|重载)\s*(?:当前)?\s*(?:页面|网页)?$/, /^(?:reload|refresh)(?:\s+(?:the\s+)?page)?$/i],
    build: () => ({ type: "reload" }),
  },
  {
    id: "back",
    zh: "返回上一页", en: "go back",
    re: [/^(?:返回|后退|回退)\s*(?:上一页|上级页面|上级|浏览器)?$/, /^(?:go\s+)?back(?:\s+(?:to\s+)?(?:the\s+)?previous\s+page)?$/i],
    build: () => ({ type: "back" }),
  },
  {
    id: "scrollBottom",
    zh: "滚动到底部", en: "scroll to the bottom",
    re: [/^(?:滚动|滚|下拉|滑动)\s*(?:页面)?\s*(?:到|至)?\s*(?:页面)?(?:底部|最底部|最下方|底)$/, /^scroll\s+(?:down\s+)?to\s+(?:the\s+)?bottom(?:\s+of\s+the\s+page)?$/i],
    build: () => ({ type: "scrollBottom" }),
  },
  {
    id: "scroll",
    zh: "滚动到 评论区", en: "scroll to Comments",
    re: [/^(?:滚动|滚|滑动)\s*(?:页面)?\s*(?:到|至)\s*(.+?)\s*(?:处|位置)?$/, /^scroll\s+(?:down\s+)?to\s+(?:the\s+)?(.+)$/i],
    build: (m) => ({ type: "scroll", target: unquote(m[1]) }),
  },
  {
    id: "screenshot",
    zh: "截图", en: "take a screenshot",
    re: [/^(?:截图|截屏|保存截图)$/, /^(?:take\s+(?:a\s+)?)?screenshot$/i],
    build: () => ({ type: "screenshot" }),
  },
];

const KIND_SUFFIX = /^(.*?)\s*(按钮|链接|菜单项|菜单|选项卡|标签页|页签|图标|复选框|单选框|输入框|文本框|下拉框|标题|button|link|tab|icon|menu\s+item|menu|checkbox|radio|input|field|textbox|dropdown|heading)$/i;
const KIND_MAP = { 按钮: "button", button: "button", 链接: "link", link: "link", 选项卡: "tab", 标签页: "tab", 页签: "tab", tab: "tab", 菜单项: "menuitem", 菜单: "menuitem", menu: "menuitem", "menu item": "menuitem", 复选框: "checkbox", checkbox: "checkbox", 单选框: "radio", radio: "radio", 输入框: "textbox", 文本框: "textbox", input: "textbox", field: "textbox", textbox: "textbox", 下拉框: "combobox", dropdown: "combobox", 标题: "heading", heading: "heading", 图标: null, icon: null };
export function splitKind(text) {
  const m = KIND_SUFFIX.exec(text);
  if (!m || !m[1]) return { text, kind: null };
  const k = m[2].toLowerCase().replace(/\s+/g, " ");
  return { text: m[1].trim(), kind: KIND_MAP[k] ?? KIND_MAP[m[2]] ?? null };
}

// ---- assertions ----------------------------------------------------------
const NEG = "(?:不显示|不出现|不展示|看不到|看不见|不应(?:该)?(?:显示|出现|展示|看到)|未显示|未出现|没有显示|不存在|不包含|不含|没有|无|不再显示|不再出现|隐藏)";
const POS = "(?:显示|出现|展示|看到|看见|提示|弹出|弹窗提示|toast提示|有|包含|含有|存在|可见|可以看到|能看到|应(?:该)?(?:显示|出现|看到|提示)|正确显示|成功显示|展现|呈现|返回)";
const PRE = "^(?:断言|验证|检查|确认|校验|期望|预期|应该|应当|应|assert(?:\\s+that)?|expect(?:\\s+that)?|verify(?:\\s+that)?|check(?:\\s+that)?|ensure(?:\\s+that)?|should\\s+see)?\\s*(?:页面|系统|界面|当前页面|页面上|the\\s+page|page|user|用户|screen|it)?\\s*";
const SUF = "\\s*(?:的)?(?:提示|提示语|提示信息|文案|文本|信息|消息|字样|弹窗|toast|提示框|内容|页面|页)?\\s*$";

const E = [
  {
    id: "expectUrl",
    zh: "跳转到 /home  ·  URL 包含 dashboard  ·  跳转到 首页", en: "redirected to /home  ·  url contains dashboard",
    re: [
      /^(?:断言|验证|检查|确认)?\s*(?:页面|浏览器|系统)?\s*(?:成功)?(?:跳转到|跳转至|跳到|进入|进入到|重定向到|回到|返回到|打开|停留在|留在|仍在|仍然在|还在|位于|处于)\s*(.+?)\s*$/,
      /^(?:断言|验证|检查)?\s*(?:当前)?\s*(?:页面)?\s*(?:url|地址|链接|网址|路径)\s*(?:为|是|包含|含|含有|变为|等于|应为|应该是|应包含|[:：=])\s*(.+)$/i,
      /^(?:(?:the\s+)?(?:page|browser|current)\s+)?(?:url|address|path|location)\s+(?:should\s+)?(?:contains?|includes?|is|equals?|be(?:comes?)?|matches|changes?\s+to)\s+(.+)$/i,
      /^(?:(?:the\s+)?(?:user|page|browser|it)\s+)?(?:is\s+|should\s+be\s+|gets?\s+)?(?:redirect(?:s|ed)?|navigates?|navigated|taken|goes|go|lands?|returns?|sent)\s+(?:back\s+)?to\s+(?:the\s+)?(.+?)(?:\s+page)?$/i,
      /^(?:stays?|remains?|still)\s+on\s+(?:the\s+)?(.+?)(?:\s+page)?$/i,
    ],
    build: (m, rule, idx) => {
      const t = unquote(m[1]);
      if (looksLikeUrl(t)) return { type: "expectUrl", target: t, mode: "url" };
      return { type: "expectUrl", target: t, mode: idx === 1 || idx === 2 ? "contains" : "route" };
    },
  },
  {
    id: "expectTitle",
    zh: "标题为 后台首页", en: "title is Dashboard",
    re: [/^(?:页面|浏览器|网页)?\s*标题\s*(?:为|是|显示为|包含|含|应为|应该是|[:：=])\s*(.+)$/, /^(?:(?:the\s+)?(?:page|tab|window)\s+)?title\s+(?:should\s+)?(?:be|is|contains?|includes?|equals?|reads?|shows?)\s+(.+)$/i],
    build: (m) => ({ type: "expectTitle", text: unquote(m[1]) }),
  },
  {
    id: "expectHidden",
    zh: "不显示 删除 按钮  ·  加载中 消失", en: "Delete button is not visible  ·  the spinner disappears",
    re: [
      new RegExp(`${PRE}${NEG}\\s*[:：]?\\s*(?:提示|文案|文本|信息|消息|toast)?\\s*[:：]?\\s*(.+?)${SUF}`),
      /^(.+?)\s*(?:消失|隐藏|不可见|不再显示|不再出现|被隐藏|已隐藏|不显示|不出现|不存在|不展示)$/,
      /^(?:(?:the\s+)?(.+?)\s+)?(?:is|are|should\s+be|becomes?|stays?)\s+(?:not\s+(?:visible|shown|displayed|present)|hidden|invisible|gone)$/i,
      /^(?:(?:the\s+)?(.+?)\s+)?(?:disappears?|vanishes?|is\s+removed|should\s+not\s+(?:be\s+)?(?:appear|show|display|visible|exist))$/i,
      /^(?:do\s+not|does\s+not|don't|doesn't|should\s+not|shouldn't|no)\s+(?:see|show|display|contain|have)\s+(?:the\s+|a\s+|an\s+)?(.+)$/i,
    ],
    build: (m) => ({ type: "expectHidden", text: unquote(m[1]) }),
  },
  {
    id: "expectDisabled",
    zh: "提交 按钮不可用", en: "the Submit button is disabled",
    re: [/^(.+?)\s*(?:不可用|不可点击|不可操作|置灰|灰显|变灰|禁用|被禁用|处于禁用状态|不可编辑|只读|为禁用状态)$/, /^(?:the\s+)?(.+?)\s+(?:is|are|should\s+be|becomes?|stays?)\s+(?:disabled|greyed\s+out|grayed\s+out|inactive|read[-\s]?only|not\s+clickable)$/i],
    build: (m) => ({ type: "expectDisabled", ...splitKind(unquote(m[1])).text ? { target: splitKind(unquote(m[1])).text, kind: splitKind(unquote(m[1])).kind } : { target: "" }, disabled: true }),
  },
  {
    id: "expectEnabled",
    zh: "提交 按钮可用", en: "the Submit button is enabled",
    re: [/^(.+?)\s*(?:可用|可点击|可操作|高亮|启用|被启用|变为可用|恢复可用|可编辑|为可用状态)$/, /^(?:the\s+)?(.+?)\s+(?:is|are|should\s+be|becomes?)\s+(?:enabled|clickable|active|editable)$/i],
    build: (m) => ({ type: "expectDisabled", ...splitKind(unquote(m[1])).text ? { target: splitKind(unquote(m[1])).text, kind: splitKind(unquote(m[1])).kind } : { target: "" }, disabled: false }),
  },
  {
    id: "expectChecked",
    zh: "记住我 已勾选", en: "Remember me is checked",
    re: [/^(.+?)\s*(?:复选框|选项|开关)?\s*(?:被选中|已选中|已勾选|处于选中状态|为选中状态|是选中的|默认选中|默认勾选|打开状态|已开启|开启)$/, /^(?:(?:the\s+)?(.+?)\s+)(?:checkbox\s+|option\s+|toggle\s+|switch\s+)?(?:is|should\s+be|becomes?)\s+(?:checked|selected|ticked|on)$/i],
    build: (m) => ({ type: "expectChecked", label: unquote(m[1]), checked: true }),
  },
  {
    id: "expectUnchecked",
    zh: "记住我 未勾选", en: "Remember me is unchecked",
    re: [/^(.+?)\s*(?:复选框|选项|开关)?\s*(?:未选中|未被选中|未勾选|取消选中|处于未选中状态|默认不选中|关闭状态|已关闭|关闭)$/, /^(?:(?:the\s+)?(.+?)\s+)(?:checkbox\s+|option\s+|toggle\s+|switch\s+)?(?:is|should\s+be|becomes?)\s+(?:unchecked|not\s+checked|unselected|not\s+selected|off)$/i],
    build: (m) => ({ type: "expectChecked", label: unquote(m[1]), checked: false }),
  },
  {
    id: "expectValue",
    zh: "用户名 输入框的值为 admin  ·  金额 显示为 100.00", en: "the Email field contains a@b.c",
    re: [
      /^(.+?)\s*(?:输入框|文本框|框|字段|栏)?\s*(?:的)?(?:值|内容|文本)?\s*(?:为|是|显示为|等于|应为|应该是|变为|保留为|回显为|[:：=])\s*(.+)$/,
      /^(?:the\s+)?(.+?)\s+(?:field|input|box|textbox|textarea)\s+(?:value\s+)?(?:should\s+)?(?:contain|contains|equal|equals|be|is|show|shows|read|reads|display|displays|has|have)\s+(.+)$/i,
      /^(?:the\s+)?value\s+of\s+(?:the\s+)?(.+?)\s+(?:field\s+|input\s+)?(?:should\s+)?(?:be|is|equals?|contains?)\s+(.+)$/i,
    ],
    build: (m, rule, idx, text) => {
      const field = unquote(m[1]);
      const value = unquote(m[2]);
      // "按钮 显示为 加载中" / "页面 显示 xxx" are visibility checks, not input values
      if (/(输入框|文本框|框|字段|栏|的值|value|field|input|box)/i.test(text.slice(0, text.indexOf(m[2])))) return { type: "expectValue", field: field.replace(/(输入框|文本框|框|字段|栏)$/, ""), value };
      return { type: "expectVisible", text: value, within: field };
    },
  },
  {
    id: "expectVisible",
    zh: "显示 登录成功  ·  提示「密码错误」  ·  看到 欢迎回来", en: "see Welcome back  ·  the message Invalid password is shown",
    re: [
      new RegExp(`${PRE}${POS}\\s*[:：]?\\s*(?:提示|提示语|文案|文本|信息|消息|toast|弹窗|错误提示|错误信息|成功提示)?\\s*[:：]?\\s*(.+?)${SUF}`),
      /^(.+?)\s*(?:显示|出现|可见|存在|展示|正常显示|正确显示|被展示|已显示|高亮显示|呈现)$/,
      /^(?:(?:the\s+)?(?:message|text|toast|alert|error|notification|label|banner|title|heading)\s+)?["“'](.+?)["”']\s+(?:is\s+|should\s+be\s+|should\s+)?(?:shown|displayed|visible|appears?|present)$/i,
      /^(?:(?:the\s+)?(?:message|text|toast|alert|error|notification|label|banner|title|heading)\s+)?(?:(?:the\s+)?(.+?)\s+)?(?:is|are|should\s+be|becomes?|gets?|appears?\s+as)\s+(?:visible|shown|displayed|present|rendered|on\s+(?:the\s+)?(?:screen|page))$/i,
      /^(?:(?:the\s+)?(.+?)\s+)?(?:appears?|shows?\s+up|pops?\s+up|is\s+listed|exists?)$/i,
      /^(?:i\s+|user\s+|we\s+)?(?:can\s+|should\s+|will\s+)?(?:see|sees|view)\s+(?:the\s+|a\s+|an\s+)?(?:message\s+|text\s+|toast\s+|alert\s+|error\s+|page\s+)?(.+)$/i,
      /^(?:(?:the\s+)?page\s+|it\s+)?(?:shows?|displays?|contains?|includes?|has|renders?|lists?)\s+(?:the\s+|a\s+|an\s+)?(?:message\s+|text\s+|toast\s+|alert\s+|error\s+)?(.+)$/i,
    ],
    build: (m) => ({ type: "expectVisible", text: unquote(m[1]) }),
  },
];

for (const r of E) {
  if (r.id === "expectVisible" || r.id === "expectHidden") {
    const b = r.build;
    r.build = (...a) => {
      const ast = b(...a);
      if (!ast || !ast.text) return ast;
      const { text, kind } = splitKind(ast.text);
      return { ...ast, text, kind };
    };
  }
}


export const ACTIONS = A;
export const ASSERTIONS = E;

function run(rules, text) {
  for (const rule of rules) {
    for (let i = 0; i < rule.re.length; i++) {
      const m = rule.re[i].exec(text);
      if (!m) continue;
      const ast = rule.build(m, rule, i, text);
      if (!ast) continue;
      if (["text", "target", "field", "label", "option", "file", "key"].some((k) => k in ast && (ast[k] === "" || ast[k] === null) && !(k === "field" && ast.type === "upload") && !(k === "file"))) continue;
      return { ...ast, rule: rule.id, raw: text };
    }
  }
  return null;
}

const ASSERT_PREFIX = /^(?:断言|验证|检查|确认|校验|期望|预期|assert|expect|verify|check\s+that|ensure|should)\b/i;

// Project rules from casesheet.config.json → rules, tried before the built-in grammar, in order.
function runCustom(rules, text, kind) {
  for (const r of rules || []) {
    if (r.kind !== kind) continue;
    const re = r.re || new RegExp(r.match, r.flags || "");
    const m = re.exec(text);
    if (m) return { type: "custom", name: r.name || r.match, code: r.code, py: r.py || null, groups: Array.from(m, (g) => g ?? ""), rule: `custom:${r.name || r.match}`, raw: text };
  }
  return null;
}

export function parseStep(text, rules) {
  const t = String(text).trim();
  if (!t) return { type: "noop", raw: t };
  const custom = runCustom(rules, t, "step") || runCustom(rules, t, "expect");
  if (custom) return custom;
  // Steps can carry assertions too ("验证 显示 登录成功")
  if (ASSERT_PREFIX.test(t)) return run(E, t) || run(A, t) || { type: "unknown", raw: t };
  return run(A, t) || run(E, t) || { type: "unknown", raw: t };
}

export function parseExpectation(text, rules) {
  const t = String(text).trim();
  if (!t) return { type: "noop", raw: t };
  const custom = runCustom(rules, t, "expect") || runCustom(rules, t, "step");
  if (custom) return custom;
  return run(E, t) || run(A, t) || { type: "unknown", raw: t };
}

export function grammarTable() {
  const rows = [];
  for (const r of A) rows.push({ kind: "action", id: r.id, zh: r.zh, en: r.en });
  for (const r of E) rows.push({ kind: "assert", id: r.id, zh: r.zh, en: r.en });
  return rows;
}
