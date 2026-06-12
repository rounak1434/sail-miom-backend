// Lightweight, dependency-free environment validation.
//
// Called once at startup (before the HTTP server binds) so a misconfigured deploy
// fails fast with a clear message instead of throwing deep inside a request handler.
const REQUIRED = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];

// Not fatal — features that need these degrade gracefully, but warn the operator.
const RECOMMENDED = [
  'JWT_EXPIRES_IN',
  'JWT_REFRESH_EXPIRES_IN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
  'AWS_S3_BUCKET',
  // Base URL of the web portal — used to build password-reset links in emails.
  // Falls back to the deployed admin site if unset, so it's recommended not required.
  'FRONTEND_URL',
];

function validateEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k] || !String(process.env[k]).trim());
  if (missing.length) {
    console.error('❌ Missing required environment variable(s):');
    for (const k of missing) console.error(`   - ${k}`);
    console.error('   Set them in the backend .env, then restart. Aborting startup.');
    process.exit(1);
  }

  const warn = RECOMMENDED.filter((k) => !process.env[k] || !String(process.env[k]).trim());
  if (warn.length) {
    console.warn(`⚠️  Optional env not set (related features disabled): ${warn.join(', ')}`);
  }
}

module.exports = { validateEnv };
