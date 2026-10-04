import { z } from "zod";
import { maximumBrowserImageBytes } from "@shared/browser/artifact";

const scope = {
  workspaceId: z.string().min(1).max(200),
  ownerGeneration: z.uuid().toLowerCase(),
};
const privateOwner = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value === value.trim());

export const PayloadErasureScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("account"), ownerUserId: privateOwner }),
  z.strictObject({
    kind: z.literal("private-memory"),
    ownerUserId: privateOwner,
    namespaceId: scope.ownerGeneration,
  }),
]);

export const PayloadInventoryScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("all") }),
  z.strictObject({
    kind: z.literal("private-owner"),
    ownerUserId: privateOwner,
  }),
  z.strictObject({
    kind: z.literal("personal-workspace"),
    ownerUserId: privateOwner,
  }),
]);

export const PayloadScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...scope,
    kind: z.literal("workspace-bundle"),
    ownerUserId: z.null(),
  }),
  z.strictObject({
    ...scope,
    kind: z.literal("workspace-source"),
    ownerUserId: z.null(),
  }),
  z.strictObject({
    ...scope,
    kind: z.literal("private-memory-bundle"),
    ownerUserId: privateOwner,
  }),
  z.strictObject({
    ...scope,
    kind: z.literal("private-artifact"),
    ownerUserId: privateOwner,
  }),
  z.strictObject({
    ...scope,
    kind: z.literal("browser-image"),
    ownerUserId: privateOwner,
  }),
]);
const coordinates = {
  candidateId: z.uuid().toLowerCase(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
};

/** Private byte coordinates. These never establish access or publication. */
export const PayloadReferenceSchema = z.discriminatedUnion("kind", [
  PayloadScopeSchema.options[0].extend({
    ...coordinates,
    byteLength: z.number().int().min(0).max(25_165_824),
  }),
  PayloadScopeSchema.options[1].extend({
    ...coordinates,
    byteLength: z.number().int().min(0).max(10_485_760),
  }),
  PayloadScopeSchema.options[2].extend({
    ...coordinates,
    byteLength: z.number().int().min(1).max(25_165_824),
  }),
  PayloadScopeSchema.options[3].extend({
    ...coordinates,
    byteLength: z.number().int().min(1).max(10_485_760),
  }),
  PayloadScopeSchema.options[4].extend({
    ...coordinates,
    byteLength: z.number().int().min(1).max(maximumBrowserImageBytes),
  }),
]);

export type PayloadReference = z.infer<typeof PayloadReferenceSchema>;

export class PayloadError extends Error {
  constructor(
    readonly reason: "invalid" | "corrupt" | "missing" | "unavailable"
  ) {
    super(`Private payload ${reason}`);
    this.name = "PayloadError";
  }
}
