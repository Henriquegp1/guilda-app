# Direção visual

## O assunto

Guildas de viewers no canal de RPG de um streamer brasileiro. O público está
assistindo a uma live e olha o painel por poucos segundos entre uma coisa e
outra. O trabalho do painel é um só: **mostrar onde minha guilda está e deixar
eu agir**.

A matéria-prima é heráldica — brasões, estandartes, tinturas. Não "UI de jogo
de fantasia", que é outra coisa: vidro fosco, brilho roxo e borda neon.

## A restrição é a forma

318 × 496 px é aproximadamente 2:3. Isso é proporção de **estandarte**. O painel
não é um card que por acaso é estreito; é uma bandeira pendurada ao lado do
vídeo. Essa leitura decide o layout inteiro e não precisou de nenhuma decoração
para existir — ela já estava na medida que a Twitch impõe.

## Paleta — tinturas heráldicas

Heráldica tem vocabulário próprio de cor, dividido entre metais e esmaltes. É de
lá que vem a paleta, não de um tema escuro genérico.

| Token       | Hex       | Papel                                        |
| ----------- | --------- | -------------------------------------------- |
| `--sable`   | `#16121C` | Fundo. Preto com viés violeta, não neutro    |
| `--sable-2` | `#221A2B` | Superfície elevada                           |
| `--or`      | `#C8A02E` | Metal ouro: nível, posição, o trilho do mastro |
| `--argent`  | `#E6E1EE` | Metal prata: texto                           |
| `--gules`   | `#A63232` | Vermelho: guerra, perda, risco               |
| `--vert`    | `#3F7D5C` | Verde: ganho, XP, sucesso                    |

**`#9146FF` é da Twitch, não nossa.** Fica reservado exclusivamente para ações
que pertencem à plataforma — gastar Bits, conceder identidade. Quando o viewer
vê roxo, é a Twitch pedindo algo, nunca a guilda. É uma regra de significado,
não de estética.

## Tipografia

| Papel   | Face                    | Uso                                    |
| ------- | ----------------------- | -------------------------------------- |
| Display | **Grenze**              | Só nome de guilda e TAG                |
| Texto   | **Archivo**             | Todo o resto                           |
| Dados   | Archivo + `tabular-nums` | Posição, XP, placar — números não dançam |

Grenze (Omnibus-Type) é um serifado angular com DNA gótico: tem a idade certa
sem ser blackletter, que é ilegível a 11px. O caminho óbvio aqui seria Cinzel —
capitulares romanas, a fonte padrão de todo projeto de fantasia. Grenze é a
escolha deliberada de sair disso, e as hastes angulares dela sobrevivem ao corpo
pequeno melhor que as serifas finas da Cinzel.

Dados usam variante numérica em vez de uma terceira família: o placar de guerra
atualiza a cada poucos segundos e número proporcional faz a linha inteira
tremer.

## Assinatura

**O painel pende como um estandarte.** Um trilho de ouro de 2px na borda
esquerda faz as vezes do mastro, e a base é cortada em cauda de andorinha com
`clip-path`.

O risco: a cauda come ~22px de altura numa caixa que já é apertada. Vale porque
é a única coisa que torna este painel reconhecível como estandarte de guilda em
vez de mais um card escuro, e o espaço perdido é a margem inferior, que não
carregava informação. Custo: duas propriedades de CSS, zero JavaScript.

## Disciplina

- Numeração só onde há sequência real (posição no ranking). Nada de `01 / 02 /
  03` como ornamento.
- Uma coisa memorável por tela. O estandarte é ela; o resto é quieto.
- Foco de teclado sempre visível, contraste conferido, `prefers-reduced-motion`
  respeitado — ver `MOVIMENTO.md`.

## Texto de interface

Voz ativa e vocabulário do viewer, não do sistema. "Entrar na guilda", não
"Submeter adesão". O botão que diz **Criar guilda** produz o estado que diz
**Guilda criada** — a mesma palavra do começo ao fim do fluxo.

Erro diz o que aconteceu e o que fazer, sem pedir desculpa e sem ser vago.
"Esta guilda está cheia. Tente outra ou peça vaga ao líder" em vez de "Erro ao
entrar". Tela vazia é convite para agir, não aviso de ausência.
