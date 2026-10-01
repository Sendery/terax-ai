import {
  ChatGptIcon,
  ClaudeIcon,
  GoogleGeminiIcon,
  PiIcon,
  RoboticIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { AgentHarness } from "./types";

export function iconForHarness(harness: AgentHarness): IconSvgElement {
  switch (harness) {
    case "pi":
      return PiIcon;
    case "claude":
      return ClaudeIcon;
    case "codex":
      return ChatGptIcon;
    case "generic":
      return RoboticIcon;
  }
}

export function isTeraxAgent(agent: string): boolean {
  return agent.toLowerCase().includes("terax");
}

export function iconFor(agent: string, harness?: AgentHarness): IconSvgElement {
  if (harness !== undefined) return iconForHarness(harness);
  const a = agent.toLowerCase();
  if (a === "pi" || a.startsWith("pi ")) return PiIcon;
  if (a.includes("claude")) return ClaudeIcon;
  if (a.includes("codex") || a.includes("gpt") || a.includes("openai"))
    return ChatGptIcon;
  if (a.includes("gemini")) return GoogleGeminiIcon;
  return RoboticIcon;
}

export function AgentIcon({
  agent,
  size = 15,
  className,
  harness,
}: {
  agent: string;
  size?: number;
  className?: string;
  harness?: AgentHarness;
}) {
  if (harness === undefined && isTeraxAgent(agent)) {
    return (
      <img
        src="/logo.png"
        alt=""
        width={size}
        height={size}
        className={className}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <HugeiconsIcon
      icon={iconFor(agent, harness)}
      size={size}
      strokeWidth={1.75}
      className={className}
    />
  );
}
