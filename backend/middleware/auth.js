const jwt = require('jsonwebtoken');
const prisma = require('../config/database');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Token tidak ditemukan' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId }, select: { id: true, name: true, email: true, role: true, isActive: true } });
    if (!user || !user.isActive) return res.status(401).json({ error: 'User tidak valid' });
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Token tidak valid' });
  }
};

module.exports = auth;
