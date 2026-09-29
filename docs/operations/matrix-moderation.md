# Matrix message moderation

Zoen sends explicitly selected events to the existing Synapse moderation queue.
This does not implement a moderation team, review SLA, appeals, automatic bans,
user blocking or encrypted-client evidence export. Those remain release gates.

## Operator review

Use a separately authorized server-admin client and the [native Synapse event
reports API](https://element-hq.github.io/synapse/latest/admin_api/event_reports.html).
Keep the admin token out of browser clients, URLs and logs. List with
`GET /_synapse/admin/v1/event_reports?limit=20`, filter by `user_id` (reporter)
and `room_id`, and follow `next_token`. Inspect a report with
`GET /_synapse/admin/v1/event_reports/{report_id}`. Account/workspace admins do
not inherit access to this server-admin surface.

The report includes the selected event and reason. Edited messages target the
selected replacement event. Native event metadata identifies its original
message. Ordinary users cannot read reports or reporter identities through a
Zoen endpoint. Moderation review does not automatically redact or block anyone.

## Admission and uncertain delivery

`matrix_message_reports` is an execution receipt, not a duplicate moderation
queue. Its primary key is reporter + server + selected event. Its user/time
index bounds admission to ten new reports in a rolling 24-hour window. Reopening
a submitted report returns its recorded outcome without another POST. Empty
reasons, invisible events, self-reports and stale revisions are rejected.

A receipt starts as `uncertain` in a committed transaction before any provider
request. Successful native acknowledgement changes it to `submitted`. A process
crash, lost response or cancellation can leave it uncertain, including when no
provider call occurred. There is intentionally no automatic retry: the native
[report endpoint](https://spec.matrix.org/latest/client-server-api/#post_matrixclientv3roomsroomidreporteventid)
has no transaction ID. Reconcile against the native queue using the reporter,
room and event before any operator decision. Do not delete an uncertain receipt
just to retry; that could duplicate a report already delivered. Automated
reconciliation is not implemented.

App edits and reporting share the message revision lock. External Matrix writers
have no product CAS contract. The referenced event ID still identifies the
specific reported revision. A later edit cannot substitute its body.

Application identity erasure cascades its receipt rows. Synapse moderation
retention is an operator-owned policy; deleting the local receipt does not claim
to erase a native moderation record. No automated moderation-record erasure or
retention scheduler is introduced by this feature.

## Isolated verification

`tests/runtime/matrix-reports.integration.ts` uses only loopback runtime PostgreSQL
and Synapse. It verifies a real native report, edited evidence, thread messages,
concurrent duplicate calls, a deliberately lost acknowledgement, admission limits
and revoked access. Native test reports and application receipts created by the
test are cleaned up by reporter ID. It never resets the database or touches
unrelated reports.
