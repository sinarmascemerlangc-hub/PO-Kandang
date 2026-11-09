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

        // Surat Jalan per PO: nomor SJ tersimpan + nama pembuat.
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(918273645)');
          await tx.$executeRawUnsafe('ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "deliveryNumber" TEXT');
          await tx.$executeRawUnsafe('ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "createdByName" TEXT');

          // Backfill nomor SJ untuk pengiriman lama: SJ-YYYYMMDD-NN per tanggal kirim.
          await tx.$executeRawUnsafe(`
            WITH nulls AS (
              SELECT id, "deliveryDate", "createdAt",
                     to_char("deliveryDate" AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD') AS ymd
              FROM "Delivery"
              WHERE "deliveryNumber" IS NULL
            ), maxes AS (
              SELECT n.*, COALESCE((
                SELECT MAX(NULLIF(regexp_replace(d2."deliveryNumber", '^SJ-[0-9]{8}-', ''), '')::int)
                FROM "Delivery" d2
                WHERE d2."deliveryNumber" IS NOT NULL
                  AND to_char(d2."deliveryDate" AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD') = n.ymd
              ), 0) AS cur_max
              FROM nulls n
            ), seq AS (
              SELECT id, ymd, cur_max + row_number() OVER (PARTITION BY ymd ORDER BY "createdAt", id) AS n
              FROM maxes
            )
            UPDATE "Delivery" d
            SET "deliveryNumber" = 'SJ-' || s.ymd || '-' || lpad(s.n::text, 2, '0')
            FROM seq s
            WHERE d.id = s.id
          `);

          await tx.$executeRawUnsafe(
            'CREATE UNIQUE INDEX IF NOT EXISTS "Delivery_deliveryNumber_key" ON "Delivery"("deliveryNumber")'
          );
        });
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
