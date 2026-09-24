# Démarrage rapide de Shared MCP Gateway

[English](../../README.md)

> Ceci est un guide de démarrage localisé. Le [README](../../README.md) anglais reste la source de référence pour les usages avancés et les informations techniques les plus récentes.

## Une passerelle pour vos backends MCP existants

Shared MCP Gateway permet à Copilot de charger d'abord une interface fixe de **6 outils de passerelle**, puis de rechercher et d'appeler à la demande les outils des backends que vous avez déjà configurés. Même avec environ **1 000 outils** dans le catalogue, toutes leurs définitions ne doivent pas être exposées au client dès le départ.

Le catalogue et les connexions aux backends sont réutilisés entre plusieurs sessions Copilot CLI, ce qui limite le démarrage répété de serveurs locaux. La passerelle n'installe pas les serveurs MCP et ne fournit pas leurs identifiants : conservez votre méthode habituelle de configuration et d'authentification.

Les 6 outils comprennent 4 outils de découverte/exécution et 2 outils génériques de réservation de serveur. Une réservation convient à tout backend qui exige un état de workflow exclusif ; elle n'est pas réservée à l'automatisation du navigateur.

## Prérequis

- Node.js 24 ou version ultérieure, npm et Git
- Copilot CLI avec prise en charge des plugins
- Une configuration MCP Copilot existante et l'authentification requise par vos backends
- Agency est facultatif et n'est pas nécessaire pour un usage normal de Copilot CLI

## Installation

Exécutez ces commandes dans le **terminal**, pas dans la conversation Copilot :

```text
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

Lancez ensuite Copilot et exécutez dans Copilot :

```text
/mcp-gateway-setup
```

L'installation du plugin seule ne migre pas la configuration MCP. L'assistant affiche d'abord un aperçu ; après approbation, il sauvegarde la configuration, place les définitions des backends dans un dossier privé et remplace la configuration du client par le connecteur de la passerelle partagée.

Conservez le chemin de sauvegarde et la commande de restauration exacte affichés. Le catalogue et les sauvegardes peuvent contenir des identifiants : ne les publiez pas et ne les ajoutez pas au contrôle de version.

Une fois l'opération terminée, fermez puis rouvrez Copilot. La passerelle démarre automatiquement lors de la première utilisation du connecteur ; aucun terminal distinct ne doit rester ouvert.

## Fonctionnement

1. `list_servers` liste les alias configurés sans démarrer tous les backends.
2. `search_tools` recherche les résumés d'outils pertinents dans un backend donné.
3. `get_tool_schema` récupère uniquement le schéma d'entrée complet de l'outil choisi.
4. `call_tool` valide les arguments et la liste d'autorisation avant d'appeler l'outil.
5. `claim_server` et `release_server` protègent l'ensemble du workflow d'un serveur nécessitant un accès exclusif, puis libèrent la réservation après la fin des appels actifs.

Le client MCP, la passerelle et le serveur MCP ont des rôles distincts, mais la maîtrise du protocole n'est pas nécessaire au quotidien : configurez vos backends comme auparavant et laissez Copilot les découvrir et les appeler via la passerelle.

## Mise à jour et restauration

Après la mise à jour du plugin, exécutez `/mcp-gateway-setup` pour adopter explicitement le nouveau runtime. Attendez la fin des appels actifs, appliquez la mise à jour et rouvrez Copilot ; le téléchargement du plugin ne remplace pas une passerelle déjà en cours d'exécution.

Si la configuration échoue, fermez Copilot et utilisez le chemin de sauvegarde et la commande de restauration exacts affichés. Ne supprimez pas le dossier privé des backends pour tenter une récupération.
Consultez le [README](../../README.md) anglais pour la synchronisation de configuration, l'intégration des clients, les réservations et le dépannage.

**Licence :** [MIT](../../LICENSE)
