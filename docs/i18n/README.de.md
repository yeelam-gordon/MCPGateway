# MCPGateway — Lokale MCP-Backends zwischen Programmiersitzungen teilen

<a id="languages"></a>
<details>
<summary>Languages (16)</summary>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [العربية](README.ar.md) · [हिन्दी](README.hi.md) · [Bahasa Indonesia](README.id.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md)

</details>

Mehrere Sitzungen nutzen einen Backend-Satz: weniger doppelte Speicherbelegung und wiederholte Starts. Der geprüfte SDK/stdio-Pfad erhält die bestehende MCP-Verbindung bei Konfigurationsergänzungen (bestehende Verbindung von Ihrem Agenten zum Gateway).

[Starten](#first-use) · [Kompatibilität (Englisch)](../CLIENTS.md#compatibility-summary) · [Belege und Grenzen (Englisch)](../BENCHMARK.md) · [Copilot-Updates](../CLIENTS.md#copilot-cli-upgrade)

<img src="../../assets/mcp-gateway-benefits.png" alt="Backend-Kopien werden gemeinsam genutzt, Starts wiederverwendet; im SDK/stdio-Versuch bleibt die bestehende MCP-Verbindung beim Neustart des eigenen Gateways nach Arbeitsabschluss erhalten." width="780">

Konzeptgrafik mit englischen Beschriftungen, kein Laufzeitbild oder Benchmark. [SVG](../../assets/mcp-gateway-benefits.svg)

- **Doppelten Backend-Speicher vermeiden:** Bei angenommenen 5 × 1.5 GB als gemeinsamem Satz werden 6 GB Doppelbelegung **vor** Gateway-/Konnektor-Overhead vermieden. Das ist keine gemessene Nettoersparnis.
- **Backend-Startarbeit wiederverwenden:** Nutzen alle fünf Sitzungen die zwölf stdio-Dienste, sinkt die Zahl der Backendstarts von 60 auf 12. Das bedeutet nicht 80% schnelleres Starten.
- **Bestehende MCP-Verbindung behalten:** Der SDK/stdio-Versuch erhielt die Verbindung nach reinen Konfigurationsergänzungen und einem Neustart des eigenen Gateways nach Arbeitsabschluss. Kein Hot Reload, keine Fortsetzung aktiver Aufrufe und kein Nachweis für alle nativen Gesprächsoberflächen. Erstregistrierung und Runtime-Upgrades können einen Client-Neustart erfordern. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

<a id="resource-examples"></a>
**Nutzen oder auslassen:** Für mehrere Sitzungen mit demselben Konnektor und Katalog. Bei einer Sitzung oder leichten Backends kann direktes MCP einfacher sein. Im leichten Test stieg das summierte Prozess-Working-Set von 357.0 → 564.0 MiB; die erste gemeinsame Anfrage vom Start eines neuen Gateways bis zum nutzbaren Ergebnis dauerte 1886.7 ms gegenüber 503.5 ms direkt. Der Nettovorteil hängt vom Overhead ab. [BENCHMARK](../BENCHMARK.md#sharing-model-and-evidence)

<a id="first-use"></a>
## Erster nützlicher Erfolg: ein autorisierter Lesezugriff über das Gateway

Erforderlich sind Node.js 24+, npm, Git, Copilot CLI mit Plugins und bereits konfigurierte MCP-Integrationen mit der nötigen Authentifizierung. Die Ersteinrichtung erfolgt über Copilot CLI; Windows ist die hauptsächlich getestete Plattform. Die Prüftiefe unterscheidet sich je nach Client. [Copilot `/help` · `/plugin`](../CLIENTS.md#copilot-plugin-eligibility).

**Vor der Installation:** Konfiguration, privater Katalog und Sicherungen können Zugangsdaten enthalten: nicht veröffentlichen. Backends können entfernte Dienste kontaktieren. Eine persistente Runtime wird installiert; Konfigurationswiederherstellung oder Plugin-Entfernung beendet das Gateway nicht. [REFERENCE](../REFERENCE.md#planned-exit) Lokaler privater Zustand und gespeicherte Gateway-Tokens sind nur für den Eigentümer zugänglich, nicht zusätzlich verschlüsselt.

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Öffnen Sie Copilot CLI und rufen Sie `/mcp-gateway-setup` auf. Prüfen Sie die Vorschau und genehmigen Sie nur die gewünschten Änderungen. Bewahren Sie private Sicherungen und Rollback-Befehle auf. Das Plugin allein führt keine Konfigurationen zusammen.
2. Schließen und öffnen Sie Copilot erneut; führen Sie den exakt zurückgegebenen `readinessCommand` nach der Anleitung zum Befehlsobjekt aus. Ein reiner Prüfbefehl startet kein fehlendes Gateway. [readinessCommand](../REFERENCE.md#readiness-command-object) Speichern Sie nur das zurückgegebene JSON-Objekt; `.command` ist die genehmigte ausführbare Datei und `.args` enthält die exakten Argumente in ihrer Reihenfolge.
3. Wählen Sie einen harmlosen, autorisierten Lesezugriff auf eine vorhandene Integration. Ersetzen Sie nur die Aufgabe in Klammern; Aliase, Tools und Argumente aus Erkennung und Schema übernehmen, nicht erfinden.

> Nutze das Gateway für [meine autorisierte Leseaufgabe]. Verwende `list_servers`, eine gezielte Suche mit `search_tools` und `get_tool_schema`; bereite schema-konforme Argumente mit autorisierten, nicht sensiblen Testwerten vor. Hole die üblichen Genehmigungen ein. Bei `requiresExclusiveAccess: true` einmal `claim_server` vor `call_tool`, danach `release_server`, wenn alle Aufrufe beendet sind; nicht exklusive Backends brauchen keine Reservierung. Zeige den tatsächlichen Datensatz oder ein dokumentiertes leeres Ergebnis und prüfe Fehler, nicht nur die Gateway-Antwort. Bei unbekanntem Ergebnis nicht erneut aufrufen: gesperrt lassen und privat an den Installationsverantwortlichen übergeben.

4. In einer zweiten Sitzung mit demselben Konnektor und Katalog denselben Alias suchen: erwartet werden `ready` und dieselben Fähigkeiten. Das prüft gemeinsame Erkennung, nicht Prozessidentität oder RAM-Ersparnis. [MCP](../REFERENCE.md#first-shared-workflow) [Öffentliches echo-Beispiel und Ergebnis](../REFERENCE.md#public-echo-illustration).

**Bei Fehlern:** Leeren Katalog anhand ausgewählter Konfiguration und Vorschau prüfen; Begriffe aus Backend-Beschreibungen verwenden. Authentifizierung und Bereitschaft nach Referenz behandeln, ohne Umgehungsprozess. Freigabe oder Trennung bricht einen unbekannten exklusiven Aufruf nicht ab und entsperrt ihn nicht sicher. Ergebnis abgleichen, eigenen Gateway-Neustart koordinieren und neu reservieren. [Authentication](../REFERENCE.md#native-http-oauth) · [Recovery](../REFERENCE.md#setup-recovery) · [Unknown outcome](../REFERENCE.md#unknown-exclusive-result)

**Nutzung beenden:** Arbeit und Aufrufe abschließen, betroffene Client-Konnektoren wiederherstellen oder entfernen und nach Betreiberübergabe den Stillstand des eigenen Gateways prüfen. Konfigurations-Rollback ist kein Prozessstopp. Private Daten, Zugangsdaten, Verlauf und fremde Prozesse erhalten. [Exit](../REFERENCE.md#planned-exit)

<a id="clients"></a>
Dies ist ein lokalisierter Überblick. Methoden, Zahlenherkunft und Betriebsdetails stehen in englischen Leitfäden. Native Client-Unterstützung belegt keine menschlich geprüfte Verständlichkeit dieser Übersetzung. [CLIENTS](../CLIENTS.md) · [REFERENCE](../REFERENCE.md) · [BENCHMARK](../BENCHMARK.md)

MIT — [LICENSE](../../LICENSE).
