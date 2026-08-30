# Twitch Guilds

Extensão de Twitch que dá ao chat um sistema de guildas: criação paga em Bits,
moderação pelo streamer, progressão coletiva, ranking competitivo por temporada,
guerras e territórios.

Construída como extensão **genérica** — qualquer streamer instala. No canal de
origem ela conversa com o RPG já existente, mas nada no núcleo depende dele.

## Como ler esta documentação

1. **[docs/ARQUITETURA.md](docs/ARQUITETURA.md)** — leia primeiro. Stack, modelo de
   dados base, o pipeline `guild_event`, ciclo de vida de nome/TAG, quem chama o EBS.
2. **[docs/EVENTOS.md](docs/EVENTOS.md)** — o vocabulário de `guild_event.type`.
   Nenhum tipo entra em código sem estar registrado lá.
3. Cada `docs/fase-XX-*.md` é um projeto entregável (escopo, modelo de dados, API,
   regras numeradas, critérios de aceite, o que fica fora). O código correspondente
   vive em `src/modules/<módulo>/` — ver a tabela de propriedade abaixo.

## Código

```
src/
├── core/          spine compartilhado: db, migrations, auth, guild_event, erros
├── modules/       um diretório por fase, dono exclusivo dos seus arquivos
└── server.js      registra os módulos
```

| Fase | Módulo | Migração | Prefixo de rota |
|---|---|---|---|
| 01 | `guilds` | `010_guilds.sql` | `/guilds` |
| 02 | `members` | `020_members.sql` | `/guilds/:gid/members`, `/guilds/:gid/requests`, `/invites` |
| 03 | `xp` | `030_xp.sql` | `/guilds/:gid/xp`, `/progression` |
| 04 | `seasons` | `040_seasons.sql` | `/ranking`, `/seasons`, `/achievements` |
| 05 | `wars` | `050_wars.sql` | `/wars`, `/territories`, `/disputes` |
| 06 | `identity` | `060_identity.sql` | `/guilds/:gid/emblem`, `/catalog`, `/purchases` |
| 07 | `announce` | `070_announce.sql` | `/announce` |

Um módulo nunca edita arquivo de outro. Precisa de algo do vizinho? Consome pelo
`guild_event` (`docs/EVENTOS.md`) ou pela função exportada no `index.js` dele.

## Roadmap

| Fase | Projeto | Entrega | Depende de |
|---|---|---|---|
| 01 | [fundacao](docs/fase-01-fundacao.md) | Criar guilda, pagar em Bits, fila de aprovação, painel de moderação, auditoria | — |
| 02 | [membros](docs/fase-02-membros.md) | Entrar/sair, cargos, permissões, modos aberta/aprovação/fechada | 01 |
| 03 | [progressao](docs/fase-03-progressao.md) | Guild XP, níveis, desbloqueios por nível | 02 |
| 04 | [competicao](docs/fase-04-competicao.md) | Prestígio, ranking, temporadas, conquistas | 03 |
| 05 | [guerras](docs/fase-05-guerras.md) | Desafio entre guildas, placar ao vivo, territórios | 04 |
| 06 | [identidade](docs/fase-06-identidade.md) | Guild Emblem Creator, loja cosmética, economia de Bits | 02 |
| 07 | [integracao](docs/fase-07-integracao.md) | Eventos para o bot do streamer anunciar no chat | 03 |

### Duas ressalvas de ordem

- **A fase 04 depende de uma fonte de vitória que só a 05 produz.** Prestígio vem
  principalmente de `event.win`, e o gerador robusto disso é a guerra de guildas. Sem
  isso, ranking de canal pequeno fica parado. Entregar o **objetivo semanal automático**
  já na fase 04 é o que a torna independente — não é opcional.
- **A fase 05 pode ser quebrada em 05a (guerras) e 05b (territórios).** Territórios são
  ~60% do custo da fase e nada depende deles. Corte natural se o prazo apertar.

Fluxo do viewer na v1 (fases 01–04):

```
Viewer → Extensão → Criar/Entrar em Guilda → Moderação → Guild XP → Prestígio
       → Ranking → Temporadas
```

## Princípios que atravessam tudo

- **Bits nunca compram vantagem.** Criação e cosmético sim; competir e evoluir é grátis.
- **Servidor é a autoridade.** XP, Prestígio e nível não vêm do cliente.
- **Tudo é evento.** Uma tabela `guild_event` alimenta XP, ranking, conquistas,
  guerras e anúncios — não seis contadores paralelos.
- **Moderação antes de público.** Nome, TAG, descrição e emblema passam por aprovação.
- **Temporada reseta o competitivo, não a guilda.** Nome, membros, nível, conquistas
  e histórico permanecem.
