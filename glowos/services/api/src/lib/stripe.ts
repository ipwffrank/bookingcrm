import Stripe from "stripe";
import { config } from "./config.js";

// ─── Stripe client ─────────────────────────────────────────────────────────────

export const stripe = new Stripe(config.stripeSecretKey, {
  apiVersion: "2024-06-20",
});
