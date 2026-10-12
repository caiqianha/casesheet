// JSON: an array of objects, or { cases: [...] }. Keys become headers.
export function parseJson(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : Array.isArray(data?.cases) ? data.cases : null;
  if (!list) throw new Error("JSON must be an array of cases or { cases: [...] }");
  const headers = [];
  for (const item of list) for (const k of Object.keys(item)) if (!headers.includes(k)) headers.push(k);
  const rows = list.map((item, i) => ({
    cells: headers.map((h) => {
      const v = item[h];
      if (v == null) return "";
      if (Array.isArray(v)) return v.map(String).join("\n");
      return String(v);
    }),
    line: i + 1,
  }));
  return { tables: [{ headers, rows, heading: "", line: 0 }] };
}
