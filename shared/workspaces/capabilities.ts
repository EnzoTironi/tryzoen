import { z } from "zod";

export const workspacePlugins = [
  {
    id: "files",
    label: "Arquivos e skills",
    description: "Consultar seu conhecimento e seguir seus processos.",
  },
  {
    id: "memory",
    label: "Memória aprendida",
    description: "Lembrar do que importa para você neste espaço.",
  },
  {
    id: "google",
    label: "Google Workspace",
    description: "E-mail, agenda e contatos conectados a este espaço.",
  },
  {
    id: "ontology",
    label: "Conhecimento conectado",
    description: "Entidades, relações e ações com origem verificável.",
  },
] as const;
export const WorkspaceCapabilitiesSchema = z.object({
  version: z.literal(1),
  enabled: z.array(z.enum(["files", "memory", "google", "ontology"])).max(4),
});
export const capabilitiesPath = "plugins/workspace.json";
export const defaultWorkspaceCapabilities: z.output<
  typeof WorkspaceCapabilitiesSchema
> = { version: 1, enabled: ["files", "memory", "ontology"] };
