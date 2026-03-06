# 🖥 Signage Studio — Guia de Instalação

Sistema de sinalização interna corporativa com servidor central.  
Admin via browser · Players em qualquer TV/monitor · Atualização em tempo real.

---

## 📁 Estrutura dos arquivos

```
signage/
├── server.js          ← Servidor Node.js (backend)
├── package.json       ← Dependências
├── data.json          ← Banco de dados (criado automaticamente)
├── uploads/           ← Arquivos de mídia (criado automaticamente)
└── public/
    ├── admin/         ← Painel de administração
    │   └── index.html
    └── player/        ← Player para TVs/monitores
        └── index.html
```

---

## 🚀 Instalação rápida

### Passo 1 — Escolha um servidor VPS

**Recomendação:** DigitalOcean ou Hostinger VPS
- DigitalOcean Droplet "Basic": $6/mês (1 GB RAM, 25 GB SSD) → suficiente para 20+ telas
- Link: https://digitalocean.com ou https://hostinger.com.br/vps

Ao criar o servidor, escolha:
- **Sistema:** Ubuntu 22.04 LTS
- **Plano:** 1 GB RAM (mínimo), 2 GB recomendado

---

### Passo 2 — Acesse o servidor via SSH

```bash
ssh root@SEU_IP_DO_SERVIDOR
```

---

### Passo 3 — Instale o Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # deve mostrar v20.x
```

---

### Passo 4 — Envie os arquivos para o servidor

**Opção A — Upload via SCP (do seu computador):**
```bash
scp -r ./signage root@SEU_IP:/opt/signage
```

**Opção B — Crie os arquivos diretamente no servidor:**
```bash
mkdir -p /opt/signage/public/admin /opt/signage/public/player /opt/signage/uploads
cd /opt/signage
# Cole o conteúdo de cada arquivo usando: nano server.js, nano package.json, etc.
```

---

### Passo 5 — Instale as dependências

```bash
cd /opt/signage
npm install
```

---

### Passo 6 — Teste se está funcionando

```bash
node server.js
```

Acesse no navegador: `http://SEU_IP:3000`  
Você deve ver o painel admin.

---

### Passo 7 — Mantenha rodando em produção (PM2)

```bash
npm install -g pm2
pm2 start server.js --name signage
pm2 startup        # para reiniciar automaticamente após reboot
pm2 save
```

Comandos úteis:
```bash
pm2 status         # ver status
pm2 logs signage   # ver logs
pm2 restart signage
```

---

### Passo 8 (Opcional) — Domínio próprio com HTTPS

Se quiser usar um domínio como `signage.suaempresa.com.br`:

**Instale o Nginx:**
```bash
sudo apt install nginx -y
```

**Crie o arquivo de configuração:**
```bash
nano /etc/nginx/sites-available/signage
```

Cole o conteúdo:
```nginx
server {
    listen 80;
    server_name signage.suaempresa.com.br;

    # Aumentar limite de upload para 500MB
    client_max_body_size 500M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

**Ative e instale SSL grátis (Let's Encrypt):**
```bash
ln -s /etc/nginx/sites-available/signage /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d signage.suaempresa.com.br
```

---

## 📺 Como usar

### Admin (você)
Acesse: `http://SEU_IP:3000/admin`  
ou com domínio: `https://signage.suaempresa.com.br/admin`

- Faça upload de imagens e vídeos
- Monte a playlist arrastando e soltando
- Configure duração, transições, ticker de avisos
- Veja quais telas estão conectadas em tempo real

### Player (TVs/monitores)
Abra no navegador da TV: `http://SEU_IP:3000/player`

- Clique na tela para entrar em tela cheia
- Pressione `F` para alternar tela cheia
- O conteúdo atualiza automaticamente quando você muda no admin
- O nome da tela é solicitado na primeira abertura (ex: "Recepção", "Refeitório")

---

## 🔒 Segurança básica (recomendado)

Para proteger o admin com senha, adicione ao início do `server.js` após os requires:

```javascript
const ADMIN_PASS = 'sua_senha_aqui';

app.use('/admin', (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth) {
    res.set('WWW-Authenticate', 'Basic realm="Signage Admin"');
    return res.status(401).send('Autenticação necessária');
  }
  const [,b64] = auth.split(' ');
  const [,pass] = Buffer.from(b64,'base64').toString().split(':');
  if (pass !== ADMIN_PASS) return res.status(401).send('Senha incorreta');
  next();
});
```

---

## ❓ Problemas comuns

**Porta 3000 bloqueada no firewall:**
```bash
sudo ufw allow 3000
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

**Erro "EACCES: permission denied" na pasta uploads:**
```bash
chmod 755 /opt/signage/uploads
```

**Player não conecta via WebSocket:**
- Verifique se o Nginx tem a configuração de `Upgrade` (ver Passo 8)
- Verifique se a URL do player usa o mesmo host/porta do servidor

---

## 📞 Suporte

Para dúvidas técnicas, consulte a documentação do Node.js em nodejs.org  
ou da DigitalOcean em digitalocean.com/community/tutorials
