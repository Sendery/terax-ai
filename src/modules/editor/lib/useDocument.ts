import { notifyDocumentSaved } from "@/modules/lsp";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { usePreferencesStore } from "@/modules/settings/preferences";

type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

export type DocumentState =
  | { status: "loading" }
  | { status: "ready"; content: string; size: number }
  | { status: "binary"; size: number }
  | { status: "toolarge"; size: number; limit: number }
  | { status: "error"; message: string };

type Options = {
  path: string;
  onDirtyChange?: (dirty: boolean) => void;
};

export function useDocument({ path, onDirtyChange }: Options) {
  const [doc, setDoc] = useState<DocumentState>({ status: "loading" });
  const [dirty, setDirty] = useState(false);

  const autoSave = usePreferencesStore((s) => s.editorAutoSave);
  const autoSaveDelay = usePreferencesStore((s) => s.editorAutoSaveDelay);

  // Track the saved buffer so we can detect changes cheaply.
  const savedRef = useRef<string>("");
  const bufferRef = useRef<string>("");
  const dirtyRef = useRef(false);
  const generation = useRef(0);
  const edits = useRef(0);
  const pendingWrite = useRef(Promise.resolve());

  const autoSaveRef = useRef({ autoSave, autoSaveDelay });
  autoSaveRef.current = { autoSave, autoSaveDelay };

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoSaveTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const saveNow = useCallback(async () => {
    const owner = generation.current;
    const content = bufferRef.current;
    const workspace = currentWorkspaceEnv();
    const write = pendingWrite.current.catch(() => {}).then(async () => {
      if (owner !== generation.current) return;
      await invoke("fs_write_file", {
        path,
        content,
        workspace,
        source: "editor",
      });
      if (owner !== generation.current) return;
      savedRef.current = content;
      dirtyRef.current = bufferRef.current !== content;
      setDirty(dirtyRef.current);
      notifyDocumentSaved(path);
    });
    pendingWrite.current = write;
    await write;
  }, [path]);

  // Notify parent of dirty transitions.
  const onDirtyChangeRef = useRef(onDirtyChange);
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange;
  }, [onDirtyChange]);
  useEffect(() => {
    onDirtyChangeRef.current?.(dirty);
  }, [dirty]);

  // Load on path change or explicit reload.
  useEffect(() => {
    let cancelled = false;
    generation.current++;
    dirtyRef.current = false;
    setDoc({ status: "loading" });
    setDirty(false);

    invoke<ReadResult>("fs_read_file", { path, workspace: currentWorkspaceEnv() })
      .then((res) => {
        if (cancelled) return;
        if (res.kind === "text") {
          savedRef.current = res.content;
          bufferRef.current = res.content;
          setDoc({
            status: "ready",
            content: res.content,
            size: res.size,
          });
        } else if (res.kind === "binary") {
          setDoc({ status: "binary", size: res.size });
        } else if (res.kind === "toolarge") {
          setDoc({
            status: "toolarge",
            size: res.size,
            limit: res.limit,
          });
        }
      })
      .catch((e) => {
        if (!cancelled) setDoc({ status: "error", message: String(e) });
      });

    return () => {
      cancelled = true;
      generation.current++;
    };
  }, [path]);

  // Skipped while dirty (never clobber unsaved edits) and when disk already
  // matches the buffer (self-save / duplicate watcher event → no re-render).
  const reload = useCallback((): boolean => {
    if (dirtyRef.current) return false;
    const owner = generation.current;
    const revision = edits.current;
    void invoke<ReadResult>("fs_read_file", {
      path,
      workspace: currentWorkspaceEnv(),
    })
      .then((res) => {
        if (
          dirtyRef.current || owner !== generation.current || revision !== edits.current
        ) return;
        if (res.kind === "text") {
          if (res.content === savedRef.current) return;
          savedRef.current = res.content;
          bufferRef.current = res.content;
          setDirty(false);
          setDoc({ status: "ready", content: res.content, size: res.size });
        } else if (res.kind === "binary") {
          setDoc({ status: "binary", size: res.size });
        } else if (res.kind === "toolarge") {
          setDoc({ status: "toolarge", size: res.size, limit: res.limit });
        }
      })
      .catch((e) => {
        if (owner === generation.current && revision === edits.current) {
          setDoc({ status: "error", message: String(e) });
        }
      });
    return true;
  }, [path]);

  const save = useCallback(async () => {
    clearAutoSaveTimer();
    if (!dirtyRef.current) return;
    await saveNow();
  }, [clearAutoSaveTimer, saveNow]);

  const onChange = useCallback(
    (next: string, options?: { autoSave?: boolean }) => {
      edits.current++;
      bufferRef.current = next;
      setDoc(current =>
        current.status === "ready" ? { ...current, content: next } : current,
      );
      const isDirty = next !== savedRef.current;
      dirtyRef.current = isDirty;
      setDirty(isDirty);

      clearAutoSaveTimer();

      const { autoSave: active, autoSaveDelay: delay } = autoSaveRef.current;
      if (active && isDirty && options?.autoSave !== false) {
        timeoutRef.current = setTimeout(() => {
          saveNow().catch((e) => console.error("[autosave]", e));
        }, delay);
      }
    },
    [clearAutoSaveTimer, saveNow],
  );

  useEffect(() => clearAutoSaveTimer, [path, clearAutoSaveTimer]);

  return { doc, dirty, onChange, save, reload };
}
