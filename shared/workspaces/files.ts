import { z } from "zod";

export const WorkspacePathSchema = z
  .string()
  .regex(
    /^(?:(?:knowledge|skills|agent|proposals\/skills)\/[a-zA-Z0-9][a-zA-Z0-9_./-]{0,180}\.md|knowledge\/models\/[a-zA-Z0-9][a-zA-Z0-9_./-]{0,180}\.malloy|(?:plugins|ontology)\/workspace\.json|(?:tools|proposals\/tools)\/[a-z][a-z0-9-]{0,39}\.json)$/
  )
  .regex(/^(?!.*(?:\/\.|\.\.|\/\/)).*$/);
export const GitRevisionSchema = z.string().regex(/^[a-f0-9]{40}$/);

export const workspaceRevisionSchema = z.object({
  revision: GitRevisionSchema,
  parent: z.nullable(GitRevisionSchema),
  path: WorkspacePathSchema,
  author: z.string(),
  createdAt: z.string(),
  source: z.string(),
});
