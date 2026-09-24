# Avvio rapido di Shared MCP Gateway

[English](../../README.md)

> Questa è una guida rapida localizzata. Il [README](../../README.md) in inglese è la fonte autorevole per l'uso avanzato e i dettagli tecnici più recenti.

## Un gateway per i backend MCP esistenti

Shared MCP Gateway consente a Copilot di caricare inizialmente un'interfaccia fissa di **6 strumenti gateway**, quindi di cercare e richiamare su richiesta gli strumenti dei backend già configurati. Anche con circa **1.000 strumenti** nel catalogo, non è necessario fornire al client tutte le definizioni fin dall'inizio.

Il catalogo e le connessioni backend vengono riutilizzati tra più sessioni Copilot CLI, riducendo l'avvio duplicato dei server locali. Il gateway non installa server MCP e non fornisce credenziali: continua a usare il metodo abituale per configurare server e autenticazione.

I 6 strumenti comprendono 4 strumenti di individuazione/esecuzione e 2 strumenti generici di lease del server. Il lease è adatto a qualsiasi backend che richieda uno stato di workflow esclusivo e non è limitato all'automazione del browser.

## Prerequisiti

- Node.js 24 o versione successiva, npm e Git
- Copilot CLI con supporto per i plugin
- Una configurazione MCP di Copilot esistente e l'autenticazione richiesta dai backend
- Agency è facoltativo e non è necessario per il normale utilizzo di Copilot CLI

## Installazione

Esegui questi comandi nel **terminale**, non nella chat di Copilot:

```text
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

Avvia quindi Copilot ed esegui al suo interno:

```text
/mcp-gateway-setup
```

La sola installazione del plugin non migra la configurazione MCP. La procedura mostra prima un'anteprima; dopo l'approvazione, esegue il backup della configurazione esistente, salva le definizioni backend in una directory privata e imposta il connettore del gateway condiviso nella configurazione del client.

Conserva il percorso del backup e il comando di ripristino esatto mostrati dalla procedura. Il catalogo e i backup possono contenere credenziali: non pubblicarli e non inserirli nel controllo versione.

Al termine, chiudi e riapri Copilot. Il gateway si avvia automaticamente al primo utilizzo del connettore; non occorre lasciare aperto un altro terminale.

## Funzionamento

1. `list_servers` elenca gli alias configurati senza avviare tutti i backend.
2. `search_tools` cerca i riepiloghi degli strumenti pertinenti in un backend specifico.
3. `get_tool_schema` recupera solo lo schema di input completo dello strumento scelto.
4. `call_tool` convalida gli argomenti e l'elenco consentito prima di richiamare lo strumento.
5. `claim_server` e `release_server` proteggono l'intero workflow di un server che richiede accesso esclusivo e rilasciano il lease al termine delle chiamate attive.

Client MCP, gateway e server MCP hanno ruoli diversi, ma nell'uso quotidiano non è necessario conoscere i dettagli del protocollo: configura i backend come sempre e lascia che Copilot li individui e li richiami attraverso il gateway.

## Aggiornamento e ripristino

Dopo aver aggiornato il plugin, esegui `/mcp-gateway-setup` per adottare esplicitamente il nuovo runtime. Attendi il completamento delle chiamate attive, applica l'aggiornamento e riapri Copilot; il solo download del plugin non sostituisce un gateway in esecuzione.

Se la configurazione non riesce, chiudi Copilot e usa il percorso di backup e il comando di ripristino esatti mostrati. Non eliminare la directory privata dei backend per tentare il recupero.
Consulta il [README](../../README.md) in inglese per sincronizzazione della configurazione, integrazione dei client, lease e risoluzione dei problemi.

**Licenza:** [MIT](../../LICENSE)
