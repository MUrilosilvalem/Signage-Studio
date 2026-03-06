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
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const defaults = {
      playlists: [{ id: crypto.randomBytes(8).toString('hex'), name: 'Playlist Principal', slides: [] }],
      activePlaylistId: null,
      screenConfigs: {}, // Armazena { playlistId, orientation } por nome da tela
      config: { logo: 'MINHA EMPRESA', accent: '#00e5ff', duration: 10, loop: true, transition: 'fade', showHud: true, showDots: true, orientation: 'landscape' },
      media: []
    };
    defaults.activePlaylistId = defaults.playlists[0].id;
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let appData = loadData();
const players = new Map();

function broadcastAdminPlayers() {
  // Opcional: Notificar admins via WS se houver canal dedicado
}

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(8).toString('hex') + path.extname(file.originalname))
  }),
  limits: { fileSize: 500 * 1024 * 1024 }
});

app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/admin', express.static(path.join(__dirname, 'public/admin')));
app.use('/player', express.static(path.join(__dirname, 'public/player')));
app.use('/shared', express.static(path.join(__dirname, 'public/shared')));
app.get('/', (req, res) => res.redirect('/admin'));

// API Rotas
app.get('/api/data', (req, res) => res.json(appData));
app.get('/api/players', (req, res) => {
  const list = [];
  players.forEach((v, id) => list.push({ id, ...v.info }));
  res.json(list);
});

// NOVA ROTA: Configuração individual de tela
app.post('/api/screens/config', (req, res) => {
  const { screenName, playlistId, orientation } = req.body;
  if (!appData.screenConfigs) appData.screenConfigs = {};
  
  appData.screenConfigs[screenName] = { playlistId, orientation };
  saveData(appData);

  // Atualiza players conectados que correspondem ao nome
  players.forEach(p => {
    if (p.info.screen === screenName) {
      const pl = appData.playlists.find(x => x.id === playlistId) || { slides: [] };
      p.ws.send(JSON.stringify({ 
        type: 'init', 
        payload: { ...appData, playlist: pl.slides, config: { ...appData.config, orientation } } 
      }));
    }
  });
  res.json({ ok: true });
});

// Manter outras rotas de playlist, media, etc (omitidas para brevidade)
// ... [Insira aqui as rotas de app.post('/api/playlists'), delete, etc do original]

wss.on('connection', (ws, req) => {
  const id = crypto.randomBytes(6).toString('hex');
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  players.set(id, { ws, info: { ip, connectedAt: new Date().toISOString(), screen: 'Unknown' } });

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'identify') {
        const sName = msg.screen || 'Tela sem nome';
        players.get(id).info.screen = sName;
        
        // Carrega config individual se existir
        const sConf = appData.screenConfigs?.[sName];
        const pId = sConf?.playlistId || appData.activePlaylistId;
        const orient = sConf?.orientation || appData.config.orientation;
        const pl = appData.playlists.find(p => p.id === pId);

        ws.send(JSON.stringify({ 
          type: 'init', 
          payload: { ...appData, playlist: pl ? pl.slides : [], config: { ...appData.config, orientation: orient } } 
        }));
      }
    } catch (e) {}
  });

  ws.on('close', () => players.delete(id));
});

server.listen(PORT, () => console.log(`Server on port ${PORT}`));
