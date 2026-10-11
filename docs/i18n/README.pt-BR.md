# MCPGateway — Compartilhe backends MCP locais entre sessões de programação

<a id="languages"></a>
<details>
<summary>Languages (16)</summary>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [العربية](README.ar.md) · [हिन्दी](README.hi.md) · [Bahasa Indonesia](README.id.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md)

</details>

Várias sessões, um conjunto de backends: evite memória duplicada e inicializações repetidas. A rota SDK/stdio verificada mantém a conexão MCP existente ao adicionar configuração (conexão existente do seu agente ao gateway).

[Começar](#first-use) · [Compatibilidade (inglês)](../CLIENTS.md#compatibility-summary) · [Evidências e limites (inglês)](../BENCHMARK.md) · [Atualizações do Copilot](../CLIENTS.md#copilot-cli-upgrade)

<img src="../../assets/mcp-gateway-benefits.png" alt="Cópias de backends viram um conjunto compartilhado; inicializações são reutilizadas; no experimento SDK/stdio, a conexão MCP existente permanece após reiniciar o gateway sob sua autoridade com o trabalho concluído." width="780">

Ilustração conceitual com rótulos em inglês, não uma captura de tela ou benchmark. [SVG](../../assets/mcp-gateway-benefits.svg)

- **Evite duplicar a memória dos backends:** Na hipótese de compartilhar 5 × 1.5 GB em um conjunto, evitam-se 6 GB de duplicação **antes** da sobrecarga do gateway e dos conectores. Não é economia líquida medida.
- **Reutilize o trabalho de inicialização:** Se as cinco sessões usam os doze serviços stdio, as inicializações passam de 60 → 12. Não significa iniciar 80% mais rápido.
- **Mantenha a conexão MCP existente:** O experimento SDK/stdio manteve a conexão após apenas adicionar configuração e reiniciar o gateway sob sua autoridade depois de concluir o trabalho. Não demonstra hot reload, continuidade de chamadas ativas nem a preservação da conexão em todas as interfaces nativas de conversa. Registro inicial e upgrades do runtime podem exigir reiniciar o cliente. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

<a id="resource-examples"></a>
**Quando usar ou dispensar:** Para várias sessões com o mesmo conector e catálogo. MCP direto pode ser mais simples para uma sessão ou backends leves. O teste leve aumentou o working set somado dos processos de 357.0 → 564.0 MiB; a primeira solicitação compartilhada, da inicialização de um gateway novo ao primeiro resultado útil, levou 1886.7 ms contra 503.5 ms direto. O ganho líquido depende da sobrecarga. [BENCHMARK](../BENCHMARK.md#sharing-model-and-evidence)

<a id="first-use"></a>
## Primeiro resultado útil: uma leitura autorizada pelo gateway

Requer Node.js 24+, npm, Git, Copilot CLI com plugins e integrações MCP já configuradas e autenticadas. A instalação inicial passa pelo Copilot CLI; Windows é a principal plataforma testada. A verificação varia entre clientes. [Copilot `/help` · `/plugin`](../CLIENTS.md#copilot-plugin-eligibility).

**Antes de instalar:** Configuração, catálogo privado e backups podem conter credenciais: não publique. Backends podem acessar serviços remotos. Um runtime persistente é instalado; restaurar configuração ou remover o plugin não encerra o gateway. [REFERENCE](../REFERENCE.md#planned-exit) O estado privado local e os tokens salvos do gateway têm acesso restrito ao proprietário, sem criptografia adicional.

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Abra o Copilot CLI e execute `/mcp-gateway-setup`. Revise a prévia e aprove apenas as alterações desejadas. Guarde backups privados e comandos de reversão. O plugin sozinho não mescla configurações.
2. Feche e reabra o Copilot; execute o `readinessCommand` exato retornado seguindo a explicação do objeto de comando. Uma verificação não inicia um gateway ausente. [readinessCommand](../REFERENCE.md#readiness-command-object) Salve apenas o objeto JSON retornado; `.command` é o executável aprovado e `.args` contém os argumentos exatos na ordem original.
3. Escolha uma leitura inofensiva e autorizada em uma integração existente. Substitua apenas a tarefa entre colchetes; obtenha aliases, ferramentas e argumentos pela descoberta e pelo esquema, sem inventá-los.

> Use o gateway para [minha leitura autorizada]. Execute `list_servers`, uma busca focada com `search_tools` e `get_tool_schema`; prepare argumentos válidos com valores de teste autorizados e não sensíveis. Obtenha as aprovações normais. Se `requiresExclusiveAccess: true`, use `claim_server` uma vez antes de `call_tool` e `release_server` após todas as chamadas terminarem; backends não exclusivos dispensam reserva. Mostre o registro real ou um resultado vazio documentado e confira erros, não apenas a resposta do gateway. Se o resultado for desconhecido, não repita: mantenha o bloqueio e encaminhe em privado ao responsável pela instalação.

4. Em outra sessão com o mesmo conector e catálogo, consulte o mesmo alias: espere `ready` e as mesmas capacidades. Isso verifica descoberta compartilhada, não identidade do processo ou economia de RAM. [MCP](../REFERENCE.md#first-shared-workflow) [Exemplo público de echo e resultado](../REFERENCE.md#public-echo-illustration).

**Se falhar:** Catálogo vazio: confira configuração e prévia; pesquise termos das descrições do backend. Siga a referência para autenticação ou prontidão, sem processo paralelo de contorno. Liberar ou desconectar não cancela nem desbloqueia com segurança um resultado exclusivo desconhecido. Confira o resultado, coordene o reinício do gateway sob sua autoridade e reserve novamente. [Authentication](../REFERENCE.md#native-http-oauth) · [Recovery](../REFERENCE.md#setup-recovery) · [Unknown outcome](../REFERENCE.md#unknown-exclusive-result)

**Parar de usar:** Conclua trabalhos e chamadas, restaure ou remova os conectores dos clientes afetados e siga a coordenação com o operador responsável para confirmar que o gateway sob sua autoridade parou. Reverter configuração não encerra o processo. Preserve estado privado, credenciais, histórico e processos alheios. [Exit](../REFERENCE.md#planned-exit)

<a id="clients"></a>
Este é um resumo localizado. Métodos, origem dos números e detalhes operacionais estão nos guias em inglês. Suporte nativo a clientes não certifica compreensão humana desta tradução. [CLIENTS](../CLIENTS.md) · [REFERENCE](../REFERENCE.md) · [BENCHMARK](../BENCHMARK.md)

MIT — [LICENSE](../../LICENSE).
