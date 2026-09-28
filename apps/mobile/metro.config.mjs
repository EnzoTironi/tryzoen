import { getDefaultConfig } from "expo/metro-config.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const defaults = getDefaultConfig(import.meta.dirname);

// React and query context must be the app's singletons across workspace packages.
/** @type {ReturnType<typeof getDefaultConfig>} */
const config = {
  ...defaults,
  resolver: {
    ...defaults.resolver,
    resolveRequest(context, moduleName, platform) {
      if (
        moduleName === "react" ||
        moduleName.startsWith("react/") ||
        moduleName === "react-dom" ||
        moduleName.startsWith("react-dom/") ||
        moduleName === "@tanstack/react-query"
      ) {
        return { type: "sourceFile", filePath: require.resolve(moduleName) };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

export default config;
