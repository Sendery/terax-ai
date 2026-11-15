type SourceDocument = {
  lines: number;
  line: (number: number) => { from: number; length: number };
};
export function editorLocationOffset(
  doc: SourceDocument,
  line: number,
  column = 1,
): number {
  const lineNumber = Number.isSafeInteger(line)
    ? Math.max(1, Math.min(line, doc.lines))
    : 1;
  const target = doc.line(lineNumber);
  const col = Number.isSafeInteger(column) ? Math.max(1, column) : 1;
  return target.from + Math.min(col - 1, target.length);
}
