// Zero-dependency static server for examples/site: every path serves index.html.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const root = path.join(path.dirname(new URL(import.meta.url).pathname), "site");
const port = Number(process.env.PORT || 4173);
http.createServer((req, res) => {
  const file = path.join(root, path.extname(req.url) ? req.url.split("?")[0] : "index.html");
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" });
    res.end(data);
  });
}).listen(port, () => console.log(`demo site on http://localhost:${port}`));
