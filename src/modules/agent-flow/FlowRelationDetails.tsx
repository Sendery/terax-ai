import { useState } from "react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { native } from "@/modules/ai/lib/native";
import { callAppCommand } from "@/modules/commands/lib/inApp";
import { normalizedFile, relationLabel, type FileCrossing, type FlowRelation, type ResolvedEndpoint } from "@/modules/agent-flow/coordination";
import { flowTime } from "@/modules/agent-flow/FlowTimeline";

type Inspect = (key: string, event?: string, at?: number, task?: string) => void;
type Activate = (tabId: number, leafId: number) => void;

function Endpoint({ endpoint, activate, inspect }: {
  endpoint: ResolvedEndpoint;
  activate: Activate;
  inspect: Inspect;
}) {
  if (endpoint.run) {
    const { key } = endpoint.run;
    return <button type="button" onClick={() => inspect(key)}>{endpoint.title}</button>;
  }
  const pane = endpoint.pane;
  return pane ? <button type="button" onClick={() => activate(pane.tabId, pane.leafId)}>{endpoint.title}</button>
    : <span>{endpoint.title}</span>;
}

function FileEvidence({ file, inspect }: { file: FileCrossing; inspect: Inspect }) {
  const [message, setMessage] = useState("");
  const [opening, setOpening] = useState(false);
  async function openDiff() {
    const cwd = file.touches.find(({ operation }) => operation === "write")?.run.cwd;
    if (!cwd) return;
    setOpening(true);
    setMessage("");
    try {
      const repo = await native.gitResolveRepo(cwd);
      const absolute = normalizedFile(repo?.repoRoot, file.path);
      const root = repo?.repoRoot.replace(/\\/g, "/").replace(/\/$/, "");
      if (!root || !absolute?.startsWith(`${root}/`)) {
        setMessage("The file is outside a resolved Git checkout.");
        return;
      }
      const result = await callAppCommand("git.diff.open", {
        repoRoot: repo?.repoRoot, path: absolute.slice(root.length + 1), mode: "+",
      });
      if (!result.ok) setMessage(result.error.message);
    } catch {
      setMessage("The Git diff could not be opened.");
    } finally {
      setOpening(false);
    }
  }

  return <>
    <p className="flow-inspector-note" title={file.path}>{file.path}</p>
    <ol className="flow-event-list">
      {file.touches.map(({ run, task, event, operation }) => <li key={run.key}>
        <button type="button" onClick={() => inspect(run.key, event.id, event.at, task)}>
          <span><b>{run.tabTitle}{run.paneLabel ? ` · ${run.paneLabel}` : ""}</b><time>{flowTime.format(event.at)}</time></span>
          <small>{operation === "write" ? "Write attempt" : "Read"}{event.text ? ` · ${event.text}` : ""}</small>
        </button>
      </li>)}
    </ol>
    <div className="flow-inspector-actions">
      <button type="button" disabled={opening} onClick={() => void openDiff()}>Open Git diff</button>
    </div>
    {message ? <small role="status">{message}</small> : null}
  </>;
}

export function FlowRelationDetails({ relation, close, activate, inspect, seek }: {
  relation: FlowRelation;
  close: () => void;
  activate: Activate;
  inspect: Inspect;
  seek: (at: number) => void;
}) {
  const newest = relation.kind === "relay" ? relation.deliveries[0] : undefined;
  return <aside className="flow-inspector flow-relation-details" aria-label={relation.kind === "relay" ? "Terminal relay" : "Shared file activity"}
    onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
    <header className="flow-inspector-header">
      <strong title={relationLabel(relation)}>{relationLabel(relation)}</strong>
      <button type="button" className="flow-icon-button" aria-label="Close link details" onClick={close}>
        <HugeiconsIcon icon={Cancel01Icon} size={17} />
      </button>
    </header>
    <div className="flow-inspector-scroll">
      {relation.kind === "file" ? <FileEvidence file={relation.file} inspect={inspect} /> : <>
        {newest ? <div className="flow-inspector-actions flow-relay-endpoints">
          {newest.from ? <Endpoint endpoint={newest.from} activate={activate} inspect={inspect} /> : <span>Terax</span>}
          <span aria-hidden="true">→</span>
          <Endpoint endpoint={newest.to} activate={activate} inspect={inspect} />
        </div> : null}
        <ol className="flow-event-list">
          {relation.deliveries.map(({ id, submitted, at }) => <li key={id}>
            <button type="button" onClick={() => seek(at)}>
              <span><b>{submitted ? "Input submitted" : "Input staged"}</b><time>{flowTime.format(at)}</time></span>
            </button>
          </li>)}
        </ol>
      </>}
    </div>
  </aside>;
}
