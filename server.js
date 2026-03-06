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

const PORT = parseInt(process.env.PORT) || 80;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ═══════════════════════════════════════
// DATA
// ═══════════════════════════════════════
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const defaults = {
      playlists: [{ id: crypto.randomBytes(8).toString('hex'), name: 'Playlist Principal', slides: [] }],
      activePlaylistId: null,
      screenConfigs: {},
      config: {
        logo: 'MINHA EMPRESA',
        accent: '#00e5ff',
        duration: 10,
        loop: true,
        transition: 'fade',
        showHud: true,
        showDots: true,
        orientation: 'landscape'
      },
      media: []
    };
    defaults.activePlaylistId = defaults.playlists[0].id;
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  // Garante campos novos em dados legados
  if (!data.screenConfigs) data.screenConfigs = {};
  if (!data.media) data.media = [];
  if (!data.playlists) data.playlists = [];
  return data;
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let appData = loadData();
const players = new Map();

// ═══════════════════════════════════════
// UPLOAD
// ═══════════════════════════════════════
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) =>
      cb(null, crypto.randomBytes(8).toString('hex') + path.extname(file.originalname))
  }),
  limits: { fileSize: 500 * 1024 * 1024 }
});

// ═══════════════════════════════════════
// STATIC
// ═══════════════════════════════════════
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/admin', express.static(path.join(__dirname, 'public/admin')));
app.use('/player', express.static(path.join(__dirname, 'public/player')));
app.use('/shared', express.static(path.join(__dirname, 'public/shared')));
app.get('/', (req, res) => res.redirect('/admin'));

// ═══════════════════════════════════════
// HELPERS BROADCAST
// ═══════════════════════════════════════
function broadcastAll(msg) {
  const json = JSON.stringify(msg);
  players.forEach(p => {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(json);
  });
}

function broadcastScreen(screenName, msg) {
  const json = JSON.stringify(msg);
  players.forEach(p => {
    if (p.info.screen === screenName && p.ws.readyState === WebSocket.OPEN)
      p.ws.send(json);
  });
}

function buildInitPayload(screenName) {
  const sConf = appData.screenConfigs?.[screenName] || {};
  const playlistId = sConf.playlistId || appData.activePlaylistId;
  const orientation = sConf.orientation || appData.config.orientation;
  const pl = appData.playlists.find(p => p.id === playlistId) || { slides: [] };
  return {
    ...appData,
    playlist: pl.slides,
    config: { ...appData.config, orientation }
  };
}

// ═══════════════════════════════════════
// API — DADOS GERAIS
// ═══════════════════════════════════════
app.get('/api/data', (req, res) => res.json(appData));

app.get('/api/players', (req, res) => {
  const list = [];
  players.forEach((v, id) => list.push({ id, ...v.info }));
  res.json(list);
});

// ═══════════════════════════════════════
// API — CONFIGURAÇÃO GLOBAL
// ═══════════════════════════════════════
app.post('/api/config', (req, res) => {
  appData.config = { ...appData.config, ...req.body };
  saveData(appData);
  // Envia para cada tela seu payload correto, respeitando orientacao individual
  players.forEach(p => {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(JSON.stringify({ type: 'init', payload: buildInitPayload(p.info.screen) }));
    }
  });
  res.json({ ok: true });
});







// ═══════════════════════════════════════
// API — CONFIGURAÇÃO POR TELA
// ═══════════════════════════════════════
app.post('/api/screens/config', (req, res) => {
  const { screenName, playlistId, orientation } = req.body;

  if (!screenName) return res.status(400).json({ error: 'screenName obrigatório' });

  // Valida playlistId se fornecido
  if (playlistId && !appData.playlists.find(p => p.id === playlistId)) {
    return res.status(400).json({ error: 'playlistId não encontrado' });
  }

  if (!appData.screenConfigs) appData.screenConfigs = {};

  const current = appData.screenConfigs[screenName] || {};
  appData.screenConfigs[screenName] = {
    playlistId: playlistId || current.playlistId || appData.activePlaylistId,
    orientation: orientation || current.orientation || appData.config.orientation
  };
  saveData(appData);

  // Notifica players daquela tela
  broadcastScreen(screenName, { type: 'init', payload: buildInitPayload(screenName) });

  res.json({ ok: true });
});

// ═══════════════════════════════════════
// API — PLAYLISTS
// ═══════════════════════════════════════
app.get('/api/playlists', (req, res) => res.json(appData.playlists));

app.post('/api/playlists', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
  const playlist = { id: crypto.randomBytes(8).toString('hex'), name: name.trim(), slides: [] };
  appData.playlists.push(playlist);
  saveData(appData);
  res.json(playlist);
});

app.delete('/api/playlists/:id', (req, res) => {
  const { id } = req.params;
  if (appData.playlists.length <= 1)
    return res.status(400).json({ error: 'Não é possível deletar a única playlist' });

  appData.playlists = appData.playlists.filter(p => p.id !== id);

  if (appData.activePlaylistId === id)
    appData.activePlaylistId = appData.playlists[0].id;

  // Remove referências em screenConfigs
  Object.keys(appData.screenConfigs).forEach(screen => {
    if (appData.screenConfigs[screen].playlistId === id)
      appData.screenConfigs[screen].playlistId = appData.activePlaylistId;
  });

  saveData(appData);
  res.json({ ok: true });
});

app.post('/api/playlists/:id/activate', (req, res) => {
  const { id } = req.params;
  const pl = appData.playlists.find(p => p.id === id);
  if (!pl) return res.status(404).json({ error: 'Playlist não encontrada' });

  appData.activePlaylistId = id;
  saveData(appData);

  // Notifica telas que não têm config individual
  players.forEach(p => {
    const sConf = appData.screenConfigs?.[p.info.screen];
    if (!sConf?.playlistId && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(JSON.stringify({ type: 'init', payload: buildInitPayload(p.info.screen) }));
    }
  });

  res.json({ ok: true });
});

// ═══════════════════════════════════════
// API — SLIDES DA PLAYLIST ATIVA
// ═══════════════════════════════════════
app.post('/api/playlist/slides', (req, res) => {
  const pl = appData.playlists.find(p => p.id === appData.activePlaylistId);
  if (!pl) return res.status(404).json({ error: 'Playlist não encontrada' });

  pl.slides = req.body;
  saveData(appData);

  // Notifica cada player com os slides corretos para sua playlist
  players.forEach(p => {
    if (p.ws.readyState !== WebSocket.OPEN) return;
    const sConf = appData.screenConfigs?.[p.info.screen] || {};
    const plId = sConf.playlistId || appData.activePlaylistId;
    if (plId === appData.activePlaylistId) {
      p.ws.send(JSON.stringify({ type: 'playlist', payload: buildInitPayload(p.info.screen) }));
    }
  });

  res.json({ ok: true });
});

// Salvar slides de playlist específica
app.post('/api/playlists/:id/slides', (req, res) => {
  const pl = appData.playlists.find(p => p.id === req.params.id);
  if (!pl) return res.status(404).json({ error: 'Playlist não encontrada' });

  pl.slides = req.body;
  saveData(appData);

  // Notifica players que usam esta playlist
  players.forEach(p => {
    if (p.ws.readyState !== WebSocket.OPEN) return;
    const sConf = appData.screenConfigs?.[p.info.screen] || {};
    const plId = sConf.playlistId || appData.activePlaylistId;
    if (plId === req.params.id) {
      p.ws.send(JSON.stringify({ type: 'playlist', payload: buildInitPayload(p.info.screen) }));
    }
  });

  res.json({ ok: true });
});

// ═══════════════════════════════════════
// API — MÍDIA
// ═══════════════════════════════════════
app.post('/api/media/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

  const ext = path.extname(req.file.originalname).toLowerCase();
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
  const videoExts = ['.mp4', '.webm', '.ogg', '.mov', '.avi'];
  const type = imageExts.includes(ext) ? 'image' : videoExts.includes(ext) ? 'video' : 'file';

  const item = {
    id: crypto.randomBytes(8).toString('hex'),
    filename: req.file.filename,
    originalName: req.file.originalname,
    url: `/uploads/${req.file.filename}`,
    type,
    size: req.file.size,
    uploadedAt: new Date().toISOString()
  };

  if (!appData.media) appData.media = [];
  appData.media.push(item);
  saveData(appData);
  res.json(item);
});

app.delete('/api/media/:id', (req, res) => {
  const item = appData.media.find(m => m.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Mídia não encontrada' });

  // Remove arquivo físico
  const filePath = path.join(UPLOADS_DIR, item.filename);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (e) { /* ignora se já removido */ }
  }

  appData.media = appData.media.filter(m => m.id !== req.params.id);

  // Remove slides que referenciam esta mídia
  appData.playlists.forEach(pl => {
    pl.slides = pl.slides.filter(s => s.mediaId !== req.params.id);
  });

  saveData(appData);
  res.json({ ok: true });
});

// ═══════════════════════════════════════
// WEBSOCKET
// ═══════════════════════════════════════
wss.on('connection', (ws, req) => {
  const id = crypto.randomBytes(6).toString('hex');
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  players.set(id, { ws, info: { ip, connectedAt: new Date().toISOString(), screen: 'Desconhecida' } });

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);

      if (msg.type === 'identify') {
        const screenName = (msg.screen || 'Tela sem nome').trim();
        players.get(id).info.screen = screenName;

        ws.send(JSON.stringify({ type: 'init', payload: buildInitPayload(screenName) }));
      }
    } catch (e) {
      console.error('WS message error:', e.message);
    }
  });

  ws.on('close', () => players.delete(id));
  ws.on('error', err => {
    console.error('WS error:', err.message);
    players.delete(id);
  });
});

// ═══════════════════════════════════════
// START
// ═══════════════════════════════════════
server.listen(PORT, () => console.log(`✅ Signage Studio rodando na porta ${PORT}`));

// Captura erros não tratados para aparecer nos logs do EasyPanel
process.on('uncaughtException', (err) => {
  console.error('❌ Erro não tratado:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Promise rejeitada:', reason);
  process.exit(1);
});

server.on('error', (err) => {
  if (err.code === 'EACCES') {
    console.error(`❌ Porta ${PORT} requer permissão root. Defina PORT=3000 nas variáveis de ambiente.`);
  } else if (err.code === 'EADDRINUSE') {
    console.error(`❌ Porta ${PORT} já está em uso.`);
  } else {
    console.error('❌ Erro no servidor:', err.message);
  }
  process.exit(1);
});
