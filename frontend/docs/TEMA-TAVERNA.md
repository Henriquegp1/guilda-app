# Tema Taverna (camada de superfície)

Revisão visual: parede de tijolo pixelada, viga de madeira no topo, cauda do estandarte
em degraus, tons de madeira/pedra aquecidos, cantos quadrados, campos "afundados".
Isto muda a direção do `DESIGN.md` original (que evitava "UI de jogo de fantasia"):
mastro de ouro, cauda e tipografia foram mantidos; a superfície é que mudou.

## Como funciona
- Tudo está em `src/tema-taverna.css`, atrás de `html[data-tema='taverna']` (`app.html`).
- **Desligar:** remova `data-tema="taverna"` do `<html>`. O visual antigo volta inteiro.
- Só muda cor, textura e forma. Nenhum tamanho, margem ou posição é alterado.
- **Botões** continuam iguais: os tokens antigos (`--sable`, `--sable-2`, `--borda`,
  `--argent-fraco`) são re-fixados dentro de `button`, `summary` e `[class*='btn']`.
- Brasão, Banner e paletas do catálogo não são tocados.
- Só imagens `data:` (a CSP da Twitch permite `img-src 'self' data:`).

## Ajustes rápidos
- Paleta: os 4 tokens no topo do arquivo.
- Contraste do tijolo: cores dentro de `--tijolo`.
- Cantos arredondados de volta: apague a regra "Forma: tudo quadrado".

## Limite conhecido
Botões e abas do editor de brasão mantêm o tom violeta original (por pedido),
então ficam levemente mais frios que a parede ao redor.
