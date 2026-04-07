import { z } from "zod";

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
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
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
 * Member Update (Partial updates, id required)
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
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  status: MemberStatusEnum.optional(),
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
    .max(5, "Maximum 5 plans allowed")
}).strict();
/**
 * Member Renewal & Switch
 */
export const RenewMemberSchema = z.object({
  action: z.enum(["renew", "switch"]),
  membershipType: z.enum([
    "MONTHLY", "QUARTERLY", "HALF_YEARLY",
    "ANNUAL", "OTHERS"
  ]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  customPrice: z.coerce.number()
    .min(0, "Price cannot be negative")
    .max(99999, "Price too large")
    .optional(),
  manualPlanName: z.string().optional(),
  paidAmount: z.preprocess(
    (val) => (val === "" || val === null || val === undefined) ? 0 : Number(val),
    z.number().min(0).max(99999).default(0)
  ),
  paymentMode: PaymentModeEnum.optional().default("CASH"),
}).strict();

/**
 * Member Restore
 */
export const RestoreMemberSchema = z.object({
  action: z.literal("restore")
}).strict();

/**
 * Member Cancel Subscription
 */
export const CancelSubscriptionSchema = z.object({
  action: z.literal("cancel")
}).strict();