const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
// In Docker, use /app/uploads and /app/data.json (persisted via volume)
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ─── Data persistence ───────────────────────────────────────────────────────
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const defaults = {
      playlist: [],
      config: {
        logo: 'MINHA EMPRESA',
        accent: '#00e5ff',
        duration: 10,
        loop: true,
        transition: 'fade',
        showHud: true,
        showDots: true,
        fitCover: false,
        tickerEnabled: false,
        tickerText: '',
        tickerLabel: 'AVISOS'
      },
      media: []
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let appData = loadData();

// ─── Connected players tracking ─────────────────────────────────────────────
const players = new Map(); // id -> { ws, info }

function broadcast(msg) {
  const payload = JSON.stringify(msg);
  players.forEach(({ ws }) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  });
}

// ─── Multer upload ────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = crypto.randomBytes(8).toString('hex') + ext;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    const allowed = /image\/(jpeg|png|gif|webp)|video\/(mp4|webm|ogg)/;
    cb(null, allowed.test(file.mimetype));
  }
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/admin', express.static(path.join(__dirname, 'public/admin')));
app.use('/player', express.static(path.join(__dirname, 'public/player')));
app.use('/shared', express.static(path.join(__dirname, 'public/shared')));

// Root → admin
app.get('/', (req, res) => res.redirect('/admin'));

// ─── REST API ─────────────────────────────────────────────────────────────────

// Get all data
app.get('/api/data', (req, res) => res.json(appData));

// Update config
app.post('/api/config', (req, res) => {
  appData.config = { ...appData.config, ...req.body };
  saveData(appData);
  broadcast({ type: 'config', payload: appData.config });
  res.json({ ok: true });
});

// Update playlist
app.post('/api/playlist', (req, res) => {
  appData.playlist = req.body;
  saveData(appData);
  broadcast({ type: 'playlist', payload: appData.playlist });
  res.json({ ok: true });
});

// Upload media
app.post('/api/media/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const item = {
    id: crypto.randomBytes(8).toString('hex'),
    filename: req.file.filename,
    originalName: req.file.originalname,
    type: req.file.mimetype.startsWith('video') ? 'video' : 'image',
    size: req.file.size,
    url: `/uploads/${req.file.filename}`,
    uploadedAt: new Date().toISOString()
  };
  appData.media.push(item);
  saveData(appData);
  res.json(item);
});

// Delete media
app.delete('/api/media/:id', (req, res) => {
  const idx = appData.media.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const item = appData.media[idx];
  const filePath = path.join(UPLOADS_DIR, item.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  appData.media.splice(idx, 1);
  // Remove from playlist too
  appData.playlist = appData.playlist.filter(s => s.mediaId !== item.id);
  saveData(appData);
  broadcast({ type: 'playlist', payload: appData.playlist });
  res.json({ ok: true });
});

// Players status
app.get('/api/players', (req, res) => {
  const list = [];
  players.forEach((v, id) => list.push({ id, ...v.info }));
  res.json(list);
});

// ─── WebSocket ────────────────────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  const id = crypto.randomBytes(6).toString('hex');
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  players.set(id, { ws, info: { ip, connectedAt: new Date().toISOString(), screen: 'Unknown' } });
  console.log(`[+] Player connected: ${id} from ${ip}`);

  // Send current state immediately
  ws.send(JSON.stringify({ type: 'init', payload: appData }));

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'identify') {
        players.get(id).info.screen = msg.screen || 'Tela sem nome';
        // Notify admin of updated players
        broadcastAdminPlayers();
      }
    } catch {}
  });

  ws.on('close', () => {
    players.delete(id);
    console.log(`[-] Player disconnected: ${id}`);
    broadcastAdminPlayers();
  });

  broadcastAdminPlayers();
});

function broadcastAdminPlayers() {
  // This will be polled by admin via /api/players
}

server.listen(PORT, () => {
  console.log(`\n🖥  Signage Server running`);
  console.log(`   Admin:  http://localhost:${PORT}/admin`);
  console.log(`   Player: http://localhost:${PORT}/player`);
  console.log(`   Port:   ${PORT}\n`);
});
