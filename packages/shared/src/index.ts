import { z } from 'zod';

// Shared enums (kept in sync with prisma/schema.prisma)
export const UserRole = z.enum([
  'SUPER_ADMIN',
  'ADMIN',
  'MANAGER',
  'FRONT_DESK',
  'ACCOUNTANT',
  'TRAINER',
]);
export type UserRole = z.infer<typeof UserRole>;

export const LeadSource = z.enum([
  'WHATSAPP',
  'WEBSITE',
  'GOOGLE_FORM',
  'LINKEDIN',
  'WALK_IN',
  'REFERRAL',
  'OTHER',
]);
export type LeadSource = z.infer<typeof LeadSource>;

// ── Auth ──
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ── Student ──
export const studentSchema = z.object({
  fullName: z.string().min(2),
  mobile: z.string().regex(/^\d{10}$/, 'Enter a 10-digit mobile'),
  email: z.string().email().optional().or(z.literal('')),
  dob: z.string().optional(),
  gender: z.string().optional(),
  address: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  emergencyContactRelation: z.string().optional(),
  isMinor: z.boolean().default(false),
});
export type StudentInput = z.infer<typeof studentSchema>;

// ── Public lead intake (used by website/Google Form/Zapier) ──
export const publicLeadSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  message: z.string().optional(),
  source: LeadSource.default('WEBSITE'),
  sourceDetail: z.record(z.unknown()).optional(),
});
export type PublicLeadInput = z.infer<typeof publicLeadSchema>;
