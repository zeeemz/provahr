import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/password';

describe('password hashing', () => {
  it('hashes differently from the plaintext and verifies it', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toBe('correct horse battery staple');
    expect(hash.startsWith('$2')).toBe(true); // bcrypt format
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('produces a unique salt per hash', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });

  it('rejects wrong passwords', async () => {
    const hash = await hashPassword('right-password-123');
    await expect(verifyPassword('wrong-password-123', hash)).resolves.toBe(false);
  });
});
