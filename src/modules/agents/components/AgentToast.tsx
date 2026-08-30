import { tabColorStyle, type TabColor } from "@/modules/tabs";
import { toast } from "sonner";
import { AgentIcon } from "../lib/agentIcon";

type AgentToastArgs = {
  agent: string;
  title: string;
  body?: string;
  /** Tab the event came from, so the toast is recognisable at a glance. */
  tabTitle?: string;
  tabColor?: TabColor | null;
  onActivate: () => void;
};

export function showAgentToast({
  agent,
  title,
  body,
  tabTitle,
  tabColor,
  onActivate,
}: AgentToastArgs) {
  toast(title, {
    description: (
      <span className="flex flex-col gap-1">
        {body ? <span>{body}</span> : null}
        {tabTitle ? (
          <span
            className="inline-flex w-fit items-center rounded border px-1 text-[10px] leading-[15px]"
            style={
              tabColor
                ? tabColorStyle(tabColor, false)
                : { borderColor: "var(--border)" }
            }
          >
            {tabTitle}
          </span>
        ) : null}
      </span>
    ),
    icon: <AgentIcon agent={agent} size={18} />,
    action: { label: "Open", onClick: onActivate },
    duration: 6000,
  });
}
