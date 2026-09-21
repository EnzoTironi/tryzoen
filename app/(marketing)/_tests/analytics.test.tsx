import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MarketingAnalytics } from "../_components/analytics";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

describe("marketing analytics", () => {
  it("renders nothing until PostHog loads in the browser", () => {
    expect(
      renderToStaticMarkup(<MarketingAnalytics projectToken="phc_test_token" />)
    ).toBe("");
  });
});
