import { z } from "zod";
import type { ToolContext } from "eve/tools";
import {
  isConnectionAuthorizationRequiredError,
  isConnectionAuthorizationFailedError,
} from "eve/connections";
import { searchGmail } from "@agent/lib/google-workspace/gmail";
import { searchGoogleContacts } from "@agent/lib/google-workspace/contacts";
import { listCalendarEvents } from "@agent/lib/google-workspace/calendar";
import type { SandboxToolInvoker } from "../../vendor/executor/core";

export const GoogleSearchQuery = z.object({
  query: z.string().min(1).max(500),
});
export const GoogleCalendarQuery = z.object({
  timeMin: z.string(),
  timeMax: z.string(),
  timezone: z.string().max(80),
});
class GoogleToolError extends Error {
  readonly _tag = "GoogleToolError";

  constructor() {
    super("GoogleToolError");
    this.name = "GoogleToolError";
  }
}

export const invokeGoogleTool = async function (
  call: Parameters<SandboxToolInvoker["invoke"]>[0],
  context: ToolContext
) {
  if (call.path === "workspace_google_mail_search") {
    const input = await GoogleSearchQuery.strict().parseAsync(call.args);
    try {
      return await searchGmail(context, input.query, 10);
    } catch (error) {
      if (
        isConnectionAuthorizationRequiredError(error) ||
        isConnectionAuthorizationFailedError(error)
      )
        throw error;
      throw new GoogleToolError();
    }
  }
  if (call.path === "workspace_google_contacts_search") {
    const input = await GoogleSearchQuery.strict().parseAsync(call.args);
    try {
      return await searchGoogleContacts(context, input.query, 10);
    } catch (error) {
      if (
        isConnectionAuthorizationRequiredError(error) ||
        isConnectionAuthorizationFailedError(error)
      )
        throw error;
      throw new GoogleToolError();
    }
  }
  if (call.path === "workspace_google_calendar_list") {
    const input = await GoogleCalendarQuery.strict().parseAsync(call.args);
    try {
      return await listCalendarEvents(context, {
        ...input,
        calendarId: "primary",
        maxResults: 20,
      });
    } catch (error) {
      if (
        isConnectionAuthorizationRequiredError(error) ||
        isConnectionAuthorizationFailedError(error)
      )
        throw error;
      throw new GoogleToolError();
    }
  }
  throw new GoogleToolError();
};
