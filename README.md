# Auto Model

Um mod para o **Claude Code** que escolhe sozinho o modelo (Haiku, Sonnet ou Opus) e o esforço de raciocínio
de cada pedido, para você gastar menos do seu limite sem perder qualidade. Tudo em português.

- **Escolha inteligente:** o mod lê o que o pedido exige e usa o modelo mais barato que dá conta.
- **Você vê tudo:** uma faixa acima da caixa de mensagem mostra o modelo, o esforço, quanto tempo levou e quanto da sessão e da semana o pedido usou.
- **Painel bonito:** `/automodelo` abre um painel com a economia, o uso e as últimas decisões.
- **Você manda:** `!haiku`, `!sonnet` ou `!opus` no começo de um pedido forçam o modelo naquele pedido.
- **Prévia:** `/automodelo prever <texto>` mostra o que o mod faria, sem enviar nada.

> Este repositório é **privado**: só entra quem recebeu convite. Não compartilhe o acesso.

---

## Como instalar (passo a passo para leigos)

Leva uns 10 minutos. Você só faz isso **uma vez**.

### Passo 1 · Aceitar o convite do GitHub
1. Tenha uma conta gratuita no [GitHub](https://github.com/signup).
2. Abra o e-mail do convite do **FabaoMega** e clique em **Accept invitation** (ou entre em github.com/FabaoMega/auto-model e aceite).

### Passo 2 · Deixar o seu computador entrar no GitHub (Windows)
O Claude precisa do seu login do GitHub para baixar o mod, porque o repositório é privado.

1. Abra o menu Iniciar, digite **PowerShell** e abra.
2. Instale a ferramenta do GitHub (se pedir permissão, aceite):
   ```
   winget install --id GitHub.cli -e
   ```
3. **Feche o PowerShell e abra de novo.**
4. Faça o login. Escolha **GitHub.com**, depois **HTTPS**, depois **Login with a web browser**, copie o código que aparecer e confirme no navegador:
   ```
   gh auth login
   ```
5. Ligue o login ao Git:
   ```
   gh auth setup-git
   ```

Mac: troque o passo 2 por `brew install gh`. O resto é igual.

### Passo 3 · Instalar no Claude
**No app do Claude (aba Code):**
1. Clique no **+** ao lado da caixa de mensagem e depois em **Plugins**.
2. Clique em **Add marketplace**, digite `FabaoMega/auto-model` e confirme.
3. Clique em **Add plugin** e escolha **auto-model**.

**No terminal (Claude Code):**
```
/plugin install auto-model --marketplace FabaoMega/auto-model
```
Responda `y` à pergunta de adicionar o marketplace e escolha o escopo de usuário (**user**).

### Passo 4 · Reiniciar e testar
1. Feche o Claude por completo (ícone perto do relógio, botão direito, **Sair**) e abra de novo.
2. Numa conversa nova, mande uma mensagem qualquer. Se o app perguntar se pode ligar os mods, aceite.
3. Digite **sozinho** na caixa de mensagem (sem nenhum outro texto na mesma mensagem):
   ```
   /automodelo ajuda
   ```
   Se a primeira linha disser "Auto Model", está funcionando.

---

## Comandos

Digite cada comando **sozinho** na mensagem.

| Comando | O que faz |
| --- | --- |
| `/automodelo` | Abre o painel |
| `/automodelo resumo` | Resumo da economia e do uso, direto na conversa |
| `/automodelo teste` | Mostra para onde iriam 6 pedidos de exemplo, sem enviar nada |
| `/automodelo prever <texto>` | Prevê modelo, esforço, tokens, uso e tempo de um pedido |
| `/automodelo porque` | Explica a última escolha (`porque detalhes` mostra a conta) |
| `/automodelo modo economia` | Gasta menos (também: `equilibrado`, `qualidade`) |
| `/automodelo ligar` / `desligar` | Liga ou desliga o mod |
| `/automodelo diagnostico` | Confere se está tudo certo |
| `/automodelo ajuda` | Lista todos os comandos |

## Bom saber
- O mod faz uma chamada pequena ao **Haiku** por pedido para entender o que ele exige. Isso usa uma parte do limite da **sua** conta.
- Os números de uso (sessão e semana) só aparecem quando o app informa. Se aparecer "sem leitura agora", o mod não inventa valores.
- O seletor de modelo do rodapé do app pode continuar mostrando outro modelo. O rótulo do mod, ao lado, mostra o que realmente está rodando.
- A API de mods do Claude Code é recente e pode mudar entre versões. O mod foi testado na versão 2.1.312.

## Problemas comuns
| Problema | O que fazer |
| --- | --- |
| "Repository not found" ao instalar | Aceite o convite (passo 1) e refaça o login (`gh auth login`, `gh auth setup-git`) |
| `/automodelo` não faz nada | O comando tem que ser a única coisa da mensagem |
| Nada aparece depois de instalar | Saia do Claude pelo ícone perto do relógio e abra de novo |
| A faixa sumiu | Clique em **Ocultar** só esconde até o próximo pedido; mande outra mensagem |

## Atualizar
Quando houver versão nova, o Claude avisa em **Plugins**. Você também pode rodar `/plugin update auto-model`.

## Desinstalar
Em **Plugins**, remova o `auto-model`. Reinicie o Claude.
