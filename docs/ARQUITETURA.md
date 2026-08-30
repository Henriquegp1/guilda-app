# Arquitetura — Twitch Guilds

Contrato compartilhado por **todas** as fases. Nenhuma fase redefine o que está aqui;
se precisar mudar algo desta página, a mudança vira uma seção "Impacto na arquitetura"
no doc da fase e é decidida antes de codar.

## Stack (assumida — trocar aqui se o time decidir diferente)

| Camada | Escolha | Porquê |
|---|---|---|
| Frontend | Twitch Extension (panel + config + mobile) — JS/React | Requisito do produto |
| EBS | Node 20 + Fastify | JWT da Twitch é HMAC simples, não precisa framework pesado |
| Banco | PostgreSQL | Precisa de transação em XP/Prestígio e de constraint única em nome/TAG |
| Cache/Realtime | Redis (opcional) + Twitch PubSub | Ranking e guerras ao vivo |
| Filas | Redis (BullMQ) | Reconciliação de Bits, cálculo de temporada |

**Regra:** a extensão nunca fala com o banco. Tudo passa pelo EBS, que valida o
JWT da Twitch (`channel_id`, `user_id`, `role`, `opaque_user_id`).

**Redis é opcional.** `src/core/redis.js` degrada para a fonte da verdade quando
`REDIS_URL` não existe ou o servidor cai: `cached()` chama a função original e a
rota responde igual, só mais devagar. Nenhuma escrita depende dele, nada nele
participa de transação, e nenhum módulo abre a própria conexão — sem um lugar só,
a resolução de canal já virou quatro versões divergentes uma vez.

## Multi-tenant desde a fase 1

Este projeto é uma **extensão genérica**, não um plugin do canal do Foyth.
Toda tabela de domínio carrega `channel_id`. Toda query filtra por `channel_id`.
Nomes/TAGs de guilda são únicos **por canal**, não globalmente.

## Modelo de dados base

Só as tabelas que várias fases tocam. Cada fase documenta as suas próprias.

```sql
channel        (id, twitch_channel_id, settings jsonb, created_at)
guild          (id, channel_id, name, tag, description, status, leader_user_id,
                level, xp, prestige, member_limit, created_at)
guild_member   (guild_id, user_id, role, joined_at)          -- PK composta
guild_event    (id, channel_id, guild_id, type, payload jsonb, created_at)
audit_log      (id, channel_id, actor_user_id, action, target, before jsonb,
                after jsonb, created_at)
```

`guild.status`: `awaiting | pending | active | overflow | suspended | banned | purged`.
`guild_member.role`: `leader | officer | veteran | member | recruit`.

`overflow` = guilda ativa acima do limite de vagas depois que uma queda de nível
reduziu `member_limit` (fase 03, R10). Ninguém é expulso; ela só não admite entradas.

## Ciclo de vida de nome e TAG

Três fases mexiam nisso com regras diferentes. Regra única, por canal:

| Situação | Nome/TAG |
|---|---|
| `awaiting` (rascunho não pago) | Reservado 15 min, depois liberado (fase 01, R7) |
| `pending`, `active`, `overflow`, `suspended` | Ocupado |
| Dissolvida pelo líder, ou `purged` por guilda vazia | **Quarentena de 30 dias**, depois liberado |
| Renomeada | Nome antigo em quarentena de 30 dias (fase 06, R12) |
| `banned` | Bloqueado indefinidamente (fase 01, R13) |

A quarentena existe para ninguém sequestrar a identidade de uma guilda conhecida no
minuto seguinte à dissolução.

### guild_event é o eixo do sistema

Toda atividade que vale XP, Prestígio, progresso de conquista, ponto de guerra ou
anúncio no chat é **um registro em `guild_event`**. As fases 3, 4, 5, 6, 7 e 8 leem
dessa tabela; nenhuma delas cria seu próprio pipeline de eventos.

```
ação do viewer → EBS → INSERT guild_event → handlers (XP, Prestígio, conquistas,
                                                      guerra, território, chat)
```

Isso evita seis contadores diferentes que discordam entre si.

## Idempotência

Todo evento externo (Bits, sub, gift, resgate) chega com um id da Twitch.
`guild_event` tem `UNIQUE (channel_id, type, external_id)`. Webhook duplicado
não vira XP dobrado. Não é opcional — a Twitch reenvia.

## Autoridade de valores

XP, Prestígio, nível e limite de membros **só** mudam no servidor. O cliente exibe.
Nenhum endpoint aceita "adicione N de XP" vindo do frontend.

## Quem chama o EBS

Dois chamadores, dois esquemas — não confundir:

| Origem | Auth | Observação |
|---|---|---|
| Extensão (painel, config, mobile) | JWT da Twitch | `channel_id`, `user_id`, `role` |
| Bot de chat do streamer (`!criarguilda`, `!guilda entrar`) | Token de canal emitido pelo EBS, header `Authorization: Bearer`, rotacionável na página de config | **Bot não tem JWT da Twitch.** O token carrega `channel_id` e o bot informa o `user_id` do autor do comando |

O EBS→bot é o caminho oposto e usa HMAC (fase 07). São segredos distintos.

Comando de chat é entrada de menor confiança: o bot afirma quem falou, e o EBS
acredita. Toda ação irreversível (pagar, dissolver, banir) exige confirmação pelo
painel, onde existe JWT. Comando só inicia fluxo.

## Convenções de API

- Base: `/api/v1`, todas as rotas exigem JWT da Twitch ou token de canal (tabela acima).
- Erros: `{ error: { code, message } }` com code em SCREAMING_SNAKE.
- Rotas de moderação exigem `role in (broadcaster, moderator)` no JWT.
- Paginação por cursor (`?cursor=&limit=`), nunca offset — ranking muda ao vivo.

## O que fica de fora de propósito (v1)

- Guildas cross-canal.
- Upload de imagem própria (só o Emblem Creator — fase 6).
- Qualquer vantagem de gameplay comprável com Bits. Bits = cosmético + criação.

## Ordem de dependência das fases

```
01 fundação ──> 02 membros ──> 03 progressão ──> 04 competição ──> 05 guerras
                                    │                  │              │
                                    └──────────────────┴──> 07 integração
                                    06 identidade (paralela a partir da 02)
```
