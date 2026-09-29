import { queryOptions } from "@tanstack/react-query";
import type { z } from "zod";
import type { OntologyData } from "./collection";
import type { OntologyReadSchema } from "./schema";

export function ontologyReadOptions(
  data: OntologyData,
  view: z.output<typeof OntologyReadSchema>
) {
  return queryOptions({
    queryKey: [
      ...data.cacheKey,
      "read",
      view.revision ?? "current",
      view.validOn ?? "all-dates",
    ],
    queryFn: () => data.read(view),
    staleTime: 15_000,
  });
}
