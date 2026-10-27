const express = require('express');
const prisma = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

function calcKubikasi(t, w, l) { return (t / 100) * (w / 100) * (l / 100); }

function genIntakeNumber(date) {
  const d = date ? new Date(date) : new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `WK-${yy}${mm}${dd}-${String(Math.floor(Math.random() * 900) + 100)}`;
}

/* GET /api/wood/stats */
router.get('/stats', auth, async (req, res) => {
  try {
    const [totals] = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(SUM(kubikasi), 0)::float as "totalKubikasi",
        COALESCE(SUM(quantity), 0)::int as "totalQty"
      FROM "WoodIntakeItem"
    `);
    const [used] = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(SUM(quantity), 0)::int as "usedQty"
      FROM "WoodGesek"
    `);
    const [allocated] = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(SUM(quantity), 0)::int as "allocatedQty"
      FROM "WoodGesek" WHERE "poItemId" IS NOT NULL
    `);
    const [stockGesek] = await prisma.$queryRawUnsafe(`
      SELECT COALESCE(SUM("remainingQty"), 0)::int as "stockQty"
      FROM "WoodGesek" WHERE "remainingQty" > 0
    `);
    const gesekQty = Number(used.usedQty) || 0;
    const totalQty = Number(totals.totalQty) || 0;
    const totalKub = Number(totals.totalKubikasi) || 0;
    const perUnit = totalQty > 0 ? totalKub / totalQty : 0;
    const remainingQty = totalQty - gesekQty;

    res.json({
      totalIn: totalKub,
      remainingQty,
      remainingKubikasi: Math.round(remainingQty * perUnit * 10000) / 10000,
      gesekQty,
      allocatedQty: Number(allocated.allocatedQty) || 0,
      stockGesekQty: Number(stockGesek.stockQty) || 0,
    });
  } catch (error) {
    console.error('Wood stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* GET /api/wood/intake */
router.get('/intake', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [totalRow] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as total FROM "WoodIntake"`);
    const total = totalRow.total || 0;

    const intakes = await prisma.$queryRawUnsafe(`
      SELECT wi.*, u.name as "userName"
      FROM "WoodIntake" wi
      LEFT JOIN "User" u ON u.id = wi."userId"
      ORDER BY wi."createdAt" DESC
      LIMIT ${limit} OFFSET ${skip}
    `);

    const intakeIds = intakes.map(i => i.id);
    let allItems = [];
    if (intakeIds.length > 0) {
      allItems = await prisma.$queryRawUnsafe(`
        SELECT wii.*, wi."intakeNumber"
        FROM "WoodIntakeItem" wii
        JOIN "WoodIntake" wi ON wi.id = wii."intakeId"
        WHERE wii."intakeId" = ANY($1)
      `, intakeIds);
    }

    const usedByItem = await prisma.$queryRawUnsafe(`
      SELECT "intakeItemId", SUM(quantity)::int as "usedQty"
      FROM "WoodGesek"
      GROUP BY "intakeItemId"
    `);
    const usedMap = {};
    usedByItem.forEach(u => { usedMap[u.intakeItemId] = Number(u.usedQty) || 0; });

    const itemsByIntake = {};
    allItems.forEach(item => {
      if (!itemsByIntake[item.intakeId]) itemsByIntake[item.intakeId] = [];
      const used = usedMap[item.id] || 0;
      itemsByIntake[item.intakeId].push({
        id: item.id,
        productName: item.productName,
        thickness: item.thickness,
        width: item.width,
        length: item.length,
        quantity: item.quantity,
        kubikasi: item.kubikasi,
        usedQty: used,
        remaining: item.quantity - used,
      });
    });

    let proofsByIntake = {};
    if (intakeIds.length > 0) {
      const proofs = await prisma.$queryRawUnsafe(`
        SELECT * FROM "WoodIntakeProof" WHERE "intakeId" = ANY($1) ORDER BY "createdAt" DESC
      `, intakeIds);
      proofs.forEach(p => {
        if (!proofsByIntake[p.intakeId]) proofsByIntake[p.intakeId] = [];
        proofsByIntake[p.intakeId].push(p);
      });
    }

    const enriched = intakes.map(i => ({
      id: i.id,
      intakeNumber: i.intakeNumber,
      intakeDate: i.intakeDate,
      supplier: i.supplier,
      vehicleNumber: i.vehicleNumber,
      notes: i.notes,
      totalQuantity: i.totalQuantity,
      totalKubikasi: i.totalKubikasi,
      items: itemsByIntake[i.id] || [],
      proofs: proofsByIntake[i.id] || [],
    }));

    res.json({
      data: enriched,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Wood intake list error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* POST /api/wood/intake */
router.post('/intake', auth, async (req, res) => {
  try {
    const { intakeDate, supplier, vehicleNumber, notes, items } = req.body;
    if (!items || items.length === 0) return res.status(400).json({ error: 'Minimal 1 item' });

    let totalKubikasi = 0;
    let totalQuantity = 0;
    const itemsData = items.map(i => {
      const kub = calcKubikasi(i.thickness, i.width, i.length) * (i.quantity || 1);
      totalKubikasi += kub;
      totalQuantity += i.quantity || 1;
      return {
        productName: i.productName || 'Kayu',
        thickness: i.thickness,
        width: i.width,
        length: i.length,
        quantity: i.quantity || 1,
        kubikasi: kub,
      };
    });

    const result = await prisma.$transaction(async (tx) => {
      let intakeNumber;
      let attempts = 0;
      while (attempts < 10) {
        intakeNumber = genIntakeNumber(intakeDate);
        const exists = await tx.woodIntake.findUnique({ where: { intakeNumber } });
        if (!exists) break;
        attempts++;
      }

      const intake = await tx.woodIntake.create({
        data: {
          intakeNumber,
          intakeDate: intakeDate ? new Date(intakeDate) : new Date(),
          supplier: supplier || null,
          vehicleNumber: vehicleNumber || null,
          notes: notes || null,
          totalQuantity,
          totalKubikasi,
          userId: req.user.id,
        },
      });

      await tx.woodIntakeItem.createMany({
        data: itemsData.map(i => ({ ...i, intakeId: intake.id })),
      });

      return tx.woodIntake.findUnique({ where: { id: intake.id }, include: { items: true } });
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Wood intake create error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* GET /api/wood/intake/:id */
router.get('/intake/:id', auth, async (req, res) => {
  try {
    const intake = await prisma.woodIntake.findUnique({ where: { id: req.params.id } });
    if (!intake) return res.status(404).json({ error: 'Data tidak ditemukan' });

    const [items, proofs, usedByItem] = await Promise.all([
      prisma.woodIntakeItem.findMany({ where: { intakeId: intake.id } }),
      prisma.woodIntakeProof.findMany({ where: { intakeId: intake.id }, orderBy: { createdAt: 'desc' } }),
      prisma.$queryRawUnsafe(`
        SELECT "intakeItemId", SUM(quantity)::int as "usedQty"
        FROM "WoodGesek" WHERE "intakeItemId" = ANY($1) GROUP BY "intakeItemId"
      `, (await prisma.woodIntakeItem.findMany({ where: { intakeId: intake.id }, select: { id: true } })).map(i => i.id)),
    ]);
    const usedMap = {};
    usedByItem.forEach(u => { usedMap[u.intakeItemId] = Number(u.usedQty) || 0; });

    res.json({
      ...intake,
      items: items.map(i => ({
        id: i.id, productName: i.productName, thickness: i.thickness,
        width: i.width, length: i.length, quantity: i.quantity, kubikasi: i.kubikasi,
        usedQty: usedMap[i.id] || 0, remaining: i.quantity - (usedMap[i.id] || 0),
      })),
      proofs,
    });
  } catch (error) {
    console.error('Wood intake detail error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* PUT /api/wood/intake/:id */
router.put('/intake/:id', auth, async (req, res) => {
  try {
    const { intakeDate, supplier, vehicleNumber, notes, items } = req.body;
    const existing = await prisma.woodIntake.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Data tidak ditemukan' });

    if (!items || items.length === 0) return res.status(400).json({ error: 'Minimal 1 item' });

    const existingItems = await prisma.woodIntakeItem.findMany({ where: { intakeId: req.params.id }, select: { id: true } });
    const existingItemIds = existingItems.map(i => i.id);

    if (existingItemIds.length > 0) {
      const gesekCount = await prisma.woodGesek.count({ where: { intakeItemId: { in: existingItemIds } } });
      if (gesekCount > 0) return res.status(400).json({ error: 'Sudah ada gesek, tidak bisa diedit' });
    }

    let totalKubikasi = 0;
    let totalQuantity = 0;
    const itemsData = items.map(i => {
      const kub = calcKubikasi(i.thickness, i.width, i.length) * (i.quantity || 1);
      totalKubikasi += kub;
      totalQuantity += i.quantity || 1;
      return {
        productName: i.productName || 'Kayu',
        thickness: i.thickness,
        width: i.width,
        length: i.length,
        quantity: i.quantity || 1,
        kubikasi: kub,
      };
    });

    const result = await prisma.$transaction(async (tx) => {
      await tx.woodIntakeItem.deleteMany({ where: { intakeId: req.params.id } });

      await tx.woodIntake.update({
        where: { id: req.params.id },
        data: {
          intakeDate: intakeDate ? new Date(intakeDate) : existing.intakeDate,
          supplier: supplier || null,
          vehicleNumber: vehicleNumber || null,
          notes: notes || null,
          totalQuantity,
          totalKubikasi,
        },
      });

      await tx.woodIntakeItem.createMany({
        data: itemsData.map(i => ({ ...i, intakeId: req.params.id })),
      });

      return tx.woodIntake.findUnique({ where: { id: req.params.id }, include: { items: true } });
    });

    res.json(result);
  } catch (error) {
    console.error('Wood intake update error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* DELETE /api/wood/intake/:id */
router.delete('/intake/:id', auth, async (req, res) => {
  try {
    const intake = await prisma.woodIntake.findUnique({ where: { id: req.params.id } });
    if (!intake) return res.status(404).json({ error: 'Data tidak ditemukan' });

    const itemIds = (await prisma.woodIntakeItem.findMany({
      where: { intakeId: req.params.id }, select: { id: true },
    })).map(i => i.id);

    if (itemIds.length > 0) {
      const gesekCount = await prisma.woodGesek.count({ where: { intakeItemId: { in: itemIds } } });
      if (gesekCount > 0) return res.status(400).json({ error: 'Sudah ada gesek, tidak bisa dihapus' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.woodIntakeItem.deleteMany({ where: { intakeId: req.params.id } });
      await tx.woodIntake.delete({ where: { id: req.params.id } });
    });

    res.json({ message: 'Berhasil dihapus' });
  } catch (error) {
    console.error('Wood intake delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/wood/intake/:id/proof - Upload surat jalan/faktur
router.post('/intake/:id/proof', auth, async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'Gambar wajib diupload' });

    const intake = await prisma.woodIntake.findUnique({ where: { id: req.params.id } });
    if (!intake) return res.status(404).json({ error: 'Kayu masuk tidak ditemukan' });

    const googleScriptUrl = process.env.GOOGLE_SCRIPT_URL;
    if (!googleScriptUrl) return res.status(500).json({ error: 'Google Script URL belum dikonfigurasi' });

    const response = await fetch(googleScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: image.replace(/^data:image\/\w+;base64,/, ''),
        mimeType: 'image/jpeg',
        deliveryId: 'intake-' + intake.id,
        poNumber: intake.intakeNumber,
        customerName: intake.supplier || '',
      }),
    });

    const result = await response.json();
    if (result.error) throw new Error(result.error);

    const proof = await prisma.woodIntakeProof.create({
      data: {
        intakeId: req.params.id,
        url: result.url,
        fileName: result.fileName || null,
      },
    });

    res.json({ url: result.url, proof });
  } catch (error) {
    console.error('Wood intake proof upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/wood/intake/:intakeId/proof/:proofId
router.delete('/intake/:intakeId/proof/:proofId', auth, async (req, res) => {
  try {
    await prisma.woodIntakeProof.delete({ where: { id: req.params.proofId } });
    res.json({ message: 'Bukti berhasil dihapus' });
  } catch (error) {
    console.error('Wood intake proof delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* GET /api/wood/stock */
router.get('/stock', auth, async (req, res) => {
  try {
    const items = await prisma.$queryRawUnsafe(`
      SELECT wii.*, wi."intakeNumber", wi.supplier
      FROM "WoodIntakeItem" wii
      JOIN "WoodIntake" wi ON wi.id = wii."intakeId"
      ORDER BY wi."intakeDate" DESC
    `);

    const usedByItem = await prisma.$queryRawUnsafe(`
      SELECT "intakeItemId", SUM(quantity)::int as "usedQty"
      FROM "WoodGesek"
      GROUP BY "intakeItemId"
    `);
    const usedMap = {};
    usedByItem.forEach(u => { usedMap[u.intakeItemId] = Number(u.usedQty) || 0; });

    const stock = items
      .map(i => ({
        id: i.id,
        intakeNumber: i.intakeNumber,
        supplier: i.supplier,
        productName: i.productName,
        thickness: i.thickness,
        width: i.width,
        length: i.length,
        quantity: i.quantity,
        kubikasi: i.kubikasi,
        remaining: i.quantity - (usedMap[i.id] || 0),
      }))
      .filter(i => i.remaining > 0);

    res.json(stock);
  } catch (error) {
    console.error('Wood stock error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* GET /api/wood/po-progress */
router.get('/po-progress', auth, async (req, res) => {
  try {
    const pos = await prisma.$queryRawUnsafe(`
      SELECT p.*, COALESCE(s.ship_qty, 0)::int as "shippedQuantity"
      FROM "PurchaseOrder" p
      LEFT JOIN (
        SELECT poi."poId", SUM(di.quantity)::int as ship_qty
        FROM "DeliveryItem" di
        JOIN "POItem" poi ON poi.id = di."poItemId"
        GROUP BY poi."poId"
      ) s ON s."poId" = p.id
      WHERE p.status != 'dibatalkan'
      ORDER BY p."createdAt" DESC
    `);

    const poIds = pos.map(p => p.id);
    if (poIds.length === 0) return res.json({ data: [], stats: {} });

    const items = await prisma.$queryRawUnsafe(`
      SELECT poi.*, COALESCE(ds.shipped_qty, 0)::int as "shippedQty"
      FROM "POItem" poi
      LEFT JOIN (
        SELECT di."poItemId", SUM(di.quantity)::int as shipped_qty
        FROM "DeliveryItem" di
        GROUP BY di."poItemId"
      ) ds ON ds."poItemId" = poi.id
      WHERE poi."poId" = ANY($1)
    `, poIds);

    const gesekAgg = await prisma.$queryRawUnsafe(`
      SELECT "poItemId", SUM(quantity)::int as "gesekQty"
      FROM "WoodGesek"
      GROUP BY "poItemId"
    `);
    const gesekMap = {};
    gesekAgg.forEach(g => { gesekMap[g.poItemId] = Number(g.gesekQty) || 0; });

    const itemsByPo = {};
    items.forEach(i => {
      if (!itemsByPo[i.poId]) itemsByPo[i.poId] = [];
      const shipped = i.shippedQty || 0;
      const gesek = gesekMap[i.id] || 0;
      const remainingNeed = Math.max(0, i.quantity - shipped - gesek);
      itemsByPo[i.poId].push({
        id: i.id,
        poItemId: i.id,
        productName: i.productName,
        thickness: i.thickness,
        width: i.width,
        length: i.length,
        quantity: i.quantity,
        shippedQty: shipped,
        gesekQty: gesek,
        remainingNeed,
      });
    });

    let totalRemainingNeed = 0;
    let totalReady = 0;

    const enriched = pos.map(po => {
      const poItems = itemsByPo[po.id] || [];
      const totalRemaining = poItems.reduce((s, i) => s + i.remainingNeed, 0);
      const pctDone = po.totalQuantity > 0
        ? Math.round(((po.totalQuantity - totalRemaining) / po.totalQuantity) * 100)
        : 0;
      const done = totalRemaining === 0;
      totalRemainingNeed += totalRemaining;
      if (done) totalReady += po.totalQuantity;

      return {
        id: po.id,
        poNumber: po.poNumber,
        customerName: po.customerName,
        status: po.status,
        totalQuantity: po.totalQuantity,
        totalRemaining,
        pctDone,
        done,
        items: poItems,
      };
    });

    res.json({
      data: enriched,
      stats: { totalRemainingNeed, totalReady },
    });
  } catch (error) {
    console.error('Wood po-progress error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* GET /api/wood/gesek - List gesek stock (with supplier+date, remaining) */
router.get('/gesek', auth, async (req, res) => {
  try {
    const logs = await prisma.$queryRawUnsafe(`
      SELECT g.*,
        wi."intakeNumber", wi.supplier, wi."intakeDate",
        wii."productName" as "sourceName", wii.thickness as "sourceThickness",
        wii.width as "sourceWidth", wii.length as "sourceLength",
        poi."productName" as "targetName",
        p."poNumber",
        u.name as "userName"
      FROM "WoodGesek" g
      JOIN "WoodIntakeItem" wii ON wii.id = g."intakeItemId"
      JOIN "WoodIntake" wi ON wi.id = wii."intakeId"
      LEFT JOIN "POItem" poi ON poi.id = g."poItemId"
      LEFT JOIN "PurchaseOrder" p ON p.id = poi."poId"
      JOIN "User" u ON u.id = g."userId"
      ORDER BY g."createdAt" DESC
    `);

    res.json(logs.map(l => ({
      id: l.id,
      quantity: l.quantity,
      remainingQty: l.remainingQty,
      kubikasiOut: l.kubikasiOut,
      sourceName: l.sourceName,
      sourceThickness: l.sourceThickness,
      sourceWidth: l.sourceWidth,
      sourceLength: l.sourceLength,
      resultThickness: l.resultThickness,
      resultWidth: l.resultWidth,
      resultLength: l.resultLength,
      intakeNumber: l.intakeNumber,
      supplier: l.supplier,
      intakeDate: l.intakeDate,
      poNumber: l.poNumber || null,
      userName: l.userName,
      createdAt: l.createdAt,
    })));
  } catch (error) {
    console.error('Wood gesek list error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* POST /api/wood/gesek - Create gesek stock (no PO required) */
router.post('/gesek', auth, async (req, res) => {
  try {
    const { intakeItemId, quantity, resultThickness, resultWidth, resultLength, notes } = req.body;
    if (!intakeItemId) return res.status(400).json({ error: 'Pilih stok sumber' });
    if (!quantity || quantity <= 0) return res.status(400).json({ error: 'Jumlah tidak valid' });
    if (!resultThickness || !resultWidth || !resultLength) return res.status(400).json({ error: 'Isi ukuran hasil gesek' });

    const srcItem = await prisma.woodIntakeItem.findUnique({ where: { id: intakeItemId } });
    if (!srcItem) return res.status(404).json({ error: 'Stok tidak ditemukan' });

    const [usedRow] = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM(quantity), 0)::int as used FROM "WoodGesek" WHERE "intakeItemId" = $1`, intakeItemId
    );
    const usedQty = Number(usedRow.used) || 0;
    const remaining = srcItem.quantity - usedQty;
    if (quantity > remaining) return res.status(400).json({ error: `Stok hanya tersisa ${remaining} pcs` });

    const kubikasiOut = calcKubikasi(resultThickness, resultWidth, resultLength) * quantity;

    const result = await prisma.woodGesek.create({
      data: {
        intakeItemId,
        quantity,
        remainingQty: quantity,
        resultThickness,
        resultWidth,
        resultLength,
        kubikasiOut,
        notes: notes || null,
        userId: req.user.id,
      },
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Wood gesek create error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* DELETE /api/wood/gesek/:id */
router.delete('/gesek/:id', auth, async (req, res) => {
  try {
    const gesek = await prisma.woodGesek.findUnique({ where: { id: req.params.id } });
    if (!gesek) return res.status(404).json({ error: 'Data tidak ditemukan' });

    const allocated = gesek.quantity - gesek.remainingQty;
    if (allocated > 0) return res.status(400).json({ error: `Sudah dialokasikan ${allocated} pcs, tidak bisa dihapus` });

    await prisma.woodGesek.delete({ where: { id: req.params.id } });
    res.json({ message: 'Gesek dibatalkan' });
  } catch (error) {
    console.error('Wood gesek delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* POST /api/wood/gesek/batch - Batch gesek (no PO required) */
router.post('/gesek/batch', auth, async (req, res) => {
  try {
    const { items, resultThickness, resultWidth, resultLength, notes } = req.body;
    if (!items || items.length === 0) return res.status(400).json({ error: 'Pilih minimal 1 item' });
    if (!resultThickness || !resultWidth || !resultLength) return res.status(400).json({ error: 'Isi ukuran hasil gesek' });

    const result = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const item of items) {
        if (!item.intakeItemId || !item.quantity || item.quantity <= 0) continue;

        const srcItem = await tx.woodIntakeItem.findUnique({ where: { id: item.intakeItemId } });
        if (!srcItem) continue;

        const [usedRow] = await tx.$queryRawUnsafe(
          `SELECT COALESCE(SUM(quantity), 0)::int as used FROM "WoodGesek" WHERE "intakeItemId" = $1`, item.intakeItemId
        );
        const remaining = srcItem.quantity - (Number(usedRow.used) || 0);
        const qty = Math.min(item.quantity, remaining);
        if (qty <= 0) continue;

        const kubikasiOut = calcKubikasi(resultThickness, resultWidth, resultLength) * qty;
        const gesek = await tx.woodGesek.create({
          data: {
            intakeItemId: item.intakeItemId,
            quantity: qty,
            remainingQty: qty,
            resultThickness,
            resultWidth,
            resultLength,
            kubikasiOut,
            notes: notes || null,
            userId: req.user.id,
          },
        });
        created.push(gesek);
      }
      return created;
    });

    res.status(201).json({ count: result.length, geseks: result });
  } catch (error) {
    console.error('Wood gesek batch error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* POST /api/wood/gesek/allocate - Allocate gesek stock to PO item */
router.post('/gesek/allocate', auth, async (req, res) => {
  try {
    const { gesekId, poItemId, quantity, notes } = req.body;
    if (!gesekId || !poItemId) return res.status(400).json({ error: 'Pilih gesek dan item PO' });
    if (!quantity || quantity <= 0) return res.status(400).json({ error: 'Jumlah tidak valid' });

    const gesek = await prisma.woodGesek.findUnique({ where: { id: gesekId } });
    if (!gesek) return res.status(404).json({ error: 'Data gesek tidak ditemukan' });
    if (quantity > gesek.remainingQty) return res.status(400).json({ error: `Sisa stok gesek hanya ${gesek.remainingQty} pcs` });

    const poItem = await prisma.pOItem.findUnique({ where: { id: poItemId } });
    if (!poItem) return res.status(404).json({ error: 'Item PO tidak ditemukan' });

    const kubikasiOut = calcKubikasi(gesek.resultThickness, gesek.resultWidth, gesek.resultLength) * quantity;

    const result = await prisma.$transaction(async (tx) => {
      // Create allocation gesek record (linked to PO)
      const alloc = await tx.woodGesek.create({
        data: {
          intakeItemId: gesek.intakeItemId,
          poItemId,
          quantity,
          remainingQty: 0,
          resultThickness: gesek.resultThickness,
          resultWidth: gesek.resultWidth,
          resultLength: gesek.resultLength,
          kubikasiOut,
          notes: notes || `Alokasi dari gesek ${gesek.id.slice(0, 8)}`,
          userId: req.user.id,
        },
      });

      // Decrease remainingQty on source gesek
      await tx.woodGesek.update({
        where: { id: gesekId },
        data: { remainingQty: gesek.remainingQty - quantity },
      });

      return alloc;
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Wood gesek allocate error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
