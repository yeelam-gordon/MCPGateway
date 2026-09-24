# Início rápido do Shared MCP Gateway

[English](../../README.md)

> Este é um guia rápido localizado. O [README](../../README.md) em inglês é a fonte oficial para uso avançado e detalhes técnicos atualizados.

## Um gateway para seus backends MCP existentes

O Shared MCP Gateway permite que o Copilot carregue inicialmente uma interface fixa de **6 ferramentas de gateway** e, depois, pesquise e chame sob demanda as ferramentas dos backends que você já configurou. Mesmo com cerca de **1.000 ferramentas** no catálogo, não é necessário enviar todas as definições ao cliente logo no início.

O catálogo e as conexões de backend são reutilizados entre várias sessões do Copilot CLI, reduzindo a inicialização duplicada de servidores locais. O gateway não instala servidores MCP nem fornece credenciais; continue usando seu método habitual para configurar servidores e autenticação.

As 6 ferramentas incluem 4 de descoberta/execução e 2 de locação genérica de servidor. A locação serve para qualquer backend que exija um estado de fluxo de trabalho exclusivo e não se limita à automação de navegador.

## Pré-requisitos

- Node.js 24 ou mais recente, npm e Git
- Copilot CLI com suporte a plugins
- Uma configuração MCP existente do Copilot e a autenticação exigida pelos backends
- Agency é opcional e não é necessário para o uso normal do Copilot CLI

## Instalação

Execute estes comandos no **terminal**, não dentro da conversa do Copilot:

```text
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

Depois, inicie o Copilot e execute dentro dele:

```text
/mcp-gateway-setup
```

Instalar apenas o plugin não migra a configuração MCP. A configuração mostra primeiro uma prévia; depois da aprovação, faz backup da configuração existente, guarda as definições de backend em um diretório privado e troca a configuração do cliente pelo conector do gateway compartilhado.

Guarde o caminho do backup e o comando exato de restauração exibidos. O catálogo e os backups podem conter credenciais; não os publique nem os adicione ao controle de versão.

Ao terminar, feche e abra novamente o Copilot. O gateway inicia automaticamente no primeiro uso do conector; não é necessário manter outro terminal aberto.

## Como funciona

1. `list_servers` lista os aliases configurados sem iniciar todos os backends.
2. `search_tools` procura resumos de ferramentas relevantes em um backend específico.
3. `get_tool_schema` obtém somente o esquema de entrada completo da ferramenta escolhida.
4. `call_tool` valida os argumentos e a lista de permissões antes de chamar a ferramenta.
5. `claim_server` e `release_server` protegem todo o fluxo de um servidor que precisa de acesso exclusivo e liberam a locação depois que as chamadas ativas terminam.

O cliente MCP, o gateway e o servidor MCP têm funções diferentes, mas não é preciso conhecer os detalhes do protocolo no uso diário: configure seus backends como antes e deixe o Copilot descobri-los e chamá-los pelo gateway.

## Atualização e restauração

Depois de atualizar o plugin, execute `/mcp-gateway-setup` para adotar explicitamente o novo runtime. Aguarde o término das chamadas ativas, aplique a atualização e reabra o Copilot; baixar o plugin não substitui um gateway em execução.

Se a configuração falhar, feche o Copilot e use o caminho exato do backup e o comando de restauração exibidos. Não exclua o diretório privado de backends como tentativa de recuperação.
Consulte o [README](../../README.md) em inglês para sincronização de configuração, integração de clientes, locações e solução de problemas.

**Licença:** [MIT](../../LICENSE)
