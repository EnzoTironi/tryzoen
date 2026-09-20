export class ChannelAccountError extends Error {
  readonly _tag = "ChannelAccountError";
  declare readonly reason:
    | "invalid_input"
    | "identity_inactive"
    | "invalid_challenge"
    | "account_conflict"
    | "session_invalid"
    | "last_access"
    | "sender_unlinked"
    | "archive_requires_review"
    | "account_busy";
  constructor(input: {
    readonly reason:
      | "invalid_input"
      | "identity_inactive"
      | "invalid_challenge"
      | "account_conflict"
      | "session_invalid"
      | "last_access"
      | "sender_unlinked"
      | "archive_requires_review"
      | "account_busy";
  }) {
    super("ChannelAccountError");
    this.name = "ChannelAccountError";
    Object.assign(this, input);
  }
}
