# MCPGateway — 여러 코딩 세션에서 로컬 MCP 백엔드 공유

<a id="languages"></a>
<details>
<summary>Languages (16)</summary>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [العربية](README.ar.md) · [हिन्दी](README.hi.md) · [Bahasa Indonesia](README.id.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md)

</details>

여러 세션이 백엔드 한 세트를 공유해 메모리 중복과 반복 시작을 피합니다. 검증된 SDK/stdio 구성 변경 경로에서는 기존 MCP 연결을 유지합니다 (에이전트에서 게이트웨이로 이어지는 기존 연결).

[시작하기](#first-use) · [호환성(영어)](../CLIENTS.md#compatibility-summary) · [근거와 제한(영어)](../BENCHMARK.md) · [Copilot 업데이트](../CLIENTS.md#copilot-cli-upgrade)

<img src="../../assets/mcp-gateway-benefits.png" alt="중복 백엔드가 한 세트로 합쳐지고 시작 작업이 공유됨. SDK/stdio 실험에서는 작업이 끝난 뒤 소유한 게이트웨이를 재시작해도 기존 MCP 연결이 유지됨." width="780">

영어 레이블을 사용한 개념 그림입니다. 실행 화면이나 벤치마크가 아닙니다. [SVG](../../assets/mcp-gateway-benefits.svg)

- **중복 백엔드 메모리 피하기:** 5 × 1.5 GB 세트를 공유한다는 가정에서 게이트웨이·커넥터 추가 부담을 반영하기 **전** 6 GB 중복을 피합니다. 실측 순절감이 아닙니다.
- **백엔드 시작 작업 재사용:** 세션 5개가 모두 stdio 서비스 12개를 사용한다면 시작 횟수는 60 → 12회입니다. 시작 시간이 80% 빨라진다는 뜻이 아닙니다.
- **기존 MCP 연결 유지:** SDK/stdio 실험은 구성만 추가하고 작업을 끝낸 뒤 소유한 게이트웨이를 재시작해 기존 연결을 유지했습니다. 핫 리로드, 실행 중 호출의 연속성, 모든 제품의 대화 UI 검증이 아닙니다. 최초 등록·런타임 업그레이드는 클라이언트 재시작이 필요할 수 있습니다. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

<a id="resource-examples"></a>
**적합한 경우와 건너뛸 경우:** 같은 커넥터와 카탈로그를 공유하는 여러 세션에 적합합니다. 단일 세션이나 가벼운 백엔드에는 직접 MCP가 더 간단할 수 있습니다. 경량 테스트의 프로세스 작업 집합 합계는 357.0 → 564.0 MiB, 게이트웨이를 새로 시작하여 첫 공유 요청의 유용한 결과를 얻기까지는 1886.7 ms, 직접 연결은 503.5 ms였습니다. 순 자원 절감은 추가 부담에 달려 있습니다. [BENCHMARK](../BENCHMARK.md#sharing-model-and-evidence)

<a id="first-use"></a>
## 첫 유용한 결과: 공유 게이트웨이를 통한 허가된 읽기

Node.js 24+, npm, Git, 플러그인 지원 Copilot CLI와 구성·필요한 인증을 마친 MCP 연동이 필요합니다. 초기 설치는 Copilot CLI를 통하며 Windows가 주요 테스트 플랫폼입니다. 클라이언트별 검증 범위는 다릅니다. [Copilot `/help` · `/plugin`](../CLIENTS.md#copilot-plugin-eligibility).

**설치 전에:** 구성, 비공개 카탈로그와 백업에는 자격 증명이 포함될 수 있으므로 공개하지 마세요. 백엔드는 원격 서비스에 접속할 수 있습니다. 상주 런타임이 설치되며 구성 복원이나 플러그인 삭제는 게이트웨이를 종료하지 않습니다. [REFERENCE](../REFERENCE.md#planned-exit) 로컬 비공개 상태와 저장된 게이트웨이 토큰은 소유자만 접근할 수 있으며 추가로 암호화되지 않습니다.

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Copilot CLI에서 `/mcp-gateway-setup`을 실행하세요. 미리 보기를 검토하고 의도한 변경만 승인하세요. 비공개 백업과 롤백 명령을 보관하세요. 플러그인만 설치해도 구성이 병합되는 것은 아닙니다.
2. Copilot을 닫았다가 다시 열고 명령 객체 설명에 따라 반환된 정확한 `readinessCommand`를 실행하세요. 확인 전용 명령은 실행되지 않은 게이트웨이를 시작하지 않습니다. [readinessCommand](../REFERENCE.md#readiness-command-object) 반환된 JSON 객체만 저장하세요. `.command`는 승인된 실행 파일이고 `.args`는 순서를 그대로 유지할 정확한 인수입니다.
3. 기존 연동에서 무해하고 허가된 읽기 전용 작업을 선택하세요. 아래 괄호 안의 작업만 바꾸고 별칭, 도구, 인수는 검색과 스키마에서 얻으세요. 추측하지 마세요.

> 공유 게이트웨이로 [허가받은 읽기 전용 작업]을 수행하세요. `list_servers`, 범위를 좁힌 `search_tools`, `get_tool_schema` 순으로 사용하고 허가된 비민감 테스트 값으로 스키마에 맞는 인수를 준비하세요. 일반 승인 절차를 따르세요. `requiresExclusiveAccess: true`이면 `call_tool` 전에 한 번 `claim_server`, 모든 호출이 끝나면 `release_server`를 사용하세요. 비배타적 백엔드는 예약할 필요가 없습니다. 실제 레코드나 설명된 빈 결과를 보여 주고 오류를 확인하세요. 응답 수신만으로 성공을 판단하지 마세요. 결과가 불명확하면 재시도하지 말고 차단을 유지하며 설치 담당자에게 비공개로 인계하세요.

4. 같은 커넥터와 카탈로그를 사용하는 두 번째 세션에서 같은 별칭을 조회하세요. `ready`와 같은 기능이 예상됩니다. 공유 검색 확인이지 프로세스 동일성이나 RAM 절감 증명이 아닙니다. [MCP](../REFERENCE.md#first-shared-workflow) [공개 echo 예시와 결과](../REFERENCE.md#public-echo-illustration).

**실패 시:** 빈 카탈로그는 선택한 구성과 미리 보기를 확인하고 검색은 백엔드 설명의 용어를 사용하세요. 인증·준비 확인 실패는 참고 절차를 따르고 우회 프로세스를 시작하지 마세요. 배타적 호출의 결과가 불명확할 때 예약 해제나 연결 종료는 취소나 안전한 차단 해제가 아닙니다. 실제 결과를 대조하고 소유한 게이트웨이 재시작을 조정한 뒤 다시 예약하세요. [Authentication](../REFERENCE.md#native-http-oauth) · [Recovery](../REFERENCE.md#setup-recovery) · [Unknown outcome](../REFERENCE.md#unknown-exclusive-result)

**사용 종료:** 작업과 호출을 끝내고 관련 클라이언트 커넥터를 복원하거나 제거한 뒤 담당자 인계 절차에 따라 소유한 게이트웨이의 종료를 확인하세요. 구성 복원은 프로세스 종료가 아닙니다. 비공개 상태, 자격 증명, 기록과 무관한 프로세스를 보존하세요. [Exit](../REFERENCE.md#planned-exit)

<a id="clients"></a>
이 문서는 한국어 개요입니다. 방법, 수치 출처와 운영 상세는 영어 가이드에 있습니다. 네이티브 클라이언트 지원 범위가 한국어 이해에 대한 실제 사용자 검증을 뜻하지는 않습니다. [CLIENTS](../CLIENTS.md) · [REFERENCE](../REFERENCE.md) · [BENCHMARK](../BENCHMARK.md)

MIT — [LICENSE](../../LICENSE).
