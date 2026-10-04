export class PrivateMemoryError extends Error {
  readonly _tag = "PrivateMemoryError";
  constructor(
    readonly reason:
      | "conflict"
      | "invalid_input"
      | "unavailable"
      | "disabled"
      | "stale_recall",
    options?: ErrorOptions
  ) {
    super("PrivateMemoryError", options);
    this.name = "PrivateMemoryError";
  }
}
