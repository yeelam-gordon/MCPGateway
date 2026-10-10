# MCPGateway — 여러 코딩 에이전트 세션에서 로컬 MCP 서버 공유

[English](../../README.md)

> 이 문서는 현지화된 개요입니다. 전체 설치, 업그레이드 및 기술 세부 정보는 영어 [README](../../README.md)와 아래에 연결된 영어 클라이언트 가이드를 기준으로 합니다.

Copilot CLI 세션마다 같은 MCP 서버를 다시 시작할 필요가 없습니다. 이미 구성한 로컬 백엔드를 공유하고, 필요한 도구만 검색하며, 한 번에 하나의 세션만 접근할 수 있는 워크플로를 조정합니다. 기업용 API 거버넌스 플랫폼은 아닙니다.

**사전 요구 사항:** Node.js 24 이상, npm, Git, 플러그인을 지원하는 Copilot CLI와 이미 구성하고 인증한 MCP 서비스가 필요합니다. 현재 초기 설치는 Copilot CLI를 통해 진행합니다. Windows가 주요 테스트 플랫폼이며 Agency는 선택 사항입니다. 클라이언트마다 호환성과 검증 범위가 다릅니다.

게이트웨이는 에이전트에 항상 6개 도구를 제공합니다. 4개는 기능 검색과 호출에, 2개는 한 번에 하나의 세션만 접근할 수 있는 통합에 사용됩니다. 연결을 추가해도 초기 인터페이스는 커지지 않으며 전체 스키마는 선택한 도구에 대해서만 로드됩니다. 이미 구성하고 인증한 연결을 재사용하며 서비스 설치나 자격 증명 제공은 하지 않습니다.

예를 들어 Copilot의 연결 **10**개에 지원되는 Claude 구성의 새 연결 **2**개를 명시적으로 마이그레이션하면 두 에이전트가 연결 **12**개를 공유할 수 있습니다.

- 플러그인만 설치하면 구성은 병합되지 않습니다. 이름이 같고 별칭 정의도 동일한 항목만 중복 제거합니다. 같은 서비스를 가리키는 것만으로는 충분하지 않으며 충돌 시 검토를 위해 중지합니다.
- 먼저 미리 보기를 제공하고 백업을 만들며 지원하지 않는 네이티브 설정을 거부합니다.
- 모든 네이티브 클라이언트가 엔드투엔드 테스트를 마쳤다는 뜻은 아닙니다. [마이그레이션 가이드(영문)](../CLIENTS.md#cross-client-migration).

| 클라이언트 | 설치 | 업그레이드 |
|---|---|---|
| GitHub Copilot CLI | [설치](../CLIENTS.md#copilot-cli-install) | [업그레이드](../CLIENTS.md#copilot-cli-upgrade) |
| VS Code(편집기) | [설치](../CLIENTS.md#vs-code-install) | [업그레이드](../CLIENTS.md#vs-code-upgrade) |
| Claude Code | [설치](../CLIENTS.md#claude-code-install) | [업그레이드](../CLIENTS.md#claude-code-upgrade) |
| Codex CLI | [설치](../CLIENTS.md#codex-install) | [업그레이드](../CLIENTS.md#codex-upgrade) |
| OpenCode | [설치](../CLIENTS.md#opencode-install) | [업그레이드](../CLIENTS.md#opencode-upgrade) |
| Qwen Code | [설치](../CLIENTS.md#qwen-code-install) | [업그레이드](../CLIENTS.md#qwen-code-upgrade) |
| Kimi CLI | [설치](../CLIENTS.md#kimi-cli-install) | [업그레이드](../CLIENTS.md#kimi-cli-upgrade) |
| Antigravity CLI | [설치](../CLIENTS.md#antigravity-cli-install) | [업그레이드](../CLIENTS.md#antigravity-cli-upgrade) |

## 첫 설정과 도구 호출

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. 설치 후 Copilot CLI에서 `/mcp-gateway-setup`을 실행하세요. 미리 보기를 검토하고 의도한 변경만 승인하세요. Copilot을 닫았다가 다시 열고 반환된 정확한 `readinessCommand`를 실행하세요. 비공개 백업과 롤백 명령을 보관하세요.
2. `list_servers`에 `{}`를 전달하면 구성된 별칭, 상태와 배타적 접근 여부가 표시되어야 합니다. 권한이 있는 백엔드를 선택하고 `search_tools`로 작업 관련 용어를 검색한 뒤 `get_tool_schema`로 선택한 도구의 입력 스키마를 가져오세요. 스키마에 맞는 인수를 만들어 `call_tool`로 승인된 읽기 전용 작업을 수행하세요. 예상 결과는 실제 레코드 또는 설명된 빈 결과입니다. 오류도 확인해야 하며 응답만 받았다고 성공한 것은 아닙니다.
3. `requiresExclusiveAccess: true`이면 검색 전에 `claim_server`를 호출하고 모든 호출이 끝난 뒤 `release_server`를 사용하세요. 배타적 접근이 필요 없는 백엔드는 예약할 필요가 없습니다. 결과를 알 수 없는 시간 초과는 재시도하지 말고 진행 중인 작업을 검토한 뒤 재시작을 조정하세요. 결과가 불명확하면 배타적 접근이 필요한 백엔드는 게이트웨이를 재시작할 때까지 차단된 상태로 유지됩니다. 소유권 해제나 클라이언트 연결 종료로 안전하게 차단을 해제할 수 없으며, 연결 종료는 작업 취소가 아닙니다.

[전체 영어 예제](../../README.md#first-use) · [호환성](../CLIENTS.md#compatibility-summary)

## 제한, 개인정보와 복구

Claude Code, Codex, Gemini CLI, Kimi 또는 Qwen CLI로 이 저장소를 찾는다고 네이티브 통합이 보장되지는 않습니다. Gemini CLI 설치 경로는 없으며 Antigravity는 별도 클라이언트입니다. Kimi는 어댑터만 테스트했습니다. 구성과 백업에는 자격 증명이 포함될 수 있으므로 공개하거나 버전 관리에 커밋하지 마세요. 백엔드는 원격 서비스에 접속할 수 있습니다. 공유는 오프라인 실행이나 일정한 RAM·토큰 절감을 보장하지 않습니다.

목록이 비어 있으면 선택한 구성과 마이그레이션 미리 보기를 확인하세요. 검색 결과가 없으면 백엔드 도구 설명의 용어를 사용하세요. 인증이나 준비 상태 확인이 실패하면 운영 참고 자료를 따르고 우회 프로세스를 시작하지 마세요. 클라이언트 설정 복원은 상주 런타임 종료와 다릅니다. 사용 종료 시 소유자 인계와 완료 확인을 참조하세요.

[개인정보](../REFERENCE.md#state-and-privacy) · [복구와 롤백](../REFERENCE.md#setup-recovery) · [사용 종료와 소유자 인계](../REFERENCE.md#planned-exit)

설정은 먼저 미리 보기를 표시하고 승인 후에만 변경합니다. 비공개 백업, 준비 상태 확인 및 정확한 롤백 명령을 제공합니다. 구성과 백업에는 자격 증명이 포함될 수 있으므로 공개하거나 버전 관리에 커밋하지 마세요.

**운영 참고 자료(영문):** [운영 참고 자료 보기](../REFERENCE.md)

**라이선스:** [MIT](../../LICENSE)
