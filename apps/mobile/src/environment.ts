import { Platform } from "react-native";
import { z } from "zod";
// Expo statically substitutes this exact property access; the value is validated below.
// oxlint-disable-next-line eslint/no-restricted-properties
const configured: unknown = process.env.EXPO_PUBLIC_API_URL;
const originSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname === "/" &&
    (url.protocol === "https:" || (__DEV__ && url.protocol === "http:"))
  );
}, "Set EXPO_PUBLIC_API_URL to your Zoen HTTPS origin.");
export const apiOrigin = originSchema
  .parse(
    configured ??
      (Platform.OS === "web"
        ? window.location.origin
        : "https://app.tryzoen.com")
  )
  .replace(/\/$/u, "");
