# Shared MCP Gateway – Schnellstart

[English](../../README.md)

> Dies ist eine lokalisierte Schnellstartanleitung. Die englische [README](../../README.md) ist die maßgebliche Quelle für fortgeschrittene Nutzung und aktuelle technische Details.

## Ein Gateway für vorhandene MCP-Backends

Mit Shared MCP Gateway lädt Copilot zunächst nur eine feste Oberfläche aus **6 Gateway-Tools**. Werkzeuge aus bereits konfigurierten Backends werden anschließend bei Bedarf gesucht und aufgerufen. Selbst wenn der Backend-Katalog etwa **1.000 Tools** enthält, müssen nicht alle Definitionen von Anfang an an den Client übergeben werden.

Backend-Katalog und Verbindungen werden von mehreren Copilot-CLI-Sitzungen gemeinsam genutzt. Dadurch müssen lokale Server seltener mehrfach gestartet werden. Das Gateway installiert keine MCP-Server und stellt keine Zugangsdaten bereit; konfigurieren und authentifizieren Sie Ihre Server weiterhin auf dem gewohnten Weg.

Die 6 Tools bestehen aus 4 Tools für Suche/Ausführung und 2 allgemeinen Tools für Server-Leases. Ein Lease eignet sich für jedes Backend, das einen exklusiven Workflow-Zustand benötigt, und ist nicht auf Browserautomatisierung beschränkt.

## Voraussetzungen

- Node.js 24 oder neuer, npm und Git
- Copilot CLI mit Plugin-Unterstützung
- Eine vorhandene Copilot-MCP-Konfiguration und die von den Backends benötigte Authentifizierung
- Agency ist optional und für die normale Nutzung der Copilot CLI nicht erforderlich

## Installation

Führen Sie diese Befehle im **Terminal** aus, nicht im Copilot-Chat:

```text
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

Starten Sie danach Copilot und führen Sie innerhalb von Copilot aus:

```text
/mcp-gateway-setup
```

Die Plugin-Installation allein migriert die MCP-Konfiguration nicht. Das Setup zeigt zuerst eine Vorschau. Nach der Freigabe sichert es die vorhandene Konfiguration, speichert die Backend-Definitionen in einem privaten Verzeichnis und stellt die Client-Konfiguration auf den gemeinsamen Gateway-Connector um.

Bewahren Sie den ausgegebenen Sicherungspfad und den genauen Wiederherstellungsbefehl auf. Backend-Katalog und Sicherungen können Zugangsdaten enthalten; veröffentlichen Sie sie nicht und übernehmen Sie sie nicht in die Versionsverwaltung.

Schließen und öffnen Sie Copilot nach Abschluss erneut. Das Gateway startet bei der ersten Verwendung des Connectors automatisch; ein zusätzliches dauerhaft geöffnetes Terminal ist nicht nötig.

## Funktionsweise

1. `list_servers` listet konfigurierte Backend-Aliase auf, ohne alle Backends zu starten.
2. `search_tools` sucht in einem bestimmten Backend nach passenden Tool-Zusammenfassungen.
3. `get_tool_schema` lädt nur das vollständige Eingabeschema des ausgewählten Tools.
4. `call_tool` prüft Argumente und Zulassungsliste und ruft dann das Tool auf.
5. `claim_server` und `release_server` schützen den gesamten Workflow eines Servers mit Exklusivzugriff und geben das Lease frei, nachdem aktive Aufrufe beendet sind.

MCP-Client, Gateway und MCP-Server haben unterschiedliche Rollen. Für die tägliche Nutzung sind jedoch keine Protokolldetails nötig: Konfigurieren Sie Ihre Backends wie bisher und lassen Sie Copilot sie über das Gateway finden und aufrufen.

## Aktualisierung und Wiederherstellung

Führen Sie nach einem Plugin-Update `/mcp-gateway-setup` aus, um die neue Runtime ausdrücklich zu übernehmen. Warten Sie, bis aktive Aufrufe beendet sind, wenden Sie das Update an und öffnen Sie Copilot erneut. Der reine Plugin-Download ersetzt kein laufendes Gateway.

Falls das Setup fehlschlägt, schließen Sie Copilot und verwenden Sie den genau ausgegebenen Sicherungspfad und Wiederherstellungsbefehl. Löschen Sie zur Fehlerbehebung nicht das private Backend-Verzeichnis.
Weitere Informationen zu Konfigurationsabgleich, Client-Integration, Leases und Fehlerbehebung finden Sie in der englischen [README](../../README.md).

**Lizenz:** [MIT](../../LICENSE)
