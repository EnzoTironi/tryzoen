import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { apiOrigin } from "./environment";
import { clearMobileMessages } from "./message-storage";
export const auth = createAuthClient({
  baseURL: apiOrigin,
  fetchOptions: {
    async onSuccess(context) {
      if (String(context.request.url).endsWith("/sign-out"))
        await clearMobileMessages();
    },
  },
  plugins: [
    expoClient({ scheme: "zoen", storagePrefix: "zoen", storage: SecureStore }),
  ],
});
export async function accountHeaders(): Promise<Record<string, string>> {
  if (Platform.OS === "web") return {};
  const cookie = await auth.getCookie();
  return cookie ? { Cookie: cookie } : {};
}
