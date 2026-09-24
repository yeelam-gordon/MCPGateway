# Shared MCP Gateway

[English](../../README.md)

> Esta es una vista general localizada. El [README](../../README.md) y la guía de clientes enlazada más abajo, ambos en inglés, son las fuentes oficiales para la instalación completa, las actualizaciones y los detalles técnicos.

## Ahorra RAM. Conserva el contexto para tu trabajo. Herramientas bajo demanda.

**Más agentes deberían significar más trabajo terminado, no más copias de la misma configuración MCP.**

### 5 agentes. 12 conexiones MCP. Una configuración compartida.

*Ejemplo ilustrativo: esas **12** conexiones ofrecen **1,000** herramientas y cada configuración independiente usa **1.5 GB** de RAM de procesos locales.*

| Beneficio | Configuración separada por agente | Con MCPGateway |
|---|---|---|
| **Ahorra RAM** | **7.5 GB** entre cinco configuraciones MCP independientes. | **1.5 GB compartidos**, más la sobrecarga del gateway y los conectores. **Se evitan 6 GB de memoria duplicada.** |
| **Conserva el contexto. Herramientas bajo demanda.** | Cada agente carga por adelantado **1,000 definiciones de herramientas**, y la cifra puede crecer al añadir conexiones MCP. | Solo **6 herramientas de gateway por adelantado: 99.4% menos definiciones**. Las **1,000** herramientas siguen disponibles; cada agente descubre y carga únicamente lo que necesita. Puedes añadir conexiones sin cargar sus catálogos completos en todos los agentes. |

**Conserva tus agentes y conexiones MCP. Evita que cada sesión lleve su propia copia.**

*Las cifras de RAM son ilustrativas, no ahorros medidos; la memoria del agente es adicional. El recuento de definiciones no equivale a ahorro de tokens, y los clientes que ya aplazan la carga pueden obtener un beneficio de contexto menor. Compartir no amplía la ventana de contexto ni mantiene constante el uso total de RAM.*

## Cómo funciona

El gateway presenta siempre 6 herramientas al agente: 4 para descubrir e invocar capacidades y 2 para integraciones que necesitan un flujo exclusivo. Añadir conexiones no aumenta esta interfaz inicial; el esquema completo solo se carga para la herramienta elegida. Se reutilizan las conexiones que ya configuraste y autenticaste, sin instalar servicios ni proporcionar credenciales.

Un catálogo MCP compartido puede servir a varios agentes: empieza con **10** conexiones en Copilot y migra explícitamente una configuración de Claude compatible que contenga **2** conexiones nuevas para que ambos agentes usen las mismas **12**; instalar el plugin por sí solo no las combina automáticamente. Las entradas con el mismo nombre solo se deduplican cuando sus definiciones de alias son idénticas, no simplemente porque apunten al mismo servicio, y los conflictos detienen el proceso para su revisión. La migración muestra primero una vista previa, crea una copia de seguridad y rechaza ajustes nativos no compatibles; esto tampoco afirma que todos los clientes nativos se hayan probado de extremo a extremo, así que consulta la [guía de migración (inglés)](../CLIENTS.md#cross-client-migration).

**Requisitos:** Node.js 24 o posterior, npm, Git y Copilot CLI con plugins para el proceso de arranque actual. Agency es opcional.

## Instalación y actualización por cliente

Actualmente el runtime compartido se crea mediante Copilot CLI; los demás clientes se conectan al mismo conector estable. Estos enlaces llevan a la guía de clientes en inglés, la fuente oficial para instalar y actualizar.

| Cliente | Instalación | Actualización |
|---|---|---|
| GitHub Copilot CLI | [Instalar](../CLIENTS.md#copilot-cli-install) | [Actualizar](../CLIENTS.md#copilot-cli-upgrade) |
| VS Code (editor) | [Instalar](../CLIENTS.md#vs-code-install) | [Actualizar](../CLIENTS.md#vs-code-upgrade) |
| Claude Code | [Instalar](../CLIENTS.md#claude-code-install) | [Actualizar](../CLIENTS.md#claude-code-upgrade) |
| Codex CLI | [Instalar](../CLIENTS.md#codex-install) | [Actualizar](../CLIENTS.md#codex-upgrade) |
| OpenCode | [Instalar](../CLIENTS.md#opencode-install) | [Actualizar](../CLIENTS.md#opencode-upgrade) |
| Qwen Code | [Instalar](../CLIENTS.md#qwen-code-install) | [Actualizar](../CLIENTS.md#qwen-code-upgrade) |
| Kimi CLI | [Instalar](../CLIENTS.md#kimi-cli-install) | [Actualizar](../CLIENTS.md#kimi-cli-upgrade) |
| Antigravity CLI | [Instalar](../CLIENTS.md#antigravity-cli-install) | [Actualizar](../CLIENTS.md#antigravity-cli-upgrade) |

La configuración muestra una vista previa antes de cambiar nada. Tras la aprobación crea copias privadas y devuelve comprobaciones de disponibilidad y comandos exactos de reversión. La configuración y las copias pueden contener credenciales: no las publiques ni las confirmes en el control de versiones.

**Referencia operativa (inglés):** [Consultar la referencia operativa](../REFERENCE.md)

**Licencia:** [MIT](../../LICENSE)
