import type { Secret } from "@shared/environment/secret";
import { jsonString } from "@shared/validation";
import { z } from "zod";
import { argon2id } from "hash-wasm";
import {
  loginIdentifierSchema,
  serializeLoginVaultPayload,
  type VaultImportItems,
} from "@shared/vault/schema";
const boundedText = z.string().max(14_000_000);
const encryptedFields = {
  encrypted: z.literal(true),
  passwordProtected: z.literal(true),
  salt: z.string().min(1).max(256),
  encKeyValidation_DO_NOT_EDIT: boundedText,
  data: boundedText,
};
const exportSchema = z.union([
  z.object({
    ...encryptedFields,
    kdfType: z.literal(0),
    kdfIterations: z.number().int().min(5_000).max(2_000_000),
  }),
  z.object({
    ...encryptedFields,
    kdfType: z.literal(1),
    kdfIterations: z.number().int().min(2).max(10),
    kdfMemory: z.number().int().min(16).max(128),
    kdfParallelism: z.number().int().min(1).max(8),
  }),
]);
const documentSchema = z.object({
  items: z
    .array(
      z.object({
        type: z.number(),
        name: z.string(),
        deletedDate: z.optional(z.nullable(z.string())),
        login: z.optional(
          z.nullable(
            z.object({
              username: z.optional(z.nullable(z.string())),
              password: z.optional(z.nullable(z.string())),
              totp: z.optional(z.nullable(z.string())),
              uris: z.optional(
                z.nullable(
                  z.array(
                    z.object({
                      uri: z.optional(z.nullable(z.string())),
                    })
                  )
                )
              ),
            })
          )
        ),
      })
    )
    .max(3_000),
});
export class VaultImportFailed extends Error {
  readonly _tag = "VaultImportFailed";
  constructor() {
    super("VaultImportFailed");
    this.name = "VaultImportFailed";
  }
}

/** Portable password-protected exports only; never accepts a user's account key. */
export async function openBitwardenExport(source: string, password: Secret) {
  let material: Uint8Array | undefined;
  let enc: ArrayBuffer | undefined;
  let mac: ArrayBuffer | undefined;
  let plaintext: Uint8Array | undefined;
  try {
    const envelope = jsonString(exportSchema).parse(boundedText.parse(source));
    const key = await exportKey(envelope, password);
    material = key;
    const hmac = await crypto.subtle.importKey(
      "raw",
      key,
      {
        name: "HMAC",
        hash: "SHA-256",
      },
      false,
      ["sign"]
    );
    // Bitwarden uses HKDF-expand, without extract, on the password-derived key.
    enc = await crypto.subtle.sign(
      "HMAC",
      hmac,
      new Uint8Array([...new TextEncoder().encode("enc"), 1])
    );
    mac = await crypto.subtle.sign(
      "HMAC",
      hmac,
      new Uint8Array([...new TextEncoder().encode("mac"), 1])
    );
    const encryption = await crypto.subtle.importKey(
      "raw",
      enc,
      "AES-CBC",
      false,
      ["decrypt"]
    );
    const authentication = await crypto.subtle.importKey(
      "raw",
      mac,
      {
        name: "HMAC",
        hash: "SHA-256",
      },
      false,
      ["verify"]
    );
    const validation = await decryptExportCipher(
      envelope.encKeyValidation_DO_NOT_EDIT,
      encryption,
      authentication
    );
    validation.fill(0);
    plaintext = await decryptExportCipher(
      envelope.data,
      encryption,
      authentication
    );
    return convertLogins(
      jsonString(documentSchema).parse(
        new TextDecoder("utf-8", {
          fatal: true,
        }).decode(plaintext)
      )
    );
  } catch {
    throw new VaultImportFailed();
  } finally {
    material?.fill(0);
    if (enc) new Uint8Array(enc).fill(0);
    if (mac) new Uint8Array(mac).fill(0);
    plaintext?.fill(0);
  }
}
async function exportKey(
  envelope: z.output<typeof exportSchema>,
  password: Secret
) {
  const salt = new TextEncoder().encode(envelope.salt);
  const bytes = new TextEncoder().encode(password.reveal());
  try {
    if (envelope.kdfType === 1) {
      const saltHash = await crypto.subtle.digest("SHA-256", salt);
      return new Uint8Array(
        await argon2id({
          password: bytes,
          salt: new Uint8Array(saltHash),
          hashLength: 32,
          iterations: envelope.kdfIterations,
          memorySize: envelope.kdfMemory * 1024,
          parallelism: envelope.kdfParallelism,
          outputType: "binary",
        })
      );
    }
    const key = await crypto.subtle.importKey("raw", bytes, "PBKDF2", false, [
      "deriveBits",
    ]);
    return new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          salt,
          iterations: envelope.kdfIterations,
        },
        key,
        256
      )
    );
  } finally {
    bytes.fill(0);
  }
}
const decryptExportCipher = async function (
  cipher: string,
  encryption: CryptoKey,
  authentication: CryptoKey
) {
  const parts =
    /^2\.([A-Za-z0-9+/]+=*)\|([A-Za-z0-9+/]+=*)\|([A-Za-z0-9+/]+=*)$/.exec(
      cipher
    );
  if (!parts) throw new VaultImportFailed();
  const [iv, encrypted, signature] = parts
    .slice(1)
    .map((part) => Uint8Array.from(atob(part), (char) => char.charCodeAt(0)));
  if (
    !iv ||
    !encrypted ||
    !signature ||
    iv.length !== 16 ||
    signature.length !== 32 ||
    encrypted.length % 16 !== 0
  )
    throw new VaultImportFailed();
  const valid = await crypto.subtle.verify(
    "HMAC",
    authentication,
    signature,
    new Uint8Array([...iv, ...encrypted])
  );
  if (!valid) throw new VaultImportFailed();
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-CBC",
        iv,
      },
      encryption,
      encrypted
    )
  );
};
function convertLogins(document: z.output<typeof documentSchema>) {
  const items: VaultImportItems = [];
  let skipped = 0;
  for (const item of document.items) {
    const login = item.login;
    if (
      item.type !== 1 ||
      item.deletedDate ||
      !login?.username ||
      !login.password
    ) {
      skipped++;
      continue;
    }
    const origins = new Set(
      (login.uris ?? []).flatMap(({ uri }) => {
        if (!uri || !URL.canParse(uri)) return [];
        const url = new URL(uri);
        return url.protocol === "https:" && !url.username && !url.password
          ? [url.origin]
          : [];
      })
    );
    if (
      origins.size !== 1 ||
      item.name.length > 120 ||
      login.username.length > 300 ||
      login.password.length > 16_000 ||
      (login.totp?.length ?? 0) > 2_048
    ) {
      skipped++;
      continue;
    }
    const origin = [...origins][0];
    if (!origin || !item.name.trim()) {
      skipped++;
      continue;
    }
    items.push({
      kind: "login",
      account: "",
      label: item.name,
      secret: serializeLoginVaultPayload({
        kind: "login",
        version: 2,
        origin,
        identifier: {
          type: loginIdentifierSchema.safeParse({
            type: "email",
            value: login.username,
          }).success
            ? "email"
            : "username",
          value: login.username,
        },
        authentication: {
          type: "password",
          password: login.password,
          totp: login.totp?.length ? login.totp : undefined,
        },
      }),
    });
  }
  return {
    items,
    skipped,
  };
}
