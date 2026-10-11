# MCPGateway — Partagez des backends MCP locaux entre sessions de programmation

<a id="languages"></a>
<details>
<summary>Languages (16)</summary>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [العربية](README.ar.md) · [हिन्दी](README.hi.md) · [Bahasa Indonesia](README.id.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md)

</details>

Plusieurs sessions, un ensemble de backends : évitez les copies en mémoire et les démarrages répétés. Le parcours SDK/stdio vérifié conserve la connexion MCP existante lors d’ajouts de configuration (connexion existante de votre agent à la passerelle).

[Commencer](#first-use) · [Compatibilité (anglais)](../CLIENTS.md#compatibility-summary) · [Preuves et limites (anglais)](../BENCHMARK.md) · [Mises à jour de Copilot](../CLIENTS.md#copilot-cli-upgrade)

<img src="../../assets/mcp-gateway-benefits.png" alt="Les copies de backends deviennent un ensemble partagé ; les démarrages sont réutilisés ; dans l’expérience SDK/stdio, la connexion MCP existante survit au redémarrage de la passerelle sous votre autorité après la fin des travaux." width="780">

Illustration conceptuelle avec des libellés anglais, pas une capture d’écran ni un benchmark. [SVG](../../assets/mcp-gateway-benefits.svg)

- **Évitez de dupliquer la mémoire des backends:** Avec l’hypothèse de 5 × 1.5 GB réunis en un ensemble partagé, 6 GB de duplication sont évités **avant** le surcoût de la passerelle et des connecteurs. Ce n’est pas une économie nette mesurée.
- **Réutilisez les démarrages des backends:** Si les cinq sessions utilisent les douze services stdio, les démarrages passent de 60 → 12. Cela ne signifie pas un démarrage 80% plus rapide.
- **Gardez la connexion MCP existante:** L’expérience SDK/stdio a conservé la connexion après des ajouts de configuration seulement, puis un redémarrage de la passerelle sous votre autorité une fois les travaux terminés. Ce n’est ni un rechargement à chaud, ni la continuité des appels actifs, ni une preuve pour toutes les interfaces natives. L’enregistrement initial et les mises à niveau du runtime peuvent imposer un redémarrage du client. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

<a id="resource-examples"></a>
**Quand choisir ou éviter:** Utile pour plusieurs sessions partageant le même connecteur et catalogue. MCP direct peut être plus simple pour une session ou des backends légers. Le test léger a augmenté le working set cumulé des processus de 357.0 → 564.0 MiB ; la première requête partagée, du lancement d’une nouvelle passerelle au premier résultat utile, a pris 1886.7 ms contre 503.5 ms en direct. Le gain net dépend du surcoût. [BENCHMARK](../BENCHMARK.md#sharing-model-and-evidence)

<a id="first-use"></a>
## Premier résultat utile : une lecture autorisée via la passerelle

Il faut Node.js 24+, npm, Git, Copilot CLI avec plugins et des intégrations MCP déjà configurées et authentifiées. L’installation initiale passe par Copilot CLI ; Windows est la principale plateforme testée. La vérification varie selon le client. [Copilot `/help` · `/plugin`](../CLIENTS.md#copilot-plugin-eligibility).

**Avant l’installation:** Configuration, catalogue privé et sauvegardes peuvent contenir des identifiants : ne les publiez pas. Les backends peuvent contacter des services distants. Un runtime persistant est installé ; restaurer la configuration ou retirer le plugin n’arrête pas la passerelle. [REFERENCE](../REFERENCE.md#planned-exit) L’état privé local et les jetons enregistrés de la passerelle sont accessibles au seul propriétaire, sans chiffrement supplémentaire.

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Ouvrez Copilot CLI et lancez `/mcp-gateway-setup`. Examinez l’aperçu et approuvez seulement les changements souhaités. Gardez les sauvegardes privées et les commandes de restauration. Le plugin seul ne fusionne pas les configurations.
2. Fermez puis rouvrez Copilot ; exécutez le `readinessCommand` exact reçu selon les instructions de l’objet de commande. Une vérification ne démarre pas une passerelle absente. [readinessCommand](../REFERENCE.md#readiness-command-object) Enregistrez uniquement l’objet JSON retourné ; `.command` est l’exécutable approuvé et `.args` ses arguments exacts dans l’ordre.
3. Choisissez une lecture inoffensive et autorisée dans une intégration existante. Remplacez seulement la tâche entre crochets ; obtenez alias, outils et arguments par découverte et schéma, sans les inventer.

> Utilisez la passerelle pour [ma lecture autorisée]. Lancez `list_servers`, une recherche ciblée avec `search_tools`, puis `get_tool_schema` ; préparez des arguments conformes avec des valeurs de test autorisées et non sensibles. Obtenez les approbations normales. Si `requiresExclusiveAccess: true`, utilisez une fois `claim_server` avant `call_tool`, puis `release_server` après la fin de tous les appels ; aucune réservation pour les backends non exclusifs. Montrez le résultat réel ou un résultat vide documenté et vérifiez les erreurs, pas seulement la réponse de la passerelle. Si le résultat est inconnu, ne réessayez pas : maintenez le blocage et transmettez en privé au responsable de l’installation.

4. Dans une deuxième session avec le même connecteur et catalogue, cherchez le même alias : attendez `ready` et les mêmes capacités. Cela vérifie la découverte partagée, pas l’identité du processus ou des économies de RAM. [MCP](../REFERENCE.md#first-shared-workflow) [Exemple public echo et résultat](../REFERENCE.md#public-echo-illustration).

**En cas d’échec:** Catalogue vide : examinez configuration et aperçu ; recherchez les termes des descriptions du backend. Suivez la référence pour l’authentification ou la disponibilité, sans processus parallèle de contournement. Libérer ou déconnecter n’annule ni ne débloque sûrement un résultat exclusif inconnu. Réconciliez le résultat, coordonnez le redémarrage de la passerelle sous votre autorité et réservez à nouveau. [Authentication](../REFERENCE.md#native-http-oauth) · [Recovery](../REFERENCE.md#setup-recovery) · [Unknown outcome](../REFERENCE.md#unknown-exclusive-result)

**Cesser l’utilisation:** Terminez les travaux et appels, restaurez ou retirez les connecteurs des clients concernés, puis suivez la coordination avec l’opérateur responsable pour vérifier l’arrêt de la passerelle sous votre autorité. Restaurer la configuration n’arrête pas le processus. Conservez état privé, identifiants, historique et processus sans rapport. [Exit](../REFERENCE.md#planned-exit)

<a id="clients"></a>
Ceci est une présentation localisée. Méthodes, provenance des chiffres et détails opérationnels sont dans les guides anglais. La prise en charge native des clients ne certifie pas la compréhension humaine de cette traduction. [CLIENTS](../CLIENTS.md) · [REFERENCE](../REFERENCE.md) · [BENCHMARK](../BENCHMARK.md)

MIT — [LICENSE](../../LICENSE).
