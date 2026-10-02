import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { RoomMessages } from "./messages";

vi.mock("react-native", () => import("react-native-web"));
vi.mock("lucide-react-native", () => import("lucide-react"));
vi.mock("react-native-svg", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <svg aria-hidden data-tail="true">
      {children}
    </svg>
  ),
  Path: ({ d, fill }: { d: string; fill: string }) => (
    <path d={d} fill={fill} />
  ),
}));
vi.mock("./attachment", () => ({
  RoomAttachment: ({
    item,
  }: {
    item: ComponentProps<typeof RoomMessages>["messages"][number];
  }) => (
    <span data-media-file={item.media?.filename}>{item.media?.filename}</span>
  ),
}));
vi.mock("../markdown", () => ({
  AssistantMarkdown: ({ text }: { text: string }) => <p>{text}</p>,
}));

type Props = ComponentProps<typeof RoomMessages>;
const time = new Date(2026, 8, 30, 12).getTime();
const message: Props["messages"][number] = {
  id: "$one",
  text: "Primeira mensagem",
  sender: "Ana",
  senderId: "@ana:test",
  mine: false,
  bot: false,
  timestamp: time,
  rootId: null,
  replies: 0,
  reply: null,
};
function render(
  messages: Props["messages"],
  reactions: Props["reactions"] = []
) {
  return renderToStaticMarkup(
    <RoomMessages
      data={
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The render-only adapter fails on any unexpected data access.
        new Proxy(
          {},
          {
            get() {
              throw new Error("Unexpected fixture data access");
            },
          }
        ) as Props["data"]
      }
      roomId="room"
      cacheScope="fixture"
      messages={messages}
      members={[]}
      reactions={reactions}
      receipts={[]}
      onReply={vi.fn<Props["onReply"]>()}
      onProfile={vi.fn<Props["onProfile"]>()}
      onReact={vi.fn<Props["onReact"]>()}
      onThread={vi.fn<Props["onThread"]>()}
      onVisibleMessagesChange={vi.fn<Props["onVisibleMessagesChange"]>()}
      loading={false}
      error={false}
      onRetry={vi.fn<Props["onRetry"]>()}
      hasMore={false}
      loadingMore={false}
      fetching={false}
      onMore={vi.fn<Props["onMore"]>()}
    />
  );
}
it("groups adjacent messages while keeping every text and contextual action", () => {
  const html = render([
    message,
    {
      ...message,
      id: "$two",
      text: "Segunda mensagem",
      timestamp: time + 60000,
    },
    {
      ...message,
      id: "$three",
      text: "Terceira mensagem",
      timestamp: time + 120000,
    },
  ]);
  for (const text of [
    "Primeira mensagem",
    "Segunda mensagem",
    "Terceira mensagem",
  ])
    expect(html).toContain(text);
  expect(html.match(/aria-label="Perfil de Ana"/gu)).toHaveLength(1);
  expect(html.match(/aria-label="Ver perfil de Ana"/gu)).toHaveLength(1);
  expect(html.match(/aria-label="Message actions"/gu)).toHaveLength(3);
  expect(html.match(/data-tail="true"/gu)).toHaveLength(1);
});
it.each([
  { name: "author", change: { senderId: "@other:test" } },
  { name: "five minute gap", change: { timestamp: time + 5 * 60000 } },
  { name: "thread boundary", change: { rootId: "$parent" } },
  { name: "redaction", change: { redacted: true } },
])("separates groups at $name", ({ change }) => {
  const html = render([
    message,
    { ...message, id: "$two", timestamp: time + 60000, ...change },
  ]);
  expect(html.match(/aria-label="Perfil de Ana"/gu)).toHaveLength(2);
});
it("retains quote, edit, forward, thread and complete reaction information", () => {
  const html = render(
    [
      {
        ...message,
        replies: 3,
        editId: "$edit",
        forwarded: true,
        reply: { id: "$parent", sender: "Pedro", text: "Mensagem citada" },
      },
    ],
    [
      {
        messageId: "$one",
        mine: "❤️",
        mineEventId: "$heart",
        complete: false,
        reactions: [
          { emoji: "❤️", count: 2 },
          { emoji: "👍", count: 3 },
          { emoji: "😂", count: 1 },
        ],
      },
    ]
  );
  for (const text of [
    "Mensagem citada",
    "Pedro",
    "Editada",
    "Encaminhada",
    "3 respostas",
    "❤️: 2 ou mais reações",
    "👍: 3 ou mais reações",
    "😂: 1 ou mais reações",
  ])
    expect(html).toContain(text);
  expect(html).toContain("6+");
  expect(html).toContain('aria-label="Abrir thread de Ana: Primeira mensagem"');
});

it("places timestamps between time blocks rather than at every author change", () => {
  const html = render([
    message,
    {
      ...message,
      id: "$pedro",
      sender: "Pedro",
      senderId: "@pedro:test",
      timestamp: time + 60000,
    },
    { ...message, id: "$ana", timestamp: time + 120000 },
    { ...message, id: "$later", timestamp: time + 7 * 60000 },
  ]);
  expect(html.match(/data-testid="room-message-timestamp"/gu)).toHaveLength(2);
  for (const timestamp of [time, time + 60000, time + 120000, time + 7 * 60000])
    expect(html).toContain(new Date(timestamp).toLocaleString());
  expect(html.match(/role="group"/gu)).toHaveLength(4);
});
it("marks a new day even when messages are only two minutes apart", () => {
  const midnight = new Date(2026, 8, 30, 23, 59).getTime();
  const html = render([
    { ...message, timestamp: midnight },
    { ...message, id: "$tomorrow", timestamp: midnight + 120000 },
  ]);
  expect(html.match(/data-testid="room-message-timestamp"/gu)).toHaveLength(2);
  for (const timestamp of [midnight, midnight + 120000])
    expect(html).toContain(
      new Date(timestamp).toLocaleDateString([], {
        weekday: "long",
        day: "numeric",
        month: "short",
      })
    );
});
it("keeps photos, long messages and repeated thread entry points within mixed author groups", () => {
  const long = "Uma mensagem longa que preserva seu conteúdo. ".repeat(20);
  const html = render([
    { ...message, replies: 1 },
    {
      ...message,
      id: "$photo",
      timestamp: time + 60000,
      media: { filename: "parque.webp", mediaType: "image/webp" },
    },
    {
      ...message,
      id: "$another",
      text: "Outra conversa paralela",
      timestamp: time + 120000,
      replies: 3,
    },
    {
      ...message,
      id: "$long",
      sender: "Pedro",
      senderId: "@pedro:test",
      text: long,
      timestamp: time + 180000,
    },
  ]);
  expect(html).toContain('data-media-file="parque.webp"');
  expect(html).toContain(long);
  expect(html.match(/aria-label="Abrir thread de Ana:/gu)).toHaveLength(2);
  expect(html).toContain("1 resposta");
  expect(html).toContain("3 respostas");
  expect(html.match(/data-testid="room-message-timestamp"/gu)).toHaveLength(1);
  expect(html.match(/aria-label="Message actions"/gu)).toHaveLength(4);
});
it("does not fabricate a timestamp for undated messages", () => {
  const html = render([{ ...message, timestamp: 0 }]);
  expect(html).not.toContain('data-testid="room-message-timestamp"');
  expect(html).not.toContain("Invalid Date");
  expect(html).toContain("Primeira mensagem");
});
