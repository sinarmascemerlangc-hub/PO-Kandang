const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Adding remainingQty to WoodGesek...');

  // Check if column already exists
  const cols = await prisma.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'WoodGesek' AND column_name = 'remainingQty'
  `);

  if (cols.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "WoodGesek" ADD COLUMN "remainingQty" INT NOT NULL DEFAULT 0`);
    console.log('Column remainingQty added.');
  } else {
    console.log('Column remainingQty already exists.');
  }

  // Make poItemId nullable (gesek no longer requires PO target at creation)
  const poCol = await prisma.$queryRawUnsafe(`
    SELECT is_nullable FROM information_schema.columns
    WHERE table_name = 'WoodGesek' AND column_name = 'poItemId'
  `);
  if (poCol.length > 0 && poCol[0].is_nullable === 'NO') {
    await prisma.$executeRawUnsafe(`ALTER TABLE "WoodGesek" ALTER COLUMN "poItemId" DROP NOT NULL`);
    console.log('poItemId made nullable.');
  }

  // Verify
  const result = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_name = 'WoodGesek' ORDER BY ordinal_position
  `);
  console.log('WoodGesek columns:', result);

  await prisma.$disconnect();
  console.log('Done!');
}

main().catch(e => { console.error(e); process.exit(1); });
