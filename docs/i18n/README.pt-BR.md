# Shared MCP Gateway

[English](../../README.md)

> Esta é uma visão geral localizada. O [README](../../README.md) em inglês e o guia de clientes em inglês vinculado abaixo são as fontes oficiais para instalação completa, atualização e detalhes técnicos.

## Economize RAM. Preserve o contexto para o seu trabalho. Ferramentas sob demanda.

**Mais agentes devem significar mais trabalho concluído, não mais cópias da mesma configuração MCP.**

### 5 agentes. 12 conexões MCP. Uma configuração compartilhada.

*Exemplo ilustrativo: essas **12** conexões oferecem **1,000** ferramentas e cada configuração independente usa **1.5 GB** de RAM de processos locais.*

| Benefício | Configuração separada por agente | Com MCPGateway |
|---|---|---|
| **Economize RAM** | **7.5 GB** em cinco configurações MCP independentes. | **1.5 GB compartilhados**, mais a sobrecarga do gateway e dos conectores. **6 GB de memória duplicada evitados.** |
| **Preserve o contexto. Ferramentas sob demanda.** | Cada agente carrega antecipadamente **1,000 definições de ferramentas**, e esse número pode crescer ao adicionar conexões MCP. | Apenas **6 ferramentas de gateway inicialmente, 99.4% menos definições**. As **1,000** ferramentas continuam disponíveis; cada agente descobre e carrega somente o necessário. Adicione conexões sem carregar seus catálogos completos em todos os agentes. |

**Mantenha seus agentes e conexões MCP. Pare de fazer cada sessão carregar sua própria cópia.**

*Os números de RAM são ilustrativos, não economias medidas; a memória dos agentes é adicional. A contagem de definições não representa economia de tokens, e clientes que já adiam o carregamento podem ter um ganho de contexto menor. O compartilhamento não amplia a janela de contexto nem mantém o uso total de RAM constante.*

## Como funciona

O gateway sempre apresenta 6 ferramentas ao agente: 4 para descobrir e chamar recursos e 2 para integrações que exigem um fluxo exclusivo. Adicionar conexões não aumenta essa interface inicial; o esquema completo só é carregado para a ferramenta escolhida. As conexões já configuradas e autenticadas são reutilizadas, sem instalar serviços nem fornecer credenciais.

Um catálogo MCP compartilhado pode atender vários agentes: comece com **10** conexões no Copilot e migre explicitamente uma configuração compatível do Claude com **2** novas conexões para que ambos os agentes usem as mesmas **12**; instalar apenas o plugin não as mescla automaticamente. Entradas com o mesmo nome só são deduplicadas quando suas definições de alias são idênticas, não apenas porque apontam para o mesmo serviço, e conflitos interrompem o processo para revisão. A migração mostra primeiro uma prévia, cria backup e rejeita configurações nativas incompatíveis; isso também não afirma que todos os clientes nativos foram testados de ponta a ponta, portanto consulte o [guia de migração (inglês)](../CLIENTS.md#cross-client-migration).

**Pré-requisitos:** Node.js 24 ou mais recente, npm, Git e Copilot CLI com plugins para a inicialização atual. Agency é opcional.

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

**Referência operacional (inglês):** [Consultar a referência operacional](../REFERENCE.md)

**Licença:** [MIT](../../LICENSE)
