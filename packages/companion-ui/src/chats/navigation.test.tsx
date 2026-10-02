import { useContext } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { ConversationNavigation } from "./navigation";
import { CompanionVisibility } from "../visibility";

const state = vi.hoisted(() => ({ width: 390 }));
vi.mock("react-native", async () => ({
  ...(await vi.importActual<typeof import("react-native")>("react-native-web")),
  useWindowDimensions: () => ({
    width: state.width,
    height: 800,
    scale: 1,
    fontScale: 1,
  }),
}));

function Probe({ name }: { name: string }) {
  const visible = useContext(CompanionVisibility);
  return <span data-visible={visible}>{name}</span>;
}
function render(open: boolean, active = true, visible = true) {
  return renderToStaticMarkup(
    <CompanionVisibility value={visible}>
      <ConversationNavigation
        active={active}
        conversationOpen={open}
        renderConversations={() => <Probe name="inbox-state" />}
      >
        {() => <Probe name="draft-and-history-state" />}
      </ConversationNavigation>
    </CompanionVisibility>
  );
}
beforeEach(() => {
  state.width = 390;
});
it("retains both mobile subtrees while exposing only the selected pane", () => {
  const inbox = render(false);
  const chat = render(true);
  for (const html of [inbox, chat]) {
    expect(html).toContain("inbox-state");
    expect(html).toContain("draft-and-history-state");
    expect(html).toContain('inert=""');
  }
  expect(inbox).toContain('<span data-visible="true">inbox-state');
  expect(inbox).toContain('<span data-visible="false">draft-and-history-state');
  expect(chat).toContain('<span data-visible="false">inbox-state');
  expect(chat).toContain('<span data-visible="true">draft-and-history-state');
});
it("exposes both desktop panes without unmounting the inbox on other sections", () => {
  state.width = 1000;
  expect(render(true)).not.toContain('inert=""');
  const otherSection = render(false, false);
  expect(otherSection).toContain('<span data-visible="false">inbox-state');
  expect(otherSection).toContain(
    '<span data-visible="true">draft-and-history-state'
  );
});
it("keeps covered or unauthorized content invisible to both query owners", () => {
  state.width = 1000;
  const html = render(true, true, false);
  expect(html).not.toContain('data-visible="true"');
});
