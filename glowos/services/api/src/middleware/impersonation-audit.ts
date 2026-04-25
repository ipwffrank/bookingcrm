import type { Context, Next } from "hono";
import { db, superAdminAuditLog } from "@glowos/db";
import type { AppVariables } from "../lib/types.js";

type AppContext = Context<{ Variables: AppVariables }>;

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Auto-logs every write performed while a superadmin is impersonating a
 * merchant. Runs the handler first via next() so requireMerchant has had a
 * chance to set the impersonating flag and we can capture the final status.
 * Insert failures are swallowed — an audit outage must never break a write.
 */
export async function auditImpersonatedWrites(c: AppContext, next: Next) {
  const method = c.req.method;
  const path = c.req.path;
  const isWrite = WRITE_METHODS.has(method);
  const isMerchantPath = path === "/merchant" || path.startsWith("/merchant/");

  let thrown: unknown = undefined;
  try {
    await next();
  } catch (e) {
    thrown = e;
  }

  if (isWrite && isMerchantPath) {
    const impersonating = c.get("impersonating");
    const actorEmail = c.get("actorEmail");
    const actorUserId = c.get("actorUserId");
    const targetMerchantId = c.get("merchantId");
    const status = c.res?.status;

    // Diagnostic line: log every write that flows through this middleware so
    // Railway logs reveal whether the middleware fires + whether the
    // impersonating flag was set on the context. Remove once the audit-write
    // pipeline is confirmed working in production.
    console.log(
      `[impersonation-audit] ${method} ${path} status=${status} impersonating=${!!impersonating} actorEmail=${actorEmail ?? "(none)"} merchantId=${targetMerchantId ?? "(none)"}`,
    );

    if (impersonating && actorEmail) {
      try {
        await db.insert(superAdminAuditLog).values({
          actorUserId: actorUserId ?? null,
          actorEmail,
          action: "write",
          targetMerchantId: targetMerchantId ?? null,
          method,
          path,
          metadata: { status },
        });
      } catch (err) {
        console.error("[impersonation-audit] failed to log write", err);
      }
    }
  }

  if (thrown) throw thrown;
}
