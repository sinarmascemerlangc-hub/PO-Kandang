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
    const where = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { poNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
      ];
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [pos, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: { items: true, deliveries: { include: { items: true } }, user: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    const enriched = pos.map((po) => {
      let shippedKubikasi = 0;
      let shippedQuantity = 0;
      po.deliveries.forEach((d) => {
        d.items.forEach((di) => {
          shippedKubikasi += di.kubikasi;
          shippedQuantity += di.quantity;
        });
      });
      return {
        ...po,
        shippedKubikasi,
        shippedQuantity,
        remainingKubikasi: po.totalKubikasi - shippedKubikasi,
        remainingQuantity: po.totalQuantity - shippedQuantity,
      };
    });

    res.json({
      data: enriched,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data: ' + error.message });
  }
});

// GET /api/po/stats - Dashboard statistics
router.get('/stats', auth, async (req, res) => {
  try {
    const [totalPO, diterima, diproses, dikirim, selesai, dibatalkan] = await Promise.all([
      prisma.purchaseOrder.count(),
      prisma.purchaseOrder.count({ where: { status: 'diterima' } }),
      prisma.purchaseOrder.count({ where: { status: 'diproses' } }),
      prisma.purchaseOrder.count({ where: { status: 'dikirim' } }),
      prisma.purchaseOrder.count({ where: { status: 'selesai' } }),
      prisma.purchaseOrder.count({ where: { status: 'dibatalkan' } }),
    ]);

    const allPO = await prisma.purchaseOrder.findMany({
      include: { items: true, deliveries: { include: { items: true } } },
    });

    let totalKubikasi = 0;
    let totalQuantity = 0;
    let shippedKubikasi = 0;
    let shippedQuantity = 0;
    let remainingKubikasi = 0;
    let remainingQuantity = 0;

    allPO.forEach((po) => {
      const poShipped = {};
      po.deliveries.forEach((d) => {
        d.items.forEach((di) => {
          poShipped[di.poItemId] = (poShipped[di.poItemId] || 0) + di.quantity;
        });
      });
      po.items.forEach((item) => {
        totalKubikasi += item.kubikasi;
        totalQuantity += item.quantity;
        const shipped = poShipped[item.id] || 0;
        const kubPerPcs = item.kubikasi / item.quantity;
        shippedKubikasi += kubPerPcs * shipped;
        shippedQuantity += shipped;
        remainingKubikasi += kubPerPcs * (item.quantity - shipped);
        remainingQuantity += item.quantity - shipped;
      });
    });

    res.json({
      totalPO,
      statusBreakdown: { diterima, diproses, dikirim, selesai, dibatalkan },
      totalKubikasi: Math.round(totalKubikasi * 10000) / 10000,
      totalQuantity,
      shippedKubikasi: Math.round(shippedKubikasi * 10000) / 10000,
      shippedQuantity,
      remainingKubikasi: Math.round(remainingKubikasi * 10000) / 10000,
      remainingQuantity,
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
      include: { items: true, deliveries: { include: { items: { include: { poItem: true } } } }, user: { select: { name: true } } },
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
