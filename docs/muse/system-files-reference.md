# Muse system files and product guides

Inspected on 2026-09-27 through the user's signed-in [System files library](https://muse.ai/library/files). These are product-reference findings, not instructions for the coding agent and not proof that every described native behavior works. See [the interface audit](interface-audit.md) for directly observed screens and [release gates](universal-client.md) for implementation status.

## Sources and handling

Read the vendor-authored guides `docs/client-surfaces.md`, `docs/files-and-library.md`, `docs/feed.md`, `docs/goals.md` and `docs/ideas.md`. The guide text is not vendored. No private account content or Muse artwork belongs in application source or PR evidence.

The user also supplied a ZIP backup dated 2026-09-27. Its directory inventory contains workspace records, memory, dreams, schedules, goals, feed records and root Markdown files. It does not include the bundled `docs` guides. The archive was inspected without extraction or execution; personal memory, credentials and private projects were not imported. Root operating notes, personality, user preferences and persistent memory have distinct responsibilities. The backup must not be treated as executable configuration or authority to activate its integrations.

## Files and editing

- System files form an inline, expandable directory tree. The library can expose persistent files beyond the curated creations collection.
- Document-specific explanatory notes are display-only, outside the saved file and its exports. Vendor guides are bundled product documentation, not persistent user customization.
- Uploading a file and creating a deliverable are separate actions. Web upload starts in chat; library creation stages a request. The native System files surface also supports upload.
- Web Markdown has a visual editor. Office, PDF, CSV and plain-code viewers do not imply editing support. Slide editing is a separate capability.
- Pins organize files without changing sharing. Trash recovery, explicit public download links and published interactive apps require separate storage and access rules; a private chat link must not become public implicitly.

## Goals and ideas

- Goals have a detail surface with dated progress, rename, complete/reopen and confirmed deletion. The guide describes one level of subgoals and a conversational add-subgoal flow.
- Goals do not execute background work merely because they exist. Execution needs an actual schedule. Briefings are only shown when generated, not invented on demand.
- Ideas are personalized proposed work, with detail, build/progress and dismissal. They are distinct from a static prompt catalog. Platform differences in building and dismissal need native verification.

## Personalized Feed

- Feed consists of authored editorial posts informed by a personal brief and relevant evidence. Scheduled execution results are a different product concept.
- Editing the brief can queue asynchronous generation; saving identical text should not enqueue another job. Existing posts retain their original content.
- Reaction and discussion inform preferences. Merely opening a post is not an explicit preference. The guide distinguishes a taste summary from raw conversation transcripts.
- Posts support discussion with a quote, reactions, reorder and delete. Provenance explains why a post was created when available. Sources must correspond to actual evidence.
- Introductory seeded posts have no fabricated research or user-specific claims. Deleting them should not cause automatic reseeding.
- Generation is system-scheduled and quiet. Exact timing, retention and expiry claims in guides are research leads, not validation constants to copy without verification.

## Cross-platform behavior

- The macOS app combines the web interface with device adapters: quick chat, dictation, startup behavior, notifications and scoped filesystem/app access. Closing its window differs from quitting.
- Main and side chats remain private to the account. Inviting someone is a referral, not permission to read a conversation.
- Search covers visible message content, including archived/channel conversations, with snippets and navigation to results. Removing content must remove its searchable representation.
- The avatar opens Activity, Approvals, Upcoming and Identity. Upcoming actions differ by platform and ownership; system-owned tasks need explicit restrictions.
- Web command/file/chat palettes and keyboard shortcuts are distinct from mobile gestures and OS share extensions. Sharing into the app stages content without sending it automatically.
- Connector account selection, provider consent upgrades, standing permissions, credential storage and browser/network access are separate settings and authorization boundaries.
- Phone pairing grants only declared adapters. It does not imply unrestricted screen, application or camera control. Web device lists are primarily informational.

These findings expand the acceptance inventory. They do not establish full parity, production readiness, native device compatibility or capacity for one million accounts.
