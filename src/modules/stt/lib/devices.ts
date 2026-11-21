import type { TtsDevice } from "@/modules/tts/lib/engines";
import type { TtsEnginePlan, TtsHardware } from "@/modules/tts/lib/native";

const PLAN_DEVICE_LABELS: Record<string, string> = {
  cpu: "CPU",
  mps: "Apple GPU",
  cuda: "NVIDIA GPU",
};

export type SttDeviceChoice = { id: TtsDevice; label: string };

/**
 * Devices worth offering for the dictation engine on this machine, `auto`
 * first and labelled with what the plan picks. Rumble runs on torch, so the
 * Apple GPU (MPS), NVIDIA (CUDA) and the CPU are all real choices.
 */
export function sttDeviceChoices(
  plan: TtsEnginePlan | null | undefined,
  hardware: TtsHardware | null | undefined,
): SttDeviceChoice[] {
  if (plan && !plan.supported) return [];
  const recommended = plan ? PLAN_DEVICE_LABELS[plan.device] : null;
  const out: SttDeviceChoice[] = [
    {
      id: "auto",
      label: recommended ? `Automatic (recommended: ${recommended})` : "Automatic",
    },
    { id: "cpu", label: "CPU" },
  ];
  if (hardware?.appleSilicon) out.push({ id: "mps", label: "Apple GPU (MPS)" });
  if (hardware?.nvidia) out.push({ id: "cuda", label: "NVIDIA GPU (CUDA)" });
  return out;
}
