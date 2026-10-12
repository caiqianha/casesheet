import fs from "node:fs";
import path from "node:path";
import { parseMarkdown } from "./markdown.js";
import { parseCsv } from "./csv.js";
import { parseJson } from "./json.js";
import { parseXlsx } from "./xlsx.js";

export function readTables(file, opts = {}) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".xls") throw new Error(`${file}: legacy .xls is not supported, save it as .xlsx`);
  if (![".xlsx", ".xlsm", ".md", ".markdown", ".csv", ".tsv", ".txt", ".json"].includes(ext)) throw new Error(`${file}: unsupported file type "${ext}" (use .md, .csv, .tsv, .json or .xlsx)`);
  if (ext === ".xlsx" || ext === ".xlsm") return parseXlsx(fs.readFileSync(file), opts);
  const text = fs.readFileSync(file, "utf8");
  if (ext === ".md" || ext === ".markdown") return parseMarkdown(text);
  if (ext === ".csv" || ext === ".tsv" || ext === ".txt") return parseCsv(text, ext === ".tsv" ? "\t" : undefined);
  if (ext === ".json") return parseJson(text);
}
