const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Creating WoodIntakeProof table...');

  const exists = await prisma.$queryRawUnsafe(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables WHERE table_name = 'WoodIntakeProof'
    ) as exists
  `);

  if (exists[0].exists) {
    console.log('Table already exists.');
  } else {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "WoodIntakeProof" (
        "id" TEXT NOT NULL,
        "intakeId" TEXT NOT NULL,
        "url" TEXT NOT NULL,
        "fileName" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "WoodIntakeProof_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX "WoodIntakeProof_intakeId_idx" ON "WoodIntakeProof"("intakeId")`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "WoodIntakeProof" ADD CONSTRAINT "WoodIntakeProof_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "WoodIntake"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
    console.log('Table created.');
  }

  console.log('Done!');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
