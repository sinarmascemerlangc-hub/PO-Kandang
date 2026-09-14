const express = require('express');
const prisma = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/deliveries/proxy-image?url=... (MUST be before /:id routes)
router.get('/proxy-image', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url required' });
    let directUrl = url;
    const gdMatch = url.match(/drive\.google\.com\/file\/d\/([^/?]+)/);
    if (gdMatch) directUrl = `https://drive.google.com/uc?export=view&id=${gdMatch[1]}`;
    const response = await fetch(directUrl);
    if (!response.ok) throw new Error('Failed to fetch image');
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(buffer));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/deliveries - Create delivery (multi-PO support)
router.post('/', auth, async (req, res) => {
  try {
    const { deliveryDate, driverName, vehicleNumber, deliveryAddress, notes, items, poIds } = req.body;
    if (!items || items.length === 0) return res.status(400).json({ error: 'Item wajib diisi' });

    // Support both old format (single poId) and new format (poIds array)
    const allPoIds = poIds && poIds.length > 0 ? poIds : (req.body.poId ? [req.body.poId] : []);
    if (allPoIds.length === 0) return res.status(400).json({ error: 'Minimal 1 PO harus dipilih' });

    // Validate all POs exist
    const pos = await prisma.purchaseOrder.findMany({
      where: { id: { in: allPoIds } },
      include: { items: true },
    });
    if (pos.length !== allPoIds.length) return res.status(400).json({ error: 'Salah satu PO tidak ditemukan' });

    // Validate all items belong to the selected POs
    const allPoItemIds = pos.flatMap(p => p.items.map(i => i.id));
    for (const item of items) {
      if (!allPoItemIds.includes(item.poItemId)) {
        return res.status(400).json({ error: `Item ${item.poItemId} bukan milik PO yang dipilih` });
      }
    }

    const delivery = await prisma.$transaction(async (tx) => {
      const newDelivery = await tx.delivery.create({
        data: {
          deliveryDate: deliveryDate ? new Date(deliveryDate) : new Date(),
          driverName: driverName || '',
          vehicleNumber: vehicleNumber || '',
          deliveryAddress: deliveryAddress || '',
          notes: notes || '',
          poId: allPoIds[0] || null,
        },
      });

      // Link delivery to POs
      if (allPoIds.length > 0) {
        await tx.deliveryPO.createMany({
          data: allPoIds.map(poId => ({ deliveryId: newDelivery.id, poId })),
        });
      }

      // Create delivery items with kubikasi calculation
      const poItemMap = {};
      pos.forEach(p => p.items.forEach(i => { poItemMap[i.id] = i; }));

      const deliveryItems = items.map((i) => {
        const poItem = poItemMap[i.poItemId];
        const kubPerPcs = poItem.quantity > 0 ? poItem.kubikasi / poItem.quantity : 0;
        return {
          deliveryId: newDelivery.id,
          poItemId: i.poItemId,
          quantity: i.quantity,
          kubikasi: kubPerPcs * i.quantity,
          notes: i.notes || '',
        };
      });

      await tx.deliveryItem.createMany({ data: deliveryItems });

      // Update all linked PO statuses
      await tx.purchaseOrder.updateMany({
        where: { id: { in: allPoIds } },
        data: { status: 'dikirim' },
      });

      return tx.delivery.findUnique({
        where: { id: newDelivery.id },
        include: {
          items: { include: { poItem: true } },
          proofs: true,
          deliveryPOs: { include: { po: true } },
        },
      });
    });

    res.status(201).json(delivery);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/deliveries/all-report - Flat list of ALL deliveries with items + PO info (for Laporan Pengiriman)
router.get('/all-report', auth, async (req, res) => {
  try {
    const deliveries = await prisma.$queryRawUnsafe(`
      SELECT d.*,
        (SELECT array_agg(DISTINCT p."poNumber") FROM "DeliveryPO" dpo JOIN "PurchaseOrder" p ON p.id = dpo."poId" WHERE dpo."deliveryId" = d.id) as "poNumbers",
        (SELECT array_agg(DISTINCT p."customerName") FROM "DeliveryPO" dpo JOIN "PurchaseOrder" p ON p.id = dpo."poId" WHERE dpo."deliveryId" = d.id) as "customerNames"
      FROM "Delivery" d
      ORDER BY d."deliveryDate" DESC
    `);

    if (deliveries.length === 0) return res.json([]);

    const dIds = deliveries.map(d => d.id);

    const items = await prisma.$queryRawUnsafe(`
      SELECT di.*, poi."productName", poi.thickness, poi.width, poi.length
      FROM "DeliveryItem" di
      JOIN "POItem" poi ON poi.id = di."poItemId"
      WHERE di."deliveryId" = ANY($1)
    `, dIds);

    const enriched = deliveries.map(d => ({
      id: d.id,
      deliveryDate: d.deliveryDate,
      driverName: d.driverName,
      vehicleNumber: d.vehicleNumber,
      deliveryAddress: d.deliveryAddress,
      notes: d.notes,
      poNumbers: d.poNumbers || [],
      customerNames: d.customerNames || [],
      items: items.filter(i => i.deliveryId === d.id).map(i => ({
        productName: i.productName,
        thickness: i.thickness,
        width: i.width,
        length: i.length,
        quantity: i.quantity,
        kubikasi: i.kubikasi,
      })),
    }));

    res.json(enriched);
  } catch (error) {
    console.error('All deliveries report error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/deliveries - List all deliveries
router.get('/', auth, async (req, res) => {
  try {
    const { limit = 50, page = 1 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const deliveries = await prisma.$queryRawUnsafe(`
      SELECT d.*, 
        (SELECT array_agg(DISTINCT p."poNumber") FROM "DeliveryPO" dpo JOIN "PurchaseOrder" p ON p.id = dpo."poId" WHERE dpo."deliveryId" = d.id) as "poNumbers"
      FROM "Delivery" d
      ORDER BY d."deliveryDate" DESC
      LIMIT $1 OFFSET $2
    `, take, skip);

    const items = await prisma.$queryRawUnsafe(`
      SELECT di.*, poi."productName", poi.thickness, poi.width, poi.length
      FROM "DeliveryItem" di
      JOIN "POItem" poi ON poi.id = di."poItemId"
    `);

    const enriched = deliveries.map(d => ({
      ...d,
      poNumbers: d.poNumbers || [],
      items: items.filter(i => i.deliveryId === d.id).map(i => ({
        id: i.id, deliveryId: i.deliveryId, poItemId: i.poItemId,
        quantity: i.quantity, kubikasi: i.kubikasi, notes: i.notes,
        poItem: { productName: i.productName, thickness: i.thickness, width: i.width, length: i.length },
      })),
    }));

    res.json(enriched);
  } catch (error) {
    console.error('Deliveries list error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/deliveries/:id - Update delivery (multi-PO support)
router.put('/:id', auth, async (req, res) => {
  try {
    const { deliveryDate, driverName, vehicleNumber, deliveryAddress, notes, items, poIds } = req.body;
    const existing = await prisma.delivery.findUnique({ where: { id: req.params.id }, include: { items: true } });
    if (!existing) return res.status(404).json({ error: 'Pengiriman tidak ditemukan' });

    const allPoIds = poIds && poIds.length > 0 ? poIds : (req.body.poId ? [req.body.poId] : []);

    const delivery = await prisma.$transaction(async (tx) => {
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

      // Update PO links
      if (allPoIds.length > 0) {
        await tx.deliveryPO.deleteMany({ where: { deliveryId: req.params.id } });
        await tx.deliveryPO.createMany({
          data: allPoIds.map(poId => ({ deliveryId: req.params.id, poId })),
        });
      }

      // Update items if provided
      if (items && items.length > 0) {
        await tx.deliveryItem.deleteMany({ where: { deliveryId: req.params.id } });
        const poIdsForItems = allPoIds.length > 0 ? allPoIds : [existing.poId].filter(Boolean);
        const pos = await tx.purchaseOrder.findMany({
          where: { id: { in: poIdsForItems } },
          include: { items: true },
        });
        const poItemMap = {};
        pos.forEach(p => p.items.forEach(i => { poItemMap[i.id] = i; }));

        const deliveryItems = items.map((i) => {
          const poItem = poItemMap[i.poItemId];
          const kubPerPcs = poItem.quantity > 0 ? poItem.kubikasi / poItem.quantity : 0;
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

      return tx.delivery.findUnique({
        where: { id: req.params.id },
        include: {
          items: { include: { poItem: true } },
          proofs: true,
          deliveryPOs: { include: { po: true } },
        },
      });
    });

    res.json(delivery);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/deliveries/po/:poId - Get deliveries for a PO (single raw query)
router.get('/po/:poId', auth, async (req, res) => {
  try {
    const poId = req.params.poId;
    const deliveries = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT d.* FROM "Delivery" d
      LEFT JOIN "DeliveryPO" dp ON dp."deliveryId" = d.id
      WHERE d."poId" = $1 OR dp."poId" = $1
      ORDER BY d."deliveryDate" DESC
    `, poId);

    if (deliveries.length === 0) return res.json([]);

    const dIds = deliveries.map(d => d.id);

    const [items, proofs, deliveryPOs] = await Promise.all([
      prisma.$queryRawUnsafe(`
        SELECT di.*, poi."productName", poi.thickness, poi.width, poi.length
        FROM "DeliveryItem" di
        JOIN "POItem" poi ON poi.id = di."poItemId"
        WHERE di."deliveryId" = ANY($1)
      `, dIds),
      prisma.$queryRawUnsafe(`SELECT * FROM "DeliveryProof" WHERE "deliveryId" = ANY($1)`, dIds),
      prisma.$queryRawUnsafe(`
        SELECT dlp.*, po."poNumber" FROM "DeliveryPO" dlp
        JOIN "PurchaseOrder" po ON po.id = dlp."poId"
        WHERE dlp."deliveryId" = ANY($1)
      `, dIds),
    ]);

    const itemsByDel = {};
    items.forEach(i => { if (!itemsByDel[i.deliveryId]) itemsByDel[i.deliveryId] = []; itemsByDel[i.deliveryId].push(i); });
    const proofsByDel = {};
    proofs.forEach(p => { if (!proofsByDel[p.deliveryId]) proofsByDel[p.deliveryId] = []; proofsByDel[p.deliveryId].push(p); });
    const poByDel = {};
    deliveryPOs.forEach(dp => { if (!poByDel[dp.deliveryId]) poByDel[dp.deliveryId] = []; poByDel[dp.deliveryId].push(dp); });

    const result = deliveries.map(d => ({
      ...d,
      items: (itemsByDel[d.id] || []).map(i => ({
        ...i,
        poItem: { productName: i.productName, thickness: i.thickness, width: i.width, length: i.length },
      })),
      proofs: proofsByDel[d.id] || [],
      deliveryPOs: (poByDel[d.id] || []).map(dp => ({ poId: dp.poId, po: { poNumber: dp.poNumber } })),
    }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Gagal mengambil data: ' + error.message });
  }
});

// GET /api/deliveries/:id - Get single delivery
router.get('/:id', auth, async (req, res) => {
  try {
    const delivery = await prisma.delivery.findUnique({
      where: { id: req.params.id },
      include: {
        items: { include: { poItem: true } },
        proofs: true,
        deliveryPOs: { include: { po: true } },
      },
    });
    if (!delivery) return res.status(404).json({ error: 'Pengiriman tidak ditemukan' });
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
    await prisma.deliveryPO.deleteMany({ where: { deliveryId: req.params.id } });
    await prisma.deliveryProof.deleteMany({ where: { deliveryId: req.params.id } });
    await prisma.delivery.delete({ where: { id: req.params.id } });
    res.json({ message: 'Pengiriman berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ error: 'Gagal menghapus pengiriman' });
  }
});

// POST /api/deliveries/:id/proof - Upload bukti surat jalan (supports multiple)
router.post('/:id/proof', auth, async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'Gambar wajib diupload' });

    const delivery = await prisma.delivery.findUnique({
      where: { id: req.params.id },
      include: { deliveryPOs: { include: { po: true } } },
    });
    if (!delivery) return res.status(404).json({ error: 'Pengiriman tidak ditemukan' });

    const googleScriptUrl = process.env.GOOGLE_SCRIPT_URL;
    if (!googleScriptUrl) return res.status(500).json({ error: 'Google Script URL belum dikonfigurasi' });

    const poNumbers = delivery.deliveryPOs.map(dp => dp.po.poNumber).join(', ') || 'N/A';

    const response = await fetch(googleScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: image.replace(/^data:image\/\w+;base64,/, ''),
        mimeType: 'image/jpeg',
        deliveryId: delivery.id,
        poNumber: poNumbers,
        customerName: '',
      }),
    });

    const result = await response.json();
    if (result.error) throw new Error(result.error);

    // Save to DeliveryProof table
    const proof = await prisma.deliveryProof.create({
      data: {
        deliveryId: req.params.id,
        url: result.url,
        fileName: result.fileName || null,
      },
    });

    // Also update legacy proofUrl if empty
    if (!delivery.proofUrl) {
      await prisma.delivery.update({
        where: { id: req.params.id },
        data: { proofUrl: result.url },
      });
    }

    res.json({ url: result.url, proof });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/deliveries/:deliveryId/proof/:proofId - Delete a proof
router.delete('/:deliveryId/proof/:proofId', auth, async (req, res) => {
  try {
    await prisma.deliveryProof.delete({ where: { id: req.params.proofId } });
    res.json({ message: 'Bukti berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
