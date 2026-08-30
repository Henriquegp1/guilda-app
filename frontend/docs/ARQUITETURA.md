# Arquitetura — Frontend

O frontend é uma **Extensão da Twitch**: HTML/JS estático, empacotado em zip e
servido pela CDN da Twitch. Não há servidor aqui. Toda leitura e escrita passa
pelas 88 rotas do EBS (`../src`, `docs/ARQUITETURA.md` da raiz).

Este documento é contrato: nenhuma fase do frontend o contradiz.

## As restrições vêm da Twitch, não de nós

Isto não é um site que por acaso roda dentro de um iframe. Quatro regras da
plataforma decidem o desenho antes de qualquer escolha nossa:

| Regra                                                                                         | Consequência direta                                                                                                        |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Painel tem **318 × 496 px** fixos, sem scroll de iframe                                       | Nada de tabela larga. O ranking é lista vertical, o emblema é pequeno, o texto é curto. Reserve 10px de padding interno.   |
| Overlay, componente e mobile são **fluidos**                                                  | Nenhum layout pode assumir proporção ou tamanho. Sem `width: 1280px` em lugar nenhum.                                      |
| **Script externo é proibido**, exceto Google Fonts e Google Analytics                         | GSAP entra no bundle. Nunca via cdnjs. Fonte só local ou Google Fonts.                                                     |
| `connect-src`, `img-src` e `media-src` são declarados no Developer Console (aba Capabilities) | O domínio do EBS precisa ser declarado **antes** do primeiro `fetch`, senão o navegador bloqueia sem erro de rede legível. |

Script inline sem nonce/hash também é bloqueado. Isso é o maior risco técnico do
projeto e está tratado na fase F0.

## Views e público

| View            | Arquivo        | Quem vê                         | O que faz                                                               |
| --------------- | -------------- | ------------------------------- | ----------------------------------------------------------------------- |
| `panel`         | `panel.html`   | Viewer, abaixo do player        | Experiência principal: minha guilda, ranking, entrar, criar             |
| `video_overlay` | `overlay.html` | Viewer, sobre o vídeo           | Só o placar de guerra ao vivo. Some quando não há guerra.               |
| `mobile`        | `mobile.html`  | Viewer no app                   | Subconjunto do painel, alvos de toque ≥ 44pt                            |
| `config`        | `config.html`  | Broadcaster, fora da live       | Instalação: custo em Bits, territórios, temporada, templates de anúncio |
| `live_config`   | `live.html`    | Broadcaster/mod, durante a live | Fila de moderação e guerra em andamento                                 |

Cinco entradas HTML independentes. Não há navegação entre elas: a Twitch decide
qual carrega.

## Stack

```
npx sv create frontend --template minimal --types ts \
  --add sveltekit-adapter=adapter:static --add prettier --add eslint --add vitest
```

- **Svelte 5** (runas) + **SvelteKit** com `adapter-static`, tudo pré-renderizado.
- **GSAP** como dependência de bundle. Ver `MOVIMENTO.md`.
- **Vitest** para lógica pura; Playwright fica para quando houver o que navegar.
- Sem biblioteca de UI, sem Tailwind. 318px não comporta um design system de
  terceiro, e o visual é temático (guildas, brasões) — CSS próprio com tokens.

Cada view é uma rota pré-renderizada com `export const prerender = true` e
`ssr = false`, e o `adapter-static` gera o HTML que vai no zip.

## Autenticação

```
Twitch.ext.onAuthorized(auth => { ... })
  auth.token       JWT que o EBS valida (core/auth.js)
  auth.channelId   canal
  auth.userId      só existe se o viewer concedeu identidade
```

Três coisas que o cliente precisa acertar e que o backend já cobra:

1. **O token expira e é reemitido.** `onAuthorized` dispara de novo; o cliente da
   API lê sempre o token corrente, nunca guarda uma cópia numa closure.
2. **`userId` opaco é o caso normal.** O EBS responde `IDENTITY_REQUIRED` em rota
   que precisa de identidade real (convite nominal, ação de broadcaster). A UI
   trata isso como fluxo, não como erro: chama `Twitch.ext.actions.requestIdShare()`.
3. **Rota de moderação exige `role` de broadcaster/moderator no JWT**, e o EBS
   recusa quando a origem é o bot. O `live.html` assume esse papel.

## Cliente da API

Um módulo só (`src/lib/api.ts`), pelo mesmo motivo que o backend tem um core: a
resolução de canal já divergiu em quatro versões quando cada módulo fez a sua.

Responsabilidades: prefixo `/api/v1`, `Authorization: Bearer <token corrente>`,
parse do envelope de erro `{ error: { code, message, ...data } }`, e tradução de
código para mensagem em português. Os códigos vêm dos docs de fase da raiz
(`GUILD_FULL`, `ALREADY_IN_GUILD`, `IDENTITY_REQUIRED`, `CURSOR_EXPIRED`...).

Paginação é sempre por cursor. `CURSOR_EXPIRED` significa "volte à primeira
página", e a UI precisa fazer isso sozinha, sem culpar o usuário.

## Bits

`Twitch.ext.bits.getProducts()` e `useBits(sku)`. O recibo chega em
`onTransactionComplete` e é enviado ao EBS, que o valida (HS256, mesmo segredo
do JWT) e é idempotente por `transaction_id`.

**O cliente pode fechar a aba entre pagar e confirmar.** O backend reconcilia,
mas a UI precisa mostrar estado "pagamento em confirmação" em vez de fingir que
deu tudo certo ou que falhou.

## Tempo real

`Twitch.ext.listen('broadcast', ...)` recebe `war.board` — todas as guerras
ativas do canal numa mensagem, limite de 5 KB. O overlay e o painel consomem a
mesma mensagem. Quando o PubSub silencia, cai para `GET /wars/active`, que
devolve o mesmo shape de propósito.

## Degradação

O EBS pode estar fora, e a extensão continua carregada na tela de alguém.
Nenhuma view mostra tela branca: cada uma tem estado de carregamento, estado
vazio e estado de erro com ação de tentar de novo. Isso não é polimento, é o
comportamento padrão de um cliente que roda por horas numa aba aberta.

> Achado da F0: `connect-src` casa **esquema + host**. Declarar
> `https://seu-ebs.com` e chamar `http://` é bloqueio silencioso — o viewer só
> vê "sem conexão". O `scripts/csp-serve.js` reproduz isso localmente.
