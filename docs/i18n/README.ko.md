# MCPGateway — 여러 코딩 에이전트 세션에서 로컬 MCP 서버 공유

<a id="languages"></a>
<details>
<summary>Languages / 语言 / 言語 / اللغات (16)</summary>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [العربية](README.ar.md) · [हिन्दी](README.hi.md) · [Bahasa Indonesia](README.id.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md)

</details>

세션 간 로컬 MCP 백엔드를 공유해 메모리 중복을 피하고 이미 실행 중인 백엔드를 재사용합니다. 백엔드 구성 추가 시 기존 에이전트 측 MCP 연결을 재시작 없이 유지합니다(SDK/stdio 경로; 실제 이점은 추가 부담에 따라 달라집니다).

[Copilot CLI로 시작](#first-use) · [클라이언트 검증](../CLIENTS.md#compatibility-summary) · [근거](#resource-examples)

<img src="../../assets/mcp-gateway-benefits.png" alt="리소스를 많이 쓰는 MCP 서버 프로세스를 함께 사용해 세션별 중복 실행과 메모리 사용을 피합니다." width="780">

영어 라벨의 개념 그림이며 실행 화면이나 벤치마크가 아닙니다.

- **중복 백엔드 메모리 피하기:** 가정 예시: 5 × 1.5 GB 세트를 하나로 공유하면 게이트웨이·커넥터 추가 사용량을 반영하기 **전** 6 GB 중복을 피합니다. 실측 절감이 아닙니다.
- **반복 시작 작업 재사용:** 세션 5개가 모두 stdio 서비스 12개를 사용하는 가정: 백엔드 시작 60 → 12회. 시작 시간이 80% 빨라진다는 뜻이 아닙니다.
- **구성만 추가하고 기존 에이전트 연결 유지:** SDK/stdio 초기화 1회를 유지하며 작업이 끝난 뒤 소유한 게이트웨이만 재시작합니다. 커넥터는 유지되며 핫 리로드나 제품별 대화 UI 검증이 아닙니다. 최초 등록·런타임 업그레이드는 클라이언트 재시작이 필요할 수 있습니다. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

같은 백엔드와 카탈로그를 쓰는 여러 세션에 적합합니다. 단일 세션이나 가벼운 백엔드에서는 추가 비용이 이점보다 클 수 있습니다.

<a id="first-use"></a>
## 첫 설정과 도구 호출

**사전 요구 사항:** Node.js 24 이상, npm, Git, 플러그인을 지원하는 Copilot CLI와 이미 구성하고 인증한 MCP 서비스가 필요합니다. 현재 초기 설치는 Copilot CLI를 통해 진행합니다. Windows가 주요 테스트 플랫폼이며 Agency는 선택 사항입니다. 클라이언트마다 호환성과 검증 범위가 다릅니다.

구성과 백업에는 자격 증명이 포함될 수 있습니다. 비공개로 보관하고 의도한 변경만 승인하세요.

[종료와 상주 런타임](../REFERENCE.md#planned-exit) · [클라이언트 구성 복원은 상주 게이트웨이를 종료하지 않습니다 (rollback ≠ daemon shutdown)](../REFERENCE.md#setup-recovery)

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. 설치 후 Copilot CLI에서 `/mcp-gateway-setup`을 실행하세요. 미리 보기를 검토하고 의도한 변경만 승인하세요. Copilot을 닫았다가 다시 열고 반환된 정확한 `readinessCommand`를 실행하세요. 비공개 백업과 롤백 명령을 보관하세요.

`readinessCommand`는 반환된 객체이며 명령 문자열이 아닙니다. `$readinessCommand`를 승인된 설정 결과의 해당 객체 그대로 설정한 뒤 아래 PowerShell 예제를 실행하세요. `.command`는 실행 파일 경로를, `.args`는 공백이나 따옴표가 있는 경로를 포함한 모든 인수를 순서대로 유지합니다. 배열을 한 인수로 합치거나 경로를 추측하지 마세요. 이 검사는 없는 게이트웨이를 시작하지 않습니다.

승인된 설정 결과의 `readinessCommand` JSON 객체만(전체 출력 아님) 비공개 현재 폴더의 UTF-8 `readiness-command.json`으로 저장하세요. 확인하고 승인한 `.command`와 모든 `.args` 값을 그대로 유지하고 합치거나 경로를 추측하지 마세요. 이 설정 JSON만 파싱하고 임의 웹·서비스 데이터는 사용하지 마세요. JSON 파싱은 코드 실행이 아닙니다. 인수 내용은 설정에 따라 달라지므로 파일을 비공개로 유지하세요.

```powershell
$readinessCommand = Get-Content -Raw -LiteralPath '.\readiness-command.json' | ConvertFrom-Json
$command = $readinessCommand.command
$commandArgs = @($readinessCommand.args)
& $command @commandArgs
```

탐색과 스키마 조회에는 배타적 이용 예약이 필요 없습니다. `requiresExclusiveAccess: true`이면 `call_tool` 전에 `claim_server`가 필요합니다.

> 공유 게이트웨이로 [허가받은 읽기 전용 작업]을 수행하세요. 구성된 서버를 나열하고 적절한 도구와 스키마를 확인한 뒤 허가된 비민감 테스트 값으로 인수를 준비하세요. 일반 승인 절차를 따르고 배타적 실행 전에 예약하며 호출이 모두 끝나면 해제하세요. 실제 결과를 보여 주세요. 결과가 불명확하면 재시도하지 말고 설치 담당자에게 인계하세요.

[SDK tool flow: `list_servers` → `search_tools` → `get_tool_schema` → `claim_server` (exclusive) → `call_tool` → `release_server`](../../README.md#first-use) · [REFERENCE](../REFERENCE.md#unknown-exclusive-result)

2. `list_servers`에 `{}`를 전달하면 구성된 별칭, 상태와 배타적 접근 여부가 표시되어야 합니다. 권한이 있는 백엔드를 선택하고 `search_tools`로 작업 관련 용어를 검색한 뒤 `get_tool_schema`로 선택한 도구의 입력 스키마를 가져오세요. 스키마에 맞는 인수를 만들어 `call_tool`로 승인된 읽기 전용 작업을 수행하세요. 예상 결과는 실제 레코드 또는 설명된 빈 결과입니다. 오류도 확인해야 하며 응답만 받았다고 성공한 것은 아닙니다.
3. `requiresExclusiveAccess: true`이면 호출 전에 `claim_server`를 호출하고 모든 호출이 끝난 뒤 `release_server`를 사용하세요. 배타적 접근이 필요 없는 백엔드는 예약할 필요가 없습니다. 결과를 알 수 없는 시간 초과는 재시도하지 말고 진행 중인 작업을 검토한 뒤 재시작을 조정하세요. 결과가 불명확하면 배타적 접근이 필요한 백엔드는 게이트웨이를 재시작할 때까지 차단된 상태로 유지됩니다. 예약 해제나 클라이언트 연결 종료로 안전하게 차단을 해제할 수 없으며, 연결 종료는 작업 취소가 아닙니다.
4. 두 번째 세션에서 같은 커넥터와 카탈로그를 사용해 같은 별칭으로 `list_servers` / `search_tools`를 반복하세요. 초기화된 백엔드는 `ready`이며 같은 카탈로그의 기능이 검색되어야 합니다. 별칭 일치만으로 프로세스 동일성이나 RAM 절감을 증명할 수 없습니다. 프로세스 재사용은 공개 테스트를 참고하세요. [프로세스 재사용 방법](../BENCHMARK.md#method) · [카탈로그 캐시 테스트](../../test/catalog-scale.test.js)

[전체 영어 예제](../../README.md#first-use) · [호환성](../CLIENTS.md#compatibility-summary)

## 제한, 개인정보와 복구

Claude Code, Codex, Gemini CLI, Kimi 또는 Qwen CLI로 이 저장소를 찾는다고 네이티브 통합이 보장되지는 않습니다. Gemini CLI 설치 경로는 없으며 Antigravity는 별도 클라이언트입니다. Kimi는 어댑터만 테스트했습니다. 구성과 백업에는 자격 증명이 포함될 수 있으므로 공개하거나 버전 관리에 커밋하지 마세요. 백엔드는 원격 서비스에 접속할 수 있습니다. 공유는 오프라인 실행이나 일정한 RAM·토큰 절감을 보장하지 않습니다.

목록이 비어 있으면 선택한 구성과 마이그레이션 미리 보기를 확인하세요. 검색 결과가 없으면 백엔드 도구 설명의 용어를 사용하세요. 인증이나 준비 상태 확인이 실패하면 운영 참고 자료를 따르고 우회 프로세스를 시작하지 마세요. 클라이언트 설정 복원은 상주 런타임 종료와 다릅니다. 사용 종료 시 소유자 인계와 완료 확인을 참조하세요.

[개인정보](../REFERENCE.md#state-and-privacy) · [복구와 롤백](../REFERENCE.md#setup-recovery) · [사용 종료와 소유자 인계](../REFERENCE.md#planned-exit)

<a id="resource-examples"></a>

**중복 백엔드의 메모리 사용 줄이기**

벤치마크가 아닌 가정 예시입니다. 에이전트 세션 5개가 각각 같은 연결 12개를 필요로 하고, 백엔드 전체 한 세트가 1.5 GB를 사용한다고 가정합니다. 호환되는 세션은 같은 커넥터와 카탈로그로 실제 백엔드 프로세스를 공유합니다.

| 구성 | 백엔드 메모리 |
|---|---|
| 각각 별도 실행 | 5 × 1.5 GB = 7.5 GB |
| 한 세트 공유 | 1.5 GB + 게이트웨이와 커넥터 추가 사용량 |

추가 사용량을 반영하기 전 중복 백엔드 메모리 감소량: 7.5 GB - 1.5 GB = 6 GB. 총 절감량은 측정 전에는 알 수 없습니다. 1.5 GB는 모든 작업이나 클라이언트에서 일정한 값이 아니며, 모델 5개의 메모리를 줄인다는 뜻도 아닙니다.

**시작 작업도 재사용합니다.** stdio 백엔드 12개를 세션 5개가 모두 사용하는 가정에서, 별도 실행은 최대 `5 × 12 = 60`회, 공유는 `12`회 시작합니다. 중복 시작 `60 - 12 = 48`회, 즉 `48 / 60 × 100 = 80%`를 줄입니다. 지연 연결에서는 실제 사용하는 `k`개만 연결하고 미사용 백엔드는 시작하지 않습니다. 시작 횟수 계산이지 80% 더 빠른 시작 시간이 아닙니다. 지연 시간은 측정하지 않았으며 동시 실행, 서비스 인증, 플랫폼에 따라 달라집니다.

백엔드 도구 1000개 → 초기 게이트웨이 정의 6개: (1000 - 6) / 1000 × 100 = 99.4%는 정의 개수 감소율이지 토큰 감소율이 아닙니다. 나중에 요청하는 스키마에도 비용이 들며, 이미 지연 로딩하는 클라이언트의 이점은 더 작을 수 있습니다. 합성 카탈로그 테스트는 도구 6개와 클라이언트 2개의 탐색 캐시 공유를 검증하지만 RSS 성능은 측정하지 않습니다. [catalog-scale.test.js](../../test/catalog-scale.test.js)

**경량 테스트 실측: 프로세스 작업 집합 합계 증가** Windows x64 / Node 24.13.1, 3회 중앙값: 공유 스키마 조회+echo는 콜드 백엔드 426.2 ms, 두 번째 클라이언트 21.1 ms, 다섯 번째 19.0 ms입니다. 첫 클라이언트 총시간은 직접 연결 503.5 ms, 게이트웨이 준비 후 공유 894.3 ms, 완전 콜드 공유 시작 1886.7 ms입니다. 백엔드 프로세스는 5 → 1이지만 총 프로세스는 5 → 7, 작업 집합 합계는 357.0 MiB → 564.0 MiB로 증가했습니다. 단일 echo 도구 테스트는 무거운 실제 서비스를 대표하지 않습니다. 위 1.5 GB는 별도 가정이지 실측값이 아닙니다. [BENCHMARK.md](../BENCHMARK.md)

측정값은 프로세스 작업 집합의 합계입니다. 중복을 제외한 물리 메모리와 전용 바이트(private bytes)는 측정하지 않았습니다.

<a id="mechanism"></a>

## 작동 방식

백엔드를 추가할 때 에이전트의 기존 MCP 연결을 재시작할 필요가 없습니다. 추가 구성을 동기화하고 작업을 마친 뒤 소유한 게이트웨이만 재시작하면 현재 커넥터가 다시 연결됩니다. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

SDK/stdio 테스트는 같은 커넥터와 MCP 연결로 게이트웨이 재시작 후 새 별칭을 찾고 echo를 실행했지만 제품별 대화 UI는 테스트하지 않았습니다. 자동 핫 리로드가 아니며 별칭 충돌은 검토해야 합니다. 최초 등록이나 런타임 업그레이드는 클라이언트 재시작이 필요할 수 있습니다. 중단된 호출은 재실행하지 않으며 재시작 후 배타적 이용을 다시 예약해야 합니다.

기업용 API 거버넌스 플랫폼은 아닙니다.

게이트웨이는 에이전트에 항상 6개 도구를 제공합니다. 4개는 기능 검색과 호출에, 2개는 한 번에 하나의 세션만 접근할 수 있는 통합에 사용됩니다. 연결을 추가해도 초기 인터페이스는 커지지 않으며 전체 스키마는 선택한 도구에 대해서만 로드됩니다. 이미 구성하고 인증한 연결을 재사용하며 서비스 설치나 자격 증명 제공은 하지 않습니다.

```text
에이전트 A ─┐                       ┌─ 연동 서비스 A: 여러 도구
에이전트 B ─┼─ 커넥터 ─ MCPGateway ─┼─ 연동 서비스 B: 여러 도구
에이전트 C ─┘                       └─ 연동 서비스 C: 여러 도구
```

여러 에이전트가 같은 커넥터로 MCPGateway에 접근하고, 구성된 백엔드 중 선택한 백엔드에 필요할 때 연결합니다. 이 그림은 공유 원리를 설명할 뿐 벤치마크나 실행 검증이 아니며, 모든 백엔드가 시작된다는 뜻도 아닙니다.

<a id="clients"></a>
## 클라이언트별 설치와 업그레이드

> 이 문서는 현지화된 개요입니다. 전체 설치, 업그레이드 및 기술 세부 정보는 영어 [README](../../README.md)와 아래에 연결된 영어 클라이언트 가이드를 기준으로 합니다.

<details>
<summary>클라이언트별 설치와 업그레이드</summary>

예를 들어 Copilot의 연결 **10**개에 지원되는 Claude 구성의 새 연결 **2**개를 명시적으로 마이그레이션하면 두 에이전트가 연결 **12**개를 공유할 수 있습니다.

- 플러그인만 설치하면 구성은 병합되지 않습니다. 이름이 같고 별칭 정의도 동일한 항목만 중복 제거합니다. 같은 서비스를 가리키는 것만으로는 충분하지 않으며 충돌 시 검토를 위해 중지합니다.
- 먼저 미리 보기를 제공하고 백업을 만들며 지원하지 않는 네이티브 설정을 거부합니다.
- 모든 네이티브 클라이언트가 엔드투엔드 테스트를 마쳤다는 뜻은 아닙니다. [마이그레이션 가이드(영문)](../CLIENTS.md#cross-client-migration).

| 클라이언트 | 설치 | 업그레이드 | 필수 초기 설치 | 검증 범위 |
|---|---|---|---|---|
| GitHub Copilot CLI | [설치](../CLIENTS.md#copilot-cli-install) | [업그레이드](../CLIENTS.md#copilot-cli-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [마켓플레이스/설치 경로; 격리 구성 파싱](../CLIENTS.md#compatibility-summary) |
| VS Code(편집기) | [설치](../CLIENTS.md#vs-code-install) | [업그레이드](../CLIENTS.md#vs-code-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [등록/형식 어댑터 테스트; 네이티브 전체 세션 미검증](../CLIENTS.md#compatibility-summary) |
| Claude Code | [설치](../CLIENTS.md#claude-code-install) | [업그레이드](../CLIENTS.md#claude-code-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [격리 구성 파싱 확인; 모델/백엔드 미실행](../CLIENTS.md#compatibility-summary) |
| Codex CLI | [설치](../CLIENTS.md#codex-install) | [업그레이드](../CLIENTS.md#codex-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [관리 정책으로 네이티브 검증 차단](../CLIENTS.md#compatibility-summary) |
| OpenCode | [설치](../CLIENTS.md#opencode-install) | [업그레이드](../CLIENTS.md#opencode-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [등록/형식 어댑터 테스트; 네이티브 전체 세션 미검증](../CLIENTS.md#compatibility-summary) |
| Qwen Code | [설치](../CLIENTS.md#qwen-code-install) | [업그레이드](../CLIENTS.md#qwen-code-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [등록/형식 어댑터 테스트; 네이티브 전체 세션 미검증](../CLIENTS.md#compatibility-summary) |
| Kimi CLI | [설치](../CLIENTS.md#kimi-cli-install) | [업그레이드](../CLIENTS.md#kimi-cli-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [등록/형식 어댑터 테스트; 네이티브 전체 세션 미검증](../CLIENTS.md#compatibility-summary) |
| Antigravity CLI | [설치](../CLIENTS.md#antigravity-cli-install) | [업그레이드](../CLIENTS.md#antigravity-cli-upgrade) | [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [등록/형식 어댑터 테스트; 네이티브 전체 세션 미검증](../CLIENTS.md#compatibility-summary) |

</details>

**운영 참고 자료(영문):** [운영 참고 자료 보기](../REFERENCE.md)

**라이선스:** [MIT](../../LICENSE)
