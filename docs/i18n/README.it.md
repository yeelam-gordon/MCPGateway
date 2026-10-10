# MCPGateway — Condividi server MCP locali tra sessioni di agenti di programmazione

Più sessioni Copilot CLI non devono avviare copie dello stesso server MCP. Riutilizza i backend locali già configurati, scopri gli strumenti su richiesta e coordina i flussi esclusivi. Non è una piattaforma aziendale di governance delle API.

- Riutilizza RAM e lavoro di avvio dei backend pesanti, senza copie per sessione.
- Scopri capacità e schemi su richiesta con 6 strumenti iniziali.
- Aggiungi backend mantenendo la connessione MCP dell’agente. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

Aggiungi backend senza riavviare la connessione MCP attuale dell’agente: sincronizza le aggiunte, termina il lavoro attivo e riavvia solo il gateway di proprietà; il connettore attuale si riconnette. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

Adatto a più sessioni con gli stessi backend e catalogo; una sessione o backend leggeri possono non compensare l’overhead.

[Inizia: installazione e prima lettura autorizzata](#first-use) · [MCP / Copilot CLI](../CLIENTS.md#shared-core-install) · [6 strumenti / 2 client](../../test/catalog-scale.test.js)

[Evita la RAM dei backend duplicati](#resource-examples): 5 × 1.5 GB = 7.5 GB → 1.5 GB + overhead del gateway e dei connettori.

<img src="../../assets/mcp-gateway-benefits.png" alt="Riutilizza RAM e lavoro di avvio dei backend pesanti, senza copie per sessione." width="780">

Concetto con etichette inglesi, non schermata o benchmark. Ipotesi di 1.5 GB per insieme: 6 GB di duplicazione evitata prima dell’overhead. Il fixture leggero misurato usava più RAM totale.

<a id="first-use"></a>
## Prima configurazione e prima chiamata

**Prerequisiti:** Node.js 24 o successivo, npm, Git, Copilot CLI con plugin e servizi MCP già configurati e autenticati. La prima installazione passa attualmente da Copilot CLI; Windows è la piattaforma principale di test e Agency è facoltativo. Compatibilità e livello di verifica variano tra i client.

Configurazioni e backup possono contenere credenziali: mantienili privati e approva solo le modifiche previste.

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Dopo l’installazione avvia Copilot CLI e invoca `/mcp-gateway-setup`. Esamina l’anteprima prima di approvare le modifiche desiderate. Chiudi e riapri Copilot, poi esegui il `readinessCommand` esatto ricevuto. Conserva i backup privati e i comandi di ripristino.

Scoperta e schema non richiedono prenotazione; se `requiresExclusiveAccess: true`, usa `claim_server` prima di `call_tool`.

2. Chiama `list_servers` con `{}`: devono apparire alias, stati e indicatori di esclusività dei servizi configurati. Scegli un backend autorizzato, cerca un termine del tuo compito con `search_tools` e ottieni lo schema dello strumento con `get_tool_schema`. Prepara argomenti conformi allo schema e usa `call_tool` per una lettura approvata. Il risultato atteso è un record reale o un risultato vuoto documentato; controlla anche gli errori, perché una risposta non dimostra da sola il successo.
3. Se `requiresExclusiveAccess: true`, usa `claim_server` prima della chiamata e `release_server` dopo la conclusione di tutte le chiamate. I backend non esclusivi non richiedono prenotazione. Non ripetere una chiamata scaduta con esito sconosciuto: verifica il lavoro attivo e coordina il riavvio. Se l’esito è sconosciuto, il backend esclusivo resta bloccato fino al riavvio del gateway; rilasciare la prenotazione o disconnettere il client non lo sblocca in sicurezza, e la disconnessione non annulla l’operazione.
4. In una seconda sessione con lo stesso connettore e catalogo, ripeti `list_servers` / `search_tools` per lo stesso alias. Attendi `ready` per il backend inizializzato e capacità dello stesso catalogo. Un alias uguale non prova identità del processo o risparmio di RAM; consulta il test pubblico di riuso. [Metodo di riuso dei processi](../BENCHMARK.md#method) · [Test della cache del catalogo](../../test/catalog-scale.test.js)

[Esempio completo in inglese](../../README.md#first-use) · [Compatibilità](../CLIENTS.md#compatibility-summary)

## Limiti, riservatezza e ripristino

Trovare questo repository da Claude Code, Codex, Gemini CLI, Kimi o Qwen CLI non garantisce integrazione nativa. Non è documentata una procedura per Gemini CLI; Antigravity è un altro client. Kimi è testato solo a livello di adattatore. Configurazione e backup possono contenere credenziali: non pubblicarli né inserirli nel controllo versione. I backend possono contattare servizi remoti; condividere non significa lavorare offline né garantisce risparmi fissi di RAM o token.

Se l’elenco è vuoto, controlla configurazione selezionata e anteprima della migrazione. Se la ricerca non trova nulla, usa termini delle descrizioni del backend. Per errori di autenticazione o disponibilità segui il riferimento operativo, senza avviare processi paralleli per aggirarlo. Ripristinare il client non arresta il runtime persistente: per uscire consulta il passaggio all’operatore e i controlli finali.

[Riservatezza](../REFERENCE.md#state-and-privacy) · [Ripristino e rollback](../REFERENCE.md#setup-recovery) · [Uscita e passaggio all’operatore](../REFERENCE.md#planned-exit)

La configurazione mostra un'anteprima prima di ogni modifica. Dopo l'approvazione crea backup privati e restituisce controlli di disponibilità e comandi esatti di ripristino. Configurazione e backup possono contenere credenziali: non pubblicarli e non inserirli nel controllo versione.

**Riferimento operativo (inglese):** [Consulta il riferimento operativo](../REFERENCE.md)

**Licenza:** [MIT](../../LICENSE)


<a id="resource-examples"></a>

**Evita la RAM dei backend duplicati**

Ipotesi illustrativa, non benchmark: 5 sessioni richiedono ciascuna le stesse 12 connessioni; un insieme completo di backend usa 1.5 GB. Le sessioni compatibili condividono processi reali con lo stesso connettore e catalogo.

| Distribuzione | RAM dei backend |
|---|---|
| Copie indipendenti | 5 × 1.5 GB = 7.5 GB |
| Insieme condiviso | 1.5 GB + overhead del gateway e dei connettori |

RAM duplicata evitata prima dell’overhead: 7.5 GB - 1.5 GB = 6 GB. Il risparmio totale resta ignoto fino alla misurazione. 1.5 GB non è costante tra carichi o client; non è la RAM di cinque modelli.

**Riutilizza anche il lavoro di avvio.** Se tutte le 5 sessioni usano i 12 servizi stdio, le copie richiedono fino a `5 × 12 = 60` avvii contro `12` condivisi: `60 - 12 = 48` duplicati evitati, `48 / 60 × 100 = 80%` avvii in meno. La connessione su richiesta collega solo i `k` backend usati; gli altri non si avviano. È un conteggio, non un avvio più rapido dell’80%. La latenza non è misurata; concorrenza, autenticazione e piattaforma incidono sul tempo.

1000 strumenti → 6 definizioni iniziali: (1000 - 6) / 1000 × 100 = 99.4% di definizioni in meno, non di token. Gli schemi richiesti dopo hanno un costo; i client che già ne rinviano il caricamento possono beneficiare meno. Il test del catalogo sintetico verifica sei strumenti e una cache condivisa fra due client, non prestazioni RSS. [catalog-scale.test.js](../../test/catalog-scale.test.js)

**Fixture leggero misurato: riuso, ma RAM totale peggiore e nessun vantaggio nell’avvio a freddo.** Mediane di 3 prove, Windows x64 / Node 24.13.1: schema + echo condiviso 426.2 ms con backend freddo, 21.1 ms secondo client, 19.0 ms quinto. Totale primo client: 503.5 ms diretto, 894.3 ms condiviso con gateway pronto; condiviso completamente a freddo 1886.7 ms. Processi backend 5 → 1, ma processi totali 5 → 7 e working set sommato 357.0 MiB → 564.0 MiB: RAM netta peggiore. Un solo echo non rappresenta servizi reali pesanti; 1.5 GB sopra è un’altra ipotesi, non una misura. [BENCHMARK.md](../BENCHMARK.md)

<a id="mechanism"></a>

Il test SDK/stdio mantiene connettore e connessione MCP per scoprire un nuovo alias ed eseguire echo dopo il riavvio; non testa le interfacce di conversazione dei prodotti. Nessun hot reload automatico; conflitti da esaminare. Registrazione iniziale o aggiornamento del runtime possono richiedere riavvio del client. Le chiamate interrotte non vengono ripetute; prenota nuovamente l’accesso esclusivo dopo il riavvio.

```text
Agente A ─┐                           ┌─ Integrazione A: più strumenti
Agente B ─┼─ connettore ─ MCPGateway ─┼─ Integrazione B: più strumenti
Agente C ─┘                           └─ Integrazione C: più strumenti
```

Più agenti accedono a MCPGateway tramite lo stesso connettore, che si collega su richiesta ai backend configurati selezionati. Lo schema illustra la condivisione: non è un benchmark né una verifica in esecuzione e non implica avviare tutti i backend.

> Questa è una panoramica localizzata. Il [README](../../README.md) inglese e la guida client inglese collegata più avanti sono le fonti autorevoli per installazione completa, aggiornamenti e dettagli tecnici.

[English](../../README.md)

Il gateway presenta sempre 6 strumenti all'agente: 4 per individuare e richiamare funzionalità e 2 per le integrazioni che richiedono un flusso esclusivo. Aggiungere connessioni non amplia questa interfaccia iniziale; lo schema completo viene caricato solo per lo strumento scelto. Le connessioni già configurate e autenticate vengono riutilizzate, senza installare servizi o fornire credenziali.

Per esempio, con **10** connessioni in Copilot e **2** nuove connessioni migrate esplicitamente da una configurazione Claude supportata, entrambi gli agenti possono usare le stesse **12**.

- Il plugin da solo non unisce le configurazioni. Le voci con lo stesso nome si deduplicano solo con definizioni degli alias identiche; lo stesso servizio non basta. I conflitti interrompono il processo per la revisione.
- La migrazione mostra prima un’anteprima, crea un backup e rifiuta impostazioni native non supportate.
- Non significa che tutti i client nativi siano stati testati end-to-end. [Guida alla migrazione (inglese)](../CLIENTS.md#cross-client-migration).

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
