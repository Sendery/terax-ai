import { readFileSync } from "node:fs";
import pkg from "@xterm/headless";
const { Terminal } = pkg;
const [file, cols, rows] = process.argv.slice(2);
const data = readFileSync(file);
const CHUNK = 64 * 1024;
let best = Infinity;
for (let run = 0; run < 3; run++) {
  const term = new Terminal({ cols: +cols, rows: +rows, scrollback: 10000, allowProposedApi: true });
  const start = performance.now();
  await new Promise((resolve) => {
    let off = 0;
    const next = () => {
      if (off >= data.length) return resolve();
      const chunk = data.subarray(off, off + CHUNK);
      off += CHUNK;
      term.write(chunk, next);
    };
    next();
  });
  best = Math.min(best, performance.now() - start);
  term.dispose();
}
console.log(JSON.stringify({ file, bytes: data.length, parse_mb_s: +(data.length / 1048576 / (best / 1000)).toFixed(1) }));
