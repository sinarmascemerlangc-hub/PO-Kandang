const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const prisma = require('./config/database');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(compression());
app.use(cors());
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
