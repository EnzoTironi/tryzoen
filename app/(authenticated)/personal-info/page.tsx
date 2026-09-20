import { headers } from "next/headers";
import { PersonalInfoForm } from "./_components/personal-info-form";
import { readPersonalProfile } from "../../../server/personal-memory/profile";

export default async function Page() {
  const profile = await readPersonalProfile(await headers());
  return <PersonalInfoForm initialProfile={profile} />;
}
