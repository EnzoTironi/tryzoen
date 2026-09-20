# Durable messaging store

`Messaging` provides async product operations using Drizzle and the transaction
context in `db/queries.ts`. It persists provider acceptance, dispatch leases and
outcomes. Native Eve channels own session delivery; provider adapters own sends.

The caller must resolve and authorize `identityId` before invoking the service.
It is not an identity supplied directly by an untrusted HTTP body. Acceptance,
enqueueing, claims and fenced mutations lock `channel_identity` and check its
revocation state. Inspection also works for revoked identities, so their owner
can still see unresolved work; the caller remains responsible for read access.

## API

- `accept({ identityId, eventId, sourceMessageId, payload })` and
  `enqueue({ identityId, deliveryKey, payload })` return a `MessageReceipt` after
  their SQL transaction completes. Send the provider ACK only after this effect
  succeeds. Do not wrap acceptance in a still-uncommitted outer transaction.
- `claimInbox({ identityId, leaseSeconds })` and `claimOutbox(...)` return
  `MessageClaim | null`. Lease duration is 1–300 seconds. Inbox order is its
  database sequence; outbox order is creation time with ID as a tie-breaker.
- `checkInboxLease(lease)` / `checkOutboxLease(lease)` revalidate immediately
  before adapter I/O. `lease` is `{ identityId, id, leaseToken }`.
- `markAccepted({ lease, receipt: { status: "accepted", sessionId } })` and
  `markSent({ lease, receipt: { status: "sent", providerMessageId } })` record
  confirmed adapter responses. These checks cannot establish that a caller
  actually contacted a provider; only the adapter can supply that evidence.
- `markInboxUncertain({ lease, reason })` / `markOutboxUncertain(...)` record
  ambiguous handoffs. Reasons are categorical and never contain raw errors.
- `markInboxFailed({ lease, reason: "adapter_rejected" })` and its outbox
  counterpart are for confirmed terminal rejection with no external effect.
- `resolveOutboxUncertain({ identityId, id, decision, actorPrincipalId, note? })`
  reconciles one uncertain outbox row with an audit record:
  `mark_delivered` (requires `providerMessageId`), `cancel` (categorical reason),
  or `authorize_retry` (requires `acknowledgment: "duplicate_delivery_risk_accepted"`).
  Delivery and retry require an active identity; cancel may clear a revoked
  identity's stuck uncertain row. Matching terminal replays are idempotent.
- `inspectInbox(identityId)` / `inspectOutbox(identityId)` return all status
  counts and up to 100 oldest uncertain receipts for account/operator views.

Payload is `{ text?, attachments?: [{ id, mediaType, name? }], replyToMessageId? }`.
It requires nonblank text or at least one attachment. Attachment IDs are stored
references, not fetched URLs. The adapter must enforce attachment ownership.
Limits are 16,384 text characters, ten attachments and bounded reference strings.
Unknown fields are rejected, including caller-supplied hashes. Canonicalization
fixes object key order and normalizes absent attachments to an empty array while
preserving attachment order. Replay with a changed digest raises `PayloadConflict`.

## Uncertainty and revocation

Each lane permits one dispatching item per identity. Claims turn expired leases
into `uncertain`; both dispatching and uncertain items block subsequent claims.
Nothing automatically resets an uncertain item to queued. Use
`resolveOutboxUncertain` for audited reconciliation: mark delivered when a
provider receipt is recovered, cancel when the intent is abandoned, or authorize
a duplicate-risk retry when an operator accepts that the provider may deliver
twice. Each resolution inserts into `channel_outbox_resolution` before mutating
the outbox row.

For a revoked identity, an outbox claim cancels queued output and returns null.
Completion and preflight checks reject revoked identities. Revocation after the
last check can race an external operation: the service never holds a database
transaction open across provider I/O. An adapter timeout, crash or expired lease
does not prove failure and does not authorize a resend.

Native delivery records input consumption in Eve channel state.
`native-receipts.ts` indexes the consuming session in PostgreSQL and serializes
transport handoff per workspace and address. Acknowledgment requires the durable
receipt and Eve's checkpointed session alias; a cold candidate is not an
acknowledgment. Replays with changed contents fail. Eve owns the turn queue and
recovery, and the number of aliases does not grow with message count.

`tests/runtime/messaging.integration.ts` uses the isolated PostgreSQL environment
documented in [local setup](../../docs/local-runtime-setup.md).
Its synthetic receipt IDs exercise storage transitions, not provider delivery.

Inbox receipts and claims retain the required original provider `sourceMessageId` separately from the webhook event key. It participates in inbox replay conflict detection and survives service reconstruction for native reply/auth attribution. Outbox receipts and claims expose `sourceMessageId: null`; their intent hash remains payload-only.
