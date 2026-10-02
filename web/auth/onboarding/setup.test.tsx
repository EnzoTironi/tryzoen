import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "@tests/helpers/i18n";
import { OnboardingSetup } from "./setup";

const mocks = vi.hoisted(() => ({
  connectionError: false,
  saveError: false,
  identity: "# Identity\n\nName: Sol\nKeep the user's own instructions.\n",
  router: {
    push: vi.fn<(path: string) => void>(),
    replace: vi.fn<(path: string) => void>(),
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@web/trpc/client", () => ({
  api: {
    useUtils: () => ({
      companion: { identity: { invalidate: async () => undefined } },
    }),
    companion: {
      identity: {
        useQuery: () => ({
          data: {
            documents: [{ path: "agent/IDENTITY.md", content: mocks.identity }],
            revision: "saved-revision",
            canEdit: true,
          },
          isPending: false,
          error: null,
          refetch: async () => undefined,
        }),
      },
    },
    googleWorkspace: {
      read: {
        useQuery: () => ({
          data: { state: "unavailable" },
          isPending: false,
          error: mocks.connectionError ? new Error("Unavailable") : null,
          refetch: async () => undefined,
        }),
      },
    },
    accountChannels: {
      list: {
        useQuery: () => ({
          data: [],
          isPending: false,
          error: null,
          refetch: async () => undefined,
        }),
      },
    },
    workspaces: {
      write: {
        useMutation: () => ({
          isPending: false,
          error: mocks.saveError ? new Error("Network failed") : null,
          mutate: () => undefined,
        }),
      },
    },
  },
}));
vi.mock("@app/(authenticated)/connections/_components/connection-list", () => ({
  ConnectionList: () => <p>Google and messengers</p>,
}));
vi.mock("@app/companion/settings/vault", () => ({
  SettingsVault: () => <p>Vault</p>,
}));

beforeEach(() => {
  mocks.connectionError = false;
  mocks.saveError = false;
});
describe("Companion onboarding", () => {
  it.each([
    [
      "en",
      "Companion name",
      "Set up my vault",
      "Start a conversation",
      "Connections are optional.",
    ],
    [
      "es",
      "Nombre del Companion",
      "Preparar mi bóveda",
      "Iniciar una conversación",
      "Las conexiones son opcionales.",
    ],
    [
      "pt-BR",
      "Nome do Companion",
      "Preparar meu cofre",
      "Começar uma conversa",
      "As conexões são opcionais.",
    ],
  ] as const)(
    "localizes the new personal setup and optional connections in %s",
    (locale, name, vault, start, optional) => {
      const personal = renderToStaticMarkup(
        <OnboardingSetup
          available={[]}
          callbackUrl="/"
          initialStep="companion"
        />,
        locale
      );
      expect(personal).toContain(name);
      expect(personal).toContain('value="Sol"');
      const connections = renderToStaticMarkup(
        <OnboardingSetup
          available={["telegram"]}
          callbackUrl="/"
          initialStep="connections"
        />,
        locale
      );
      expect(connections).toContain(vault);
      expect(connections).toContain(start);
      expect(connections).toContain(optional);
    }
  );
  it("keeps an existing Companion name and offers personalization without a team selection", () => {
    const html = renderToStaticMarkup(
      <OnboardingSetup available={[]} callbackUrl="/" initialStep="companion" />
    );
    expect(html).toContain('value="Sol"');
    expect(html).toContain("Nome do Companion");
    expect(html).not.toContain("Escolha seu espaço");
    expect(html).not.toContain("Entrar no meu espaço");
  });
  it("keeps the name visible after a failed save", () => {
    mocks.saveError = true;
    const html = renderToStaticMarkup(
      <OnboardingSetup available={[]} callbackUrl="/" initialStep="companion" />
    );
    expect(html).toContain('value="Sol"');
    expect(html).toContain("Não foi possível salvar. Tente novamente.");
  });
  it("offers connections and vault setup before a first conversation", () => {
    const html = renderToStaticMarkup(
      <OnboardingSetup
        available={["telegram"]}
        callbackUrl="/"
        initialStep="connections"
      />
    );
    expect(html).toContain("Google and messengers");
    expect(html).toContain("Preparar meu cofre");
    expect(html).toContain("As conexões são opcionais.");
    expect(html).toContain("Começar uma conversa");
  });
  it("still lets the user start when optional connections cannot load", () => {
    mocks.connectionError = true;
    const html = renderToStaticMarkup(
      <OnboardingSetup
        available={[]}
        callbackUrl="/"
        initialStep="connections"
      />
    );
    expect(html).toContain("Não foi possível carregar suas conexões");
    expect(html).toContain("Começar uma conversa");
    expect(html).not.toContain("Google and messengers");
  });
});
