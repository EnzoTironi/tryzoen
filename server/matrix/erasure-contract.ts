import { z } from "zod";

const coordinate = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[^\s]+$/u);

export const MatrixErasureDepartureSchema = z.strictObject({
  bindingId: z.uuid(),
  matrixId: coordinate.startsWith("@"),
  roomId: coordinate.startsWith("!"),
  installationId: coordinate,
  workspaceId: z.string().min(1).max(200),
  organizationId: z.string().min(1).max(200).nullable(),
});
