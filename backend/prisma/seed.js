const bcrypt = require('bcrypt');
const prisma = require('../config/database');

async function seed() {
  try {
    const existing = await prisma.user.findUnique({ where: { email: 'admin@kandang.com' } });
    if (!existing) {
      const hashed = await bcrypt.hash('admin123', 10);
      await prisma.user.create({
        data: { name: 'Admin Kandang', email: 'admin@kandang.com', password: hashed, role: 'admin' },
      });
      console.log('Default admin created: admin@kandang.com / admin123');
    } else {
      console.log('Admin already exists');
    }
  } catch (error) {
    console.error('Seed error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

seed();
