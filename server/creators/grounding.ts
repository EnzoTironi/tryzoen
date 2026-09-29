import { requireActiveCreatorPilot } from "./pilots";
import type { corpusAccessSchema } from "./corpus/schema";
import { authorizedCreatorCorpus } from "./corpus/access";
import { openCreatorCorpus, readCreatorCorpusPage } from "./corpus/engine";
import { verifyCorpusManifest } from "./corpus/files";
import type { z } from "zod";
import {
  creatorGroundingSchema,
  creatorGroundedAnswerSchema,
  type creatorPreviewRequestSchema,
} from "@zoen/companion-ui/creators";
import type { WorkspaceActorSchema } from "../workspaces/access";
import { readCreatorRelease } from "./releases";
import { searchCreatorCorpus } from "./corpus/retrieval";
import { corpusDigest } from "./corpus/schema";

export async function retrieveCreatorGrounding(
  actor: z.infer<typeof WorkspaceActorSchema>,
  input: z.infer<typeof creatorPreviewRequestSchema>
) {
  if (input.kind !== "grounded-answer") {
    if (input.releaseId)
      throw new Error("Only grounded evaluations accept a release.");
    return null;
  }
  let access: z.infer<typeof corpusAccessSchema>;
  let releaseId: string;
  let expectedDigest: string | null = null;
  if (input.pilotId) {
    const pilot = await requireActiveCreatorPilot(actor, input.pilotId);
    if (
      pilot.answerMode !== "grounded" ||
      !pilot.qualificationId ||
      !pilot.manifestDigest ||
      input.releaseId ||
      input.caseRef
    )
      throw new Error("This pilot is not qualified for grounded answers.");
    access = { kind: "pilot", pilotId: pilot.id };
    releaseId = pilot.releaseId;
    expectedDigest = pilot.manifestDigest;
  } else {
    if (!input.releaseId || !input.caseRef)
      throw new Error(
        "Grounded evaluations require an owned release and a saved case."
      );
    const release = await readCreatorRelease(actor, input.releaseId);
    if (
      release.draftId !== input.draftId ||
      release.revision !== input.revision
    )
      throw new Error("Evaluate the exact approved draft revision.");
    access = { kind: "creator", releaseId: release.id };
    releaseId = release.id;
  }
  const result = await searchCreatorCorpus(actor, {
    access,
    query: input.question,
  });
  if (expectedDigest !== null && result.manifestDigest !== expectedDigest)
    throw new Error("The qualified corpus changed.");
  return creatorGroundingSchema.parse({
    releaseId,
    manifestDigest: result.manifestDigest,
    retrieval: result.retrieval,
    citations: result.hits
      .filter((hit) => hit.kind !== "guidance")
      .map((hit, index) => ({
        id: `S${index + 1}`,
        title: hit.title,
        attribution: hit.attribution,
        excerpt: hit.excerpt,
        excerptDigest: hit.excerptDigest,
        pageDigest: hit.pageDigest,
        entryId: hit.entryId,
        start: hit.start,
        end: hit.end,
        offsetUnit: hit.offsetUnit,
      })),
  });
}

export function validateGroundedAnswer(
  raw: unknown,
  rawEvidence: z.infer<typeof creatorGroundingSchema>
) {
  const evidence = creatorGroundingSchema.parse(rawEvidence);
  for (const item of evidence.citations) {
    if (
      corpusDigest(item.excerpt) !== item.excerptDigest ||
      item.end - item.start !== item.excerpt.length
    )
      throw new Error("Grounded evidence failed integrity verification.");
  }
  const answer = creatorGroundedAnswerSchema.parse(raw);
  if (
    new Set(answer.citations).size !== answer.citations.length ||
    answer.citations.some(
      (id) => !evidence.citations.some((item) => item.id === id)
    )
  )
    throw new Error("The answer cites evidence outside its frozen package.");
  if (
    (answer.status === "supported" && !answer.citations.length) ||
    (answer.status === "insufficient-evidence" && answer.citations.length)
  )
    throw new Error(
      "Supported answers require citations; insufficient evidence must not claim support."
    );
  return answer;
}

/** Recheck native availability and exact approved evidence before execution or acceptance. */
export async function verifyCreatorGrounding(
  actor: z.infer<typeof WorkspaceActorSchema>,
  evidence: z.infer<typeof creatorGroundingSchema>,
  pilotId?: string
) {
  if (pilotId) {
    const pilot = await requireActiveCreatorPilot(actor, pilotId);
    if (
      pilot.answerMode !== "grounded" ||
      !pilot.qualificationId ||
      pilot.releaseId !== evidence.releaseId ||
      pilot.manifestDigest !== evidence.manifestDigest
    )
      throw new Error("This grounded pilot is no longer authorized.");
  }
  const corpus = await authorizedCreatorCorpus(
    actor,
    pilotId
      ? { kind: "pilot", pilotId }
      : { kind: "creator", releaseId: evidence.releaseId }
  );
  if (!corpus.initialized || corpus.digest !== evidence.manifestDigest)
    throw new Error("Grounded corpus is no longer available.");
  await using engine = await openCreatorCorpus(corpus.namespace, true);
  await verifyCorpusManifest(engine.data, corpus.manifest, true);
  for (const citation of evidence.citations) {
    const page = corpus.manifest.pages.find(
      (item) =>
        item.entryId === citation.entryId &&
        item.start === citation.start &&
        item.digest === citation.pageDigest &&
        item.kind !== "guidance"
    );
    if (
      !page ||
      page.attribution !== citation.attribution ||
      page.title !== citation.title
    )
      throw new Error("Grounded citation is outside the approved corpus.");
    await readCreatorCorpusPage(engine, evidence.releaseId, page);
    if (
      page.body.slice(0, citation.end - citation.start) !== citation.excerpt ||
      corpusDigest(citation.excerpt) !== citation.excerptDigest
    )
      throw new Error("Grounded citation content changed.");
  }
}
