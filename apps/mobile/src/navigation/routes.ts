import { z } from "zod";
import { chatChangeSchema } from "@zoen/companion-ui/chats";
import type { CompanionSection } from "@zoen/companion-ui";
import type { ConversationDraft } from "@zoen/companion-ui/messages";

const sectionSchema = z.enum([
  "chat",
  "search",
  "feed",
  "ideas",
  "goals",
  "library",
  "discover",
  "settings",
] satisfies CompanionSection[]);
const locationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("section"), section: sectionSchema }),
  z.object({
    kind: z.literal("session"),
    id: chatChangeSchema.shape.sessionId,
  }),
]);
type MobileLocation = z.infer<typeof locationSchema>;

export interface MobileNavigation {
  section: CompanionSection;
  roomId?: string;
  conversationOpen: boolean;
  conversation: { id?: string; draft?: ConversationDraft; key: number };
}

const invalid = { kind: "invalid" } as const;
const ignored = { kind: "ignored" } as const;
const unavailable = { kind: "unavailable" } as const;

/** URLs only locate content. Existing authenticated API reads authorize it. */
export function parseMobileContentLink(
  value: string,
  applicationOrigin: string
) {
  let url: URL;
  let trusted: URL;
  try {
    url = new URL(value);
    trusted = new URL(applicationOrigin);
  } catch {
    return invalid;
  }
  const custom = url.protocol === "zoen:";
  const web =
    ["https:", "http:"].includes(url.protocol) &&
    url.origin === trusted.origin &&
    ["https:", "http:"].includes(trusted.protocol) &&
    !trusted.username &&
    !trusted.password;
  if (!custom && !web) return ignored;
  const pathname =
    custom && url.hostname === "companion"
      ? "/companion" + url.pathname
      : url.pathname;
  if (custom && url.hostname && url.hostname !== "companion") return ignored;
  const rawPath =
    /^[a-z][a-z\d+.-]*:(?:\/\/[^/?#]*)?([^?#]*)/iu.exec(value)?.[1] ?? "";
  const rawContentPath =
    custom && url.hostname === "companion" ? "/companion" + rawPath : rawPath;
  if (
    pathname !== "/companion" &&
    !pathname.startsWith("/companion/") &&
    rawContentPath !== "/companion" &&
    !rawContentPath.startsWith("/companion/")
  )
    return ignored;
  if (url.username || url.password || (custom && url.port)) return invalid;
  // oxlint-disable-next-line eslint/no-control-regex -- Untrusted routes reject whitespace and control characters.
  if (value.length > 4096 || /[\u0000-\u0020\u007f]/u.test(value))
    return invalid;
  // WHATWG URL normalizes these before exposing pathname. Reject the raw path.
  if (
    value.includes("\\") ||
    rawPath.split("/").some((segment) => {
      const dots = segment.replace(/%2e/giu, ".");
      return dots === "." || dots === "..";
    })
  )
    return invalid;
  if (url.hash) return invalid;
  const params = url.searchParams;
  if (
    [...params.keys()].some(
      (key) =>
        !["view", "space", "room", "message"].includes(key) ||
        params.getAll(key).length !== 1
    )
  )
    return invalid;
  // Mobile has no workspace-scoped transport/cache owner. Never discard scope.
  if (["space", "room", "message"].some((key) => params.has(key)))
    return unavailable;
  const segments = pathname.split("/");
  if (segments.length === 2 || (segments.length === 3 && segments[2] === "")) {
    const section = sectionSchema.safeParse(params.get("view") ?? "chat");
    return section.success
      ? {
          kind: "location" as const,
          location: { kind: "section" as const, section: section.data },
        }
      : invalid;
  }
  if (segments.length !== 3 || params.has("view")) return invalid;
  let id: string;
  try {
    id = decodeURIComponent(segments[2] ?? "");
  } catch {
    return invalid;
  }
  // oxlint-disable-next-line eslint/no-control-regex -- Decoded session locators reject controls and path separators.
  if (/[\u0000-\u0020\u007f/\\%]/u.test(id) || id === "." || id === "..")
    return invalid;
  const location = locationSchema.safeParse({ kind: "session", id });
  return location.success
    ? { kind: "location" as const, location: location.data }
    : invalid;
}

export interface PendingMobileLink {
  accountSessionId?: string;
  result: Exclude<
    ReturnType<typeof parseMobileContentLink>,
    { kind: "ignored" }
  >;
}

/** Bind signed-out locators once; discard delivery for an account that departed. */
export function reconcileMobileLink(
  link: PendingMobileLink | undefined,
  accountSessionId: string | undefined
) {
  if (!link) return undefined;
  if (link.accountSessionId)
    return link.accountSessionId === accountSessionId ? link : undefined;
  return accountSessionId ? { ...link, accountSessionId } : link;
}

export function mobileLinkForAccount(
  link: PendingMobileLink,
  accountSessionId: string
) {
  return link.accountSessionId === accountSessionId;
}

/** An outstanding startup read may not cross an authenticated account change. */
export function acceptsMobileStartupLink(
  firstAccountSessionId: string | undefined,
  currentAccountSessionId: string | undefined,
  departed = false
) {
  return (
    !departed &&
    (!firstAccountSessionId ||
      firstAccountSessionId === currentAccountSessionId)
  );
}

export function mobileLinkDisposition(
  link: PendingMobileLink,
  accountSessionId: string,
  overlayOpen: boolean
) {
  if (!mobileLinkForAccount(link, accountSessionId)) return "discard";
  return overlayOpen && link.result.kind === "location" ? "defer" : "handle";
}

export function initialMobileNavigation(): MobileNavigation {
  return { section: "chat", conversationOpen: false, conversation: { key: 0 } };
}

export function openMobileConversation(
  current: MobileNavigation,
  id?: string,
  draft?: string
): MobileNavigation {
  if (id && id === current.conversation.id && !draft)
    return {
      ...current,
      section: "chat",
      roomId: undefined,
      conversationOpen: true,
    };
  return {
    ...current,
    section: "chat",
    roomId: undefined,
    conversationOpen: true,
    conversation: {
      id,
      draft: draft ? { text: draft, files: [] } : undefined,
      key: current.conversation.key + 1,
    },
  };
}

export function applyMobileLocation(
  current: MobileNavigation,
  location: MobileLocation
): MobileNavigation {
  return location.kind === "session"
    ? openMobileConversation(current, location.id)
    : { ...current, section: location.section, conversationOpen: false };
}

/** Preserve conversation identity/drafts when returning to the inbox. */
export function backMobileNavigation(
  current: MobileNavigation,
  overlayOpen = false
): MobileNavigation | undefined {
  if (overlayOpen) return current;
  if (current.section !== "chat")
    return { ...current, section: "chat", conversationOpen: false };
  return current.conversationOpen
    ? { ...current, conversationOpen: false }
    : undefined;
}

export function mobileLinkMessage(result: PendingMobileLink["result"]) {
  if (result.kind === "unavailable")
    return "Workspace, room and message links are not available on mobile yet.";
  if (result.kind === "invalid") return "This link could not be opened.";
  return undefined;
}
