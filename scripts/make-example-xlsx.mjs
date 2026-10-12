// Regenerates examples/login.xlsx from examples/login.md (dev helper, not shipped).
import fs from "node:fs";
import path from "node:path";
import { parseMarkdown } from "../src/readers/markdown.js";
import { xlsx } from "../test/helpers/xlsx-writer.js";
const here = path.dirname(new URL(import.meta.url).pathname);
const { tables } = parseMarkdown(fs.readFileSync(path.join(here, "../examples/login.md"), "utf8"));
const headers = ["模块", ...tables[0].headers];
const rows = [headers];
for (const t of tables) for (const r of t.rows) {
  const byName = Object.fromEntries(t.headers.map((h, i) => [h, r.cells[i]]));
  rows.push([t.heading, ...tables[0].headers.map((h) => byName[h] ?? "")]);
}
fs.writeFileSync(path.join(here, "../examples/login.xlsx"), xlsx(rows, { sheetName: "登录", sharedAll: true }));
console.log(`wrote examples/login.xlsx (${rows.length - 1} rows)`);
