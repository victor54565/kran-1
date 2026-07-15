const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = 'your-secret-key-change-this';

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Разрешены только изображения'));
  }
});

const uploadReceipt = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype) || file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Разрешены только изображения или PDF'));
  }
});

const deleteUploadedFile = (filename) => {
  if (!filename) return;
  const filePath = path.join(uploadsDir, filename);
  fs.unlink(filePath, () => {});
};

app.use(cors());
app.use(bodyParser.json());
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Helper: читаем JSON файл
const readJSON = (file) => {
  try {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const filePath = path.join(dataDir, file);
    if (!fs.existsSync(filePath)) {
      return [];
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`Ошибка при чтении ${file}:`, e);
    return [];
  }
};

// Helper: пишем JSON файл
const writeJSON = (file, data) => {
  const filePath = path.join(__dirname, 'data', file);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
};

// Helper: проверяем любой валидный токен (админ или бухгалтер)
const verifyAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.admin = decoded;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Helper: проверяем, что это полный админ (не бухгалтер)
const verifyFullAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    req.admin = decoded;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ===== АДМИН ЛОГИН =====
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const admins = readJSON('admins.json');

  const admin = admins.find(a => a.password === password);
  if (!admin) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  const role = admin.role || 'admin';
  const token = jwt.sign({ id: admin.id, name: admin.name, role }, SECRET_KEY, { expiresIn: '7d' });
  res.json({ token, admin: { id: admin.id, name: admin.name, role } });
});

// ===== КОЛЛЕГИ (БАЗА ТЕХНИКИ) =====
app.get('/api/colleagues', (req, res) => {
  const colleagues = readJSON('colleagues.json');
  res.json(colleagues);
});

app.post('/api/colleagues', verifyFullAdmin, upload.array('photos', 5), (req, res) => {
  const colleagues = readJSON('colleagues.json');
  let cranes = [];
  try {
    cranes = JSON.parse(req.body.cranes || '[]');
  } catch (e) {
    cranes = [];
  }

  const photos = (req.files || []).map(f => f.filename);

  const newColleague = {
    id: Date.now(),
    name: req.body.name,
    phone: req.body.phone,
    cranes,
    photos,
    createdAt: new Date()
  };
  colleagues.push(newColleague);
  writeJSON('colleagues.json', colleagues);
  res.json(newColleague);
});

app.put('/api/colleagues/:id', verifyFullAdmin, upload.array('photos', 5), (req, res) => {
  const colleagues = readJSON('colleagues.json');
  const colleague = colleagues.find(c => c.id === parseInt(req.params.id));
  if (!colleague) return res.status(404).json({ error: 'Коллега не найден' });

  if (req.body.name !== undefined) colleague.name = req.body.name;
  if (req.body.phone !== undefined) colleague.phone = req.body.phone;

  let cranes = [];
  try {
    cranes = JSON.parse(req.body.cranes || '[]');
  } catch (e) {
    cranes = [];
  }
  if (cranes.length > 0) colleague.cranes = cranes;

  if ((req.files || []).length > 0) {
    if (colleague.photos) colleague.photos.forEach(deleteUploadedFile);
    colleague.photos = (req.files || []).map(f => f.filename);
  }

  writeJSON('colleagues.json', colleagues);
  res.json(colleague);
});

app.delete('/api/colleagues/:id', verifyFullAdmin, (req, res) => {
  let colleagues = readJSON('colleagues.json');
  const target = colleagues.find(c => c.id === parseInt(req.params.id));
  if (target && target.photos) target.photos.forEach(deleteUploadedFile);
  colleagues = colleagues.filter(c => c.id !== parseInt(req.params.id));
  writeJSON('colleagues.json', colleagues);
  res.json({ success: true });
});

// ===== БАРАХОЛКА (МАРКЕТПЛЕЙС) =====
app.get('/api/marketplace', (req, res) => {
  const marketplace = readJSON('marketplace.json');
  res.json(marketplace);
});

app.post('/api/marketplace', verifyFullAdmin, upload.single('photo'), (req, res) => {
  const marketplace = readJSON('marketplace.json');
  const newAd = {
    id: Date.now(),
    title: req.body.title,
    description: req.body.description,
    category: req.body.category,
    price: req.body.price,
    phone: req.body.phone,
    name: req.body.name,
    photo: req.file ? req.file.filename : null,
    createdAt: new Date()
  };
  marketplace.push(newAd);
  writeJSON('marketplace.json', marketplace);
  res.json(newAd);
});

app.put('/api/marketplace/:id', verifyFullAdmin, upload.single('photo'), (req, res) => {
  const marketplace = readJSON('marketplace.json');
  const ad = marketplace.find(a => a.id === parseInt(req.params.id));
  if (!ad) return res.status(404).json({ error: 'Объявление не найдено' });

  if (req.body.title !== undefined) ad.title = req.body.title;
  if (req.body.description !== undefined) ad.description = req.body.description;
  if (req.body.category !== undefined) ad.category = req.body.category;
  if (req.body.price !== undefined) ad.price = req.body.price;
  if (req.body.name !== undefined) ad.name = req.body.name;
  if (req.body.phone !== undefined) ad.phone = req.body.phone;

  if (req.file) {
    deleteUploadedFile(ad.photo);
    ad.photo = req.file.filename;
  }

  writeJSON('marketplace.json', marketplace);
  res.json(ad);
});

app.delete('/api/marketplace/:id', verifyFullAdmin, (req, res) => {
  let marketplace = readJSON('marketplace.json');
  const ad = marketplace.find(a => a.id === parseInt(req.params.id));

  if (ad && ad.photo) deleteUploadedFile(ad.photo);
  marketplace = marketplace.filter(a => a.id !== parseInt(req.params.id));
  writeJSON('marketplace.json', marketplace);
  res.json({ success: true });
});

// ===== ЧЕРНЫЙ СПИСОК =====
app.get('/api/blacklist', (req, res) => {
  const blacklist = readJSON('blacklist.json');
  res.json(blacklist);
});

app.post('/api/blacklist', verifyFullAdmin, (req, res) => {
  const blacklist = readJSON('blacklist.json');
  const newEntry = {
    id: Date.now(),
    company: req.body.company,
    reason: req.body.reason,
    contact: req.body.contact,
    createdAt: new Date()
  };
  blacklist.push(newEntry);
  writeJSON('blacklist.json', blacklist);
  res.json(newEntry);
});

app.put('/api/blacklist/:id', verifyFullAdmin, (req, res) => {
  const blacklist = readJSON('blacklist.json');
  const entry = blacklist.find(b => b.id === parseInt(req.params.id));
  if (!entry) return res.status(404).json({ error: 'Запись не найдена' });

  if (req.body.company !== undefined) entry.company = req.body.company;
  if (req.body.reason !== undefined) entry.reason = req.body.reason;
  if (req.body.contact !== undefined) entry.contact = req.body.contact;

  writeJSON('blacklist.json', blacklist);
  res.json(entry);
});

app.delete('/api/blacklist/:id', verifyFullAdmin, (req, res) => {
  let blacklist = readJSON('blacklist.json');
  blacklist = blacklist.filter(b => b.id !== parseInt(req.params.id));
  writeJSON('blacklist.json', blacklist);
  res.json({ success: true });
});

// ===== КАССА (КАЗНА) — доступ только для авторизованных (админ или бухгалтер) =====
app.get('/api/treasury', verifyAdmin, (req, res) => {
  let treasury = readJSON('treasury.json');
  const { from, to } = req.query;
  if (from) treasury = treasury.filter(t => t.date >= from);
  if (to) treasury = treasury.filter(t => t.date <= to);
  res.json(treasury);
});

app.post('/api/treasury', verifyFullAdmin, uploadReceipt.single('receipt'), (req, res) => {
  const treasury = readJSON('treasury.json');
  const entry = {
    id: Date.now(),
    date: req.body.date || new Date().toISOString().split('T')[0],
    type: req.body.type, // income, expense
    amount: req.body.amount,
    description: req.body.description,
    receipt: req.file ? req.file.filename : null,
    createdBy: req.admin.name
  };
  treasury.push(entry);
  writeJSON('treasury.json', treasury);
  res.json(entry);
});

app.put('/api/treasury/:id', verifyFullAdmin, uploadReceipt.single('receipt'), (req, res) => {
  const treasury = readJSON('treasury.json');
  const entry = treasury.find(t => t.id === parseInt(req.params.id));
  if (!entry) return res.status(404).json({ error: 'Запись не найдена' });

  if (req.body.date !== undefined) entry.date = req.body.date;
  if (req.body.type !== undefined) entry.type = req.body.type;
  if (req.body.amount !== undefined) entry.amount = req.body.amount;
  if (req.body.description !== undefined) entry.description = req.body.description;

  if (req.file) {
    deleteUploadedFile(entry.receipt);
    entry.receipt = req.file.filename;
  }

  writeJSON('treasury.json', treasury);
  res.json(entry);
});

app.delete('/api/treasury/:id', verifyFullAdmin, (req, res) => {
  let treasury = readJSON('treasury.json');
  const target = treasury.find(t => t.id === parseInt(req.params.id));
  if (target && target.receipt) deleteUploadedFile(target.receipt);
  treasury = treasury.filter(t => t.id !== parseInt(req.params.id));
  writeJSON('treasury.json', treasury);
  res.json({ success: true });
});

// Экспорт кассы в Excel/Word за период
app.get('/api/treasury/export', verifyAdmin, async (req, res) => {
  try {
  const { from, to, format } = req.query;
  let treasury = readJSON('treasury.json');
  if (from) treasury = treasury.filter(t => t.date >= from);
  if (to) treasury = treasury.filter(t => t.date <= to);
  treasury.sort((a, b) => new Date(a.date) - new Date(b.date));

  let balance = 0;
  const rows = treasury.map(t => {
    if (t.type === 'income') balance += Number(t.amount);
    else balance -= Number(t.amount);
    return {
      date: t.date,
      type: t.type === 'income' ? 'Приход' : 'Расход',
      amount: Number(t.amount),
      description: t.description,
      createdBy: t.createdBy,
      balance
    };
  });

  const periodLabel = `${from || 'start'}_${to || 'today'}`.replace(/[^a-zA-Z0-9_-]/g, '');

  if (format === 'doc') {
    const html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="utf-8"><title>Выписка кассы</title></head>
      <body>
        <h2>Выписка кассы клуба «Вира Майна»</h2>
        <p>Период: ${from || 'начало'} — ${to || 'сегодня'}</p>
        <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;">
          <tr><th>Дата</th><th>Тип</th><th>Сумма (₸)</th><th>Описание</th><th>Кто добавил</th><th>Баланс (₸)</th></tr>
          ${rows.map(r => `<tr><td>${r.date}</td><td>${r.type}</td><td>${r.amount.toLocaleString('ru-RU')}</td><td>${r.description}</td><td>${r.createdBy}</td><td>${r.balance.toLocaleString('ru-RU')}</td></tr>`).join('')}
        </table>
        <p><b>Итоговый баланс: ${balance.toLocaleString('ru-RU')} ₸</b></p>
      </body>
      </html>
    `;
    res.set('Content-Type', 'application/msword');
    res.set('Content-Disposition', `attachment; filename="kassa_${periodLabel}.doc"`);
    return res.send(html);
  }

  // По умолчанию — Excel
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Касса');
  sheet.columns = [
    { header: 'Дата', key: 'date', width: 14 },
    { header: 'Тип', key: 'type', width: 12 },
    { header: 'Сумма (₸)', key: 'amount', width: 16 },
    { header: 'Описание', key: 'description', width: 40 },
    { header: 'Кто добавил', key: 'createdBy', width: 18 },
    { header: 'Баланс (₸)', key: 'balance', width: 16 }
  ];
  sheet.getRow(1).font = { bold: true };
  rows.forEach(r => sheet.addRow(r));
  sheet.addRow({});
  const totalRow = sheet.addRow({ description: 'Итоговый баланс', amount: balance });
  totalRow.font = { bold: true };

  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="kassa_${periodLabel}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
  } catch (e) {
    console.error('Ошибка экспорта кассы:', e);
    res.status(500).json({ error: 'Ошибка экспорта' });
  }
});

// ===== МАТЕРИАЛЫ (ВИДЕО) =====
app.get('/api/materials', (req, res) => {
  const materials = readJSON('materials.json');
  res.json(materials);
});

app.post('/api/materials', verifyFullAdmin, (req, res) => {
  const materials = readJSON('materials.json');
  const newMaterial = {
    id: Date.now(),
    title: req.body.title,
    description: req.body.description,
    type: req.body.type, // video, article, pdf
    url: req.body.url,
    createdAt: new Date()
  };
  materials.push(newMaterial);
  writeJSON('materials.json', materials);
  res.json(newMaterial);
});

app.put('/api/materials/:id', verifyFullAdmin, (req, res) => {
  const materials = readJSON('materials.json');
  const material = materials.find(m => m.id === parseInt(req.params.id));
  if (!material) return res.status(404).json({ error: 'Материал не найден' });

  if (req.body.title !== undefined) material.title = req.body.title;
  if (req.body.description !== undefined) material.description = req.body.description;
  if (req.body.type !== undefined) material.type = req.body.type;
  if (req.body.url !== undefined) material.url = req.body.url;

  writeJSON('materials.json', materials);
  res.json(material);
});

app.delete('/api/materials/:id', verifyFullAdmin, (req, res) => {
  let materials = readJSON('materials.json');
  materials = materials.filter(m => m.id !== parseInt(req.params.id));
  writeJSON('materials.json', materials);
  res.json({ success: true });
});

// Загрузка логотипа
app.post('/api/upload-logo', verifyFullAdmin, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не загружен' });
  }
  // Удаляем старый логотип
  const oldLogo = path.join(uploadsDir, 'logo.png');
  if (fs.existsSync(oldLogo)) {
    fs.unlinkSync(oldLogo);
  }
  // Переименовываем новый логотип
  const newPath = path.join(uploadsDir, 'logo.png');
  fs.renameSync(req.file.path, newPath);
  res.json({ success: true, file: 'logo.png' });
});

// Загрузка баннера
app.post('/api/upload-banner', verifyFullAdmin, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не загружен' });
  }
  // Удаляем старый баннер
  const oldBanner = path.join(uploadsDir, 'banner.png');
  if (fs.existsSync(oldBanner)) {
    fs.unlinkSync(oldBanner);
  }
  // Переименовываем новый баннер
  const newPath = path.join(uploadsDir, 'banner.png');
  fs.renameSync(req.file.path, newPath);
  res.json({ success: true, file: 'banner.png' });
});

// Сохранение настроек сайта
app.post('/api/settings', verifyFullAdmin, (req, res) => {
  try {
    let settings = readJSON('settings.json');
    if (!settings) settings = {};

    Object.assign(settings, req.body);
    writeJSON('settings.json', settings);

    res.json({ success: true, settings });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сохранения настроек' });
  }
});

// Получение настроек сайта
app.get('/api/settings', (req, res) => {
  try {
    const settings = readJSON('settings.json');
    res.json(settings || {});
  } catch (e) {
    res.json({});
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
});
