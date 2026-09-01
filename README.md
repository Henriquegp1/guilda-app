# 🛡️ Twitch Guilds — Sistema de Guildas para Streamers

**Twitch Guilds** é uma extensão completa para a Twitch que transforma o chat em um ecossistema competitivo de guildas. Espectadores podem fundar suas próprias comunidades, recrutar membros, ganhar XP coletivo e disputar territórios e posições no ranking por temporadas.

Este projeto foi construído seguindo rigorosos padrões de segurança (HMAC, RBAC) e limites técnicos da plataforma Twitch (PubSub 5KB, Panel 318px).

---

## 🚀 Guia Rápido de Instalação (Para Streamers)

### 1. Requisitos do Servidor
O sistema requer um **EBS (Extension Backend Service)** rodando.
- **Runtime**: Node.js 20+
- **Banco de Dados**: PostgreSQL 15+
- **Cache**: Redis (opcional, para ranking ao vivo)

### 2. Configuração Inicial
1.  Clone o repositório e instale as dependências: `npm install`.
2.  Configure o arquivo `.env` com as chaves da Twitch e credenciais do banco.
3.  Rode as migrações: `node src/core/migrate.js`.
4.  Inicie o servidor: `npm start`.

### 3. No Painel do Streamer (Dashboard)
Após instalar a extensão na Twitch:
1.  **Crie uma Temporada**: O ranking só ativa quando houver uma temporada rodando.
2.  **Crie Territórios**: Defina os locais que as guildas disputarão no mapa.
3.  **Configure Anúncios**: Insira a URL do seu bot (ex: Nightbot/StreamElements) para que a extensão avise no chat quando uma guilda for criada ou uma guerra terminar.

---

## 📖 Como Funciona (Para Espectadores)

### Fundando sua Guilda
- Use o comando `!criarguilda <NOME>` ou abra o painel lateral da live.
- Escolha o nome, TAG e cores. A criação é paga via **Bits**.
- Sua guilda entrará em uma fila de moderação para garantir que o nome seja adequado.

### Progressão e Conquistas
- Espectadores ganham XP para a guilda simplesmente assistindo à live ou participando de eventos.
- Suba de nível para desbloquear mais vagas de membros e novas molduras de brasão.
- Conquiste medalhas permanentes ou sazonais para o perfil da guilda.

### Guerras e Territórios
- Líderes podem desafiar outras guildas para guerras de 48h.
- A guilda com mais atividade (Watch Ticks) durante o período vence.
- Disputas territoriais no Mapa Mundi garantem bônus diário de **Prestígio**.

---

## 🛠️ Estrutura do Código

```
.
├── src/               # Backend (Node.js + Fastify)
│   ├── core/          # Núcleo: Banco de Dados, Auth, Migrações e Eventos
│   └── modules/       # Módulos de domínio (Fases 01 a 07)
├── frontend/          # Extensão (Svelte 5 + SvelteKit)
│   ├── src/routes/    # Views: Painel, Overlay, Configuração, Mobile
│   └── src/lib/       # Componentes UI, Integração Twitch e API
└── docs/              # Documentação Técnica e Regras de Negócio
```

### Principais Tecnologias
- **Backend**: Node.js, Fastify, PostgreSQL (pg), BullMQ (Jobs).
- **Frontend**: Svelte 5, SvelteKit, GSAP (Animações), Tailwind-like CSS.

---

## 🛠️ Comandos e Operação

### Comandos de Chat (Viewer)
- `!criarguilda <NOME>`: Inicia o processo de criação de uma nova guilda.

### Comandos de Manutenção (Admin/Terminal)
Caso precise realizar manutenções manuais no banco de dados (EBS):
```sh
# Rodar migrações pendentes
node src/core/migrate.js

# Limpar rascunhos de pagamento expirados (Job manual)
node -e "import('./src/modules/guilds/index.js').then(m => m.reapExpiredDrafts())"

# Recalcular conquistas retroativamente
node -e "import('./src/modules/seasons/index.js').then(m => m.backfillAchievements())"
```

## 🛡️ Segurança e Governança
- **RBAC**: Permissões diferenciadas para Broadcaster, Moderator e Líder de Guilda.
- **Auditoria**: Todas as ações administrativas (Banir, Suspender, Aprovar) são registradas no `audit_log` com motivo obrigatório.
- **HMAC**: Webhooks para bots são assinados com segredos rotacionáveis, garantindo a integridade dos anúncios.

## 📄 Documentação Detalhada
1.  **[Arquitetura do Sistema](docs/ARQUITETURA.md)**
2.  **[Dicionário de Eventos](docs/EVENTOS.md)**
3.  **[Manual de Design](docs/DESIGN.md)**

---
*Desenvolvido como uma solução genérica e escalável para engajamento de comunidades na Twitch.*
