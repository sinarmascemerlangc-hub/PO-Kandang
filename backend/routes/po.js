const express = require('express');
const prisma = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

function calcKubikasi(thickness, width, length) {
  return (thickness / 100) * (width / 100) * (length / 100);
}

// GET /api/po - List all POs with summary
router.get('/', auth, async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);
    const searchParams = [];
    const conditions = ['1=1'];

    if (status) { searchParams.push(status); conditions.push(`p.status = $${searchParams.length}`); }
    if (search) { searchParams.push(`%${search}%`); conditions.push(`(p."poNumber" ILIKE $${searchParams.length} OR p."customerName" ILIKE $${searchParams.length})`); }

    const whereClause = conditions.join(' AND ');

    const countResult = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as total FROM "PurchaseOrder" p WHERE ${whereClause}`, ...searchParams
    );
    const total = countResult[0]?.total || 0;

    const listParams = [...searchParams, take, skip];
    const lim = listParams.length - 1;
    const off = listParams.length;

    const [pos, items] = await Promise.all([
      prisma.$queryRawUnsafe(`
        SELECT p.*, u.name as "userName",
          COALESCE(s.ship_kub, 0)::float as "shippedKubikasi",
          COALESCE(s.ship_qty, 0)::int as "shippedQuantity"
        FROM "PurchaseOrder" p
        LEFT JOIN "User" u ON u.id = p."userId"
        LEFT JOIN (
          SELECT poi."poId", SUM(di.kubikasi)::float as ship_kub, SUM(di.quantity)::int as ship_qty
          FROM "DeliveryItem" di
          JOIN "POItem" poi ON poi.id = di."poItemId"
          GROUP BY poi."poId"
        ) s ON s."poId" = p.id
        WHERE ${whereClause}
        ORDER BY p."createdAt" DESC
        LIMIT $${lim} OFFSET $${off}
      `, ...listParams),
      prisma.$queryRawUnsafe(`
        SELECT poi.* FROM "POItem" poi
        JOIN "PurchaseOrder" p ON p.id = poi."poId"
        WHERE ${whereClause}
      `, ...searchParams),
    ]);

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

// GET /api/po/report-items - All POs with per-item shipped quantities (for Laporan tabs)
router.get('/report-items', auth, async (req, res) => {
  try {
    const pos = await prisma.$queryRawUnsafe(`
      SELECT p.*, COALESCE(s.ship_kub, 0)::float as "shippedKubikasi",
        COALESCE(s.ship_qty, 0)::int as "shippedQuantity"
      FROM "PurchaseOrder" p
      LEFT JOIN (
        SELECT poi."poId", SUM(di.kubikasi)::float as ship_kub, SUM(di.quantity)::int as ship_qty
        FROM "DeliveryItem" di JOIN "POItem" poi ON poi.id = di."poItemId"
        GROUP BY poi."poId"
      ) s ON s."poId" = p.id
      ORDER BY p."createdAt" DESC
    `);

    const poIds = pos.map(p => p.id);
    if (poIds.length === 0) return res.json([]);

    const items = await prisma.$queryRawUnsafe(`
      SELECT poi.*, COALESCE(ds.shipped_qty, 0)::int as "shippedQty",
        COALESCE(ds.shipped_kub, 0)::float as "shippedKubikasi"
      FROM "POItem" poi
      LEFT JOIN (
        SELECT di."poItemId", SUM(di.quantity)::int as shipped_qty, SUM(di.kubikasi)::float as shipped_kub
        FROM "DeliveryItem" di
        GROUP BY di."poItemId"
      ) ds ON ds."poItemId" = poi.id
      WHERE poi."poId" = ANY($1)
    `, poIds);

    const itemsByPo = {};
    items.forEach(i => {
      if (!itemsByPo[i.poId]) itemsByPo[i.poId] = [];
      const sisaQty = (i.quantity || 0) - (i.shippedQty || 0);
      const kubikasiPerUnit = (i.thickness / 100) * (i.width / 100) * (i.length / 100);
      const sisaKub = kubikasiPerUnit * sisaQty;
      itemsByPo[i.poId].push({
        id: i.id, productName: i.productName, thickness: i.thickness,
        width: i.width, length: i.length, quantity: i.quantity, unit: i.unit,
        kubikasi: kubikasiPerUnit * (i.quantity || 0),
        shippedQty: i.shippedQty || 0, shippedKubikasi: i.shippedKubikasi || 0,
        sisaQty, sisaKubikasi: sisaKub,
      });
    });

    const enriched = pos.map(po => ({
      id: po.id, poNumber: po.poNumber, customerName: po.customerName,
      orderDate: po.orderDate, deadline: po.deadline, status: po.status,
      totalQuantity: po.totalQuantity, totalKubikasi: po.totalKubikasi,
      shippedKubikasi: po.shippedKubikasi, shippedQuantity: po.shippedQuantity,
      items: itemsByPo[po.id] || [],
    }));

    res.json(enriched);
  } catch (error) {
    console.error('PO report items error:', error);
    res.status(500).json({ error: error.message });
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
        COALESCE(SUM("totalKubikasi")::float, 0) as "totalKubikasi",
        COALESCE(SUM("totalQuantity")::int, 0) as "totalQuantity"
      FROM "PurchaseOrder"
    `);
    const [shipped] = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(SUM(kubikasi)::float, 0) as "shippedKubikasi", COALESCE(SUM(quantity)::int, 0) as "shippedQuantity"
      FROM "DeliveryItem"
    `);

    const totalKubikasi = Number(totals.totalKubikasi) || 0;
    const totalQuantity = Number(totals.totalQuantity) || 0;
    const shippedKubikasi = Number(shipped.shippedKubikasi) || 0;
    const shippedQuantity = Number(shipped.shippedQuantity) || 0;

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
      include: { items: true, user: { select: { name: true } } },
    });
    if (!po) return res.status(404).json({ error: 'PO tidak ditemukan' });

    // Fetch deliveries via DeliveryPO junction table
    const deliveryRows = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT d.*
      FROM "Delivery" d
      JOIN "DeliveryPO" dp ON dp."deliveryId" = d.id
      WHERE dp."poId" = $1
      ORDER BY d."deliveryDate" DESC
    `, po.id);

    const deliveryItems = await prisma.$queryRawUnsafe(`
      SELECT di.*, poi."productName", poi.thickness, poi.width, poi.length
      FROM "DeliveryItem" di
      JOIN "POItem" poi ON poi.id = di."poItemId"
      JOIN "DeliveryPO" dp ON dp."deliveryId" = di."deliveryId"
      WHERE dp."poId" = $1
    `, po.id);

    const proofs = await prisma.$queryRawUnsafe(`
      SELECT dp2.*
      FROM "DeliveryProof" dp2
      JOIN "DeliveryPO" dpo ON dpo."deliveryId" = dp2."deliveryId"
      WHERE dpo."poId" = $1
    `, po.id);

    const deliveryPOs = await prisma.$queryRawUnsafe(`
      SELECT dpo.*, p."poNumber"
      FROM "DeliveryPO" dpo
      JOIN "PurchaseOrder" p ON p.id = dpo."poId"
      WHERE dpo."deliveryId" IN (SELECT "deliveryId" FROM "DeliveryPO" WHERE "poId" = $1)
    `, po.id);

    // Assemble deliveries with items, proofs, deliveryPOs
    const deliveries = deliveryRows.map(d => ({
      ...d,
      items: deliveryItems.filter(di => di.deliveryId === d.id).map(di => ({
        id: di.id, deliveryId: di.deliveryId, poItemId: di.poItemId,
        quantity: di.quantity, kubikasi: di.kubikasi, notes: di.notes,
        poItem: { id: di.poItemId, productName: di.productName, thickness: di.thickness, width: di.width, length: di.length },
      })),
      proofs: proofs.filter(p => p.deliveryId === d.id),
      deliveryPOs: deliveryPOs.filter(dp => dp.deliveryId === d.id).map(dp => ({
        poId: dp.poId,
        po: { id: dp.poId, poNumber: dp.poNumber },
      })),
    }));

    let shippedKubikasi = 0;
    let shippedQuantity = 0;
    deliveries.forEach((d) => {
      d.items.forEach((di) => {
        shippedKubikasi += di.kubikasi;
        shippedQuantity += di.quantity;
      });
    });

    res.json({
      ...po,
      deliveries,
      shippedKubikasi,
      shippedQuantity,
      remainingKubikasi: po.totalKubikasi - shippedKubikasi,
      remainingQuantity: po.totalQuantity - shippedQuantity,
    });
  } catch (error) {
    console.error('PO detail error:', error);
    res.status(500).json({ error: 'Gagal mengambil data: ' + error.message });
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
