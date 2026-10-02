import { renderToSourceMarkup as renderToStaticMarkup } from "../../../../tests/helpers/companion-i18n";
import { expect, test, vi } from "vitest";
import { MessageReaders } from "./readers";
vi.mock("react-native", () => import("react-native-web"));
vi.mock("lucide-react-native", () => import("lucide-react"));
const receipts = ["ana", "mine", "bot", "removed"].map((userId) => ({
  userId,
  messageId: "$event",
  threadId: "main",
  timestamp: 100,
}));
const members = [
  { id: "ana", name: "Ana", mine: false, bot: false },
  { id: "mine", name: "Me", mine: true, bot: false },
  { id: "bot", name: "Agent", mine: false, bot: true },
];
test("read indicators only expose current human participants other than the viewer", () => {
  const html = renderToStaticMarkup(
    <MessageReaders
      receipts={receipts}
      members={members}
      onProfile={vi.fn<() => void>()}
    />
  );
  expect(html).toContain("Visto por Ana");
  expect(html).not.toContain("Agent");
  expect(html).not.toContain("removed");
  expect(
    renderToStaticMarkup(
      <MessageReaders
        receipts={receipts}
        members={[]}
        onProfile={vi.fn<() => void>()}
      />
    )
  ).toBe("");
});
