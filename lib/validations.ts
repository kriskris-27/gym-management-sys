import { z } from "zod";
import { coerceStartOfGymCalendarDay } from "@/lib/gym-datetime";

const zodCoerceGymDayRequired = z.preprocess(
  (val) => {
    const d = coerceStartOfGymCalendarDay(val)
    return d ?? val
  },
  z.date()
);

const zodCoerceGymDayOptional = z.preprocess(
  (val) => {
    if (val === undefined || val === null || val === "") return undefined
    const d = coerceStartOfGymCalendarDay(val)
    return d !== null ? d : val
  },
  z.coerce.date().optional()
);

/**
 * Common Security Regex
 */
const PHONE_REGEX = /^[6-9]\d{9}$/;
const NO_HTML_REGEX = /^[^<>'"%;()&]*$/; // Blocks HTML tags, SQL injection chars, and script injection

/**
 * Authentication
 */
export const LoginSchema = z.object({
  username: z.string()
    .trim()
    .min(1, "Username is required")
    .max(50, "Username too long")
    .regex(NO_HTML_REGEX, "Invalid characters in username"),
  password: z.string()
    .min(6, "Password must be at least 6 characters")
    .max(100),
}).strict();

/**
 * Enums from Prisma
 */
export const MembershipTypeEnum = z.enum([
  "MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "ANNUAL",
  "OTHERS",
]);

export const PaymentModeEnum = z.enum(["CASH", "UPI", "CARD"]);

export const MemberStatusEnum = z.enum(["ACTIVE", "INACTIVE", "DELETED"]);

/**
 * Member creation body for POST /api/members.
 * `member.status` is not accepted here — the API derives it from subscriptions after create.
 * Every signup includes a plan + start date (no “shell only” members).
 */
export const MemberCreateSchema = z.object({
  name: z.string()
    .trim()
    .min(1, "Name cannot be empty")
    .max(100, "Name too long")
    .regex(NO_HTML_REGEX, "Name contains invalid characters"),
  phone: z.string()
    .regex(PHONE_REGEX, "Invalid Indian mobile number (Must be 10 digits starting with 6-9)"),
  membershipType: MembershipTypeEnum,
  startDate: zodCoerceGymDayRequired,
  endDate: zodCoerceGymDayOptional,
  discountAmount: z.preprocess(
    (val) => {
      if (val === "" || val === null || val === undefined) return 0
      const num = Number(val)
      return isNaN(num) ? 0 : num
    },
    z.number().min(0, "Discount cannot be negative").max(99999, "Discount too high").default(0)
  ),
  paidAmount: z.preprocess(
    (val) => {
      if (val === "" || val === null || val === undefined) return 0
      const num = Number(val)
      return isNaN(num) ? 0 : num
    },
    z.number().min(0, "Paid amount cannot be negative").max(99999, "Amount too high").default(0)
  ),
  paymentMode: PaymentModeEnum.default("CASH"),
  includeAdmission: z.boolean().optional().default(false),
  manualPlanName: z.string().trim().max(100).optional(),
  manualAmount: z.coerce.number().min(0).max(99999).optional(),
}).strict()
.refine((data) => {
  if (data.endDate && data.startDate && data.endDate <= data.startDate) return false;
  return true;
}, {
  message: "Membership end date must be after the start date",
  path: ["endDate"],
})
.refine((data) => {
  // Hard block for OTHERS if end date is missing
  if (data.membershipType === "OTHERS" && !data.endDate) return false;
  return true;
}, {
  message: "Others membership requires an end date",
  path: ["endDate"],
})
.refine((data) => {
  if (data.membershipType === "OTHERS" && !data.manualPlanName) return false;
  return true;
}, {
  message: "Others membership requires a plan name",
  path: ["manualPlanName"],
})
.refine((data) => {
  if (data.membershipType === "OTHERS" && (data.manualAmount === undefined || data.manualAmount === null)) return false;
  return true;
}, {
  message: "Others membership requires a manual amount",
  path: ["manualAmount"],
});

/**
 * Member Update (Partial updates, id required).
 * Status transitions are lifecycle-only (DELETE/PATCH actions), never generic PUT.
 */
export const MemberUpdateSchema = z.object({
  id: z.string().min(1, "Member ID is required"),
  name: z.string()
    .trim()
    .min(1, "Name cannot be empty")
    .max(100, "Name too long")
    .regex(NO_HTML_REGEX, "Name contains invalid characters")
    .optional(),
  phone: z.string()
    .regex(PHONE_REGEX, "Invalid Indian mobile number")
    .optional(),
  membershipType: MembershipTypeEnum.optional(),
  startDate: zodCoerceGymDayOptional,
  endDate: zodCoerceGymDayOptional,
  discountAmount: z.preprocess(
    (val) => (val === "" || val === null || val === undefined) ? 0 : Number(val),
    z.number().min(0, "Discount cannot be negative").max(99999, "Discount too high").optional()
  ),
  manualPlanName: z.string().trim().max(100).optional(),
  manualAmount: z.coerce.number().min(0).max(99999).optional(),
}).strict()
.refine((data) => {
  if (data.endDate && data.startDate && data.endDate <= data.startDate) return false;
  return true;
}, {
  message: "Membership end date must be after the start date",
  path: ["endDate"],
});


/**
 * Attendance Scanning
 */
export const AttendanceScanSchema = z.object({
  phone: z.string().regex(PHONE_REGEX, "Invalid phone format for scanning"),
}).strict();

/**
 * Payment Creation
 */
export const PaymentCreateSchema = z.object({
  memberId: z.string().min(1, "Member ID is required"),
  amount: z.number()
    .positive("Amount must be a positive number")
    .max(99999, "Amount exceeds maximum transaction limit"),
  date: z.coerce.date()
    .refine((date) => date <= new Date(new Date().setHours(23, 59, 59)), {
      message: "Payment date cannot be in the future",
    }),
  mode: PaymentModeEnum,
  notes: z.string()
    .trim()
    .max(500, "Notes cannot exceed 500 characters")
    .regex(NO_HTML_REGEX, "Notes contain invalid characters")
    .optional()
    .or(z.literal("")),
}).strict();

/**
 * Reporting & Filtering
 */
export const DateRangeSchema = z.object({
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
}).strict().refine((data) => data.endDate >= data.startDate, {
  message: "End date must be after or equal to start date",
  path: ["endDate"],
});

/**
 * Settings & Pricing
 */
export const PricingItemSchema = z.object({
  membershipType: MembershipTypeEnum,
  amount: z.coerce.number()
    .min(0, "Amount cannot be negative")
    .max(99999, "Amount too large")
}).strict();

export const PricingUpdateSchema = z.object({
  pricing: z.array(PricingItemSchema)
    .min(1, "At least one plan required")
    .max(5, "Maximum 5 plans allowed"),
  admissionFee: z.coerce.number()
    .min(0, "Admission fee cannot be negative")
    .max(99999, "Admission fee too large")
    .optional(),
}).strict();

/**
 * Gym profile settings
 */
export const GymProfileUpdateSchema = z.object({
  gymName: z.string().trim().min(2, "Gym name is too short").max(120, "Gym name is too long"),
  gymPhone: z.string().trim().min(6, "Phone is too short").max(30, "Phone is too long"),
}).strict();

/**
 * Change password
 */
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(6, "Current password is required"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
  confirmPassword: z.string().min(6, "Confirm password is required"),
}).strict().refine((d) => d.newPassword === d.confirmPassword, {
  message: "New password and confirm password must match",
  path: ["confirmPassword"],
});
/**
 * Member Renewal
 */
export const RenewMemberSchema = z.object({
  action: z.literal("renew"),
  membershipType: z.enum([
    "MONTHLY", "QUARTERLY", "HALF_YEARLY",
    "ANNUAL", "OTHERS"
  ]).optional(),
  /** ISO date string — optional explicit subscription start. */
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  customPrice: z.coerce.number()
    .min(0, "Price cannot be negative")
    .max(99999, "Price too large")
    .optional(),
  discountAmount: z.coerce.number()
    .min(0, "Discount cannot be negative")
    .max(99999, "Discount too large")
    .optional()
    .default(0),
  manualPlanName: z.string().optional(),
  paidAmount: z.preprocess(
    (val) => (val === "" || val === null || val === undefined) ? 0 : Number(val),
    z.number().min(0).max(99999).default(0)
  ),
  paymentMode: PaymentModeEnum.optional().default("CASH"),
})
  .strict()
  .refine(
    (data) => {
      if (!data.startDate) return true
      return !Number.isNaN(Date.parse(data.startDate))
    },
    { message: "Invalid start date", path: ["startDate"] }
  )
  .refine(
    (data) => {
      if (!data.endDate) return true
      return !Number.isNaN(Date.parse(data.endDate))
    },
    { message: "Invalid end date", path: ["endDate"] }
  )
  .refine(
    (data) => {
      if (!data.startDate || !data.endDate) return true
      const start = Date.parse(data.startDate)
      const end = Date.parse(data.endDate)
      if (Number.isNaN(start) || Number.isNaN(end)) return true
      return end > start
    },
    { message: "Membership end date must be after the start date", path: ["endDate"] }
  )
  .refine(
    (data) => {
      if (data.membershipType !== "OTHERS") return true
      const nameOk = !!data.manualPlanName?.trim()
      const amountOk = typeof data.customPrice === "number" && Number.isFinite(data.customPrice)
      const endOk = !!data.endDate && !Number.isNaN(Date.parse(data.endDate))
      return nameOk && amountOk && endOk
    },
    {
      message: "For OTHERS, plan name, amount, and end date are required.",
      path: ["membershipType"],
    }
  )
  .refine(
    (data) => {
      const base = Math.round(data.customPrice ?? 0)
      const disc = Math.round(data.discountAmount ?? 0)
      if (data.membershipType === "OTHERS" && disc > base) return false
      if (data.membershipType !== "OTHERS" && data.customPrice != null && disc > base) return false
      return true
    },
    {
      message: "Discount cannot exceed plan amount.",
      path: ["discountAmount"],
    }
  );

/**
 * Member Restore
 */
export const RestoreMemberSchema = z.object({
  action: z.literal("restore")
}).strict();

