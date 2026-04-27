// Loyalty Points MVP — per-merchant program with auto-earn + manual adjust + redeem.
// Owner+manager gate for all writes. Clinician has read access to client balance.
// Staff role: read balance via drawer but no writes — enforced per-endpoint below.
import { Hono } from "hono";
import { and, eq, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { db, loyaltyPrograms, loyaltyTransactions, merchantUsers, clientProfiles } from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import type { AppVariables } from "../lib/types.js";

// ─── Routers ───────────────────────────────────────────────────────────────────

// /merchant/loyalty/...
export const loyaltyProgramRouter = new Hono<{ Variables: AppVariables }>();

// /merchant/clients/:profileId/loyalty
export const loyaltyClientRouter = new Hono<{ Variables: AppVariables }>();

// ─── Default program shape (returned when no DB row exists yet) ───────────────

const DEFAULT_PROGRAM = {
  id: null,
  enabled: false,
  pointsPerDollar: 1,
  pointsPerVisit: 0,
  pointsPerDollarRedeem: 100,
  minRedeemPoints: 100,
  earnExpiryMonths: 0,
};

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const programUpdateSchema = z.object({
  enabled: z.boolean(),
  pointsPerDollar: z.number().int().min(0).max(100),
  pointsPerVisit: z.number().int().min(0).max(1000),
  pointsPerDollarRedeem: z.number().int().min(1).max(10000),
  minRedeemPoints: z.number().int().min(0).max(100000),
  earnExpiryMonths: z.number().int().min(0).max(60),
}).strict();

const adjustSchema = z.object({
  amount: z.number().int().refine((v) => v !== 0, { message: "amount must not be zero" }),
  reason: z.string().min(1, "reason is required").max(500),
}).strict();

const redeemSchema = z.object({
  points: z.number().int().positive("points must be positive"),
}).strict();

// ─── Helper: compute balance for (merchantId, clientId) ──────────────────────

async function getBalance(merchantId: string, clientId: string): Promise<number> {
  const [row] = await db
    .select({ balance: sql<string>`coalesce(sum(${loyaltyTransactions.amount}), 0)` })
    .from(loyaltyTransactions)
    .where(
      and(
        eq(loyaltyTransactions.merchantId, merchantId),
        eq(loyaltyTransactions.clientId, clientId),
      ),
    )
    .limit(1);
  return Number(row?.balance ?? 0);
}

// ─── GET /merchant/loyalty/program ────────────────────────────────────────────

loyaltyProgramRouter.get("/program", requireMerchant, async (c) => {
  const role = c.get("userRole");
  if (!role || !["owner", "manager", "clinician"].includes(role)) {
    return c.json({ error: "Forbidden", message: "Owner or manager only" }, 403);
  }

  const merchantId = c.get("merchantId")!;

  const [program] = await db
    .select()
    .from(loyaltyPrograms)
    .where(eq(loyaltyPrograms.merchantId, merchantId))
    .limit(1);

  return c.json({ program: program ?? { ...DEFAULT_PROGRAM, merchantId } });
});

// ─── PUT /merchant/loyalty/program ────────────────────────────────────────────

loyaltyProgramRouter.put(
  "/program",
  requireMerchant,
  zValidator(programUpdateSchema),
  async (c) => {
    const role = c.get("userRole");
    if (!role || role !== "owner") {
      return c.json({ error: "Forbidden", message: "Owner only" }, 403);
    }

    const merchantId = c.get("merchantId")!;
    const body = c.get("body") as z.infer<typeof programUpdateSchema>;
    const now = new Date();

    const [row] = await db
      .insert(loyaltyPrograms)
      .values({
        merchantId,
        enabled: body.enabled,
        pointsPerDollar: body.pointsPerDollar,
        pointsPerVisit: body.pointsPerVisit,
        pointsPerDollarRedeem: body.pointsPerDollarRedeem,
        minRedeemPoints: body.minRedeemPoints,
        earnExpiryMonths: body.earnExpiryMonths,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [loyaltyPrograms.merchantId],
        set: {
          enabled: body.enabled,
          pointsPerDollar: body.pointsPerDollar,
          pointsPerVisit: body.pointsPerVisit,
          pointsPerDollarRedeem: body.pointsPerDollarRedeem,
          minRedeemPoints: body.minRedeemPoints,
          earnExpiryMonths: body.earnExpiryMonths,
          updatedAt: now,
        },
      })
      .returning();

    return c.json({ program: row });
  },
);

// ─── GET /merchant/clients/:profileId/loyalty ─────────────────────────────────

loyaltyClientRouter.get("/:profileId/loyalty", requireMerchant, async (c) => {
  const role = c.get("userRole");
  if (!role || !["owner", "manager", "clinician"].includes(role)) {
    return c.json({ error: "Forbidden", message: "Manager, owner, or clinician access required" }, 403);
  }

  const merchantId = c.get("merchantId")!;
  const profileId = c.req.param("profileId")!;

  // Resolve profile → clientId
  const [profile] = await db
    .select({ clientId: clientProfiles.clientId })
    .from(clientProfiles)
    .where(
      and(
        eq(clientProfiles.id, profileId),
        eq(clientProfiles.merchantId, merchantId),
      ),
    )
    .limit(1);

  if (!profile) {
    return c.json({ error: "Not Found", message: "Client profile not found" }, 404);
  }

  const clientId = profile.clientId;

  const [program] = await db
    .select()
    .from(loyaltyPrograms)
    .where(eq(loyaltyPrograms.merchantId, merchantId))
    .limit(1);

  const balance = await getBalance(merchantId, clientId);

  const recentTransactions = await db
    .select()
    .from(loyaltyTransactions)
    .where(
      and(
        eq(loyaltyTransactions.merchantId, merchantId),
        eq(loyaltyTransactions.clientId, clientId),
      ),
    )
    .orderBy(desc(loyaltyTransactions.createdAt))
    .limit(50);

  return c.json({
    balance,
    program: program ?? { ...DEFAULT_PROGRAM, merchantId },
    recentTransactions,
  });
});

// ─── POST /merchant/clients/:profileId/loyalty/adjust ─────────────────────────

loyaltyClientRouter.post(
  "/:profileId/loyalty/adjust",
  requireMerchant,
  zValidator(adjustSchema),
  async (c) => {
    const role = c.get("userRole");
    if (!role || !["owner", "manager"].includes(role)) {
      return c.json({ error: "Forbidden", message: "Owner or manager only" }, 403);
    }

    const merchantId = c.get("merchantId")!;
    const userId = c.get("userId")!;
    const profileId = c.req.param("profileId")!;
    const body = c.get("body") as z.infer<typeof adjustSchema>;

    // Resolve profile → clientId
    const [profile] = await db
      .select({ clientId: clientProfiles.clientId })
      .from(clientProfiles)
      .where(
        and(
          eq(clientProfiles.id, profileId),
          eq(clientProfiles.merchantId, merchantId),
        ),
      )
      .limit(1);

    if (!profile) {
      return c.json({ error: "Not Found", message: "Client profile not found" }, 404);
    }

    // Load actor name for denormalization
    const [actor] = await db
      .select({ name: merchantUsers.name })
      .from(merchantUsers)
      .where(eq(merchantUsers.id, userId))
      .limit(1);

    const [tx] = await db
      .insert(loyaltyTransactions)
      .values({
        merchantId,
        clientId: profile.clientId,
        kind: "adjust",
        amount: body.amount,
        reason: body.reason,
        actorUserId: userId,
        actorName: actor?.name ?? null,
        createdAt: new Date(),
      })
      .returning();

    const newBalance = await getBalance(merchantId, profile.clientId);

    return c.json({ transaction: tx, newBalance });
  },
);

// ─── POST /merchant/clients/:profileId/loyalty/redeem ─────────────────────────

loyaltyClientRouter.post(
  "/:profileId/loyalty/redeem",
  requireMerchant,
  zValidator(redeemSchema),
  async (c) => {
    const role = c.get("userRole");
    if (!role || !["owner", "manager"].includes(role)) {
      return c.json({ error: "Forbidden", message: "Owner or manager only" }, 403);
    }

    const merchantId = c.get("merchantId")!;
    const userId = c.get("userId")!;
    const profileId = c.req.param("profileId")!;
    const body = c.get("body") as z.infer<typeof redeemSchema>;

    // Resolve profile → clientId
    const [profile] = await db
      .select({ clientId: clientProfiles.clientId })
      .from(clientProfiles)
      .where(
        and(
          eq(clientProfiles.id, profileId),
          eq(clientProfiles.merchantId, merchantId),
        ),
      )
      .limit(1);

    if (!profile) {
      return c.json({ error: "Not Found", message: "Client profile not found" }, 404);
    }

    // Load program
    const [program] = await db
      .select()
      .from(loyaltyPrograms)
      .where(eq(loyaltyPrograms.merchantId, merchantId))
      .limit(1);

    if (!program || !program.enabled) {
      return c.json({ error: "Conflict", message: "Loyalty program is not enabled" }, 409);
    }

    if (body.points < program.minRedeemPoints) {
      return c.json(
        {
          error: "Conflict",
          message: `Minimum redemption is ${program.minRedeemPoints} points`,
        },
        409,
      );
    }

    const balance = await getBalance(merchantId, profile.clientId);

    if (body.points > balance) {
      return c.json(
        {
          error: "Conflict",
          message: `Insufficient balance. Have ${balance} points, requested ${body.points}`,
        },
        409,
      );
    }

    // Calculate SGD value
    const sgdValue = (body.points / program.pointsPerDollarRedeem).toFixed(2);

    // Load actor name
    const [actor] = await db
      .select({ name: merchantUsers.name })
      .from(merchantUsers)
      .where(eq(merchantUsers.id, userId))
      .limit(1);

    const [tx] = await db
      .insert(loyaltyTransactions)
      .values({
        merchantId,
        clientId: profile.clientId,
        kind: "redeem",
        amount: -body.points,
        redeemedSgd: sgdValue,
        reason: `Redeemed ${body.points} points for SGD ${sgdValue} off`,
        actorUserId: userId,
        actorName: actor?.name ?? null,
        createdAt: new Date(),
      })
      .returning();

    const newBalance = await getBalance(merchantId, profile.clientId);

    return c.json({
      transaction: tx,
      pointsRedeemed: body.points,
      sgdValue,
      newBalance,
    });
  },
);
