import type { ReactNode } from "react";
import { Logo } from "@web/components/ui/logo";

/** Full-screen not-found and error states share one calm composition. */
export function StatusPage({
  code,
  title,
  description,
  children,
}: {
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}) {
  return (
    <main className="relative isolate flex min-h-svh items-center justify-center overflow-hidden bg-background px-6 text-foreground">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 -z-10 h-[60svh] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklch,var(--primary)_10%,transparent),transparent)]"
      />
      <div className="flex max-w-md animate-enter flex-col items-center text-center">
        <Logo className="size-16! shadow-lg ring-4 ring-background" />
        <p className="type-micro mt-8 tracking-[0.14em] text-muted-foreground uppercase">
          {code}
        </p>
        <h1 className="type-page-title mt-2 text-balance">{title}</h1>
        <p className="type-supporting-body mt-3 text-balance text-muted-foreground">
          {description}
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          {children}
        </div>
      </div>
    </main>
  );
}
