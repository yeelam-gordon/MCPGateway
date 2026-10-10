# MCPGateway — Comparte servidores MCP locales entre sesiones de agentes de programación

[English](../../README.md)

> Esta es una vista general localizada. El [README](../../README.md) y la guía de clientes enlazada más abajo, ambos en inglés, son las fuentes oficiales para la instalación completa, las actualizaciones y los detalles técnicos.

## Reutiliza backends y descubre herramientas bajo demanda.

Varias sesiones de Copilot CLI no necesitan iniciar copias independientes del mismo backend MCP. Comparte servicios locales ya configurados y coordina los flujos exclusivos; no es una plataforma empresarial de gobernanza de API.

**Requisitos:** Node.js 24 o posterior, npm, Git, Copilot CLI con plugins y servicios MCP ya configurados y autenticados. El arranque actual requiere Copilot CLI; Windows es la plataforma principal de pruebas y Agency es opcional. La compatibilidad y la verificación varían según el cliente.

## Cómo funciona

El gateway presenta siempre 6 herramientas al agente: 4 para descubrir e invocar capacidades y 2 para integraciones que necesitan un flujo exclusivo. Añadir conexiones no aumenta esta interfaz inicial; el esquema completo solo se carga para la herramienta elegida. Se reutilizan las conexiones que ya configuraste y autenticaste, sin instalar servicios ni proporcionar credenciales.

Un catálogo MCP compartido puede servir a varios agentes. Por ejemplo, empieza con **10** conexiones en Copilot y migra explícitamente una configuración de Claude compatible con **2** conexiones nuevas: ambos agentes podrán usar las mismas **12**.

- Instalar el plugin por sí solo no combina las configuraciones. Las entradas con el mismo nombre solo se deduplican si sus definiciones de alias son idénticas; apuntar al mismo servicio no basta. Los conflictos detienen el proceso para su revisión.
- La migración muestra primero una vista previa, crea una copia de seguridad y rechaza ajustes nativos no compatibles.
- Esto no significa que todos los clientes nativos se hayan probado de extremo a extremo. Consulta la [guía de migración (inglés)](../CLIENTS.md#cross-client-migration).

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

## Primera configuración y llamada

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Tras instalar el plugin, inicia Copilot CLI, ejecuta `/mcp-gateway-setup`, revisa la vista previa y aprueba solo los cambios previstos. Cierra y vuelve a abrir Copilot; ejecuta el `readinessCommand` exacto recibido. Conserva los comandos de copia de seguridad y reversión. Instalar el plugin no fusiona configuraciones.
2. Llama a `list_servers` con `{}`: deben aparecer alias, estados e indicadores de exclusividad de los servicios existentes. Elige un backend autorizado, busca un término de tu tarea con `search_tools` y obtén su esquema con `get_tool_schema`. Construye los argumentos según ese esquema y realiza una lectura aprobada con `call_tool`. Comprueba el registro esperado o un resultado vacío documentado; recibir una respuesta no demuestra por sí solo que la lectura haya tenido éxito.
3. Si `requiresExclusiveAccess: true`, usa `claim_server` antes de buscar y `release_server` cuando terminen todas las llamadas. No reclames backends no exclusivos. Ante un tiempo de espera con resultado desconocido, no reintentes: revisa el trabajo activo y coordina el reinicio. Si el resultado es desconocido, el backend exclusivo permanece bloqueado hasta reiniciar el gateway; liberar la reserva o desconectar el cliente no lo desbloquea de forma segura, y desconectar no cancela la operación.

[Ejemplo completo en inglés](../../README.md#first-use) · [Compatibilidad y límites](../CLIENTS.md#compatibility-summary)

## Límites, privacidad y recuperación

Descubrir este repositorio desde Claude Code, Codex, Gemini CLI, Kimi o Qwen CLI no garantiza integración nativa. Aquí no hay una ruta de instalación de Gemini CLI; Antigravity es otro cliente. Kimi solo tiene pruebas del adaptador. La configuración y las copias pueden contener credenciales: no las publiques. Los backends pueden contactar servicios remotos; compartir no implica funcionamiento sin conexión ni ahorro fijo de RAM o tokens.

Antes de dejar de usarlo, termina los flujos activos y espera a que finalicen las llamadas. Restaurar la configuración del cliente no detiene el runtime persistente. Sigue la [salida y entrega al operador (inglés)](../REFERENCE.md#planned-exit) y verifica el estado final; conserva los datos privados y las credenciales, y no detengas procesos ajenos.

[Privacidad](../REFERENCE.md#state-and-privacy) · [Recuperación y reversión](../REFERENCE.md#setup-recovery)

**Referencia operativa (inglés):** [Consultar la referencia operativa](../REFERENCE.md)

**Licencia:** [MIT](../../LICENSE)
