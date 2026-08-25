process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5433/nourish_test';
process.env.NEXTAUTH_SECRET = 'test-secret-test-secret';
process.env.NEXTAUTH_URL = 'http://localhost:3000';
process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.ADMIN_PASSWORD = 'admin-password';
(process.env as Record<string, string>).NODE_ENV = 'test';
