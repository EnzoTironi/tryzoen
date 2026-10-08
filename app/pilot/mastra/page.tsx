import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { env } from "@shared/environment/env";
import { getAuthSession } from "@db/services/auth/session";
import { PilotClient } from "./client";

export const dynamic = "force-dynamic";
export default async function MastraPilot() {
  if (!env.ZOEN_MASTRA_PILOT_ENABLED) notFound();
  const requestHeaders = await headers();
  if (!(await getAuthSession(requestHeaders))) redirect("/get-started");
  const { readMastraPilot } = await import("../../../server/mastra/pilot");
  return <PilotClient initialView={await readMastraPilot(requestHeaders)} />;
}
