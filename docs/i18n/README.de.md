# MCPGateway — Lokale MCP-Server zwischen KI-Programmiersitzungen gemeinsam nutzen

[English](../../README.md)

> Dies ist eine lokalisierte Übersicht. Die englische [README](../../README.md) und der unten verlinkte englische Client-Leitfaden sind die maßgeblichen Quellen für vollständige Installation, Upgrades und technische Details.

## Backends wiederverwenden und Tools bei Bedarf finden.

Mehrere Copilot-CLI-Sitzungen müssen nicht jeweils denselben MCP-Backendprozess starten. Teilen Sie bereits konfigurierte lokale Dienste und koordinieren Sie exklusive Workflows. Dies ist keine Plattform für unternehmensweite API-Governance.

**Voraussetzungen:** Node.js 24 oder neuer, npm, Git, Copilot CLI mit Plugin-Unterstützung sowie konfigurierte und authentifizierte MCP-Dienste. Die Ersteinrichtung erfolgt derzeit über Copilot CLI. Windows ist die hauptsächlich getestete Plattform; Agency ist optional. Kompatibilität und Prüftiefe unterscheiden sich je nach Client.

## Funktionsweise

Das Gateway zeigt dem Agenten stets 6 Tools: 4 zum Finden und Aufrufen von Funktionen und 2 für Integrationen mit exklusivem Workflow. Weitere Verbindungen vergrößern diese Anfangsschnittstelle nicht; das vollständige Schema wird nur für das gewählte Tool geladen. Bereits konfigurierte und authentifizierte Verbindungen werden wiederverwendet, ohne Dienste zu installieren oder Zugangsdaten bereitzustellen.

Ein gemeinsamer MCP-Katalog kann mehreren Agenten dienen. Beginnen Sie beispielsweise mit **10** Verbindungen in Copilot und migrieren Sie ausdrücklich eine unterstützte Claude-Konfiguration mit **2** neuen Verbindungen: Beide Agenten können dann dieselben **12** nutzen.

- Die Plugin-Installation allein führt die Konfigurationen nicht zusammen. Gleichnamige Einträge werden nur bei identischen Aliasdefinitionen dedupliziert; derselbe Zieldienst genügt nicht. Konflikte stoppen den Vorgang zur Prüfung.
- Die Migration zeigt zuerst eine Vorschau, erstellt eine Sicherung und weist nicht unterstützte native Einstellungen zurück.
- Dies bedeutet nicht, dass jeder native Client durchgängig getestet wurde. Siehe [Migrationsleitfaden (Englisch)](../CLIENTS.md#cross-client-migration).

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

## Erste Einrichtung und erster Aufruf

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Starten Sie nach der Plugin-Installation Copilot CLI und rufen Sie `/mcp-gateway-setup` auf. Prüfen Sie die Vorschau und genehmigen Sie nur die gewünschten Änderungen. Schließen und öffnen Sie Copilot erneut und führen Sie den exakt zurückgegebenen `readinessCommand` aus. Bewahren Sie Sicherungs- und Rollback-Befehle auf. Die Plugin-Installation allein führt keine Konfigurationen zusammen.
2. Rufen Sie `list_servers` mit `{}` auf: Es sollten die vorhandenen Aliase, Zustände und Exklusivitätskennzeichen erscheinen. Wählen Sie ein autorisiertes Backend, suchen Sie mit `search_tools` nach einem passenden Aufgabenbegriff und holen Sie mit `get_tool_schema` das Schema des ausgewählten Tools. Erstellen Sie schema-konforme Argumente und führen Sie mit `call_tool` einen genehmigten Lesezugriff aus. Prüfen Sie den erwarteten Datensatz oder ein dokumentiertes leeres Ergebnis; eine Gateway-Antwort allein beweist keinen erfolgreichen Lesezugriff.
3. Bei `requiresExclusiveAccess: true` verwenden Sie vor der Suche `claim_server` und nach Abschluss aller Aufrufe `release_server`. Nicht exklusive Backends benötigen keine Reservierung. Bei einem Timeout mit unbekanntem Ergebnis nicht erneut aufrufen: aktive Arbeit prüfen und den Neustart koordinieren.

[Vollständiges englisches Beispiel](../../README.md#first-use) · [Kompatibilität und Grenzen](../CLIENTS.md#compatibility-summary)

## Grenzen, Datenschutz und Wiederherstellung

Das Auffinden dieses Repositories über Claude Code, Codex, Gemini CLI, Kimi oder Qwen CLI garantiert keine native Integration. Für Gemini CLI ist hier kein Installationsweg dokumentiert; Antigravity ist ein anderer Client. Kimi ist nur auf Adapterebene getestet. Konfigurationen und Sicherungen können Zugangsdaten enthalten; nicht veröffentlichen. Backends können entfernte Dienste kontaktieren. Gemeinsame Nutzung bedeutet weder Offline-Betrieb noch feste RAM- oder Token-Einsparungen.

[Datenschutz](../REFERENCE.md#state-and-privacy) · [Wiederherstellung und Rollback](../REFERENCE.md#setup-recovery)

**Betriebsreferenz (Englisch):** [Betriebsreferenz öffnen](../REFERENCE.md)

**Lizenz:** [MIT](../../LICENSE)
