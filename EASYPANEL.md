# 🖥 Signage Studio — Deploy com EasyPanel

---

## O que você vai precisar

- Servidor com EasyPanel instalado (já rodando)
- Um repositório Git (GitHub, GitLab ou Gitea) **ou** upload direto via interface
- ~5 minutos

---

## Opção A — Deploy via GitHub (recomendado)

### 1. Suba o projeto no GitHub

Crie um repositório no github.com e faça push de todos os arquivos:

```bash
git init
git add .
git commit -m "primeiro commit"
git remote add origin https://github.com/seu-usuario/signage.git
git push -u origin main
```

### 2. No EasyPanel — crie um novo serviço

1. Acesse seu EasyPanel → clique no projeto ou crie um novo
2. Clique em **"+ Create Service"**
3. Escolha **"App"**
4. Em **"Source"**, selecione **GitHub** e autorize o acesso
5. Selecione o repositório `signage`
6. Branch: `main`

### 3. Configure o serviço

Na tela de configuração do serviço:

| Campo | Valor |
|---|---|
| **Build Method** | Dockerfile |
| **Dockerfile path** | `Dockerfile` |
| **Port** | `3000` |

### 4. Adicione volumes persistentes

Clique em **"Mounts"** (ou **"Volumes"**) e adicione:

| Mount Path | Descrição |
|---|---|
| `/app/uploads` | Arquivos de mídia enviados |
| `/app/data.json` | Banco de dados da playlist |

> ⚠️ **Importante:** sem os volumes, os arquivos somem ao reiniciar o container!

Para `data.json`, use um **File Mount** com conteúdo inicial:
```json
{"playlist":[],"config":{"logo":"MINHA EMPRESA","accent":"#00e5ff","duration":10,"loop":true,"transition":"fade","showHud":true,"showDots":true,"fitCover":false,"tickerEnabled":false,"tickerText":"","tickerLabel":"AVISOS"},"media":[]}
```

### 5. Configure o domínio

1. Clique em **"Domains"**
2. Adicione seu domínio, ex: `signage.suaempresa.com.br`
3. Ative **HTTPS** (EasyPanel gera o certificado Let's Encrypt automaticamente)

### 6. Deploy

Clique em **"Deploy"** — o EasyPanel vai:
- Fazer o build com o Dockerfile
- Subir o container
- Configurar HTTPS automaticamente

---

## Opção B — Deploy via upload de ZIP (sem Git)

Se preferir não usar Git:

1. No EasyPanel, crie um serviço do tipo **"App"**
2. Em Source, escolha **"Upload"** ou use o terminal integrado
3. No terminal do EasyPanel:

```bash
# Baixe e descompacte direto no servidor
cd /
mkdir -p /opt/signage
# Faça upload via SFTP ou cole os arquivos pelo terminal
cd /opt/signage
npm install
```

4. Configure como serviço systemd ou use o **"Custom Command"** do EasyPanel:
   - Start command: `node server.js`
   - Working directory: `/opt/signage`

---

## Opção C — Nixpacks (sem Dockerfile)

O EasyPanel suporta **Nixpacks** que detecta Node.js automaticamente.

1. Crie o serviço apontando para o repositório
2. Em Build Method, selecione **"Nixpacks"**
3. Start Command: `node server.js`
4. Port: `3000`

O `package.json` já tem `"start": "node server.js"` — Nixpacks detecta automaticamente.

---

## Variáveis de ambiente (opcional)

No painel de **Environment Variables** do EasyPanel:

| Variável | Valor padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta do servidor |
| `DATA_FILE` | `/app/data.json` | Caminho do banco |
| `UPLOADS_DIR` | `/app/uploads` | Pasta de uploads |

---

## Acessando depois do deploy

| URL | Para quê |
|---|---|
| `https://signage.suaempresa.com.br/admin` | Painel de gerenciamento |
| `https://signage.suaempresa.com.br/player` | Abrir nas TVs/monitores |

### Nas TVs
1. Abra o Chrome/Edge na TV
2. Acesse `https://signage.suaempresa.com.br/player`
3. Clique na tela → entra em **tela cheia** automaticamente
4. Digite o nome da tela ("Recepção", "Refeitório"...)
5. Pronto — o conteúdo carrega e atualiza em tempo real

---

## WebSocket com EasyPanel + proxy

O EasyPanel usa Traefik como proxy reverso. O WebSocket funciona automaticamente com HTTPS/WSS.

Se por algum motivo o WebSocket não conectar, verifique se o serviço tem o label:
```
traefik.http.middlewares.ws.headers.customrequestheaders.X-Forwarded-Proto=https
```

Na prática isso raramente é necessário — o Traefik do EasyPanel já suporta WebSocket por padrão.

---

## Dica: proteção com senha básica

No EasyPanel, em **"Basic Auth"** (se disponível no seu plano), você pode proteger a rota `/admin` com usuário e senha diretamente pela interface, sem alterar código.

Ou adicione no início do `server.js`:

```javascript
app.use('/admin', (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth) { res.set('WWW-Authenticate','Basic realm="Admin"'); return res.status(401).send('Login necessário'); }
  const pass = Buffer.from(auth.split(' ')[1],'base64').toString().split(':')[1];
  if (pass !== process.env.ADMIN_PASS) return res.status(401).send('Senha incorreta');
  next();
});
```

E adicione a variável de ambiente `ADMIN_PASS=suasenha` no EasyPanel.
