import type { UIMessage } from "ai";
import type { CliAgentId } from "@/modules/ai/cli/types";

export const MAX_TEXT_INLINE = 200_000;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

export type ChatImage = { mediaType: ImageType; data: string };
export type FileAttachment = {
  id: string;
  name: string;
  kind: "image" | "text" | "selection";
  mediaType: string;
  url?: string;
  text?: string;
  size: number;
  source?: "terminal" | "editor" | "chat";
};

function imageType(value: string): ImageType | undefined {
  return IMAGE_TYPES.find((type) => type === value);
}

export function clipboardFiles(clipboard: Pick<DataTransfer, "files" | "items">): File[] {
  if (clipboard.files.length) return Array.from(clipboard.files);
  return Array.from(clipboard.items).flatMap((item) => {
    const file = item.kind === "file" ? item.getAsFile() : null;
    return file ? [file] : [];
  });
}

export async function readChatAttachment(file: File): Promise<FileAttachment> {
  const id = crypto.randomUUID();
  const name = file.name || "Clipboard image";
  const ext = file.name.split(".").pop()?.toLowerCase();
  const mediaType = imageType(file.type) ?? ((!file.type || file.type === "application/octet-stream")
    ? imageType(`image/${ext === "jpg" ? "jpeg" : ext}`)
    : undefined);
  if (mediaType) {
    if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
      throw new Error(`${name}: images must be between 1 byte and 10 MB.`);
    }
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reader.onabort = () => reject(new Error(`Could not read ${name}.`));
      reader.readAsDataURL(file.slice(0, file.size, mediaType));
    });
    return { id, name, kind: "image", mediaType, url, size: file.size };
  }
  if (file.type.startsWith("image/")) {
    throw new Error(`${name}: choose a PNG, JPEG, GIF or WebP image.`);
  }
  if (file.size > MAX_TEXT_INLINE) {
    throw new Error(`${name}: text attachments must be 200 KB or smaller.`);
  }
  const bytes = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0")) throw new Error();
  } catch {
    throw new Error(`${name}: only images and UTF-8 text attachments are supported.`);
  }
  return { id, name, kind: "text", mediaType: file.type || "text/plain", text, size: file.size };
}

export function cliAcceptsImages(id: CliAgentId): boolean {
  return id === "pi" || id === "codex" || id === "claude";
}

export function lastUserImages(messages: readonly UIMessage[]): ChatImage[] {
  let index = messages.length - 1;
  while (index >= 0 && messages[index].role !== "user") index--;
  const lastUser = messages[index];
  const images: ChatImage[] = [];
  for (const part of lastUser?.parts ?? []) {
    if (part.type !== "file" || !part.mediaType.startsWith("image/")) continue;
    const mediaType = imageType(part.mediaType);
    const prefix = `data:${part.mediaType};base64,`;
    if (!mediaType || !part.url.startsWith(prefix) || part.url.length <= prefix.length) {
      throw new Error("Invalid image attachment. Reattach it as PNG, JPEG, GIF or WebP.");
    }
    images.push({ mediaType, data: part.url.slice(prefix.length) });
  }
  return images;
}
