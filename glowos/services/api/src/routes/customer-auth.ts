import { Hono } from "hono";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { OAuth2Client } from "google-auth-library";
import { db, clients, clientProfiles, merchants } from "@glowos/db";
import { zValidator } from "../middleware/validate.js";
import { config } from "../lib/config.js";
import { generateVerificationToken } from "../lib/jwt.js";
import type { AppVariables } from "../lib/types.js";

const customerAuthRouter = new Hono<{ Variables: AppVariables }>();

// ─── Schemas ───────────────────────────────────────────────────────────────────

const googleAuthSchema = z.object({
  credential: z.string().min(1, "Google credential is required"),
  slug: z.string().min(1, "Business slug is required"),
});

const lookupSchema = z.object({
  google_id: z.string().min(1),
  slug: z.string().min(1),
});

// ─── POST /customer-auth/google ──────────────────────────────────────────────
// Verify Google ID token, find or create client, return client info

customerAuthRouter.post("/google", zValidator(googleAuthSchema), async (c) => {
  const body = c.get("body") as z.infer<typeof googleAuthSchema>;

  if (!config.googleClientId) {
    return c.json(
      { error: "Configuration Error", message: "Google Sign-In is not configured" },
      503
    );
  }

  // Verify the Google ID token
  const oauth2Client = new OAuth2Client(config.googleClientId);
  let payload;
  try {
    const ticket = await oauth2Client.verifyIdToken({
      idToken: body.credential,
      audience: config.googleClientId,
    });
    payload = ticket.getPayload();
  } catch {
    return c.json(
      { error: "Unauthorized", message: "Invalid Google credential" },
      401
    );
  }

  if (!payload || !payload.sub) {
    return c.json(
      { error: "Unauthorized", message: "Could not verify Google identity" },
      401
    );
  }

  const googleId = payload.sub;
  const googleEmail = payload.email ?? null;
  const googleName = payload.name ?? null;
  const googleAvatar = payload.picture ?? null;

  // Resolve merchant from slug
  const [merchant] = await db
    .select({ id: merchants.id })
    .from(merchants)
    .where(eq(merchants.slug, body.slug))
    .limit(1);

  if (!merchant) {
    return c.json({ error: "Not Found", message: "Business not found" }, 404);
  }

  // Try to find existing client by google_id first, then by email
  let client;

  const [byGoogleId] = await db
    .select()
    .from(clients)
    .where(eq(clients.googleId, googleId))
    .limit(1);

  if (byGoogleId) {
    client = byGoogleId;
    // Update avatar if changed
    if (googleAvatar && client.avatarUrl !== googleAvatar) {
      await db
        .update(clients)
        .set({ avatarUrl: googleAvatar })
        .where(eq(clients.id, client.id));
    }
  } else if (googleEmail) {
    // Try finding by email
    const [byEmail] = await db
      .select()
      .from(clients)
      .where(eq(clients.email, googleEmail))
      .limit(1);

    if (byEmail) {
      // Link Google account to existing client
      client = byEmail;
      await db
        .update(clients)
        .set({
          googleId,
          avatarUrl: googleAvatar ?? client.avatarUrl,
          name: client.name || googleName,
        })
        .where(eq(clients.id, client.id));
    }
  }

  if (!client) {
    // Create new client — phone is empty for now (will be filled at booking).
    // Use a placeholder to satisfy the NOT NULL + UNIQUE constraint on
    // `clients.phone`. Google `sub` IDs are typically 21 digits, so the
    // naive `google_<sub>` placeholder is ~28 chars — exceeds the
    // varchar(20) phone column and causes a 500 (Postgres 22001 error).
    // Take the last 13 digits of the sub (still effectively unique across
    // ~10^13 IDs) and prefix with "g_" to produce a 15-char placeholder
    // that fits and stays uniquely tied to the Google account.
    const placeholderPhone = `g_${googleId.slice(-13)}`;
    const [created] = await db
      .insert(clients)
      .values({
        phone: placeholderPhone,
        email: googleEmail,
        name: googleName,
        googleId,
        avatarUrl: googleAvatar,
        acquisitionSource: "social",
      })
      .returning();

    if (!created) {
      return c.json(
        { error: "Internal Server Error", message: "Failed to create client" },
        500
      );
    }
    client = created;
  }

  // Ensure client profile exists for this merchant
  const [existingProfile] = await db
    .select({ id: clientProfiles.id })
    .from(clientProfiles)
    .where(
      and(
        eq(clientProfiles.merchantId, merchant.id),
        eq(clientProfiles.clientId, client.id)
      )
    )
    .limit(1);

  if (!existingProfile) {
    await db.insert(clientProfiles).values({
      merchantId: merchant.id,
      clientId: client.id,
    });
  }

  // Return client info for the frontend to auto-fill the form
  const verificationToken = generateVerificationToken(
    {
      phone: client.phone?.startsWith("g_") ? null : client.phone,
      email: client.email,
      google_id: client.googleId,
      purpose: "google_verify",
      verified_at: Math.floor(Date.now() / 1000),
    },
    1800 // 30-min TTL for Google sessions
  );

  return c.json({
    client: {
      id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone?.startsWith("g_") ? "" : client.phone,
      avatarUrl: client.avatarUrl ?? googleAvatar,
      googleId: client.googleId,
    },
    is_returning: !!existingProfile,
    verification_token: verificationToken,
  });
});

// ─── POST /customer-auth/lookup ──────────────────────────────────────────────
// Look up a customer by google_id (for returning visitors via stored session)

customerAuthRouter.post("/lookup", zValidator(lookupSchema), async (c) => {
  const body = c.get("body") as z.infer<typeof lookupSchema>;

  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.googleId, body.google_id))
    .limit(1);

  if (!client) {
    return c.json({ error: "Not Found", message: "Client not found" }, 404);
  }

  return c.json({
    client: {
      id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone?.startsWith("g_") ? "" : client.phone,
      avatarUrl: client.avatarUrl,
      googleId: client.googleId,
    },
  });
});

export { customerAuthRouter };
