# Product direction

Current direction: 2026-09-19. Zoen is prelaunch.

## One promise

**Send it something you need handled. Trust it to follow through.**

The user should feel less responsible for supervising software. They describe
an outcome, contribute a missing detail when necessary, authorize what needs their
decision, and receive a useful result. The product remembers enough to make the
next interaction easier. It stays quiet when it has nothing useful to add.

## Experience and implementation

Keep the existing landing, mascot, photographic sky cycle, messenger examples,
rotating headline, connection carousel and multilingual app. The current primary
CTA opens the configured messenger; a single configured SMS destination opens the
existing draft directly. Multiple available channels use `/get-started`.

The ambition spans personal life, families, study, work and small businesses.
Conversation is the entry point; the app provides clear controls for workspaces,
files, connections, memory, schedules and trusted people. The landing describes
that product ambition; provider readiness is established by separate evidence.

Eve owns the agent, native tools, skills, connections, approvals and durable work.
Zoen owns product records, authorization and the existing interface. Treg can widen
API access through a workspace-authorized native MCP connection. Alchemy can
continue provisioning infrastructure. Neither framework details nor integration
catalog sizes belong in the customer onboarding flow.

The [architecture](eve/architecture.md) and [validation](eve/rebuild.md) describe
the implemented boundaries. Prefer the smallest coherent design that serves this
experience. Remove obsolete interfaces directly; there is no production data to
carry through transitional code.

## Design the whole interaction

An illustrative acceptance scenario, not a specialized calendar product:

1. The user sends a voice note: “Find an hour next week for focused work. Mornings
   are best, and remind me ten minutes before.”
2. The assistant acknowledges the actual request. If Calendar is disconnected,
   it explains the immediate benefit and provides one secure connection link.
   It does not request unrelated Gmail or contacts access.
3. Consent completes and the conversation resumes automatically. The user should
   not have to repeat the request or paste tokens back into chat.
4. The assistant proposes a concrete slot with the relevant time zone and reminder.
   It asks for approval only if the current instruction and grant do not already
   authorize that exact action. Missing material details are resolved before action.
5. The user says “Make it Thursday instead.” The assistant updates the pending
   intent; an approval for the old slot cannot authorize the new one.
6. The event and reminder are confirmed through actual destination state. The
   result says what happened, when, and provides a useful link.
7. A later correction or cancellation works, including after a process restart.
   Remembering mornings respects the user's memory preference and is inspectable
   and reversible. The assistant does not infer permanent permission from one task.

Run the same behavioral contract on research, document and browser tasks as those
capabilities become qualified. The question is whether the user can delegate,
correct and rely on completion without learning a new interface for each tool.

## Seven product decisions

### 1. Deliver value before asking for setup

First contact must do useful work that needs no connection. When a request does
need access, ask for that connection at the point of need, explain its purpose,
and resume the original task when the grant arrives. No mandatory dashboard tour,
provider key form, model picker or broad “connect everything” screen for end users.
Operator installation remains explicit, documented and secure. Hosted consumers use the short [first-run](consumer-first-run.md) path (`/get-started`) instead of self-host docs.

### 2. Make conversation the primary control

People can say “stop,” “what are you working on?”, “forget that,” “remind me,” and
“disconnect my calendar.” These reach the same services as web controls. A small
account page handles permissions, connections, memory, usage, files and recovery.
A task detail view is available when the work is complex or uncertain.

Ordinary conversation must not require selecting a workspace, thread type, agent,
model, runtime or skill. Keep distinct task context internally and ask about the
task only when ambiguity matters. The web chat can remain useful without becoming
a second mandatory product.

### 3. Take care of the handoffs

The awkward seams are part of our product: opening consent from WhatsApp, returning
from the browser, resolving a pending approval, handling expired login, uploading
an unsupported file, correcting a transcript and waiting during a long action.
Each needs intentional copy and a recovery path.

A successful OAuth callback is not sufficient. The original conversation must
continue. A finished tool call is not sufficient. The user must receive an accurate
result. An opaque download URL is not sufficient. The intended user must be able
to open the artifact, and nobody else should inherit access accidentally.

### 4. Make trust tangible

Show enough to decide: target, consequence and any material amount/date/recipient.
Honor explicit instructions and bounded standing grants without repeatedly asking
the same question. Do not turn approval into theatre or hide meaningful authority.

Completion means verified completion. If a provider times out after submission,
say the result is being checked rather than inviting a second submission. Recovery
is our responsibility as far as the provider permits; unresolved outcomes stay
visible. Memory can explain its source and accept correction. Privacy controls
work through the full lifecycle, including backup restoration.

### 5. Prefer considered defaults

Ship one recommended model configuration, one assistant personality and one clear
way to connect an account. Advanced execution choices can be exposed later when
they help users make a meaningful trade-off. Do not silently switch a user's chosen
execution profile to a separately billed provider.

Use the best qualified tool for the task. API, MCP and browser work should feel
like the same assistant. Retain Kernel as the first browser candidate; make its
boundaries replaceable inside the code without requiring the user to manage them.
Self-hosting is an operator experience with a supported, tested recipe.

### 6. Treat silence and latency as product features

Acknowledge useful intent; do not narrate every tool invocation. Provide a progress
update when it helps the user decide to wait or intervene. Do not stream fragments
that create notification noise. Send one clear completion and avoid repeating it
through several hooks or channels.

Proactivity starts with requested reminders and explicit watches. Quiet hours,
frequency limits, pause and cancel are part of the first usable behavior. Unchanged
state does not deserve a new notification. Personality is warm and concise, without
invented intimacy, praise or certainty. Measure comprehension and time saved as well
as response speed.

### 7. Finish the details before widening the surface

Quoted replies point to the correct message. Long results have usable summaries
and accessible artifacts. Voice transcription is correctable; critical names and
dates are checked. A reconnect does not lose the task. Unsupported capabilities
have honest alternatives. Loading, empty, expired, denied and failed states receive
the same care as the successful path.

Do not replace this work with branding, a larger integration count or speculative
framework design. Every launch feature needs an end-to-end owner and a real user
journey that demonstrates its value.
