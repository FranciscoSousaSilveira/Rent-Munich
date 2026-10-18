# Filtro de casas em Munique

Programa para Google Apps Script. Conta de origem: **munichrenttestes@gmail.com**. Destino fixo de email: **fpassilveira@gmail.com**. Notificações instantâneas via **Telegram Bot**.

**Estado: preparado localmente; pronto a instalar no Google Apps Script com suporte a Obscura, cálculo de percursos MVV e alertas Telegram.** Começa em modo de pré-visualização.

---

## Novidades: Suporte ImmoScout24/Immowelt (Obscura), Tempos MVV e Alertas Telegram

Esta versão resolve as três limitações essenciais do sistema:
1. **Extração de páginas protegidas (ImmoScout24 e Immowelt com Obscura):** Os portais ImmoScout24 (protegido por DataDome) e Immowelt (protegido por Cloudflare) bloqueiam acessos automáticos provenientes de datacenters como a Google Cloud. O projeto integra o **[Obscura](https://github.com/h4ckf0r0day/obscura)**, um motor headless stealth em Rust com motor V8 integrado que descarrega os anúncios sem bloqueios e extrai dados estruturados.
2. **Cálculo Automático de Trajetos MVV / MVG:** Integração direta com a API pública de transportes de Munique (`https://www.mvg.de/api/bgw-pt/v3/`), calculando automaticamente os tempos reais porta-a-porta nas horas de ponta para:
   - **TUM Garching Campus** (máximo 60 min / 1 h)
   - **Marienplatz** (máximo 45 min)
   - Deteção de ligação direta via **U6** e bonificação de prioridade.
   - Anúncios com tempos superiores aos limites são **automaticamente rejeitados**, eliminando a verificação manual no mapa.
3. **Alertas Instantâneos no Telemóvel (Telegram Bot API):** No mercado de arrendamento de Munique, responder nos primeiros 5 a 15 minutos é decisivo. O sistema agora despacha uma notificação imediata com som prioritário para o Telegram assim que um anúncio cumpre todos os critérios, incluindo botões interativos para abrir o anúncio ou contactar o senhorio.

---

## 1. Configuração do Extrator Local Obscura (Opcional, para ImmoScout24 e Immowelt)

O Google Apps Script consegue aceder diretamente ao WG-Gesucht sem bloqueios. Para abrir páginas completas do ImmoScout24 e Immowelt, utiliza-se o Obscura na máquina local:

### Instalação rápida do Obscura no Windows:
Na pasta do projeto, executa no terminal:
```powershell
node extractor/download-obscura.cjs
```
*(ou `npm.cmd run setup:obscura`)*

Isto descarrega a versão binária oficial stealth do Obscura para `bin/obscura.exe`.

### Iniciar o servidor bridge:
```powershell
node extractor/server.cjs
```
*(ou `npm.cmd run extractor`)*

O servidor arranca em `http://localhost:8088`. Para ligar o Google Apps Script na nuvem ao teu extrator local, podes expor a porta 8088 com um túnel seguro (ex: Cloudflare Tunnel, ngrok ou localtunnel):
```powershell
# Exemplo com cloudflared (gratuito):
cloudflared tunnel --url http://localhost:8088
```

O URL gerado (ex: `https://meu-tunel.trycloudflare.com`) é colocado na propriedade `EXTRACTOR_URL` do Apps Script.

> [!NOTE]
> Se o extrator Obscura não estiver ligado ou se a propriedade `EXTRACTOR_URL` for omitida, o sistema continua a funcionar com 100% de estabilidade: consulta o WG-Gesucht diretamente e, para o ImmoScout24/Immowelt, analisa os dados contidos no corpo do email original sem interromper a execução.

### Testar no terminal:
Podes testar a extração de qualquer anúncio ou o cálculo de percurso diretamente da linha de comandos:
```powershell
# Testar extração de anúncio:
node extractor/cli.cjs https://www.immobilienscout24.de/expose/12345678

# Testar percurso MVV:
node extractor/cli.cjs --transit "Leopoldstraße 50, München"
```

### Script CLI Independente (`scripts/scrape-munich-ad.mjs`):
Podes também inspecionar, avaliar e disparar notificações para um anúncio individual diretamente do terminal:
```powershell
# Extrair dados e calcular tempos MVV:
node scripts/scrape-munich-ad.mjs "https://www.immobilienscout24.de/expose/12345678"

# Extrair, avaliar com a Gemini API e enviar alerta para o Telegram:
$env:GEMINI_API_KEY="a_tua_chave"
$env:TELEGRAM_BOT_TOKEN="o_teu_token"
$env:TELEGRAM_CHAT_ID="o_teu_chat_id"
node scripts/scrape-munich-ad.mjs "https://www.wg-gesucht.de/wg-zimmer-in-Muenchen.123456.html" --gemini --telegram
```

---

## 2. Fazer chegar os alertas ao Gmail novo

Abre as tuas pesquisas guardadas no Immowelt, ImmoScout24 e WG-Gesucht e configura a receção dos alertas no Gmail novo (**munichrenttestes@gmail.com**). Se não quiseres alterar o email das contas existentes, podes encaminhar apenas os alertas através de um filtro no Gmail atual para a conta nova; esse encaminhamento exige a verificação do endereço no Gmail.

Mantém pesquisas separadas, para os filtros dos sites não excluírem casas para várias pessoas:

| Pesquisa | Limite warm total | Observação |
|---|---:|---|
| Casa para três | 3.000 € | Pelo menos 3 Zimmer, verificando que há 3 quartos individuais utilizáveis |
| Casa para dois | 2.000 € | Pelo menos 2 Zimmer, verificando que há 2 quartos individuais utilizáveis |
| Vários quartos na mesma WG | 1.000 €/quarto | Precisam de existir 2 ou 3 quartos livres simultaneamente |
| Estúdio | 1.000 € | Opção de última preferência |

Objetivo preferido: 800 € totais por pessoa. Se o site só permitir filtrar por Kaltmiete, esse filtro NÃO confirma o orçamento warm; o programa distingue os dois. Não excluas automaticamente anúncios sem indicação de mobília. Cozinha instalada é obrigatória, mas anúncios omissos ficam por confirmar.

---

## 3. Configurar Alertas Instantâneos no Telegram (Recomendado)

Para receber notificações instantâneas no telemóvel quando uma casa elegível for encontrada:

1. **Criar o Bot:**
   - No Telegram, procura por `@BotFather` e envia `/newbot`.
   - Escolhe um nome (ex: `Munich Rent Alert`) e um username (ex: `munich_rent_alert_bot`).
   - O `@BotFather` responderá com o teu **HTTP API Token** (formato `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ`).
2. **Obter o teu Chat ID:**
   - Inicia conversa com o teu novo bot e clica em **Start** (ou envia `/start`).
   - Para descobrir o teu ID de utilizador, envia uma mensagem para `@userinfobot` ou acede a `https://api.telegram.org/bot<TOKEN>/getUpdates`.
   - Guarda o número de ID (ex: `987654321`).
3. **Adicionar às Propriedades do Apps Script:**
   - Insere `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` nas **Propriedades do script** (ver secção 5).

---

## 4. Criar o projeto gratuito da API Gemini

Na conta nova, abre [Google AI Studio — chaves da API](https://aistudio.google.com/api-keys). Cria um projeto/chave e confirma que o projeto aparece como **Free Tier**, sem ativar faturação. Guarda a chave diretamente nas propriedades do Apps Script (passo seguinte), nunca num email, chat ou ficheiro do repositório.

O modelo atual `gemini-3.5-flash-lite` tem quota gratuita disponível para protótipos e uso pessoal.

---

## 5. Instalar no Google Apps Script

1. Com **munichrenttestes@gmail.com**, abre [Google Apps Script](https://script.google.com/) e cria um projeto chamado **Casas Munique**.
2. Substitui o conteúdo de `Code.gs` pelo ficheiro [Code.gs](Code.gs) desta pasta.
3. Nas definições do projeto, ativa a opção de mostrar `appsscript.json` e substitui o manifesto pelo [appsscript.json](appsscript.json) fornecido (fuso horário Europe/Berlin).
4. Em **Propriedades do script**, adiciona:

   | Propriedade | Valor | Obrigatório |
   |---|---|---|
   | `GEMINI_API_KEY` | A tua chave da API Gemini | Sim |
   | `FREE_TIER_CONFIRMED` | `SIM` | Sim |
   | `EXTRACTOR_URL` | URL público do teu bridge Obscura (ex: `https://meu-tunel.trycloudflare.com`) | Opcional |
   | `EXTRACTOR_TOKEN` | Token de autenticação se configurado no bridge | Opcional |
   | `TELEGRAM_BOT_TOKEN` | Token do bot do Telegram gerado pelo `@BotFather` | Opcional |
   | `TELEGRAM_CHAT_ID` | Teu ID de utilizador/conversa no Telegram | Opcional |

5. Guarda e executa a função **`preparar`**. Autoriza o acesso. A função cria a etiqueta **`Rent/Alertas`**.
6. No Gmail, cria filtros pelos remetentes reais dos alertas para aplicar essa etiqueta automaticamente.
7. Funções de teste disponíveis no Apps Script:
   - **`testarTelegram`**: Dispara uma mensagem de teste para o teu Telegram confirmando a formatação e os botões de ligação rápida.
   - **`testarPercursoMVV`**: Testa o cálculo de rotas para amostras de endereços em Munique.
   - **`testarExtrator`**: Confirma se o bridge Obscura está acessível a partir do Apps Script.
   - **`testarPaginaWG`**: Testa o leitor de páginas WG-Gesucht.

---

## 6. Testar e Ativar a Automação

1. Executa **`testar`**: processa os emails etiquetados, calcula percursos MVV, consulta páginas e cria uma pré-visualização privada no Google Drive.
2. Abre a pré-visualização HTML no teu navegador e verifica os resultados. Os tempos de trajeto MVV aparecem destacados em cada cartão.
3. Se o Telegram estiver configurado, as casas aprovadas disparam alertas instantâneos imediatos para o teu telemóvel.
4. Após validares, executa **`ativar`**: cria o acionador automático a cada 10 minutos para enviar notificações para **fpassilveira@gmail.com** e Telegram.
5. Executa **`parar`** a qualquer momento para suspender o envio automático.

---

## Critérios e Regras de Decisão

- **Entrada a partir de 1 de janeiro de 2027**; longa duração (*unbefristet*).
- **Orçamento:** Ideal até 800 € totais/pessoa; teto rígido de 1.000 € warm/pessoa.
- **Ordem de preferência:** Casa inteira para 3 → Casa inteira para 2 → 2/3 quartos livres na mesma WG → Estúdio.
- **Cozinha instalada obrigatória (*Einbauküche / EBK*);** mobília preferencial.
- **Percurso MVV (automático):**
  - **TUM Garching:** $\le 60$ min (1 h). Anúncios com tempo superior são automaticamente **rejeitados**.
  - **Marienplatz:** $\le 45$ min. Anúncios com tempo superior são automaticamente **rejeitados**.
  - Trajetos servidos pela linha **U6** recebem bonificação e prioridade máxima de ordenação.
- **Análise combinada:** IA extrai factos brutos do email e páginas; as regras de negócio, ordenação e cálculo de transportes são executadas deterministicamente em código.

---

## Validação Local dos Testes

Executa no terminal da pasta do projeto:
```powershell
npm.cmd run test:all
```

A suite de testes cobre:
- **57 testes unitários** no motor de regras do Apps Script (`tests/filter.test.cjs`):
  - Divisão de renda e limites por pessoa (800 € ideal, 1.000 € máximo).
  - Tipos de habitação (3 pessoas, 2 pessoas, WG com 2+ quartos livres, estúdio).
  - Reconhecimento de URLs e deduplicação (ImmoScout24, Immowelt, WG-Gesucht).
  - Extração de dados ImmoScout24 e Immowelt via bridge local Obscura.
  - Cálculo de rotas MVV e rejeição estrita de tempos excessivos (>60m TUM, >45m Marienplatz).
  - Formatação e despacho de notificações para a Telegram Bot API.
  - Segurança de envio, isolamento de falhas e proteção contra duplicações.
- **Testes de parsers HTML e JSON-LD** (`tests/parsers.test.cjs`):
  - Extração precisa de preços (*Kaltmiete*, *Gesamtmiete*), tipologia, comodidades (*EBK*) e morada.
- **Testes do extrator CLI** (`tests/scrape-script.test.mjs`):
  - Deteção de portais, rotas e limites de trânsito em Node.js ESM.
