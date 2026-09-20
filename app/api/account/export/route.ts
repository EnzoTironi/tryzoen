import { withSignal } from "../../../../server/operations/async";
import { AccountPrivacyError } from "../../../../server/accounts/privacy";
import {
  accountPrivacyErrorResponse,
  exportAccountPrivacyResponse,
} from "../../../../server/accounts/privacy";

export function GET(request: Request) {
  return withSignal(request.signal, async () => {
    try {
      return await exportAccountPrivacyResponse(request.headers);
    } catch (error) {
      if (error instanceof AccountPrivacyError)
        return accountPrivacyErrorResponse(error);
      throw error;
    }
  });
}
