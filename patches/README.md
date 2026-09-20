# Dependency patches

The application uses `eve@0.63.0` and the public Workflow PostgreSQL adapter.

`eve@0.63.0` has two narrowly scoped corrections. In its bundled Workflow core, the existing
`WORKFLOW_MAX_INLINE_STEPS` setting accepts zero. Upstream currently rejects zero
and restores the default of three. Zoen's supervisor and compiled runtime tests
set it to zero so new steps use Workflow's existing durable step dispatcher.
No queue, storage, event, replay, or cancellation implementation is replaced.

Without this setting, a long model call can run inline inside the same PostgreSQL
queue delivery that holds the session's replay lane. A follow-up cancellation is
accepted durably but only consumed after the model completes. A parked-session
reproduction took 15,068 ms and returned the full answer; the patched dispatcher
cancelled in 127 ms, aborted the model, preserved one tool write, and allowed the
same session to continue. The compiled cancellation regression checks that boundary.
That module ships as a single minified line; its semantic change is confined to
the setting's integer validation and lower bound.

Remove this patch when a released Eve/Workflow core accepts zero (or otherwise
keeps cancellation responsive with the public PostgreSQL World), after the compiled
cancellation regression passes without it. No upstream issue has been published.
When starting Eve directly rather than through `pnpm start`, also set
`WORKFLOW_MAX_INLINE_STEPS=0`.

Eve's session turn step also skips rebinding the previous dynamic tool catalog
when the durable session is between completed turns with no pending input,
authorization, or coordination calls. The original authorization state also guards
a callback consumed earlier in that step. The next turn resolves its
catalog under the new caller's authority. Rebinding the old catalog first makes a
scheduled result fail after restart when its intentionally narrower authority
withdraws tools used by the preceding interactive turn. The failure reproduces
with the real workstreams memory provider even with inline execution disabled.
Active calls and pending approvals still require callback rebinding and fail closed
when their authority no longer supplies the tool. The compiled regression checks
successful continuation, valid approval after restart, and rejection after
authority removal. Remove this guard when an upstream release handles that turn
boundary correctly and all three regression cases pass without the patch.

`@workflow/world-postgres@5.0.0-beta.44` commits terminal step state and its
`step_completed` or `step_failed` replay event in one transaction. Upstream writes
the terminal state first and the event afterward; a process restart in between
leaves a terminal step without the event needed to resume its workflow. The patch
reuses the adapter's existing transaction, row guard, and event-slot allocation
used by `step_started`. It adds no schema or recovery/backfill path. The runtime
regression forces each journal insert to fail, verifies full rollback, retries,
and races success against failure to prove only one matching terminal event commits.
Remove this patch once the public adapter makes these transitions atomic and those
regressions, including cancellation followed by process restart, pass unpatched.

`@linqapp/chat-sdk-adapter@0.5.1` has one patch: `LinqSendOptions.replyToMessageId`
is forwarded to the Linq API's `reply_to.message_id` for new and existing chats.
Upstream already owns media and idempotency support; those behaviors are not
reimplemented here. The adapter's focused tests verify the forwarded reply ID.

`pnpm install --frozen-lockfile` applies the checked-in patches. The independently
installed infrastructure package owns and documents its own Alchemy patch.
