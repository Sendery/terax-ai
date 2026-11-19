import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LayoutBottomIcon,
  LayoutLeftIcon,
  LayoutRightIcon,
  PictureInPictureOnIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CHAT_LAYOUT_LABEL,
  CHAT_LAYOUT_MODES,
  isChatLayoutMode,
  type ChatLayoutMode,
} from "@/modules/ai/lib/chatLayout";
import { useChatLayoutStore } from "@/modules/ai/store/chatLayoutStore";
import { switchChatLayout } from "./ChatRelocate";

const CHAT_LAYOUT_ICON: Record<ChatLayoutMode, typeof LayoutLeftIcon> = {
  floating: PictureInPictureOnIcon,
  left: LayoutLeftIcon,
  right: LayoutRightIcon,
  bottom: LayoutBottomIcon,
};

export function ChatLayoutMenu() {
  const mode = useChatLayoutStore((s) => s.mode);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-5 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={`Chat layout: ${CHAT_LAYOUT_LABEL[mode]}`}
          title="Chat layout"
        >
          <HugeiconsIcon
            icon={CHAT_LAYOUT_ICON[mode]}
            size={12}
            strokeWidth={1.75}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          Show chat as
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(v) => {
            if (isChatLayoutMode(v)) switchChatLayout(v);
          }}
        >
          {CHAT_LAYOUT_MODES.map((m) => (
            <DropdownMenuRadioItem key={m} value={m} className="gap-2 text-xs">
              <HugeiconsIcon
                icon={CHAT_LAYOUT_ICON[m]}
                size={12}
                strokeWidth={1.75}
              />
              {CHAT_LAYOUT_LABEL[m]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
