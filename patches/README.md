# Dependency patch

The application uses the public `eve@0.62.0` release and public Workflow
PostgreSQL adapter. Neither package is patched.

`@linqapp/chat-sdk-adapter@0.5.1` has one patch: `LinqSendOptions.replyToMessageId`
is forwarded to the Linq API's `reply_to.message_id` for new and existing chats.
Upstream already owns media and idempotency support; those behaviors are not
reimplemented here. The adapter's focused tests verify the forwarded reply ID.

`pnpm install --frozen-lockfile` applies the checked-in patch. The independently
installed infrastructure package owns and documents its own Alchemy patch.
