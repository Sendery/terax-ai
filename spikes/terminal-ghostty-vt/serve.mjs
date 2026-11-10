// Static server for the renderer benchmark. Serves the page, the generated
// data and the xterm.js bundles, and stores the results the page posts back.
import { createServer } from "node:http";
import { createReadStream, existsSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const [dataDir, xtermModules, resultPath, port = "4517"] = process.argv.slice(2);
if (!dataDir || !xtermModules || !resultPath) {
  console.error("Usage: serve.mjs <data dir> <node_modules/@xterm dir> <result.json> [port]");
  process.exit(2);
}
const roots = [
  ["/data/", resolve(dataDir)],
  ["/xterm-webgl/", join(resolve(xtermModules), "addon-webgl")],
  ["/xterm/", join(resolve(xtermModules), "xterm")],
  ["/", resolve(import.meta.dirname, "web")],
];
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" };

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (req.method === "POST" && path === "/result") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      writeFileSync(resultPath, Buffer.concat(chunks));
      res.end("ok");
    });
    return;
  }
  for (const [prefix, root] of roots) {
    if (!path.startsWith(prefix)) continue;
    const file = normalize(join(root, path.slice(prefix.length)));
    if (!file.startsWith(root) || !existsSync(file)) break;
    res.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(file).pipe(res);
    return;
  }
  res.writeHead(404).end();
}).listen(Number(port), "127.0.0.1", () => console.log(`listening on http://127.0.0.1:${port}`));
