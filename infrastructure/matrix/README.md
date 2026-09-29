# Private Matrix service

Zoen runs unmodified Synapse 1.160.0 in a separate container. `configure.py` writes
the private deployment configuration and application-service registration; it
does not patch Synapse. PostgreSQL stores durable homeserver state. Alchemy retains
the signing seed and service tokens in Fly secrets.

- Source: [element-hq/synapse v1.160.0](https://github.com/element-hq/synapse/tree/v1.160.0).
- License: [GNU AGPL-3.0](https://github.com/element-hq/synapse/blob/v1.160.0/LICENSE-AGPL-3.0).
- Image: `matrixdotorg/synapse:v1.160.0@sha256:78de1d10bef02e375f861d1cc99f8bedd9381d4f9083ea8b2c22a053477b205f`.

Synapse retains its upstream license. The Zoen application and deployment files
retain the repository's MIT license. Keep the upstream source and license links
with redistributed service images.

The application-service adapter uses durable Synapse transaction IDs, native Eve
input receipts, explicit room bindings and membership epochs. The generic Chat
SDK adapter does not expose that complete application-service receipt/recovery
boundary; this transport delegates execution to Eve instead of adding an agent
loop or separate scheduler.

Runtime and browser proofs cover joined history, membership removal, duplicate
transaction delivery, mentions, scoped tools, answer publication and room closure.
The service is private: registration, federation, media and guest access are off.

## Native notification rollout

Synapse 1.160.0 excludes exclusive application-service users from push-rule
evaluation. Humans use only the exact nonexclusive namespace
`^@_zoen_[a-f0-9]{32}:<escaped-server>$`; `_zoen_bot` and
`_zoen_agent_<32hex>` remain exclusive. The old broad exclusive namespace must
not overlap humans. No Matrix identities or existing records are rewritten.

The supported `registration.ReservedIdentities` module is mandatory in the same
image/configuration rollout. It denies password/SSO registration of the reserved
human localparts and interactive login into human, bot or agent infrastructure
identities, including an SSO mapper linking an existing account. The bridge
continues to register through the authenticated application-service namespace and
uses its service token directly; it does not use interactive appservice login.
Public registration stays disabled. Do not enable SSO as part of this rollout.

Before setting the application capability `ZOEN_MATRIX_NATIVE_NOTIFICATIONS=true`,
qualify the deployed guard and exact namespaces. The default is false and the API
then returns unknown notification state, not a confident zero. Existing interactive
Matrix access/refresh tokens are not revoked by these callbacks: inventory reserved
identities through the homeserver's administrative owner and revoke any such native
sessions before enabling the capability. Never rotate the bridge service token or
rewrite identities just to activate counts. This source change does not deploy or
alter production data.

Counts are native unread **notifications**, affected by push rules and mute;
they are not total unread messages. Existing messages skipped under the prior
exclusive namespace do not acquire retroactive notification history. This change
does not enable device push, public receipts, personal-device login or E2EE.

## Native thread subscriptions

The pinned Synapse supports MSC4306 behind `experimental_features.msc4306_enabled`.
Both generated deployment configuration and the isolated runtime fixture enable
it. The application checks the advertised `org.matrix.msc4306` capability and
uses `unstable/io.element.msc4306` endpoints; unsupported servers hide the control.
This is an explicit compatibility constraint while the proposal remains unstable.
No alternate subscription table or replacement push rule is maintained by Zoen.

Subscriptions are per person, with manual and reply-triggered following. Ordinary replies in unfollowed threads
do not produce native unread notifications; mentions still follow native push rules.
Zoen's explicit room-mute override continues to silence the whole conversation.
Posting a reply follows its thread using the native `automatic` cause event ID.
Manual subscriptions retain their manual status; a delayed replay cannot undo an
unsubscription made after that reply. A new reply after unfollowing follows again.
The server verifies the cause belongs to the same person and thread. When the
secondary subscription call is unavailable or exceeds three seconds, the send receipt remains accepted
with an explicit unconfirmed alert setting. The UI asks the person to check the
setting; it does not resend the message or claim background retry. Native app push and a unified
followed-thread inbox remain separate release work. Activating this configuration
on an existing server changes attention semantics; validate the native notification
rollout above before deploying it. No production deployment accompanies this change.

Runtime proof: `tests/runtime/matrix-thread-subscriptions.integration.ts` exercises
follow/unfollow, repeats, two-person isolation, unauthorized roots, membership
revocation and notification counts against real PostgreSQL/Synapse.
`tests/runtime/matrix-thread-replies.integration.ts` also verifies causal replay,
manual precedence, text/file replies, unsupported servers and lost confirmations.
Protocol: [MSC4306](https://github.com/matrix-org/matrix-spec-proposals/blob/rei/msc_thread_subscriptions/proposals/4306-thread-subscriptions.md).

Reproducible protocol/registration proof, inside the pinned runtime image after
the compose configuration is created:

```sh
docker compose -f tests/runtime/compose.yaml exec -T matrix \
  python /config/registration-check.py /zoen
```

The proof starts and reaps a separate loopback-only SQLite Synapse, with synthetic
identities and no changes to the running service/database. It exercises the real
normal and SSO registration/login handlers (test-only internal entry points, no
external IdP), appservice registration/transport, exclusive agents, group/DM
notifications, mentions, private main/thread receipts and mute. The module itself
uses only the documented callback API. The normal runtime suite also covers the
Zoen-authorized sync contract in `matrix-notifications.integration.ts`.

References: [Synapse spam-checker callbacks](https://element-hq.github.io/synapse/latest/modules/spam_checker_callbacks.html),
[native push-rule exclusion](https://github.com/element-hq/synapse/blob/v1.160.0/synapse/push/bulk_push_rule_evaluator.py),
[Matrix sync notification semantics](https://spec.matrix.org/latest/client-server-api/#get_matrixclientv3sync).
