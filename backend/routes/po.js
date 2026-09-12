const express = require('express');
const prisma = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

function calcKubikasi(thickness, width, length) {
  return (thickness / 100) * (width / 100) * (length / 100);
}

// GET /api/po - List all POs with summary (single raw query for speed)
router.get('/', auth, async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);
    const params = [];
    const conditions = ['1=1'];

    if (status) { params.push(status); conditions.push(`p.status = $${params.length}`); }
    if (search) { params.push(`%${search}%`); conditions.push(`(p."poNumber" ILIKE $${params.length} OR p."customerName" ILIKE $${params.length})`); }

    const whereClause = conditions.join(' AND ');

    const countResult = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as total FROM "PurchaseOrder" p WHERE ${whereClause}`, ...params
    );
    const total = countResult[0]?.total || 0;

    params.push(take); const lim = params.length;
    params.push(skip); const off = params.length;

    const pos = await prisma.$queryRawUnsafe(`
      SELECT p.*, u.name as "userName",
        COALESCE(s.ship_kub, 0) as "shippedKubikasi",
        COALESCE(s.ship_qty, 0) as "shippedQuantity"
      FROM "PurchaseOrder" p
      LEFT JOIN "User" u ON u.id = p."userId"
      LEFT JOIN (
        SELECT poi."poId", SUM(di.kubikasi) as ship_kub, SUM(di.quantity) as ship_qty
        FROM "DeliveryItem" di
        JOIN "POItem" poi ON poi.id = di."poItemId"
        GROUP BY poi."poId"
      ) s ON s."poId" = p.id
      WHERE ${whereClause}
      ORDER BY p."createdAt" DESC
      LIMIT $${lim} OFFSET $${off}
    `, ...params);

    const itemParams = pos.map(p => p.id);
    const items = itemParams.length > 0 ? await prisma.$queryRawUnsafe(`
      SELECT * FROM "POItem" WHERE "poId" = ANY($1)
    `, itemParams) : [];

    const itemsByPo = {};
    items.forEach(i => {
      if (!itemsByPo[i.poId]) itemsByPo[i.poId] = [];
      itemsByPo[i.poId].push(i);
    });

    const enriched = pos.map(po => ({
      ...po,
      items: itemsByPo[po.id] || [],
      user: po.userName ? { name: po.userName } : null,
      remainingKubikasi: (Number(po.totalKubikasi) || 0) - (Number(po.shippedKubikasi) || 0),
      remainingQuantity: (po.totalQuantity || 0) - (po.shippedQuantity || 0),
    }));

    res.json({
      data: enriched,
      pagination: { total, page: parseInt(page), limit: take, totalPages: Math.ceil(total / take) },
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data: ' + error.message });
  }
});

// GET /api/po/stats - Dashboard statistics (single raw query)
router.get('/stats', auth, async (req, res) => {
  try {
    const [totals] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as "totalPO",
        COUNT(*) FILTER (WHERE status = 'diterima')::int as diterima,
        COUNT(*) FILTER (WHERE status = 'diproses')::int as diproses,
        COUNT(*) FILTER (WHERE status = 'dikirim')::int as dikirim,
        COUNT(*) FILTER (WHERE status = 'selesai')::int as selesai,
        COUNT(*) FILTER (WHERE status = 'dibatalkan')::int as dibatalkan,
        COALESCE(SUM("totalKubikasi"), 0) as "totalKubikasi",
        COALESCE(SUM("totalQuantity"), 0) as "totalQuantity"
      FROM "PurchaseOrder"
    `);
    const [shipped] = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(SUM(kubikasi), 0) as "shippedKubikasi", COALESCE(SUM(quantity), 0) as "shippedQuantity"
      FROM "DeliveryItem"
    `);

    const totalKubikasi = Number(totals.totalKubikasi) || 0;
    const totalQuantity = totals.totalQuantity || 0;
    const shippedKubikasi = Number(shipped.shippedKubikasi) || 0;
    const shippedQuantity = shipped.shippedQuantity || 0;

    res.json({
      totalPO: totals.totalPO,
      statusBreakdown: { diterima: totals.diterima, diproses: totals.diproses, dikirim: totals.dikirim, selesai: totals.selesai, dibatalkan: totals.dibatalkan },
      totalKubikasi: Math.round(totalKubikasi * 10000) / 10000,
      totalQuantity,
      shippedKubikasi: Math.round(shippedKubikasi * 10000) / 10000,
      shippedQuantity,
      remainingKubikasi: Math.round((totalKubikasi - shippedKubikasi) * 10000) / 10000,
      remainingQuantity: totalQuantity - shippedQuantity,
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil statistik: ' + error.message });
  }
});

// GET /api/po/:id - Get single PO
router.get('/:id', auth, async (req, res) => {
  try {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { items: true, deliveries: { include: { items: { include: { poItem: true } }, proofs: true, deliveryPOs: { include: { po: true } } } }, user: { select: { name: true } } },
    });
    if (!po) return res.status(404).json({ error: 'PO tidak ditemukan' });

    let shippedKubikasi = 0;
    let shippedQuantity = 0;
    po.deliveries.forEach((d) => {
      d.items.forEach((di) => {
        shippedKubikasi += di.kubikasi;
        shippedQuantity += di.quantity;
      });
    });

    res.json({
      ...po,
      shippedKubikasi,
      shippedQuantity,
      remainingKubikasi: po.totalKubikasi - shippedKubikasi,
      remainingQuantity: po.totalQuantity - shippedQuantity,
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data' });
  }
});

// POST /api/po - Create new PO
router.post('/', auth, async (req, res) => {
  try {
    const { poNumber, customerName, orderDate, deadline, notes, items } = req.body;
    if (!poNumber || !customerName) return res.status(400).json({ error: 'Nomor PO dan nama customer wajib diisi' });
    const existing = await prisma.purchaseOrder.findUnique({ where: { poNumber } });
    if (existing) return res.status(400).json({ error: 'Nomor PO sudah ada' });

    let totalKubikasi = 0;
    let totalQuantity = 0;
    const itemsData = (items || []).map((i) => {
      const kubikasi = calcKubikasi(i.thickness || 0, i.width || 0, i.length || 0) * (i.quantity || 1);
      totalKubikasi += kubikasi;
      totalQuantity += i.quantity || 1;
      return {
        productName: i.productName || 'Unknown',
        thickness: i.thickness || 0,
        width: i.width || 0,
        length: i.length || 0,
        quantity: i.quantity || 1,
        unit: i.unit || 'pcs',
        kubikasi,
        notes: i.notes || '',
      };
    });

    const po = await prisma.$transaction(async (tx) => {
      const newPO = await tx.purchaseOrder.create({
        data: {
          poNumber,
          customerName,
          orderDate: orderDate ? new Date(orderDate) : new Date(),
          deadline: deadline ? new Date(deadline) : null,
          notes: notes || '',
          totalKubikasi,
          totalQuantity,
          userId: req.user.id,
        },
      });
      if (itemsData.length > 0) {
        await tx.pOItem.createMany({ data: itemsData.map((i) => ({ ...i, poId: newPO.id })) });
      }
      return tx.purchaseOrder.findUnique({ where: { id: newPO.id }, include: { items: true, user: { select: { name: true } } } });
    });

    res.status(201).json(po);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/po/:id - Update PO
router.put('/:id', auth, async (req, res) => {
  try {
    const { poNumber, customerName, orderDate, deadline, notes, status, items } = req.body;
    const existing = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'PO tidak ditemukan' });

    if (poNumber && poNumber !== existing.poNumber) {
      const dup = await prisma.purchaseOrder.findUnique({ where: { poNumber } });
      if (dup) return res.status(400).json({ error: 'Nomor PO sudah ada' });
    }

    let totalKubikasi = 0;
    let totalQuantity = 0;

    const po = await prisma.$transaction(async (tx) => {
      if (items) {
        await tx.pOItem.deleteMany({ where: { poId: req.params.id } });
        const itemsData = items.map((i) => {
          const kubikasi = calcKubikasi(i.thickness || 0, i.width || 0, i.length || 0) * (i.quantity || 1);
          totalKubikasi += kubikasi;
          totalQuantity += i.quantity || 1;
          return {
            poId: req.params.id,
            productName: i.productName || 'Unknown',
            thickness: i.thickness || 0,
            width: i.width || 0,
            length: i.length || 0,
            quantity: i.quantity || 1,
            unit: i.unit || 'pcs',
            kubikasi,
            notes: i.notes || '',
          };
        });
        if (itemsData.length > 0) await tx.pOItem.createMany({ data: itemsData });
      } else {
        const oldItems = await tx.pOItem.findMany({ where: { poId: req.params.id } });
        oldItems.forEach((i) => {
          totalKubikasi += i.kubikasi;
          totalQuantity += i.quantity;
        });
      }

      return tx.purchaseOrder.update({
        where: { id: req.params.id },
        data: {
          ...(poNumber && { poNumber }),
          ...(customerName && { customerName }),
          ...(orderDate && { orderDate: new Date(orderDate) }),
          ...(deadline !== undefined && { deadline: deadline ? new Date(deadline) : null }),
          ...(notes !== undefined && { notes }),
          ...(status && { status }),
          totalKubikasi,
          totalQuantity,
        },
        include: { items: true, user: { select: { name: true } } },
      });
    });

    res.json(po);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/po/:id/status - Update PO status
router.put('/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const po = await prisma.purchaseOrder.update({ where: { id: req.params.id }, data: { status }, include: { items: true } });
    res.json(po);
  } catch (error) {
    res.status(500).json({ error: 'Gagal update status' });
  }
});

// DELETE /api/po/:id - Delete PO
router.delete('/:id', auth, async (req, res) => {
  try {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!po) return res.status(404).json({ error: 'PO tidak ditemukan' });
    await prisma.poItem.deleteMany({ where: { poId: req.params.id } });
    await prisma.purchaseOrder.delete({ where: { id: req.params.id } });
    res.json({ message: 'PO berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menghapus PO' });
  }
});

// POST /api/po/:id/items - Add item to PO
router.post('/:id/items', auth, async (req, res) => {
  try {
    const { productName, thickness, width, length, quantity, unit, notes } = req.body;
    const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!po) return res.status(404).json({ error: 'PO tidak ditemukan' });

    const kubikasi = calcKubikasi(thickness || 0, width || 0, length || 0) * (quantity || 1);
    const item = await prisma.pOItem.create({
      data: {
        poId: req.params.id,
        productName: productName || 'Unknown',
        thickness: thickness || 0,
        width: width || 0,
        length: length || 0,
        quantity: quantity || 1,
        unit: unit || 'pcs',
        kubikasi,
        notes: notes || '',
      },
    });

    // Recalculate PO totals
    const allItems = await prisma.pOItem.findMany({ where: { poId: req.params.id } });
    const totalKubikasi = allItems.reduce((s, i) => s + i.kubikasi, 0);
    const totalQuantity = allItems.reduce((s, i) => s + i.quantity, 0);
    await prisma.purchaseOrder.update({ where: { id: req.params.id }, data: { totalKubikasi, totalQuantity } });

    res.status(201).json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/po/:poId/items/:itemId - Update item
router.put('/:poId/items/:itemId', auth, async (req, res) => {
  try {
    const { productName, thickness, width, length, quantity, unit, notes } = req.body;
    const existing = await prisma.pOItem.findUnique({ where: { id: req.params.itemId } });
    if (!existing) return res.status(404).json({ error: 'Item tidak ditemukan' });

    const kubikasi = calcKubikasi(thickness || existing.thickness, width || existing.width, length || existing.length) * (quantity || existing.quantity);
    const item = await prisma.pOItem.update({
      where: { id: req.params.itemId },
      data: {
        productName: productName || existing.productName,
        thickness: thickness ?? existing.thickness,
        width: width ?? existing.width,
        length: length ?? existing.length,
        quantity: quantity ?? existing.quantity,
        unit: unit || existing.unit,
        kubikasi,
        notes: notes ?? existing.notes,
      },
    });

    // Recalculate PO totals
    const allItems = await prisma.pOItem.findMany({ where: { poId: req.params.poId } });
    const totalKubikasi = allItems.reduce((s, i) => s + i.kubikasi, 0);
    const totalQuantity = allItems.reduce((s, i) => s + i.quantity, 0);
    await prisma.purchaseOrder.update({ where: { id: req.params.poId }, data: { totalKubikasi, totalQuantity } });

    res.json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/po/:poId/items/:itemId - Delete item
router.delete('/:poId/items/:itemId', auth, async (req, res) => {
  try {
    const existing = await prisma.pOItem.findUnique({ where: { id: req.params.itemId } });
    if (!existing) return res.status(404).json({ error: 'Item tidak ditemukan' });

    await prisma.pOItem.delete({ where: { id: req.params.itemId } });

    // Recalculate PO totals
    const allItems = await prisma.pOItem.findMany({ where: { poId: req.params.poId } });
    const totalKubikasi = allItems.reduce((s, i) => s + i.kubikasi, 0);
    const totalQuantity = allItems.reduce((s, i) => s + i.quantity, 0);
    await prisma.purchaseOrder.update({ where: { id: req.params.poId }, data: { totalKubikasi, totalQuantity } });

    res.json({ message: 'Item berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
