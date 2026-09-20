import { z } from "zod";
import { getAuthSession } from "@db/services/auth/session";
import {
  BillingCheckoutError,
  createCheckoutSession,
} from "../../../../server/billing/checkout";

const bodySchema = z.object({
  plan: z.enum(["pro", "org"]),
  organizationId: z.string().optional(),
  seatCount: z.number().optional(),
});

function checkoutErrorResponse(error: BillingCheckoutError) {
  const status =
    error.reason === "stripe_not_configured"
      ? 503
      : error.reason === "org_forbidden" || error.reason === "org_required"
        ? 403
        : 400;
  return Response.json(
    { error: error.message, reason: error.reason },
    { status }
  );
}

export async function POST(request: Request) {
  const session = await getAuthSession(request.headers);
  if (!session?.user) {
    return Response.json({ error: "Sign in to upgrade." }, { status: 401 });
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return checkoutErrorResponse(
      new BillingCheckoutError({
        reason: "invalid_plan",
        message: "Invalid checkout payload.",
      })
    );
  }
  try {
    request.signal.throwIfAborted();
    const result = await createCheckoutSession({
      ...body.data,
      userId: session.user.id,
      email: session.user.email,
    });
    return Response.json({ url: result.url });
  } catch (error) {
    if (error instanceof BillingCheckoutError)
      return checkoutErrorResponse(error);
    throw error;
  }
}
