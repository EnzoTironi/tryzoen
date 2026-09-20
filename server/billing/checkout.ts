import { and, eq } from "drizzle-orm";
import {
  findEntitlementByStripeCustomer,
  readEntitlement,
  upsertEntitlement,
} from "@db/services/billing";
import { db, organizationMemberships } from "@db";
import { applicationOrigin } from "@shared/environment/origin";
import { isPaidPlan, type BillingPlanId } from "@shared/billing/plans";
import {
  requireStripe,
  stripePriceIdForPlan,
  StripeNotConfiguredError,
} from "./stripe";

export class BillingCheckoutError extends Error {
  readonly _tag = "BillingCheckoutError";
  readonly reason:
    | "unauthenticated"
    | "invalid_plan"
    | "stripe_not_configured"
    | "org_required"
    | "org_forbidden"
    | "stripe_failed";
  constructor(input: {
    reason:
      | "unauthenticated"
      | "invalid_plan"
      | "stripe_not_configured"
      | "org_required"
      | "org_forbidden"
      | "stripe_failed";
    message: string;
  }) {
    super(input.message);
    this.name = "BillingCheckoutError";
    this.reason = input.reason;
  }
}

async function assertOrgAdmin(organizationId: string, userId: string) {
  const rows = await db
    .select({ role: organizationMemberships.role })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        eq(organizationMemberships.userId, userId)
      )
    )
    .limit(1);
  return rows[0]?.role === "admin";
}

export async function createCheckoutSession(input: {
  userId: string;
  email?: string | null;
  plan: BillingPlanId;
  organizationId?: string;
  seatCount?: number;
}) {
  if (!isPaidPlan(input.plan)) {
    throw new BillingCheckoutError({
      reason: "invalid_plan",
      message: "Free does not require Checkout.",
    });
  }

  let stripe;
  let priceId: string;
  try {
    stripe = requireStripe();
    priceId = stripePriceIdForPlan(input.plan);
  } catch (error) {
    if (error instanceof StripeNotConfiguredError) {
      throw new BillingCheckoutError({
        reason: "stripe_not_configured",
        message: error.message,
      });
    }
    throw error;
  }

  const seatCount =
    input.plan === "org" ? Math.max(1, Math.floor(input.seatCount ?? 1)) : 1;

  const organizationId = input.organizationId;
  if (input.plan === "org") {
    if (!organizationId) {
      throw new BillingCheckoutError({
        reason: "org_required",
        message: "Org Checkout requires an organizationId.",
      });
    }
    const allowed = await assertOrgAdmin(organizationId, input.userId).catch(
      () => {
        throw new BillingCheckoutError({
          reason: "org_forbidden",
          message: "Unable to verify organization admin.",
        });
      }
    );
    if (!allowed) {
      throw new BillingCheckoutError({
        reason: "org_forbidden",
        message: "Only organization admins can purchase Org seats.",
      });
    }
  }

  const subjectType = input.plan === "org" ? "organization" : "user";
  const subjectId =
    input.plan === "org" && organizationId ? organizationId : input.userId;

  const entitlement = await readEntitlement(subjectType, subjectId).catch(
    () => {
      throw new BillingCheckoutError({
        reason: "stripe_failed",
        message: "Unable to load current entitlement.",
      });
    }
  );

  let customerId = entitlement.stripeCustomerId;
  if (!customerId) {
    const existingUser = await readEntitlement("user", input.userId).catch(
      () => {
        throw new BillingCheckoutError({
          reason: "stripe_failed",
          message: "Unable to load user billing customer.",
        });
      }
    );
    customerId = existingUser.stripeCustomerId;
  }

  if (customerId) {
    const existingCustomerId = customerId;
    const bound = await findEntitlementByStripeCustomer(
      existingCustomerId
    ).catch(() => {
      throw new BillingCheckoutError({
        reason: "stripe_failed",
        message: "Unable to verify the billing customer owner.",
      });
    });
    if (
      bound &&
      (bound.subjectType !== subjectType || bound.subjectId !== subjectId)
    ) {
      customerId = null;
    }
  }

  if (!customerId) {
    const customer = await stripe.customers
      .create({
        email: input.email ?? undefined,
        metadata: {
          instinctSubjectType: subjectType,
          instinctSubjectId: subjectId,
          instinctUserId: input.userId,
        },
      })
      .catch(() => {
        throw new BillingCheckoutError({
          reason: "stripe_failed",
          message: "Unable to create Stripe customer.",
        });
      });
    customerId = customer.id;
    await upsertEntitlement({
      subjectType,
      subjectId,
      plan: entitlement.plan,
      status: entitlement.status,
      seatCount: entitlement.seatCount,
      stripeCustomerId: customerId,
    }).catch(() => {
      throw new BillingCheckoutError({
        reason: "stripe_failed",
        message: "Unable to persist Stripe customer id.",
      });
    });
  }

  if (!customerId) {
    throw new BillingCheckoutError({
      reason: "stripe_failed",
      message: "Stripe customer id missing after create.",
    });
  }

  const stripeCustomerId = customerId;
  const origin = applicationOrigin();
  const session = await stripe.checkout.sessions
    .create({
      mode: "subscription",
      customer: stripeCustomerId,
      client_reference_id: subjectId,
      line_items: [{ price: priceId, quantity: seatCount }],
      success_url: `${origin}/account?billing=success`,
      cancel_url: `${origin}/account?billing=canceled`,
      metadata: {
        instinctPlan: input.plan,
        instinctSubjectType: subjectType,
        instinctSubjectId: subjectId,
        instinctUserId: input.userId,
        instinctSeatCount: String(seatCount),
      },
      subscription_data: {
        metadata: {
          instinctPlan: input.plan,
          instinctSubjectType: subjectType,
          instinctSubjectId: subjectId,
          instinctUserId: input.userId,
          instinctSeatCount: String(seatCount),
        },
      },
      allow_promotion_codes: true,
    })
    .catch(() => {
      throw new BillingCheckoutError({
        reason: "stripe_failed",
        message: "Unable to create Stripe Checkout session.",
      });
    });

  if (!session.url) {
    throw new BillingCheckoutError({
      reason: "stripe_failed",
      message: "Stripe Checkout session missing redirect URL.",
    });
  }

  return { url: session.url };
}
