import { z } from "zod";
import { getAuthSession } from "@db/services/auth/session";
import {
  BillingPortalError,
  createCustomerPortalSession,
} from "../../../../server/billing/portal";

const bodySchema = z.object({ organizationId: z.string().optional() });

function portalErrorResponse(error: BillingPortalError) {
  const status =
    error.reason === "stripe_not_configured"
      ? 503
      : error.reason === "no_customer"
        ? 404
        : 400;
  return Response.json(
    { error: error.message, reason: error.reason },
    { status }
  );
}

export async function POST(request: Request) {
  const session = await getAuthSession(request.headers);
  if (!session?.user) {
    return Response.json(
      { error: "Sign in to manage billing." },
      { status: 401 }
    );
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return portalErrorResponse(
      new BillingPortalError({
        reason: "stripe_failed",
        message: "Invalid portal payload.",
      })
    );
  }
  try {
    request.signal.throwIfAborted();
    const result = await createCustomerPortalSession({
      ...body.data,
      userId: session.user.id,
    });
    return Response.json({ url: result.url });
  } catch (error) {
    if (error instanceof BillingPortalError) return portalErrorResponse(error);
    throw error;
  }
}
