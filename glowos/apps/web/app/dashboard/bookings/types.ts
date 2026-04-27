export type BookingStatus =
  | "pending"
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show";

export type PaymentMethod = "cash" | "card" | "paynow" | "other";

export interface ServiceOption {
  id: string;
  name: string;
  priceSgd: string;
  durationMinutes: number;
  bufferMinutes: number;
  /** Pre-treatment minutes owned by the secondary staff (prep). 0 = no split. */
  preBufferMinutes?: number;
  /** Post-treatment minutes owned by the secondary staff (cleanup). 0 = no split. */
  postBufferMinutes?: number;
}

export interface StaffOption {
  id: string;
  name: string;
  /** Service IDs this staff member is credentialed to perform. Empty = none. */
  serviceIds: string[];
  /** Display title (e.g. "Senior Therapist"). Optional — not all endpoints return it. */
  title?: string | null;
  /** True when the staff member is currently active. Defaults to true if absent. */
  isActive?: boolean;
}

export interface PendingPackageSession {
  id: string;
  clientPackageId: string;
  serviceId: string;
  sessionNumber: number;
}

export interface ActivePackage {
  id: string;
  packageName: string;
  sessionsTotal: number;
  sessionsUsed: number;
  expiresAt: string;
  pendingSessions: PendingPackageSession[];
}

export interface DayBooking {
  id: string;
  staffId: string;
  startTime: string;
  endTime: string;
  status: BookingStatus;
}

export interface ServiceRowState {
  /** UUID from the backend; absent for new rows added during edit */
  bookingId?: string;
  serviceId: string;
  staffId: string;
  /**
   * Optional secondary staff that owns the pre/post buffer windows for this
   * row. Null means the primary covers the whole slot (legacy behaviour).
   * Only meaningful when the row's service has pre/post buffers configured.
   */
  secondaryStaffId?: string | null;
  startTime: string; // ISO
  priceSgd: string;
  priceTouched: boolean; // true if user edited the price directly
  usePackage?: { clientPackageId: string; sessionId: string };
  useNewPackage?: boolean;
}

export interface EditContextResponse {
  booking: {
    id: string;
    status: BookingStatus;
    groupId: string | null;
    clientId: string;
    serviceId: string;
    staffId: string;
    secondaryStaffId: string | null;
    startTime: string;
    endTime: string;
    priceSgd: string;
    clientNotes: string | null;
    paymentMethod: string | null;
    discountSgd: string;
    loyaltyPointsRedeemed: number;
    loyaltyRedemptionTxId: string | null;
  };
  group: {
    id: string;
    paymentMethod: PaymentMethod;
    notes: string | null;
    totalPriceSgd: string;
  } | null;
  client: { id: string; name: string | null; phone: string; profileId: string | null };
  siblingBookings: Array<{
    booking: EditContextResponse["booking"];
    service?: { id: string; name: string };
    staff?: { id: string; name: string };
  }>;
  activePackages: ActivePackage[];
  services: ServiceOption[];
  staff: StaffOption[];
  lastEdit: {
    createdAt: string;
    editedByUserId: string;
    fieldName: string;
  } | null;
}

export interface SoldPackageTemplate {
  id: string;
  name: string;
  priceSgd: string;
  includedServices: Array<{ serviceId: string; serviceName: string; quantity: number }>;
}
