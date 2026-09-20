import { withEve, type EveNextRewriteSections } from "eve/next";
import type { NextConfig } from "next";
import { openInstinctLowMemBuild } from "@shared/environment/env/low-mem-build";

const nextConfig: NextConfig = openInstinctLowMemBuild
  ? {
      // Fly Depot / constrained builders: cut Next+TS peak RSS (exit 137).
      // CI still runs types:check:app; ignoreBuildErrors is Docker-only.
      typescript: { ignoreBuildErrors: true },
      productionBrowserSourceMaps: false,
      enablePrerenderSourceMaps: false,
      experimental: {
        cpus: 1,
        webpackMemoryOptimizations: true,
        serverSourceMaps: false,
      },
    }
  : {};
const frameworkConfig = withEve(nextConfig);
const eveRoute = "/eve/v1/:path+";

export default async function companionConfig(
  ...args: Parameters<typeof frameworkConfig>
) {
  const resolved = await frameworkConfig(...args);
  const frameworkRewrites = resolved.rewrites;
  return {
    ...resolved,
    serverExternalPackages: [
      ...(resolved.serverExternalPackages ?? []),
      "@firecrawl/anydoc",
      "quickjs-emscripten",
    ],
    async rewrites() {
      if (!frameworkRewrites)
        throw new Error(
          "This deployment needs an Eve proxy before enabling channel webhooks."
        );
      const rewrites = await frameworkRewrites();
      const sections: EveNextRewriteSections = Array.isArray(rewrites)
        ? { beforeFiles: [], afterFiles: rewrites, fallback: [] }
        : rewrites;
      const native = sections.beforeFiles?.find(
        (route) => route.source === eveRoute
      );
      if (!native?.destination.endsWith(eveRoute))
        throw new Error(
          "Eve's generated proxy route is missing or unsupported."
        );
      const destination = native.destination.slice(0, -eveRoute.length);
      return {
        ...sections,
        beforeFiles: [
          ...(sections.beforeFiles ?? []),
          {
            source: "/_matrix/app/v1/:path*",
            destination: `${destination}/_matrix/app/v1/:path*`,
          },
          {
            source: "/agents/:username",
            destination: `${destination}/agents/:username`,
          },
          {
            source: "/agents/:username/.well-known/agent-card.json",
            destination: `${destination}/agents/:username/agent-card`,
          },
          ...["telegram", "kapso"].map((channel) => ({
            source: `/api/channels/${channel}`,
            destination: `${destination}/channels/${channel}`,
          })),
          ...["report", "respond"].map((operation) => ({
            source: `/internal/scheduled-run/${operation}`,
            destination: `${destination}/internal/scheduled-run/${operation}`,
          })),
          {
            source: "/internal/channel-input/respond",
            destination: `${destination}/internal/channel-input/respond`,
          },
        ],
      };
    },
  };
}
