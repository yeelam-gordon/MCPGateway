# Shared MCP Gateway

[English](../../README.md)

> Ceci est une présentation localisée. Le [README](../../README.md) anglais et le guide client anglais lié ci-dessous restent les références pour l'installation complète, les mises à niveau et les détails techniques.

## Économisez la RAM. Gardez le contexte pour votre travail. Des outils à la demande.

**Davantage d'agents doit permettre d'accomplir davantage de travail, pas de multiplier les copies de la même configuration MCP.**

### 5 agents. 12 connexions MCP. Une configuration partagée.

*Exemple illustratif : ces **12** connexions proposent **1,000** outils et chaque configuration indépendante utilise **1.5 GB** de RAM de processus locaux.*

| Avantage | Configuration distincte par agent | Avec MCPGateway |
|---|---|---|
| **Économisez la RAM** | **7.5 GB** pour cinq configurations MCP indépendantes. | **1.5 GB partagés**, plus le surcoût de la passerelle et des connecteurs. **6 GB de mémoire dupliquée évités.** |
| **Gardez le contexte. Outils à la demande.** | Chaque agent charge d'avance **1,000 définitions d'outils**, et ce nombre peut augmenter avec de nouvelles connexions MCP. | Seulement **6 outils de passerelle au départ, soit 99.4% de définitions en moins**. Les **1,000** outils restent disponibles ; chaque agent ne découvre et ne charge que ce dont il a besoin. Ajoutez des connexions sans charger leurs catalogues complets dans chaque agent. |

**Conservez vos agents et vos connexions MCP. Ne faites plus porter une copie à chaque session.**

*Les chiffres de RAM sont illustratifs et ne constituent pas des économies mesurées ; la mémoire propre aux agents s'ajoute. Le nombre de définitions ne correspond pas à une économie de jetons, et les clients qui reportent déjà le chargement peuvent bénéficier d'un gain de contexte moindre. Le partage n'agrandit pas la fenêtre de contexte et ne rend pas la RAM totale constante.*

## Fonctionnement

La passerelle présente toujours 6 outils à l'agent : 4 pour découvrir et appeler des fonctions, et 2 pour les intégrations nécessitant un workflow exclusif. L'ajout de connexions n'agrandit pas cette interface initiale ; le schéma complet n'est chargé que pour l'outil choisi. Les connexions déjà configurées et authentifiées sont réutilisées, sans installer de services ni fournir d'identifiants.

**Prérequis :** Node.js 24 ou version ultérieure, npm, Git et Copilot CLI avec plugins pour l'amorçage actuel. Agency est facultatif.

## Installation et mise à niveau par client

Le runtime partagé est actuellement créé via Copilot CLI ; les autres clients se connectent au même connecteur stable. Les liens suivants ouvrent le guide client anglais, référence officielle pour l'installation et la mise à niveau.

| Client | Installation | Mise à niveau |
|---|---|---|
| GitHub Copilot CLI | [Installer](../CLIENTS.md#copilot-cli-install) | [Mettre à niveau](../CLIENTS.md#copilot-cli-upgrade) |
| VS Code (éditeur) | [Installer](../CLIENTS.md#vs-code-install) | [Mettre à niveau](../CLIENTS.md#vs-code-upgrade) |
| Claude Code | [Installer](../CLIENTS.md#claude-code-install) | [Mettre à niveau](../CLIENTS.md#claude-code-upgrade) |
| Codex CLI | [Installer](../CLIENTS.md#codex-install) | [Mettre à niveau](../CLIENTS.md#codex-upgrade) |
| OpenCode | [Installer](../CLIENTS.md#opencode-install) | [Mettre à niveau](../CLIENTS.md#opencode-upgrade) |
| Qwen Code | [Installer](../CLIENTS.md#qwen-code-install) | [Mettre à niveau](../CLIENTS.md#qwen-code-upgrade) |
| Kimi CLI | [Installer](../CLIENTS.md#kimi-cli-install) | [Mettre à niveau](../CLIENTS.md#kimi-cli-upgrade) |
| Antigravity CLI | [Installer](../CLIENTS.md#antigravity-cli-install) | [Mettre à niveau](../CLIENTS.md#antigravity-cli-upgrade) |

La configuration affiche un aperçu avant toute modification. Après approbation, elle crée des sauvegardes privées et fournit des contrôles de disponibilité ainsi que des commandes exactes de restauration. La configuration et les sauvegardes peuvent contenir des identifiants : ne les publiez pas et ne les ajoutez pas au contrôle de version.

**Référence opérationnelle (anglais) :** [Consulter la référence opérationnelle](../REFERENCE.md)

**Licence :** [MIT](../../LICENSE)
