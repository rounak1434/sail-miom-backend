const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user.findMany({ select: { id: true, email: true, role: true, isActive: true } })
  .then(users => console.log(JSON.stringify(users, null, 2)))
  .finally(() => p.$disconnect());
