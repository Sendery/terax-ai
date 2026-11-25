import { describe, expect, it } from "vitest";
import { clipboardFiles, readChatAttachment } from "@/modules/ai/lib/attachments";

describe("chat attachments", () => {
  it("reads file entries without duplicating the clipboard's FileList", () => {
    const file = new File(["example"], "notes.txt", { type: "text/plain" });
    const items = [{ kind: "file", getAsFile: () => file }] as unknown as DataTransferItemList;
    const files = [file] as unknown as FileList;
    expect(clipboardFiles({ files, items })).toEqual([file]);
    expect(clipboardFiles({ files: [] as unknown as FileList, items })).toEqual([file]);
    expect(clipboardFiles({ files: [] as unknown as FileList, items: [] as unknown as DataTransferItemList })).toEqual([]);
  });

  it("preserves UTF-8 text file contents and rejects binary pasted data", async () => {
    await expect(readChatAttachment(new File(["acción"], "notes.md"))).resolves.toMatchObject({
      name: "notes.md", kind: "text", text: "acción",
    });
    await expect(readChatAttachment(new File([new Uint8Array([0xff, 0x00])], "archive.zip")))
      .rejects.toThrow("only images and UTF-8 text");
  });
});
