# Raw, rendered and side by side views

Open a source file and use **Raw**, **Rendered** or **Side by side** above the document. The same controls are available on Mermaid diagrams and GraphX documents. Buttons work with Tab and Enter/Space and announce their selected state. Drag the divider, or focus it and use its keyboard controls. Narrow panes stack editor and preview vertically.

| Source | Initial view | Rendered content |
| --- | --- | --- |
| Markdown (`.md`, `.markdown`, `.mdx`) | Rendered through the explorer | Markdown, including Mermaid fences |
| HTML (`.html`, `.htm`) | Raw | Static HTML |
| Mermaid (`.mmd`, `.mermaid`) | Raw for files; Side by side for diagram tabs | Complete Mermaid renderer |
| GraphX (`.graphx`) | Raw for files; Rendered for GraphX documents | Validated GraphX JSON, including graph and sequence views |

Generic JSON, CSV and programming-language files remain raw. Binary image/video/audio/PDF files retain their existing viewers. A localhost application preview is a separate browser surface without an editable file buffer.

## Editing and saving

The preview follows the unsaved editor buffer after a short debounce. Switching views preserves that buffer, dirty state, cursor/selection and undo history because the editor remains mounted. The **Save** button is available in every file view; Cmd/Ctrl+S continues to work in the editor and document controls. A scriptless iframe does not forward keyboard events to the parent, so use Save when focus is inside HTML content. Opening a file location or focusing editor search reveals Raw when necessary.

Markdown no longer requires a save before previewing. External reloads do not overwrite a dirty buffer or a buffer edited while a read was pending. An edit made while a save is pending remains dirty. Renaming an open Markdown file updates its save target.

File previews keep their original file tab and save path. Opening `.mmd`, Markdown or `.graphx` never creates an additional GraphX document. GraphX document tabs retain **Apply JSON**, **Reload current**, **Import JSON** and **Copy JSON**; the preview follows their draft, while Apply still checks the document incarnation and revision. An agent update does not silently overwrite a dirty JSON draft. Unsaved preview is visibly labelled.

The view choice survives space/app restoration. Older stored tabs keep their previous defaults, and malformed choices fall back safely. Unsaved file buffers have the existing session lifetime; this change does not add disk draft recovery. Snapshots report view mode and Markdown dirty state, without source text. Existing Pi/MCP command IDs and payload enums are unchanged.

## Format and validate GraphX JSON

In **Raw** or **Side by side**, both GraphX documents and `.graphx` files offer **Format JSON**. It uses two spaces, preserves property order, duplicate keys, number spellings and string escapes, and keeps your selection. One Undo restores the pre-format draft; switching views keeps the same editor history. The preview follows the formatted draft.

Syntax errors are underlined and announced with a 1-based line and column. The status also distinguishes syntactically valid JSON from GraphX schema/reference errors. Invalid JSON is left untouched. Format never applies a GraphX revision or saves a file, even with autosave enabled; it cancels a pending autosave timer. Use **Apply JSON** for a GraphX document or **Save** for a `.graphx` file. Later typing resumes your autosave setting.

The existing 48 KiB GraphX validation limit still applies. Drafts can remain editable beyond it; JSON tooling stops at 512 KiB, and formatting refuses nesting beyond 128 levels or output beyond 1 MiB without changing the draft. Generic `.json` files retain their existing editor.

## Mermaid and GraphX

Mermaid's **Preview / Visual** tools select the rendered-side surface. Raw always shows source. Visual retains the existing supported flowchart/sequence editing subset, validation, private layout and history. Unsupported Mermaid syntax stays readable in Preview and source-editable in Raw. Raw mode pauses diagram rendering.

GraphX reuses its existing opaque iframe, offline engine, validation and capture protocol. Persistent documents retain their actual identity and revision; file previews use a local frame identity without entering the tab/document registry. Hidden and Raw views mount no graph engine.

Although the vendor GraphX bundle includes Mermaid conversion helpers, its exposed adapter accepts a bounded JSON schema. Converting arbitrary Mermaid through that schema would lose unsupported syntax and Visual-editing semantics, so Mermaid retains its existing hardened renderer. No new runtime plugin or callback channel is introduced.

## Static HTML boundary

HTML is a document preview, not an application runtime. Scripts, event handlers, forms, popups, navigation, frames, objects, SVG/MathML, external fonts and relative/external resources are disabled. Embedded raster data images and static inline CSS are supported subject to the application's existing CSP. Links are displayed without navigation. No additional filesystem authorization is requested; linked files are not read through the asset protocol.

The document is parsed into inert template contents, rebuilt from an allowlist with escaped values and shown in `sandbox=""` with its own restrictive CSP. It never shares GraphX's trusted script nonce or message protocol. Preview input is capped at 512 KiB of UTF-8 text and the parsed structure at 128 levels / 20,000 nodes. Errors stay inside the preview; the raw source remains editable. HTML iframe pixels are not supported by the DOM capture compositor; validate the actual visible HTML surface separately.

## Verification scope

Focused tests cover mode/identity preservation, legacy/invalid persistence, live buffers, save/reload races, static HTML adversarial payloads parsed with the installed HTML5 parser, bounded structures, renderer mounting, declared accessibility, Mermaid behavior and GraphX capture invariants. Type checking and changed-file lint are included.

Actual WebKit isolation, keyboard focus/selection/undo, live divider resizing, narrow layouts, saved file contents, GraphX capture and light/dark appearance require the coordinated packaged-app acceptance. No UI, native build or app launch was performed by this isolated implementation pass.
