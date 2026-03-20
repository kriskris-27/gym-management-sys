import { z } from "zod";

/**
 * Common Security Regex
 */
const PHONE_REGEX = /^[6-9]\d{9}$/;
const NO_HTML_REGEX = /^[^<>]*$/; // Blocks < and > to prevent HTML/Script injection

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
 * Member Creation
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

  status: MemberStatusEnum.default("ACTIVE"),
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
  message: "Personal Training end date is explicitly required",
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
