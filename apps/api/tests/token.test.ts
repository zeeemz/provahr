import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { signToken, verifyToken } from '../src/lib/token';

describe('jwt tokens', () => {
  it('round-trips a user id', () => {
    const token = signToken('user-123');
    expect(verifyToken(token)).toBe('user-123');
  });

  it('embeds the subject claim', () => {
    const token = signToken('user-456');
    const decoded = jwt.decode(token) as jwt.JwtPayload;
    expect(decoded.sub).toBe('user-456');
  });

  it('rejects tokens signed with a different secret', () => {
    const forged = jwt.sign({}, 'not-the-real-secret', { subject: 'user-123' });
    expect(() => verifyToken(forged)).toThrowError();
  });

  it('rejects expired tokens', async () => {
    const token = signToken('user-123', '1ms');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(() => verifyToken(token)).toThrowError();
  });

  it('rejects garbage input', () => {
    expect(() => verifyToken('not-a-jwt')).toThrowError();
    expect(() => verifyToken('')).toThrowError();
  });
});
