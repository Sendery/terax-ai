import { useEffect, useState } from "react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { displayAgent } from "@/modules/agents/lib/format";
import { native } from "@/modules/ai/lib/native";
import { TERMINAL_SEND_MAX_CHARS } from "@/modules/commands/lib/controlCommands";
import { callAppCommand } from "@/modules/commands/lib/inApp";
import { TAB_COLORS, TAB_COLOR_CSS, TAB_COLOR_LABEL, isTabColor } from "@/modules/tabs/lib/tabColors";
import {
  normalizedFile, terminalTitle, type AttentionItem, type FileCrossing, type FileTouch,
  type FlowTerminal, type ResolvedDelivery, type ResolvedEndpoint,
} from "@/modules/agent-flow/coordination";
import { flowTime } from "@/modules/agent-flow/FlowTimeline";

type Activate = (tabId: number, leafId: number) => void;
type Operation = "attention" | "terminals" | "connections";
export type FlowOperation = Operation | null;
export type FlowConnection = { kind: "delivery" | "file"; key: string } | null;

const TITLES: Record<Operation, string> = {
  attention: "Needs attention",
  terminals: "Terminals",
  connections: "Connections",
};
const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });

function AttentionAge({ at, now }: { at: number; now: number }) {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  const age = minutes < 60 ? relativeTime.format(-minutes, "minute") : relativeTime.format(-Math.floor(minutes / 60), "hour");
  return <time dateTime={new Date(at).toISOString()} title={flowTime.format(at)}>{age}</time>;
}

function FocusTerminal({ pane, onActivate }: { pane: FlowTerminal; onActivate: Activate }) {
  return <button type="button" onClick={() => onActivate(pane.tabId, pane.leafId)}>Focus terminal</button>;
}

async function askTerax(panes: readonly FlowTerminal[]) {
  const { useChatStore } = await import("@/modules/ai/store/chatStore");
  const ids = panes.map(({ leafId, tabId }) => `leafId ${leafId} (tabId ${tabId})`).join(", ");
  const target = ids ? ` on ${ids}` : "";
  useChatStore.getState().focusInput(`Help me coordinate the public terminals${target}. Use terminal.list to verify the panes.\n\nTask: `);
}

function TerminalActions({ pane, panes, activate }: {
  pane: FlowTerminal;
  panes: readonly FlowTerminal[];
  activate: Activate;
}) {
  const [title, setTitle] = useState(pane.title);
  const [color, setColor] = useState(pane.color ?? "");
  const [source, setSource] = useState("");
  const [line, setLine] = useState("");
  const [submit, setSubmit] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function run(action: () => Promise<string>) {
    setPending(true);
    setFeedback("");
    try {
      setFeedback(await action());
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }

  async function command(id: string, payload: unknown) {
    const result = await callAppCommand(id, payload);
    if (!result.ok) throw new Error(result.error.message);
  }

  return (
    <div className="flow-ops-actions">
      <div className="flow-ops-actions-head">
        <strong>{terminalTitle(pane)}</strong>
        <FocusTerminal pane={pane} onActivate={activate} />
        <button type="button" onClick={() => void run(async () => {
          const from = panes.find(({ leafId }) => String(leafId) === source);
          await askTerax(from ? [from, pane] : [pane]);
          return "Draft opened in Terax AI";
        })}>Ask Terax AI</button>
      </div>
      <form onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          if (title.trim() !== pane.title) await command("tab.rename", { tabId: pane.tabId, title: title.trim() });
          if (color !== (pane.color ?? "")) await command("tab.setColor", { tabId: pane.tabId, color: color || null });
          return "Tab updated";
        });
      }}>
        <label>Tab name<input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>Tab color<select value={color} onChange={(event) => {
          const value = event.target.value;
          setColor(isTabColor(value) ? value : "");
        }}>
          <option value="">Default</option>
          {TAB_COLORS.map((value) => <option key={value} value={value}>{TAB_COLOR_LABEL[value]}</option>)}
        </select></label>
        <button type="submit" disabled={pending || !title.trim() ||
          title.trim() === pane.title && color === (pane.color ?? "")}>Save tab</button>
      </form>
      <form onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await command("terminal.send", {
            leafId: pane.leafId, text: line, submit,
            ...(source ? { sourceLeafId: Number(source) } : {}),
          });
          setLine("");
          setSubmit(false);
          return submit ? "Input submitted" : "Input staged in the terminal";
        });
      }}>
        <label>Source<select value={source} onChange={(event) => setSource(event.target.value)}>
          <option value="">Agent Flow</option>
          {panes.filter(({ leafId }) => leafId !== pane.leafId).map((item) => (
            <option key={item.shellKey} value={item.leafId}>{terminalTitle(item)}{item.session ? ` · ${displayAgent(item.session.agent)}` : ""}</option>
          ))}
        </select></label>
        <label>Terminal input<input value={line} maxLength={TERMINAL_SEND_MAX_CHARS} required onChange={(event) => setLine(event.target.value)} /></label>
        <label className="flow-ops-checkbox"><input type="checkbox" checked={submit} onChange={(event) => setSubmit(event.target.checked)} /> Press Enter after typing</label>
        <button type="submit" disabled={pending || pane.cold || !line.trim()}>{submit ? "Send and submit" : "Stage input"}</button>
        {pane.cold ? <small>Focus this terminal to start its shell before sending input.</small> : null}
      </form>
      {feedback ? <p role="status">{feedback}</p> : null}
    </div>
  );
}

function ConnectionEndpoint({ endpoint, inspect, activate }: {
  endpoint: ResolvedEndpoint;
  inspect: (key: string) => void;
  activate: Activate;
}) {
  if (endpoint.run) {
    const { key } = endpoint.run;
    return <button type="button" onClick={() => inspect(key)}>{endpoint.title}</button>;
  }
  return endpoint.pane ? <FocusTerminal pane={endpoint.pane} onActivate={activate} /> : null;
}

function FileEvidence({ item, openTouch }: { item: FileCrossing; openTouch: (touch: FileTouch) => void }) {
  const [message, setMessage] = useState("");
  const [opening, setOpening] = useState(false);

  async function openDiff() {
    const cwd = item.touches[0].run.cwd;
    if (!cwd) return;
    setOpening(true);
    setMessage("");
    try {
      const repo = await native.gitResolveRepo(cwd);
      const absolute = normalizedFile(repo?.repoRoot, item.path);
      const root = repo?.repoRoot.replace(/\\/g, "/").replace(/\/$/, "");
      if (!root || !absolute?.startsWith(`${root}/`)) {
        setMessage("The file is outside a resolved Git checkout.");
        return;
      }
      const result = await callAppCommand("git.diff.open", { repoRoot: repo?.repoRoot, path: absolute.slice(root.length + 1), mode: "+" });
      if (!result.ok) setMessage(result.error.message);
    } catch {
      setMessage("The Git diff could not be opened.");
    } finally {
      setOpening(false);
    }
  }

  return <div className="flow-ops-evidence">
    {item.touches.map((touch) => (
      <button key={touch.run.key} type="button" onClick={() => openTouch(touch)}>
        {touch.run.tabTitle} · {displayAgent(touch.run.agent)} · {flowTime.format(touch.event.at)}
      </button>
    ))}
    <button type="button" disabled={opening} onClick={() => void openDiff()}>Open Git diff</button>
    {message ? <small role="status">{message}</small> : null}
  </div>;
}

export function FlowOperations({
  mode, panes, attention, deliveries, files, connection, close,
  activate, inspect, selectConnection, openTouch, dismiss, seek,
}: {
  mode: Operation;
  panes: readonly FlowTerminal[];
  attention: readonly AttentionItem[];
  deliveries: readonly ResolvedDelivery[];
  files: readonly FileCrossing[];
  connection: FlowConnection;
  close: () => void;
  activate: Activate;
  inspect: (key: string, event?: string, at?: number) => void;
  selectConnection: (item: FlowConnection) => void;
  openTouch: (touch: FileTouch) => void;
  dismiss: (id: string) => void;
  seek: (at: number) => void;
}) {
  const [paneKey, selectPane] = useState("");
  const [filter, setFilter] = useState("");
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (mode !== "attention" || !attention.length) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [mode, attention.length]);
  const pane = panes.find(({ shellKey }) => shellKey === paneKey);
  const query = filter.trim().toLowerCase();
  const shownPanes = mode === "terminals" && query ? panes.filter((item) =>
    `${terminalTitle(item)} ${item.leafId} ${item.session?.agent ?? ""}`.toLowerCase().includes(query)) : panes;
  const selectedDelivery = connection?.kind === "delivery"
    ? deliveries.find(({ id }) => id === connection.key) : undefined;
  const selectedFile = connection?.kind === "file" ? files.find(({ path }) => path === connection.key) : undefined;

  return <aside className="flow-inspector flow-ops" aria-label={TITLES[mode]}
    onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
    <header className="flow-inspector-header">
      <strong>{TITLES[mode]}</strong>
      <button type="button" className="flow-icon-button" aria-label={`Close ${TITLES[mode]}`} onClick={close}>
        <HugeiconsIcon icon={Cancel01Icon} size={17} />
      </button>
    </header>
    <div className="flow-inspector-scroll flow-ops-content">
      {mode === "attention" ? attention.length ? <ul className="flow-ops-list">
        {attention.map((item) => <li key={item.id} data-kind={item.error ? "error" : "waiting"}>
          <div><b>{item.label}</b><small>{terminalTitle(item.pane)} · <AttentionAge at={item.at} now={now} /></small></div>
          <div className="flow-ops-row-buttons">
            {item.pane.runKey ? <button type="button" onClick={() => {
              if (item.pane.runKey) inspect(item.pane.runKey, item.event, item.error ? item.at : undefined);
            }}>Inspect</button> : null}
            <FocusTerminal pane={item.pane} onActivate={activate} />
            {item.error ? <button type="button" onClick={() => dismiss(item.id)}>Dismiss</button> : null}
          </div>
        </li>)}
      </ul> : <p>No terminals require attention.</p> : null}
      {mode === "terminals" ? <>
        <p className="flow-ops-note">Public shells · {panes.length}</p>
        <input type="search" aria-label="Find a shell" placeholder="Find a shell…" value={filter} onChange={(event) => setFilter(event.target.value)} />
        <ul className="flow-ops-list flow-ops-directory">
          {shownPanes.map((item) => <li key={item.shellKey}>
            <button type="button" className="flow-ops-choice" aria-pressed={item.shellKey === paneKey}
              onClick={() => selectPane(item.shellKey)}>
              <i style={{ background: item.color ? TAB_COLOR_CSS[item.color] : undefined }} />
              <span><b>{terminalTitle(item)}</b><small>#{item.leafId} · {item.session ? displayAgent(item.session.agent) : item.cold ? "Unstarted shell" : "Shell"}</small></span>
            </button>
          </li>)}
        </ul>
        {!shownPanes.length ? <p>No matching shells.</p> : null}
        {pane ? <TerminalActions key={pane.shellKey} pane={pane} panes={panes} activate={activate} /> : <p>Choose a shell to coordinate.</p>}
      </> : null}
      {mode === "connections" ? <>
        <h3>Terminal relays</h3>
        {deliveries.length ? <ul className="flow-ops-list">
          {deliveries.slice(0, 24).map((item) => <li key={item.id}>
            <button type="button" className="flow-ops-choice" aria-pressed={item.id === selectedDelivery?.id}
              onClick={() => selectConnection(item.id === selectedDelivery?.id ? null : { kind: "delivery", key: item.id })}>
              <span><b>{item.from?.title ?? "Terax command"} → {item.to.title}</b>
                <small>{item.submitted ? "Input submitted" : "Input staged"} · {flowTime.format(item.at)}</small></span>
            </button>
          </li>)}
        </ul> : <p>Explicit relays will appear when Terax sends input to a shell.</p>}
        {selectedDelivery ? <div className="flow-ops-evidence">
          {selectedDelivery.from ? <ConnectionEndpoint endpoint={selectedDelivery.from} inspect={inspect} activate={activate} /> : null}
          <ConnectionEndpoint endpoint={selectedDelivery.to} inspect={inspect} activate={activate} />
          {selectedDelivery.from?.run || selectedDelivery.to.run ? (
            <button type="button" onClick={() => seek(selectedDelivery.at)}>Jump to relay</button>
          ) : null}
        </div> : null}
        <h3>Shared file activity</h3>
        {files.length ? <ul className="flow-ops-list">
          {files.map((item) => <li key={item.path}>
            <button type="button" className="flow-ops-choice" aria-pressed={item.path === selectedFile?.path}
              title={item.path} onClick={() => selectConnection(item.path === selectedFile?.path ? null : { kind: "file", key: item.path })}>
              <span><b>{item.path.split("/").pop()}</b><small>{item.touches.length} sessions attempted a write</small></span>
            </button>
          </li>)}
        </ul> : <p>Shared writes from loaded traces will appear here.</p>}
        {selectedFile ? <FileEvidence key={selectedFile.path} item={selectedFile} openTouch={openTouch} /> : null}
      </> : null}
    </div>
  </aside>;
}
