/**
 * Hono context variable definitions.
 * Used to type c.set() / c.get() across all routes and middleware.
 */
export type AppVariables = {
  userId: string;
  merchantId?: string;
  userRole: string;
  // Set when merchant_users.secondary_role is non-null. Some staff genuinely
  // hold two roles — e.g. a clinician who is also the firm's manager. When
  // present, role gates (requireRole/requireAdmin/requirePermission) accept
  // the user if EITHER role qualifies — the union of permissions.
  userSecondaryRole?: string;
  groupId?: string;
  staffId?: string;  // set for staff role tokens
  // Superadmin claims forwarded from the JWT for audit + /super/* gating.
  superAdmin?: boolean;
  impersonating?: boolean;
  actorUserId?: string;
  actorEmail?: string;
  // Set when the authenticated merchant_user holds brand-admin authority
  // (merchant_users.brand_admin_group_id). Powers /group/* writes.
  brandAdminGroupId?: string;
  // View-as-branch — set when a brand-admin is previewing a specific branch.
  brandViewing?: boolean;
  homeMerchantId?: string;
  viewingMerchantId?: string;
  body: unknown;
};
