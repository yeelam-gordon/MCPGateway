# MCPGateway — Comparte servidores MCP locales entre sesiones de agentes de programación

Varias sesiones de Copilot CLI no necesitan iniciar copias independientes del mismo backend MCP. Comparte servicios locales ya configurados y coordina los flujos exclusivos; no es una plataforma empresarial de gobernanza de API.

- Reutiliza RAM y trabajo de arranque de backends pesados, sin una copia por sesión.
- Descubre capacidades y esquemas bajo demanda con 6 herramientas iniciales.
- Añade backends conservando la conexión MCP del agente. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

Añade backends sin reiniciar la conexión MCP actual del agente: sincroniza las adiciones, termina el trabajo activo y reinicia solo el gateway propio; el conector actual se reconecta. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

Adecuado para varias sesiones con el mismo backend y catálogo; una sola sesión o backends ligeros pueden no compensar la sobrecarga.

[Empieza: instalación y primera lectura autorizada](#first-use) · [MCP / Copilot CLI](../CLIENTS.md#shared-core-install) · [6 herramientas / 2 clientes](../../test/catalog-scale.test.js)

[Evita RAM de backends duplicados](#resource-examples): 5 × 1.5 GB = 7.5 GB → 1.5 GB + sobrecarga del gateway y los conectores.

<img src="../../assets/mcp-gateway-benefits.png" alt="Reutiliza RAM y trabajo de arranque de backends pesados, sin una copia por sesión." width="780">

Concepto con etiquetas en inglés, no captura ni benchmark. Supone 1.5 GB por conjunto: 6 GB es duplicación evitada antes de la sobrecarga. El fixture ligero medido usó más RAM total.

<a id="first-use"></a>
## Primera configuración y llamada

**Requisitos:** Node.js 24 o posterior, npm, Git, Copilot CLI con plugins y servicios MCP ya configurados y autenticados. El arranque actual requiere Copilot CLI; Windows es la plataforma principal de pruebas y Agency es opcional. La compatibilidad y la verificación varían según el cliente.

Las configuraciones y copias pueden contener credenciales: mantenlas privadas y aprueba solo los cambios previstos.

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Tras instalar el plugin, inicia Copilot CLI, ejecuta `/mcp-gateway-setup`, revisa la vista previa y aprueba solo los cambios previstos. Cierra y vuelve a abrir Copilot; ejecuta el `readinessCommand` exacto recibido. Conserva los comandos de copia de seguridad y reversión. Instalar el plugin no fusiona configuraciones.

Descubrimiento y esquema no requieren reserva; si `requiresExclusiveAccess: true`, usa `claim_server` antes de `call_tool`.

2. Llama a `list_servers` con `{}`: deben aparecer alias, estados e indicadores de exclusividad de los servicios existentes. Elige un backend autorizado, busca un término de tu tarea con `search_tools` y obtén su esquema con `get_tool_schema`. Construye los argumentos según ese esquema y realiza una lectura aprobada con `call_tool`. Comprueba el registro esperado o un resultado vacío documentado; recibir una respuesta no demuestra por sí solo que la lectura haya tenido éxito.
3. Si `requiresExclusiveAccess: true`, usa `claim_server` antes de llamar y `release_server` cuando terminen todas las llamadas. No reclames backends no exclusivos. Ante un tiempo de espera con resultado desconocido, no reintentes: revisa el trabajo activo y coordina el reinicio. Si el resultado es desconocido, el backend exclusivo permanece bloqueado hasta reiniciar el gateway; liberar la reserva o desconectar el cliente no lo desbloquea de forma segura, y desconectar no cancela la operación.
4. En una segunda sesión con el mismo conector y catálogo, repite `list_servers` / `search_tools` para el mismo alias. Espera `ready` en el backend inicializado y capacidades del mismo catálogo. El alias coincidente no demuestra identidad del proceso ni ahorro de RAM; consulta la prueba pública de reutilización. [Método de reutilización de procesos](../BENCHMARK.md#method) · [Prueba de caché del catálogo](../../test/catalog-scale.test.js)

[Ejemplo completo en inglés](../../README.md#first-use) · [Compatibilidad y límites](../CLIENTS.md#compatibility-summary)

## Límites, privacidad y recuperación

Descubrir este repositorio desde Claude Code, Codex, Gemini CLI, Kimi o Qwen CLI no garantiza integración nativa. Aquí no hay una ruta de instalación de Gemini CLI; Antigravity es otro cliente. Kimi solo tiene pruebas del adaptador. La configuración y las copias pueden contener credenciales: no las publiques. Los backends pueden contactar servicios remotos; compartir no implica funcionamiento sin conexión ni ahorro fijo de RAM o tokens.

Antes de dejar de usarlo, termina los flujos activos y espera a que finalicen las llamadas. Restaurar la configuración del cliente no detiene el runtime persistente. Sigue la [salida y entrega al operador (inglés)](../REFERENCE.md#planned-exit) y verifica el estado final; conserva los datos privados y las credenciales, y no detengas procesos ajenos.

[Privacidad](../REFERENCE.md#state-and-privacy) · [Recuperación y reversión](../REFERENCE.md#setup-recovery)

**Referencia operativa (inglés):** [Consultar la referencia operativa](../REFERENCE.md)

**Licencia:** [MIT](../../LICENSE)


<a id="resource-examples"></a>

**Evita RAM de backends duplicados**

Supuesto ilustrativo, no benchmark: 5 sesiones necesitan las mismas 12 conexiones; un conjunto completo de backends usa 1.5 GB. Las sesiones compatibles comparten procesos reales con el mismo conector y catálogo.

| Despliegue | RAM de backends |
|---|---|
| Copias independientes | 5 × 1.5 GB = 7.5 GB |
| Conjunto compartido | 1.5 GB + sobrecarga del gateway y los conectores |

RAM duplicada evitada antes de la sobrecarga: 7.5 GB - 1.5 GB = 6 GB. El ahorro total se desconoce hasta medirlo. 1.5 GB no es constante entre cargas o clientes; no se ahorra la RAM de cinco modelos.

**Reutiliza también el trabajo de arranque.** Si las 5 sesiones usan los 12 servicios stdio, las copias requieren hasta `5 × 12 = 60` arranques frente a `12` compartidos: `60 - 12 = 48` duplicados evitados, `48 / 60 × 100 = 80%` menos arranques. La conexión diferida conecta solo `k` backends usados; los no usados no arrancan. Son operaciones, no un arranque 80% más rápido. La latencia no se midió; concurrencia, autenticación y plataforma afectan al tiempo.

1000 herramientas → 6 definiciones iniciales: (1000 - 6) / 1000 × 100 = 99.4% menos definiciones, no tokens. Los esquemas solicitados después tienen coste; los clientes que ya difieren su carga pueden ganar menos. La prueba de catálogo sintético verifica seis herramientas y una caché compartida entre dos clientes, no rendimiento RSS. [catalog-scale.test.js](../../test/catalog-scale.test.js)

**Fixture ligero medido: reutilización, pero peor RAM total y sin mejora de arranque frío.** Medianas de 3 ensayos, Windows x64 / Node 24.13.1: esquema + echo compartido 426.2 ms con backend frío, 21.1 ms segundo cliente, 19.0 ms quinto. Total del primer cliente: 503.5 ms directo, 894.3 ms compartido con gateway listo; compartido totalmente frío 1886.7 ms. Procesos backend 5 → 1, pero procesos totales 5 → 7 y working set sumado 357.0 MiB → 564.0 MiB: RAM neta peor. Un único echo no representa servicios reales pesados; 1.5 GB arriba es otro supuesto, no medición. [BENCHMARK.md](../BENCHMARK.md)

<a id="mechanism"></a>

La prueba SDK/stdio conserva el mismo conector y conexión MCP para descubrir un alias nuevo y ejecutar echo tras el reinicio; no prueba las interfaces de conversación de cada marca. No hay recarga automática; los conflictos requieren revisión. Registro inicial o actualización del runtime pueden exigir reiniciar el cliente. No se repiten llamadas interrumpidas; vuelve a reservar el acceso exclusivo tras reiniciar.

```text
Agente A ─┐                         ┌─ Integración A: varias herramientas
Agente B ─┼─ conector ─ MCPGateway ─┼─ Integración B: varias herramientas
Agente C ─┘                         └─ Integración C: varias herramientas
```

Varios agentes acceden a MCPGateway por el mismo conector; se conecta bajo demanda a los backends configurados que se seleccionen. El esquema ilustra el mecanismo de uso compartido: no es un benchmark ni una verificación en ejecución, ni implica iniciar todos los backends.

> Esta es una vista general localizada. El [README](../../README.md) y la guía de clientes enlazada más abajo, ambos en inglés, son las fuentes oficiales para la instalación completa, las actualizaciones y los detalles técnicos.

[English](../../README.md)

## Reutiliza backends y descubre herramientas bajo demanda.

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
