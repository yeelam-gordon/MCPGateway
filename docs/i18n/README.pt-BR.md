# MCPGateway — Compartilhe servidores MCP locais entre sessões de agentes de programação

[English](../../README.md)

> Esta é uma visão geral localizada. O [README](../../README.md) em inglês e o guia de clientes em inglês vinculado abaixo são as fontes oficiais para instalação completa, atualização e detalhes técnicos.

## Reutilize backends e descubra ferramentas sob demanda.

Várias sessões do Copilot CLI não precisam iniciar cópias independentes do mesmo backend MCP. Compartilhe serviços locais já configurados e coordene fluxos exclusivos; não é uma plataforma corporativa de governança de APIs.

**Pré-requisitos:** Node.js 24 ou mais recente, npm, Git, Copilot CLI com plugins e serviços MCP já configurados e autenticados. A instalação inicial exige Copilot CLI; Windows é a principal plataforma testada e Agency é opcional. A compatibilidade e o nível de verificação variam entre clientes.

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

## Primeira configuração e chamada

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Após instalar o plugin, abra o Copilot CLI e execute `/mcp-gateway-setup`. Revise a prévia antes de aprovar as alterações desejadas. Feche e reabra o Copilot; execute o `readinessCommand` exato recebido. Guarde os comandos de backup e reversão. Instalar apenas o plugin não mescla configurações.
2. Chame `list_servers` com `{}`: devem aparecer os aliases, estados e indicadores de exclusividade dos serviços existentes. Escolha um backend autorizado, pesquise um termo da tarefa com `search_tools` e obtenha o esquema da ferramenta com `get_tool_schema`. Monte os argumentos conforme esse esquema e faça uma leitura aprovada com `call_tool`. Confira o registro esperado ou um resultado vazio documentado; uma resposta do gateway não comprova, por si só, o sucesso da leitura.
3. Se `requiresExclusiveAccess: true`, use `claim_server` antes da busca e `release_server` após todas as chamadas terminarem. Backends não exclusivos dispensam reserva. Se houver timeout com resultado desconhecido, não repita a chamada: revise o trabalho ativo e coordene a reinicialização.

[Exemplo completo em inglês](../../README.md#first-use) · [Compatibilidade e limites](../CLIENTS.md#compatibility-summary)

## Limites, privacidade e recuperação

Encontrar este repositório pelo Claude Code, Codex, Gemini CLI, Kimi ou Qwen CLI não garante integração nativa. Não há uma rota de instalação documentada para Gemini CLI; Antigravity é outro cliente. Kimi tem apenas testes do adaptador. Configurações e backups podem conter credenciais: não os publique. Os backends podem acessar serviços remotos; compartilhar não significa operar offline nem garante economia fixa de RAM ou tokens.

[Privacidade](../REFERENCE.md#state-and-privacy) · [Recuperação e reversão](../REFERENCE.md#setup-recovery)

**Referência operacional (inglês):** [Consultar a referência operacional](../REFERENCE.md)

**Licença:** [MIT](../../LICENSE)
