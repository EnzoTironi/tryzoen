# Personal memory

`PersonalMemory` exposes the current account's structured profile and bound Eve
profile documents through async operations. Routes and tools resolve current
authority before calling it. PostgreSQL stores the profile, document bindings and
CAS-versioned note documents; native Eve memory definitions live in `agent/memory`.

## Ownership and authorization

Eve supplies `memory.scope.{key,namespace,value}` and `memory.slot`. The scope key
is opaque: Zoen never reproduces its hash or accepts a client-selected binding.
`server/tools/memory/personal-memory-provider.ts` wraps public Eve `fileMemory`.
It requires a canonical owner, workspace and `profile` slot before registering the
binding. Native save/remove tools resolve authority again at execution.

Reads and writes hold the relevant channel identity, exact Better Auth session
and membership locks in the transaction that accesses storage. Signing out the
captured web session invalidates its tools even when another session remains
active. Key and workspace/namespace/slot uniqueness constraints prevent binding
reassignment. Registration can precede the first document write.

`inspect` checks current membership around its reads. The authenticated
`GET /api/account/personal-memory/export` endpoint has no owner, workspace or key
selector; URL parameters cannot select another account. It returns private JSON
with an attachment disposition. The native `personal-memory-inspect` tool uses
an empty schema and revalidates the verified private-channel identity. Its export
link requires browser authentication.

An unresolved binding means no trusted callback has been observed, not that no
notes exist. Exports preserve stored contents and versions. They cover structured
profile and bound notes, not conversation history or a full-account backup.
`wipe` removes this profile and its bound notes in a membership-locked transaction.
Broader erasure belongs to [account deletion](../../docs/decisions/adr-account-deletion.md).

## Recall and forgetting

The public Eve memory provider performs storage mutation and reads current notes
before returning success. A read failure rejects the operation. The tool result
contains the current note document so the next model step sees the update. Eve
supersedes the keyed recalled document at the next turn or compaction boundary.
There is no private mid-turn refresh patch or parallel projection state machine.
Historical messages, earlier recall and summaries can still mention a forgotten
fact; this operation deletes stored notes, not conversation history.

`group-memory-policy.ts` prevents group sessions from binding or reading personal
notes. Group scope uses its own conversation identity. Personal wipe never erases
shared-group keys.

Learned facts use the separate, private Mem0 service with person/workspace scope.
This does not replace the authored profile documents or their Eve provider.

## Verification

Use [local setup](../../docs/local-runtime-setup.md), then run:

```sh
pnpm test:runtime tests/runtime/personal-memory.integration.ts \
  tests/runtime/personal-memory-revocation-race.integration.ts
```

These suites exercise actual Better Auth, account provisioning, PostgreSQL,
public memory callbacks, export authorization, process restart and concurrent
revocation. Their callback contexts are synthetic; they do not prove a live model
or messenger-provider round trip. The compiled Eve fixture additionally checks that native save/remove results
reach the next model step and that a later turn recalls the emptied document.
