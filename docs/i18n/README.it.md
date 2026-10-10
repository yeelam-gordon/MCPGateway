# MCPGateway — Condividi server MCP locali tra sessioni di agenti di programmazione

[English](../../README.md)

> Questa è una panoramica localizzata. Il [README](../../README.md) inglese e la guida client inglese collegata più avanti sono le fonti autorevoli per installazione completa, aggiornamenti e dettagli tecnici.

Più sessioni Copilot CLI non devono avviare copie dello stesso server MCP. Riutilizza i backend locali già configurati, scopri gli strumenti su richiesta e coordina i flussi esclusivi. Non è una piattaforma aziendale di governance delle API.

**Prerequisiti:** Node.js 24 o successivo, npm, Git, Copilot CLI con plugin e servizi MCP già configurati e autenticati. La prima installazione passa attualmente da Copilot CLI; Windows è la piattaforma principale di test e Agency è facoltativo. Compatibilità e livello di verifica variano tra i client.

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

## Prima configurazione e prima chiamata

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Dopo l’installazione avvia Copilot CLI e invoca `/mcp-gateway-setup`. Esamina l’anteprima prima di approvare le modifiche desiderate. Chiudi e riapri Copilot, poi esegui il `readinessCommand` esatto ricevuto. Conserva i backup privati e i comandi di ripristino.
2. Chiama `list_servers` con `{}`: devono apparire alias, stati e indicatori di esclusività dei servizi configurati. Scegli un backend autorizzato, cerca un termine del tuo compito con `search_tools` e ottieni lo schema dello strumento con `get_tool_schema`. Prepara argomenti conformi allo schema e usa `call_tool` per una lettura approvata. Il risultato atteso è un record reale o un risultato vuoto documentato; controlla anche gli errori, perché una risposta non dimostra da sola il successo.
3. Se `requiresExclusiveAccess: true`, usa `claim_server` prima della ricerca e `release_server` dopo la conclusione di tutte le chiamate. I backend non esclusivi non richiedono prenotazione. Non ripetere una chiamata scaduta con esito sconosciuto: verifica il lavoro attivo e coordina il riavvio. Se l’esito è sconosciuto, il backend esclusivo resta bloccato fino al riavvio del gateway; rilasciare la prenotazione o disconnettere il client non lo sblocca in sicurezza, e la disconnessione non annulla l’operazione.

[Esempio completo in inglese](../../README.md#first-use) · [Compatibilità](../CLIENTS.md#compatibility-summary)

## Limiti, riservatezza e ripristino

Trovare questo repository da Claude Code, Codex, Gemini CLI, Kimi o Qwen CLI non garantisce integrazione nativa. Non è documentata una procedura per Gemini CLI; Antigravity è un altro client. Kimi è testato solo a livello di adattatore. Configurazione e backup possono contenere credenziali: non pubblicarli né inserirli nel controllo versione. I backend possono contattare servizi remoti; condividere non significa lavorare offline né garantisce risparmi fissi di RAM o token.

Se l’elenco è vuoto, controlla configurazione selezionata e anteprima della migrazione. Se la ricerca non trova nulla, usa termini delle descrizioni del backend. Per errori di autenticazione o disponibilità segui il riferimento operativo, senza avviare processi paralleli per aggirarlo. Ripristinare il client non arresta il runtime persistente: per uscire consulta il passaggio all’operatore e i controlli finali.

[Riservatezza](../REFERENCE.md#state-and-privacy) · [Ripristino e rollback](../REFERENCE.md#setup-recovery) · [Uscita e passaggio all’operatore](../REFERENCE.md#planned-exit)

La configurazione mostra un'anteprima prima di ogni modifica. Dopo l'approvazione crea backup privati e restituisce controlli di disponibilità e comandi esatti di ripristino. Configurazione e backup possono contenere credenziali: non pubblicarli e non inserirli nel controllo versione.

**Riferimento operativo (inglese):** [Consulta il riferimento operativo](../REFERENCE.md)

**Licenza:** [MIT](../../LICENSE)
