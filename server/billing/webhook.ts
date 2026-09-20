import { z } from "zod";
import type { Stripe } from "stripe";
import {
  findEntitlementByStripeSubscription,
  upsertEntitlement,
  type BillingEntitlementStatus,
  type BillingSubjectType,
} from "@db/services/billing";
import type { BillingPlanId } from "@shared/billing/plans";
import {
  requireStripe,
  stripeWebhookSecret,
  StripeNotConfiguredError,
} from "./stripe";

export class BillingWebhookError extends Error {
  readonly _tag = "BillingWebhookError";
  readonly reason: "stripe_not_configured" | "invalid_signature" | "unhandled";
  constructor(input: {
    reason: "stripe_not_configured" | "invalid_signature" | "unhandled";
    message: string;
  }) {
    super(input.message);
    this.name = "BillingWebhookError";
    this.reason = input.reason;
  }
}

function mapSubscriptionStatus(
  status: Stripe.Subscription.Status
): BillingEntitlementStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
      return "canceled";
    default:
      return "incomplete";
  }
}

function parsePlan(raw: string | undefined): BillingPlanId | null {
  if (raw === "pro" || raw === "org" || raw === "free") return raw;
  return null;
}

function parseSubjectType(raw: string | undefined): BillingSubjectType | null {
  if (raw === "user" || raw === "organization") return raw;
  return null;
}

const stripeIdRefSchema = z.union([z.string(), z.object({ id: z.string() })]);

function stripeIdFromRef(value: z.output<typeof stripeIdRefSchema>): string {
  if (typeof value === "string") return value;
  return value.id;
}

function readStripeId(field: unknown): string | null {
  // Stripe expands customer/subscription into objects or leaves string ids.
  const decoded = stripeIdRefSchema.safeParse(field);
  if (!decoded.success) return null;
  return stripeIdFromRef(decoded.data);
}

async function applySubscription(subscription: Stripe.Subscription) {
  const metadata = subscription.metadata;
  const plan = parsePlan(metadata.instinctPlan);
  const subjectType = parseSubjectType(metadata.instinctSubjectType);
  const subjectId = metadata.instinctSubjectId;
  const quantity = subscription.items.data[0]?.quantity ?? 1;
  const seatFromMeta = Number(metadata.instinctSeatCount ?? quantity);
  const seatCount = Math.max(
    1,
    Number.isFinite(seatFromMeta) ? seatFromMeta : 1
  );

  let resolvedType = subjectType;
  let resolvedId = subjectId;
  if (!resolvedType || !resolvedId) {
    const existing = await findEntitlementByStripeSubscription(subscription.id);
    if (existing) {
      resolvedType = existing.subjectType;
      resolvedId = existing.subjectId;
    }
  }
  if (!resolvedType || !resolvedId) return;

  const effectivePlan: BillingPlanId =
    plan ?? (resolvedType === "organization" ? "org" : "pro");

  const status = mapSubscriptionStatus(subscription.status);
  const priceId = subscription.items.data[0]?.price.id ?? null;
  const customerId = readStripeId(subscription.customer);
  const itemPeriodEnd = subscription.items.data[0]?.current_period_end;
  const periodEnd = itemPeriodEnd ? new Date(itemPeriodEnd * 1000) : null;

  await upsertEntitlement({
    subjectType: resolvedType,
    subjectId: resolvedId,
    plan: status === "canceled" ? "free" : effectivePlan,
    status,
    seatCount,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    currentPeriodEnd: periodEnd,
  });
}

async function applyCheckoutSession(session: Stripe.Checkout.Session) {
  if (session.mode !== "subscription") return;
  const metadata = session.metadata ?? {};
  const plan = parsePlan(metadata.instinctPlan);
  const subjectType = parseSubjectType(metadata.instinctSubjectType);
  const subjectId = metadata.instinctSubjectId;
  if (!plan || !subjectType || !subjectId) return;
  if (plan === "free") return;

  const customerId = readStripeId(session.customer);
  const subscriptionId = readStripeId(session.subscription);
  const seatRaw = Number(metadata.instinctSeatCount ?? 1);
  const seatCount = Math.max(1, Number.isFinite(seatRaw) ? seatRaw : 1);

  await upsertEntitlement({
    subjectType,
    subjectId,
    plan,
    status: "active",
    seatCount,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
  });

  if (subscriptionId) {
    const stripe = requireStripe();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await applySubscription(subscription);
  }
}

export async function handleStripeWebhook(request: Request) {
  let stripe;
  let secret: string;
  try {
    stripe = requireStripe();
    secret = stripeWebhookSecret();
  } catch (error) {
    if (error instanceof StripeNotConfiguredError) {
      throw new BillingWebhookError({
        reason: "stripe_not_configured",
        message: error.message,
      });
    }
    throw error;
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    throw new BillingWebhookError({
      reason: "invalid_signature",
      message: "Missing stripe-signature header.",
    });
  }

  const payload = await request.text().catch(() => {
    throw new BillingWebhookError({
      reason: "invalid_signature",
      message: "Unable to read webhook body.",
    });
  });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret);
  } catch {
    throw new BillingWebhookError({
      reason: "invalid_signature",
      message: "Stripe signature verification failed.",
    });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        // SAFETY: Stripe event.type discriminates Checkout.Session for this case.
        const session = event.data.object;
        await applyCheckoutSession(session);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        // SAFETY: Stripe event.type discriminates Subscription for these cases.
        const subscription = event.data.object;
        await applySubscription(subscription);
        break;
      }
      default:
        break;
    }
  } catch {
    throw new BillingWebhookError({
      reason: "unhandled",
      message: "Webhook handler failed while updating entitlements.",
    });
  }

  return { received: true as const };
}
