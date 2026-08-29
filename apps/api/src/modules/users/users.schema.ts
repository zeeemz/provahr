import { z } from 'zod';

export const createUserSchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(120),
  email: z.string().trim().toLowerCase().email('Must be a valid email').max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
  role: z.enum(['ADMIN', 'RECRUITER', 'INTERVIEWER']),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
