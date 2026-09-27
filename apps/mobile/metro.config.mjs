import { getDefaultConfig } from "expo/metro-config.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const defaults = getDefaultConfig(import.meta.dirname);

// Resolve the shared package to the Expo app's SDK-supported React singleton.
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
        moduleName.startsWith("react-dom/")
      ) {
        return { type: "sourceFile", filePath: require.resolve(moduleName) };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

export default config;
