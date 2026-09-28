import {
  createContext,
  useContext,
  useMemo,
  type ContextType,
  type ReactNode,
} from "react";
import type { z } from "zod";
import type { linkPreviewSchema } from "./schema";
const Previews = createContext<
  | {
      cacheScope: string;
      load: (url: string) => Promise<z.infer<typeof linkPreviewSchema>>;
    }
  | undefined
>(undefined);
export function LinkPreviewProvider({
  cacheScope,
  load,
  children,
}: NonNullable<ContextType<typeof Previews>> & { children: ReactNode }) {
  const value = useMemo(() => ({ cacheScope, load }), [cacheScope, load]);
  return <Previews value={value}>{children}</Previews>;
}
export function useLinkPreviews() {
  return useContext(Previews);
}
