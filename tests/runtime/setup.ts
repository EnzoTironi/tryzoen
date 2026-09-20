import { beforeAll, afterAll, afterEach, vi } from "vitest";
import { requireRuntimeDatabase } from "./database";
import { db } from "@db";

beforeAll(requireRuntimeDatabase);
afterEach(() => vi.restoreAllMocks());
afterAll(() => db.$client.end());
