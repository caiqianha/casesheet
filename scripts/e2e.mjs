// End-to-end proof: generate specs from examples/login.md, run them with a real
// Playwright against examples/site. Installs @playwright/test into ./.e2e (gitignored).
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dir = path.join(root, ".e2e");
const sh = (cmd, cwd = dir) => {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, CASESHEET_USER: "admin", CASESHEET_PASS: "123456" } });
};
fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(path.join(dir, "node_modules", "@playwright", "test"))) {
  if (!fs.existsSync(path.join(dir, "package.json"))) fs.writeFileSync(path.join(dir, "package.json"), '{ "name": "casesheet-e2e", "private": true }\n');
  sh("npm i -D @playwright/test@latest --no-audit --no-fund");
  sh(`npx playwright install ${process.env.CI ? "--with-deps " : ""}chromium`);
}
fs.writeFileSync(
  path.join(dir, "playwright.config.ts"),
  `import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  timeout: 20000,
  reporter: [['list'], ['json', { outputFile: 'results.json' }]],
  use: { baseURL: 'http://localhost:4173' },
  webServer: { command: 'node ${path.join(root, "examples", "serve.mjs").replace(/\\/g, "/")}', url: 'http://localhost:4173/login', reuseExistingServer: true },
});
`,
);
fs.rmSync(path.join(dir, "tests"), { recursive: true, force: true });
const lang = process.argv.includes("--js") ? "--js" : "";
sh(`node ${path.join(root, "bin", "casesheet.js")} build login.md -o ${path.join(dir, "tests", "casesheet")} ${lang}`, path.join(root, "examples"));
sh("npx playwright test");
sh(`node ${path.join(root, "bin", "casesheet.js")} report results.json --csv results.csv`);
