import { BillingWebhookError } from "../../../../server/billing/webhook";
import { handleStripeWebhook } from "../../../../server/billing/webhook";

export const runtime = "nodejs";

function webhookErrorResponse(error: BillingWebhookError) {
  const status =
    error.reason === "invalid_signature"
      ? 400
      : error.reason === "stripe_not_configured"
        ? 503
        : 500;
  return Response.json({ error: error.message }, { status });
}

export async function POST(request: Request) {
  try {
    request.signal.throwIfAborted();
    return Response.json(await handleStripeWebhook(request));
  } catch (error) {
    if (error instanceof BillingWebhookError)
      return webhookErrorResponse(error);
    throw error;
  }
}
