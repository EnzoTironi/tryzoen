import {
  createContext,
  useMemo,
  useContext,
  type ReactNode,
  type ContextType,
} from "react";
import type { z } from "zod";
import type { referenceSearchSchema, referenceResultsSchema } from "./schema";

const References = createContext<
  | {
      search: (
        input: z.infer<typeof referenceSearchSchema>
      ) => Promise<z.infer<typeof referenceResultsSchema>>;
      cacheScope: string;
      roomId?: string;
    }
  | undefined
>(undefined);

export function ComposerReferenceProvider({
  search,
  cacheScope,
  roomId,
  children,
}: NonNullable<ContextType<typeof References>> & { children: ReactNode }) {
  const value = useMemo(
    () => ({ search, cacheScope, roomId }),
    [search, cacheScope, roomId]
  );
  return <References value={value}>{children}</References>;
}
export function useComposerReferences() {
  return useContext(References);
}
