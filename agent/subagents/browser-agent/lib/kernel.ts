import Kernel from "@onkernel/sdk";
import { env } from "@shared/environment/env";

let client: Kernel | undefined;

export function getKernel(): Kernel {
  if (!env.KERNEL_API_KEY || env.KERNEL_API_KEY !== env.KERNEL_API_KEY.trim()) {
    throw new Error(
      "Browser execution is not configured. Set KERNEL_API_KEY to enable it."
    );
  }
  return (client ??= new Kernel({ apiKey: env.KERNEL_API_KEY }));
}
