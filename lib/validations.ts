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
  "PERSONAL_TRAINING",
]);

export const PaymentModeEnum = z.enum(["CASH", "UPI", "CARD"]);

export const MemberStatusEnum = z.enum(["ACTIVE", "INACTIVE", "DELETED"]);

/**
 * Member Creation (Updated for new schema)
 */
export const MemberCreateSchema = z.object({
  name: z.string()
    .trim()
    .min(1, "Name cannot be empty")
    .max(100, "Name too long")
    .regex(NO_HTML_REGEX, "Name contains invalid characters"),
  phone: z.string()
    .regex(PHONE_REGEX, "Invalid Indian mobile number (Must be 10 digits starting with 6-9)"),
  status: MemberStatusEnum.default("ACTIVE"),
  // Optional fields for future subscription creation
  membershipType: MembershipTypeEnum.optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  customPrice: z.preprocess(
    (val) => {
      // Handle all possible input types
      if (val === "" || val === null || val === undefined) {
        return null
      }
      const num = Number(val)
      return isNaN(num) ? null : num
    },
    z.number().min(0, "Custom price cannot be negative").max(99999, "Custom price too high").nullable().optional()
  ),
}).strict()
.refine((data) => {
  if (data.endDate && data.startDate && data.endDate <= data.startDate) return false;
  return true;
}, {
  message: "Membership end date must be after the start date",
  path: ["endDate"],
})
.refine((data) => {
  // Hard block for Personal Training if end date is missing
  if (data.membershipType === "PERSONAL_TRAINING" && !data.endDate) return false;
  return true;
}, {
  message: "Personal training requires an end date",
  path: ["endDate"],
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
  customPrice: z.preprocess(
    (val) => (val === "" || val === null || val === undefined) ? null : Number(val),
    z.number().min(0, "Custom price cannot be negative").max(99999, "Custom price too high").nullable().optional()
  ),
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
  finalAmount: z.number()
    .positive("Amount must be a positive number")
    .max(99999, "Amount exceeds maximum transaction limit"),
  createdAt: z.coerce.date()
    .refine((date) => date <= new Date(new Date().setHours(23, 59, 59)), {
      message: "Payment date cannot be in the future",
    }),
  method: PaymentModeEnum,
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
 * Member Renewal
 */
export const RenewMemberSchema = z.object({
  action: z.literal("renew"),
  membershipType: z.enum([
    "MONTHLY", "QUARTERLY", "HALF_YEARLY",
    "ANNUAL", "PERSONAL_TRAINING"
  ]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  customPrice: z.coerce.number()
    .min(0, "Price cannot be negative")
    .max(99999, "Price too large")
    .optional()
}).strict();

/**
 * Member Restore
 */
export const RestoreMemberSchema = z.object({
  action: z.literal("restore")
}).strict();