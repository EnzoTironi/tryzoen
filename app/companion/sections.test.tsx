import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Library, CompanionPage } from "@zoen/companion-ui";
import type { FileEditor } from "@app/(authenticated)/space/(overview)/_components/file-editor";
import { beforeEach, expect, it, vi } from "vitest";
import { ConnectedSections } from "./sections";

const state = vi.hoisted(() => ({
  path: undefined as string | undefined,
  setPath: vi.fn<(value: string | undefined) => void>(),
  file: undefined as ComponentProps<typeof FileEditor> | undefined,
  pending: false,
  readError: undefined as { message: string } | undefined,
  refetch: vi.fn<() => Promise<void>>(),
}));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) =>
      initial === undefined
        ? [state.path, state.setPath]
        : react.useState(initial),
  };
});
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn<() => Promise<void>>() }),
}));
vi.mock("@trpc/client", () => ({ getUntypedClient: () => ({}) }));
vi.mock("@web/auth/client", () => ({
  authClient: {
    useSession: () => ({ data: { session: { id: "owner-session" } } }),
  },
}));
vi.mock("@shared/companion/knowledge", () => ({
  companionKnowledgeData: () => ({}),
  companionOntologyData: () => ({ cacheKey: ["owner-session:personal"] }),
}));
vi.mock("@shared/companion/goals", () => ({ companionGoalsData: () => ({}) }));
vi.mock("@shared/companion/feed", () => ({ companionFeedData: () => ({}) }));
vi.mock("@shared/companion/ideas", () => ({ companionIdeasData: () => ({}) }));
vi.mock("@web/eve/client", () => ({ browserSessionClient: {} }));
vi.mock("./settings/creators", () => ({ ConnectedCreatorStudio: () => null }));
vi.mock("./search", () => ({ ConnectedSearch: () => null }));
vi.mock("@web/trpc/client", () => ({
  api: {
    useUtils: () => ({
      client: {},
      workspaces: { files: { invalidate: vi.fn<() => Promise<void>>() } },
    }),
    workspaces: {
      files: {
        useQuery: (input: { path?: string }) =>
          input.path
            ? {
                data:
                  state.pending || state.readError
                    ? undefined
                    : {
                        content: "# Original document",
                        revision: "revision-current",
                        canEdit: false,
                      },
                isPending: state.pending,
                error: state.readError,
                refetch: state.refetch,
              }
            : {
                data: { files: ["knowledge/launch-notes.md"] },
                isPending: false,
                error: null,
                refetch: state.refetch,
              },
      },
    },
  },
}));
vi.mock("@zoen/companion-ui", () => ({
  Library: (props: ComponentProps<typeof Library>) => (
    <div data-testid="retained-library">
      {props.items.map((item) => (
        <button key={item.id}>{item.title}</button>
      ))}
    </div>
  ),
  CompanionPage: (props: ComponentProps<typeof CompanionPage>) => (
    <section aria-label={props.title}>
      {props.loading && "Loading"}
      {props.error && <span role="alert">{props.error}</span>}
      {props.children}
    </section>
  ),
  IdeaCollection: () => null,
  GoalCollection: () => null,
  FeedCollection: () => null,
}));
vi.mock(
  "@app/(authenticated)/space/(overview)/_components/file-editor",
  () => ({
    FileEditor: (props: ComponentProps<typeof FileEditor>) => {
      state.file = props;
      return (
        <dialog open aria-label={props.path}>
          {props.content}
        </dialog>
      );
    },
  })
);

function render() {
  return renderToStaticMarkup(
    <ConnectedSections
      section="library"
      onPrompt={vi.fn<ComponentProps<typeof ConnectedSections>["onPrompt"]>()}
      onConversation={vi.fn<
        ComponentProps<typeof ConnectedSections>["onConversation"]
      >()}
    />
  );
}
beforeEach(() => {
  state.path = undefined;
  state.file = undefined;
  state.pending = false;
  state.readError = undefined;
  vi.clearAllMocks();
});

it("shows the existing library before a file opens", () => {
  const markup = render();
  expect(markup).toContain('data-testid="retained-library"');
  expect(markup).not.toContain('inert=""');
  expect(markup).not.toContain("<dialog");
});

it("retains the library subtree while the file editor is open", () => {
  state.path = "knowledge/launch-notes.md";
  const markup = render();
  expect(markup).toContain('data-testid="retained-library"');
  expect(markup).toContain('inert=""');
  expect(markup).toContain('aria-hidden="true"');
  expect(markup).toContain("visibility:hidden");
  expect(markup).toContain("<dialog");
  expect(state.file?.path).toBe(state.path);
  expect(state.file?.revision).toBe("revision-current");
  expect(state.file?.readOnly).toBe(true);
  state.file?.onClose();
  expect(state.setPath).toHaveBeenCalledExactlyOnceWith(undefined);
});

it("retains the initiating library while a file is loading or fails to read", () => {
  state.path = "knowledge/launch-notes.md";
  state.pending = true;
  expect(render()).toContain('data-testid="retained-library"');
  expect(render()).toContain("Loading");
  expect(state.file).toBeUndefined();
  state.pending = false;
  state.readError = { message: "Read unavailable" };
  const markup = render();
  expect(markup).toContain('data-testid="retained-library"');
  expect(markup).toContain('role="alert"');
  expect(state.file).toBeUndefined();
});
