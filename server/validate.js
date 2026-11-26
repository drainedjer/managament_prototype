/**
 * validate.js - Zod schemas for all API request validation.
 */
const { z } = require('zod');

const PROPERTY_TYPES = ['Apartment', 'Dormitory', 'Boarding House', 'Studio Unit', 'Shared Room', 'Private Room'];
const PAYMENT_METHODS = ['Cash', 'GCash', 'Maya', 'Bank Transfer', 'Other'];
const APP_STATUSES = ['Pending', 'Approved', 'Rejected', 'Reserved', 'Completed', 'Cancelled'];
const ROOM_STATUSES = ['Available', 'Occupied', 'Reserved', 'Maintenance'];
const TENANT_STATUSES = ['Active', 'Pending', 'Inactive', 'Former Tenant'];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD date format.');
const billingMonth = z.string().regex(/^\d{4}-\d{2}$/, 'Billing month must be YYYY-MM.');
const safeText = (max = 500) => z.string().trim().max(max);
const reqText = (min = 1, max = 200) => z.string().trim().min(min).max(max);

const loginSchema = z.object({
  email: z.string().trim().email('Valid email is required.').max(150),
  password: z.string().min(1, 'Password is required.').max(200),
});

const registerSchema = z.object({
  fullName: reqText(2, 120),
  email: z.string().trim().email('Valid email is required.').max(150),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(120),
  phone: safeText(30).optional().default(''),
  consentAccepted: z.literal(true, { errorMap: () => ({ message: 'You must accept the Privacy Policy (RA 10173).' }) }),
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Valid email is required.').max(150),
});

const resetPasswordSchema = z.object({
  token: reqText(16, 200),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(120),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters.').max(120),
});

const profileSchema = z.object({
  fullName: reqText(2, 120),
  phone: safeText(30).optional().default(''),
});

const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Password confirmation is required.'),
});

const applicationSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  fullName: reqText(2, 120),
  email: z.string().trim().email('Valid email is required.').max(150),
  contactNumber: reqText(5, 30),
  preferredRoomType: z.enum(PROPERTY_TYPES).optional(),
  expectedMoveInDate: isoDate,
  occupants: z.coerce.number().int().min(1).max(10).default(1),
  message: safeText(500).optional().default(''),
  consentAccepted: z.literal(true, { errorMap: () => ({ message: 'Consent under RA 10173 is required.' }) }),
  idDocument: z
    .object({
      fileName: reqText(1, 200),
      contentBase64: z.string().min(10).max(3_000_000),
    })
    .optional(),
});

const trackApplicationSchema = z.object({
  referenceNumber: reqText(4, 40),
  email: z.string().trim().email('Valid email is required.').max(150),
});

const applicationStatusSchema = z.object({
  status: z.enum(APP_STATUSES),
  assignedRoomId: z.union([z.coerce.number().int().positive(), z.literal(''), z.null()]).optional(),
  reservationDate: z.union([isoDate, z.literal(''), z.null()]).optional(),
});

const convertApplicationSchema = z.object({
  address: reqText(3, 255),
  emergencyContact: reqText(3, 150),
  securityDeposit: z.coerce.number().min(0).max(1_000_000),
  moveInDate: isoDate.optional(),
  leaseEndDate: isoDate.optional(),
  notes: safeText(500).optional().default(''),
});

const reviewSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  reviewerName: reqText(2, 80),
  email: z.string().trim().email('Valid email is required.').max(150),
  rating: z.coerce.number().int().min(1).max(5),
  title: safeText(120).optional().default(''),
  comment: reqText(10, 600),
});

const testimonialSchema = z.object({
  propertyId: z.union([z.coerce.number().int().positive(), z.literal(''), z.null()]).optional(),
  authorName: reqText(2, 120),
  roleLabel: safeText(120).optional().default('Resident'),
  rating: z.coerce.number().int().min(1).max(5).default(5),
  quote: reqText(10, 500),
});

const contactSchema = z.object({
  fullName: reqText(2, 100),
  email: z.string().trim().email('Valid email is required.').max(150),
  phone: safeText(40).optional().default(''),
  subject: safeText(120).optional().default('General inquiry'),
  message: reqText(10, 1000),
  website: z.string().max(200).optional().default(''), // honeypot
  consentAccepted: z.literal(true, { errorMap: () => ({ message: 'Consent under RA 10173 is required.' }) }),
});

const viewingRequestSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  fullName: reqText(2, 120),
  email: z.string().trim().email('Valid email is required.').max(150),
  phone: reqText(5, 30),
  preferredDate: isoDate,
  preferredTime: reqText(2, 40),
  notes: safeText(500).optional().default(''),
  website: z.string().max(200).optional().default(''), // honeypot
  consentAccepted: z.literal(true, { errorMap: () => ({ message: 'Consent under RA 10173 is required.' }) }),
});

const waitlistSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  fullName: reqText(2, 120),
  email: z.string().trim().email('Valid email is required.').max(150),
  phone: safeText(30).optional().default(''),
  preferredRoomType: safeText(40).optional().default('Any'),
  consentAccepted: z.literal(true, { errorMap: () => ({ message: 'Consent under RA 10173 is required.' }) }),
});

const linesOrArray = z.union([z.array(z.string().trim()), z.string()]).optional().default([]);

const propertySchema = z.object({
  name: reqText(2, 150),
  propertyType: z.enum(PROPERTY_TYPES),
  address: reqText(3, 255),
  city: safeText(100).optional().default('Batangas City'),
  latitude: z.coerce.number().min(-90).max(90).default(13.7845),
  longitude: z.coerce.number().min(-180).max(180).default(121.0735),
  description: safeText(3000).optional().default(''),
  monthlyPrice: z.coerce.number().min(0).default(0),
  contactPhone: safeText(30).optional().default(''),
  contactEmail: z.union([z.string().trim().email(), z.literal('')]).optional().default(''),
  locationAccess: safeText(255).optional().default(''),
  nearbyPlaces: safeText(1000).optional().default(''),
  landmarks: safeText(1000).optional().default(''),
  walkingMinutesBsu: z.union([z.coerce.number().int().min(0).max(180), z.literal(''), z.null()]).optional(),
  tricycleMinutesBsu: z.union([z.coerce.number().int().min(0).max(180), z.literal(''), z.null()]).optional(),
  minLeaseMonths: z.coerce.number().int().min(1).max(36).default(6),
  depositPolicy: safeText(1000).optional().default(''),
  utilitiesPolicy: safeText(1000).optional().default(''),
  inclusions: safeText(1000).optional().default(''),
  curfewPolicy: safeText(1000).optional().default(''),
  amenities: linesOrArray,
  houseRules: linesOrArray,
  images: linesOrArray,
  isPublished: z.boolean().optional(),
});

const buildingSchema = z.object({
  propertyId: z.coerce.number().int().positive().optional(),
  name: reqText(1, 120),
  floors: z.coerce.number().int().min(1).max(50).default(1),
  description: safeText(255).optional().default(''),
});

const roomSchema = z.object({
  buildingId: z.coerce.number().int().positive(),
  roomNumber: reqText(1, 30),
  floorNumber: z.coerce.number().int().min(1).max(50).default(1),
  roomType: z.enum(PROPERTY_TYPES),
  capacity: z.coerce.number().int().min(1).max(20),
  monthlyPrice: z.coerce.number().min(0),
  status: z.enum(['Available', 'Maintenance']).optional().default('Available'),
  description: safeText(1000).optional().default(''),
  images: linesOrArray,
});

const tenantSchema = z.object({
  fullName: reqText(2, 120),
  email: z.union([z.string().trim().email(), z.literal('')]).optional().default(''),
  contactNumber: reqText(3, 30),
  address: safeText(255).optional().default(''),
  emergencyContact: safeText(150).optional().default(''),
  roomId: z.union([z.coerce.number().int().positive(), z.literal(''), z.null()]).optional(),
  propertyId: z.coerce.number().int().positive().optional(),
  moveInDate: isoDate.optional(),
  moveOutDate: z.union([isoDate, z.literal(''), z.null()]).optional(),
  monthlyRent: z.coerce.number().min(0).optional(),
  securityDeposit: z.coerce.number().min(0).default(0),
  status: z.enum(TENANT_STATUSES).default('Active'),
  leaseEndDate: z.union([isoDate, z.literal(''), z.null()]).optional(),
});

const checklistSchema = z.object({
  type: z.enum(['move_in', 'move_out']),
  items: z.record(z.any()).optional().default({}),
  meterReading: safeText(80).optional().default(''),
  notes: safeText(500).optional().default(''),
  depositDeductions: z.coerce.number().min(0).optional(),
  depositRefunded: z.coerce.number().min(0).optional(),
  depositRefundedAt: z.union([isoDate, z.literal(''), z.null()]).optional(),
});

const paymentCreateSchema = z.object({
  tenantId: z.coerce.number().int().positive(),
  billingMonth,
  dueDate: z.union([isoDate, z.literal('')]).optional(),
  amountDue: z.union([z.coerce.number().min(0), z.literal('')]).optional(),
  initialAmountPaid: z.union([z.coerce.number().min(0), z.literal('')]).optional(),
  paymentDate: z.union([isoDate, z.literal('')]).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).default('Cash'),
  notes: safeText(255).optional().default(''),
});

const transactionCreateSchema = z.object({
  amount: z.coerce.number().positive('Payment amount must be greater than zero.'),
  paymentDate: z.union([isoDate, z.literal('')]).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).default('Cash'),
  notes: safeText(255).optional().default(''),
});

const transactionEditSchema = z.object({
  amount: z.coerce.number().positive('Amount must be positive.'),
  paymentDate: isoDate,
  paymentMethod: z.enum(PAYMENT_METHODS),
  notes: safeText(255).optional().default(''),
  reason: reqText(3, 300),
});

const transactionVoidSchema = z.object({
  reason: reqText(3, 300),
});

const expenseSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  categoryId: z.coerce.number().int().positive().optional(),
  category: safeText(80).optional(),
  description: reqText(2, 255),
  amount: z.coerce.number().positive('Expense amount must be positive.'),
  expenseDate: z.union([isoDate, z.literal('')]).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).default('Cash'),
  receiptReference: safeText(100).optional().default(''),
});

const maintenanceCreateSchema = z.object({
  propertyId: z.coerce.number().int().positive().optional(),
  roomId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  title: reqText(3, 150),
  description: reqText(5, 1000),
  priority: z.enum(['Low', 'Medium', 'High']).default('Medium'),
});

const maintenanceUpdateSchema = z.object({
  status: z.enum(['Open', 'In Progress', 'Done']),
  ownerNotes: safeText(1000).optional().default(''),
});

const announcementSchema = z.object({
  propertyId: z.union([z.coerce.number().int().positive(), z.literal(''), z.null()]).optional(),
  title: reqText(3, 150),
  body: reqText(5, 2000),
  isPublished: z.boolean().optional().default(true),
});

const settingsSchema = z.object({
  business_name: reqText(2, 120),
  tagline: safeText(255).optional().default(''),
  contact_phone: reqText(5, 40),
  contact_email: z.string().trim().email().max(150),
  office_address: reqText(5, 255),
  office_hours: reqText(3, 150),
});

const userCreateSchema = z.object({
  fullName: reqText(2, 120),
  email: z.string().trim().email().max(150),
  password: z.string().min(8).max(120),
  role: z.enum(['staff', 'owner', 'admin', 'customer']).default('staff'),
  phone: safeText(30).optional().default(''),
  businessName: safeText(150).optional().default(''),
});

function validate(schema, input) {
  const res = schema.safeParse(input);
  if (!res.success) {
    const first = res.error.issues[0];
    return { ok: false, error: first?.message || 'Invalid input.' };
  }
  return { ok: true, data: res.data };
}

module.exports = {
  PROPERTY_TYPES,
  PAYMENT_METHODS,
  APP_STATUSES,
  ROOM_STATUSES,
  TENANT_STATUSES,
  validate,
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  profileSchema,
  deleteAccountSchema,
  applicationSchema,
  trackApplicationSchema,
  applicationStatusSchema,
  convertApplicationSchema,
  reviewSchema,
  testimonialSchema,
  contactSchema,
  viewingRequestSchema,
  waitlistSchema,
  propertySchema,
  buildingSchema,
  roomSchema,
  tenantSchema,
  checklistSchema,
  paymentCreateSchema,
  transactionCreateSchema,
  transactionEditSchema,
  transactionVoidSchema,
  expenseSchema,
  maintenanceCreateSchema,
  maintenanceUpdateSchema,
  announcementSchema,
  settingsSchema,
  userCreateSchema,
};
