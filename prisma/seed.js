const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = new PrismaClient();

// Read seed passwords from environment. If unset, generate a random one and
// print it once so a production operator can capture it and rotate later.
function resolvePassword(envKey, label) {
  const fromEnv = process.env[envKey];
  if (fromEnv && fromEnv.length >= 8) return { password: fromEnv, generated: false };
  const generated = crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) + 'A1!';
  console.warn(`⚠️  ${envKey} not set — generated a random password for ${label}.`);
  return { password: generated, generated: true };
}

async function main() {
  console.log('🌱 Seeding database...');

  // Locations (real MIOM electrical sub-stations / plants)
  const locations = await Promise.all([
    prisma.location.upsert({ where: { code: 'MRSS' }, update: {}, create: { name: 'Main Receiving Sub-Station', code: 'MRSS' } }),
    prisma.location.upsert({ where: { code: 'PPH' }, update: {}, create: { name: 'Pardih Pump House', code: 'PPH' } }),
    prisma.location.upsert({ where: { code: 'KPH' }, update: {}, create: { name: 'Kumdih Pump House', code: 'KPH' } }),
    prisma.location.upsert({ where: { code: 'SCP' }, update: {}, create: { name: 'Sc. Plant', code: 'SCP' } }),
    prisma.location.upsert({ where: { code: 'CRP' }, update: {}, create: { name: 'Cr. Plant', code: 'CRP' } }),
    prisma.location.upsert({ where: { code: 'LDP' }, update: {}, create: { name: 'Loading Plant', code: 'LDP' } }),
    prisma.location.upsert({ where: { code: 'TRC' }, update: {}, create: { name: 'Tertiary Crusher', code: 'TRC' } }),
  ]);

  // Installation Types
  await Promise.all([
    prisma.installationType.upsert({ where: { name: 'Transformers' }, update: {}, create: { name: 'Transformers' } }),
    prisma.installationType.upsert({ where: { name: 'Motors' }, update: {}, create: { name: 'Motors' } }),
    prisma.installationType.upsert({ where: { name: 'Breakers' }, update: {}, create: { name: 'Breakers' } }),
    prisma.installationType.upsert({ where: { name: 'DGMS' }, update: {}, create: { name: 'DGMS' } }),
    prisma.installationType.upsert({ where: { name: 'Other' }, update: {}, create: { name: 'Other' } }),
  ]);

  // SLA Config
  await prisma.slaConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, criticalHours: 4, highHours: 8, mediumHours: 24, lowHours: 72 }
  });

  // Account emails are read from env so no credentials are hardcoded; the
  // defaults below are just the documented project accounts for local dev.
  const superEmail = process.env.SEED_SUPERADMIN_EMAIL || 'ramramanswain@sail.in';
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@miom.sail.in';

  // Superadmin — actual project owner
  const superPwd = resolvePassword('SEED_SUPERADMIN_PASSWORD', `Superadmin (${superEmail})`);
  await prisma.user.upsert({
    where: { email: superEmail },
    update: {},
    create: {
      name: 'R. Swain',
      email: superEmail,
      employeeId: 'AGM-EL-001',
      password: await bcrypt.hash(superPwd.password, 12),
      role: 'SUPERADMIN',
      department: 'Electrical',
      phone: '9999999999',
      locationId: locations[0].id
    }
  });

  // System Admin — day-to-day operations
  const adminPwd = resolvePassword('SEED_ADMIN_PASSWORD', `System Admin (${adminEmail})`);
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      name: 'System Admin',
      email: adminEmail,
      employeeId: 'ADM-001',
      password: await bcrypt.hash(adminPwd.password, 12),
      role: 'ADMIN',
      department: 'Electrical',
      locationId: locations[0].id
    }
  });

  console.log('✅ Database seeded!');
  console.log('');
  console.log('Login credentials:');
  console.log(`  Superadmin: ${superEmail}  / ${superPwd.generated ? superPwd.password + '  (generated — rotate after first login)' : '(from SEED_SUPERADMIN_PASSWORD)'}`);
  console.log(`  Admin:      ${adminEmail}  / ${adminPwd.generated ? adminPwd.password + '  (generated — rotate after first login)' : '(from SEED_ADMIN_PASSWORD)'}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
