# Shared MCP Gateway

[English](../../README.md)

> Questa è una panoramica localizzata. Il [README](../../README.md) inglese e la guida client inglese collegata più avanti sono le fonti autorevoli per installazione completa, aggiornamenti e dettagli tecnici.

## Risparmia RAM. Conserva il contesto per il tuo lavoro. Strumenti su richiesta.

**Più agenti devono significare più lavoro completato, non più copie della stessa configurazione MCP.**

### 5 agenti. 12 connessioni MCP. Una configurazione condivisa.

*Esempio illustrativo: le **12** connessioni offrono **1,000** strumenti e ogni configurazione indipendente usa **1.5 GB** di RAM dei processi locali.*

| Vantaggio | Configurazione separata per agente | Con MCPGateway |
|---|---|---|
| **Risparmia RAM** | **7.5 GB** per cinque configurazioni MCP indipendenti. | **1.5 GB condivisi**, oltre al sovraccarico di gateway e connettori. **6 GB di memoria duplicata evitati.** |
| **Conserva il contesto. Strumenti su richiesta.** | Ogni agente carica in anticipo **1,000 definizioni di strumenti**, un numero che può crescere aggiungendo connessioni MCP. | Solo **6 strumenti gateway iniziali, il 99.4% di definizioni in meno**. Tutti i **1,000** strumenti restano disponibili; ogni agente individua e carica solo quelli necessari. Aggiungi connessioni senza caricarne l'intero catalogo in ogni agente. |

**Mantieni agenti e connessioni MCP. Evita che ogni sessione porti con sé la propria copia.**

*I valori RAM sono illustrativi, non risparmi misurati; la memoria degli agenti è aggiuntiva. Il numero di definizioni non equivale a un risparmio di token e i client che già rinviano il caricamento possono ottenere un vantaggio di contesto minore. La condivisione non amplia la finestra di contesto né rende costante la RAM totale.*

## Funzionamento

Il gateway presenta sempre 6 strumenti all'agente: 4 per individuare e richiamare funzionalità e 2 per le integrazioni che richiedono un flusso esclusivo. Aggiungere connessioni non amplia questa interfaccia iniziale; lo schema completo viene caricato solo per lo strumento scelto. Le connessioni già configurate e autenticate vengono riutilizzate, senza installare servizi o fornire credenziali.

**Prerequisiti:** Node.js 24 o versione successiva, npm, Git e Copilot CLI con plugin per l'avvio attuale. Agency è facoltativo.

## Installazione e aggiornamento per client

Il runtime condiviso viene attualmente creato tramite Copilot CLI; gli altri client si collegano allo stesso connettore stabile. I link seguenti aprono la guida client inglese, fonte ufficiale per installazione e aggiornamento.

| Client | Installazione | Aggiornamento |
|---|---|---|
| GitHub Copilot CLI | [Installa](../CLIENTS.md#copilot-cli-install) | [Aggiorna](../CLIENTS.md#copilot-cli-upgrade) |
| VS Code (editor) | [Installa](../CLIENTS.md#vs-code-install) | [Aggiorna](../CLIENTS.md#vs-code-upgrade) |
| Claude Code | [Installa](../CLIENTS.md#claude-code-install) | [Aggiorna](../CLIENTS.md#claude-code-upgrade) |
| Codex CLI | [Installa](../CLIENTS.md#codex-install) | [Aggiorna](../CLIENTS.md#codex-upgrade) |
| OpenCode | [Installa](../CLIENTS.md#opencode-install) | [Aggiorna](../CLIENTS.md#opencode-upgrade) |
| Qwen Code | [Installa](../CLIENTS.md#qwen-code-install) | [Aggiorna](../CLIENTS.md#qwen-code-upgrade) |
| Kimi CLI | [Installa](../CLIENTS.md#kimi-cli-install) | [Aggiorna](../CLIENTS.md#kimi-cli-upgrade) |
| Antigravity CLI | [Installa](../CLIENTS.md#antigravity-cli-install) | [Aggiorna](../CLIENTS.md#antigravity-cli-upgrade) |

La configurazione mostra un'anteprima prima di ogni modifica. Dopo l'approvazione crea backup privati e restituisce controlli di disponibilità e comandi esatti di ripristino. Configurazione e backup possono contenere credenziali: non pubblicarli e non inserirli nel controllo versione.

**Riferimento operativo (inglese):** [Consulta il riferimento operativo](../REFERENCE.md)

**Licenza:** [MIT](../../LICENSE)
