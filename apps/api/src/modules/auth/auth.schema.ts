import { z } from 'zod';

export const registerSchema = z.object({
  companyName: z.string().trim().min(2, 'Company name is too short').max(120),
  name: z.string().trim().min(2, 'Your name is too short').max(120),
  email: z.string().trim().toLowerCase().email('Must be a valid email').max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Must be a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
