import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createExtension } from "../packages/pi-terax/dist/extension.js";

const root = process.cwd();
const outputDir = join(root, ".terax", "visual-qa", "pi-command-e2e");
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const tools = new Map();
createExtension()({ registerTool(tool) { tools.set(tool.name, tool); } });
const context = { cwd: root, isProjectTrusted: () => true };

async function invoke(name, params = {}) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Missing Pi tool ${name}`);
  return tool.execute(`e2e-${Date.now()}`, params, undefined, undefined, context);
}

async function state() {
  return (await invoke("terax_get_state")).details.state;
}

async function call(command, payload) {
  return invoke("terax_call", { command, ...(payload === undefined ? {} : { payload }) });
}

async function wait(milliseconds = 350) {
  await invoke("terax_wait", { milliseconds });
}

async function capture(name, surface = "main") {
  return (await invoke("terax_visual_qa", { action: "screenshot", surface, name })).details;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const fixture = "C:/Users/Andrés/AppData/Local/terax-ai/e2e-fixture";
const alpha = `${fixture}/alpha.txt`;
const diff = "diff.txt";
const results = [];

async function scenario(name, fn, options = {}) {
  const before = await state();
  const beforeVisual = options.visual === false ? undefined : await capture(`${name}-before`, options.surface);
  const detail = await fn(before);
  await wait();
  const after = await state();
  const afterVisual = options.visual === false ? undefined : await capture(`${name}-after`, options.surface);
  const row = { name, status: "PASS", before, after, beforeVisual, afterVisual, detail };
  results.push(row);
  await writeFile(join(outputDir, `${name}.json`), JSON.stringify(row, null, 2));
  return row;
}

await scenario("app-snapshot", async (before) => {
  const viaCall = (await call("app.snapshot")).details.result;
  assert(viaCall.version === 1, "app.snapshot version mismatch");
  assert(JSON.stringify(viaCall) === JSON.stringify(before), "terax_get_state and terax_call snapshot differ");
  return { viaCall };
}, { visual: false });

await scenario("sidebar-hide", async () => {
  await call("sidebar.hide");
  return {};
}).then(({ after }) => assert(after.sidebar?.visible === false, "sidebar.hide did not hide sidebar"));

await scenario("sidebar-show-explorer", async () => {
  await call("sidebar.show", { view: "explorer" });
  return {};
}).then(({ after }) => {
  assert(after.sidebar?.visible === true, "sidebar.show did not show sidebar");
  assert(after.sidebar?.view === "explorer", "sidebar.show did not select explorer");
});

await scenario("sidebar-show-source-control", async () => {
  await call("sidebar.show", { view: "source-control" });
  return {};
}).then(({ after }) => {
  assert(after.sidebar?.visible === true, "source-control sidebar not visible");
  assert(after.sidebar?.view === "source-control", "source-control view not selected");
});

let editorId;
await scenario("tab-open-file", async () => {
  await call("tab.openFile", { path: alpha, pin: true });
  return {};
}).then(({ after }) => {
  const editor = after.tabs.find((tab) => tab.kind === "editor" && tab.path === alpha);
  assert(editor, "tab.openFile did not create editor tab");
  assert(editor.preview === false, "tab.openFile pin=true did not pin editor");
  assert(after.activeTabId === editor.id, "tab.openFile editor not active");
  editorId = editor.id;
});

await scenario("tab-rename", async () => {
  await call("tab.rename", { tabId: editorId, title: "PI E2E Renamed" });
  return { editorId };
}).then(({ after }) => {
  const editor = after.tabs.find((tab) => tab.id === editorId);
  assert(editor?.title === "PI E2E Renamed", "tab.rename did not update title");
});

await scenario("tab-reset-title", async () => {
  await call("tab.resetTitle", { tabId: editorId });
  return { editorId };
}).then(({ after }) => {
  const editor = after.tabs.find((tab) => tab.id === editorId);
  assert(editor?.title === "alpha.txt", "tab.resetTitle did not restore default title");
});

await scenario("tab-set-color", async () => {
  await call("tab.setColor", { tabId: editorId, color: "teal" });
  return { editorId };
}).then(({ after }) => {
  const editor = after.tabs.find((tab) => tab.id === editorId);
  assert(editor?.color === "teal", "tab.setColor did not assign color");
});

await scenario("tab-set-color-snapshot", async () => {
  const snap = (await call("app.snapshot")).details.result;
  const editor = snap.tabs.find((tab) => tab.id === editorId);
  assert(editor?.color === "teal", "tab.setColor color not visible in app.snapshot");
  return { snap };
}, { visual: false });

await scenario("tab-set-color-reset", async () => {
  await call("tab.setColor", { tabId: editorId, color: null });
  return { editorId };
}).then(({ after }) => {
  const editor = after.tabs.find((tab) => tab.id === editorId);
  assert(!editor?.color, "tab.setColor null did not clear color");
});

const terminalId = (await state()).tabs.find((tab) => tab.kind === "terminal")?.id;
assert(Number.isInteger(terminalId), "fixture terminal tab missing");
await scenario("tab-focus-terminal", async () => {
  await call("tab.focus", { tabId: terminalId });
  return { terminalId };
}).then(({ after }) => assert(after.activeTabId === terminalId, "tab.focus did not focus terminal"));

await scenario("tab-focus-editor", async () => {
  await call("tab.focus", { tabId: editorId });
  return { editorId };
}).then(({ after }) => assert(after.activeTabId === editorId, "tab.focus did not focus editor"));

let diffId;
await scenario("git-diff-open", async () => {
  await call("git.diff.open", { repoRoot: fixture, path: diff, mode: "+", title: "PI E2E diff" });
  return {};
}).then(({ after }) => {
  const tab = after.tabs.find((item) => item.kind === "git-diff" && item.path === diff);
  assert(tab, "git.diff.open did not create git-diff tab");
  assert(tab.mode === "+", "git.diff.open mode mismatch");
  assert(after.activeTabId === tab.id, "git diff tab not active");
  diffId = tab.id;
});

await scenario("tab-close-diff", async () => {
  await call("tab.close", { tabId: diffId });
  return { diffId };
}).then(({ after }) => assert(!after.tabs.some((tab) => tab.id === diffId), "tab.close did not close diff"));

await scenario("tab-close-editor", async () => {
  await call("tab.close", { tabId: editorId });
  return { editorId };
}).then(({ after }) => assert(!after.tabs.some((tab) => tab.id === editorId), "tab.close did not close editor"));

await scenario("settings-open-shortcuts", async () => {
  await call("settings.open", { tab: "shortcuts" });
  await wait(1_500);
  const settingsVisual = await capture("settings-open-shortcuts-after", "settings");
  return { settingsVisual };
}, { visual: false });

const negativeBefore = await state();
let blocked = false;
try { await call("ai.diff.approve", {}); } catch { blocked = true; }
assert(blocked, "non-allowlisted command was not rejected");
let invalid = false;
try { await call("tab.focus", { tabId: "bad" }); } catch { invalid = true; }
assert(invalid, "invalid payload was not rejected");

let invalidColor = false;
try { await call("tab.setColor", { tabId: editorId, color: "yellow" }); } catch { invalidColor = true; }
assert(invalidColor, "arbitrary color was not rejected by tab.setColor");

let missingTab = false;
try { await call("tab.setColor", { tabId: 99999, color: "red" }); } catch { missingTab = true; }
assert(missingTab, "missing tab was not rejected by tab.setColor");

const negativeAfter = await state();
assert(JSON.stringify(negativeBefore) === JSON.stringify(negativeAfter), "negative commands changed state");
results.push({ name: "negative-boundary", status: "PASS", before: negativeBefore, after: negativeAfter });

const summary = { status: "PASS", scenarios: results.length, results };
await writeFile(join(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ status: summary.status, scenarios: summary.scenarios, outputDir }, null, 2));
