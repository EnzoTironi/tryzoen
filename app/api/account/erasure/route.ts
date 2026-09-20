import { withSignal } from "../../../../server/operations/async";
import {
  AccountDeletionError,
  requestAccountDeletionFromHeaders,
} from "../../../../server/accounts/deletion";

export function POST(request: Request) {
  return withSignal(request.signal, async () => {
    try {
      const body = await requestAccountDeletionFromHeaders(request.headers);
      return new Response(JSON.stringify(body, null, 2), {
        status: 200,
        headers: {
          "cache-control": "private, no-store",
          "content-type": "application/json; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      if (error instanceof AccountDeletionError)
        return accountDeletionErrorResponse(error);
      throw error;
    }
  });
}

function accountDeletionErrorResponse(error: AccountDeletionError) {
  const status =
    error.reason === "unauthenticated"
      ? 401
      : error.reason === "blocked_sole_owner"
        ? 409
        : 503;
  const limits =
    error.reason === "unauthenticated"
      ? "Sign in to delete this account."
      : error.reason === "blocked_sole_owner"
        ? "Transfer company admin or close the organization before deleting this account. Active deletion is distinct from later backup expiry."
        : "Account deletion is unavailable. Try again.";
  return new Response(
    JSON.stringify({
      backupExpiresAt: null,
      limits,
      pending: [],
      reason: error.reason,
      retainedCompany: [],
      status: "blocked",
    }),
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    }
  );
}
