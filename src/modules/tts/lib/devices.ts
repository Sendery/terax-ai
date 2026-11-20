import type { TtsDevice, TtsEngineId } from "./engines";
import type { TtsEnginePlan, TtsHardware } from "./native";

const PLAN_DEVICE_LABELS: Record<string, string> = {
  cpu: "CPU",
  mps: "Apple GPU",
  cuda: "NVIDIA GPU",
  mlx: "Apple GPU (MLX)",
};

export type DeviceChoice = { id: TtsDevice; label: string };

/**
 * The devices worth offering for one engine on this machine, `auto` first and
 * labelled with what the plan picks. Empty when there is nothing to choose:
 * ZONOS3-Mini only runs on MLX, and Pocket TTS on Apple Silicon is fastest on
 * the CPU and has no GPU path there.
 */
export function deviceChoices(
  engine: TtsEngineId,
  plan: TtsEnginePlan | null | undefined,
  hardware: TtsHardware | null | undefined,
): DeviceChoice[] {
  if (plan && !plan.supported) return [];
  if (engine === "zonos3") return [];
  const apple = hardware?.appleSilicon ?? false;
  const nvidia = !!hardware?.nvidia;
  if (engine === "pocket" && apple) return [];
  const recommended = plan ? PLAN_DEVICE_LABELS[plan.device] : null;
  const out: DeviceChoice[] = [
    {
      id: "auto",
      label: recommended ? `Automatic (recommended: ${recommended})` : "Automatic",
    },
    { id: "cpu", label: "CPU" },
  ];
  if (apple && engine !== "pocket") out.push({ id: "mps", label: "Apple GPU (MPS)" });
  if (nvidia) out.push({ id: "cuda", label: "NVIDIA GPU (CUDA)" });
  return out;
}
