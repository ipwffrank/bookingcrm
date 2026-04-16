/**
 * Hono context variable definitions.
 * Used to type c.set() / c.get() across all routes and middleware.
 */
export type AppVariables = {
  userId: string;
  merchantId?: string;
  userRole: string;
  groupId?: string;
  staffId?: string;  // set for staff role tokens
  body: unknown;
};
