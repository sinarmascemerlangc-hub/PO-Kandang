// Terapkan schema Prisma ke database hanya saat build di Vercel.
// `npm install` lokal tidak akan menyentuh database.
const { execSync } = require('child_process');

if (process.env.VERCEL) {
  console.log('Vercel terdeteksi: menjalankan prisma db push...');
  execSync('npx prisma db push --skip-generate', { stdio: 'inherit' });
} else {
  console.log('Bukan environment Vercel: lewati prisma db push.');
}
