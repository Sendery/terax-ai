import { GridRenderer, splitFrames } from "./renderer.js";
import { Terminal } from "/xterm/lib/xterm.mjs";
import { WebglAddon } from "/xterm-webgl/lib/addon-webgl.mjs";

const KINDS = ["ascii", "sgr", "tui"];
const FONT = "Menlo, monospace";
const stage = document.getElementById("stage");
const status = document.getElementById("status");
const say = (text) => {
  status.textContent = text;
};
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const load = async (name) => (await fetch(`/data/${name}`)).arrayBuffer();

function makeCanvas(renderer, cols, rows, across, down) {
  const canvas = renderer.canvas;
  canvas.width = cols * renderer.cellW * across;
  canvas.height = rows * renderer.cellH * down;
  canvas.style.width = `${canvas.width / renderer.dpr}px`;
  canvas.style.height = `${canvas.height / renderer.dpr}px`;
}

function intervals(stamps) {
  const gaps = [];
  for (let i = 1; i < stamps.length; i++) gaps.push(stamps[i] - stamps[i - 1]);
  gaps.sort((a, b) => a - b);
  const total = stamps[stamps.length - 1] - stamps[0];
  return {
    frames: gaps.length,
    fps: +((gaps.length / total) * 1000).toFixed(1),
    p50_ms: +gaps[Math.floor(gaps.length * 0.5)].toFixed(1),
    p95_ms: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1),
    max_ms: +gaps[gaps.length - 1].toFixed(1),
  };
}

// Every frame is applied and drawn back to back: the main-thread cost of
// showing the whole payload, with no frame skipped.
async function ghosttySync(kind) {
  const frames = splitFrames(await load(`${kind}-200x60.frames`));
  const canvas = document.createElement("canvas");
  stage.replaceChildren(canvas);
  const renderer = new GridRenderer(canvas, { fontFamily: FONT, fontSize: 13 });
  makeCanvas(renderer, 200, 60, 1, 1);
  const pane = renderer.addPane(0, 0);
  renderer.applyFrame(pane, frames[0]);
  renderer.draw();
  renderer.flush();
  await nextFrame();
  const start = performance.now();
  for (const frame of frames) {
    renderer.applyFrame(pane, frame);
    renderer.draw();
  }
  renderer.flush();
  const total = performance.now() - start;
  await nextFrame();
  return {
    frames: frames.length,
    total_ms: +total.toFixed(1),
    ms_per_frame: +(total / frames.length).toFixed(3),
    atlas_glyphs: renderer.atlas.slots.size,
    atlas_uploads: renderer.atlas.uploads,
  };
}

// Twelve panes on one canvas, each receiving a new frame on every animation
// frame: what a wall of busy agent panes asks of the renderer.
async function ghosttyPanes(kind, across, down) {
  const frames = splitFrames(await load(`${kind}-100x30.frames`));
  const canvas = document.createElement("canvas");
  stage.replaceChildren(canvas);
  const renderer = new GridRenderer(canvas, { fontFamily: FONT, fontSize: 9 });
  makeCanvas(renderer, 100, 30, across, down);
  const panes = [];
  for (let j = 0; j < down; j++) {
    for (let i = 0; i < across; i++) {
      panes.push(renderer.addPane((i * 100 * renderer.cellW) / renderer.dpr, (j * 30 * renderer.cellH) / renderer.dpr));
    }
  }
  const stamps = [];
  let work = 0;
  for (let n = 0; n < frames.length; n++) {
    stamps.push(await nextFrame());
    const t = performance.now();
    for (let p = 0; p < panes.length; p++) {
      renderer.applyFrame(panes[p], frames[(n + p * 7) % frames.length]);
    }
    renderer.draw();
    work += performance.now() - t;
  }
  renderer.flush();
  return { panes: panes.length, work_ms_per_frame: +(work / frames.length).toFixed(2), ...intervals(stamps) };
}

function writeAll(term, bytes) {
  const CHUNK = 64 * 1024;
  return new Promise((resolve) => {
    let off = 0;
    const step = () => {
      if (off >= bytes.length) return resolve();
      const chunk = bytes.subarray(off, off + CHUNK);
      off += CHUNK;
      term.write(chunk, step);
    };
    step();
  });
}

async function xterm(kind, count, cols, rows, fontSize) {
  const bytes = new Uint8Array(await load(`${kind}.bin`));
  stage.replaceChildren();
  const terms = [];
  let contextsLost = 0;
  for (let i = 0; i < count; i++) {
    const host = document.createElement("div");
    host.className = "xt";
    stage.appendChild(host);
    const term = new Terminal({ cols, rows, fontFamily: FONT, fontSize, scrollback: 10000, allowProposedApi: true });
    term.open(host);
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => contextsLost++);
    term.loadAddon(webgl);
    terms.push(term);
  }
  await nextFrame();
  const stamps = [];
  let running = true;
  const tick = (t) => {
    stamps.push(t);
    if (running) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const start = performance.now();
  await Promise.all(terms.map((term) => writeAll(term, bytes)));
  const total = performance.now() - start;
  running = false;
  await nextFrame();
  for (const term of terms) term.dispose();
  return {
    terminals: count,
    bytes: bytes.length,
    total_ms: +total.toFixed(1),
    mb_s_per_terminal: +(bytes.length / 1048576 / (total / 1000)).toFixed(1),
    contexts_lost: contextsLost,
    ...(stamps.length > 2 ? intervals(stamps) : { frames: stamps.length }),
  };
}

async function main() {
  const results = { userAgent: navigator.userAgent, dpr: devicePixelRatio, tests: {} };
  const run = async (name, fn) => {
    say(name);
    await nextFrame();
    try {
      results.tests[name] = await fn();
    } catch (error) {
      results.tests[name] = { error: String(error) };
    }
  };
  for (const kind of KINDS) {
    await run(`ghostty_sync_1x200x60_${kind}`, () => ghosttySync(kind));
    await run(`xterm_1x200x60_${kind}`, () => xterm(kind, 1, 200, 60, 13));
  }
  await run("ghostty_12x100x30_tui", () => ghosttyPanes("tui", 4, 3));
  await run("ghostty_12x100x30_sgr", () => ghosttyPanes("sgr", 4, 3));
  await run("xterm_5x100x30_tui", () => xterm("tui", 5, 100, 30, 9));
  await run("xterm_5x100x30_sgr", () => xterm("sgr", 5, 100, 30, 9));
  await run("xterm_12x100x30_tui", () => xterm("tui", 12, 100, 30, 9));
  await run("final_view", () => ghosttySync("sgr"));
  delete results.tests.final_view;
  await fetch("/result", { method: "POST", body: JSON.stringify(results, null, 2) });
  say("done");
  window.__done = true;
}

main();
