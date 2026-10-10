# MCPGateway — Comparte servidores MCP locales entre sesiones de agentes de programación

<a id="languages"></a>
<details>
<summary>Languages / 语言 / 言語 / اللغات (16)</summary>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [العربية](README.ar.md) · [हिन्दी](README.hi.md) · [Bahasa Indonesia](README.id.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md)

</details>

Comparte backends MCP locales entre sesiones: evita RAM duplicada, usa backends ya activos y añade backends por configuración sin reiniciar la conexión MCP actual del agente (ruta SDK/stdio; el beneficio neto depende de la sobrecarga).

[Empieza vía Copilot CLI](#first-use) · [Verificación de clientes](../CLIENTS.md#compatibility-summary) · [Evidencia](#resource-examples)

<img src="../../assets/mcp-gateway-benefits.png" alt="Reutiliza RAM y trabajo de arranque de backends pesados, sin una copia por sesión." width="780">

Concepto con etiquetas en inglés, no captura ni benchmark.

- **Evita memoria de backends duplicados:** Ilustración: 5 × 1.5 GB → un conjunto; 6 GB de duplicación evitada **antes** de la sobrecarga del gateway y conectores, no ahorro medido.
- **Evita volver a iniciar los mismos backends:** Si las 5 sesiones usan los 12 servicios stdio: 60 → 12 arranques de backend, no un arranque 80% más rápido.
- **Añade solo configuración; conserva la conexión del agente:** SDK/stdio: 1 inicialización sobrevive al reinicio del gateway propio tras finalizar el trabajo; el conector permanece, sin recarga automática ni UI nativa de conversación verificada. Registro inicial o actualización del runtime pueden exigir reiniciar el cliente. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

Adecuado para varias sesiones con el mismo backend y catálogo; una sola sesión o backends ligeros pueden no compensar la sobrecarga.

<a id="first-use"></a>
## Primera configuración y llamada

**Requisitos:** Node.js 24 o posterior, npm, Git, Copilot CLI con plugins y servicios MCP ya configurados y autenticados. El arranque actual requiere Copilot CLI; Windows es la plataforma principal de pruebas y Agency es opcional. La compatibilidad y la verificación varían según el cliente.

Las configuraciones y copias pueden contener credenciales: mantenlas privadas y aprueba solo los cambios previstos.

[Salida y runtime persistente](../REFERENCE.md#planned-exit) · [Restaurar la configuración no detiene el proceso persistente del gateway (rollback ≠ daemon shutdown)](../REFERENCE.md#setup-recovery)

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Tras instalar el plugin, inicia Copilot CLI, ejecuta `/mcp-gateway-setup`, revisa la vista previa y aprueba solo los cambios previstos. Cierra y vuelve a abrir Copilot; ejecuta el `readinessCommand` exacto recibido. Conserva los comandos de copia de seguridad y reversión. Instalar el plugin no fusiona configuraciones.

`readinessCommand` es el objeto devuelto, no una cadena de shell. Asigna a `$readinessCommand` ese objeto exacto del resultado de configuración aprobado y ejecuta el ejemplo PowerShell. `.command` conserva la ruta del ejecutable y `.args` todos los argumentos en orden, incluidas rutas con espacios o comillas. No unas el array ni inventes rutas. La comprobación no inicia un gateway ausente.

Guarda solo el objeto JSON `readinessCommand` del resultado de configuración aprobado, no toda la salida, como UTF-8 `readiness-command.json` en tu carpeta actual privada. Conserva exactos el ejecutable conocido y aprobado `.command` y todos los `.args`; no unas argumentos ni inventes rutas. Analiza solo este JSON de configuración, no datos web o de servicios arbitrarios; analizar JSON no evalúa código. Mantén el archivo privado: el contenido de los argumentos depende de tu configuración.

```powershell
$readinessCommand = Get-Content -Raw -LiteralPath '.\readiness-command.json' | ConvertFrom-Json
$command = $readinessCommand.command
$commandArgs = @($readinessCommand.args)
& $command @commandArgs
```

Descubrimiento y esquema no requieren reserva; si `requiresExclusiveAccess: true`, usa `claim_server` antes de `call_tool`.

> Usa el gateway para [mi tarea de lectura autorizada]: lista servidores, descubre la herramienta e inspecciona su esquema; prepara argumentos con valores de prueba autorizados y no sensibles. Obtén las aprobaciones normales, reserva antes de ejecutar en exclusiva y libera cuando terminen las llamadas. Muestra el resultado real. No reintentes un resultado desconocido: entrega el caso al responsable de instalación.

[SDK tool flow: `list_servers` → `search_tools` → `get_tool_schema` → `claim_server` (exclusive) → `call_tool` → `release_server`](../../README.md#first-use) · [REFERENCE](../REFERENCE.md#unknown-exclusive-result)

2. Llama a `list_servers` con `{}`: deben aparecer alias, estados e indicadores de exclusividad de los servicios existentes. Elige un backend autorizado, busca un término de tu tarea con `search_tools` y obtén su esquema con `get_tool_schema`. Construye los argumentos según ese esquema y realiza una lectura aprobada con `call_tool`. Comprueba el registro esperado o un resultado vacío documentado; recibir una respuesta no demuestra por sí solo que la lectura haya tenido éxito.
3. Si `requiresExclusiveAccess: true`, usa `claim_server` antes de llamar y `release_server` cuando terminen todas las llamadas. No reclames backends no exclusivos. Ante un tiempo de espera con resultado desconocido, no reintentes: revisa el trabajo activo y coordina el reinicio. Si el resultado es desconocido, el backend exclusivo permanece bloqueado hasta reiniciar el gateway; liberar la reserva o desconectar el cliente no lo desbloquea de forma segura, y desconectar no cancela la operación.
4. En una segunda sesión con el mismo conector y catálogo, repite `list_servers` / `search_tools` para el mismo alias. Espera `ready` en el backend inicializado y capacidades del mismo catálogo. El alias coincidente no demuestra identidad del proceso ni ahorro de RAM; consulta la prueba pública de reutilización. [Método de reutilización de procesos](../BENCHMARK.md#method) · [Prueba de caché del catálogo](../../test/catalog-scale.test.js)

Si el catálogo está vacío, revisa la configuración seleccionada y la vista previa de migración. Si no hay coincidencias, usa un término más concreto de las descripciones de herramientas del propio backend; no existe un nombre universal. Ante errores de autenticación o disponibilidad, sigue la [autenticación](../REFERENCE.md#native-http-oauth) y la [recuperación/reversión](../REFERENCE.md#setup-recovery), sin repetir llamadas ni iniciar un proceso paralelo para eludir el gateway.

[Ejemplo completo en inglés](../../README.md#first-use) · [Compatibilidad y límites](../CLIENTS.md#compatibility-summary)

## Límites, privacidad y recuperación

Descubrir este repositorio desde Claude Code, Codex, Gemini CLI, Kimi o Qwen CLI no garantiza integración nativa. Aquí no hay una ruta de instalación de Gemini CLI; Antigravity es otro cliente. Kimi solo tiene pruebas del adaptador. La configuración y las copias pueden contener credenciales: no las publiques. Los backends pueden contactar servicios remotos; compartir no implica funcionamiento sin conexión ni ahorro fijo de RAM o tokens.

Antes de dejar de usarlo, termina los flujos activos y espera a que finalicen las llamadas. Restaurar la configuración del cliente no detiene el runtime persistente. Sigue la [salida y entrega al operador (inglés)](../REFERENCE.md#planned-exit) y verifica el estado final; conserva los datos privados y las credenciales, y no detengas procesos ajenos.

[Privacidad](../REFERENCE.md#state-and-privacy) · [Recuperación y reversión](../REFERENCE.md#setup-recovery)

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

**Escenario de prueba ligero medido: aumentó el working set sumado de procesos (memoria residente sumada)** Medianas de 3 ensayos, Windows x64 / Node 24.13.1: esquema + echo compartido 426.2 ms con backend frío, 21.1 ms segundo cliente, 19.0 ms quinto. Total del primer cliente: 503.5 ms directo, 894.3 ms compartido con gateway listo; compartido totalmente frío 1886.7 ms. Procesos backend 5 → 1, pero procesos totales 5 → 7 y working set sumado 357.0 MiB → 564.0 MiB: working set sumado de procesos más alto; memoria física única no medida. Un único echo no representa servicios reales pesados; 1.5 GB arriba es otro supuesto, no medición. [BENCHMARK.md](../BENCHMARK.md)

Se midió el working set sumado de procesos; no se midieron la memoria física sin duplicación ni los bytes privados (private bytes).

<a id="mechanism"></a>
<a id="reutiliza-backends-y-descubre-herramientas-bajo-demanda"></a>

## Cómo funciona

Añade backends sin reiniciar la conexión MCP actual del agente: sincroniza las adiciones, termina el trabajo activo y reinicia solo el gateway propio; el conector actual se reconecta. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

La prueba SDK/stdio conserva el mismo conector y conexión MCP para descubrir un alias nuevo y ejecutar echo tras el reinicio; no prueba las interfaces de conversación de cada marca. No hay recarga automática; los conflictos requieren revisión. Registro inicial o actualización del runtime pueden exigir reiniciar el cliente. No se repiten llamadas interrumpidas; vuelve a reservar el acceso exclusivo tras reiniciar.

No es una plataforma empresarial de gobernanza de API.

El gateway presenta siempre 6 herramientas al agente: 4 para descubrir e invocar capacidades y 2 para integraciones que necesitan un flujo exclusivo. Añadir conexiones no aumenta esta interfaz inicial; el esquema completo solo se carga para la herramienta elegida. Se reutilizan las conexiones que ya configuraste y autenticaste, sin instalar servicios ni proporcionar credenciales.

```text
Agente A ─┐                         ┌─ Integración A: varias herramientas
Agente B ─┼─ conector ─ MCPGateway ─┼─ Integración B: varias herramientas
Agente C ─┘                         └─ Integración C: varias herramientas
```

Varios agentes acceden a MCPGateway por el mismo conector; se conecta bajo demanda a los backends configurados que se seleccionen. El esquema ilustra el mecanismo de uso compartido: no es un benchmark ni una verificación en ejecución, ni implica iniciar todos los backends.

<a id="clients"></a>
## Instalación y actualización por cliente

> Esta es una vista general localizada. El [README](../../README.md) y la guía de clientes enlazada más abajo, ambos en inglés, son las fuentes oficiales para la instalación completa, las actualizaciones y los detalles técnicos.

<details>
<summary>Instalación y actualización por cliente</summary>

Un catálogo MCP compartido puede servir a varios agentes. Por ejemplo, empieza con **10** conexiones en Copilot y migra explícitamente una configuración de Claude compatible con **2** conexiones nuevas: ambos agentes podrán usar las mismas **12**.

- Instalar el plugin por sí solo no combina las configuraciones. Las entradas con el mismo nombre solo se deduplican si sus definiciones de alias son idénticas; apuntar al mismo servicio no basta. Los conflictos detienen el proceso para su revisión.
- La migración muestra primero una vista previa, crea una copia de seguridad y rechaza ajustes nativos no compatibles.
- Esto no significa que todos los clientes nativos se hayan probado de extremo a extremo. Consulta la [guía de migración (inglés)](../CLIENTS.md#cross-client-migration).

| Cliente | Instalación | Actualización | Arranque obligatorio | Nivel de verificación |
|---|---|---|---|---|
| GitHub Copilot CLI | [Instalar](../CLIENTS.md#copilot-cli-install) | [Actualizar](../CLIENTS.md#copilot-cli-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Ruta de marketplace/configuración; análisis aislado](../CLIENTS.md#compatibility-summary) |
| VS Code (editor) | [Instalar](../CLIENTS.md#vs-code-install) | [Actualizar](../CLIENTS.md#vs-code-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Adaptador de registro/formato probado; sin sesión nativa de extremo a extremo](../CLIENTS.md#compatibility-summary) |
| Claude Code | [Instalar](../CLIENTS.md#claude-code-install) | [Actualizar](../CLIENTS.md#claude-code-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Configuración aislada analizada; sin modelo/backend](../CLIENTS.md#compatibility-summary) |
| Codex CLI | [Instalar](../CLIENTS.md#codex-install) | [Actualizar](../CLIENTS.md#codex-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Validación nativa bloqueada por política](../CLIENTS.md#compatibility-summary) |
| OpenCode | [Instalar](../CLIENTS.md#opencode-install) | [Actualizar](../CLIENTS.md#opencode-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Adaptador de registro/formato probado; sin sesión nativa de extremo a extremo](../CLIENTS.md#compatibility-summary) |
| Qwen Code | [Instalar](../CLIENTS.md#qwen-code-install) | [Actualizar](../CLIENTS.md#qwen-code-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Adaptador de registro/formato probado; sin sesión nativa de extremo a extremo](../CLIENTS.md#compatibility-summary) |
| Kimi CLI | [Instalar](../CLIENTS.md#kimi-cli-install) | [Actualizar](../CLIENTS.md#kimi-cli-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Adaptador de registro/formato probado; sin sesión nativa de extremo a extremo](../CLIENTS.md#compatibility-summary) |
| Antigravity CLI | [Instalar](../CLIENTS.md#antigravity-cli-install) | [Actualizar](../CLIENTS.md#antigravity-cli-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Adaptador de registro/formato probado; sin sesión nativa de extremo a extremo](../CLIENTS.md#compatibility-summary) |

</details>

**Referencia operativa (inglés):** [Consultar la referencia operativa](../REFERENCE.md)

**Licencia:** [MIT](../../LICENSE)
