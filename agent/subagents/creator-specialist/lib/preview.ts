import { defineState } from "eve/context";
import type { z } from "zod";
import type { creatorPreviewOriginSchema } from "../../../../server/creators/execution";

export const previewOrigin = defineState<z.infer<
  typeof creatorPreviewOriginSchema
> | null>("creator-specialist.preview-origin", () => null);
