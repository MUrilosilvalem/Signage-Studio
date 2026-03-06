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
      playlists: [
        {
          id: crypto.randomBytes(8).toString('hex'),
          name: 'Playlist Principal',
          slides: []
        }
      ],
      activePlaylistId: null, // Will be set to first playlist ID
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
        tickerLabel: 'AVISOS',
        orientation: 'landscape' // 'landscape' or 'portrait'
      },
      media: []
    };
    // Set active playlist to first one
    defaults.activePlaylistId = defaults.playlists[0].id;
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  // Migrate old format if needed
  if (data.playlist && !data.playlists) {
    data.playlists = [
      {
        id: crypto.randomBytes(8).toString('hex'),
        name: 'Playlist Principal',
        slides: data.playlist || []
      }
    ];
    data.activePlaylistId = data.playlists[0].id;
    delete data.playlist;
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }
  // Ensure activePlaylistId is set
  if (!data.activePlaylistId && data.playlists && data.playlists.length > 0) {
    data.activePlaylistId = data.playlists[0].id;
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }
  // Ensure orientation config exists
  if (!data.config.orientation) {
    data.config.orientation = 'landscape';
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  }
  return data;
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

// Get active playlist
app.get('/api/playlist', (req, res) => {
  const activePlaylist = appData.playlists.find(p => p.id === appData.activePlaylistId);
  res.json(activePlaylist || { id: null, name: '', slides: [] });
});

// Get all playlists (metadata only)
app.get('/api/playlists', (req, res) => {
  const playlists = appData.playlists.map(p => ({
    id: p.id,
    name: p.name,
    slideCount: p.slides.length
  }));
  res.json({ playlists, activePlaylistId: appData.activePlaylistId });
});

// Create new playlist
app.post('/api/playlists', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const newPlaylist = {
    id: crypto.randomBytes(8).toString('hex'),
    name,
    slides: []
  };
  appData.playlists.push(newPlaylist);
  saveData(appData);
  res.json(newPlaylist);
});

// Update playlist name
app.patch('/api/playlists/:id', (req, res) => {
  const { name } = req.body;
  const playlist = appData.playlists.find(p => p.id === req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Not found' });
  if (name) playlist.name = name;
  saveData(appData);
  res.json(playlist);
});

// Delete playlist
app.delete('/api/playlists/:id', (req, res) => {
  const idx = appData.playlists.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  if (appData.playlists.length === 1) return res.status(400).json({ error: 'Cannot delete last playlist' });
  
  appData.playlists.splice(idx, 1);
  // If deleted playlist was active, switch to first
  if (appData.activePlaylistId === req.params.id) {
    appData.activePlaylistId = appData.playlists[0].id;
    broadcast({ type: 'playlist', payload: appData.playlists.find(p => p.id === appData.activePlaylistId).slides });
  }
  saveData(appData);
  res.json({ ok: true });
});

// Set active playlist
app.post('/api/playlists/:id/activate', (req, res) => {
  const playlist = appData.playlists.find(p => p.id === req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Not found' });
  appData.activePlaylistId = req.params.id;
  saveData(appData);
  broadcast({ type: 'playlist', payload: playlist.slides });
  res.json({ ok: true });
});

// Update active playlist slides
app.post('/api/playlist/slides', (req, res) => {
  const playlist = appData.playlists.find(p => p.id === appData.activePlaylistId);
  if (!playlist) return res.status(404).json({ error: 'No active playlist' });
  playlist.slides = req.body;
  saveData(appData);
  broadcast({ type: 'playlist', payload: playlist.slides });
  res.json({ ok: true });
});

// Update config
app.post('/api/config', (req, res) => {
  appData.config = { ...appData.config, ...req.body };
  saveData(appData);
  broadcast({ type: 'config', payload: appData.config });
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
  // Remove from all playlists
  appData.playlists.forEach(p => {
    p.slides = p.slides.filter(s => s.mediaId !== item.id);
  });
  saveData(appData);
  const activePlaylist = appData.playlists.find(p => p.id === appData.activePlaylistId);
  if (activePlaylist) {
    broadcast({ type: 'playlist', payload: activePlaylist.slides });
  }
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
  const activePlaylist = appData.playlists.find(p => p.id === appData.activePlaylistId);
  const initPayload = {
    ...appData,
    playlist: activePlaylist ? activePlaylist.slides : []
  };
  ws.send(JSON.stringify({ type: 'init', payload: initPayload }));

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
