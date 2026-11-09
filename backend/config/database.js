const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['error'] });

// Migrasi ringan yang aman dijalankan berulang kali (idempotent).
// Dijalankan dari server agar kolom baru tersedia tanpa `prisma db push`
// (pooler Supabase port 6543 tidak mendukung operasi schema Prisma).
let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      try {
        await prisma.$executeRawUnsafe(
          'ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "company" TEXT'
        );
        await prisma.$executeRawUnsafe(
          'CREATE INDEX IF NOT EXISTS "PurchaseOrder_company_idx" ON "PurchaseOrder"("company")'
        );
      } catch (e) {
        console.error('ensureSchema gagal:', e.message);
        schemaReady = null; // coba lagi pada request berikutnya
      }
    })();
  }
  return schemaReady;
}

module.exports = prisma;
module.exports.ensureSchema = ensureSchema;
