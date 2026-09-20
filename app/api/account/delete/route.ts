import { withSignal } from "../../../../server/operations/async";
import { AccountPrivacyError } from "../../../../server/accounts/privacy";
import {
  accountPrivacyErrorResponse,
  deleteAccountOnlineDataResponse,
} from "../../../../server/accounts/privacy";

export function POST(request: Request) {
  return withSignal(request.signal, async () => {
    try {
      return await deleteAccountOnlineDataResponse(request.headers);
    } catch (error) {
      if (error instanceof AccountPrivacyError)
        return accountPrivacyErrorResponse(error);
      throw error;
    }
  });
}
