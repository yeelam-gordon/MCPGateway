# Inicio rápido de Shared MCP Gateway

[English](../../README.md)

> Esta es una guía rápida localizada. El [README](../../README.md) en inglés es la fuente oficial para el uso avanzado y los detalles técnicos más recientes.

## Un gateway para tus backends MCP existentes

Shared MCP Gateway permite que Copilot cargue inicialmente una interfaz fija de **6 herramientas de gateway** y después busque e invoque, bajo demanda, las herramientas de los backends que ya configuraste. Aunque el catálogo contenga unas **1.000 herramientas**, no es necesario entregar todas sus definiciones al cliente desde el principio.

El catálogo y las conexiones de backend se reutilizan entre varias sesiones de Copilot CLI, lo que reduce el inicio duplicado de servidores locales. El gateway no instala servidores MCP ni proporciona credenciales: sigue usando tu método habitual para configurar servidores y autenticación.

Las 6 herramientas incluyen 4 de descubrimiento/ejecución y 2 de arrendamiento genérico de servidores. El arrendamiento sirve para cualquier backend que requiera un flujo de trabajo exclusivo; no se limita a la automatización del navegador.

## Requisitos previos

- Node.js 24 o posterior, npm y Git
- Copilot CLI con compatibilidad para plugins
- Una configuración MCP de Copilot existente y la autenticación necesaria para sus backends
- Agency es opcional; no es necesario para el uso normal de Copilot CLI

## Instalación

Ejecuta estos comandos en el **terminal**, no dentro del chat de Copilot:

```text
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

Después inicia Copilot y ejecuta dentro de Copilot:

```text
/mcp-gateway-setup
```

Instalar el plugin por sí solo no migra la configuración MCP. El asistente muestra primero una vista previa; tras aprobarla, crea una copia de seguridad, guarda las definiciones de backend en un directorio privado y cambia la configuración del cliente al conector del gateway compartido.

Conserva la ruta de la copia de seguridad y el comando de restauración exacto que muestra el asistente. El catálogo y las copias pueden contener credenciales: no los publiques ni los confirmes en el control de versiones.

Al terminar, cierra y vuelve a abrir Copilot. El gateway se inicia automáticamente la primera vez que se usa el conector; no hace falta mantener otro terminal abierto.

## Cómo funciona

1. `list_servers` enumera los alias configurados sin iniciar todos los backends.
2. `search_tools` busca resúmenes de herramientas relevantes en un backend concreto.
3. `get_tool_schema` obtiene únicamente el esquema completo de la herramienta elegida.
4. `call_tool` valida los argumentos y la lista permitida antes de invocar la herramienta.
5. `claim_server` y `release_server` protegen el flujo completo de un servidor que necesita acceso exclusivo y liberan el arrendamiento cuando terminan las llamadas activas.

El cliente MCP, el gateway y el servidor MCP cumplen funciones distintas, pero no necesitas dominar el protocolo para el uso diario: configura tus backends como siempre y deja que Copilot los descubra y use a través del gateway.

## Actualización y restauración

Después de actualizar el plugin, ejecuta `/mcp-gateway-setup` para adoptar explícitamente el nuevo runtime. Espera a que terminen las llamadas activas, aplica la actualización y vuelve a abrir Copilot; descargar el plugin no sustituye el gateway que ya está en ejecución.

Si falla la configuración, cierra Copilot y usa la ruta de copia de seguridad y el comando de restauración exactos que se mostraron. No elimines el directorio privado de backends para intentar recuperarlo.
Consulta el [README](../../README.md) en inglés para conocer la sincronización de configuración, la integración de clientes, los arrendamientos y la solución de problemas.

**Licencia:** [MIT](../../LICENSE)
