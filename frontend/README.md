# Frontend — Extensão Twitch Guilds

Svelte 5 + SvelteKit (`adapter-static`) + GSAP. HTML estático em zip, servido
pela CDN da Twitch, consumindo as 88 rotas do EBS.

## Leia primeiro

1. **[docs/ARQUITETURA.md](docs/ARQUITETURA.md)** — restrições da plataforma
   (318px, CSP, views), auth, cliente de API, Bits, PubSub.
2. **[docs/MOVIMENTO.md](docs/MOVIMENTO.md)** — onde há animação e onde não há.
3. **[docs/DESIGN.md](docs/DESIGN.md)** — a direção visual: paleta, tipografia,
   o elemento de assinatura.
4. `../docs/fase-0*.md` — as regras de negócio já estão especificadas lá. O
   frontend **não redefine regra**; ele exibe o que o EBS decide.

## Rodar

```sh
npm run dev            # servidor local, mock do Twitch.ext
npm run build          # gera build/ com um .html por view
npm run test           # vitest, lógica pura
```

Sem `Twitch.ext` (fora da Twitch) o `lib/twitch.ts` cai num modo de
desenvolvimento com token falso, para dar para trabalhar sem subir versão.

## Estrutura

```
frontend/
├── src/
│   ├── routes/
│   │   ├── panel/       painel do viewer      -> panel.html
│   │   ├── overlay/     placar de guerra      -> overlay.html
│   │   ├── mobile/      painel no app         -> mobile.html
│   │   ├── config/      instalação            -> config.html
│   │   └── live/        moderação ao vivo     -> live.html
│   ├── lib/
│   │   ├── twitch.ts    onAuthorized, bits, listen, requestIdShare
│   │   ├── api.ts       cliente único do EBS, tradução de erro
│   │   ├── motion.ts    setup do GSAP, reduced-motion, Flip
│   │   └── ui/          componentes compartilhados
│   └── app.css          tokens
└── docs/
```

Um diretório de rota por view. Nenhuma view importa componente de outra view —
só de `lib/ui`.

## Fases

Cada fase consome uma fase do backend que já está implementada e testada.

| Fase   | Entrega                   | Views          | Backend    | Animação           |
| ------ | ------------------------- | -------------- | ---------- | ------------------ |
| **F0** | Fundação                  | todas          | —          | setup              |
| **F1** | Criar guilda e ver a sua  | panel          | 01         | —                  |
| **F2** | Entrar, sair, cargos      | panel          | 02         | —                  |
| **F3** | XP, nível, desbloqueios   | panel          | 03         | barra + level-up   |
| **F4** | Ranking e temporada       | panel          | 04         | Flip               |
| **F5** | Guerra e território       | overlay, panel | 05         | placar + mapa      |
| **F6** | Brasão e loja             | panel          | 06         | troca de camada    |
| **F7** | Broadcaster               | config, live   | 01, 05, 07 | —                  |
| **F8** | Mobile                    | mobile         | —          | herda              |

### F0 — Fundação

**Antes de qualquer tela, o spike de CSP.** A CSP da Twitch bloqueia script
inline sem nonce/hash, e o SvelteKit emite um bootstrap inline no HTML gerado.

1. `sv create`, build, **inspecionar o HTML gerado por `<script>` sem `src`**.
2. Se houver, resolver com `bundleStrategy` ou trocar por Vite + Svelte puro.
3. Subir como versão de teste e confirmar no console dentro da Twitch.
4. Declarar o domínio do EBS em `connect-src` no Developer Console.
5. `twitch.ts`, `api.ts`, `motion.ts`, tokens de CSS, estados de erro e vazio.

### F1 — Criar guilda e ver a sua

`POST /guilds` → `useBits` → recibo → `POST /guilds/:id/transaction`. Estados:
rascunho reservado por 15 min, pagamento em confirmação, aguardando aprovação,
rejeitada com motivo, ativa.

Aceite: fechar a aba no meio do pagamento não perde a guilda nem cobra duas vezes.

### F2 — Entrar, sair, cargos

Entrar conforme o modo (aberta / pedido / convite), fila de pedidos, promover e
rebaixar respeitando a matriz da fase 02 — a UI esconde o que o cargo não pode
fazer, e o servidor recusa de qualquer jeito.

Aceite: guilda cheia, cooldown e `IDENTITY_REQUIRED` têm cada um sua mensagem.

### F3 — XP, nível e desbloqueios

Barra de XP, o que falta para o próximo nível, desbloqueios, contribuição por
membro.

Aceite: queda de nível não anima nem comemora; `overflow` é explicado, não é erro.

### F4 — Ranking e temporada

Lista paginada por cursor, pódio, card "sua guilda", fim da temporada,
conquistas com raridade. Flip anima a reordenação entre snapshots.

Aceite: `CURSOR_EXPIRED` recarrega da primeira página sozinho.

### F5 — Guerra e território

Overlay com placar ao vivo via PubSub, fallback para `GET /wars/active`. Painel
com desafiar, aceitar, recusar e o mapa. Mapa é grade de cards na v1.

Aceite: PubSub cair não congela o placar; o número interpola em vez de saltar.

### F6 — Brasão e loja

Editor das 6 camadas contra o catálogo versionado, preview em SVG, preços em
Bits, crédito de identidade.

Aceite: nenhum item travado por nível exibe caminho de compra.

### F7 — Broadcaster

`config.html`: custo, denylist, territórios, temporada, templates, webhook.
`live.html`: fila de aprovação, guerra em andamento, moderação com auditoria.

Aceite: toda ação de moderação mostra quem fez e quando.

### F8 — Mobile

Componentes do painel com alvos de toque ≥ 44pt e layout fluido. Última porque é
o menor público e o mais caro de testar.

## O que este plano deliberadamente não tem

- **Framework de estado.** Store do Svelte resolve; o servidor é a autoridade.
- **i18n.** O backend responde em português. Quando houver segundo idioma, aí sim.
- **Teste de componente antes da F4.** Vitest cobre `api.ts` e lógica pura desde
  a F0; interface vira teste quando parar de mudar de forma.
