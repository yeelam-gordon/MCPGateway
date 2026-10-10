# MCPGateway — Compartilhe servidores MCP locais entre sessões de agentes de programação

Várias sessões do Copilot CLI não precisam iniciar cópias independentes do mesmo backend MCP. Compartilhe serviços locais já configurados e coordene fluxos exclusivos; não é uma plataforma corporativa de governança de APIs.

- Reutilize RAM e trabalho de inicialização de backends pesados, sem uma cópia por sessão.
- Descubra recursos e esquemas sob demanda com 6 ferramentas iniciais.
- Adicione backends mantendo a conexão MCP do agente. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

Adicione backends sem reiniciar a conexão MCP atual do agente: sincronize as adições, conclua o trabalho ativo e reinicie apenas o gateway próprio; o conector atual reconecta. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

Indicado para várias sessões com o mesmo backend e catálogo; uma sessão ou backends leves podem não compensar a sobrecarga.

[Comece: instalação e primeira leitura autorizada](#first-use) · [MCP / Copilot CLI](../CLIENTS.md#shared-core-install) · [6 ferramentas / 2 clientes](../../test/catalog-scale.test.js)

[Evite RAM de backends duplicados](#resource-examples): 5 × 1.5 GB = 7.5 GB → 1.5 GB + sobrecarga do gateway e dos conectores.

<img src="../../assets/mcp-gateway-benefits.png" alt="Reutilize RAM e trabalho de inicialização de backends pesados, sem uma cópia por sessão." width="780">

Conceito com rótulos em inglês, não captura nem benchmark. Supõe 1.5 GB por conjunto: 6 GB é duplicação evitada antes da sobrecarga. O fixture leve medido usou mais RAM total.

<a id="first-use"></a>
## Primeira configuração e chamada

**Pré-requisitos:** Node.js 24 ou mais recente, npm, Git, Copilot CLI com plugins e serviços MCP já configurados e autenticados. A instalação inicial exige Copilot CLI; Windows é a principal plataforma testada e Agency é opcional. A compatibilidade e o nível de verificação variam entre clientes.

Configurações e backups podem conter credenciais: mantenha-os privados e aprove apenas as mudanças pretendidas.

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Após instalar o plugin, abra o Copilot CLI e execute `/mcp-gateway-setup`. Revise a prévia antes de aprovar as alterações desejadas. Feche e reabra o Copilot; execute o `readinessCommand` exato recebido. Guarde os comandos de backup e reversão. Instalar apenas o plugin não mescla configurações.

Descoberta e esquema não exigem reserva; se `requiresExclusiveAccess: true`, use `claim_server` antes de `call_tool`.

2. Chame `list_servers` com `{}`: devem aparecer os aliases, estados e indicadores de exclusividade dos serviços existentes. Escolha um backend autorizado, pesquise um termo da tarefa com `search_tools` e obtenha o esquema da ferramenta com `get_tool_schema`. Monte os argumentos conforme esse esquema e faça uma leitura aprovada com `call_tool`. Confira o registro esperado ou um resultado vazio documentado; uma resposta do gateway não comprova, por si só, o sucesso da leitura.
3. Se `requiresExclusiveAccess: true`, use `claim_server` antes da chamada e `release_server` após todas as chamadas terminarem. Backends não exclusivos dispensam reserva. Se houver timeout com resultado desconhecido, não repita a chamada: revise o trabalho ativo e coordene a reinicialização. Se o resultado for desconhecido, o backend exclusivo permanece bloqueado até o gateway ser reiniciado; liberar a reserva ou desconectar o cliente não desbloqueia o backend com segurança, e desconectar não cancela a operação.
4. Em outra sessão com o mesmo conector e catálogo, repita `list_servers` / `search_tools` para o mesmo alias. Espere `ready` no backend inicializado e recursos do mesmo catálogo. O alias igual não prova identidade do processo nem economia de RAM; veja o teste público de reutilização. [Método de reutilização de processos](../BENCHMARK.md#method) · [Teste de cache do catálogo](../../test/catalog-scale.test.js)

[Exemplo completo em inglês](../../README.md#first-use) · [Compatibilidade e limites](../CLIENTS.md#compatibility-summary)

## Limites, privacidade e recuperação

Encontrar este repositório pelo Claude Code, Codex, Gemini CLI, Kimi ou Qwen CLI não garante integração nativa. Não há uma rota de instalação documentada para Gemini CLI; Antigravity é outro cliente. Kimi tem apenas testes do adaptador. Configurações e backups podem conter credenciais: não os publique. Os backends podem acessar serviços remotos; compartilhar não significa operar offline nem garante economia fixa de RAM ou tokens.

Antes de parar de usar, conclua os fluxos ativos e aguarde o fim das chamadas. Restaurar a configuração do cliente não encerra o runtime persistente. Siga a [saída e entrega ao operador (inglês)](../REFERENCE.md#planned-exit) e verifique o estado final; preserve os dados privados e as credenciais e não encerre processos não relacionados.

[Privacidade](../REFERENCE.md#state-and-privacy) · [Recuperação e reversão](../REFERENCE.md#setup-recovery)

**Referência operacional (inglês):** [Consultar a referência operacional](../REFERENCE.md)

**Licença:** [MIT](../../LICENSE)


<a id="resource-examples"></a>

**Evite RAM de backends duplicados**

Hipótese ilustrativa, não benchmark: 5 sessões precisam das mesmas 12 conexões; um conjunto completo de backends usa 1.5 GB. Sessões compatíveis compartilham processos reais pelo mesmo conector e catálogo.

| Implantação | RAM dos backends |
|---|---|
| Cópias independentes | 5 × 1.5 GB = 7.5 GB |
| Conjunto compartilhado | 1.5 GB + sobrecarga do gateway e dos conectores |

RAM duplicada evitada antes da sobrecarga: 7.5 GB - 1.5 GB = 6 GB. A economia total só será conhecida após medição. 1.5 GB não é constante entre cargas ou clientes; não se economiza a RAM de cinco modelos.

**Reutilize também o trabalho de inicialização.** Se as 5 sessões usarem os 12 serviços stdio, cópias exigem até `5 × 12 = 60` inicializações contra `12` compartilhadas: `60 - 12 = 48` duplicadas evitadas, `48 / 60 × 100 = 80%` menos inicializações. A conexão sob demanda conecta apenas `k` backends usados; os não usados não iniciam. É contagem de operações, não inicialização 80% mais rápida. A latência não foi medida; concorrência, autenticação e plataforma afetam o tempo.

1000 ferramentas → 6 definições iniciais: (1000 - 6) / 1000 × 100 = 99.4% menos definições, não tokens. Os esquemas solicitados depois têm custo; clientes que já adiam o carregamento podem ganhar menos. O teste de catálogo sintético verifica seis ferramentas e cache compartilhado entre dois clientes, não desempenho RSS. [catalog-scale.test.js](../../test/catalog-scale.test.js)

**Fixture leve medido: reutilização, mas RAM total pior e sem ganho na partida fria.** Medianas de 3 testes, Windows x64 / Node 24.13.1: esquema + echo compartilhado 426.2 ms com backend frio, 21.1 ms no segundo cliente, 19.0 ms no quinto. Total do primeiro cliente: 503.5 ms direto, 894.3 ms compartilhado com gateway pronto; partida compartilhada totalmente fria 1886.7 ms. Processos backend 5 → 1, mas processos totais 5 → 7 e working set somado 357.0 MiB → 564.0 MiB: RAM líquida pior. Um único echo não representa serviços reais pesados; 1.5 GB acima é outra hipótese, não medição. [BENCHMARK.md](../BENCHMARK.md)

<a id="mechanism"></a>

O teste SDK/stdio mantém o mesmo conector e conexão MCP para descobrir novo alias e executar echo após reiniciar; não testa interfaces de conversa de cada marca. Não há recarga automática; conflitos exigem revisão. Registro inicial ou atualização do runtime podem exigir reiniciar o cliente. Chamadas interrompidas não são repetidas; reserve novamente o acesso exclusivo após reiniciar.

```text
Agente A ─┐                         ┌─ Integração A: várias ferramentas
Agente B ─┼─ conector ─ MCPGateway ─┼─ Integração B: várias ferramentas
Agente C ─┘                         └─ Integração C: várias ferramentas
```

Vários agentes acessam o MCPGateway pelo mesmo conector; a conexão com os backends configurados selecionados ocorre sob demanda. O diagrama ilustra o compartilhamento: não é um benchmark nem uma verificação em execução, e não significa iniciar todos os backends.

> Esta é uma visão geral localizada. O [README](../../README.md) em inglês e o guia de clientes em inglês vinculado abaixo são as fontes oficiais para instalação completa, atualização e detalhes técnicos.

[English](../../README.md)

## Reutilize backends e descubra ferramentas sob demanda.

## Como funciona

O gateway sempre apresenta 6 ferramentas ao agente: 4 para descobrir e chamar recursos e 2 para integrações que exigem um fluxo exclusivo. Adicionar conexões não aumenta essa interface inicial; o esquema completo só é carregado para a ferramenta escolhida. As conexões já configuradas e autenticadas são reutilizadas, sem instalar serviços nem fornecer credenciais.

Um catálogo MCP compartilhado pode atender vários agentes. Por exemplo, comece com **10** conexões no Copilot e migre explicitamente uma configuração compatível do Claude com **2** novas conexões: ambos os agentes poderão usar as mesmas **12**.

- Instalar apenas o plugin não mescla as configurações. Entradas com o mesmo nome só são deduplicadas se as definições de alias forem idênticas; apontar para o mesmo serviço não basta. Conflitos interrompem o processo para revisão.
- A migração mostra primeiro uma prévia, cria backup e rejeita configurações nativas incompatíveis.
- Isso não significa que todos os clientes nativos foram testados de ponta a ponta. Consulte o [guia de migração (inglês)](../CLIENTS.md#cross-client-migration).

## Instalação e atualização por cliente

O runtime compartilhado é criado atualmente pelo Copilot CLI; os outros clientes se conectam ao mesmo conector estável. Os links abaixo levam ao guia de clientes em inglês, a fonte oficial para instalação e atualização.

| Cliente | Instalação | Atualização |
|---|---|---|
| GitHub Copilot CLI | [Instalar](../CLIENTS.md#copilot-cli-install) | [Atualizar](../CLIENTS.md#copilot-cli-upgrade) |
| VS Code (editor) | [Instalar](../CLIENTS.md#vs-code-install) | [Atualizar](../CLIENTS.md#vs-code-upgrade) |
| Claude Code | [Instalar](../CLIENTS.md#claude-code-install) | [Atualizar](../CLIENTS.md#claude-code-upgrade) |
| Codex CLI | [Instalar](../CLIENTS.md#codex-install) | [Atualizar](../CLIENTS.md#codex-upgrade) |
| OpenCode | [Instalar](../CLIENTS.md#opencode-install) | [Atualizar](../CLIENTS.md#opencode-upgrade) |
| Qwen Code | [Instalar](../CLIENTS.md#qwen-code-install) | [Atualizar](../CLIENTS.md#qwen-code-upgrade) |
| Kimi CLI | [Instalar](../CLIENTS.md#kimi-cli-install) | [Atualizar](../CLIENTS.md#kimi-cli-upgrade) |
| Antigravity CLI | [Instalar](../CLIENTS.md#antigravity-cli-install) | [Atualizar](../CLIENTS.md#antigravity-cli-upgrade) |

A configuração mostra uma prévia antes de qualquer alteração. Após a aprovação, cria backups privados e retorna verificações de prontidão e comandos exatos de reversão. A configuração e os backups podem conter credenciais; não os publique nem os adicione ao controle de versão.
