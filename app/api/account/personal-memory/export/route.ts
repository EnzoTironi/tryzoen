import { withSignal } from "../../../../../server/operations/async";
import { PersonalMemoryError } from "../../../../../server/personal-memory/access";
import { exportPersonalMemory } from "../../../../../server/personal-memory/export";

export function GET(request: Request) {
  return withSignal(request.signal, async () => {
    try {
      return await exportPersonalMemory(request.headers);
    } catch (error) {
      if (error instanceof PersonalMemoryError)
        return new Response(
          error.reason === "unauthenticated"
            ? "Sign in to export your personal memory."
            : "Personal memory is unavailable. Try again.",
          {
            status: error.reason === "unauthenticated" ? 401 : 503,
            headers: { "cache-control": "private, no-store" },
          }
        );
      throw error;
    }
  });
}
