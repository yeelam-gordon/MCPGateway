# MCPGateway — Partagez des serveurs MCP locaux entre sessions d'agents de programmation

[English](../../README.md)

> Ceci est une présentation localisée. Le [README](../../README.md) anglais et le guide client anglais lié ci-dessous restent les références pour l'installation complète, les mises à niveau et les détails techniques.

## Réutilisez les backends et découvrez les outils à la demande.

Plusieurs sessions Copilot CLI n'ont pas besoin de démarrer chacune une copie du même backend MCP. Partagez les services locaux déjà configurés et coordonnez les workflows exclusifs ; ce n'est pas une plateforme de gouvernance des API d'entreprise.

**Prérequis :** Node.js 24 ou ultérieur, npm, Git, Copilot CLI avec plugins et services MCP déjà configurés et authentifiés. L'installation initiale passe actuellement par Copilot CLI ; Windows est la principale plateforme testée et Agency est facultatif. La compatibilité et le niveau de vérification diffèrent selon les clients.

## Fonctionnement

La passerelle présente toujours 6 outils à l'agent : 4 pour découvrir et appeler des fonctions, et 2 pour les intégrations nécessitant un workflow exclusif. L'ajout de connexions n'agrandit pas cette interface initiale ; le schéma complet n'est chargé que pour l'outil choisi. Les connexions déjà configurées et authentifiées sont réutilisées, sans installer de services ni fournir d'identifiants.

Un même catalogue MCP peut servir plusieurs agents. Par exemple, partez de **10** connexions dans Copilot et migrez explicitement une configuration Claude prise en charge contenant **2** nouvelles connexions : les deux agents pourront utiliser les mêmes **12**.

- L’installation du plugin seule ne fusionne pas les configurations. Les entrées de même nom ne sont dédupliquées que si leurs définitions d’alias sont identiques ; pointer vers le même service ne suffit pas. Les conflits arrêtent le processus pour examen.
- La migration commence par un aperçu, crée une sauvegarde et refuse les réglages natifs non pris en charge.
- Cela ne signifie pas que tous les clients natifs ont été testés de bout en bout. Consultez le [guide de migration (anglais)](../CLIENTS.md#cross-client-migration).

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

## Première configuration et premier appel

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Après l'installation du plugin, lancez Copilot CLI et invoquez `/mcp-gateway-setup`. Examinez l'aperçu avant d'approuver les changements souhaités. Fermez puis rouvrez Copilot et exécutez le `readinessCommand` exact fourni. Conservez les commandes de sauvegarde et de restauration. Installer le plugin seul ne fusionne pas les configurations.
2. Appelez `list_servers` avec `{}` : les alias, états et indicateurs d'exclusivité des services existants doivent apparaître. Choisissez un backend autorisé, recherchez un terme de votre tâche avec `search_tools`, puis obtenez le schéma de l'outil avec `get_tool_schema`. Construisez les arguments selon ce schéma et effectuez une lecture approuvée avec `call_tool`. Vérifiez l'enregistrement attendu ou un résultat vide documenté ; une réponse de la passerelle ne suffit pas à prouver la réussite de la lecture.
3. Si `requiresExclusiveAccess: true`, utilisez `claim_server` avant la recherche et `release_server` une fois tous les appels terminés. Les backends non exclusifs n'ont pas besoin de réservation. En cas de délai dépassé avec un résultat inconnu, ne réessayez pas : examinez le travail actif et coordonnez le redémarrage. Si le résultat est inconnu, le backend exclusif reste bloqué jusqu’au redémarrage de la passerelle ; libérer la réservation ou déconnecter le client ne permet pas de le débloquer en toute sécurité, et une déconnexion n’annule pas l’opération.

[Exemple complet en anglais](../../README.md#first-use) · [Compatibilité et limites](../CLIENTS.md#compatibility-summary)

## Limites, confidentialité et restauration

Trouver ce dépôt depuis Claude Code, Codex, Gemini CLI, Kimi ou Qwen CLI ne garantit pas une intégration native. Aucun parcours d'installation de Gemini CLI n'est documenté ici ; Antigravity est un autre client. Kimi n'a été testé qu'au niveau de l'adaptateur. Les configurations et sauvegardes peuvent contenir des identifiants : ne les publiez pas. Les backends peuvent contacter des services distants ; le partage ne signifie pas un fonctionnement hors ligne ni des économies fixes de RAM ou de jetons.

Avant de cesser l’utilisation, terminez les workflows actifs et attendez la fin des appels. Restaurer la configuration du client n’arrête pas le runtime persistant. Suivez la [procédure de sortie et de remise à l’opérateur (anglais)](../REFERENCE.md#planned-exit) et vérifiez l’état final ; conservez les données privées et les identifiants, sans arrêter de processus sans rapport.

[Confidentialité](../REFERENCE.md#state-and-privacy) · [Restauration et retour arrière](../REFERENCE.md#setup-recovery)

**Référence opérationnelle (anglais) :** [Consulter la référence opérationnelle](../REFERENCE.md)

**Licence :** [MIT](../../LICENSE)
