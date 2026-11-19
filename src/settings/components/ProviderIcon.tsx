import type { ProviderId } from "@/modules/ai/config";
import { PROVIDER_ICONS } from "@/modules/ai/lib/providerPresentation";
import { HugeiconsIcon } from "@hugeicons/react";

type Props = {
  provider: ProviderId;
  size?: number;
  className?: string;
};

export function ProviderIcon({ provider, size = 14, className }: Props) {
  return (
    <HugeiconsIcon
      icon={PROVIDER_ICONS[provider]}
      size={size}
      strokeWidth={1.75}
      className={className}
    />
  );
}
