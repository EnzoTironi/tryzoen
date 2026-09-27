# Akita ai-memory and Zoen

Reviewed on 2026-09-27 against [akitaonrails/ai-memory](https://github.com/akitaonrails/ai-memory), commit `49147a5d173657031b6b846e5beb8a839219c050`. The project is MIT licensed, copyright Fabio Akita. No upstream source has been copied, installed or executed in Zoen.

## Fit

Ai-memory is a Rust MCP/HTTP service built around a Git-versioned Markdown knowledge base. A derived SQLite index combines full-text, entity and graph retrieval, with optional vectors. A single writer serializes changes; observations, session consolidation and claim-once handoffs make it useful for coding agents continuing work across sessions. LLM consolidation is optional rather than a prerequisite for every operation.

This is a useful reference for inspectable memory, provenance and bounded retrieval. It is not a drop-in replacement for Zoen's consumer account model. A local project directory and a single-writer SQLite database do not establish cross-account authorization, session revocation, tenant quotas or horizontally scaled durable execution. Upstream throughput claims are not Zoen capacity measurements.

## Decision for this implementation

Keep Eve as the runtime and PostgreSQL as the authoritative application store. Preserve private Mem0 for learned workspace facts, and the existing scoped Eve file-memory provider for personal notes. Do not introduce a second memory authority or dual-write an external wiki.

Expose readable personal notes with update dates and direct human correction. Each save verifies the current authenticated account and exact live session, locks its membership and bound document, and requires the revision the user reviewed. The client never selects a memory namespace or supplies a storage key. Changed or foreign revisions fail without writing, and unsaved edits remain visible.

Eve's file-memory format has permanent entry indices. The editor presents one fact per line and retains unchanged indices; changed/new facts receive fresh indices, including after all notes are removed. This prevents a model with an old recalled index from removing a different fact. Entry byte limits and a bounded recall budget are enforced. The adapter targets Eve 0.63's persisted v1 contract and must be reviewed during the tracked Eve upgrade. Runtime tests exercise the public Eve provider against documents edited through this path.

The existing JSON export retains its explicit coverage: profile and bound personal notes, excluding conversations, artifacts, connectors, schedules and unbound documents. Learned workspace memories remain a separate scope. Editing personal notes does not promise deletion of previous chat messages, downloaded exports or backups.

## Further adoption gates

Before adding graph recall, automatic observations or consolidation, compare retrieval quality and cost against the existing provider on an isolated, representative corpus. Require source attribution, correction/deletion propagation, bounded per-account storage and reads, restart/idempotency tests, adversarial cross-account tests and a measured concurrency target. Automatic consolidation must not turn imported instructions or model guesses into user permissions or authoritative facts.

If upstream code is adopted later, preserve its MIT notice and pin the reviewed revision. Do not install the personal coding-agent hooks into this consumer application as an integration shortcut.

## Verification

The isolated PostgreSQL suite verifies owner-only edits, stale-write rejection, persistence across processes, exact-session revocation while another session remains active, and successful recall by the real Eve provider. Unit tests verify permanent indices, deduplication, empty-document behavior, unsupported formats and size limits. The synthetic browser review exercised real note creation, editing, dirty-editor cancellation, refresh persistence and responsive layouts. A two-tab browser check confirmed that a stale edit is rejected, the newer saved note remains authoritative, and the unsaved draft is retained. Revoked-session failures are covered by API/runtime tests.
