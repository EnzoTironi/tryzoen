import { readEntitlement } from "@db/services/billing";
import { applicationOrigin } from "@shared/environment/origin";
import { requireStripe, StripeNotConfiguredError } from "./stripe";

export class BillingPortalError extends Error {
  readonly _tag = "BillingPortalError";
  readonly reason:
    | "unauthenticated"
    | "stripe_not_configured"
    | "no_customer"
    | "stripe_failed";
  constructor(input: {
    reason:
      | "unauthenticated"
      | "stripe_not_configured"
      | "no_customer"
      | "stripe_failed";
    message: string;
  }) {
    super(input.message);
    this.name = "BillingPortalError";
    this.reason = input.reason;
  }
}

export async function createCustomerPortalSession(input: {
  userId: string;
  organizationId?: string;
}) {
  let stripe;
  try {
    stripe = requireStripe();
  } catch (error) {
    if (error instanceof StripeNotConfiguredError) {
      throw new BillingPortalError({
        reason: "stripe_not_configured",
        message: error.message,
      });
    }
    throw error;
  }

  const subjectType = input.organizationId ? "organization" : "user";
  const subjectId = input.organizationId ?? input.userId;
  const entitlement = await readEntitlement(subjectType, subjectId).catch(
    () => {
      throw new BillingPortalError({
        reason: "stripe_failed",
        message: "Unable to load entitlement.",
      });
    }
  );

  let customerId = entitlement.stripeCustomerId;
  if (!customerId && input.organizationId) {
    const userEntitlement = await readEntitlement("user", input.userId).catch(
      () => {
        throw new BillingPortalError({
          reason: "stripe_failed",
          message: "Unable to load user entitlement.",
        });
      }
    );
    customerId = userEntitlement.stripeCustomerId;
  }

  if (!customerId) {
    throw new BillingPortalError({
      reason: "no_customer",
      message: "Billing management is available after your first subscription.",
    });
  }

  const origin = applicationOrigin();
  const session = await stripe.billingPortal.sessions
    .create({
      customer: customerId,
      return_url: `${origin}/account`,
    })
    .catch(() => {
      throw new BillingPortalError({
        reason: "stripe_failed",
        message: "Unable to create Customer Portal session.",
      });
    });

  return { url: session.url };
}
