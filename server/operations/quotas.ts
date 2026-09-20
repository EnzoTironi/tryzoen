import { z } from "zod";
import { type BillingPlanId, quotaLimitsForPlan } from "@shared/billing/plans";

/**
 * Release-1 self-host minimum quotas (P11 admission).
 * Callers supply observed usage; over-limit work fails closed with
 * QuotaAdmissionError reason "exceeded". Media attachment caps remain in
 * server/channels/media/policy.ts.
 */
export const release1QuotaLimits = {
  user: {
    concurrentTurns: 2,
    dailyModelTokens: 500_000,
    dailyToolCalls: 200,
    dailyProactiveMessages: 24,
    storageBytes: 100 * 1024 * 1024,
    sandboxActiveSecondsPerDay: 900,
  },
  installation: {
    concurrentTurns: 20,
    dailyModelTokens: 5_000_000,
    activeUsersPerDay: 100,
  },
} as const;

export interface Release1QuotaLimits {
  user: {
    concurrentTurns: number;
    dailyModelTokens: number;
    dailyToolCalls: number;
    dailyProactiveMessages: number;
    storageBytes: number;
    sandboxActiveSecondsPerDay: number;
  };
  installation: {
    concurrentTurns: number;
    dailyModelTokens: number;
    activeUsersPerDay: number;
  };
}

/** Resolve admission limits for a hosted entitlement plan (defaults Free). */
export function admissionLimitsForPlan(
  plan: BillingPlanId = "free",
  seatCount = 1
): Release1QuotaLimits {
  const limits = quotaLimitsForPlan(plan, seatCount);
  return {
    user: { ...limits.user },
    installation: { ...limits.installation },
  };
}

const quotaResourceSchema = z.enum([
  "concurrent_turns",
  "model_tokens",
  "tool_calls",
  "proactive_messages",
  "storage_bytes",
  "sandbox_seconds",
  "active_users",
]);
type QuotaResource = z.output<typeof quotaResourceSchema>;

const quotaScopeSchema = z.enum(["user", "installation"]);
type QuotaScope = z.output<typeof quotaScopeSchema>;

const nonNegativeInt = z.number().int().min(0);

const quotaUsageStruct = z.object({
  user: z.object({
    concurrentTurns: nonNegativeInt,
    dailyModelTokens: nonNegativeInt,
    dailyToolCalls: nonNegativeInt,
    dailyProactiveMessages: nonNegativeInt,
    storageBytes: nonNegativeInt,
    sandboxActiveSecondsPerDay: nonNegativeInt,
  }),
  installation: z.object({
    concurrentTurns: nonNegativeInt,
    dailyModelTokens: nonNegativeInt,
    activeUsersPerDay: nonNegativeInt,
  }),
});

export interface QuotaUsage {
  user: {
    concurrentTurns: number;
    dailyModelTokens: number;
    dailyToolCalls: number;
    dailyProactiveMessages: number;
    storageBytes: number;
    sandboxActiveSecondsPerDay: number;
  };
  installation: {
    concurrentTurns: number;
    dailyModelTokens: number;
    activeUsersPerDay: number;
  };
}

const quotaDemandStruct = z.object({
  concurrentTurns: z.optional(nonNegativeInt),
  modelTokens: z.optional(nonNegativeInt),
  toolCalls: z.optional(nonNegativeInt),
  proactiveMessages: z.optional(nonNegativeInt),
  storageBytes: z.optional(nonNegativeInt),
  sandboxSeconds: z.optional(nonNegativeInt),
  /** 1 when admitting work for a user not yet counted in today's active set. */
  activeUser: z.optional(z.literal([0, 1])),
});

export interface QuotaDemand {
  concurrentTurns?: number;
  modelTokens?: number;
  toolCalls?: number;
  proactiveMessages?: number;
  storageBytes?: number;
  sandboxSeconds?: number;
  activeUser?: 0 | 1;
}

export class QuotaAdmissionError extends Error {
  readonly _tag = "QuotaAdmissionError";
  declare readonly reason: "exceeded" | "invalid_input";
  declare readonly scope?: z.output<typeof quotaScopeSchema> | undefined;
  declare readonly resource?: z.output<typeof quotaResourceSchema> | undefined;
  declare readonly limit?: number | undefined;
  declare readonly used?: number | undefined;
  declare readonly requested?: number | undefined;
  constructor(input: {
    readonly reason: "exceeded" | "invalid_input";
    readonly scope?: z.output<typeof quotaScopeSchema> | undefined;
    readonly resource?: z.output<typeof quotaResourceSchema> | undefined;
    readonly limit?: number | undefined;
    readonly used?: number | undefined;
    readonly requested?: number | undefined;
  }) {
    super("QuotaAdmissionError");
    this.name = "QuotaAdmissionError";
    Object.assign(this, input);
  }
}

export function quotaFailureMessage(error: QuotaAdmissionError) {
  if (error.reason === "invalid_input")
    return "Quota admission rejected invalid usage or demand input.";
  const resource = error.resource ?? "concurrent_turns";
  const scope = error.scope ?? "user";
  const used = error.used ?? 0;
  const limit = error.limit ?? 0;
  const requested = error.requested ?? 0;
  const unit =
    resource === "model_tokens"
      ? "model tokens"
      : resource === "tool_calls"
        ? "tool calls"
        : resource === "proactive_messages"
          ? "proactive messages"
          : resource === "storage_bytes"
            ? "bytes of storage"
            : resource === "sandbox_seconds"
              ? "sandbox active seconds"
              : resource === "active_users"
                ? "active users"
                : "concurrent turns";
  const horizon =
    resource === "concurrent_turns"
      ? "right now"
      : resource === "storage_bytes"
        ? "for this account"
        : "for today";
  return `This ${scope} has reached its ${unit} limit ${horizon} (${String(used)} used of ${String(limit)}; requested ${String(requested)}). Try again later or discuss more usage with your Companion. Subscription management is available in your account.`;
}

interface Check {
  scope: QuotaScope;
  resource: QuotaResource;
  used: number;
  requested: number;
  limit: number;
}

function checks(
  limits: Release1QuotaLimits,
  usage: QuotaUsage,
  demand: QuotaDemand
): Check[] {
  const out: Check[] = [];
  if (demand.concurrentTurns !== undefined) {
    out.push({
      scope: "user",
      resource: "concurrent_turns",
      used: usage.user.concurrentTurns,
      requested: demand.concurrentTurns,
      limit: limits.user.concurrentTurns,
    });
    out.push({
      scope: "installation",
      resource: "concurrent_turns",
      used: usage.installation.concurrentTurns,
      requested: demand.concurrentTurns,
      limit: limits.installation.concurrentTurns,
    });
  }
  if (demand.modelTokens !== undefined) {
    out.push({
      scope: "user",
      resource: "model_tokens",
      used: usage.user.dailyModelTokens,
      requested: demand.modelTokens,
      limit: limits.user.dailyModelTokens,
    });
    out.push({
      scope: "installation",
      resource: "model_tokens",
      used: usage.installation.dailyModelTokens,
      requested: demand.modelTokens,
      limit: limits.installation.dailyModelTokens,
    });
  }
  if (demand.toolCalls !== undefined) {
    out.push({
      scope: "user",
      resource: "tool_calls",
      used: usage.user.dailyToolCalls,
      requested: demand.toolCalls,
      limit: limits.user.dailyToolCalls,
    });
  }
  if (demand.proactiveMessages !== undefined) {
    out.push({
      scope: "user",
      resource: "proactive_messages",
      used: usage.user.dailyProactiveMessages,
      requested: demand.proactiveMessages,
      limit: limits.user.dailyProactiveMessages,
    });
  }
  if (demand.storageBytes !== undefined) {
    out.push({
      scope: "user",
      resource: "storage_bytes",
      used: usage.user.storageBytes,
      requested: demand.storageBytes,
      limit: limits.user.storageBytes,
    });
  }
  if (demand.sandboxSeconds !== undefined) {
    out.push({
      scope: "user",
      resource: "sandbox_seconds",
      used: usage.user.sandboxActiveSecondsPerDay,
      requested: demand.sandboxSeconds,
      limit: limits.user.sandboxActiveSecondsPerDay,
    });
  }
  if (demand.activeUser === 1) {
    out.push({
      scope: "installation",
      resource: "active_users",
      used: usage.installation.activeUsersPerDay,
      requested: 1,
      limit: limits.installation.activeUsersPerDay,
    });
  }
  return out;
}

/** Empty usage snapshot for tests and fresh windows. */
export function emptyQuotaUsage(): QuotaUsage {
  return {
    user: {
      concurrentTurns: 0,
      dailyModelTokens: 0,
      dailyToolCalls: 0,
      dailyProactiveMessages: 0,
      storageBytes: 0,
      sandboxActiveSecondsPerDay: 0,
    },
    installation: {
      concurrentTurns: 0,
      dailyModelTokens: 0,
      activeUsersPerDay: 0,
    },
  };
}

async function decodeUsage(usage: QuotaUsage) {
  try {
    const decoded = await quotaUsageStruct.parseAsync(usage);
    return {
      user: { ...decoded.user },
      installation: { ...decoded.installation },
    };
  } catch {
    throw new QuotaAdmissionError({ reason: "invalid_input" });
  }
}

async function decodeDemand(demand: QuotaDemand) {
  try {
    const decoded = await quotaDemandStruct.parseAsync(demand);
    return { ...decoded };
  } catch {
    throw new QuotaAdmissionError({ reason: "invalid_input" });
  }
}

/** Fail closed when any demanded resource would exceed its Release-1 limit. */
export const admitQuota = async function (
  usage: QuotaUsage,
  demand: QuotaDemand,
  limits: Release1QuotaLimits = admissionLimitsForPlan()
) {
  const decodedUsage = await decodeUsage(usage);
  const decodedDemand = await decodeDemand(demand);
  for (const check of checks(limits, decodedUsage, decodedDemand)) {
    if (check.used + check.requested > check.limit) {
      throw new QuotaAdmissionError({
        reason: "exceeded",
        scope: check.scope,
        resource: check.resource,
        limit: check.limit,
        used: check.used,
        requested: check.requested,
      });
    }
  }
  return decodedDemand;
};

/**
 * Apply a reserved demand to a usage snapshot after a successful admit.
 * Concurrent turns and model tokens increment both user and installation.
 */
export function reserveQuota(
  usage: QuotaUsage,
  demand: QuotaDemand
): QuotaUsage {
  const concurrentTurns = demand.concurrentTurns ?? 0;
  const modelTokens = demand.modelTokens ?? 0;
  const toolCalls = demand.toolCalls ?? 0;
  const proactiveMessages = demand.proactiveMessages ?? 0;
  const storageBytes = demand.storageBytes ?? 0;
  const sandboxSeconds = demand.sandboxSeconds ?? 0;
  const activeUser = demand.activeUser === 1 ? 1 : 0;
  return {
    user: {
      concurrentTurns: usage.user.concurrentTurns + concurrentTurns,
      dailyModelTokens: usage.user.dailyModelTokens + modelTokens,
      dailyToolCalls: usage.user.dailyToolCalls + toolCalls,
      dailyProactiveMessages:
        usage.user.dailyProactiveMessages + proactiveMessages,
      storageBytes: usage.user.storageBytes + storageBytes,
      sandboxActiveSecondsPerDay:
        usage.user.sandboxActiveSecondsPerDay + sandboxSeconds,
    },
    installation: {
      concurrentTurns: usage.installation.concurrentTurns + concurrentTurns,
      dailyModelTokens: usage.installation.dailyModelTokens + modelTokens,
      activeUsersPerDay: usage.installation.activeUsersPerDay + activeUser,
    },
  };
}

/** Release a prior concurrent-turn reservation (never below zero). */
export function settleConcurrentTurns(
  usage: QuotaUsage,
  turns: number
): QuotaUsage {
  const release = Math.max(0, turns);
  return {
    user: {
      ...usage.user,
      concurrentTurns: Math.max(0, usage.user.concurrentTurns - release),
    },
    installation: {
      ...usage.installation,
      concurrentTurns: Math.max(
        0,
        usage.installation.concurrentTurns - release
      ),
    },
  };
}
