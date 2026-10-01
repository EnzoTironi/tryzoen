import { transaction } from "@db/queries";
import { withDeadline } from "../operations/async";

export function validateMatrixDeadline(deadlineMs: number) {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 0) {
    throw new RangeError("Expected a finite nonnegative Matrix deadline.");
  }
  if (deadlineMs > Date.now() + 30_000) {
    throw new RangeError("Matrix deadline exceeds the thirty-second budget.");
  }
}

export function validateMatrixLimit(limit: number, maximum: number) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > maximum) {
    throw new RangeError(`Expected a Matrix item limit from 0 to ${maximum}.`);
  }
}

/** Every durable phase owns a real commit under the same absolute budget. */
export function withMatrixTransaction<Result>(
  deadlineMs: number,
  run: () => Promise<Result>
) {
  validateMatrixDeadline(deadlineMs);
  return withDeadline(() => transaction(run, { outermost: true }), deadlineMs);
}
