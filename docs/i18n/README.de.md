# Shared MCP Gateway

[English](../../README.md)

> Dies ist eine lokalisierte Übersicht. Die englische [README](../../README.md) und der unten verlinkte englische Client-Leitfaden sind die maßgeblichen Quellen für vollständige Installation, Upgrades und technische Details.

## RAM sparen. Kontext für die Arbeit bewahren. Tools bei Bedarf.

**Mehr Agenten sollten mehr erledigte Arbeit bedeuten – nicht mehr Kopien derselben MCP-Konfiguration.**

### 5 Agenten. 12 MCP-Verbindungen. Eine gemeinsame Konfiguration.

*Beispiel: Die **12** Verbindungen stellen **1,000** Tools bereit, und jede unabhängige Konfiguration verwendet **1.5 GB** lokalen Prozess-RAM.*

| Vorteil | Eigene Konfiguration pro Agent | Mit MCPGateway |
|---|---|---|
| **RAM sparen** | **7.5 GB** für fünf unabhängige MCP-Konfigurationen. | **1.5 GB gemeinsam**, zuzüglich Gateway-/Connector-Overhead. **6 GB doppelter Speicher vermieden.** |
| **Kontext bewahren. Tools bei Bedarf.** | Jeder Agent lädt **1,000 Tooldefinitionen** vorab; mit weiteren MCP-Verbindungen kann die Zahl steigen. | Vorab nur **6 Gateway-Tools – 99.4% weniger Definitionen**. Alle **1,000** Tools bleiben verfügbar; jeder Agent entdeckt und lädt nur das Benötigte. Weitere Verbindungen erfordern nicht, dass jeder Agent deren vollständige Kataloge vorab lädt. |

**Agenten und MCP-Verbindungen behalten. Nicht mehr jede Sitzung ihre eigene Kopie tragen lassen.**

*Die RAM-Werte sind Beispiele und keine gemessenen Einsparungen; der Speicher der Agenten kommt hinzu. Definitionszahlen sind keine Token-Einsparungen. Clients mit bereits verzögertem Laden können einen kleineren Kontextvorteil sehen. Gemeinsame Nutzung vergrößert weder das Kontextfenster noch macht sie den gesamten RAM-Verbrauch konstant.*

## Funktionsweise

Das Gateway zeigt dem Agenten stets 6 Tools: 4 zum Finden und Aufrufen von Funktionen und 2 für Integrationen mit exklusivem Workflow. Weitere Verbindungen vergrößern diese Anfangsschnittstelle nicht; das vollständige Schema wird nur für das gewählte Tool geladen. Bereits konfigurierte und authentifizierte Verbindungen werden wiederverwendet, ohne Dienste zu installieren oder Zugangsdaten bereitzustellen.

Ein gemeinsamer MCP-Katalog kann mehreren Agenten dienen: Beginnen Sie mit **10** Verbindungen in Copilot und migrieren Sie anschließend ausdrücklich eine unterstützte Claude-Konfiguration mit **2** neuen Verbindungen, damit beide Agenten dieselben **12** nutzen können; die reine Plugin-Installation führt sie nicht automatisch zusammen. Gleichnamige Einträge werden nur bei identischen Aliasdefinitionen dedupliziert, nicht bloß weil sie auf denselben Dienst verweisen; Konflikte stoppen den Vorgang zur Prüfung. Die Migration zeigt zuerst eine Vorschau, erstellt eine Sicherung und weist nicht unterstützte native Einstellungen zurück; dies ist außerdem keine Behauptung, dass jeder native Client durchgängig getestet wurde, siehe [Migrationsleitfaden (Englisch)](../CLIENTS.md#cross-client-migration).

**Voraussetzungen:** Node.js 24 oder neuer, npm, Git und Copilot CLI mit Plugin-Unterstützung für die aktuelle Einrichtung. Agency ist optional.

## Installation und Upgrade nach Client

Die gemeinsame Runtime wird derzeit über Copilot CLI erstellt; andere Clients verbinden sich mit demselben stabilen Connector. Die Links führen zum englischen Client-Leitfaden, der maßgeblichen Quelle für Installation und Upgrade.

| Client | Installation | Upgrade |
|---|---|---|
| GitHub Copilot CLI | [Installieren](../CLIENTS.md#copilot-cli-install) | [Aktualisieren](../CLIENTS.md#copilot-cli-upgrade) |
| VS Code (Editor) | [Installieren](../CLIENTS.md#vs-code-install) | [Aktualisieren](../CLIENTS.md#vs-code-upgrade) |
| Claude Code | [Installieren](../CLIENTS.md#claude-code-install) | [Aktualisieren](../CLIENTS.md#claude-code-upgrade) |
| Codex CLI | [Installieren](../CLIENTS.md#codex-install) | [Aktualisieren](../CLIENTS.md#codex-upgrade) |
| OpenCode | [Installieren](../CLIENTS.md#opencode-install) | [Aktualisieren](../CLIENTS.md#opencode-upgrade) |
| Qwen Code | [Installieren](../CLIENTS.md#qwen-code-install) | [Aktualisieren](../CLIENTS.md#qwen-code-upgrade) |
| Kimi CLI | [Installieren](../CLIENTS.md#kimi-cli-install) | [Aktualisieren](../CLIENTS.md#kimi-cli-upgrade) |
| Antigravity CLI | [Installieren](../CLIENTS.md#antigravity-cli-install) | [Aktualisieren](../CLIENTS.md#antigravity-cli-upgrade) |

Die Einrichtung zeigt vor jeder Änderung eine Vorschau. Nach Freigabe erstellt sie private Sicherungen und liefert Bereitschaftsprüfungen sowie genaue Rollback-Befehle. Konfiguration und Sicherungen können Zugangsdaten enthalten; nicht veröffentlichen oder in die Versionsverwaltung übernehmen.

**Betriebsreferenz (Englisch):** [Betriebsreferenz öffnen](../REFERENCE.md)

**Lizenz:** [MIT](../../LICENSE)
