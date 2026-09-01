# 🎨 Frontend — Extensão Twitch Guilds

Este diretório contém o código da interface da extensão, construído com **Svelte 5** e **SvelteKit**, otimizado para os limites de desempenho e segurança da Twitch.

## 🚀 Desenvolvimento

```sh
# Instalar dependências
npm install

# Rodar em modo de desenvolvimento (com mocks da Twitch.ext)
npm run dev

# Gerar build final (Static Site Generation)
npm run build

# Executar testes unitários
npm run test
```

## 🏗️ Arquitetura das Views
A extensão é composta por múltiplas views independentes, conforme exigido pela Twitch:

1.  **`/panel` (Viewer)**: A interface principal lateral (318px). Onde ocorre a gestão de guildas, ranking e guerras.
2.  **`/overlay` (Streamer)**: Camada invisível sobre o vídeo para exibir placares de guerra em tempo real.
3.  **`/config` (Dashboard)**: Área de configuração exclusiva do streamer (URL do bot, territórios, temporadas).
4.  **`/moderacao` (Live Dashboard)**: Central unificada para moderadores aprovarem identidades e gerenciarem crises.
5.  **`/mobile` (App Twitch)**: Versão otimizada para toque e layout fluido para dispositivos Android/iOS.

## 🧱 Componentização
- **`src/lib/ui`**: Componentes reutilizáveis como `Brasao`, `Aba`, `Modal` e `Estado`.
- **`src/lib/telas`**: Componentes de página (Lógica de cada funcionalidade).
- **`src/lib/twitch.ts`**: Abstração da API `window.Twitch.ext`.
- **`src/lib/api.ts`**: Cliente de consumo do EBS com tratamento de erros heráldicos.

## 👮 Diretrizes de Segurança (Twitch CSP)
A política de segurança da Twitch proíbe scripts inline. O projeto usa `@sveltejs/adapter-static` configurado para gerar arquivos JS externos e limpos. 
**Importante**: Não use `on:click="..."` diretamente no HTML; prefira a sintaxe nativa do Svelte 5 para manter a conformidade com a CSP.

## 📱 Otimização Mobile
O layout mobile usa `100dvh` para garantir que a interface não seja cortada pela barra de endereços e possui alvos de toque mínimos de `48px`.

---
*Consulte o [Manual de Design](docs/DESIGN.md) para detalhes sobre as cores e fontes utilizadas.*
