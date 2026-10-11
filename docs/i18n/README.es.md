# MCPGateway — Comparte backends MCP locales entre sesiones de programación

<a id="languages"></a>
<details>
<summary>Languages (16)</summary>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [العربية](README.ar.md) · [हिन्दी](README.hi.md) · [Bahasa Indonesia](README.id.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md)

</details>

Varias sesiones, un conjunto de backends: evita memoria duplicada y arranques repetidos. La ruta verificada SDK/stdio permite conservar la conexión MCP existente al añadir configuración (conexión existente de tu agente al gateway).

[Empezar](#first-use) · [Compatibilidad (inglés)](../CLIENTS.md#compatibility-summary) · [Evidencia y límites (inglés)](../BENCHMARK.md) · [Actualizaciones de Copilot](../CLIENTS.md#copilot-cli-upgrade)

<img src="../../assets/mcp-gateway-benefits.png" alt="Las copias de backends pasan a un conjunto compartido; se reutilizan los arranques; la conexión MCP existente sobrevive al reinicio del gateway propio tras finalizar el trabajo, en el experimento SDK/stdio." width="780">

Ilustración conceptual con etiquetas en inglés; no es una captura ni un benchmark. [SVG](../../assets/mcp-gateway-benefits.svg)

- **Evita duplicar la memoria de los backends:** Con el supuesto de 5 × 1.5 GB compartidos en un conjunto, se evitan 6 GB de duplicación **antes** de la sobrecarga del gateway y conectores. No es ahorro neto medido.
- **Reutiliza el trabajo de arranque:** Si las cinco sesiones usan los doce servicios stdio, los arranques pasan de 60 → 12; no significa un arranque 80% más rápido.
- **Conserva la conexión MCP existente:** El experimento SDK/stdio mantuvo la conexión al añadir solo configuración y reiniciar el gateway propio después de finalizar el trabajo. No demuestra recarga en caliente, continuidad de llamadas activas ni conservación de la conexión en todas las interfaces nativas de conversación. El registro inicial y las actualizaciones del runtime pueden exigir reiniciar el cliente. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

<a id="resource-examples"></a>
**Úsalo o descártalo:** Adecuado para varias sesiones con el mismo conector y catálogo. MCP directo puede ser más sencillo para una sesión o backends ligeros. La prueba ligera aumentó el working set sumado de procesos de 357.0 → 564.0 MiB; la primera solicitud compartida, desde iniciar un gateway nuevo hasta obtener un resultado útil, tardó 1886.7 ms frente a 503.5 ms directo. El beneficio neto depende de la sobrecarga. [BENCHMARK](../BENCHMARK.md#sharing-model-and-evidence)

<a id="first-use"></a>
## Primer resultado útil: una lectura autorizada a través del gateway

Requiere Node.js 24+, npm, Git, Copilot CLI con plugins e integraciones MCP ya configuradas y con su autenticación necesaria. La instalación inicial pasa por Copilot CLI; Windows es la plataforma principal de pruebas. La verificación varía según el cliente. [Copilot `/help` · `/plugin`](../CLIENTS.md#copilot-plugin-eligibility).

**Antes de instalar:** La configuración, el catálogo privado y las copias pueden contener credenciales: no los publiques. Los backends pueden contactar servicios remotos. Se instala un runtime persistente; restaurar la configuración o quitar el plugin no detiene el gateway. [REFERENCE](../REFERENCE.md#planned-exit) El estado privado local y los tokens guardados del gateway son accesibles solo al propietario, sin cifrado adicional.

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Abre Copilot CLI y ejecuta `/mcp-gateway-setup`. Revisa la vista previa y aprueba solo los cambios previstos. Conserva las copias privadas y los comandos de reversión. El plugin por sí solo no fusiona configuraciones.
2. Cierra y vuelve a abrir Copilot; ejecuta el `readinessCommand` exacto recibido siguiendo la explicación del objeto de comando. Una comprobación no inicia un gateway ausente. [readinessCommand](../REFERENCE.md#readiness-command-object) Guarda solo el objeto JSON devuelto; `.command` es el ejecutable aprobado y `.args` sus argumentos exactos en orden.
3. Elige una lectura inocua y autorizada en una integración existente. Sustituye solo la tarea entre corchetes; descubre los alias, herramientas y argumentos mediante el catálogo y esquema, sin inventarlos.

> Usa el gateway para [mi tarea de lectura autorizada]. Ejecuta `list_servers`, una búsqueda concreta con `search_tools` y `get_tool_schema`; prepara argumentos válidos con valores de prueba autorizados y no sensibles. Obtén las aprobaciones normales. Si `requiresExclusiveAccess: true`, usa `claim_server` una vez antes de `call_tool` y `release_server` cuando terminen todas las llamadas; los backends no exclusivos no necesitan reserva. Muestra el registro real o un resultado vacío documentado y comprueba errores, no solo la respuesta del gateway. Ante un resultado desconocido, no reintentes: mantenlo bloqueado y entrégalo en privado al responsable de instalación.

4. En una segunda sesión con el mismo conector y catálogo, busca el mismo alias: espera `ready` y las mismas capacidades. Comprueba descubrimiento compartido, no identidad de proceso ni ahorro de RAM. [MCP](../REFERENCE.md#first-shared-workflow) [Ejemplo público de echo y resultado](../REFERENCE.md#public-echo-illustration).

**Si falla:** Con un catálogo vacío, revisa configuración y vista previa; busca términos de las descripciones del backend. Sigue la referencia para autenticación o disponibilidad; no abras procesos paralelos para eludir el gateway. Liberar o desconectar no cancela ni desbloquea de forma segura un resultado exclusivo desconocido. Reconcilia el resultado, coordina el reinicio del gateway propio y vuelve a reservar. [Authentication](../REFERENCE.md#native-http-oauth) · [Recovery](../REFERENCE.md#setup-recovery) · [Unknown outcome](../REFERENCE.md#unknown-exclusive-result)

**Dejar de usarlo:** Termina los trabajos y llamadas, restaura o elimina los conectores de los clientes afectados y sigue la coordinación con el operador responsable para verificar que el gateway propio se detuvo. Revertir configuración no es detener el proceso. Conserva estado privado, credenciales, historial y procesos ajenos. [Exit](../REFERENCE.md#planned-exit)

<a id="clients"></a>
Esta es una descripción localizada. Los métodos, la procedencia de las cifras y las instrucciones completas están en inglés. El soporte nativo de clientes no certifica comprensión humana de esta traducción. [CLIENTS](../CLIENTS.md) · [REFERENCE](../REFERENCE.md) · [BENCHMARK](../BENCHMARK.md)

MIT — [LICENSE](../../LICENSE).
