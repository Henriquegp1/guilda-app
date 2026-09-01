# Registro de `guild_event.type`

Vocabulário canônico. Uma fase **produz** um tipo; qualquer outra **consome**.
Antes de inventar um tipo novo, registre-o aqui — um tipo que só existe no doc de
uma fase é uma integração quebrada esperando acontecer.

## Convenção

`dominio.fato` — domínio no singular, fato no passado, ambos `snake_case`.
`guild.approved`, `member.joined`, `war.declared`. Nunca `memberJoined`,
`member_joined` ou `MEMBER_JOINED`.

## Registro

| `type` | Produz | Consome | `external_id`? | Payload |
|---|---|---|---|---|
| `guild.created` | 01 | 07 (nunca anuncia, R3) | `transaction.id` | `{ name, tag, leader_user_id }` |
| `guild.approved` | 01 | 07 | — | `{ actor_user_id }` |
| `guild.rejected` | 01 | 06 (crédito) | — | `{ actor_user_id, reject_reason, fields, bits_amount }` |
| `guild.moderated` | 01 | — | — | `{ action, actor_user_id }` |
| `member.joined` | 02 | 03, 04 (Exército) | — | `{ user_id, role, via }` |
| `member.left` | 02 | 03 | — | `{ user_id, role_at_exit }` |
| `member.kicked` | 02 | — | — | `{ user_id, role_at_exit, actor_user_id }` |
| `member.promoted` / `member.demoted` | 02 | — | — | `{ user_id, from_role, to_role, actor_user_id }` |
| `join.requested` / `join.approved` / `join.rejected` | 02 | — | — | `{ request_id, user_id, actor_user_id? }` |
| `invite.created` / `invite.accepted` / `invite.declined` | 02 | — | — | `{ invite_id, invitee_user_id, actor_user_id }` |
| `guild.leadership_transferred` | 02 | — | — | `{ from_user_id, to_user_id, mode }` |
| `guild.join_mode_changed` | 02 | — | — | `{ from, to, actor_user_id }` |
| `guild.emptied` / `guild.disbanded` | 02 | 04, 06 | — | `{ actor_user_id?, member_count_at_exit }` |
| `guild.recruiting` | 02 | 07 | — | `{ vagas, modo }` |
| `guild.level_up` | 03 | 04 (Lendários), 07 | — | `{ from, to, unlocks[] }` |
| `ranking.top1_changed` | 04 | 07 | — | `{ tag, tag_anterior }` |
| `ranking.top3_entered` | 04 | 07 | — | `{ tag }` |
| `watch.tick` | 03 | — | — | `{ user_id }` |
| `chat.message` | 03 (via bot) | 03 | — | `{ user_id, message_id }` |
| `event.win` | 04/05 | 03, 04 (Primeiro Sangue, Dominadores) | id do evento | `{ event_id }` |
| `event.placement` | 04/05 | 03, 04 | id do evento | `{ event_id, rank }` |
| `event.participate` | 04/05 | 03, 04 | id do evento | `{ event_id, user_id }` |
| `weekly.objective_completed` | 04 | 04 | semana ISO | `{ objective, week }` |
| `prestige.manual_adjust` | 04 | 04 | — | `{ amount, actor_user_id, reason }` |
| `season.started` | 04 | 07 | — | `{ season_id, name, ends_at }` |
| `season.ended` | 04 | 04 (Imortais), 07 | — | `{ season_id, podium[] }` |
| `achievement.unlocked` | 04 | 07 | — | `{ achievement_id, rarity }` |
| `war.declared` / `war.accepted` / `war.declined` | 05 | 07 | — | `{ war_id, opponent_guild_id, format }` |
| `war.started` / `war.ended` / `war.settled` | 05 | 04, 07 | — | `{ war_id, winner_guild_id, score }` |
| `war.prestige_awarded` | 05 | 04 | — | `{ war_id, amount }` — acerta o total do formato sobre o que `event.*` já pagou |
| `territory.yield` | 05 | 04 | `territory:{id}:{dia}` | `{ territory_id, amount, day }` |
| `territory.captured` / `territory.lost` | 05 | 04, 07 | — | `{ territory_id, previous_guild_id }` |
| `dispute.opened` / `dispute.closed` | 05 | 07 | — | `{ dispute_id, territory_id }` |
| `identity.changed` | 06 | 07 | — | `{ field, from, to }` |
| `emblem.changed` | 06 | 07 | — | `{ from_version, to_version }` |

Eventos de Twitch (`channel.cheer`, `channel.subscribe`, `channel.follow`,
`channel.subscription.gift`, `channel.channel_points_custom_reward_redemption.add`)
entram com o `type` original da EventSub e o id da Twitch em `external_id` — a
fase 03 os lê direto, sem tradução.

## Regras

1. Um tipo é registrado aqui **antes** de aparecer em DDL, handler ou template.
2. Renomear tipo é breaking change: `guild_event` é log imutável e handlers de
   conquista fazem backfill sobre o histórico. Adicione um tipo novo, não renomeie.
3. `xp_reversal` **não** é um tipo de `guild_event` — é `reason` em
   `guild_xp_entry` (fase 03). Estorno não é fato novo do mundo, é lançamento contábil.
4. Consumidor nunca assume campo de payload que não esteja nesta tabela.
