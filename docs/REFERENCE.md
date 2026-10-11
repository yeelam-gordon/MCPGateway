# Operational reference

This document contains detailed operating, recovery, ownership, and transfer guidance. Installation and upgrade instructions live only in [Client integration](CLIENTS.md).

## Contents

- [First shared workflow](#first-shared-workflow)
- [Tool discovery and capacity](#tool-discovery-and-capacity)
- [Concurrent terminal resume](#concurrent-terminal-resume)
- [Workflow ownership](#workflow-ownership)
- [State and privacy](#state-and-privacy)
- [Native HTTP OAuth](#native-http-oauth)
- [Planned exit and operator handoff](#planned-exit)
- [Setup recovery](#setup-recovery)
- [Cross-client migration recovery](#cross-client-migration-recovery)
- [Windows plugin cache: Access denied](#windows-plugin-cache-access-denied)
- [Adopting a development checkout](#adopting-a-development-checkout)
- [Configuration transfer](#configuration-transfer)
- [Operational invariants](#operational-invariants)

<a id="tool-discovery-and-capacity"></a>
## Tool discovery and capacity

The gateway exposes four discovery/execution tools and two ownership tools:

| Tool | Purpose |
|---|---|
| `list_servers` | List configured backend aliases and state without starting every backend. |
| `search_tools` | Search one named backend for matching tool names and descriptions. |
| `get_tool_schema` | Retrieve the full input schema for one selected tool. |
| `call_tool` | Invoke a selected tool while enforcing its configured allowlist and validating arguments. |
| `claim_server` | Reserve an exclusive backend for one client's complete workflow. |
| `release_server` | Release that backend after outstanding calls settle. |

Six is a design choice, not an MCP requirement. Separating discovery, schema lookup, and execution avoids returning large schemas when only a summary is needed.

With a 1,000-tool catalog, the gateway still advertises six initial tool definitions. It can search one backend, return a few summaries, fetch one schema, and invoke that tool without registering every discovered tool as a new native client tool.

The gateway may retrieve a backend's complete catalog internally and cache it in memory. Use focused searches: an empty or broad query can still return many summaries. The fixed tool count does not imply unlimited capacity or constant memory/token usage.

Concurrent first-use requests share one catalog fetch. Catalog discovery has one total deadline rather than a fresh full budget for every page. Cancelling one discovery request does not cancel another client's shared discovery.

## Concurrent terminal resume

Several agent sessions may start their connectors at the same time. They coordinate through the same gateway state directory and port: one starts the gateway, and the others verify and reuse it.

Startup has a **60-second** total coordination budget. Authenticated handshake attempts are capped at **5 seconds** within that budget, and startup permission checks allow up to **15 seconds** per shell invocation, clipped to the coordinator's remaining time. These are maximum waits, not fixed delays. Normal short lock waits do not launch process-inspection shells; prolonged waits use staggered birth-time checks to detect reused process IDs. The lock holder records its process identity, and clients still verify the gateway identity, configuration, and process before reuse.

Outside coordinated startup, owner-only Windows ACL checks default to **5 seconds** for PowerShell 7 and **15 seconds** for Windows PowerShell 5.1, allowing for its slower cold start. An explicit ACL budget overrides those defaults; a supplied deadline still clips each invocation to the remaining time. Timeouts fail closed without retrying ACL failures in another shell.

The preliminary owner record is fully written before exclusive lock publication, so interrupted preparation cannot publish partial JSON. If a previous owner exited while recording its identity, another client can recover that valid preliminary record. Complete provenance is published atomically, keeping the preliminary record intact until replacement succeeds. Transient Windows file-sharing errors during acquisition/publication are retried within bounded deadlines without changing permissions. Stale instance metadata is rechecked after acquiring the startup lock, allowing the new owner to finish publishing it. An active owner's lock is never taken over; unrelated listeners and mismatched configurations still fail explicitly.

These guarantees require all sessions to use the same current connector runtime and configuration. After upgrading, restart sessions that still hold an older connector. If a startup deadline is exceeded, inspect the connector error in the agent's log; do not delete live locks or start an independent gateway on the same port.

## Native HTTP OAuth

HTTP backends use the official MCP SDK's protected-resource discovery and validation. Generic providers retain SDK PKCE, registration and refresh support; verified Microsoft Entra authorities use supported Azure CLI or VS Code host credentials when selected, or `@azure/msal-node` public/confidential application providers. Agency is not required; existing Agency adapters remain opt-in. Backend names are arbitrary aliases, not authentication-provider selectors. An explicit `Authorization` header takes precedence and disables native OAuth for that backend. Stdio authentication is unchanged.

Ordinary gateway calls never open a browser. When they return `auth_required`, explicitly sign in using the same backend configuration and state directory as the gateway:

```powershell
node tools\authenticate-backend.mjs --server "my-mail-alias" --config C:\gateway\backends.json --state-dir C:\gateway\state
```

Sign-in defaults to a 180-second total deadline. `--timeout SECONDS` can shorten it; `--no-browser` prints the authorization URL for local manual opening. Treat that URL as sensitive. Cancellation, denial, invalid state and timeout close the callback listener without saving newly issued tokens. Successful sign-in verifies MCP initialization and tool discovery before publishing tokens.

**Microsoft API authorization boundary:** every Microsoft credential mode (registered MSAL, app-only, Azure CLI and VS Code) requires an independently operator-approved API binding before token acquisition. Set `oauth.resource` to the canonical API identifier (`https://…`, `api://…`, or an API GUID), or configure resource-qualified `oauth.scopes` whose non-OIDC scopes all target one API. These values authorize the API; matching server metadata and challenges alone do **not**. Resource identifiers reject credentials, query strings, fragments, whitespace and ambiguous paths. HTTPS hosts are not restricted to a guessed service list. Explicit configured scopes take precedence over metadata for initial selection. A different advertised/challenged API fails closed before host/MSAL acquisition and cannot replace the configured API.

For URL-only configuration, explicitly approve the identifier obtained from trusted deployment/operator configuration:

```powershell
node tools\authenticate-backend.mjs --server "my-mail-alias" --config C:\gateway\backends.json --state-dir C:\gateway\state --vscode --resource "api://YOUR-APPROVED-API-ID"
```

Missing binding returns `oauth_resource_binding_required`, not a demand for a new application or tenant. The helper publishes this trusted pin to private backend state only after authenticated initialization and discovery succeed; subsequent URL-only calls can reuse that saved pin/provider. Old unsolicited saved metadata is not a pin. Configured resource/scopes are part of credential and cache identity. `oauth.resource` is the Microsoft API scope base, **not** the backend MCP URL or the generic RFC 8707 `resource` parameter; generic OAuth behavior is unchanged.

If a tool returns `auth_required` with `requiredScopes`, explicitly pass each fully qualified scope using repeatable `--scope`:

```powershell
node tools\authenticate-backend.mjs --server "my-mail-alias" --config C:\gateway\backends.json --state-dir C:\gateway\state --vscode --resource "api://YOUR-APPROVED-API-ID" --scope "api://YOUR-APPROVED-API-ID/McpServers.Mail.Read"
```

All requested scopes must match the independent API pin. Explicit scope selection forces acquisition/consent even if the old token would still pass initialization/listing. Previously selected explicit permissions are preserved, `/.default` is not mixed with explicit scopes, account/tenant selection is retained, and new credentials/scopes publish only after initialization/listing succeeds. The helper never executes a tool or changes the catalog. Tool scope rejection returns an exact quoted helper recommendation; it never automatically retries a potentially mutating tool. Initialization/authentication is not approval to send mail.

For an unchanged backend/configuration identity, the private committed consent scope selection takes precedence over initial `oauth.scopes` on restart and silent acquisition. Configured scopes still independently pin the API and initialize first-time selection; changing them changes the credential/cache identity. An expanded selection never permits a different API.

Discovery follows RFC 9728 and RFC 8414/OIDC through the SDK. The MCP server's protected-resource metadata advertises its authorization server; that server's OAuth/OIDC metadata supplies the issuer and authorization/token endpoints, including tenant-specific endpoints where advertised. Discovery does not supply an arbitrary application's Entra client ID or choose a tenant on the operator's behalf.

Generic client identity comes from standards-based dynamic client registration (DCR), when supported, a supported client-ID metadata document, or `oauth.clientId`. Without registration support or an explicit client identity, authentication fails with an actionable registration error.

Entra is selected automatically for an advertised, verified `https://login.microsoftonline.com/organizations/v2.0` or tenant-specific v2.0 authority. Only that exact Microsoft public-cloud host is supported, with matching issuer and authorization/token endpoints. The Microsoft organizations issuer template is retained as advertised, not rewritten into generic metadata. MSAL owns Microsoft authority discovery, instance validation, PKCE, account/tenant cache metadata and token acquisition; access tokens are opaque to the gateway. Optional `oauth.provider: "entra"` requires the same verified Microsoft discovery and cannot bypass validation. No tenant entry is required: organizations or the advertised tenant authority is used.

Microsoft tenant GUIDs and supported tenant selectors are canonicalized for authority comparison, including the tenant segment in verified issuer and endpoint URLs. This accepts equivalent GUID spelling without allowing a different tenant, cloud, endpoint path, query or credentials. Generic OAuth issuer comparison is unchanged.

**Microsoft Azure CLI host credentials:** select `oauth.credentialProvider: "azure-cli"`, or explicitly run the helper with `--azure-cli` (the verified selection is remembered for this backend). This supported `az account get-access-token --scope` interface does not require a new gateway publisher application. Install the official Azure CLI and sign in to an account with permission/consent for the MCP server's advertised API scopes. It is not a universal resource-access promise. The gateway verifies Microsoft public-cloud discovery and SDK protected-resource binding, requests the exact challenged/advertised resource-qualified scopes in one argument, and never substitutes ARM or Graph scopes. Generic issuers cannot use this provider.

Configured `oauth.clientId` or `SHARED_MCP_ENTRA_CLIENT_ID` takes precedence over host-provider selection; static Authorization headers still disable native authentication. Without a selected host provider, the registered MSAL path requires a publisher/deployment public application, exact loopback redirect and permissions/consent. Its missing-registration error applies to that path, not to every Microsoft credential route. No Copilot, VS Code or WorkIQ cache is imported, and no first-party application ID is copied or guessed.

When the explicit helper successfully commits a different host provider for the same backend, it removes the prior host-provider selection. Without an explicit configured provider, ordinary reload selects the last successfully committed provider; switching in either direction does not introduce an automatic host-provider default.

**Microsoft VS Code host credentials (Windows, explicit opt-in):** select `oauth.credentialProvider: "vscode"` or run the helper with `--vscode`. A packaged development extension calls the public `vscode.authentication.getSession('microsoft', resourceScopes, { createIfNone: true })` API. Microsoft VS Code must be installed, the user must allow this extension, and the editor's existing Microsoft provider must be authorized for this API. This is **not a universal resource-access promise** and does not create a gateway application. An isolated owner-only profile under the gateway OAuth directory uses `microsoft-authentication.implementation: "msal-no-broker"`, disables telemetry and extension updates, and never copies the normal editor profile or authentication cache. The normal editor's windows and settings are untouched. `--device-code` and `--no-browser` are not supported with this provider.

Microsoft sign-in/consent correctly identifies **Visual Studio Code**, because this route uses the editor provider's registered Microsoft application identity, not a standalone gateway application identity. The extension permission identifies Shared MCP Gateway Authentication separately. No new Entra application registration is created by the gateway; normal organizational consent may grant access through an existing enterprise application. This editor dependency is strictly opt-in, never an automatic substitute for the publisher-registered MSAL mode. The host-provider proof does not establish standalone, registration-free MSAL authentication.

The helper uses verified Microsoft public-cloud discovery, SDK resource binding and one advertised API scope base; a validated `McpServers.*` HTTP 403 hint can request one explicit consent step-up. The local callback requires a random 32-byte bearer nonce, exact loopback Host/path/method, no browser Origin, bounded JSON and request-time/resource binding. Tokens are never printed. Only after native MCP initialization and tool discovery succeeds is the opaque access token and hashed account/resource/provider selection published to owner-only gateway state. The public API supplies no expiry or refresh token: no lifetime is invented and no JWT is decoded for trust. Ordinary gateway calls use that credential without launching VS Code or authentication UI; expiry or HTTP 401 requires the explicit helper again, without a refresh loop. Acquisition has a 60-second startup bound and the helper's total at-most-180-second deadline. Cleanup asks only the isolated window to close, then targets only verified editor processes with the exact profile marker/start time and their proven same-executable children; cleanup failure is explicit. The helper assets are included in the content-hashed stable runtime.

Cleanup reserves 17 seconds within the helper deadline: a brief extension-driven window-close grace followed by at most 15 seconds for PowerShell verification. It recognizes the installed bootstrap and its hexadecimal-version-directory editor executable, requires the exact isolated `--user-data-dir` argument and launch time, and follows only proven same-install editor descendants. It requests graceful window closure before exact-PID termination, checks process identity against recorded creation time/path, and verifies that no owned processes remain. An already-closed window is a verified empty result, not a null-PID failure. An exhausted deadline or absent verification is still an explicit cleanup error.

A live prototype using the public VS Code Microsoft API with the metadata-qualified `McpServers.Mail.All` scope returned a bearer credential accepted by the candidate gateway's real raw-HTTP Mail path. Authenticated discovery/schema lookup, a read-only `SearchMessagesQueryParameters` request selecting one message ID, and a second SDK client reconnect/search succeeded without Agency, a new application or a borrowed client ID. The isolated profile closed without cleanup error. After the expert-reviewed privacy, independent API-binding, scope-restart and visible-GUI corrections, the candidate also passed the genuine packaged `--vscode` helper with explicitly approved `--resource`, initialization/discovery of 22 tools, an authorized Mail read and a separate gateway reconnect. These are live results for that tested candidate, not fixture claims or universal API access. Subsequent source changes, including access-token validation hardening, require fresh review and real-gate verification before release; authentication profiles and caches are never copied.

Azure CLI remains opt-in and is **not verified as a working Mail credential provider**. Live Mail scope acquisition returned `AADSTS65002`: the selected Azure CLI provider is not preauthorized for that API/scope. This is reported as `oauth_provider_not_preauthorized`, not a request to register a gateway application, obtain a user/admin consent grant, or sign in again. A separate supported Copilot native SDK diagnostic completed authenticated Mail read and reconnect without a new application or Agency; that establishes service access in Copilot's own host context, not bearer-token availability or transparent raw-HTTP authentication for this gateway.

CLI silent acquisition is bounded to 25 seconds, caches access tokens in memory only, renews before expiry and shares concurrent acquisition. Owner-only gateway state retains selection metadata (provider, cloud authority, resource, scopes and CLI-returned tenant), not CLI access/refresh tokens or cache files. Ordinary calls never run `az login`; interaction-required errors give the helper command with `--azure-cli`. The explicit helper first tries existing credentials, so an already-signed-in account does not open a browser. When needed it runs supported `az login --scope ... --allow-no-subscriptions` with child-local `AZURE_CORE_ENABLE_BROKER_ON_WINDOWS=false` and `AZURE_CORE_LOGIN_EXPERIENCE_V2=off`: default-system browser rather than WAM, with the helper's total 180-second deadline. `--device-code` explicitly selects `--use-device-code`; `--no-browser` requires that mode. CLI owns its own sign-in cache; the gateway never imports it, clears accounts or writes global CLI configuration. Cancellation terminates the owned CLI process, never shared browser or broker hosts. The helper verifies native MCP initialization and tool discovery before committing the provider selection; a real permitted read and reconnect remain the separate release gate.

Azure CLI tenant GUIDs are canonicalized to lowercase for selection comparisons and account-key hashing. A legacy case-sensitive hash is migrated only when the supported `az account show` identity reproduces that hash using its exact saved tenant spelling and the selection belongs to this backend. A different account, tenant or borrowed alias selection is rejected; user names are not guessed or case-folded.

Use `--azure-cli --force-login` to explicitly run the supported CLI login flow even when cached tokens are available. This helper-only option cannot override registered-client or static-header precedence. Login may use the actual tenant GUID from the existing delegated `AzureCloud` profile returned by `az account show`; the Entra `organizations` issuer alias is never forwarded as a CLI tenant. With no existing profile or advertised concrete tenant, no tenant is supplied or guessed. Before login, an existing default subscription must have a validated ID; the helper reserves a bounded five-second cleanup window and restores that exact default with supported `az account set`, including after login failure/cancellation. An unsafe profile or restoration failure is explicit, not success-shaped. HTTP errors report only status and `discover`, `token`, or `backend` phase, never raw error bodies, account details or URLs. Browser login and token acquisition alone do not establish native Mail readiness.

**Microsoft scope step-up:** a verified Microsoft resource may return HTTP 403 without `WWW-Authenticate`, with the precise JSON error message `Access denied: Scope 'McpServers.<service>.<permission>' is not present in the request.` The gateway retains only that strictly validated scope name internally before redacting the body. It qualifies the name using the single API scope base in SDK-verified resource metadata, never a decoded token audience or Graph fallback. Standard explicit `insufficient_scope` challenges remain authoritative. Ordinary calls return structured `auth_required` with `requiredScopes` and the explicit helper command; they do not request the new permissions or open UI. Only explicit authentication performs bounded host login/consent for the server-required scopes, replacing `/.default` rather than mixing default and explicit API scopes. Scope selection survives subsequent requests and a later same-resource `/.default` challenge, and is published only after authenticated MCP initialization and tool discovery. A second body-based denial fails closed instead of looping or inventing another resource. Organizational consent/policy can still deny access; no admin grants are automated.

Agency is separate from this native OAuth path. Its existing builtin mail adapter is service-specific, not a universal Entra authenticator, and is not assumed to know arbitrary tenant IDs or client IDs. For a pre-registered public client (including Entra deployments without dynamic registration), configure:

```json
{
  "mcpServers": {
    "my-mail-alias": {
      "url": "https://mcp.example.com/mcp",
      "oauth": {
        "clientId": "YOUR-REGISTERED-PUBLIC-CLIENT-ID",
        "scopes": ["offline_access", "YOUR-API-SCOPE"],
        "redirectPort": 7340
      }
    }
  }
}
```

Register the exact redirect URI `http://127.0.0.1:7340/oauth/callback` with your identity provider. The port defaults to 7340 and must be available. Registered-client Entra authentication requires a suitable application registration, API permissions and possibly tenant/admin consent; no tenant or client ID is guessed. An optional HTTPS `oauth.clientMetadataUrl` with a non-root path supports servers advertising client-ID metadata documents. Server-advertised challenge/resource scopes take precedence over configured fallback scopes, as specified by the SDK.

**Generic registered confidential clients:** set `oauth.clientId`, `oauth.issuer` (the exact trusted authorization-server issuer), and `oauth.tokenEndpointAuthMethod` to `client_secret_basic`, `client_secret_post`, or `private_key_jwt`. Secret authentication requires `oauth.secretEnv`, naming an existing gateway-process environment variable; inline secrets are rejected. JWT authentication instead requires an absolute `oauth.privateKeyPath` to an operator-protected, unencrypted RSA PKCS#8 private key (at least 2048 bits), `oauth.alg` (`RS256` or `PS256`), and the registered `oauth.kid`. Do not combine secret and key references or use client-ID metadata documents for confidential clients. Discovery must match the configured issuer and advertise the exact authentication method; there is no downgrade. Credentials are loaded only for the verified token or explicit device-authorization endpoint, not metadata or MCP requests, and are not stored in the token file or catalog. Code exchange and refresh use the same configured method. SDK 1.30's private-JWT helper supplies endpoint audience and 60-second claims; because it omits `kid`, the gateway explicitly re-signs those claims with the registered algorithm/key ID.

**Generic service accounts:** additionally set `oauth.grantType: "client_credentials"` and omit `redirectPort`. The default grant is `authorization_code`. Use a registration and API permissions that actually support app-only access; no delegated identity or Graph audience is invented. Service tokens use the SDK `ClientCredentialsProvider`/`fetchToken`, the validated protected-resource parameter, and challenge scopes before resource metadata/configured fallback scopes. No browser, callback listener, DCR or tool execution is needed for acquisition. The explicit helper verifies initialization and lists tools before committing credentials. Ordinary calls can acquire/renew service credentials automatically; expired tokens or tokens within 30 seconds of expiry renew before the MCP request. Missing/unsafe lifetimes and rejected credentials fail closed. Token cache reuse is bound to issuer, token endpoint, client, resource and exact scopes; same-provider acquisition is singleflight and the existing owner lock excludes competing processes, which must retry after `oauth_busy` and then reload durable state.

Generic service scope/binding changes are part of the credential generation and publish atomically with the token under the same lock/revision checks, even when the authorization server returns identical token JSON. An obsolete request cannot mutate or force-persist a newer binding. Interactive service acquisition stages its selection until initialization/discovery succeeds.

Absolute expiry is also part of the credential generation and publication/no-op tuple. A genuine new token HTTP response records its acquisition expiry once, even for identical token payload and binding; SDK duplicate saves reuse that response's recorded expiry rather than extending the lifetime during verification. Cached responses preserve their known absolute expiry, and explicitly supplied MSAL/CLI absolute expiry remains authoritative. Stale-generation and revision guards still precede publication.

**Microsoft Entra app-only:** use `oauth.provider: "entra"`, a registered `oauth.clientId`, `oauth.grantType: "client_credentials"`, and omit `redirectPort`. MSAL's supported `ConfidentialClientApplication.acquireTokenByClientCredential` handles acquisition, never the generic JWT helper. For a secret, select `oauth.tokenEndpointAuthMethod: "client_secret_post"` and `oauth.secretEnv` (an existing environment-variable name). For a certificate, select `private_key_jwt`, an absolute `oauth.privateKeyPath` to an operator-protected unencrypted RSA PKCS#8 key of at least 2048 bits, and `oauth.certificateThumbprintSha256` (64 hexadecimal characters identifying the certificate uploaded to that registration). Do not set generic `alg` or `kid`; MSAL owns certificate assertion signing, SHA-256 thumbprint headers and token-endpoint audience. Basic authentication is not downgraded to POST.

App-only requires a tenant-specific Microsoft public-cloud authority. If the resource advertises `organizations`, the operator must supply `oauth.authority`, for example `https://login.microsoftonline.com/YOUR-TENANT-UUID` (without `/v2.0`). No account token or tenant is guessed. An advertised tenant-specific authority must match the configured authority exactly; host hints cannot override verified resource discovery. Optional `oauth.issuer` must equal the advertised v2.0 authorization-server URL. Provide one explicit resource-qualified `/.default` scope through challenge/resource metadata or `oauth.scopes`, appropriate API **application** permissions and admin consent, and an MCP server that actually accepts application identities. Delegated scopes are not converted and Graph tokens are not substituted. Discovery advertising an unsupported grant or authentication method fails closed.

App-only has no browser, callback, account, device-code flow or refresh-token requirement. Expiring and rejected tokens reacquire service credentials using MSAL; concurrent acquisition shares one operation and the existing private owner lock. Its accountless serialized cache is bound to client, tenant authority, protected resource and exact scopes. The explicit helper still commits tokens only after authenticated initialization and tool discovery. No claim is made that delegated Mail MCP tools accept service tokens. A real native M365 read-only call and reconnect remain mandatory release gates; local fixtures are not evidence of live Microsoft access. WAM remains unimplemented and production-unverified; no broker package, native UI, registration or cancellation support is claimed by this stage.

Dynamic registration responses and cached client registrations must omit `client_secret` and either omit `token_endpoint_auth_method` or set it to `none`. Confidential registrations are rejected before storage or use, without including credential values in errors. An authorization server may advertise confidential methods alongside public-client support; those capabilities alone are not rejected.

Private OAuth files live under `STATE_DIR\oauth`, with owner-only permissions and atomic replacement. Tokens, registration and discovery are isolated by exact backend URL, alias and OAuth configuration; tokens are never imported from Copilot or Agency. Entra stores MSAL's serialized cache in the same private transaction, binding it to publisher client identity, authority, protected resource, scopes and MSAL account/tenant metadata. It is owner-only, not additionally encrypted. Rotated MSAL cache and access tokens are published atomically after refresh, or after successful MCP verification for explicit sign-in. Changing the deployment client ID prevents old access-token reuse. Generic refresh tokens survive responses that omit a replacement. Concurrent calls within one backend share a refresh, and stale failures cannot invalidate a newer token generation. Expired access tokens remain syntactically valid on the wire so a normal 401 challenge can trigger refresh; the gateway never synthesizes an empty bearer credential.

Entra uses independently operator-bound resource-qualified scopes, preferring explicit `oauth.scopes` for initial selection and accepting metadata/challenges only within the approved API resource. It does not assume global Graph permissions or send the generic SDK `resource` token parameter. The explicit helper uses browser authorization code with MSAL PKCE and the existing bounded loopback callback; `--no-browser` supports manual local opening. For headless Microsoft sign-in, add `--device-code`: MSAL supplies a verification URL and one-time user code, without opening a browser or binding a callback port. Device-code acquisition shares the total sign-in deadline, cancellation and private-cache publication rules. Treat the user code as sensitive. Publisher registration must permit public-client device-code flows, and organizational policy may prohibit them. WAM is not implemented. Ordinary calls never initiate device-code sign-in and only reuse credentials or perform MSAL silent acquisition/refresh.

**Windows broker (WAM) deferred: supported-API deadline blocker.** The pinned `@azure/msal-node` 7.0.1 supports `broker.nativeBrokerPlugin` and public-client interactive/silent acquisition. The official `@azure/msal-node-extensions` 5.5.2 exports `NativeBrokerPlugin` implementing that interface; both packages use `@azure/msal-common` 16.14.2, and the extension's Node >=20 requirement fits this gateway's Node >=24 requirement. This establishes package/API shape compatibility, not a successful native-binding or live sign-in test. Microsoft's [broker documentation](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-node/docs/brokering.md) requires a gateway publisher-owned public registration with redirect `ms-appx-web://Microsoft.AAD.BrokerPlugin/{clientId}`. The client ID must come from `oauth.clientId` or `SHARED_MCP_ENTRA_CLIENT_ID`, never another application's identity. Broker refresh tokens remain device-bound and inaccessible to the gateway.

The inspected 5.5.2 plugin's `acquireTokenInteractive(request, windowHandle)` returns a Promise without a public cancellation handle; neither MSAL's `InteractiveRequest` nor the plugin's `NativeRequest` exposes a timeout or abort signal. The plugin discards the `AsyncHandle` returned by native acquisition. Its runtime dependency `@azure/msal-node-runtime` 0.20.0 declares `AsyncHandle.CancelAsyncOperation`, but explicitly states that direct use is unsupported. Thus this supported plugin API cannot enforce the helper's at-most-180-second deadline with guaranteed native UI cancellation. An abort controller or `Promise.race` would only stop waiting, not cancel WAM; terminating an owned helper would not by itself prove closure of shared broker UI or prevent broker-side account/cache changes. No process-isolation wrapper is implemented, and shared WAM hosts must never be killed. Also, the actual MSAL 7.0.1 implementation can fall back to a browser/loopback listener when plugin startup is unavailable, so any future broker-only mode must reject that condition before acquisition. There is no `--broker` or `oauth.broker` option, optional broker dependency, native UI or broker silent-refresh path in this gateway. Use the existing explicit browser or `--device-code` flow instead. WAM remains blocked pending a supported cancellable API or proven bounded isolation, publisher registration, and real native UI, timeout/cancellation and authenticated MCP verification; fixtures do not satisfy those live gates.

**Generic explicit device authorization (RFC 8628):** `--device-code` requires a discovered `device_authorization_endpoint` and, if advertised, a supported `urn:ietf:params:oauth:grant-type:device_code` grant. Missing or unsupported capabilities fail explicitly, without falling back to a browser or starting a callback listener. Pre-registered public/confidential clients, public DCR and advertised client-ID metadata documents reuse the same validated discovery. Device initiation sends the authoritative challenge/resource/configured fallback scopes and SDK-validated RFC 8707 resource; confidential clients authenticate at the verified device endpoint and token endpoint using their selected method. Polling uses SDK `fetchToken` with actual form parameters, waits the advertised interval (default five seconds), and adds five seconds after each `slow_down`. Denial, expiry, cancellation and the at-most-180-second deadline stop acquisition; tokens are committed only after authenticated MCP initialization and tool discovery. Only the intentional local prompt receives the verification URL and user code; the private device code is neither logged nor stored. Do not combine `--device-code` with `client_credentials`.

Expiry of the device grant itself returns `oauth_device_expired`, including while sleeping or awaiting a token response; helper cancellation/deadline remains `oauth_cancelled`. The owned expiry timer is cleared on exit, and expiry creates no pending credentials. The VS Code callback reserves its one completion slot after validating the nonce and request headers but before awaiting the body: concurrent authorized streams cannot both complete. An authenticated malformed completion consumes that slot without publication; bad nonces, readiness and status requests do not reserve it.

Generic browser callbacks validate RFC 9207 `iss` against the exact discovered issuer before exchanging the code. A server advertising `authorization_response_iss_parameter_supported: true` requires one issuer parameter; otherwise omission remains compatible. Present issuers must always match exactly, and duplicates are rejected. Verified OIDC discovery extensions are retained only for the selected metadata; this does not introduce ID-token login or alter MSAL's independent Microsoft authority handling.

Credential-state writes and refreshes use an exclusive per-backend file lock. Explicit sign-in holds that lock until verification and publication finish; competing sign-ins or cross-process refreshes fail closed rather than overwrite credentials. A revision check rejects writes based on stale private state. Retry after the active operation finishes. An interrupted process can leave a lock: recovery requires confirming that no gateway or sign-in operation still owns it before removing that exact backend's `.lock` file. Locks are not automatically stolen based on age. Resource binding is validated with the SDK before discovery is saved; previously cached mismatched resource metadata is discarded and rediscovered.

Cancellation first aborts the transport, then waits for its provider's tracked credential operations and owned staging-file cleanup before releasing the helper lock or returning. SDK request cancellation alone is not a cleanup barrier, including SDK initialization's detached `close()` call; the helper explicitly awaits its provider barrier as well. Already-aborted operations cannot start new credential writes or token saves; in-flight publication rechecks cancellation before staging and rename. The drain is capped at 5,000ms, clipped to a still-positive remaining flow deadline; after that deadline expires, the same bounded cleanup grace applies. An unsettled vendor or filesystem operation returns `oauth_cleanup_uncertain` with `credentialLockPath`, retains the helper's proven owner lock, and does not claim complete cleanup or undo an uninterruptible publication. Cleanup waits for actual owned-operation settlement, not a fixed sleep or success-shaped retry.

All new access tokens use one shared opaque-token validator before credential selection or token state is changed or published. Empty/non-string tokens, whitespace, control characters and characters that cannot be carried in an HTTP byte-string header fail with a constant `oauth_invalid_token` message, without trimming or echoing the token. No JWT format or decoded token audience is required. Invalid service renewals preserve prior valid credentials; invalid device grants create no pending token/selection. An explicitly requested API `/.default` remains valid when it is the sole API scope (OIDC scopes may accompany it); it is removed only when mixed with named API permissions.

Use HTTPS for remote services; HTTP is limited to loopback. HTTP redirects are rejected, and SDK resource validation remains enabled. Transfer packages explicitly reject native `oauth` configuration: register/configure and sign in separately at the destination. Existing conservative client-managed OAuth migration restrictions still apply. Authentication errors and `--help` show the helper's absolute runtime path, so invocation does not depend on the caller's working directory.

The exact backend notification GET (`Accept: text/event-stream`) has a bounded wait for response headers. Once successful SSE headers arrive, its body remains open until transport/controller cancellation or server closure. Discovery, other GETs, POST bodies and non-SSE responses retain their request deadlines; redirects remain rejected. Off-backend requests strip inherited backend headers, authorization and session credentials while preserving independently generated SDK/MSAL protocol headers and verified registered-client Basic authentication. Pending token expiry is captured at acquisition (using MSAL's absolute expiry where available); verification and later atomic publication never extend that lifetime.

<a id="workflow-ownership"></a>
## Workflow ownership

Set `requiresExclusiveAccess` on a backend that needs one client to own shared state across several tool calls:

```json
{
  "mcpServers": {
    "browser": {
      "command": "node",
      "args": ["browser-server.mjs"],
      "requiresExclusiveAccess": true
    }
  }
}
```

This is a gateway configuration setting, not a standard MCP input-schema field. Statefulness alone does not imply exclusive ownership; a backend with isolated client sessions may not need it.

`list_servers`, `search_tools`, and `get_tool_schema` expose the resolved requirement. Discovery and schema lookup do not require a claim. For an exclusive backend, claim once for the complete workflow:

```text
claim_server({ "server": "browser" })
call_tool({ "server": "browser", "tool": "navigate", "arguments": { ... } })
call_tool({ "server": "browser", "tool": "screenshot", "arguments": { ... } })
release_server({ "server": "browser" })
```

The claim covers all calls to that backend, not one tool. Other exclusive backends have independent ownership. Backends without the requirement are called normally.

For compatibility, an existing backend named exactly `playwright` remains exclusive when the setting is omitted. Explicit `true` or `false` overrides that default; other aliases default to `false`. Migrations and transfers preserve the setting.

Release waits for outstanding calls to settle. Disconnect releases an idle claim. If a call times out with an unknown outcome, that exclusive backend remains blocked until the gateway restarts; disconnecting or reclaiming cannot permit another workflow to race the unfinished operation.

A tool POST confirmed rejected by an HTTP 401/403 authentication challenge before acceptance is a known nonexecution failure: its lease can be released and used again after explicit reauthentication without restarting the gateway. Authentication errors from notification GETs, accepted tool POSTs, or ambiguous network failures do not receive this exception.

Inactive abandoned client sessions expire. Normal connectors send a lightweight heartbeat while connected. Expiration does not interrupt an active call or release a backend whose last operation has an unknown outcome.

If a reboot, daemon replacement or suspended client leaves an obsolete gateway HTTP session, the connector rebuilds it on a confirmed `invalid_session` response. Discovery and heartbeat can also rebuild after a refused or interrupted local gateway connection; auto-start verifies or starts only the owned daemon. Concurrent recovery shares one initialization. Connector shutdown cancels pending initial auto-start and recovery, including lock waits, probes and owner-only ACL subprocesses, and prevents later daemon launches or HTTP session initialization; another client's live startup lock is left untouched. While starting, the connector retains up to 1 MiB of incoming MCP bytes and replays them once when ready, so it can observe EOF without losing buffered initialization requests. `--check` ignores stdin and stdin EOF. Only discovery (`tools/list`, `list_servers`, `search_tools`, `get_tool_schema`) and the heartbeat may be retried once. Downstream calls, claims and releases are never replayed automatically; connection loss reports an unknown outcome, while a confirmed invalid session reports lost workflow ownership. Unrelated HTTP errors and request cancellations retain their existing handling.

After outstanding requests settle, retirement sends a bounded authenticated session DELETE before closing its local client, so a still-valid old session cannot retain an idle exclusive claim. This is transport cleanup, not replay of a claim/release tool; active calls and unknown-outcome latches remain protected by the gateway. Replacement handshakes observe connector shutdown immediately, while cleanup DELETEs use an independent bounded signal so already-minted sessions can still be removed.

Clients upgrading from 0.3 must replace `claim_playwright` and `release_playwright` with `claim_server` and `release_server`, each with a `server` argument. A running older runtime retains its old tools until explicitly upgraded.

<a id="unknown-exclusive-result"></a>
### Unknown exclusive result: operator handoff

Keep the backend blocked. Send a **private** request to the installation owner containing backend alias, tool name, call time or provided request ID, observed unknown/error status, owned setup instance/state directory/port and other active-work status. Do not include arguments, results containing private data, credentials or tokens.

> Please reconcile downstream side effects for this unknown call, agree an idle window, and restart only the verified owned gateway using the approved installed-version lifecycle method. Return outcome-reconciliation status, old/new owned-instance identity and exact setup readiness evidence. Do not replay the call or assume restart cancelled it.

If downstream reconciliation or ownership is unavailable, record **unresolved/blocked**, not successful recovery. Finish other workflows before an approved owned-instance restart; never stop unrelated processes or bypass the gateway. After replacement, verify the intended owned instance and exact readiness result, then obtain a **new claim** before any further exclusive execution. Restart clears coordination state; it does not undo side effects, cancel an operation or authorize replay. Release/disconnect cannot safely clear an unknown-outcome block. No universal restart CLI is documented here; use the installation owner's approved lifecycle route.

<a id="state-and-privacy"></a>
## State and privacy

Microsoft Code/`az` authentication children receive an explicit environment allowlist, not the gateway's entire environment. It includes PATH, Windows system/command-shell paths, HOME/USERPROFILE, APPDATA/LOCALAPPDATA, temporary-directory paths, and the standard HTTP/HTTPS/ALL/NO proxy and certificate-bundle settings. Proxy URLs may contain network credentials: these are intentional functional exceptions, **not a zero-secrets guarantee**. Unrelated credentials, registered-client secret variables, arbitrary `AZURE_CORE_*`/MSAL variables and harmless unused settings are excluded. `az` additionally accepts `AZURE_CONFIG_DIR` (preserving the user's supported CLI profile), `AZ_INSTALLER`, `AZURE_CORE_ENABLE_BROKER_ON_WINDOWS` and `AZURE_CORE_LOGIN_EXPERIENCE_V2`; custom launch environment overrides are filtered through this same whitelist. Explicit login overrides the last two settings to disable broker/subscription-picker UI. Code callback/request/nonce variables are supplied only by the current bounded request. Generic stdio backend environment inheritance is unchanged.

Isolated Code profile names hash the complete gateway backend identity (alias, exact URL and OAuth configuration) and verified credential binding (authority, resource and scopes). Repeated identical bindings reuse the profile; consent step-up may create another profile. The helper reports exact paths in `vscodeProfilePaths` on success or failure after profile selection, without tokens or plaintext identity in the directory name. The identity-bound candidate passed the packaged Windows VS Code helper, 22-tool discovery and native Mail read/reconnect using saved provider state. Later source changes still require fresh review and real-gate verification before release; offline fixtures do not satisfy that gate.

These **persistent host profiles** are distinct from the owner-only, not additionally encrypted gateway token JSON. Microsoft's authentication provider manages host secrets through VS Code's encrypted secret-storage facilities, whose protection and availability depend on the OS/keychain; the gateway does not guarantee encryption of every profile file or a particular platform's encryption behavior. Profiles (including permission/session state) remain after successful, denied, failed or cancelled authentication for repeat use. Clearing/invalidation of gateway credentials does not delete the host profile or the user's Azure CLI/default editor cache. No automatic cache deletion occurs.

For manual targeted removal, first ensure the **owned authentication Code window/processes have closed** (especially if cleanup failed). For each exact path reported by this helper, inspect and remove only that isolated profile:

```powershell
$profile = '<one exact vscodeProfilePaths entry reported by the helper>'
Get-Item -LiteralPath $profile
Remove-Item -LiteralPath $profile -Recurse -Force
```

Do not use wildcards, remove the OAuth root, or delete the normal/default VS Code user-data directory. Removing a host profile requires explicit permission/sign-in again; it does not revoke already issued tokens or remove separately retained gateway token JSON.

Default locations on Windows-style paths are:

| Location | Contents |
|---|---|
| `$HOME\.copilot\mcp-config.json` | The shared gateway connector. Setup respects `COPILOT_HOME` when set. |
| `$HOME\.shared-mcp-gateway\backends.json` | Original backend definitions; may contain credentials. |
| `$HOME\.shared-mcp-gateway\runtime\...` | Stable runtime, independent of the plugin cache. |
| `$HOME\.shared-mcp-gateway\backups\...` | Original configuration and rollback records. |

`$HOME` means the user home directory, not the current folder. Keep state, backend definitions, and backups private.

Setup preserves conversation history and existing approval settings. Agency integration is opt-in with `--agency-adapters`; ordinary Copilot use does not require it. Existing Agency plugins or defaults may still add their own configuration.

The plugin cache contains the setup skill and updateable package files. The stable runtime and private backend data live outside that cache. Uninstalling the plugin removes the setup skill, not the installed runtime.

<a id="planned-exit"></a>
## Planned exit and operator handoff

Choose the intended end state explicitly: **clients no longer use this gateway**, or **clients restored and the owned daemon stopped, with private data retained**. Neither means credentials have been revoked or stored data erased.

1. Finish active workflows across every client sharing this instance and settle outstanding calls. Resolve unknown outcomes using [workflow ownership](#workflow-ownership); closing a client is not cancellation. Keep all affected clients closed while restoring configurations using their exact reported [setup rollback](#setup-recovery) or [cross-client rollback commands](#cross-client-migration-recovery). Review the backed-up configuration before restoring: unrelated settings added since that backup need an explicit preservation decision. Do not overwrite them blindly.
2. Verify each affected client's restored MCP configuration no longer references this gateway's connector. Include clients registered separately, not only Copilot. If a registration has no matching backup, the client owner must approve a native configuration edit that removes only this connector while preserving other integrations and settings; there is no universal cross-client uninstall command. Do not reopen a client with this connector still enabled: its auto-start can launch the daemon again. For the **clients-only** end state, reopen the restored clients and confirm their intended direct integrations work; record that the daemon and private state may still remain.
3. For the **daemon-stopped** end state, send this private request to the operator who owns the installation. Use exact reported values, not guessed default paths; share no tokens or backend credential contents:

   > Stop the owned shared gateway after the agreed idle window; retain all private state and unrelated backends. Affected clients/configuration paths: [list]. Restoration/connector-removal status per client: [verified or blocked]. Installed runtime/connector path, state directory and port from setup: [values]. Active-work confirmation and any unknown outcomes: [status]. Please verify process ownership, stop only this instance using your approved lifecycle method, and return the completion evidence below. Do not restart it or erase data.

   The operator must reconcile the selected state directory's `gateway-instance.json` with the live PID, process birth marker, executable, recorded CLI/config paths and port/listener. PID or port alone is not ownership proof. Missing/stale metadata, mismatched identity or uncertain active work means **blocked**, not permission to kill the listener. The existing [owned lifecycle implementation](../src/ensure-gateway.js) checks process markers (and executable identity on Windows), rechecks before escalation, and bounds its stop operation. Its `stopOwnedGateway` export is an internal lifecycle primitive, **not a supported standalone shutdown CLI**; it does not establish that clients are idle or every registration is removed. The operator must choose and approve a method appropriate to the installed version. A foreground instance launched by that operator can receive Ctrl+C in its own terminal; the [daemon entry point](../src/cli.js) handles SIGINT/SIGTERM. Do not signal a guessed PID or another terminal's process.
4. Require the operator's result: exact instance identified; affected connectors disabled/restored; old owned process no longer present; no gateway listener remains on the selected port; no connector has restarted it. A check-only readiness failure alone does not prove shutdown—it can also mean authentication or identity failure. Reopen only restored clients, check their intended integrations, then confirm the owned daemon has not returned. Keep backups, catalog, authentication state and histories private and intact. Report the end state as **clients restored; owned daemon stopped; private data retained**, or name the failed check and leave shutdown **blocked**. A missing general-purpose stop command is not a successful shutdown.

<a id="setup-recovery"></a>
## Setup recovery

Use the exact `backupPath` and `rollbackCommand` printed by setup. Close affected clients before restoring their original configuration, then reopen them.

If setup fails after creating a backup, it prints recovery information. If it fails before creating one, it reports that the source configuration was not replaced. Do not delete the private backend catalog as a troubleshooting step.

After a successful setup, reopen Copilot to load the generated connector, then execute the returned `readinessCommand` exactly. During adoption, finish active work, stop only the verified old gateway, and start the new connector using the generated entry before checking readiness and reconnecting other clients. A check-only command does not start an absent gateway. If setup reports `already-configured`, use the reported connector and state directory for the health check rather than inventing paths.

<a id="readiness-command-object"></a>

`readinessCommand` is the returned object, not a shell string. Set `$readinessCommand` to that exact object from the approved setup result; then run the PowerShell example below. `.command` keeps the executable path intact and `.args` keeps every returned argument in order, including paths with spaces or quotes. Do not join the array into one argument or invent paths. This check does not start an absent gateway.

Save only the `readinessCommand` JSON object from your approved setup result—not the whole output—as UTF-8 `readiness-command.json` in your private current folder. Keep the known approved executable `.command` and every `.args` value exact; do not join arguments or guess paths. Parse only this setup JSON, not arbitrary web/service data; JSON parsing is not evaluation. Treat the file as private because argument contents depend on your setup.

```powershell
$readinessCommand = Get-Content -Raw -LiteralPath '.\readiness-command.json' | ConvertFrom-Json
$command = $readinessCommand.command
$commandArgs = @($readinessCommand.args)
& $command @commandArgs
```


<a id="cross-client-migration-recovery"></a>
## Cross-client migration recovery

`connect-client.mjs --migrate` is a v0.6.0 workflow; v0.5 does not provide it. Adopt the v0.6.0 stable runtime through `/mcp-gateway-setup` before use. The plugin-root launcher delegates to the helper deployed with that runtime and fails with actionable guidance when the helper is absent. Preview never installs npm dependencies. Migration is a two-file transaction over one explicitly selected native client document and the gateway's private backend catalog. Preview is read-only. Apply validates the owned connector, state directory, catalog schema, source bytes, and both current files before writing. It does not install or upgrade the runtime, run `npm install`, discover configuration elsewhere, or restart the daemon.

Before any replacement, apply stores byte-exact copies as `client-config.json` and `backends.json` under one private backup directory. `rollback-manifest.json` records the operation, target and backup paths, and SHA-256 hashes for each original and replacement. The result returns `sourceBackupPath`, `backendBackupPath`, `manifestPath`, `rollbackCommand`, `backendRollbackCommand`, and `rollbackCommands`. Preserve those exact values; do not reconstruct paths from examples.

The generated Windows restore commands have this form:

```powershell
Copy-Item -LiteralPath '<reported-backend-backup>' -Destination '<reported-private-catalog>' -Force
Copy-Item -LiteralPath '<reported-client-backup>' -Destination '<reported-client-config>' -Force
```

Use the returned `rollbackCommands` in their reported order. Finish active agent work first, then restore both files and explicitly restart the owned gateway after checking the restored files. There is no automatic rollback.

Failure states are intentional and distinguishable:

- **Conflict:** the same alias has different supported settings. Apply aborts before writes and both files remain unchanged.
- **Preparation or first-write failure:** exact backups and the manifest are reported when created. Restore both if file state is uncertain; do not assume a failed operation changed nothing.
- **`partial-failure`:** the merged private catalog was published, but the second write did not replace the native client file. The runtime may therefore see the imported catalog while the client still has direct entries. Do not restart into that mixed state. After active work finishes, run both reported restore commands or resolve the two files deliberately, then restart explicitly.
- **Success:** the client file contains only the gateway connector in its native MCP collection and the validated catalog contains additions plus existing entries. A restart is required only when additions were published; it is never automatic.

Deduplication is alias-scoped. A matching alias with semantically equivalent supported settings is reported in `identicalDuplicates`; a matching alias with different settings is a conflict. Distinct aliases remain distinct even when their definitions are identical. The process does not claim to infer that differently named entries identify the same remote service.

Migration supports a conservative subset of the seven native formats. Relative executables or relative script arguments such as `node ./mcp.js` require an explicit absolute working directory; alternatively, configure absolute executable and script paths. The dispatcher fails closed rather than guessing a project root from the native configuration file location. Strict JSON is required for JSON clients; JSONC comments are not accepted. Referenced native variable or file interpolation, OAuth/client-managed authentication, migrated-alias trust/allow/deny or sandbox semantics, unsupported discovery or startup timeout semantics, and unknown behavior-bearing fields also fail closed. Unused VS Code `inputs` are allowed, and unrelated Claude permission data may remain when an existing gateway entry already matches. Preserve unsupported direct entries in their native client rather than weakening policy to migrate them.

For Codex only, migration parses TOML and preserves non-MCP values semantically, but comments and formatting are regenerated. The preview includes that warning, and the original TOML bytes and hashes remain available in the backup and manifest. Registration-only Codex setup is separate: it emits native `codex mcp add` arguments, rejects non-empty connector environment values, and never writes TOML.

<a id="windows-plugin-cache-access-denied"></a>
## Windows plugin cache: Access denied

Copilot's updater can occasionally fail to replace its installed-plugin cache. This does not by itself mean the stable gateway runtime is broken. Do not remove backend configuration, change broad file permissions, or stop unrelated Node processes.

First close Copilot windows normally and retry from a separate terminal. If replacement still fails, this cache-only recovery was verified on Windows: move the named plugin directory intact to a backup, then use Copilot's standard install command to create a fresh copy. Run outside the plugin directory.

```powershell
$copilotHome = if ($env:COPILOT_HOME) { $env:COPILOT_HOME } else { Join-Path $HOME '.copilot' }
$cache = Join-Path $copilotHome 'installed-plugins\mcp-gateway\shared-mcp-gateway'
$backup = Join-Path $copilotHome ('plugin-cache-backups\shared-mcp-gateway-' + [guid]::NewGuid().ToString())

# Inspect the exact target before proceeding.
Get-Item -LiteralPath $cache -ErrorAction Stop
New-Item -ItemType Directory -Path (Split-Path $backup -Parent) -Force | Out-Null
Move-Item -LiteralPath $cache -Destination $backup -ErrorAction Stop
copilot plugin install shared-mcp-gateway@mcp-gateway
if ($LASTEXITCODE -ne 0) {
    throw "Plugin install failed. Old cache is preserved at $backup. Do not delete either copy."
}
copilot plugin list --json
"Previous plugin cache: $backup"
```

This targets only the named plugin cache, not the stable runtime or credentials. If the move is denied, stop and inspect the locking process or policy; do not force access. If installation fails, retain the backup and restore it to `$cache` only after confirming the destination is absent.

<a id="adopting-a-development-checkout"></a>
## Adopting a development checkout

When moving from a development checkout, use the setup skill's explicit adoption workflow. `--adopt-existing` previews and backs up the connector change while retaining backend data. It does not delete the checkout or edit shell profiles.

Ask the setup skill to locate the installed plugin root rather than guessing cache paths. Plugin updates can change the cached package location, while the adopted stable runtime remains separate.

<a id="configuration-transfer"></a>
## Configuration transfer

To reuse backend definitions on another machine, use `tools\transfer-config.mjs`. This transfers definitions, not the gateway connector, runtime state, or tokens.

```powershell
# On the source machine: export backend definitions, not the connector.
node "<plugin-root>\tools\transfer-config.mjs" export `
  --source "$HOME\.shared-mcp-gateway\backends.json" --output ".\gateway-transfer"

# On the destination: fill a private values.json using requirements.json.
node "<plugin-root>\tools\transfer-config.mjs" import `
  --input ".\gateway-transfer" --values ".\values.json" --output ".\backends.ready.json"
```

`<plugin-root>` is the installed plugin directory reported by the setup skill. The export replaces credentials, endpoint URLs, local paths, and unclassified argument values with placeholders. A URL can contain a secret even when no query parameter is named `token`; supply endpoint URLs locally on the destination.

Review the transfer package before sharing because aliases and organization names may still be private. Back up and merge the materialized definitions into the destination configuration before setup. For an already-migrated destination, merge into its private backend catalog.

Never copy gateway tokens, process manifests, locks, browser profiles, or OAuth caches between machines.

<a id="operational-invariants"></a>
## Operational invariants

OpenCode migration conservatively rejects any root or agent-level `permission` or legacy `tools` key containing `*` or `?`, even when the pattern appears unrelated to the migrated aliases. Do not remove these restrictions just to bypass the rejection; keep the affected configuration client-managed until equivalent controls can be preserved.

- Preview before apply; preserve the exact backup, hash manifest, and rollback output.
- Plugin download, stable runtime activation, and client connector registration are separate operations.
- Finish active work before switching or restarting a runtime, restoring configuration, or resolving a partial migration.
- Preserve unknown client fields and unrelated entries; refuse conflicts instead of guessing.
- Do not expose private environment values in generated command lines.
- Do not treat configuration-adapter tests as proof of a live third-party client session. Installed native config parsing is currently verified only for Copilot CLI and Claude Code.


<a id="first-shared-workflow"></a>
## First shared workflow: exact inputs and result checks

Install once through [the Copilot shared-core route](CLIENTS.md#shared-core-install); use the [readiness object](#readiness-command-object). The following manual tool inputs are an alternative to the assisted request, not extra installation steps.

> Use the shared gateway for [my authorized read-only task]: list configured servers, discover a suitable tool, inspect its schema and prepare schema-valid arguments using authorized non-sensitive test values. Obtain normal approvals; claim an exclusive backend before calling it and release after calls settle. Show the actual result. Never retry an unknown outcome; use the operator handoff.

Replace only the bracketed task; actual aliases/tool names come from discovery, not invented defaults.

<a id="public-echo-illustration"></a>
**Public fixture illustration, not a backend installation step or real-integration proof:** the existing [lifecycle echo fixture](../test/fixtures/lifecycle-backend.mjs) advertises `echo` with required string `text`. In that isolated test only, arguments `{"text":"hello"}` produce `structuredContent` with `text: "hello"` and the actual numeric backend `pid`; the text content contains the same JSON. Check returned text equality and errors. See [the fixture workflow](../test/lifecycle-e2e.test.js). This demonstrates what an observable result check looks like; neither `echo` nor a fixture alias is a default tool on your private integration. Use discovery/schema for your own approved read.

2. Choose a harmless, authorized read-only task on an integration you already use: for example, look up a record you are allowed to read. In that client, use the gateway tool calls below. These are **tool inputs, not shell commands**. Angle-bracket values are **placeholders**, not shipped aliases, tool names, credentials, or literal arguments. Replace them with values from your own catalog and selected schema; do not submit the templates unchanged.

   | Step | Gateway tool and input | Expected observable result |
   |---|---|---|
   | List configured integrations | `list_servers` with `{}` | `servers` lists redacted entries with `name`, `state`, and `requiresExclusiveAccess`; listing does not connect to every backend. Choose an existing `name` as `<backend-alias>`. |
   | Find a read-only capability | `search_tools` with `{"server":"<backend-alias>","query":"<term-from-your-task>"}` | `tools` contains matching names/descriptions and the ownership flag, not full input schemas. Choose a returned `name` as `<returned-tool-name>` after checking what it does. |
   | Inspect that tool | `get_tool_schema` with `{"server":"<backend-alias>","tool":"<returned-tool-name>"}` | The returned `tool.inputSchema` gives required fields, types, and constraints. Fill an arguments object from that schema using only authorized, non-sensitive test values. |
   | Required ownership before execution | If `requiresExclusiveAccess: true`, use `claim_server` with `{"server":"<backend-alias>"}` before `call_tool` | Discovery/schema lookup do not require a claim; execution does. Non-exclusive backends need no claim. |
   | Perform the approved read | `call_tool` with `{"server":"<backend-alias>","tool":"<returned-tool-name>","arguments":{}}` **only if the schema permits an empty object**; otherwise replace `{}` with the complete schema-valid object you just prepared | The backend's result is preserved. Check its actual content for the expected record or documented empty result and any error indication; a gateway response alone is not proof the read succeeded. |

3. If discovery says `requiresExclusiveAccess: true`, use `claim_server` with `{"server":"<backend-alias>"}` once **before `call_tool`**, and `release_server` with the same input after all calls settle. Non-exclusive backends need no claim. If an exclusive call times out with an unknown outcome, do not retry: review active work and use the [unknown-exclusive-result operator handoff](#unknown-exclusive-result); releasing is not a safe unblock.
4. In a second session registered to the **same connector and catalog**, repeat list/search for the same alias. It should expose the same configured backend, reusing its initialized catalog rather than requiring a second backend configuration. This checks the first shared workflow, not measured memory savings. Discovery is not permission to execute a tool. After initialization, `list_servers` should show `ready` and search should expose the same cached catalog. Alias equality alone does not prove PID identity or RAM savings; see the [public process-reuse fixture](BENCHMARK.md#method). [Catalog-cache test](../test/catalog-scale.test.js).

If the list is empty, check the selected configuration/migration preview. If search returns no matches, use a narrower term from your backend's own tool descriptions; there is no universal backend tool name. For authentication errors or failed readiness, follow the [authentication guidance](#native-http-oauth) and [setup recovery/rollback](#setup-recovery), not repeated calls or a parallel bypass process. Backend requests can still contact remote services; local sharing does not make them offline.
