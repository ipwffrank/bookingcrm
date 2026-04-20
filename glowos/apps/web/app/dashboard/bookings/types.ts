export type BookingStatus =
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
}

export interface StaffOption {
  id: string;
  name: string;
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
  startTime: string; // ISO
  priceSgd: string;
  priceTouched: boolean; // true if user edited the price directly
  usePackage?: { clientPackageId: string; sessionId: string };
}

export interface EditContextResponse {
  booking: {
    id: string;
    status: BookingStatus;
    groupId: string | null;
    clientId: string;
    serviceId: string;
    staffId: string;
    startTime: string;
    endTime: string;
    priceSgd: string;
    clientNotes: string | null;
    paymentMethod: string | null;
  };
  group: {
    id: string;
    paymentMethod: PaymentMethod;
    notes: string | null;
    totalPriceSgd: string;
  } | null;
  client: { id: string; name: string | null; phone: string };
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
