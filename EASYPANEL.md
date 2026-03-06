# 🖥 Signage Studio — Deploy no EasyPanel

---

## ⚠️ Problema comum: arquivos somem após reimplantação

Isso acontece porque o EasyPanel recria o container a cada deploy.
A solução é mapear um **Volume persistente** para o caminho `/data` antes do primeiro deploy.
**Faça isso uma única vez — os dados sobrevivem a todos os deploys futuros.**

---

## Passo a passo completo

### 1. Suba o projeto no GitHub

```bash
git init
git add .
git commit -m "primeiro commit"
git remote add origin https://github.com/seu-usuario/signage.git
git push -u origin main
```

---

### 2. Crie o serviço no EasyPanel

1. Acesse seu EasyPanel → clique no projeto ou crie um novo
2. Clique em **"+ Create Service"** → escolha **"App"**
3. Em **Source**, selecione **GitHub** e autorize o acesso
4. Selecione o repositório e branch `main`
5. Em **Build Method** → selecione **"Dockerfile"**
6. **Port:** `3000`

---

### 3. ⚡ Configure o Volume persistente (passo crítico)

> Sem isso os arquivos somem a cada deploy.

No painel do serviço, vá em **"Mounts"** e adicione:

| Tipo | Mount Path no container |
|---|---|
| **Volume** | `/data` |

O volume guarda:
- `/data/data.json` — banco de dados (playlists, config, mídia)
- `/data/uploads/` — todos os arquivos enviados (imagens, vídeos)

---

### 4. Variáveis de ambiente

No painel **"Environment"**, confirme que estão presentes:

| Variável | Valor |
|---|---|
| `PORT` | `3000` |
| `DATA_FILE` | `/data/data.json` |
| `UPLOADS_DIR` | `/data/uploads` |

O Dockerfile já define esses valores — só adicione aqui se quiser sobrescrever.

---

### 5. Configure o domínio

1. Clique em **"Domains"**
2. Adicione seu domínio, ex: `signage.suaempresa.com.br`
3. Ative **HTTPS** — certificado gerado automaticamente

---

### 6. Deploy

Clique em **"Deploy"**. A partir de agora uploads e configurações ficam salvos permanentemente.

---

## URLs após o deploy

| URL | Para quê |
|---|---|
| `https://signage.suaempresa.com.br/admin` | Painel de gerenciamento |
| `https://signage.suaempresa.com.br/player` | Abrir nas TVs/monitores |

---

## Backup manual via terminal do EasyPanel

```bash
# Copiar data.json
docker cp $(docker ps -q -f name=signage):/data/data.json ./backup-data.json

# Copiar uploads
docker cp $(docker ps -q -f name=signage):/data/uploads ./backup-uploads
```

---

## Proteção com senha (recomendado)

Adicione a variável `ADMIN_PASS=sua_senha` no painel **"Environment"** e inclua no `server.js`:

```javascript
if (process.env.ADMIN_PASS) {
  app.use('/admin', (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth) {
      res.set('WWW-Authenticate', 'Basic realm="Signage Admin"');
      return res.status(401).send('Login necessário');
    }
    const pass = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':')[1];
    if (pass !== process.env.ADMIN_PASS) return res.status(401).send('Senha incorreta');
    next();
  });
}
```

---

## WebSocket com EasyPanel

O Traefik do EasyPanel suporta WebSocket automaticamente — nenhuma configuração extra é necessária.

---

## ⚠️ Loop de reinicialização (porta 80)

**Sintoma:** logs mostram `✅ Signage Studio rodando na porta 80` repetindo infinitamente.

**Causa:** o EasyPanel estava enviando `PORT=80` como variável de ambiente. O Node.js não tem permissão de root para ouvir portas abaixo de 1024, o servidor crasha e reinicia em loop.

**Solução:**

1. No painel do serviço → **"Environment"**
2. Verifique se existe `PORT=80` — **remova** ou altere para `PORT=3000`
3. Confirme que está assim:

| Variável | Valor |
|---|---|
| `PORT` | `3000` |

O EasyPanel/Traefik roteia o tráfego externo (80/443) para a porta interna 3000 automaticamente — você **não** precisa definir `PORT=80`.

4. Clique em **"Deploy"** novamente.
