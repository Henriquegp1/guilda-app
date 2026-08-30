# Fase 07 — Integração com o Chat

## 1. Objetivo

Expor os eventos que o sistema **já produz** (`guild_event`) para o bot do streamer
anunciar no chat. O painel da extensão é invisível para quem nunca clicou nele; o
anúncio no chat é o canal de descoberta do sistema de guildas.

Esta fase **não cria pipeline de evento**. Ela lê `guild_event`, filtra, formata e
entrega. Se um evento não existe nas fases 01–06, ele não existe aqui.

## 2. Escopo

- Catálogo fechado de eventos anunciáveis, mapeados 1:1 para `guild_event.type`.
- Fila de saída (`announce_outbox`) com deduplicação e expiração.
- Entrega por **webhook HTTP assinado** ao endpoint do bot do streamer.
- Templates de mensagem editáveis na página de config da extensão.
- Controle de spam: teto horário, cooldown por tipo, agregação, mute, quiet hours.
- Log de entrega visível ao streamer.

### Fora do escopo

- Bot próprio da extensão (não pedimos escopo `chat:edit` na v1 — ver §4).
- Reação a comandos do chat (`!guilda`, `!ranking`). Fase futura.
- Anúncio em Discord/Twitter/overlay. O contrato do webhook serve, mas não damos suporte.
- Tradução/i18n das mensagens. Template é texto livre do streamer.
- Reenvio de anúncio atrasado. Anúncio velho é lixo (R12).
- Reconciliação histórica: eventos anteriores à ativação nunca são anunciados (R2).

## 3. Catálogo de eventos anunciáveis

Nomes de `type` seguem a convenção `dominio.fato`. Se a fase de origem usar outro
literal, **a fase de origem manda** e a coluna abaixo é corrigida sem mudar esta fase
(o mapeamento vive em `announce_event_config.event_type`).

| Evento (anúncio) | `guild_event.type` de origem | Fase | Prioridade | Ligado por padrão |
|---|---|---|---|---|
| Guilda aprovada e pública | `guild.approved` | 01 | alta | ✅ |
| Guilda criada (pagamento confirmado) | `guild.created` | 01 | — | ❌ nunca anunciável (R3) |
| Guilda subiu de nível | `guild.level_up` | 03 | média | ✅ |
| Mudança de TOP 1 | `ranking.top1_changed` | 04 | alta | ✅ |
| Entrada no Top 3 | `ranking.top3_entered` | 04 | baixa | ❌ |
| Guerra declarada | `war.declared` | 05 | alta | ✅ |
| Guerra aceita | `war.accepted` | 05 | média | ✅ |
| Guerra encerrada (resultado) | `war.ended` | 05 | alta | ✅ |
| Território conquistado | `territory.captured` | 05 | média | ✅ |
| Conquista desbloqueada | `achievement.unlocked` | 04 | baixa | ❌ |
| Temporada iniciada | `season.started` | 04 | alta | ✅ |
| Temporada encerrada (pódio) | `season.ended` | 04 | alta | ✅ |
| Guilda recrutando | `guild.recruiting` | 02 | baixa | ❌ |

Notas de catálogo:

| Regra | Detalhe |
|---|---|
| Prioridade **alta** | Nunca agregada, nunca descartada por cooldown — só adiada até 60 s. Conta no teto horário. |
| Prioridade **média** | Agregável. Descartada se o teto horário estourar. |
| Prioridade **baixa** | Agregável e descartável. Nunca ligada por padrão (o streamer opta). |
| `guild.recruiting` | Emitido no máximo 1×/24 h por guilda pela fase 02; aqui recebe cooldown de canal de 30 min. |
| `achievement.unlocked` | Só conquistas de raridade `epic`/`legendary` entram na fila. As comuns são ruído. |
| `ranking.top3_entered` | Só dispara em **entrada** no Top 3, nunca em troca de posição interna (4º→3º sim, 3º→2º não). |

## 4. Mecanismo de entrega

| Opção | Latência | Esforço nosso | Esforço do streamer | Falha do bot | Escopo Twitch extra |
|---|---|---|---|---|---|
| **Webhook HTTP assinado** | < 2 s | baixo | precisa de bot com endpoint HTTP | fila retém + retry | nenhum |
| Polling de fila (`GET /outbox`) | 5–30 s | médio (cursor, ack, GC) | bot só faz GET | trivial (bot busca depois) | nenhum |
| EventSub | — | alto | — | — | **não serve**: EventSub é Twitch→nós, não nós→bot |
| Bot próprio da extensão | < 1 s | alto (OAuth, presença, rate limit global, moderação) | zero | nosso problema | `chat:edit` + conta bot + review |

**Escolha v1: webhook HTTP assinado.**
É o menor código nosso e o que já existe do outro lado — Nightbot/StreamElements/Fossabot
e qualquer bot caseiro aceitam POST. Bot próprio nos coloca no rate limit global da
Twitch e em responsabilidade de moderação que não queremos na v1; polling paga
infraestrutura de cursor para ganhar latência pior.

### Contrato de entrega

| Item | Valor |
|---|---|
| Método / destino | `POST` em `announce_config.webhook_url` (https obrigatório) |
| Content-Type | `application/json; charset=utf-8` |
| Timeout | 3 s conexão, 5 s total |
| Tentativas | 3 (1 imediata + 2 retries) |
| Backoff | 2 s → 10 s, com jitter ±20 % |
| Sucesso | HTTP `2xx`. Corpo ignorado. |
| Retry | `408`, `429`, `5xx`, timeout, DNS/TLS |
| Sem retry | `400`, `401`, `403`, `404`, `410`, `413`, `422` → `status='failed'` direto |
| Garantia | **Ao menos uma vez.** O bot deduplica por `id`. |
| Chave de dedup | `id` (ULID) do payload = `announce_outbox.id`. Estável entre tentativas. |
| TTL | 600 s. Passou, `status='expired'`, nunca entregue (R12). |
| Circuit breaker | 10 falhas consecutivas → `announce_config.enabled=false`, aviso na página de config. Religar é manual. |

**Bot fora do ar:** o evento fica em `queued`, tenta 3 vezes em até ~12 s, expira em
600 s e vira `expired`. Nada é reenviado depois. O streamer vê a linha vermelha no log
de entrega. Chat não recebe anúncio de guerra que acabou há 40 minutos.

### Payload

```json
{
  "id": "01J9F3K7QW8ZC4B2M0N6X5TDVA",
  "channel_id": "141981764",
  "event": "ranking.top1_changed",
  "priority": "alta",
  "occurred_at": "2026-08-28T20:14:03.117Z",
  "message": "🏆 ECLIPSE assumiu o TOP 1! A guilda ultrapassou VOID com 14.520 de Prestígio.",
  "aggregate": { "count": 1, "window_s": 0 },
  "vars": {
    "guilda": "Eclipse",
    "tag": "ECL",
    "lider": "Foyth",
    "prestigio": "14.520",
    "posicao": "1",
    "guilda_anterior": "Void",
    "tag_anterior": "VOID"
  }
}
```

Headers:

| Header | Exemplo | Uso |
|---|---|---|
| `X-Guilds-Delivery-Id` | `01J9F3K7QW8ZC4B2M0N6X5TDVA` | igual a `id`; chave de dedup do bot |
| `X-Guilds-Event` | `ranking.top1_changed` | roteamento sem parsear o corpo |
| `X-Guilds-Timestamp` | `1756412043` | epoch em segundos |
| `X-Guilds-Attempt` | `2` | 1..3 |
| `X-Guilds-Signature` | `v1=9f3c…,v1=1ab7…` | HMAC-SHA256 hex; 2 valores durante rotação |

Assinatura: `HMAC_SHA256(secret, "<X-Guilds-Timestamp>.<corpo bruto>")`, hex minúsculo.
O bot deve comparar em tempo constante e rejeitar `|agora − timestamp| > 300 s`.

## 5. Templates de mensagem

Editados na página de config da extensão (`config.html`), um campo por evento, com
preview ao vivo usando dados fictícios e botão **Enviar teste** (`POST /announce/test`).

| Regra | Valor |
|---|---|
| Sintaxe | `{variavel}`. Chave literal: `{{` e `}}`. |
| Tamanho do template | ≤ 300 caracteres (`CHECK`) |
| Tamanho da mensagem renderizada | ≤ 400 caracteres; acima disso trunca em 399 + `…` |
| Por que 400 e não 500 | O bot prefixa o próprio texto/nome; 100 caracteres de folga contra o limite de 500 da Twitch |
| Escaping | Valores são texto puro. Removemos de todo valor: `\r`, `\n`, `\t`, caracteres de controle e `U+E0000–U+E007F`. Colapsamos runs de espaço. |
| Anti-comando | Se o resultado começar com `/` ou `.`, prefixamos `​` (ZWSP) — nome de guilda não vira `/ban`. |
| Variável desconhecida | Rejeitada na gravação (`UNKNOWN_VARIABLE`), não no envio. |
| Variável nula em runtime | Substituída por string vazia; a mensagem ainda vai. |

### Variáveis

Comuns a todos os eventos: `{guilda}`, `{tag}`, `{lider}`, `{nivel}`, `{prestigio}`,
`{membros}`, `{canal}`.

| Evento | Variáveis adicionais |
|---|---|
| `guild.approved` | — |
| `guild.level_up` | `{nivel_anterior}`, `{desbloqueio}` |
| `ranking.top1_changed` | `{posicao}`, `{guilda_anterior}`, `{tag_anterior}`, `{diferenca}` |
| `ranking.top3_entered` | `{posicao}` |
| `war.declared` / `war.accepted` | `{oponente}`, `{tag_oponente}`, `{duracao}` |
| `war.ended` | `{oponente}`, `{tag_oponente}`, `{vencedor}`, `{placar}` |
| `territory.captured` | `{territorio}`, `{dono_anterior}` |
| `achievement.unlocked` | `{conquista}`, `{raridade}` |
| `season.started` | `{temporada}`, `{termina_em}` |
| `season.ended` | `{temporada}`, `{primeiro}`, `{segundo}`, `{terceiro}` |
| `guild.recruiting` | `{vagas}`, `{modo}` |
| Qualquer agregado | `{quantidade}`, `{lista}` (até 3 nomes + "e mais N") |

Números formatados em pt-BR no servidor (`14.520`). O template não faz aritmética.

### Templates padrão (extrato)

```
guild.approved       ⚔️ NOVA GUILDA CRIADA! {lider} fundou {guilda} [{tag}] — a guilda está recrutando novos membros!
ranking.top1_changed 🏆 {tag} assumiu o TOP 1! A guilda ultrapassou {tag_anterior} com {prestigio} de Prestígio.
war.declared         ⚔️ {guilda} [{tag}] declarou guerra a {oponente} [{tag_oponente}]! Duração: {duracao}.
season.ended         🏁 Temporada {temporada} encerrada! 🥇 {primeiro} 🥈 {segundo} 🥉 {terceiro}
guild.approved#agg   ⚔️ {quantidade} novas guildas nasceram: {lista}. Abra a extensão para entrar em uma!
```

### Fallback de template quebrado

| Situação | Comportamento |
|---|---|
| Template inválido na gravação | `400 INVALID_TEMPLATE` — nunca é salvo quebrado |
| Template válido mas render falha em runtime | Usa o template padrão do evento; log com `fallback_used=true` |
| Template padrão também falha | Mensagem mínima: `[{tag}] {evento}`; nunca deixa de entregar |
| Template salvo vazio | Equivale a desligar o evento; nada é enfileirado |

## 6. Controle de spam

Um canal com 200 viewers criando guildas no primeiro dia gera 40 eventos em 10 minutos.
Sem esta seção a extensão é banida do canal na primeira semana. Números fechados,
todos configuráveis dentro dos limites indicados.

### Tetos

| Limite | Padrão | Faixa | Escopo |
|---|---|---|---|
| Anúncios por hora | **12** | 4–20 | canal, janela deslizante de 60 min |
| Rajada | **3 em 60 s** | fixo | canal |
| Espaçamento mínimo | **20 s** entre dois anúncios | fixo | canal |
| Fila em memória | 200 itens | fixo | canal; acima disso descarta prioridade baixa primeiro |

Ordem de avaliação de cada evento: **ligado? → guilda elegível (R3/R4) → quiet/mute →
cooldown do tipo → agregação → teto horário → rajada/espaçamento → enfileira.**

### Cooldown por tipo

| Tipo | Cooldown | Ação ao violar |
|---|---|---|
| `guild.approved` | 120 s | agrega |
| `guild.level_up` | 300 s | agrega |
| `ranking.top1_changed` | 600 s | mantém o **último**, descarta os intermediários |
| `ranking.top3_entered` | 900 s | descarta |
| `war.declared` | 180 s | agrega |
| `war.accepted` | 300 s | agrega |
| `war.ended` | 120 s | agrega |
| `territory.captured` | 300 s | agrega |
| `achievement.unlocked` | 900 s | agrega |
| `season.started` / `season.ended` | 3600 s | descarta duplicata |
| `guild.recruiting` | 1800 s | descarta |

### Agregação

| Item | Valor |
|---|---|
| Janela | 300 s por `(channel_id, event_type)` |
| Gatilho | ≥ **3** eventos do mesmo tipo na janela |
| Envio | no fim da janela ou ao atingir 10 eventos, o que vier primeiro |
| Mensagem | template `#agg` do tipo, com `{quantidade}` e `{lista}` (3 nomes + "e mais N") |
| Não agregável | `ranking.top1_changed`, `season.*` — colapsam para o último em vez de agregar |
| Custo no teto | 1 anúncio, independente de quantos eventos entraram |

Exemplo: 10 guildas aprovadas em 5 min → 1 mensagem
`⚔️ 10 novas guildas nasceram: Ordem Carmesim, Eclipse, Void e mais 7. Abra a extensão para entrar em uma!`

### Silêncio

| Gatilho | Duração | Como |
|---|---|---|
| Raid recebida/enviada | **10 min** | o bot chama `POST /announce/mute {"minutes":10,"reason":"raid"}` |
| Mute manual | 1–240 min | mesma rota, ou botão na config |
| Quiet hours | janela `HH:MM–HH:MM` + timezone | `announce_config.quiet_from/quiet_to/timezone` |
| Canal offline | enquanto offline | anúncio sem audiência é spam no VOD; retomada automática |

Não detectamos raid por conta própria: quem sabe é o bot, que já está no chat. Uma
rota de mute é mais barata e mais correta que assinar EventSub.

### Destino dos eventos suprimidos

| Motivo | Destino | `outbox.status` |
|---|---|---|
| Cooldown, tipo agregável | **agregado** na próxima janela | `aggregated` |
| Cooldown, tipo não agregável | descartado (fica o último) | `superseded` |
| Teto horário estourado, prioridade **alta** | adiado até 60 s; se não couber, descartado | `suppressed` |
| Teto horário estourado, prioridade média/baixa | descartado | `suppressed` |
| Mute / quiet hours / offline | **descartado** — não acumula para explodir na volta | `suppressed` |
| TTL de 600 s vencido | descartado | `expired` |

Regra de ouro: **evento suprimido não vira dívida.** Nada é guardado para disparar
depois; o estado real continua no painel da extensão, que é a fonte de verdade.
Tudo que é suprimido é registrado em `announce_outbox` com `suppress_reason`,
visível no log de entrega — o streamer vê o que não foi anunciado e por quê.

## 7. Configuração pelo streamer

Página de config da extensão, seção "Anúncios no chat". Só `role=broadcaster` grava.

| Bloco | Controles |
|---|---|
| Conexão | `webhook_url` (https), segredo (mostrar 1× / rotacionar), botão **Enviar teste**, status do circuit breaker |
| Por evento | switch liga/desliga, campo de template (300 chars, contador), template agregado, cooldown (dentro da faixa), preview ao vivo |
| Tetos | anúncios/hora (4–20), quiet hours + timezone, mute manual com duração |
| Log | últimas 50 entregas: horário, evento, status, HTTP, latência, motivo de supressão |
| Global | switch mestre `enabled` |

"Canal de destino" na v1 é o canal do próprio broadcaster — o `channel_id` do JWT.
Escolher outro canal não existe; o bot decide onde escreve.

## 8. Modelo de dados (delta)

Só o que esta fase acrescenta. `guild_event`, `guild` e `channel` vêm da arquitetura.

```sql
CREATE TYPE announce_status AS ENUM
  ('queued','sending','sent','failed','expired','suppressed','aggregated','superseded');

CREATE TABLE announce_config (
  channel_id    uuid PRIMARY KEY REFERENCES channel(id) ON DELETE CASCADE,
  enabled       boolean     NOT NULL DEFAULT false,
  webhook_url   text,
  hourly_cap    smallint    NOT NULL DEFAULT 12,
  quiet_from    time,
  quiet_to      time,
  timezone      text        NOT NULL DEFAULT 'America/Sao_Paulo',
  muted_until   timestamptz,
  fail_streak   smallint    NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cap_range   CHECK (hourly_cap BETWEEN 4 AND 20),
  CONSTRAINT quiet_pair  CHECK ((quiet_from IS NULL) = (quiet_to IS NULL)),
  CONSTRAINT https_only  CHECK (webhook_url IS NULL OR webhook_url ~ '^https://'),
  CONSTRAINT need_url    CHECK (NOT enabled OR webhook_url IS NOT NULL)
);

CREATE TABLE announce_event_config (
  channel_id   uuid NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  event_type   text NOT NULL,
  enabled      boolean  NOT NULL DEFAULT false,
  template     text,
  template_agg text,
  cooldown_s   integer  NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, event_type),
  CONSTRAINT tpl_len     CHECK (template     IS NULL OR char_length(template)     <= 300),
  CONSTRAINT tpl_agg_len CHECK (template_agg IS NULL OR char_length(template_agg) <= 300),
  CONSTRAINT cd_range    CHECK (cooldown_s BETWEEN 30 AND 86400)
);

CREATE TABLE announce_secret (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id  uuid NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  secret_enc  bytea       NOT NULL,          -- cifrado com a chave da app (KMS/pgcrypto)
  status      text        NOT NULL CHECK (status IN ('active','retiring','revoked')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  retires_at  timestamptz                    -- fim da janela de dupla assinatura
);
-- no máximo um segredo ativo por canal
CREATE UNIQUE INDEX announce_secret_one_active
  ON announce_secret (channel_id) WHERE status = 'active';

CREATE TABLE announce_outbox (
  id              text PRIMARY KEY,          -- ULID, é a chave de dedup do payload
  channel_id      uuid NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  guild_event_id  uuid REFERENCES guild_event(id),   -- NULL só em agregado/teste
  guild_id        uuid REFERENCES guild(id),
  event_type      text NOT NULL,
  priority        text NOT NULL CHECK (priority IN ('alta','media','baixa')),
  dedup_key       text NOT NULL,
  status          announce_status NOT NULL DEFAULT 'queued',
  suppress_reason text,
  aggregate_count smallint NOT NULL DEFAULT 1,
  message         text,
  payload         jsonb    NOT NULL,
  attempts        smallint NOT NULL DEFAULT 0,
  not_before      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  CONSTRAINT msg_len   CHECK (message IS NULL OR char_length(message) <= 400),
  CONSTRAINT sent_time CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  CONSTRAINT why_supp  CHECK (status <> 'suppressed' OR suppress_reason IS NOT NULL)
);
-- R14: o mesmo guild_event nunca gera dois anúncios, nem após replay da fila
CREATE UNIQUE INDEX announce_outbox_dedup
  ON announce_outbox (channel_id, dedup_key);
CREATE INDEX announce_outbox_due
  ON announce_outbox (channel_id, not_before) WHERE status = 'queued';
CREATE INDEX announce_outbox_rate
  ON announce_outbox (channel_id, sent_at DESC) WHERE status = 'sent';

CREATE TABLE announce_delivery_log (
  id          bigserial PRIMARY KEY,
  outbox_id   text NOT NULL REFERENCES announce_outbox(id) ON DELETE CASCADE,
  attempt     smallint NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  http_status smallint,
  latency_ms  integer,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (outbox_id, attempt)
);
```

`dedup_key`:

| Origem | Valor |
|---|---|
| Evento simples | `guild_event.id` |
| Agregado | `agg:<event_type>:<epoch do início da janela>` |
| Teste | `test:<ulid>` |

Retenção: `announce_outbox` e `announce_delivery_log` são podados aos **30 dias**
(job diário). O histórico de verdade é `guild_event`.

## 9. API

Base `/api/v1`. Entradas exigem JWT da Twitch com `role=broadcaster`, exceto `/mute`,
que é assinada com HMAC (o bot não tem JWT).

| Método | Rota | Quem chama | Request | Response | Erros |
|---|---|---|---|---|---|
| `GET` | `/announce/config` | config (broadcaster) | — | `{ enabled, webhook_url, hourly_cap, quiet_from, quiet_to, timezone, muted_until, fail_streak, events[] }` | `401 UNAUTHORIZED`, `403 FORBIDDEN` |
| `PUT` | `/announce/config` | config | `{ enabled, webhook_url, hourly_cap, quiet_from, quiet_to, timezone }` | config atualizada | `400 WEBHOOK_URL_INVALID`, `400 CAP_OUT_OF_RANGE`, `403 FORBIDDEN` |
| `PUT` | `/announce/events/{type}` | config | `{ enabled, template, template_agg, cooldown_s }` | item atualizado | `400 INVALID_TEMPLATE`, `400 UNKNOWN_VARIABLE`, `400 TEMPLATE_TOO_LONG`, `400 COOLDOWN_OUT_OF_RANGE`, `404 UNKNOWN_EVENT_TYPE` |
| `POST` | `/announce/secret/rotate` | config | — | `{ secret, retires_at }` — **texto claro só aqui, uma vez** | `403 FORBIDDEN`, `429 ROTATE_TOO_SOON` |
| `POST` | `/announce/test` | config | `{ event_type }` | `202 { delivery_id }` | `400 ANNOUNCE_DISABLED`, `429 TEST_RATE_LIMITED` (1/min) |
| `GET` | `/announce/deliveries?cursor=&limit=` | config | — | `{ items:[{id,event_type,status,http_status,latency_ms,suppress_reason,message,created_at}], next_cursor }` | `403 FORBIDDEN` |
| `POST` | `/announce/mute` | **bot do streamer** | `{ minutes: 1..240, reason }` | `204` | `401 SIGNATURE_INVALID`, `400 MUTE_RANGE`, `404 CHANNEL_NOT_FOUND` |
| `DELETE` | `/announce/mute` | bot ou config | — | `204` | `401 SIGNATURE_INVALID` |

`POST /announce/mute` usa os mesmos headers de assinatura do webhook de saída, com o
corpo da requisição, e `X-Guilds-Channel-Id` para identificar o canal.

### Webhook de saída (o que o bot recebe)

| Item | Valor |
|---|---|
| Endpoint | definido pelo streamer, `https://` |
| Método / corpo | `POST`, JSON de §4 |
| Headers | `X-Guilds-Delivery-Id`, `X-Guilds-Event`, `X-Guilds-Timestamp`, `X-Guilds-Attempt`, `X-Guilds-Signature` |
| Resposta esperada | `2xx` em até 5 s. Corpo ignorado. |
| Obrigação do bot | verificar assinatura, checar janela de 300 s, deduplicar por `X-Guilds-Delivery-Id`, postar `message` no chat sem reescrever |
| Rejeição | `4xx` não retriável → marcamos `failed` e mostramos ao streamer |

O bot pode ignorar `message` e montar a própria a partir de `vars` — o contrato é
`vars` estável, `message` pronto para uso.

## 10. Regras de negócio

| # | Regra |
|---|---|
| **R1** | Nenhum anúncio sai com `announce_config.enabled=false` ou `webhook_url IS NULL`. |
| **R2** | Só eventos com `guild_event.created_at >= announce_config.updated_at` da ativação entram na fila. Ligar o recurso não dispara backlog. |
| **R3** | Guilda com `status='pending'` **nunca** gera anúncio. `guild.created` não é anunciável; o gatilho público é `guild.approved`. |
| **R4** | Guilda rejeitada, `suspended` ou `banned` nunca gera anúncio, e um item já enfileirado dela é cancelado (`suppressed`, motivo `guild_ineligible`) na hora do envio — a checagem de status é reavaliada no momento do dispatch, não só na entrada. |
| **R5** | Toda entrada na fila é `INSERT ... ON CONFLICT (channel_id, dedup_key) DO NOTHING`. Replay da fila não gera segundo anúncio. |
| **R6** | Um `announce_outbox` em estado terminal (`sent`, `failed`, `expired`, `suppressed`, `superseded`, `aggregated`) nunca volta para `queued`. Transição só avança. |
| **R7** | Retentativa reusa o mesmo `id`/`X-Guilds-Delivery-Id`; entrega dupla é problema resolvido pelo dedup do bot, nunca por segundo `id`. |
| **R8** | Teto horário: `count(sent) na última hora < hourly_cap`, avaliado no dispatch, não na entrada. |
| **R9** | Espaçamento mínimo de 20 s e rajada de 3/60 s são verificados no dispatch, por canal. |
| **R10** | Evento cujo tipo está com `enabled=false` não entra na fila (não é enfileirado e suprimido — simplesmente não existe). |
| **R11** | Durante mute, quiet hours ou canal offline nada é enfileirado; eventos do período são `suppressed` e **nunca** disparados depois. |
| **R12** | Item com `now() > expires_at` (600 s) vira `expired` sem tentativa. Anúncio atrasado não é entregue. |
| **R13** | Mensagem renderizada acima de 400 caracteres é truncada em 399 + `…`. Nunca ultrapassa o limite de 500 da Twitch. |
| **R14** | Um `guild_event.id` aparece no máximo uma vez em `announce_outbox` — como item simples **ou** dentro de um agregado, nunca nos dois. |
| **R15** | Agregação só dispara com ≥ 3 eventos na janela de 300 s; com 1 ou 2 eles são enviados individualmente. |
| **R16** | `ranking.top1_changed` dentro do cooldown colapsa para o **último** estado; os intermediários viram `superseded`. Chat nunca vê troca de líder desatualizada. |
| **R17** | Template inválido não é salvo (`400`). Falha de render em runtime cai no padrão; falha do padrão cai em `[{tag}] {evento}`. |
| **R18** | Valores interpolados são higienizados: sem quebra de linha, sem caractere de controle, e prefixados com ZWSP se começarem por `/` ou `.`. |
| **R19** | 10 falhas consecutivas de entrega desligam `enabled` e zeram nada mais; religar é ação manual do streamer. |
| **R20** | O payload não contém `user_id`, `opaque_user_id`, e-mail nem valor de Bits. Só nomes públicos de exibição. |
| **R21** | `POST /announce/test` não conta no teto horário mas tem limite próprio de 1/min. |
| **R22** | Alterar `webhook_url` **não** rotaciona o segredo; rotacionar é ação explícita. |

## 11. Segurança

| Item | Regra |
|---|---|
| Assinatura | HMAC-SHA256 sobre `timestamp + "." + corpo bruto`. Comparação em tempo constante dos dois lados. |
| Anti-replay | Timestamp fora de ±300 s deve ser rejeitado pelo bot; documentado no contrato. |
| Segredo | 32 bytes aleatórios, hex. Exibido em texto claro **uma única vez**, na resposta do rotate. Armazenado cifrado (`secret_enc`), nunca em log, nunca em `GET /announce/config`. |
| Rotação | Cria segredo `active` e marca o anterior como `retiring` por **24 h**. Nesse período assinamos com os dois e enviamos `X-Guilds-Signature: v1=…,v1=…`; o bot aceita se **qualquer** valor bater. Depois de 24 h o antigo vira `revoked`. Rotação limitada a 1/hora. |
| Transporte | Só `https://`. Sem redirect seguido (`maxRedirects=0`). |
| SSRF | `webhook_url` resolvida antes do envio; bloqueamos loopback, link-local, `10/8`, `172.16/12`, `192.168/16`, IPv6 ULA e metadata (`169.254.169.254`). Revalidação no dispatch, não só na gravação. |
| Escopo do segredo | Um segredo por canal, serve para o webhook de saída **e** para autenticar `POST /announce/mute`. Vaza um canal, não vaza os outros. |
| Dados sensíveis no payload | O webhook aponta para infraestrutura de terceiro que **nós não controlamos** — bot caseiro, serviço gratuito, log em texto puro. Tudo que sai é dado que já é público no chat: nome de guilda, TAG, display name, nível, Prestígio, posição. Nada de `opaque_user_id` (correlaciona sessões da extensão), nada de `user_id` da Twitch, nada de valores de Bits (financeiro) e nada de conteúdo em moderação. Regra prática: **se não pode ser lido em voz alta na live, não entra no payload.** |
| Auditoria | Mudar config, rotacionar segredo e mutar geram linha em `audit_log` (`action` = `announce.config_updated`, `announce.secret_rotated`, `announce.muted`). |

## 12. Riscos e decisões em aberto

| # | Risco / questão | Recomendação |
|---|---|---|
| D1 | Nomes de `guild_event.type` ainda não fixados pelas fases 03–06 | Congelar o vocabulário num `docs/EVENTOS.md` antes de codar a 07; o mapeamento fica em dados (`announce_event_config`), então divergência custa uma migração de linha, não de código. |
| D2 | Maioria dos streamers não tem bot com endpoint HTTP (Nightbot não aceita webhook de entrada) | Aceito na v1: público-alvo inicial é streamer com bot próprio ou Fossabot/StreamElements com webhook. Se a adoção travar, adicionar `GET /announce/outbox?since=` (opção "polling" da §4) — a fila já existe, é ~50 linhas. |
| D3 | "Canal offline" precisa de sinal de live | Usar EventSub `stream.online`/`stream.offline` só para isso (é Twitch→nós, cabe), ou tratar como não implementado na v1 e confiar no mute do bot. Recomendo EventSub: é uma assinatura por canal. |
| D4 | Teto de 12/h pode ser baixo em canal de 10k viewers e alto em canal de 50 | Instrumentar `suppressed`/`sent` por canal nas primeiras 4 semanas e recalibrar a faixa (4–20) com dado real. |
| D5 | Agregação de 300 s atrasa o anúncio de guilda aprovada em até 5 min | Aceitável: guilda nova não é urgente. Guerra e TOP 1 não agregam. |
| D6 | Streamer edita template para algo ofensivo ou para spam de link | Sem moderação de conteúdo na v1 — é o chat dele. Bloquear só o vetor técnico (comando, quebra de linha). Reavaliar se virar problema de plataforma. |
| D7 | Descartar evento suprimido perde descoberta | Alternativa é um resumo horário ("nas últimas 2h: 6 guildas novas") — proposto para a v2, não v1. |
| D8 | Bot re-anuncia porque não implementou dedup | O contrato exige; o teste de conformidade (`POST /announce/test` duas vezes com o mesmo `id`) fica no checklist do streamer. Não temos como forçar. |

## 13. Critérios de aceite

- [ ] Os 12 eventos anunciáveis da §3 existem em `announce_event_config` com o padrão de ligado/desligado da tabela.
- [ ] Streamer configura `webhook_url`, recebe o segredo uma única vez e o `GET /announce/config` nunca devolve o segredo.
- [ ] `POST /announce/test` entrega no bot em < 2 s com assinatura válida; recalcular o HMAC no bot bate.
- [ ] Timestamp adulterado em 6 min é rejeitado pelo verificador de referência.
- [ ] Guilda `pending` aprovada gera **um** anúncio (`guild.approved`); a criação não gera nenhum.
- [ ] Guilda rejeitada pela moderação: zero linhas em `announce_outbox` com status `sent`.
- [ ] Guilda enfileirada e banida antes do dispatch sai como `suppressed` / `guild_ineligible`.
- [ ] Replay da fila (reprocessar 1000 `guild_event` já processados) resulta em **0** novas entregas.
- [ ] 10 `guild.approved` em 5 min → exatamente 1 mensagem, com `{quantidade}=10` e 3 nomes + "e mais 7".
- [ ] 2 `guild.approved` em 5 min → 2 mensagens individuais.
- [ ] 3 trocas de TOP 1 em 10 min → 1 mensagem, refletindo o **último** estado.
- [ ] Com `hourly_cap=12`, o 13º evento da hora não é entregue e aparece no log como `suppressed`.
- [ ] Dois anúncios consecutivos nunca saem com menos de 20 s de intervalo.
- [ ] `POST /announce/mute {"minutes":10}` → nada entregue por 10 min; nada explode depois do mute.
- [ ] Quiet hours 02:00–10:00 (America/Sao_Paulo): evento às 03:00 é `suppressed`, evento às 10:01 é entregue.
- [ ] Bot devolvendo 500: 3 tentativas registradas em `announce_delivery_log` com backoff 2 s/10 s; depois `failed`.
- [ ] Bot fora do ar por 20 min: nenhuma entrega ao voltar; itens em `expired`.
- [ ] 10 falhas consecutivas → `enabled=false` e aviso visível na página de config.
- [ ] Template com `{variavel_inexistente}` → `400 UNKNOWN_VARIABLE`, não é salvo.
- [ ] Template que renderiza 600 caracteres → mensagem entregue com 400 (399 + `…`).
- [ ] Guilda chamada `/ban Foyth` → mensagem entregue não é interpretada como comando pelo chat.
- [ ] `webhook_url` apontando para `http://169.254.169.254/` é rejeitada na gravação **e** no dispatch.
- [ ] Rotação de segredo: durante 24 h os dois valores validam; após 24 h só o novo.
- [ ] Nenhum payload de qualquer evento contém `user_id`, `opaque_user_id`, e-mail ou valor de Bits (varredura automatizada sobre a suíte de fixtures).
- [ ] Log de entrega mostra as últimas 50 linhas com motivo de supressão legível.
