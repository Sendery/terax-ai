import { cn } from "@/lib/utils";
import type {
  ReaderBlock,
  ReaderDocument,
  ReaderWord,
} from "@/modules/reader/lib/document";
import type { CutPoint } from "@/modules/reader/lib/manifest";
import { memo, type ReactNode } from "react";

/**
 * The reading column. Text not yet read is dimmed, the sentence being read is
 * lit, the word being spoken is marked, and what was read stays legible but
 * steps back. Cut points sit in the left gutter next to their word.
 *
 * Only the block being read re-renders on every word; the others change only
 * when they pass from "ahead" to "read".
 */

type Relation = "read" | "active" | "future";

type Props = {
  doc: ReaderDocument;
  /** Segment and word at the reading point. */
  segment: number;
  word: number;
  /** True while sound is being produced or about to be. */
  live: boolean;
  /** Keyboard cursor, when the user moved it away from the reading point. */
  cursor: number | null;
  cutsByBlock: ReadonlyMap<number, readonly CutPoint[]>;
};

export function ReaderText({
  doc,
  segment,
  word,
  live,
  cursor,
  cutsByBlock,
}: Props) {
  const activeBlock =
    doc.segments[segment]?.block ?? doc.words[word]?.block ?? 0;
  const cursorBlock = cursor !== null ? (doc.words[cursor]?.block ?? -1) : -1;
  return (
    <>
      {doc.blocks.map((block) => {
        const relation: Relation =
          block.index < activeBlock
            ? "read"
            : block.index > activeBlock
              ? "future"
              : "active";
        const active = relation === "active";
        return (
          <BlockView
            key={block.index}
            doc={doc}
            block={block}
            relation={relation}
            segment={active ? segment : -1}
            word={active ? word : -1}
            live={active && live}
            cursor={block.index === cursorBlock ? cursor : null}
            cuts={cutsByBlock.get(block.index)}
          />
        );
      })}
    </>
  );
}

type BlockProps = {
  doc: ReaderDocument;
  block: ReaderBlock;
  relation: Relation;
  segment: number;
  word: number;
  live: boolean;
  cursor: number | null;
  cuts: readonly CutPoint[] | undefined;
};

const BLOCK_TONE: Record<Relation, string> = {
  read: "text-foreground/65",
  active: "text-foreground",
  future: "text-muted-foreground/80",
};

const BlockView = memo(function BlockView({
  doc,
  block,
  relation,
  segment,
  word,
  live,
  cursor,
  cuts,
}: BlockProps) {
  if (block.kind === "code") {
    return (
      <pre
        className="my-3 overflow-x-auto rounded-md border bg-muted/40 px-3 py-2 font-mono text-[12px] leading-relaxed text-muted-foreground"
        data-block={block.index}
        title="Code is shown, not read aloud"
      >
        {block.code}
      </pre>
    );
  }

  const words = doc.words.slice(block.wordStart, block.wordEnd);
  const cutsAt = new Map<number, CutPoint[]>();
  for (const cut of cuts ?? []) {
    const list = cutsAt.get(cut.wordIndex) ?? [];
    list.push(cut);
    cutsAt.set(cut.wordIndex, list);
  }

  const renderWord = (w: ReaderWord): ReactNode => {
    const segmentRelation: Relation =
      relation !== "active"
        ? relation
        : w.segment < segment
          ? "read"
          : w.segment > segment
            ? "future"
            : "active";
    const spoken = segmentRelation === "active" && w.index === word;
    const before = w.index < word && segmentRelation === "active";
    return (
      <span key={w.index}>
        {cutsAt.has(w.index) || (spoken && !live) ? (
          <GutterMarks
            cuts={cutsAt.get(w.index) ?? []}
            resume={spoken && !live}
          />
        ) : null}
        <span
          data-w={w.index}
          className={cn(
            "cursor-pointer rounded-[3px] transition-colors duration-100",
            segmentRelation === "active" && "bg-amber-400/10",
            segmentRelation === "read" &&
              relation === "active" &&
              "text-foreground/65",
            segmentRelation === "future" &&
              relation === "active" &&
              "text-muted-foreground/80",
            before && "text-foreground/90",
            spoken &&
              (live
                ? "bg-amber-300 text-zinc-900 shadow-[0_0_0_2px_rgb(252_211_77)]"
                : "underline decoration-amber-400 decoration-2 underline-offset-4"),
            !w.spoken && "italic opacity-70",
            cursor === w.index &&
              "outline outline-2 outline-offset-1 outline-sky-500",
            "hover:bg-accent/60",
          )}
        >
          {w.text}
        </span>{" "}
      </span>
    );
  };

  const tone = BLOCK_TONE[relation];

  if (block.kind === "table-row") {
    const cells = new Map<number, ReaderWord[]>();
    for (const w of words) {
      const list = cells.get(w.cell) ?? [];
      list.push(w);
      cells.set(w.cell, list);
    }
    const count = Math.max(1, ...[...cells.keys()].map((c) => c + 1));
    return (
      <div
        data-block={block.index}
        className={cn(
          "relative grid gap-x-4 border-b border-border/60 py-1.5 text-[14px]",
          block.header && "font-semibold",
          tone,
        )}
        style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: count }, (_, c) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
          <div key={c} className="min-w-0">
            {(cells.get(c) ?? []).map(renderWord)}
          </div>
        ))}
      </div>
    );
  }

  const body = words.map(renderWord);
  if (block.kind === "heading") {
    const size =
      block.level <= 1
        ? "text-2xl"
        : block.level === 2
          ? "text-xl"
          : block.level === 3
            ? "text-lg"
            : "text-base";
    const Heading = (["h1", "h2", "h3", "h4", "h5", "h6"] as const)[
      Math.min(6, Math.max(1, block.level)) - 1
    ];
    return (
      <Heading
        data-block={block.index}
        className={cn(
          "relative mt-7 mb-3 font-semibold leading-snug",
          size,
          tone,
        )}
      >
        {body}
      </Heading>
    );
  }
  if (block.kind === "list") {
    return (
      <div
        data-block={block.index}
        className={cn("relative my-1 flex gap-2", tone)}
        style={{ paddingLeft: `${block.level * 1.25}rem` }}
      >
        <span className="w-5 shrink-0 text-right text-muted-foreground">
          {block.marker === "-" ? "•" : block.marker}
        </span>
        <p className="min-w-0 flex-1">{body}</p>
      </div>
    );
  }
  if (block.kind === "quote") {
    return (
      <blockquote
        data-block={block.index}
        className={cn(
          "relative my-4 border-l-2 border-border pl-4 italic",
          tone,
        )}
      >
        {body}
      </blockquote>
    );
  }
  return (
    <p data-block={block.index} className={cn("relative my-4", tone)}>
      {body}
    </p>
  );
});

/**
 * Marks in the left margin. Positioned against the block with no `top`, so
 * each one keeps the vertical position of the word it belongs to.
 */
function GutterMarks({
  cuts,
  resume,
}: {
  cuts: readonly CutPoint[];
  resume: boolean;
}) {
  return (
    <span
      // inline-flex, not flex: an absolute box keeps the static position of
      // its original display, and a block one would drop below the line.
      className="pointer-events-none absolute -left-10 inline-flex w-8 select-none justify-end gap-0.5 text-[12px] leading-[inherit]"
      aria-hidden
    >
      {resume ? (
        <span title="Saved reading point" className="text-emerald-500">
          ▶
        </span>
      ) : null}
      {cuts.map((cut) => (
        <span
          key={cut.id}
          title={cut.label}
          className={cn(
            cut.kind === "bookmark" && "text-cyan-500",
            cut.kind === "pause" && "text-amber-500",
            cut.kind === "stop" && "text-red-500",
          )}
        >
          {cut.kind === "bookmark" ? "⚑" : cut.kind === "pause" ? "‖" : "■"}
        </span>
      ))}
    </span>
  );
}
