import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const modulePath = process.argv[2];
const reportPath = process.argv[3];
const corePath = process.argv[4];
if (!modulePath || !reportPath || !corePath) {
  throw new Error('usage: node verify.mjs <module.wasm> <report.json> <core.wasm>');
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const coreBytes = fs.readFileSync(corePath);
const archiveBytes = fs.readFileSync(path.resolve(path.dirname(corePath), '../lib/libghostty-vt.a'));
const coreModule = await WebAssembly.compile(coreBytes);
assert.deepEqual(WebAssembly.Module.imports(coreModule),
  [{ module: 'env', name: 'log', kind: 'function' }]);
const core = await WebAssembly.instantiate(coreModule, {
  env: { log: () => { throw new Error('unexpected core ABI log'); } },
});
const abiPointer = core.exports.ghostty_type_json();
const coreMemory = new Uint8Array(core.exports.memory.buffer);
const abiEnd = coreMemory.indexOf(0, abiPointer);
assert(abiPointer > 0 && abiEnd > abiPointer && abiEnd - abiPointer < 1024 * 1024);
const abi = JSON.parse(new TextDecoder().decode(coreMemory.subarray(abiPointer, abiEnd)));
assert.equal(Object.keys(abi).length, 34, 'pinned ABI metadata changed');
const bindings = fs.readFileSync(path.join(here, 'target/sys/src/bindings_wasm32.rs'), 'utf8');
let layoutAssertions = 0;
for (const [type, layout] of Object.entries(abi)) {
  const rustType = type.replace(/^Ghostty/, '');
  for (const [key, label] of [['size', 'Size of'], ['align', 'Alignment of']]) {
    const prefix = JSON.stringify(`${label} ${rustType}`);
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\[${escaped}\\]\\s*\\[[^\\]]*? -\\s*(\\d+)usize\\]`);
    const match = bindings.match(pattern);
    assert(match, `missing generated ${label} ${rustType} assertion`);
    assert.equal(Number(match[1]), layout[key], `${type} ${key} differs from Zig ABI`);
    layoutAssertions += 1;
  }
}
assert.equal(layoutAssertions, 68);
const bytes = fs.readFileSync(modulePath);
const module = await WebAssembly.compile(bytes);
const imports = WebAssembly.Module.imports(module);
const exports = WebAssembly.Module.exports(module);
assert.deepEqual(imports, [{ module: 'env', name: 'log', kind: 'function' }]);
assert.deepEqual(exports.map((item) => item.name).sort(),
  ['clear_frame', 'frame_len', 'memory', 'run_case']);
let logCalls = 0;
const { exports: e } = await WebAssembly.instantiate(module, {
  env: { log: () => { logCalls += 1; } },
});
const fixtures = ['plain-text', 'styled-truecolor', 'wide-combining'];
const cases = [];
const memoryBefore = e.memory.buffer.byteLength;
let maxMemory = memoryBefore;
for (let repeat = 0; repeat < 100; repeat++) {
  for (let i = 0; i < fixtures.length; i++) {
    const pointer = e.run_case(i);
    const length = e.frame_len();
    assert(pointer > 0, `${fixtures[i]} returned no frame`);
    const actual = Buffer.from(new Uint8Array(e.memory.buffer, pointer, length));
    const expected = fs.readFileSync(path.join(repo,
      `tests/fixtures/terminal-frames/${fixtures[i]}.frame`));
    assert.deepEqual(actual, expected, `${fixtures[i]}, repetition ${repeat}`);
    if (repeat === 0) cases.push({ fixture: fixtures[i], bytes: length, sha256: sha256(actual) });
    maxMemory = Math.max(maxMemory, e.memory.buffer.byteLength);
  }
  e.clear_frame();
  assert.equal(e.frame_len(), 0);
}
assert(e.run_case(0) > 0);
assert.equal(e.run_case(0xffffffff), 0);
assert.equal(e.frame_len(), 0, 'a failed case must clear the previous frame');
assert.equal(logCalls, 0, 'unexpected core log callback; investigate before accepting');
const digest = (relative) => sha256(fs.readFileSync(path.join(repo, relative)));
const report = {
  schema: 1,
  observedAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  ghosttyCommit: 'a887df42c56f6de86c0fe6da9c4eeca37931e083',
  sourceTreeDirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: repo, encoding: 'utf8' }).trim().length > 0,
  node: process.version,
  rust: execFileSync('rustc', ['--version'], { encoding: 'utf8' }).trim(),
  module: { bytes: bytes.length, sha256: sha256(bytes), imports, exports },
  core: { bytes: coreBytes.length, sha256: sha256(coreBytes), abiTypes: 34, layoutAssertions },
  inputArchive: { bytes: archiveBytes.length, sha256: sha256(archiveBytes) },
  sources: {
    manifest: digest('spikes/terminal-ghostty-vt/wasm/Cargo.toml'),
    wrapper: digest('spikes/terminal-ghostty-vt/wasm/src/lib.rs'),
    prepare: digest('spikes/terminal-ghostty-vt/wasm/prepare.py'),
    verifier: digest('spikes/terminal-ghostty-vt/wasm/verify.mjs'),
    frame: digest('src-tauri/src/modules/pty/engine/frame.rs'),
    nativeSnapshot: digest('src-tauri/src/modules/pty/engine/snapshot.rs'),
    derivedSnapshot: digest('spikes/terminal-ghostty-vt/wasm/target/snapshot.rs'),
    nativeBindings: digest('src-tauri/vendor/libghostty-vt-sys/src/bindings.rs'),
    wasmBindings: digest('spikes/terminal-ghostty-vt/wasm/target/sys/src/bindings_wasm32.rs'),
    cargoLock: digest('spikes/terminal-ghostty-vt/wasm/Cargo.lock'),
    bindgenLock: digest('spikes/terminal-ghostty-vt/wasm/bindgen.lock'),
  },
  repetitions: 100,
  totalFrames: 300,
  cases,
  linearMemory: { beforeBytes: memoryBefore, maxBytes: maxMemory, finalBytes: e.memory.buffer.byteLength },
  logCalls,
  successfulRun: true,
  scope: 'Headless Rust+Zig frame equivalence; no Worker, PTY transport, GPU or FPS validation',
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ successfulRun: true, frames: report.totalFrames,
  moduleBytes: bytes.length, maxLinearMemoryBytes: maxMemory }));
