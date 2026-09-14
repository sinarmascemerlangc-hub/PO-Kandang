const express = require('express');
const compression = require('compression');
const path = require('path');
const prisma = require('./config/database');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(compression());
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  let sameOrigin = false;
  if (origin && req.headers.host) {
    try { sameOrigin = new URL(origin).host === req.headers.host; } catch (e) { sameOrigin = false; }
  }
  if (!origin || sameOrigin || allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  }
  return res.status(403).json({ error: 'Origin tidak diizinkan' });
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true,
  lastModified: true,
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: '7d',
}));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/po', require('./routes/po'));
app.use('/api/deliveries', require('./routes/deliveries'));

app.get('/api/health', async (req, res) => {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'OK', timestamp: new Date(), db: Date.now() - start + 'ms' });
  } catch (e) {
    res.json({ status: 'OK', timestamp: new Date(), db: 'error', dbTime: Date.now() - start + 'ms' });
  }
});

const authMiddleware = require('./middleware/auth');

app.get('/api/dashboard', authMiddleware, async (req, res) => {
  try {
    const [statsRow] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as "totalPO",
        COUNT(*) FILTER (WHERE status = 'diterima')::int as diterima,
        COUNT(*) FILTER (WHERE status = 'diproses')::int as diproses,
        COUNT(*) FILTER (WHERE status = 'dikirim')::int as dikirim,
        COUNT(*) FILTER (WHERE status = 'selesai')::int as selesai,
        COUNT(*) FILTER (WHERE status = 'dibatalkan')::int as dibatalkan,
        COALESCE(SUM("totalKubikasi")::float, 0) as "totalKubikasi",
        COALESCE(SUM("totalQuantity")::int, 0) as "totalQuantity"
      FROM "PurchaseOrder"
    `);

    const [shippedRow] = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(SUM(kubikasi)::float, 0) as "shippedKubikasi", COALESCE(SUM(quantity)::int, 0) as "shippedQuantity"
      FROM "DeliveryItem"
    `);

    const recentPOs = await prisma.$queryRawUnsafe(`
      SELECT p.id, p."poNumber", p."customerName", p."orderDate", p.status,
        p."totalKubikasi", p."totalQuantity"
      FROM "PurchaseOrder" p
      ORDER BY p."createdAt" DESC LIMIT 5
    `);

    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const todayDeliveries = await prisma.$queryRawUnsafe(`
      SELECT d.id, d."deliveryDate", d."driverName",
        di.kubikasi, di.quantity
      FROM "Delivery" d
      JOIN "DeliveryItem" di ON di."deliveryId" = d.id
      WHERE d."deliveryDate" >= $1
    `, todayStart);

    const totalKubikasi = Number(statsRow.totalKubikasi) || 0;
    const shippedKubikasi = Number(shippedRow.shippedKubikasi) || 0;
    const totalQuantity = Number(statsRow.totalQuantity) || 0;
    const shippedQuantity = Number(shippedRow.shippedQuantity) || 0;

    let todayKub = 0, todayPcs = 0;
    todayDeliveries.forEach(d => { todayKub += Number(d.kubikasi) || 0; todayPcs += Number(d.quantity) || 0; });
    const todayCount = new Set(todayDeliveries.map(d => d.id)).size;

    res.json({
      stats: {
        totalPO: statsRow.totalPO,
        statusBreakdown: { diterima: statsRow.diterima, diproses: statsRow.diproses, dikirim: statsRow.dikirim, selesai: statsRow.selesai, dibatalkan: statsRow.dibatalkan },
        totalKubikasi: Math.round(totalKubikasi * 10000) / 10000,
        totalQuantity,
        shippedKubikasi: Math.round(shippedKubikasi * 10000) / 10000,
        shippedQuantity,
        remainingKubikasi: Math.round((totalKubikasi - shippedKubikasi) * 10000) / 10000,
        remainingQuantity: totalQuantity - shippedQuantity,
      },
      recentPOs,
      todayDelivery: { pcs: todayPcs, kubikasi: Math.round(todayKub * 10000) / 10000, count: todayCount },
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.includes('.')) {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}
