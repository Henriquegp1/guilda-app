# Subir a extensão e o EBS

Duas metades independentes: o **EBS** roda na sua VPS, a **extensão** é um zip
hospedado pela Twitch. A ordem importa — o EBS precisa estar no ar com HTTPS
antes de a extensão conseguir falar com ele.

---

## Parte 1 — EBS na VPS

Requisitos: uma VPS com Docker, e um domínio (ou subdomínio) apontando para o IP
dela. `guilds.seucanal.com` serve.

### 1. DNS antes de tudo

Crie um registro **A** apontando `guilds.seucanal.com` para o IP da VPS. O Caddy
emite o certificado sozinho, mas só depois que o DNS resolver — se subir antes,
o Let's Encrypt falha e você fica achando que é a aplicação.

### 2. Portas

```sh
ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
```

A 80 é obrigatória mesmo usando só HTTPS: é por ela que o Let's Encrypt valida o
domínio.

### 3. Código e variáveis

```sh
git clone <seu-repo> twitch-guilds && cd twitch-guilds
cp .env.deploy.example .env
```

Edite `.env`:

| Variável            | De onde vem                                                        |
| ------------------- | ------------------------------------------------------------------ |
| `DOMINIO`           | O domínio do passo 1                                               |
| `POSTGRES_PASSWORD` | Senha segura. Gere com: `node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"` |
| `TWITCH_EXT_SECRET` | Developer Console → sua extensão → **Settings → Secret Keys**      |
| `ANNOUNCE_ENC_KEY`  | Chave de 32 hex. Gere com: `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"` |
| `CORS_ORIGINS`      | Deixe vazio. `*.ext-twitch.tv` já é aceito por padrão              |

O `TWITCH_EXT_SECRET` é o mesmo segredo que assina o JWT do viewer **e** o recibo
de Bits. Se ele estiver errado, toda chamada volta 401 e nada mais funciona.

### 4. Subir

```sh
docker compose up -d --build
docker compose logs -f ebs
```

A ordem é garantida pelo compose: Postgres sobe, `migrate` roda as 8 migrações e
sai, e só então o `ebs` inicia. Servidor nunca atende contra schema velho.

### 5. Conferir

```sh
curl https://guilds.seucanal.com/health          # {"ok":true}
curl -i https://guilds.seucanal.com/api/v1/guilds # 401, e isso está certo
```

O 401 é o resultado esperado: significa que a autenticação está ativa. Um 200 aí
seria o problema.

### Atualizar depois

```sh
git pull && docker compose up -d --build
```

### Notas de operação

- **Uma instância só.** Os jobs periódicos (`src/core/jobs.js`) usam `setInterval`
  em processo; com duas réplicas cada uma roda tudo. Para escalar horizontalmente,
  troque por BullMQ — o Redis já está na pilha.
- **Backup.** Todo o estado está no volume `db`:
  `docker compose exec db pg_dump -U postgres twitch_guilds | gzip > backup.sql.gz`
- **Redis é opcional.** Se cair, o cache degrada para o Postgres e nada quebra.

---

## Parte 2 — Extensão na Twitch

Tudo em [dev.twitch.tv/console/extensions](https://dev.twitch.tv/console/extensions).

### 1. Criar a extensão

**Create Extension** → nome → marque os tipos:

- **Panel** — 500px de altura declarada (o conteúdo usa 318 × 496)
- **Video Overlay**
- **Mobile**

Config e Live Config não são tipos: são páginas que você aponta no passo 3.

### 2. Capabilities — o passo que a maioria erra

Aba **Capabilities** da versão:

| Campo                      | Valor                              |
| -------------------------- | ---------------------------------- |
| **Allowlist for URL Fetching** (`connect-src`) | `https://guilds.seucanal.com` |
| **Bits Enabled**           | Sim                                |
| **Request Identity Link**  | Sim                                |

O `connect-src` casa **esquema + host**. Declarar `https://` e o frontend chamar
`http://` é bloqueio silencioso: o viewer só vê "sem conexão com o servidor" e o
EBS nem registra a tentativa.

`Request Identity Link` é o que permite `requestIdShare()`. Sem ele, convite
nominal e ações de moderação respondem `IDENTITY_REQUIRED` para sempre.

### 3. Asset Hosting

Aba **Asset Hosting**, com os caminhos exatamente assim:

| Campo                 | Valor                |
| --------------------- | -------------------- |
| Panel Viewer Path     | `panel/index.html`   |
| Video Overlay Path    | `overlay/index.html` |
| Mobile Viewer Path    | `mobile/index.html`  |
| Config Path           | `config/index.html`  |
| Live Config Path      | `live/index.html`    |
| Testing Base URI      | `https://localhost:5173/` (só para o modo local) |

### 4. Produtos em Bits

Aba **Monetization** → **Bits Products**. Crie um com SKU começando em
`guild_creation` — é o prefixo que `Criar.svelte` procura:

| SKU                    | Quantidade | Nome exibido   |
| ---------------------- | ---------- | -------------- |
| `guild_creation_500`   | 500        | Criar guilda   |

Produto em `In Development` só funciona para você; publique quando for testar com
outras pessoas.

### 5. Gerar e subir o zip

```sh
cd frontend
# Substitua pela URL real do seu EBS (ex: https://guilds.seucanal.com)
echo "VITE_EBS=https://seu-ebs.com" > .env.production
npm run zip
```

Sai `frontend/extensao.zip`. Suba em **Files → Asset Hosting → Upload**.

O `VITE_EBS` entra no bundle em tempo de build. Trocou de domínio, refaça o zip —
não adianta mexer só no servidor.

### 6. Testar

**Local Test** roda o frontend da sua máquina; **Hosted Test** usa o zip que você
subiu. Comece pelo Hosted Test: é o único modo que exercita a CSP real.

Instale a extensão no seu canal (**Manage → Installed Extensions**), abra o canal
e confira no console do navegador que **não há erro de Content Security Policy**.
É a verificação que nada local substitui.

Fluxo mínimo para validar a ponta a ponta:

1. Painel abre em **Guildas** (você ainda não tem guilda).
2. Aba **Criar** → preencha → **Criar por 500 Bits**.
3. `live/index.html` (Live Config) mostra a guilda em **Aguardando aprovação**.
4. **Aprovar** → o painel passa a mostrar sua guilda.

### 7. Publicar

**Submit for Review**. A revisão da Twitch costuma pedir: descrição do que a
extensão faz com os dados do viewer, e política de privacidade. O que coletamos é
`user_id` e atividade no canal — vale escrever isso antes de submeter.

---

## ✅ Checklist de Pronto para Produção

- [x] **Brasões e Identidade**: Sistema de editor e loja funcional.
- [x] **Guerra e Territórios**: Interface de Mapa e Desafios integrada no painel.
- [x] **Anúncios no Chat**: Dashboard de configuração e monitoramento pronto.
- [x] **Segurança**: RBAC e Auditoria implementados em todas as rotas administrativas.
- [x] **Mobile**: Layout fluido e alvos de toque otimizados.
