import { Hono } from "hono";
import { requireGroupAdmin } from "../middleware/groupAuth.js";
import type { AppVariables } from "../lib/types.js";

const groupRouter = new Hono<{ Variables: AppVariables }>();

// All group routes require group admin auth
groupRouter.use("*", requireGroupAdmin);

// ─── GET /group/overview ────────────────────────────────────────────────────────
groupRouter.get("/overview", async (c) => {
  return c.json({ message: "TODO: overview" }, 501);
});

// ─── GET /group/branches ────────────────────────────────────────────────────────
groupRouter.get("/branches", async (c) => {
  return c.json({ message: "TODO: branches" }, 501);
});

// ─── GET /group/branches/:merchantId ──────────────────────────────────────────
groupRouter.get("/branches/:merchantId", async (c) => {
  return c.json({ message: "TODO: branch detail" }, 501);
});

// ─── GET /group/clients ─────────────────────────────────────────────────────────
groupRouter.get("/clients", async (c) => {
  return c.json({ message: "TODO: clients" }, 501);
});

export { groupRouter };
