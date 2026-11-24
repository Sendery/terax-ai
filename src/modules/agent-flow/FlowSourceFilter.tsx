import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { displayAgent } from "@/modules/agents/lib/format";
import type { FlowTerminal } from "@/modules/agent-flow/coordination";
import { flowTime } from "@/modules/agent-flow/FlowTimeline";
import type { FlowRun } from "@/modules/agent-flow/model";

type Shell = { key: string; label: string };
type SourceGroup = { key: string; title: string; shells: Shell[]; archived?: boolean };
export type SourceFilter = Map<string, ReadonlySet<string> | null>;

export function shellGroup(shellKey: string) {
  return shellKey.slice(0, shellKey.lastIndexOf(":"));
}

export function sourceGroups(panes: readonly FlowTerminal[], runs: readonly FlowRun[]) {
  const groups = new Map<string, SourceGroup>();
  const liveRuns = new Map(runs.filter((run) => run.active).map((run) => [run.key, run]));
  for (const pane of panes) {
    const key = shellGroup(pane.shellKey);
    const group = groups.get(key) ?? { key, title: pane.title, shells: [] };
    groups.set(key, group);
    const run = pane.runKey ? liveRuns.get(pane.runKey) : undefined;
    const label = run?.name ?? (pane.session
      ? `${pane.title} · ${flowTime.format(pane.session.startedAt)} · ${displayAgent(pane.session.agent)}`
      : `${pane.title} · Shell ${pane.slot}`);
    group.shells.push({ key: pane.shellKey, label });
  }
  for (const run of runs) {
    if (!groups.has(run.group)) {
      groups.set(run.group, { key: run.group, title: run.tabTitle, shells: [], archived: run.marker !== "background" });
    }
  }
  const counts = new Map<string, number>();
  const ordinals = new Map<string, number>();
  for (const { title, archived } of groups.values()) {
    if (!archived) counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  return [...groups.values()].map((group) => {
    if (group.archived || (counts.get(group.title) ?? 0) <= 1) return group;
    const index = (ordinals.get(group.title) ?? 0) + 1;
    ordinals.set(group.title, index);
    return { ...group, title: `${group.title} · ${index}` };
  }).sort((a, b) => a.title.localeCompare(b.title));
}

export function sourceMatches(filter: SourceFilter, group: string, shell?: string) {
  if (!filter.size) return true;
  const selected = filter.get(group);
  return selected === null || (shell !== undefined && !!selected?.has(shell));
}

export function currentSourceFilter(filter: SourceFilter, groups: readonly SourceGroup[]): SourceFilter {
  const selected: SourceFilter = new Map();
  for (const { key, shells } of groups) {
    const value = filter.get(key);
    if (value === null) selected.set(key, null);
    else if (value) {
      const available = shells.map((shell) => shell.key).filter((id) => value.has(id));
      if (available.length) selected.set(key, new Set(available));
    }
  }
  return selected;
}

export function FlowSourceFilter({ groups, filter, onChange }: {
  groups: readonly SourceGroup[];
  filter: SourceFilter;
  onChange: (filter: SourceFilter) => void;
}) {
  const active = groups.filter((group) => !group.archived);
  const archived = groups.filter((group) => group.archived);
  const single = filter.size === 1 ? groups.find(({ key }) => filter.has(key)) : undefined;
  const label = single?.title ?? (filter.size ? `${filter.size} sources` : "All tabs");
  function update(key: string, shells: ReadonlySet<string> | null) {
    const next = new Map(filter);
    if (shells !== null && !shells.size) next.delete(key);
    else next.set(key, shells);
    onChange(next);
  }
  function renderGroup(group: SourceGroup) {
    const selection = filter.get(group.key);
    return (
      <div className="flow-source-group" key={group.key}>
        <label>
          <input type="checkbox" checked={selection === null}
            ref={(input) => { if (input) input.indeterminate = !!selection?.size; }}
            onChange={(event) => update(group.key, event.target.checked ? null : new Set())} />
          <span>{group.title}</span>
        </label>
        {group.shells.length ? (
          <ul aria-label={`Shells in ${group.title}`}>
            {group.shells.map(({ key, label: shellLabel }) => (
              <li key={key}>
                <label>
                  <input type="checkbox" checked={selection === null || !!selection?.has(key)}
                    onChange={(event) => {
                      const next = new Set(selection === null ? group.shells.map((shell) => shell.key) : selection);
                      if (event.target.checked) next.add(key);
                      else next.delete(key);
                      update(group.key, next.size === group.shells.length ? null : next);
                    }} />
                  <span>{shellLabel}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="flow-tab-filter-trigger" aria-label={`Filter source tabs: ${label}`}>
          <span>{label}</span><HugeiconsIcon icon={ArrowDown01Icon} size={13} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="flow-tab-filter" aria-label="Source tabs and shells" align="start">
        <button type="button" aria-pressed={!filter.size} onClick={() => onChange(new Map())}>All tabs</button>
        <fieldset>
          <legend className="sr-only">Filter source tabs and shells</legend>
          {active.map(renderGroup)}
          {archived.length ? <details><summary>Archived sources</summary>{archived.map(renderGroup)}</details> : null}
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}
