import { z } from "zod";
import {
  OntologyActInputSchema,
  type OntologyReadResultSchema,
  type OntologyClaimSchema,
} from "./schema";

export function ontologyPropertyClaim(
  properties:
    | z.output<
        typeof OntologyReadResultSchema
      >["graph"]["entities"][number]["properties"]
    | undefined,
  propertyId: string
) {
  return properties
    ? new Map(Object.entries(properties)).get(propertyId)
    : undefined;
}

/** One property correction, captured at the head the person actually reviewed. */
export function beginOntologyAction(
  record: z.output<typeof OntologyReadResultSchema>,
  entityId: string,
  actionId: string,
  metadata: "keep" | "replace" | "clear" = "keep"
) {
  const revision = record.revision;
  const entity = record.graph.entities.find((item) => item.id === entityId);
  const action = record.graph.actions.find((item) => item.id === actionId);
  const property = record.graph.types
    .find((item) => item.id === entity?.type)
    ?.properties.find((item) => item.id === action?.property);
  if (
    !record.mayManage ||
    revision === null ||
    record.asOf !== null ||
    record.validOn !== null ||
    !entity ||
    !action ||
    entity.type !== action.entityType ||
    !property
  )
    return null;
  const claim: z.output<typeof OntologyClaimSchema> = ontologyPropertyClaim(
    entity.properties,
    property.id
  ) ?? { value: null, sources: [], validTime: null };
  return {
    record,
    entityId,
    actionId,
    title: action.name,
    property,
    expectedRevision: revision,
    value: claim.value === null ? "" : String(claim.value),
    unknown: claim.value === null,
    metadata,
    sources: claim.sources.map((source, index) => ({
      sourceKey: `${revision}:${index}`,
      ...source,
    })),
    from: claim.validTime?.from ?? "",
    until: claim.validTime?.until ?? "",
  };
}

export type OntologyActionDraft = NonNullable<
  ReturnType<typeof beginOntologyAction>
>;

export type OntologyActionState =
  | { readonly kind: "editing"; readonly draft: OntologyActionDraft }
  | {
      readonly kind: "review" | "sending" | "uncertain" | "conflict";
      readonly draft: OntologyActionDraft;
      readonly input: ReturnType<typeof ontologyActionInput>;
    }
  | {
      readonly kind: "comparison";
      readonly draft: OntologyActionDraft;
      readonly input: ReturnType<typeof ontologyActionInput>;
      readonly current: z.output<typeof OntologyReadResultSchema>;
    }
  | { readonly kind: "denied" };

export function startOntologyAction(
  state: OntologyActionState
): OntologyActionState {
  return state.kind === "review" || state.kind === "uncertain"
    ? { ...state, kind: "sending" }
    : state;
}

/** A delayed discard must use the live phase, never the phase of its prompt. */
export function discardOntologyAction(
  state: OntologyActionState,
  loadingCurrent: boolean
): OntologyActionState | { readonly kind: "closed" } {
  if (state.kind === "sending" || state.kind === "uncertain" || loadingCurrent)
    return state;
  return { kind: "closed" };
}

export function ontologyActionInput(
  draft: OntologyActionDraft,
  operationId: z.output<typeof OntologyActInputSchema>["operationId"]
) {
  if (draft.unknown && draft.property.required)
    throw new Error("This property requires a value.");
  const captured = ontologyPropertyClaim(
    draft.record.graph.entities.find((entity) => entity.id === draft.entityId)
      ?.properties,
    draft.property.id
  ) ?? {
    value: null,
    sources: [],
    validTime: null,
  };
  const text = draft.value;
  const value = draft.unknown
    ? null
    : draft.property.type === "number"
      ? z.number().parse(text.trim() === "" ? NaN : Number(text))
      : draft.property.type === "boolean"
        ? z
            .enum(["true", "false"])
            .transform((item) => item === "true")
            .parse(text)
        : draft.property.type === "date"
          ? z.iso.date().parse(text)
          : text;
  return OntologyActInputSchema.parse({
    operationId,
    expectedRevision: draft.expectedRevision,
    entityId: draft.entityId,
    actionId: draft.actionId,
    value,
    sources:
      draft.metadata === "clear"
        ? []
        : draft.metadata === "keep"
          ? captured.sources
          : draft.sources.map(({ path, revision, excerpt }) => ({
              path,
              revision,
              excerpt,
            })),
    validTime:
      draft.metadata === "keep"
        ? captured.validTime
        : draft.metadata === "clear" || (!draft.from && !draft.until)
          ? null
          : { from: draft.from || null, until: draft.until || null },
  });
}

/** Rebasing is explicit; the captured draft is never replaced by fresh values. */
export function rebaseOntologyAction(
  draft: OntologyActionDraft,
  current: z.output<typeof OntologyReadResultSchema>
) {
  const next = beginOntologyAction(current, draft.entityId, draft.actionId);
  if (
    !next ||
    next.property.id !== draft.property.id ||
    next.property.type !== draft.property.type
  )
    return null;
  return {
    ...draft,
    expectedRevision: next.expectedRevision,
  };
}

export function ontologyActionFailure(cause: unknown) {
  const result = z
    .object({ data: z.object({ code: z.string() }) })
    .safeParse(cause);
  switch (result.success ? result.data.data.code : undefined) {
    case "CONFLICT":
      return "conflict";
    case "FORBIDDEN":
    case "UNAUTHORIZED":
      return "denied";
    case "BAD_REQUEST":
    case "PRECONDITION_FAILED":
      return "invalid";
    default:
      return "uncertain";
  }
}
