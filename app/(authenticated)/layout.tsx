import { notFound } from "next/navigation";
import { env } from "@shared/environment";
import LegacyShell from "./legacy-shell";

export { generateMetadata } from "./legacy-shell";

export default function LegacyLayout(props: LayoutProps<"/">) {
  if (!env.ZOEN_LEGACY_APP_ENABLED) notFound();
  return <LegacyShell {...props} />;
}
