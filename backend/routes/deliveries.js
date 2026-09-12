const express = require('express');
const prisma = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

// POST /api/deliveries - Create delivery (pengiriman)
router.post('/', auth, async (req, res) => {
  try {
    const { poId, deliveryDate, driverName, vehicleNumber, deliveryAddress, notes, items } = req.body;
    if (!poId || !items || items.length === 0) return res.status(400).json({ error: 'PO dan item wajib diisi' });

    const po = await prisma.purchaseOrder.findUnique({ where: { id: poId }, include: { items: true } });
    if (!po) return res.status(404).json({ error: 'PO tidak ditemukan' });

    // Validate quantities
    for (const item of items) {
      const poItem = po.items.find((i) => i.id === item.poItemId);
      if (!poItem) return res.status(400).json({ error: `Item ${item.poItemId} tidak ditemukan di PO` });
      if (item.quantity > poItem.quantity) {
        return res.status(400).json({ error: `Jumlah kirim melebihi jumlah pesanan untuk ${poItem.productName}` });
      }
    }

    const delivery = await prisma.$transaction(async (tx) => {
      const newDelivery = await tx.delivery.create({
        data: {
          poId,
          deliveryDate: deliveryDate ? new Date(deliveryDate) : new Date(),
          driverName: driverName || '',
          vehicleNumber: vehicleNumber || '',
          deliveryAddress: deliveryAddress || '',
          notes: notes || '',
        },
      });

      const deliveryItems = items.map((i) => {
        const poItem = po.items.find((pi) => pi.id === i.poItemId);
        const kubPerPcs = poItem.kubikasi / poItem.quantity;
        return {
          deliveryId: newDelivery.id,
          poItemId: i.poItemId,
          quantity: i.quantity,
          kubikasi: kubPerPcs * i.quantity,
          notes: i.notes || '',
        };
      });

      await tx.deliveryItem.createMany({ data: deliveryItems });

      // Update PO status to dikirim
      await tx.purchaseOrder.update({ where: { id: poId }, data: { status: 'dikirim' } });

      return tx.delivery.findUnique({ where: { id: newDelivery.id }, include: { items: { include: { poItem: true } } } });
    });

    res.status(201).json(delivery);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/deliveries/po/:poId - Get deliveries for a PO
router.get('/po/:poId', auth, async (req, res) => {
  try {
    const deliveries = await prisma.delivery.findMany({
      where: { poId: req.params.poId },
      include: { items: { include: { poItem: true } } },
      orderBy: { deliveryDate: 'desc' },
    });
    res.json(deliveries);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data' });
  }
});

// GET /api/deliveries/:id - Get single delivery
router.get('/:id', auth, async (req, res) => {
  try {
    const delivery = await prisma.delivery.findUnique({
      where: { id: req.params.id },
      include: { items: { include: { poItem: true } } },
    });
    if (!delivery) return res.status(404).json({ error: 'Pengiriman tidak ditemukan' });
    res.json(delivery);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/deliveries/:id - Update delivery
router.put('/:id', auth, async (req, res) => {
  try {
    const { deliveryDate, driverName, vehicleNumber, deliveryAddress, notes, items } = req.body;
    const existing = await prisma.delivery.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!existing) return res.status(404).json({ error: 'Pengiriman tidak ditemukan' });

    const delivery = await prisma.$transaction(async (tx) => {
      // Delete old items
      await tx.deliveryItem.deleteMany({ where: { deliveryId: req.params.id } });

      // Update delivery info
      await tx.delivery.update({
        where: { id: req.params.id },
        data: {
          deliveryDate: deliveryDate ? new Date(deliveryDate) : existing.deliveryDate,
          driverName: driverName ?? existing.driverName,
          vehicleNumber: vehicleNumber ?? existing.vehicleNumber,
          deliveryAddress: deliveryAddress ?? existing.deliveryAddress,
          notes: notes ?? existing.notes,
        },
      });

      // Create new items if provided
      if (items && items.length > 0) {
        const po = await tx.purchaseOrder.findUnique({ where: { id: existing.poId }, include: { items: true } });
        const deliveryItems = items.map((i) => {
          const poItem = po.items.find((pi) => pi.id === i.poItemId);
          const kubPerPcs = poItem.kubikasi / poItem.quantity;
          return {
            deliveryId: req.params.id,
            poItemId: i.poItemId,
            quantity: i.quantity,
            kubikasi: kubPerPcs * i.quantity,
            notes: i.notes || '',
          };
        });
        await tx.deliveryItem.createMany({ data: deliveryItems });
      }

      return tx.delivery.findUnique({ where: { id: req.params.id }, include: { items: { include: { poItem: true } } } });
    });

    res.json(delivery);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/deliveries/:id - Delete delivery
router.delete('/:id', auth, async (req, res) => {
  try {
    const delivery = await prisma.delivery.findUnique({ where: { id: req.params.id } });
    if (!delivery) return res.status(404).json({ error: 'Pengiriman tidak ditemukan' });
    await prisma.deliveryItem.deleteMany({ where: { deliveryId: req.params.id } });
    await prisma.delivery.delete({ where: { id: req.params.id } });
    res.json({ message: 'Pengiriman berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menghapus pengiriman' });
  }
});

// POST /api/deliveries/:id/proof - Upload bukti surat jalan
router.post('/:id/proof', auth, async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'Gambar wajib diupload' });

    const delivery = await prisma.delivery.findUnique({ where: { id: req.params.id }, include: { po: true } });
    if (!delivery) return res.status(404).json({ error: 'Pengiriman tidak ditemukan' });

    const googleScriptUrl = process.env.GOOGLE_SCRIPT_URL;
    if (!googleScriptUrl) return res.status(500).json({ error: 'Google Script URL belum dikonfigurasi' });

    // Kirim foto ke Google Apps Script → Google Drive
    const response = await fetch(googleScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: image.replace(/^data:image\/\w+;base64,/, ''),
        mimeType: 'image/jpeg',
        deliveryId: delivery.id,
        poNumber: delivery.po.poNumber,
        customerName: delivery.po.customerName,
      }),
    });

    const result = await response.json();
    if (result.error) throw new Error(result.error);

    // Simpan URL foto ke database
    await prisma.delivery.update({
      where: { id: req.params.id },
      data: { proofUrl: result.url },
    });

    res.json({ url: result.url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/deliveries/:id/proof - Ambil bukti surat jalan
router.get('/:id/proof', auth, async (req, res) => {
  try {
    const delivery = await prisma.delivery.findUnique({ where: { id: req.params.id }, select: { proofUrl: true } });
    if (!delivery) return res.status(404).json({ error: 'Pengiriman tidak ditemukan' });
    res.json({ proofUrl: delivery.proofUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
