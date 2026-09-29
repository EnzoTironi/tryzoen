import { createAuthClient } from "better-auth/react";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { clearBrowserMessages } from "@web/trpc/message-storage";
export const authClient = createAuthClient({
  fetchOptions: {
    async onSuccess(context) {
      if (String(context.request.url).endsWith("/sign-out"))
        await clearBrowserMessages();
    },
  },
  plugins: [oauthProviderClient()],
});
