export class ChannelAccountError extends Error {
  readonly _tag = "ChannelAccountError";
  declare readonly reason:
    | "invalid_input"
    | "identity_inactive"
    | "invalid_challenge"
    | "account_conflict"
    | "session_invalid"
    | "last_access"
    | "sender_unlinked";
  constructor(input: {
    readonly reason:
      | "invalid_input"
      | "identity_inactive"
      | "invalid_challenge"
      | "account_conflict"
      | "session_invalid"
      | "last_access"
      | "sender_unlinked";
  }) {
    super("ChannelAccountError");
    this.name = "ChannelAccountError";
    Object.assign(this, input);
  }
}
