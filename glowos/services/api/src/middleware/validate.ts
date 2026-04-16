import type { Context, Next } from "hono";
import type { ZodSchema, ZodError } from "zod";
import type { AppVariables } from "../lib/types.js";

type AppContext = Context<{ Variables: AppVariables }>;

/**
 * Zod validation middleware for Hono.
 * Parses and validates the request JSON body against the provided schema.
 * On failure returns HTTP 400 with structured field errors.
 * On success, stores the parsed data at c.set("body", ...) and calls next().
 */
export function zValidator<T>(schema: ZodSchema<T>) {
  return async function (c: AppContext, next: Next) {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "Bad Request", message: "Request body must be valid JSON" }, 400);
    }

    const result = schema.safeParse(raw);

    if (!result.success) {
      const zodErr = result.error as ZodError;
      const errors = zodErr.errors.map((e) => ({
        path: e.path.join("."),
        message: e.message,
      }));
      return c.json({ error: "Validation Error", message: zodErr.errors.map(e => e.message).join(', '), errors }, 400);
    }

    c.set("body", result.data);
    await next();
  };
}
