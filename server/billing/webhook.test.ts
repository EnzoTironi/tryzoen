import { describe, expect, it } from "vitest";
import { handleStripeWebhook } from "./webhook";

describe("Stripe billing webhook", () => {
  it("rejects when Stripe is not configured", async () => {
    const request = new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      body: "{}",
    });
    await expect(handleStripeWebhook(request)).rejects.toMatchObject({
      _tag: "BillingWebhookError",
      reason: "stripe_not_configured",
    });
  });
});
