"use client";

import { useSearchParams } from "next/navigation";
import { parseVaultSetupSearchParams } from "@zoen/companion-ui/vault";

export function useVaultSetup() {
  const searchParams = useSearchParams();
  const requestedSetup = parseVaultSetupSearchParams(
    Object.fromEntries(searchParams.entries())
  );
  return requestedSetup.success ? requestedSetup.data : undefined;
}
