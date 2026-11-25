import { invoke } from "@tauri-apps/api/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useWhisperRecording } from "../hooks/useWhisperRecording";
import { expandSnippetTokens, type Snippet } from "../lib/snippets";
import { parseUserShellInput } from "../lib/userShell";
import { tryRunSlashCommand, type SlashCommandMeta } from "./slashCommands";
import { getChat, useChatStore } from "../store/chatStore";
import { useSnippetsStore } from "../store/snippetsStore";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { toast } from "sonner";
import { cliAcceptsImages, IMAGE_TYPES, MAX_IMAGE_BYTES, readChatAttachment, type FileAttachment } from "@/modules/ai/lib/attachments";
import { CLI_PROVIDERS, getModel } from "@/modules/ai/config";
import { readTerminalClipboard } from "@/modules/terminal/lib/terminalClipboard";

export type { FileAttachment } from "@/modules/ai/lib/attachments";

type MessagePart =
  | { type: "text"; text: string }
  | { type: "file"; mediaType: string; url: string; filename?: string };

export const ACCEPTED_FILES =
  "image/png,image/jpeg,image/gif,image/webp,.txt,.md,.json,.yaml,.yml,.toml,.sh,.zsh,.bash,.py,.js,.jsx,.ts,.tsx,.rs,.go,.java,.c,.cpp,.h,.hpp,.html,.css,.csv,.log,.env,.config,.conf,.ini,Dockerfile,.dockerfile";

type Voice = ReturnType<typeof useWhisperRecording>;

type ComposerCtx = {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  setValue: React.Dispatch<React.SetStateAction<string>>;
  files: FileAttachment[];
  addFiles: (list: Iterable<File> | null) => Promise<void>;
  pasteFromClipboard: () => Promise<void>;
  /** Attach a file by absolute path — used by the file explorer's "Attach to Agent". */
  attachFileByPath: (path: string) => Promise<void>;
  removeFile: (id: string) => void;
  pickedSnippets: Snippet[];
  addSnippet: (s: Snippet) => void;
  removeSnippet: (id: string) => void;
  pickedCommands: SlashCommandMeta[];
  addCommand: (c: SlashCommandMeta) => void;
  removeCommand: (name: string) => void;
  isBusy: boolean;
  submit: () => void;
  stop: () => void;
  voice: Voice;
  canSend: boolean;
};

const Ctx = createContext<ComposerCtx | null>(null);

export function useComposer(): ComposerCtx {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error("useComposer must be used inside <AiComposerProvider>");
  return ctx;
}

type ProviderProps = {
  children: React.ReactNode;
};

export function AiComposerProvider({ children }: ProviderProps) {
  const sessionId = useChatStore((s) => s.activeSessionId);
  const status = useChatStore((s) => s.agentMeta.status);
  const isBusy = status === "thinking" || status === "streaming";

  const [value, setValue] = useState("");
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const pendingFiles = useRef(0);
  const [readingFiles, setReadingFiles] = useState(false);
  const [pickedSnippets, setPickedSnippets] = useState<Snippet[]>([]);
  const [pickedCommands, setPickedCommands] = useState<SlashCommandMeta[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const focusSignal = useChatStore((s) => s.focusSignal);
  const pendingPrefill = useChatStore((s) => s.pendingPrefill);
  const consumePrefill = useChatStore((s) => s.consumePrefill);
  const pendingSelections = useChatStore((s) => s.pendingSelections);
  const consumeSelections = useChatStore((s) => s.consumeSelections);

  useEffect(() => {
    if (focusSignal === 0) return;
    textareaRef.current?.focus();
    if (pendingPrefill != null) {
      const text = consumePrefill();
      if (text) setValue((v) => (v ? `${text}${v}` : text));
    }
  }, [focusSignal, pendingPrefill, consumePrefill]);

  // Re-focus the textarea whenever the agent finishes a response
  const prevIsBusyRef = useRef(false);
  useEffect(() => {
    if (prevIsBusyRef.current && !isBusy) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
    prevIsBusyRef.current = isBusy;
  }, [isBusy, textareaRef]);

  // Listen for explorer's "Attach to Agent" event.
  useEffect(() => {
    const onAttach = (e: Event) => {
      const path = (e as CustomEvent<string>).detail;
      if (typeof path === "string" && path.length > 0) {
        void attachFileByPath(path);
      }
    };
    window.addEventListener("terax:ai-attach-file", onAttach);
    return () => window.removeEventListener("terax:ai-attach-file", onAttach);
    // attachFileByPath is stable for our purposes (closes over setFiles only)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pendingSelections.length === 0) return;
    const drained = consumeSelections();
    if (drained.length === 0) return;
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.id));
      const next: FileAttachment[] = [];
      for (const sel of drained) {
        if (existing.has(sel.id)) continue;
        next.push({
          id: sel.id,
          name:
            sel.source === "chat" ? "Chat selection" :
            sel.source === "editor" ? "Editor selection" : "Terminal selection",
          kind: "selection",
          mediaType: "text/plain",
          text: sel.text,
          size: sel.text.length,
          source: sel.source,
        });
      }
      return next.length ? [...prev, ...next] : prev;
    });
  }, [pendingSelections, consumeSelections]);

  const voice = useWhisperRecording({
    onResult: (transcript: string) => {
      setValue((v) => (v ? `${v} ${transcript}` : transcript));
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
  });

  const addFiles = useCallback(async (list: Iterable<File> | null) => {
    const files = list ? Array.from(list) : [];
    if (!files.length) return;
    if (files.length > 20) {
      toast.error("Attach up to 20 files at a time.");
      return;
    }
    pendingFiles.current++;
    setReadingFiles(true);
    try {
      const next: FileAttachment[] = [];
      for (const file of files) {
        try {
          next.push(await readChatAttachment(file));
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not read the attachment.");
        }
      }
      if (next.length) setFiles((prev) => [...prev, ...next]);
    } finally {
      if (--pendingFiles.current === 0) setReadingFiles(false);
    }
  }, []);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const items = await navigator.clipboard?.read?.();
      const images: File[] = [];
      for (const item of items ?? []) {
        const type = IMAGE_TYPES.find((candidate) => item.types.includes(candidate));
        if (type) images.push(new File([await item.getType(type)], `clipboard.${type.split("/")[1]}`, { type }));
      }
      if (images.length) {
        useChatStore.getState().focusInput();
        await addFiles(images);
        return;
      }
    } catch {
      // Some WebViews only allow text reads or expose images through paste events.
    }
    const text = await readTerminalClipboard();
    if (!text) return;
    const area = textareaRef.current;
    const start = area?.selectionStart;
    const end = area?.selectionEnd;
    setValue((prev) => start === undefined || end === undefined
      ? prev + text
      : prev.slice(0, start) + text + prev.slice(end));
    useChatStore.getState().focusInput();
  }, [addFiles]);

  const removeFile = (id: string) =>
    setFiles((prev) => prev.filter((f) => f.id !== id));

  const addSnippet = (s: Snippet) =>
    setPickedSnippets((prev) =>
      prev.some((p) => p.id === s.id) ? prev : [...prev, s],
    );
  const removeSnippet = (id: string) =>
    setPickedSnippets((prev) => prev.filter((s) => s.id !== id));

  const addCommand = (cmd: SlashCommandMeta) =>
    setPickedCommands((prev) =>
      prev.some((p) => p.name === cmd.name) ? prev : [...prev, cmd],
    );
  const removeCommand = (name: string) =>
    setPickedCommands((prev) => prev.filter((c) => c.name !== name));

  const attachFileByPath = async (path: string) => {
    try {
      type ReadResult =
        | { kind: "text"; content: string; size: number }
        | { kind: "binary"; size: number }
        | { kind: "toolarge"; size: number; limit: number };
      const result = await invoke<ReadResult>("fs_read_file", {
        path,
        workspace: currentWorkspaceEnv(),
      });
      if (result.kind !== "text") {
        // Binary/oversize files: skip (could surface a toast in future).
        console.warn("attachFileByPath: skipped non-text file", path, result);
        return;
      }
      const name = path.split("/").pop() || path;
      const id = `path-${path}`;
      setFiles((prev) => {
        if (prev.some((f) => f.id === id)) return prev;
        const att: FileAttachment = {
          id,
          name,
          kind: "text",
          mediaType: "text/plain",
          text: result.content,
          size: result.size,
        };
        return [...prev, att];
      });
      // Open the AI panel & focus the input so the user sees the chip.
      useChatStore.getState().focusInput();
    } catch (e) {
      console.error("attachFileByPath failed:", e);
    }
  };

  const submit = () => {
    if (isBusy || pendingFiles.current > 0) return;
    const images = files.filter((file) => file.kind === "image");
    if (images.length) {
      const provider = getModel(useChatStore.getState().selectedModelId).provider;
      const cli = CLI_PROVIDERS[provider];
      if (cli && !cliAcceptsImages(cli)) {
        toast.error("This CLI cannot receive image attachments. Choose a model that supports images or remove the images.");
        return;
      }
      if (images.length > 20) {
        toast.error("Attach up to 20 images per message.");
        return;
      }
      if (images.reduce((total, file) => total + file.size, 0) > MAX_IMAGE_BYTES) {
        toast.error("Image attachments must total 10 MB or less.");
        return;
      }
    }
    const trimmed = value.trim();
    if (
      !trimmed &&
      files.length === 0 &&
      pickedSnippets.length === 0 &&
      pickedCommands.length === 0
    )
      return;

    // `!command` and `!!command` run in a shell instead of going to the model.
    const shell =
      files.length === 0 && pickedCommands.length === 0
        ? parseUserShellInput(trimmed)
        : null;
    if (shell) {
      if (!sessionId) return;
      const store = useChatStore.getState();
      if (!store.mini.open && !store.panelOpen) store.openMini();
      void (async () => {
        const [{ getOrCreateChat }, { runUserShell }] = await Promise.all([
          import("../store/chatRuntime"),
          import("./conversation"),
        ]);
        await runUserShell(
          getOrCreateChat(sessionId),
          shell,
          useChatStore.getState().live.getCwd(),
        );
      })();
      setValue("");
      setPickedSnippets([]);
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    // Slash-command interception. `/plan` toggles plan mode; `/init` rewrites
    // the prompt to the TERAX.md scan template before sending.
    let targetSessionId = sessionId;
    let effectiveText = trimmed;
    let commandMarker: string | null = null;
    let commandSource = trimmed;
    if (pickedCommands.length > 0 && !trimmed.startsWith("/") && !trimmed.startsWith("#")) {
      commandSource = `#${pickedCommands[0].name} ${trimmed}`.trim();
    }
    if (commandSource.startsWith("/") || commandSource.startsWith("#")) {
      const outcome = tryRunSlashCommand(commandSource);
      if (outcome.kind === "handled") {
        setValue("");
        if (outcome.toast) console.info(outcome.toast);
        return;
      }
      if (outcome.kind === "compact") {
        if (!sessionId) return;
        const store = useChatStore.getState();
        if (!store.mini.open && !store.panelOpen) store.openMini();
        store.patchAgentMeta({ hitStepCap: false, compactionNotice: null });
        void (async () => {
          const [{ getOrCreateChat }, { compactConversation }] =
            await Promise.all([
              import("../store/chatRuntime"),
              import("./conversation"),
            ]);
          const result = await compactConversation(
            getOrCreateChat(sessionId),
            outcome.focus,
          );
          if (!result.ok) console.info(result.reason);
        })();
        setValue("");
        setPickedCommands([]);
        return;
      }
      if (outcome.kind === "new-session") {
        targetSessionId = useChatStore.getState().newSession();
        if (!outcome.prompt && files.length === 0) {
          setValue("");
          setPickedSnippets([]);
          setPickedCommands([]);
          requestAnimationFrame(() => textareaRef.current?.focus());
          return;
        }
        effectiveText = outcome.prompt ?? "";
      }
      if (outcome.kind === "send-prompt") {
        effectiveText = outcome.prompt;
        if (outcome.commandName) {
          commandMarker = `<terax-command name="${outcome.commandName}" />`;
        }
      }
    }

    const parts: MessagePart[] = [];
    const fileBlocks = files
      .filter((f) => f.kind === "text")
      .map(
        (f) =>
          `<file name="${f.name}" mediaType="${f.mediaType}">\n${f.text ?? ""}\n</file>`,
      );
    const selectionBlocks = files
      .filter((f) => f.kind === "selection")
      .map(
        (f) =>
          `<selection source="${f.source ?? "terminal"}">\n${f.text ?? ""}\n</selection>`,
      );
    const { body: bodyAfterTokens, blocks: snippetBlocks } = expandSnippetTokens(
      effectiveText,
      useSnippetsStore.getState().snippets,
    );
    const seenHandles = new Set<string>();
    const allSnippetBlocks: string[] = [];
    for (const s of pickedSnippets) {
      if (seenHandles.has(s.handle)) continue;
      seenHandles.add(s.handle);
      allSnippetBlocks.push(
        `<snippet name="${s.handle}">\n${s.content}\n</snippet>`,
      );
    }
    for (const block of snippetBlocks) {
      const m = block.match(/^<snippet name="([^"]+)"/);
      if (m && seenHandles.has(m[1])) continue;
      if (m) seenHandles.add(m[1]);
      allSnippetBlocks.push(block);
    }
    const composed = [
      commandMarker ?? "",
      allSnippetBlocks.join("\n\n"),
      selectionBlocks.join("\n\n"),
      fileBlocks.join("\n\n"),
      bodyAfterTokens,
    ]
      .filter(Boolean)
      .join("\n\n");
    if (composed) parts.push({ type: "text", text: composed });

    for (const f of files) {
      if (f.kind === "image" && f.url) {
        parts.push({
          type: "file",
          mediaType: f.mediaType,
          url: f.url,
          filename: f.name,
        });
      }
    }

    if (!targetSessionId) return;
    const sendTo = targetSessionId;
    const store = useChatStore.getState();
    store.patchAgentMeta({ hitStepCap: false, compactionNotice: null });
    if (!store.mini.open) store.openMini();
    void (async () => {
      const { getOrCreateChat } = await import("../store/chatRuntime");
      const chat = getOrCreateChat(sendTo);
      void chat.sendMessage({ role: "user", parts } as Parameters<
        typeof chat.sendMessage
      >[0]);
    })();
    setValue("");
    setFiles([]);
    setPickedSnippets([]);
    setPickedCommands([]);
    // Re-focus immediately after submit so the user can type a follow-up
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const stop = () => {
    if (!sessionId) return;
    void getChat(sessionId)?.stop();
  };

  const canSend =
    !isBusy && !readingFiles &&
    (value.trim().length > 0 ||
      files.length > 0 ||
      pickedSnippets.length > 0 ||
      pickedCommands.length > 0);

  const ctx: ComposerCtx = {
    textareaRef,
    value,
    setValue,
    files,
    addFiles,
    pasteFromClipboard,
    attachFileByPath,
    removeFile,
    pickedSnippets,
    addSnippet,
    removeSnippet,
    pickedCommands,
    addCommand,
    removeCommand,
    isBusy,
    submit,
    stop,
    voice,
    canSend,
  };

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}
