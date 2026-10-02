import { describe, expect, it } from "vitest";
import {
  admitQuota,
  emptyQuotaUsage,
  quotaFailureMessage,
  admissionLimitsForPlan,
  release1QuotaLimits,
  reserveQuota,
  settleConcurrentTurns,
  settleQuota,
  type QuotaDemand,
  type QuotaUsage,
  QuotaAdmissionError,
} from "./quotas";
describe("Release-1 minimum quota admission", () => {
  it("bridges hosted Free entitlements to Release-1 floors", () => {
    expect(admissionLimitsForPlan("free")).toEqual(release1QuotaLimits);
    expect(admissionLimitsForPlan("pro").user.dailyModelTokens).toBeGreaterThan(
      release1QuotaLimits.user.dailyModelTokens
    );
  });
  it("documents the chosen self-host limits", () => {
    expect(release1QuotaLimits).toEqual({
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
    });
  });
  it("admits work within limits and reserves usage", async () => {
    const usage = emptyQuotaUsage();
    const demand = {
      concurrentTurns: 1,
      modelTokens: 1_000,
      activeUser: 1 as const,
    };
    await expect(admitQuota(usage, demand)).resolves.toEqual(demand);
    const reserved = reserveQuota(usage, demand);
    expect(reserved.user.concurrentTurns).toBe(1);
    expect(reserved.installation.concurrentTurns).toBe(1);
    expect(reserved.user.dailyModelTokens).toBe(1_000);
    expect(reserved.installation.activeUsersPerDay).toBe(1);
  });
  it("fails closed when a user exceeds concurrent turns", async () => {
    const usage = withUser({
      concurrentTurns: 2,
    });
    const error = await Promise.try(async () =>
      admitQuota(usage, {
        concurrentTurns: 1,
      })
    ).then(
      () => {
        throw new Error("Expected rejection");
      },
      (cause: unknown) => {
        if (cause instanceof QuotaAdmissionError) return cause;
        throw cause;
      }
    );
    expect(error).toEqual(
      new QuotaAdmissionError({
        reason: "exceeded",
        scope: "user",
        resource: "concurrent_turns",
        limit: 2,
        used: 2,
        requested: 1,
      })
    );
    expect(quotaFailureMessage(error)).toContain("concurrent turns");
  });
  it("fails closed when installation concurrent turns would starve fairness", async () => {
    const usage = emptyQuotaUsage();
    usage.installation.concurrentTurns =
      release1QuotaLimits.installation.concurrentTurns;
    const error = await Promise.try(async () =>
      admitQuota(usage, {
        concurrentTurns: 1,
      })
    ).then(
      () => {
        throw new Error("Expected rejection");
      },
      (cause: unknown) => {
        if (cause instanceof QuotaAdmissionError) return cause;
        throw cause;
      }
    );
    expect(error).toMatchObject({
      reason: "exceeded",
      scope: "installation",
      resource: "concurrent_turns",
      limit: release1QuotaLimits.installation.concurrentTurns,
    });
  });
  it("fails closed on daily model-token exhaustion (user then installation)", async () => {
    const atUserCap = withUser({
      dailyModelTokens: release1QuotaLimits.user.dailyModelTokens,
    });
    await expect(
      Promise.try(async () =>
        admitQuota(atUserCap, {
          modelTokens: 1,
        })
      ).then(
        () => {
          throw new Error("Expected rejection");
        },
        (error: unknown) => {
          if (error instanceof QuotaAdmissionError) return error;
          throw error;
        }
      )
    ).resolves.toMatchObject({
      reason: "exceeded",
      scope: "user",
      resource: "model_tokens",
    });
    const atInstallCap = emptyQuotaUsage();
    atInstallCap.installation.dailyModelTokens =
      release1QuotaLimits.installation.dailyModelTokens;
    await expect(
      Promise.try(async () =>
        admitQuota(atInstallCap, {
          modelTokens: 1,
        })
      ).then(
        () => {
          throw new Error("Expected rejection");
        },
        (error: unknown) => {
          if (error instanceof QuotaAdmissionError) return error;
          throw error;
        }
      )
    ).resolves.toMatchObject({
      reason: "exceeded",
      scope: "installation",
      resource: "model_tokens",
    });
  });
  it("enforces tool, proactive, storage, sandbox and active-user caps", async () => {
    await expect(
      Promise.try(async () =>
        admitQuota(
          withUser({
            dailyToolCalls: 200,
          }),
          {
            toolCalls: 1,
          }
        )
      ).then(
        () => {
          throw new Error("Expected rejection");
        },
        (error: unknown) => {
          if (error instanceof QuotaAdmissionError) return error;
          throw error;
        }
      )
    ).resolves.toMatchObject({
      resource: "tool_calls",
      reason: "exceeded",
    });
    await expect(
      Promise.try(async () =>
        admitQuota(
          withUser({
            dailyProactiveMessages: 24,
          }),
          {
            proactiveMessages: 1,
          }
        )
      ).then(
        () => {
          throw new Error("Expected rejection");
        },
        (error: unknown) => {
          if (error instanceof QuotaAdmissionError) return error;
          throw error;
        }
      )
    ).resolves.toMatchObject({
      resource: "proactive_messages",
      reason: "exceeded",
    });
    await expect(
      Promise.try(async () =>
        admitQuota(
          withUser({
            storageBytes: 100 * 1024 * 1024,
          }),
          {
            storageBytes: 1,
          }
        )
      ).then(
        () => {
          throw new Error("Expected rejection");
        },
        (error: unknown) => {
          if (error instanceof QuotaAdmissionError) return error;
          throw error;
        }
      )
    ).resolves.toMatchObject({
      resource: "storage_bytes",
      reason: "exceeded",
    });
    await expect(
      Promise.try(async () =>
        admitQuota(
          withUser({
            sandboxActiveSecondsPerDay: 900,
          }),
          {
            sandboxSeconds: 1,
          }
        )
      ).then(
        () => {
          throw new Error("Expected rejection");
        },
        (error: unknown) => {
          if (error instanceof QuotaAdmissionError) return error;
          throw error;
        }
      )
    ).resolves.toMatchObject({
      resource: "sandbox_seconds",
      reason: "exceeded",
    });
    const usage = emptyQuotaUsage();
    usage.installation.activeUsersPerDay = 100;
    await expect(
      Promise.try(async () =>
        admitQuota(usage, {
          activeUser: 1,
        })
      ).then(
        () => {
          throw new Error("Expected rejection");
        },
        (error: unknown) => {
          if (error instanceof QuotaAdmissionError) return error;
          throw error;
        }
      )
    ).resolves.toMatchObject({
      resource: "active_users",
      reason: "exceeded",
    });
  });
  it("settles concurrent-turn reservations and rejects over-release", () => {
    const reserved = reserveQuota(emptyQuotaUsage(), {
      concurrentTurns: 2,
    });
    const settled = settleConcurrentTurns(reserved, 2);
    expect(settled.user.concurrentTurns).toBe(0);
    expect(settled.installation.concurrentTurns).toBe(0);
    expect(() => settleConcurrentTurns(settled, 5)).toThrow(
      new QuotaAdmissionError({ reason: "invalid_input" })
    );
  });
  it("rejects invalid usage snapshots as typed quota errors", async () => {
    await expect(
      Promise.try(async () =>
        admitQuota(
          {
            ...emptyQuotaUsage(),
            user: {
              ...emptyQuotaUsage().user,
              concurrentTurns: -1,
            },
          },
          {
            concurrentTurns: 1,
          }
        )
      ).then(
        () => {
          throw new Error("Expected rejection");
        },
        (error: unknown) => {
          if (error instanceof QuotaAdmissionError) return error;
          throw error;
        }
      )
    ).resolves.toEqual(
      new QuotaAdmissionError({
        reason: "invalid_input",
      })
    );
  });
  it("allows exact fill up to the limit but not beyond", async () => {
    const usage = withUser({
      dailyToolCalls: 199,
    });
    await expect(
      admitQuota(usage, {
        toolCalls: 1,
      })
    ).resolves.toEqual({
      toolCalls: 1,
    });
    await expect(
      Promise.try(async () =>
        admitQuota(usage, {
          toolCalls: 2,
        })
      ).then(
        () => {
          throw new Error("Expected rejection");
        },
        (error: unknown) => {
          if (error instanceof QuotaAdmissionError) return error;
          throw error;
        }
      )
    ).resolves.toMatchObject({
      reason: "exceeded",
      used: 199,
      requested: 2,
    });
  });
});
function withUser(partial: Partial<QuotaUsage["user"]>): QuotaUsage {
  const usage = emptyQuotaUsage();
  usage.user = {
    ...usage.user,
    ...partial,
  };
  return usage;
}

describe("quota arithmetic validation", () => {
  it("rejects a negative reservation instead of reducing spent tokens", () => {
    expect(() =>
      reserveQuota(withUser({ dailyModelTokens: 50 }), { modelTokens: -1 })
    ).toThrow(new QuotaAdmissionError({ reason: "invalid_input" }));
  });
  it("rejects a non-finite concurrent release", () => {
    const usage = reserveQuota(emptyQuotaUsage(), { concurrentTurns: 1 });
    expect(() => settleConcurrentTurns(usage, Number.NaN)).toThrow(
      new QuotaAdmissionError({ reason: "invalid_input" })
    );
  });
  it("rejects release beyond the reserved snapshot instead of clamping", () => {
    const usage = reserveQuota(emptyQuotaUsage(), { concurrentTurns: 1 });
    expect(() => settleConcurrentTurns(usage, 2)).toThrow(
      new QuotaAdmissionError({ reason: "invalid_input" })
    );
  });
});

describe("confirmed quota settlement", () => {
  it("replaces estimates with partial consumption while preserving other allocations", () => {
    const existing = reserveQuota(emptyQuotaUsage(), {
      concurrentTurns: 1,
      modelTokens: 40,
      toolCalls: 3,
      proactiveMessages: 1,
      storageBytes: 13,
      sandboxSeconds: 6,
      activeUser: 1,
    });
    const demand = {
      concurrentTurns: 2,
      modelTokens: 1_000,
      toolCalls: 5,
      proactiveMessages: 2,
      storageBytes: 80,
      sandboxSeconds: 30,
      activeUser: 1 as const,
    };
    const usage = reserveQuota(existing, demand);
    const consumption = {
      modelTokens: 700,
      toolCalls: 2,
      proactiveMessages: 1,
      storageBytes: 60,
      sandboxSeconds: 10,
      activeUser: 1 as const,
    };
    const before = structuredClone({ usage, demand, consumption });
    Object.freeze(usage.user);
    Object.freeze(usage.installation);
    Object.freeze(usage);
    Object.freeze(demand);
    Object.freeze(consumption);

    const settled = settleQuota(usage, demand, consumption);
    expect(settled).toEqual({
      user: {
        concurrentTurns: 1,
        dailyModelTokens: 740,
        dailyToolCalls: 5,
        dailyProactiveMessages: 2,
        storageBytes: 73,
        sandboxActiveSecondsPerDay: 16,
      },
      installation: {
        concurrentTurns: 1,
        dailyModelTokens: 740,
        activeUsersPerDay: 2,
      },
    });
    expect({ usage, demand, consumption }).toEqual(before);
    expect(settled.user).not.toBe(usage.user);
    expect(settled.installation).not.toBe(usage.installation);
  });

  it("releases all estimates only with explicit confirmed zero contributions", () => {
    const demand = {
      concurrentTurns: 1,
      modelTokens: 100,
      toolCalls: 1,
      proactiveMessages: 1,
      storageBytes: 50,
      sandboxSeconds: 5,
      activeUser: 1 as const,
    };
    const settled = settleQuota(
      reserveQuota(emptyQuotaUsage(), demand),
      demand,
      {
        modelTokens: 0,
        toolCalls: 0,
        proactiveMessages: 0,
        storageBytes: 0,
        sandboxSeconds: 0,
        activeUser: 0,
      }
    );
    expect(settled).toEqual(emptyQuotaUsage());
  });

  it("releases a concurrency gauge without refunding spent or retained resources", () => {
    const usage = reserveQuota(emptyQuotaUsage(), {
      concurrentTurns: 2,
      modelTokens: 100,
      toolCalls: 1,
      proactiveMessages: 1,
      storageBytes: 50,
      sandboxSeconds: 5,
      activeUser: 1,
    });
    const settled = settleConcurrentTurns(usage, 1);
    expect(settled).toEqual({
      user: { ...usage.user, concurrentTurns: 1 },
      installation: { ...usage.installation, concurrentTurns: 1 },
    });
  });

  it("records actual consumption above the estimate and admission limit", async () => {
    const demand = { concurrentTurns: 1, modelTokens: 100 };
    const actual = release1QuotaLimits.user.dailyModelTokens + 1;
    const settled = settleQuota(
      reserveQuota(emptyQuotaUsage(), demand),
      demand,
      {
        modelTokens: actual,
      }
    );
    expect(settled.user.concurrentTurns).toBe(0);
    expect(settled.installation.concurrentTurns).toBe(0);
    expect(settled.user.dailyModelTokens).toBe(actual);
    expect(settled.installation.dailyModelTokens).toBe(actual);
    await expect(admitQuota(settled, { modelTokens: 1 })).rejects.toMatchObject(
      {
        reason: "exceeded",
        scope: "user",
        resource: "model_tokens",
      }
    );
  });

  it.each([
    "modelTokens",
    "toolCalls",
    "proactiveMessages",
    "storageBytes",
    "sandboxSeconds",
    "activeUser",
  ] as const)(
    "rejects unknown %s instead of treating it as zero",
    (resource) => {
      const demand: QuotaDemand = { [resource]: 1 };
      const usage = reserveQuota(emptyQuotaUsage(), demand);
      expect(() => settleQuota(usage, demand, {})).toThrow(
        new QuotaAdmissionError({ reason: "invalid_input" })
      );
      expect(settleQuota(usage, demand, { [resource]: 0 })).toEqual(
        emptyQuotaUsage()
      );
    }
  );

  it.each(["user", "installation"] as const)(
    "rejects release beyond %s usage before adding actual consumption",
    (scope) => {
      const usage = reserveQuota(emptyQuotaUsage(), { modelTokens: 1 });
      usage[scope].dailyModelTokens = 0;
      expect(() =>
        settleQuota(usage, { modelTokens: 1 }, { modelTokens: 2 })
      ).toThrow(new QuotaAdmissionError({ reason: "invalid_input" }));
    }
  );

  it("rejects a concurrency release exceeding either scope", () => {
    const usage = reserveQuota(emptyQuotaUsage(), { concurrentTurns: 2 });
    usage.installation.concurrentTurns = 1;
    expect(() => settleQuota(usage, { concurrentTurns: 2 }, {})).toThrow(
      new QuotaAdmissionError({ reason: "invalid_input" })
    );
  });

  it("keeps concurrency out of the consumed-resource contract", () => {
    const usage = reserveQuota(emptyQuotaUsage(), { concurrentTurns: 1 });
    const invalidConsumption = { modelTokens: 0, concurrentTurns: 0 };
    expect(() =>
      settleQuota(usage, { concurrentTurns: 1 }, invalidConsumption)
    ).toThrow(new QuotaAdmissionError({ reason: "invalid_input" }));
  });

  it("cannot detect duplicate settlement when another allocation covers the arithmetic", () => {
    const demand = { concurrentTurns: 1, modelTokens: 100 };
    const both = reserveQuota(reserveQuota(emptyQuotaUsage(), demand), demand);
    const consumption = { modelTokens: 40 };
    const once = settleQuota(both, demand, consumption);
    expect(once.user.concurrentTurns).toBe(1);
    expect(once.user.dailyModelTokens).toBe(140);

    // Invalid caller behavior: the aggregate cannot identify an allocation.
    // The durable owner must reject this replay before calling settleQuota.
    const replayed = settleQuota(once, demand, consumption);
    expect(replayed.user.concurrentTurns).toBe(0);
    expect(replayed.user.dailyModelTokens).toBe(80);
  });
});

describe("invalid quota amounts and snapshot arithmetic", () => {
  it.each([
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid amount %s at every arithmetic boundary", (amount) => {
    const usage = reserveQuota(emptyQuotaUsage(), {
      concurrentTurns: 1,
      modelTokens: 1,
    });
    const invalid = new QuotaAdmissionError({ reason: "invalid_input" });
    expect(() => reserveQuota(usage, { modelTokens: amount })).toThrow(invalid);
    expect(() => settleConcurrentTurns(usage, amount)).toThrow(invalid);
    expect(() =>
      settleQuota(usage, { modelTokens: amount }, { modelTokens: 0 })
    ).toThrow(invalid);
    expect(() =>
      settleQuota(usage, { modelTokens: 1 }, { modelTokens: amount })
    ).toThrow(invalid);
  });

  it("rejects a missing required concurrency release amount", () => {
    expect(() => {
      Reflect.apply(settleConcurrentTurns, undefined, [
        emptyQuotaUsage(),
        undefined,
      ]);
    }).toThrow(new QuotaAdmissionError({ reason: "invalid_input" }));
  });

  it.each(["reserve", "settle"] as const)(
    "validates the usage snapshot before %s arithmetic",
    (operation) => {
      const usage = withUser({ storageBytes: -1 });
      expect(() =>
        operation === "reserve"
          ? reserveQuota(usage, { modelTokens: 1 })
          : settleQuota(usage, { modelTokens: 0 }, { modelTokens: 0 })
      ).toThrow(new QuotaAdmissionError({ reason: "invalid_input" }));
    }
  );

  it.each(["user", "installation"] as const)(
    "rejects %s overflow on reservation and settlement",
    (scope) => {
      const usage = emptyQuotaUsage();
      usage[scope].dailyModelTokens = Number.MAX_SAFE_INTEGER;
      expect(() => reserveQuota(usage, { modelTokens: 1 })).toThrow(
        new QuotaAdmissionError({ reason: "invalid_input" })
      );
      expect(() =>
        settleQuota(usage, { modelTokens: 0 }, { modelTokens: 1 })
      ).toThrow(new QuotaAdmissionError({ reason: "invalid_input" }));
    }
  );

  it("rejects invalid active-set contributions", () => {
    const usage = reserveQuota(emptyQuotaUsage(), { activeUser: 1 });
    expect(() => {
      Reflect.apply(reserveQuota, undefined, [usage, { activeUser: 2 }]);
    }).toThrow(new QuotaAdmissionError({ reason: "invalid_input" }));
    expect(() => {
      Reflect.apply(settleQuota, undefined, [
        usage,
        { activeUser: 1 },
        { activeUser: 2 },
      ]);
    }).toThrow(new QuotaAdmissionError({ reason: "invalid_input" }));
  });

  it("rejects unknown demand fields instead of silently losing a reservation", () => {
    const invalidDemand = { concurrentTurns: 0, modelToken: 1 };
    expect(() => reserveQuota(emptyQuotaUsage(), invalidDemand)).toThrow(
      new QuotaAdmissionError({ reason: "invalid_input" })
    );
  });

  it("allows the exact safe-integer boundary without mutating its input", () => {
    const usage = withUser({ storageBytes: Number.MAX_SAFE_INTEGER - 1 });
    const reserved = reserveQuota(usage, { storageBytes: 1 });
    expect(reserved.user.storageBytes).toBe(Number.MAX_SAFE_INTEGER);
    expect(usage.user.storageBytes).toBe(Number.MAX_SAFE_INTEGER - 1);
    expect(
      settleQuota(reserved, { storageBytes: 1 }, { storageBytes: 1 }).user
        .storageBytes
    ).toBe(Number.MAX_SAFE_INTEGER);
  });
});
