const express = require('express');
const prisma = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

function calcKubikasi(thickness, width, length) {
  return (thickness / 100) * (width / 100) * (length / 100);
}

function fmtDateKey(d) {
  const x = new Date(d);
  const y = x.getFullYear().toString().slice(2);
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const dd = String(x.getDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

async function generateIntakeNumber(prisma, date) {
  const prefix = `KM-${fmtDateKey(date)}-`;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "intakeNumber" FROM "WoodIntake" WHERE "intakeNumber" LIKE $1 ORDER BY "intakeNumber" DESC LIMIT 1`,
    prefix + '%'
  );
  const last = rows[0]?.intakeNumber;
  const next = last ? (parseInt(last.split('-').pop(), 10) || 0) + 1 : 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

// GET /api/wood/stats - Ringkasan stok & gesek
router.get('/stats', auth, async (req, res) => {
  try {
    const [intake] = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(SUM("totalKubikasi")::float, 0) as "totalIn",
        COALESCE(SUM("totalQuantity")::int, 0) as "totalQty",
        COUNT(*)::int as count
      FROM "WoodIntake"
    `);
    const [stock] = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(SUM(i.kubikasi / NULLIF(i.quantity, 0) * i.remaining)::float, 0) as "remainingKub",
        COALESCE(SUM(i.remaining)::int, 0) as "remainingQty",
        COUNT(*) FILTER (WHERE i.remaining > 0)::int as "stockItems"
      FROM "WoodIntakeItem" i
    `);
    const [gesek] = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(SUM(quantity)::int, 0) as "gesekQty", COUNT(*)::int as "gesekCount"
      FROM "SawingLog"
    `);
    res.json({
      totalIn: Math.round(Number(intake.totalIn) * 10000) / 10000,
      totalQty: intake.totalQty,
      intakeCount: intake.count,
      remainingKubikasi: Math.round(Number(stock.remainingKub) * 10000) / 10000,
      remainingQty: stock.remainingQty || 0,
      stockItems: stock.stockItems || 0,
      gesekQty: gesek.gesekQty || 0,
      gesekCount: gesek.gesekCount || 0,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/wood/intake - Daftar kayu masuk
router.get('/intake', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);
    const [countRow] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as total FROM "WoodIntake"`);
    const total = countRow?.total || 0;

    const intakes = await prisma.$queryRawUnsafe(`
      SELECT wi.*, u.name as "userName",
        (SELECT COALESCE(SUM(wii.quantity), 0)::int FROM "WoodIntakeItem" wii WHERE wii."intakeId" = wi.id) as "itemQty",
        (SELECT COALESCE(SUM(wii.remaining), 0)::int FROM "WoodIntakeItem" wii WHERE wii."intakeId" = wi.id) as "remainingQty"
      FROM "WoodIntake" wi
      LEFT JOIN "User" u ON u.id = wi."userId"
      ORDER BY wi."intakeDate" DESC
      LIMIT $1 OFFSET $2
    `, take, skip);

    const ids = intakes.map(i => i.id);
    const items = ids.length > 0 ? await prisma.$queryRawUnsafe(`
      SELECT wii.*,
        (SELECT COALESCE(SUM(sl.quantity), 0)::int FROM "SawingLog" sl WHERE sl."intakeItemId" = wii.id) as "usedQty"
      FROM "WoodIntakeItem" wii
      WHERE wii."intakeId" = ANY($1)
      ORDER BY wii."createdAt" ASC
    `, ids) : [];

    const itemsByIntake = {};
    items.forEach(it => {
      if (!itemsByIntake[it.intakeId]) itemsByIntake[it.intakeId] = [];
      itemsByIntake[it.intakeId].push(it);
    });

    res.json({
      data: intakes.map(i => ({ ...i, items: itemsByIntake[i.id] || [] })),
      pagination: { total, page: parseInt(page), limit: take, totalPages: Math.ceil(total / take) },
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data: ' + error.message });
  }
});

// GET /api/wood/intake/:id - Detail kayu masuk
router.get('/intake/:id', auth, async (req, res) => {
  try {
    const intake = await prisma.woodIntake.findUnique({
      where: { id: req.params.id },
      include: { items: true, user: { select: { name: true } } },
    });
    if (!intake) return res.status(404).json({ error: 'Data kayu masuk tidak ditemukan' });
    const logs = await prisma.$queryRawUnsafe(`
      SELECT sl.*, poi."productName" as "targetName", poi.thickness as "targetThickness",
        poi.width as "targetWidth", poi.length as "targetLength", po."poNumber"
      FROM "SawingLog" sl
      JOIN "WoodIntakeItem" wii ON wii.id = sl."intakeItemId"
      JOIN "POItem" poi ON poi.id = sl."poItemId"
      JOIN "PurchaseOrder" po ON po.id = sl."poId"
      WHERE sl."intakeItemId" IN (SELECT id FROM "WoodIntakeItem" WHERE "intakeId" = $1)
      ORDER BY sl."createdAt" DESC
    `, req.params.id);
    res.json({ ...intake, logs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/wood/intake - Tambah kayu masuk
router.post('/intake', auth, async (req, res) => {
  try {
    const { intakeDate, supplier, vehicleNumber, notes, items } = req.body;
    if (!items || items.length === 0) return res.status(400).json({ error: 'Minimal 1 item kayu wajib diisi' });

    let totalKubikasi = 0;
    let totalQuantity = 0;
    const itemsData = items.map(i => {
      const perPcs = calcKubikasi(i.thickness || 0, i.width || 0, i.length || 0);
      const qty = Math.max(1, parseInt(i.quantity) || 1);
      totalKubikasi += perPcs * qty;
      totalQuantity += qty;
      return {
        productName: i.productName || 'Kayu',
        thickness: i.thickness || 0,
        width: i.width || 0,
        length: i.length || 0,
        quantity: qty,
        unit: i.unit || 'pcs',
        kubikasi: perPcs * qty,
        remaining: qty,
        notes: i.notes || '',
      };
    });

    const intake = await prisma.$transaction(async (tx) => {
      const date = intakeDate ? new Date(intakeDate) : new Date();
      const intakeNumber = await generateIntakeNumber(tx, date);
      const newIntake = await tx.woodIntake.create({
        data: {
          intakeNumber,
          intakeDate: date,
          supplier: supplier || '',
          vehicleNumber: vehicleNumber || '',
          notes: notes || '',
          totalKubikasi,
          totalQuantity,
          userId: req.user.id,
        },
      });
      await tx.woodIntakeItem.createMany({ data: itemsData.map(i => ({ ...i, intakeId: newIntake.id })) });
      return tx.woodIntake.findUnique({ where: { id: newIntake.id }, include: { items: true } });
    });

    res.status(201).json(intake);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/wood/intake/:id - Hapus kayu masuk (blokir jika sudah digesek)
router.delete('/intake/:id', auth, async (req, res) => {
  try {
    const intake = await prisma.woodIntake.findUnique({
      where: { id: req.params.id },
      include: { items: true, _count: { select: { items: true } } },
    });
    if (!intake) return res.status(404).json({ error: 'Data kayu masuk tidak ditemukan' });

    const itemIds = intake.items.map(i => i.id);
    if (itemIds.length > 0) {
      const used = await prisma.sawingLog.count({ where: { intakeItemId: { in: itemIds } } });
      if (used > 0) return res.status(400).json({ error: 'Kayu sudah ada yang digesek, tidak bisa dihapus. Hapus log geseknya dulu.' });
    }

    await prisma.woodIntakeItem.deleteMany({ where: { intakeId: req.params.id } });
    await prisma.woodIntake.delete({ where: { id: req.params.id } });
    res.json({ message: 'Kayu masuk berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menghapus: ' + error.message });
  }
});

// GET /api/wood/stock - Stok kayu sisa (sumber gesek)
router.get('/stock', auth, async (req, res) => {
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT wii.*, wi."intakeNumber", wi."intakeDate", wi.supplier,
        (SELECT COALESCE(SUM(sl.quantity), 0)::int FROM "SawingLog" sl WHERE sl."intakeItemId" = wii.id) as "usedQty"
      FROM "WoodIntakeItem" wii
      JOIN "WoodIntake" wi ON wi.id = wii."intakeId"
      WHERE wii.remaining > 0
      ORDER BY wi."intakeDate" DESC, wii."createdAt" ASC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/wood/po-progress - Kebutuhan item PO vs terkirim vs sudah digesek
router.get('/po-progress', auth, async (req, res) => {
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT poi.id as "poItemId", poi."poId", poi."productName", poi.thickness, poi.width, poi.length,
        poi.quantity, poi.kubikasi, poi.unit,
        po."poNumber", po."customerName", po.status,
        COALESCE(ds.shipped_qty, 0)::int as "shippedQty",
        COALESCE(sl.gesek_qty, 0)::int as "gesekQty"
      FROM "POItem" poi
      JOIN "PurchaseOrder" po ON po.id = poi."poId"
      LEFT JOIN (
        SELECT di."poItemId", SUM(di.quantity)::int as shipped_qty
        FROM "DeliveryItem" di GROUP BY di."poItemId"
      ) ds ON ds."poItemId" = poi.id
      LEFT JOIN (
        SELECT sl."poItemId", SUM(sl.quantity)::int as gesek_qty
        FROM "SawingLog" sl GROUP BY sl."poItemId"
      ) sl ON sl."poItemId" = poi.id
      WHERE po.status IN ('diterima', 'diproses', 'dikirim')
      ORDER BY po."createdAt" DESC
    `);

    const grouped = {};
    rows.forEach(r => {
      const needed = Math.max(0, r.quantity - (r.shippedQty || 0));
      const ready = r.gesekQty || 0;
      const remainingNeed = Math.max(0, needed - ready);
      if (!grouped[r.poId]) {
        grouped[r.poId] = {
          poId: r.poId, poNumber: r.poNumber, customerName: r.customerName, status: r.status,
          items: [], totalNeed: 0, totalReady: 0, totalRemaining: 0,
        };
      }
      grouped[r.poId].items.push({
        poItemId: r.poItemId, productName: r.productName, thickness: r.thickness,
        width: r.width, length: r.length, quantity: r.quantity, unit: r.unit,
        kubikasi: r.kubikasi, shippedQty: r.shippedQty || 0, gesekQty: ready,
        needed, remainingNeed,
      });
      grouped[r.poId].totalNeed += needed;
      grouped[r.poId].totalReady += Math.min(ready, needed);
      grouped[r.poId].totalRemaining += remainingNeed;
    });

    res.json({
      data: Object.values(grouped).map(g => {
        g.totalNeedQty = g.items.reduce((s, i) => s + i.quantity, 0);
        g.pctDone = g.totalNeed > 0 ? Math.min(100, Math.round(((g.totalNeed - g.totalRemaining) / g.totalNeed) * 100)) : 0;
        g.done = g.totalNeed > 0 && g.totalRemaining === 0;
        return g;
      }),
      stats: {
        totalItems: rows.length,
        totalRemainingNeed: rows.reduce((s, r) => {
          const needed = Math.max(0, r.quantity - (r.shippedQty || 0));
          return s + Math.max(0, needed - (r.gesekQty || 0));
        }, 0),
        totalReady: rows.reduce((s, r) => {
          const needed = Math.max(0, r.quantity - (r.shippedQty || 0));
          return s + Math.min(r.gesekQty || 0, needed);
        }, 0),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/wood/gesek - Riwayat gesek
router.get('/gesek', auth, async (req, res) => {
  try {
    const { limit = 30 } = req.query;
    const logs = await prisma.$queryRawUnsafe(`
      SELECT sl.*, u.name as "userName",
        wii."productName" as "sourceName", wii.thickness as "sourceThickness",
        wii.width as "sourceWidth", wii.length as "sourceLength", wii."intakeId",
        wi."intakeNumber",
        poi."productName" as "targetName", poi.thickness as "targetThickness",
        poi.width as "targetWidth", poi.length as "targetLength",
        po."poNumber"
      FROM "SawingLog" sl
      LEFT JOIN "User" u ON u.id = sl."userId"
      JOIN "WoodIntakeItem" wii ON wii.id = sl."intakeItemId"
      JOIN "WoodIntake" wi ON wi.id = wii."intakeId"
      JOIN "POItem" poi ON poi.id = sl."poItemId"
      JOIN "PurchaseOrder" po ON po.id = sl."poId"
      ORDER BY sl."createdAt" DESC
      LIMIT $1
    `, parseInt(limit));
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/wood/gesek - Gesek kayu masuk ke item PO
router.post('/gesek', auth, async (req, res) => {
  try {
    const { intakeItemId, poItemId, quantity, resultThickness, resultWidth, resultLength, notes } = req.body;
    if (!intakeItemId || !poItemId) return res.status(400).json({ error: 'Pilih stok kayu dan item PO tujuan' });

    const qty = Math.max(1, parseInt(quantity) || 1);
    const [source, target] = await Promise.all([
      prisma.woodIntakeItem.findUnique({ where: { id: intakeItemId } }),
      prisma.pOItem.findUnique({ where: { id: poItemId }, include: { po: true } }),
    ]);
    if (!source) return res.status(404).json({ error: 'Stok kayu tidak ditemukan' });
    if (!target) return res.status(404).json({ error: 'Item PO tujuan tidak ditemukan' });
    if (source.remaining < qty) return res.status(400).json({ error: `Stok tersisa hanya ${source.remaining} pcs` });

    const rT = resultThickness ?? target.thickness;
    const rW = resultWidth ?? target.width;
    const rL = resultLength ?? target.length;
    const kubOut = calcKubikasi(rT, rW, rL) * qty;

    const log = await prisma.$transaction(async (tx) => {
      const created = await tx.sawingLog.create({
        data: {
          intakeItemId,
          poItemId,
          poId: target.poId,
          quantity: qty,
          sourceThickness: source.thickness,
          sourceWidth: source.width,
          sourceLength: source.length,
          resultThickness: rT,
          resultWidth: rW,
          resultLength: rL,
          kubikasiOut: kubOut,
          notes: notes || '',
          userId: req.user.id,
        },
      });
      await tx.woodIntakeItem.update({
        where: { id: intakeItemId },
        data: { remaining: Math.max(0, source.remaining - qty) },
      });
      return created;
    });

    res.status(201).json(log);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/wood/gesek/:id - Batalkan gesek (kembalikan stok)
router.delete('/gesek/:id', auth, async (req, res) => {
  try {
    const log = await prisma.sawingLog.findUnique({ where: { id: req.params.id }, include: { intakeItem: true } });
    if (!log) return res.status(404).json({ error: 'Log gesek tidak ditemukan' });

    await prisma.$transaction(async (tx) => {
      await tx.sawingLog.delete({ where: { id: req.params.id } });
      await tx.woodIntakeItem.update({
        where: { id: log.intakeItemId },
        data: { remaining: (log.intakeItem.remaining || 0) + log.quantity },
      });
    });

    res.json({ message: 'Gesek dibatalkan, stok dikembalikan' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal membatalkan gesek: ' + error.message });
  }
});

module.exports = router;