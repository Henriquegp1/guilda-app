# 🛡️ Manual do Streamer — Twitch Guilds

Bem-vindo ao sistema de guildas! Este manual explica como configurar e operar a extensão no seu canal para extrair o máximo de engajamento da sua comunidade.

---

## ⚙️ Configuração Inicial (Passo a Passo)

### 1. Criar a Primeira Temporada
O sistema competitivo (Ranking e Prestígio) só funciona se houver uma temporada ativa.
- Vá em **Configurações > Temporada**.
- Clique em **Nova Temporada**.
- Defina um nome (ex: "Temporada de Fundação") e a data de término.
- Ao salvar, o ranking será zerado e o sistema começará a computar Prestígio para as guildas.

### 2. Definir Territórios
Territórios são o motor de conflito do canal. Sem eles, as guildas não têm o que disputar no mapa.
- Vá em **Configurações > Territórios**.
- Crie pelo menos 3 locais iniciais.
- Defina o **Rendimento por Dia** (sugerido: 10 a 20 de Prestígio).
- Isso habilitará o Mapa Mundi para os viewers.

### 3. Integrar com o Chat (Anúncios)
Esta é a parte mais importante para a "descoberta" do sistema.
- No seu bot de chat (Nightbot, StreamElements, etc), crie um endpoint HTTP (Webhook).
- No painel da extensão, vá em **Anúncios > Conexão**.
- Cole a URL do seu bot e clique em **Gerar Segredo HMAC**.
- **IMPORTANTE**: Copie o segredo e configure no seu bot para validar as assinaturas.
- Ative os anúncios e clique em **🧪 Testar** para ver se a mensagem aparece no chat.

---

## 👮 Moderação Diária

Acesse a **Central de Moderação** para as seguintes tarefas:

### Fila de Fundação
Toda guilda criada por um viewer fica "Pendente" até que você ou um moderador a aprove.
- Verifique se o nome e a TAG são adequados.
- **Aprovar**: A guilda se torna pública.
- **Rejeitar**: Você deve fornecer um motivo. O viewer receberá os Bits de volta como "Crédito de Identidade" para tentar criar outra guilda com um nome diferente.

### Gestão de Identidade
Mudanças de brasão ou trocas de nome também passam pela sua revisão. Isso evita que guildas usem imagens ofensivas ou nomes proibidos após a aprovação inicial.

---

## 🚨 Gestão de Crise (RBAC)

Apenas o **Broadcaster** (você) tem poder para:
- **Banir Guilda**: Remove a guilda permanentemente e bloqueia o nome/TAG para sempre.
- **Transferir Liderança**: Útil se o líder original da guilda for banido da Twitch ou abandonar a comunidade.
- **Rotacionar Segredo**: Caso suspeite que a chave do seu bot vazou.

---

## 📈 Dicas de Engajamento
- **Mute de Raid**: Se estiver recebendo uma Raid grande e o chat ficar muito poluído com anúncios, use o botão de **Mute de 30 minutos** na página de configuração.
- **Horário de Silêncio**: Configure o silêncio para as horas em que você não está em live, evitando que o bot envie mensagens "sozinho" no chat vazio.
- **Ajuste de Prestígio**: Use o ajuste manual para premiar guildas que venceram campeonatos externos ou gincanas na sua live.

---
*Dúvidas técnicas? Consulte os logs na aba de Auditoria para ver quem executou cada ação.*
