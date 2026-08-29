// Runs before any module imports so env validation passes without a real
// database (these tests only exercise pure logic and routes that never touch
// the database).
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/hiring_platform_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-not-for-production';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';
process.env.PORT = process.env.PORT || '4000';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
