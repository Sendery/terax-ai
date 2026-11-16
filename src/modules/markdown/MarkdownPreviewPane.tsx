import { Streamdown } from "streamdown";
import { MarkdownCodeBlock } from "@/modules/markdown/MarkdownCodeBlock";
import { MarkdownLink } from "@/modules/markdown/MarkdownLink";
const components = { a: MarkdownLink, code: MarkdownCodeBlock };
export function MarkdownSourcePreview({ source }: { source: string }) {
  return <div className="h-full min-w-0 overflow-auto px-6 py-5"><Streamdown className="select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" components={components} mode="static" parseIncompleteMarkdown={false}>{source}</Streamdown></div>;
}
