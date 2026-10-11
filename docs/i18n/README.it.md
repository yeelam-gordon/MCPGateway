# MCPGateway — Condividi backend MCP locali tra sessioni di programmazione

<a id="languages"></a>
<details>
<summary>Languages (16)</summary>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [العربية](README.ar.md) · [हिन्दी](README.hi.md) · [Bahasa Indonesia](README.id.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md)

</details>

Più sessioni, un insieme di backend: evita memoria duplicata e avvii ripetuti. Il percorso SDK/stdio verificato mantiene la connessione MCP esistente quando aggiungi configurazione (connessione esistente dal tuo agente al gateway).

[Inizia](#first-use) · [Compatibilità (inglese)](../CLIENTS.md#compatibility-summary) · [Prove e limiti (inglese)](../BENCHMARK.md) · [Aggiornamenti di Copilot](../CLIENTS.md#copilot-cli-upgrade)

<img src="../../assets/mcp-gateway-benefits.png" alt="Le copie dei backend diventano un insieme condiviso; gli avvii vengono riutilizzati; nell’esperimento SDK/stdio la connessione MCP esistente sopravvive al riavvio del gateway sotto la tua autorità dopo la fine del lavoro." width="780">

Illustrazione concettuale con etichette inglesi, non una schermata o un benchmark. [SVG](../../assets/mcp-gateway-benefits.svg)

- **Evita di duplicare la memoria dei backend:** Ipotizzando di condividere 5 × 1.5 GB in un insieme, si evitano 6 GB di duplicazione **prima** dell’overhead del gateway e dei connettori. Non è un risparmio netto misurato.
- **Riutilizza il lavoro di avvio:** Se tutte le cinque sessioni usano i dodici servizi stdio, gli avvii passano da 60 → 12. Non significa un avvio più rapido dell’80%.
- **Mantieni la connessione MCP esistente:** L’esperimento SDK/stdio ha mantenuto la connessione dopo sole aggiunte di configurazione e il riavvio del gateway sotto la tua autorità a lavoro concluso. Non dimostra hot reload né continuità delle chiamate attive e non dimostra la continuità della conversazione in tutti i client nativi. Registrazione iniziale e aggiornamenti del runtime possono richiedere un riavvio del client. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

<a id="resource-examples"></a>
**Quando usarlo o evitarlo:** Per più sessioni con lo stesso connettore e catalogo. MCP diretto può essere più semplice per una sessione o backend leggeri. Il test leggero ha aumentato il working set sommato dei processi da 357.0 → 564.0 MiB; la prima richiesta condivisa, dall’avvio di un nuovo gateway al primo risultato utile, ha richiesto 1886.7 ms contro 503.5 ms diretto. Il beneficio netto dipende dall’overhead. [BENCHMARK](../BENCHMARK.md#sharing-model-and-evidence)

<a id="first-use"></a>
## Primo risultato utile: una lettura autorizzata tramite il gateway

Servono Node.js 24+, npm, Git, Copilot CLI con plugin e integrazioni MCP già configurate e autenticate. La prima installazione passa da Copilot CLI; Windows è la piattaforma principale di test. La verifica varia tra i client. [Copilot `/help` · `/plugin`](../CLIENTS.md#copilot-plugin-eligibility).

**Prima di installare:** Configurazione, catalogo privato e backup possono contenere credenziali: non pubblicarli. I backend possono contattare servizi remoti. Si installa un runtime persistente; ripristinare la configurazione o rimuovere il plugin non arresta il gateway. [REFERENCE](../REFERENCE.md#planned-exit) Lo stato privato locale e i token salvati del gateway sono accessibili solo al proprietario, senza ulteriore cifratura.

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Apri Copilot CLI e invoca `/mcp-gateway-setup`. Esamina l’anteprima e approva solo le modifiche desiderate. Conserva backup privati e comandi di ripristino. Il solo plugin non unisce le configurazioni.
2. Chiudi e riapri Copilot; esegui il `readinessCommand` esatto restituito seguendo le istruzioni sull’oggetto comando. Un controllo non avvia un gateway assente. [readinessCommand](../REFERENCE.md#readiness-command-object) Salva solo l’oggetto JSON restituito; `.command` è l’eseguibile approvato e `.args` sono gli argomenti esatti nel loro ordine.
3. Scegli una lettura innocua e autorizzata in un’integrazione esistente. Sostituisci solo il compito tra parentesi; ricava alias, strumenti e argomenti dalla scoperta e dallo schema, senza inventarli.

> Usa il gateway per [la mia lettura autorizzata]. Esegui `list_servers`, una ricerca mirata con `search_tools` e `get_tool_schema`; prepara argomenti conformi con valori di prova autorizzati e non sensibili. Ottieni le approvazioni normali. Se `requiresExclusiveAccess: true`, usa una volta `claim_server` prima di `call_tool` e `release_server` dopo tutte le chiamate; i backend non esclusivi non richiedono prenotazione. Mostra il record reale o un risultato vuoto documentato e verifica gli errori, non solo la risposta del gateway. Se l’esito è sconosciuto, non riprovare: mantieni il blocco e passa il caso in privato al responsabile dell’installazione.

4. In una seconda sessione con lo stesso connettore e catalogo, cerca lo stesso alias: attendi `ready` e le stesse capacità. Verifica la scoperta condivisa, non l’identità del processo o il risparmio di RAM. [MCP](../REFERENCE.md#first-shared-workflow) [Esempio pubblico echo e risultato](../REFERENCE.md#public-echo-illustration).

**In caso di errore:** Con catalogo vuoto verifica configurazione e anteprima; cerca termini nelle descrizioni del backend. Segui la guida per autenticazione o disponibilità, senza processi di aggiramento. Rilasciare o disconnettere non annulla né sblocca in sicurezza un esito esclusivo sconosciuto. Verifica l’esito, coordina il riavvio del gateway sotto la tua autorità e prenota di nuovo. [Authentication](../REFERENCE.md#native-http-oauth) · [Recovery](../REFERENCE.md#setup-recovery) · [Unknown outcome](../REFERENCE.md#unknown-exclusive-result)

**Smettere di usarlo:** Concludi lavori e chiamate, ripristina o rimuovi i connettori dei client coinvolti e segui il passaggio all’operatore per verificare l’arresto del gateway sotto la tua autorità. Ripristinare la configurazione non arresta il processo. Conserva stato privato, credenziali, cronologia e processi estranei. [Exit](../REFERENCE.md#planned-exit)

<a id="clients"></a>
Questa è una panoramica localizzata. Metodi, provenienza delle cifre e dettagli operativi sono nelle guide inglesi. Il supporto nativo ai client non certifica la comprensione umana della traduzione. [CLIENTS](../CLIENTS.md) · [REFERENCE](../REFERENCE.md) · [BENCHMARK](../BENCHMARK.md)

MIT — [LICENSE](../../LICENSE).
