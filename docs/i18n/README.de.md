# MCPGateway — Lokale MCP-Server zwischen KI-Programmiersitzungen gemeinsam nutzen

<a id="languages"></a>
<details>
<summary>Languages / 语言 / 言語 / اللغات (16)</summary>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [العربية](README.ar.md) · [हिन्दी](README.hi.md) · [Bahasa Indonesia](README.id.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md)

</details>

Lokale MCP-Backends zwischen Sitzungen teilen: doppelten RAM vermeiden, Startarbeit wiederverwenden und nur Konfiguration ergänzen, ohne die bestehende MCP-Verbindung des Agenten neu zu starten (SDK/stdio-Pfad; Nettovorteil abhängig vom Overhead).

[Start über Copilot CLI](#first-use) · [Client-Prüfung](../CLIENTS.md#compatibility-summary) · [Nachweise](#resource-examples)

<img src="../../assets/mcp-gateway-benefits.png" alt="RAM und Startarbeit schwerer Backends wiederverwenden, statt Kopien pro Sitzung zu starten." width="780">

Konzeptbild mit englischen Beschriftungen, kein Screenshot oder Benchmark.

- **Doppelten Backend-Speicher vermeiden:** Illustration: 5 × 1.5 GB → ein Satz; 6 GB Doppelbelegung **vor** Gateway-/Konnektor-Overhead vermieden, keine gemessene Ersparnis.
- **Wiederholte Startarbeit wiederverwenden:** Wenn alle 5 Sitzungen die 12 stdio-Dienste nutzen: 60 → 12 Backendstarts, nicht 80% schnelleres Starten.
- **Nur Konfiguration ergänzen; Agentenverbindung behalten:** SDK/stdio: 1 Initialisierung übersteht den Neustart des eigenen Gateways nach Arbeitsabschluss; der Konnektor bleibt aktiv. Kein Hot Reload oder Nachweis nativer Gesprächsoberflächen. Erstregistrierung oder Runtime-Upgrades können Client-Neustart erfordern. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

Für mehrere Sitzungen mit denselben Backends und demselben Katalog; eine Sitzung oder leichte Backends können den Overhead möglicherweise nicht ausgleichen.

<a id="first-use"></a>
## Erste Einrichtung und erster Aufruf

**Voraussetzungen:** Node.js 24 oder neuer, npm, Git, Copilot CLI mit Plugin-Unterstützung sowie konfigurierte und authentifizierte MCP-Dienste. Die Ersteinrichtung erfolgt derzeit über Copilot CLI. Windows ist die hauptsächlich getestete Plattform; Agency ist optional. Kompatibilität und Prüftiefe unterscheiden sich je nach Client.

Konfigurationen und Sicherungen können Zugangsdaten enthalten: privat aufbewahren und nur beabsichtigte Änderungen genehmigen.

[Ausstieg und persistente Runtime](../REFERENCE.md#planned-exit) · [rollback ≠ daemon shutdown](../REFERENCE.md#setup-recovery)

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Starten Sie nach der Plugin-Installation Copilot CLI und rufen Sie `/mcp-gateway-setup` auf. Prüfen Sie die Vorschau und genehmigen Sie nur die gewünschten Änderungen. Schließen und öffnen Sie Copilot erneut und führen Sie den exakt zurückgegebenen `readinessCommand` aus. Bewahren Sie Sicherungs- und Rollback-Befehle auf. Die Plugin-Installation allein führt keine Konfigurationen zusammen.

Discovery und Schema benötigen keine Reservierung; bei `requiresExclusiveAccess: true` ist `claim_server` vor `call_tool` erforderlich.

> Nutze das Gateway für [meine autorisierte Leseaufgabe]: Server auflisten, passendes Tool finden, Schema prüfen und Argumente mit genehmigten nicht sensiblen Testwerten vorbereiten. Normale Freigaben einholen, vor exklusiver Ausführung reservieren und nach Abschluss aller Aufrufe freigeben. Tatsächliches Ergebnis zeigen. Bei unbekanntem Ergebnis nicht wiederholen, sondern an den Installationsverantwortlichen übergeben.

[SDK tool flow: `list_servers` → `search_tools` → `get_tool_schema` → `claim_server` (exclusive) → `call_tool` → `release_server`](../../README.md#first-use) · [REFERENCE](../REFERENCE.md#unknown-exclusive-result)

2. Rufen Sie `list_servers` mit `{}` auf: Es sollten die vorhandenen Aliase, Zustände und Exklusivitätskennzeichen erscheinen. Wählen Sie ein autorisiertes Backend, suchen Sie mit `search_tools` nach einem passenden Aufgabenbegriff und holen Sie mit `get_tool_schema` das Schema des ausgewählten Tools. Erstellen Sie schema-konforme Argumente und führen Sie mit `call_tool` einen genehmigten Lesezugriff aus. Prüfen Sie den erwarteten Datensatz oder ein dokumentiertes leeres Ergebnis; eine Gateway-Antwort allein beweist keinen erfolgreichen Lesezugriff.
3. Bei `requiresExclusiveAccess: true` verwenden Sie vor dem Aufruf `claim_server` und nach Abschluss aller Aufrufe `release_server`. Nicht exklusive Backends benötigen keine Reservierung. Bei einem Timeout mit unbekanntem Ergebnis nicht erneut aufrufen: aktive Arbeit prüfen und den Neustart koordinieren. Bei unbekanntem Ergebnis bleibt das exklusive Backend bis zum Neustart des Gateways gesperrt; die Reservierung freizugeben oder den Client zu trennen hebt die Sperre nicht sicher auf. Eine Trennung bricht den Vorgang nicht ab.
4. In einer zweiten Sitzung mit demselben Konnektor und Katalog `list_servers` / `search_tools` für denselben Alias wiederholen. Das initialisierte Backend sollte `ready` und der Katalog dieselben Funktionen zeigen. Ein gleicher Alias beweist weder Prozessidentität noch RAM-Ersparnis; siehe den öffentlichen Wiederverwendungstest. [Methode zur Prozesswiederverwendung](../BENCHMARK.md#method) · [Katalog-Cache-Test](../../test/catalog-scale.test.js)

Bei leerem Katalog die gewählte Konfiguration und Migrationsvorschau prüfen. Ohne Treffer einen engeren Begriff aus den Toolbeschreibungen des Backends selbst verwenden; es gibt keinen universellen Toolnamen. Bei Authentifizierungsfehlern oder fehlgeschlagener Bereitschaftsprüfung der [Authentifizierung](../REFERENCE.md#native-http-oauth) und [Wiederherstellung/Rollback](../REFERENCE.md#setup-recovery) folgen, statt Aufrufe zu wiederholen oder einen parallelen Umgehungsprozess zu starten.

[Vollständiges englisches Beispiel](../../README.md#first-use) · [Kompatibilität und Grenzen](../CLIENTS.md#compatibility-summary)

## Grenzen, Datenschutz und Wiederherstellung

Das Auffinden dieses Repositories über Claude Code, Codex, Gemini CLI, Kimi oder Qwen CLI garantiert keine native Integration. Für Gemini CLI ist hier kein Installationsweg dokumentiert; Antigravity ist ein anderer Client. Kimi ist nur auf Adapterebene getestet. Konfigurationen und Sicherungen können Zugangsdaten enthalten; nicht veröffentlichen. Backends können entfernte Dienste kontaktieren. Gemeinsame Nutzung bedeutet weder Offline-Betrieb noch feste RAM- oder Token-Einsparungen.

Beenden Sie vor dem Ausstieg aktive Workflows und warten Sie auf den Abschluss aller Aufrufe. Die Wiederherstellung der Client-Konfiguration beendet die persistente Runtime nicht. Folgen Sie dem [Ausstieg und der Übergabe an den Betreiber (Englisch)](../REFERENCE.md#planned-exit) und prüfen Sie den Endzustand; behalten Sie private Daten und Zugangsdaten bei und stoppen Sie keine fremden Prozesse.

[Datenschutz](../REFERENCE.md#state-and-privacy) · [Wiederherstellung und Rollback](../REFERENCE.md#setup-recovery)

<a id="resource-examples"></a>

**RAM für doppelte Backends vermeiden**

Illustrative Annahme, kein Benchmark: 5 Sitzungen benötigen jeweils dieselben 12 Verbindungen; ein vollständiger Backend-Satz belegt 1.5 GB. Kompatible Sitzungen teilen tatsächliche Prozesse über denselben Konnektor und Katalog.

| Betrieb | Backend-RAM |
|---|---|
| Unabhängige Kopien | 5 × 1.5 GB = 7.5 GB |
| Gemeinsamer Backend-Satz | 1.5 GB + Gateway- und Konnektor-Overhead |

Vermiedener doppelter Backend-RAM vor Overhead: 7.5 GB - 1.5 GB = 6 GB. Die Gesamtersparnis ist bis zur Messung unbekannt. 1.5 GB ist kein konstanter Wert über Workloads oder Clients; nicht der RAM von fünf Modellen wird eingespart.

**Auch Startarbeit wiederverwenden.** Nutzen alle 5 Sitzungen sämtliche 12 stdio-Dienste, brauchen unabhängige Kopien bis zu `5 × 12 = 60` Starts statt `12` gemeinsam: `60 - 12 = 48` doppelte Starts vermieden, also `48 / 60 × 100 = 80%` weniger Starts. Bei verzögerter Verbindung werden nur `k` genutzte Backends verbunden; ungenutzte starten nicht. Das zählt Vorgänge, bedeutet nicht 80% schnelleres Starten. Latenz ist hier ungemessen; Parallelität, Authentifizierung und Plattform beeinflussen die Dauer.

1000 Tools → 6 anfängliche Definitionen: (1000 - 6) / 1000 × 100 = 99.4% weniger Definitionen, nicht Tokens. Später angeforderte Schemas verursachen weitere Kosten; bereits verzögert ladende Clients profitieren möglicherweise weniger. Der synthetische Katalogtest prüft sechs Tools und einen gemeinsamen Discovery-Cache für zwei Clients, keine RSS-Leistung. [catalog-scale.test.js](../../test/catalog-scale.test.js)

**Leichte Fixture gemessen: summiertes Prozess-Working-Set erhöht** Mediane aus 3 Versuchen, Windows x64 / Node 24.13.1: Schema + Echo gemeinsam 426.2 ms bei kaltem Backend, 21.1 ms beim zweiten Client, 19.0 ms beim fünften. Erster Client insgesamt: 503.5 ms direkt, 894.3 ms gemeinsam bei bereitem Gateway; vollständig kalter gemeinsamer Start 1886.7 ms. Backendprozesse 5 → 1, aber Gesamtprozesse 5 → 7 und summiertes Working Set 357.0 MiB → 564.0 MiB: höheres summiertes Prozess-Working-Set; eindeutiger physischer Speicher nicht gemessen. Ein einzelnes Echo repräsentiert keine schweren realen Dienste; 1.5 GB oben ist eine separate Annahme, keine Messung. [BENCHMARK.md](../BENCHMARK.md)

Gemessen wurde das summierte Prozess-Working-Set; physischer Speicher ohne Mehrfachzählung und private Bytes wurden nicht gemessen.

<a id="mechanism"></a>
<a id="backends-wiederverwenden-und-tools-bei-bedarf-finden"></a>

## Funktionsweise

Backends hinzufügen, ohne die bestehende MCP-Verbindung des Agenten neu zu starten: Ergänzungen synchronisieren, aktive Arbeit abschließen und nur das eigene Gateway neu starten; der aktuelle Konnektor verbindet sich erneut. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

Der SDK/stdio-Test behält Konnektor und MCP-Verbindung bei und findet nach Gateway-Neustart einen neuen Alias mit erfolgreichem Echo; produktbezogene Gesprächsoberflächen wurden nicht getestet. Kein automatisches Hot Reload; Konflikte prüfen. Erstregistrierung oder Runtime-Upgrade können Client-Neustart erfordern. Unterbrochene Aufrufe werden nicht wiederholt; exklusive Reservierungen nach Neustart erneut anfordern.

Dies ist keine Plattform für unternehmensweite API-Governance.

Das Gateway zeigt dem Agenten stets 6 Tools: 4 zum Finden und Aufrufen von Funktionen und 2 für Integrationen mit exklusivem Workflow. Weitere Verbindungen vergrößern diese Anfangsschnittstelle nicht; das vollständige Schema wird nur für das gewählte Tool geladen. Bereits konfigurierte und authentifizierte Verbindungen werden wiederverwendet, ohne Dienste zu installieren oder Zugangsdaten bereitzustellen.

```text
Agent A ─┐                          ┌─ Integration A: mehrere Tools
Agent B ─┼─ Konnektor ─ MCPGateway ─┼─ Integration B: mehrere Tools
Agent C ─┘                          └─ Integration C: mehrere Tools
```

Mehrere Agenten greifen über denselben Konnektor auf MCPGateway zu; ausgewählte konfigurierte Backends werden bei Bedarf verbunden. Die Skizze erklärt den gemeinsamen Zugriff, ist weder Benchmark noch Laufzeitnachweis und bedeutet nicht, dass alle Backends gestartet werden.

<a id="clients"></a>
## Installation und Upgrade nach Client

> Dies ist eine lokalisierte Übersicht. Die englische [README](../../README.md) und der unten verlinkte englische Client-Leitfaden sind die maßgeblichen Quellen für vollständige Installation, Upgrades und technische Details.

<details>
<summary>Installation und Upgrade nach Client</summary>

Ein gemeinsamer MCP-Katalog kann mehreren Agenten dienen. Beginnen Sie beispielsweise mit **10** Verbindungen in Copilot und migrieren Sie ausdrücklich eine unterstützte Claude-Konfiguration mit **2** neuen Verbindungen: Beide Agenten können dann dieselben **12** nutzen.

- Die Plugin-Installation allein führt die Konfigurationen nicht zusammen. Gleichnamige Einträge werden nur bei identischen Aliasdefinitionen dedupliziert; derselbe Zieldienst genügt nicht. Konflikte stoppen den Vorgang zur Prüfung.
- Die Migration zeigt zuerst eine Vorschau, erstellt eine Sicherung und weist nicht unterstützte native Einstellungen zurück.
- Dies bedeutet nicht, dass jeder native Client durchgängig getestet wurde. Siehe [Migrationsleitfaden (Englisch)](../CLIENTS.md#cross-client-migration).

| Client | Installation | Upgrade  Erforderliche Ersteinrichtung | Prüfumfang |
|---|---|------|---|
| GitHub Copilot CLI | [Installieren](../CLIENTS.md#copilot-cli-install) | [Aktualisieren](../CLIENTS.md#copilot-cli-upgrade)  [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Marketplace-/Einrichtungsweg; isoliertes Parsing](../CLIENTS.md#compatibility-summary) |
| VS Code (Editor) | [Installieren](../CLIENTS.md#vs-code-install) | [Aktualisieren](../CLIENTS.md#vs-code-upgrade)  [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Registrierungs-/Formatadapter getestet; keine native Ende-zu-Ende-Sitzung](../CLIENTS.md#compatibility-summary) |
| Claude Code | [Installieren](../CLIENTS.md#claude-code-install) | [Aktualisieren](../CLIENTS.md#claude-code-upgrade)  [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Isolierte Konfiguration geparst; kein Modell/Backend](../CLIENTS.md#compatibility-summary) |
| Codex CLI | [Installieren](../CLIENTS.md#codex-install) | [Aktualisieren](../CLIENTS.md#codex-upgrade)  [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Native Prüfung durch Richtlinie blockiert](../CLIENTS.md#compatibility-summary) |
| OpenCode | [Installieren](../CLIENTS.md#opencode-install) | [Aktualisieren](../CLIENTS.md#opencode-upgrade)  [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Registrierungs-/Formatadapter getestet; keine native Ende-zu-Ende-Sitzung](../CLIENTS.md#compatibility-summary) |
| Qwen Code | [Installieren](../CLIENTS.md#qwen-code-install) | [Aktualisieren](../CLIENTS.md#qwen-code-upgrade)  [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Registrierungs-/Formatadapter getestet; keine native Ende-zu-Ende-Sitzung](../CLIENTS.md#compatibility-summary) |
| Kimi CLI | [Installieren](../CLIENTS.md#kimi-cli-install) | [Aktualisieren](../CLIENTS.md#kimi-cli-upgrade)  [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Registrierungs-/Formatadapter getestet; keine native Ende-zu-Ende-Sitzung](../CLIENTS.md#compatibility-summary) |
| Antigravity CLI | [Installieren](../CLIENTS.md#antigravity-cli-install) | [Aktualisieren](../CLIENTS.md#antigravity-cli-upgrade)  [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Registrierungs-/Formatadapter getestet; keine native Ende-zu-Ende-Sitzung](../CLIENTS.md#compatibility-summary) |

</details>

**Betriebsreferenz (Englisch):** [Betriebsreferenz öffnen](../REFERENCE.md)

**Lizenz:** [MIT](../../LICENSE)
