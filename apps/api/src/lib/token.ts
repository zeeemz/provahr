import jwt from 'jsonwebtoken';
import { env } from '../env';
import { AppError } from './http';

type SignExpiresIn = jwt.SignOptions['expiresIn'];

/** Signs a login token whose subject is the user id. */
export function signToken(
  userId: string,
  expiresIn: SignExpiresIn = env.JWT_EXPIRES_IN as SignExpiresIn,
): string {
  return jwt.sign({}, env.JWT_SECRET, { subject: userId, expiresIn });
}

/** Verifies a token and returns the user id it was issued for. */
export function verifyToken(token: string): string {
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch {
    throw new AppError(401, 'Invalid or expired token', 'UNAUTHENTICATED');
  }
  const sub = typeof payload === 'string' ? undefined : payload.sub;
  if (typeof sub !== 'string' || sub.length === 0) {
    throw new AppError(401, 'Invalid token payload', 'UNAUTHENTICATED');
  }
  return sub;
}
