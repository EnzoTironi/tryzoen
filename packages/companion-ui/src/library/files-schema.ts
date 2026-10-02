import { z } from "zod";

export const sourceBindingPathSchema = z
  .string()
  .regex(/^knowledge\/sources\/[a-z][a-z0-9_-]{0,63}\.json$/);

export const WorkspacePathSchema = z
  .string()
  .refine((path) =>
    path.startsWith("knowledge/sources/")
      ? sourceBindingPathSchema.safeParse(path).success
      : /^(?:(?:knowledge|skills|agent|proposals\/skills)\/[a-zA-Z0-9][a-zA-Z0-9_./-]{0,180}\.md|knowledge\/models\/[a-zA-Z0-9][a-zA-Z0-9_./-]{0,180}\.malloy|knowledge\/routing\/index\.json|knowledge\/queries\/[a-z][a-z0-9_-]{0,39}\.json|knowledge\/data\/[a-z][a-z0-9_-]{0,39}\.csv|(?:plugins|ontology)\/workspace\.json|(?:tools|proposals\/tools)\/[a-z][a-z0-9-]{0,39}\.json|proposals\/knowledge\/[a-f0-9-]{36}\.json)$/.test(
          path
        )
  )
  .refine((path) => !/(?:\/\.|\.\.|\/\/)/u.test(path));
export const GitRevisionSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const WorkspaceRecordedViewSchema = z
  .strictObject({
    revision: GitRevisionSchema.optional(),
    asOf: z.iso.datetime({ offset: true }).optional(),
  })
  .refine(
    (view) => view.revision === undefined || view.asOf === undefined,
    "Choose a recorded revision or an as-of time, not both"
  );
export const knowledgePathSchema = WorkspacePathSchema.refine((path) =>
  path.startsWith("knowledge/")
);

export const workspaceRevisionSchema = z.object({
  revision: GitRevisionSchema,
  parent: z.nullable(GitRevisionSchema),
  path: WorkspacePathSchema,
  author: z.string(),
  createdAt: z.string(),
  source: z.string(),
});

export const WorkspaceChangeSchema = z
  .object({
    path: WorkspacePathSchema,
    content: z.string().max(262_144).nullable(),
  })
  .strict();

export const WorkspaceChangesSchema = z
  .array(WorkspaceChangeSchema)
  .min(1)
  .max(24)
  .refine(
    (changes) =>
      new Set(changes.map(({ path }) => path)).size === changes.length,
    "A file can only be changed once per revision"
  );

export const WorkspacePublishSchema = z
  .object({
    operationId: z.uuid(),
    expectedRevision: GitRevisionSchema.nullable(),
    changes: WorkspaceChangesSchema,
  })
  .strict();
