// Single shared PrismaClient for the whole process.
//
// require() caches this module, so every controller / service / middleware that
// imports it gets the SAME client (and the SAME connection pool). Previously each
// file ran `new PrismaClient()` — 13 separate pools that could exhaust Postgres
// under load. This collapses them into one.
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

module.exports = prisma;
