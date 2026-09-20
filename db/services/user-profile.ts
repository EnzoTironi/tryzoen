import { query, transaction } from "@db/queries";
import { sql } from "drizzle-orm";
import type { AccessScope } from "@shared/identity/access-scope";
import {
  emptyUserProfile,
  parseUserProfile,
  userProfilePatchSchema,
  userProfileSchema,
  type UserProfile,
  type UserProfilePatch,
} from "@shared/user-profile/schema";

export class UserProfileError extends Error {
  readonly _tag = "UserProfileError";
  readonly reason: "invalid_input" | "invalid_stored_profile";
  constructor(input: { reason: UserProfileError["reason"] }) {
    super("UserProfileError");
    this.name = "UserProfileError";
    this.reason = input.reason;
  }
}

const columns = [
  ["addressLine1", "address_line_1"],
  ["addressLine2", "address_line_2"],
  ["city", "city"],
  ["countryCode", "country_code"],
  ["dateOfBirth", "date_of_birth"],
  ["email", "email"],
  ["firstName", "first_name"],
  ["lastName", "last_name"],
  ["phone", "phone"],
  ["postalCode", "postal_code"],
  ["region", "region"],
] as const;

const selection = sql`address_line_1 AS "addressLine1", address_line_2 AS "addressLine2",
  city, country_code AS "countryCode", date_of_birth::text AS "dateOfBirth",
  email, first_name AS "firstName", last_name AS "lastName", phone,
  postal_code AS "postalCode", region`;

// Authorization runs within the transaction so its authority locks cover storage I/O.
export function readUserProfile(authorize: () => Promise<AccessScope>) {
  return transaction(async () => {
    const scope = await authorize();
    const rows =
      await query<UserProfile>(sql`SELECT ${selection} FROM user_profiles
      WHERE workspace_id = ${scope.workspaceId}`);
    try {
      return parseUserProfile(rows[0] ?? emptyUserProfile);
    } catch {
      throw new UserProfileError({ reason: "invalid_stored_profile" });
    }
  });
}

export async function replaceUserProfile(
  authorize: () => Promise<AccessScope>,
  input: UserProfile
) {
  let profile: UserProfile;
  try {
    profile = parseUserProfile(input);
  } catch {
    throw new UserProfileError({ reason: "invalid_input" });
  }
  return patchUserProfile(authorize, profile);
}

export function patchUserProfile(
  authorize: () => Promise<AccessScope>,
  input: UserProfilePatch
) {
  return transaction(async () => {
    const scope = await authorize();
    let patch: UserProfilePatch;
    let normalized: UserProfile;
    try {
      patch = userProfilePatchSchema.parse(input);
      normalized = parseUserProfile({ ...emptyUserProfile, ...patch });
    } catch {
      throw new UserProfileError({ reason: "invalid_input" });
    }
    const changes = columns
      .filter(([key]) => patch[key] !== undefined)
      .map(([key, column]) => [column, normalized[key]] as const);
    const values = [["workspace_id", scope.workspaceId], ...changes] as const;
    const names = sql.join(
      values.map(([name]) => sql.identifier(name)),
      sql`, `
    );
    const parameters = sql.join(
      values.map(([, value]) => sql`${value}`),
      sql`, `
    );
    const updates = sql.join(
      [
        ...changes.map(
          ([name, value]) => sql`${sql.identifier(name)} = ${value}`
        ),
        sql`updated_at = clock_timestamp()`,
      ],
      sql`, `
    );
    const rows =
      await query<UserProfile>(sql`INSERT INTO user_profiles (${names})
      VALUES (${parameters}) ON CONFLICT (workspace_id) DO UPDATE SET ${updates}
      RETURNING ${selection}`);
    try {
      return parseUserProfile(userProfileSchema.parse(rows[0]));
    } catch {
      throw new UserProfileError({ reason: "invalid_stored_profile" });
    }
  });
}
