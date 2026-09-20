import { Secret } from "@shared/environment/secret";
import { openBitwardenExport } from "./bitwarden";

self.addEventListener(
  "message",
  (event: MessageEvent<{ source: string; password: string }>) => {
    void Promise.try(async () => {
      await Promise.try(async () =>
        openBitwardenExport(event.data.source, new Secret(event.data.password))
      ).then(
        (result) => {
          self.postMessage(result, { transfer: [] });
        },
        () => {
          self.postMessage(null, { transfer: [] });
        }
      );
    }).catch(() => {
      (() => {
        self.postMessage(null, { transfer: [] });
      })();
    });
  },
  { once: true }
);
