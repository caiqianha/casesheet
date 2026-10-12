// Map the sheet's header row onto the fields casesheet understands.
// Headers are matched after lowercasing and stripping spaces/punctuation, so
// "用例 ID", "Case ID", "case_id" and "caseid" all land on `id`.

const ALIASES = {
  id: ["id", "caseid", "testcaseid", "tcid", "tc", "no", "num", "用例id", "用例编号", "编号", "用例号", "序号", "用例序号", "case", "casenumber"],
  title: ["title", "name", "casename", "testcase", "testcasename", "summary", "scenario", "用例名称", "用例标题", "标题", "名称", "用例", "测试点", "功能点", "测试项", "检查点", "场景"],
  module: ["module", "feature", "suite", "page", "component", "area", "模块", "功能模块", "所属模块", "子模块", "页面", "功能", "一级模块", "二级模块", "所属功能"],
  precondition: ["precondition", "preconditions", "prerequisite", "prerequisites", "setup", "given", "前置条件", "前提条件", "前置", "预置条件", "前提", "预设条件"],
  steps: ["steps", "step", "teststeps", "actions", "action", "when", "procedure", "操作步骤", "测试步骤", "步骤", "执行步骤", "操作", "步骤描述", "操作描述", "输入"],
  expected: ["expected", "expectedresult", "expectedresults", "expectation", "then", "result", "results", "预期结果", "预期", "期望结果", "期望", "预期输出", "预期效果", "期望输出"],
  priority: ["priority", "level", "severity", "p", "pri", "优先级", "级别", "等级", "用例等级", "重要程度"],
  tags: ["tags", "tag", "labels", "label", "type", "category", "标签", "类型", "用例类型", "分类"],
  data: ["data", "testdata", "params", "parameters", "input", "inputs", "测试数据", "数据", "参数", "输入数据"],
  notes: ["notes", "note", "remark", "remarks", "comment", "comments", "备注", "说明", "注释"],
  actual: ["actual", "actualresult", "status", "result_status", "实际结果", "执行结果", "状态", "是否通过", "测试结果"],
};

const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[\s_\-()（）:：*#./\\]/g, "")
    .replace(/[?？!！]/g, "");

export function mapColumns(headers) {
  const map = {};
  const used = new Set();
  const extra = [];
  const normed = headers.map(norm);
  for (const [field, names] of Object.entries(ALIASES)) {
    let idx = normed.findIndex((h, i) => !used.has(i) && names.includes(h));
    if (idx < 0) idx = normed.findIndex((h, i) => !used.has(i) && h && names.some((n) => n.length > 1 && (h.startsWith(n) || h.endsWith(n))));
    if (idx >= 0) {
      map[field] = idx;
      used.add(idx);
    }
  }
  headers.forEach((h, i) => {
    if (!used.has(i) && h) extra.push({ name: h, index: i });
  });
  return { map, extra };
}

export const FIELDS = Object.keys(ALIASES);
