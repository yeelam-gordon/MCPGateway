import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);

test('localized quickstarts retain truthful benefits, first workflows and canonical client navigation', async () => {
  const { languages } = JSON.parse(await readFile(new URL('docs/i18n/languages.json', root), 'utf8'));
  assert.equal(languages.length, 16);
  assert.equal(new Set(languages.map(language => language.code)).size, 16);
  const english = await readFile(new URL('README.md', root), 'utf8');
  for (const language of languages) {
    assert.ok(language.name);
    const url = new URL(language.path, root);
    const text = await readFile(url, 'utf8');
    if (language.code === 'en') continue;
    assert.ok(english.includes(`](${language.path})`), language.code);
    for (const client of [
      'copilot-cli', 'vs-code', 'claude-code', 'codex',
      'opencode', 'qwen-code', 'kimi-cli', 'antigravity-cli'
    ]) {
      for (const action of ['install', 'upgrade']) {
        assert.ok(text.includes(`](../CLIENTS.md#${client}-${action})`), `${language.code}: ${client} ${action}`);
      }
    }
    assert.ok(text.includes('../REFERENCE.md'), language.code);
    assert.ok(text.includes('../CLIENTS.md#cross-client-migration'), language.code);
    for (const count of language.code === 'ar' ? ['10', '12'] : ['10', '2', '12']) {
      assert.ok(text.includes(`**${count}**`), `${language.code}: cross-client merge count`);
    }
    if (language.code === 'ar') assert.ok(text.includes('اتصالين جديدين'), 'ar: two new connections expressed by natural dual');
    const selected = new Map([
      ['zh-CN', ['共享本地 MCP', 'Windows 是主要测试平台', '目前必须先通过 Copilot CLI', '只读任务', '空结果', '配置和备份可能含凭据', '共享不等于离线', '兼容性和验证程度不同', '未知结果的超时不能重试']],
      ['ja', ['ローカル MCP サーバーを共有', '主な検証環境は Windows', '初期導入は Copilot CLI', '承認済みの読み取り', '空の結果', '設定とバックアップには資格情報', 'オフライン動作', '互換性と検証範囲が異なります', '結果不明のタイムアウトは再試行せず']],
      ['es', ['servidores MCP locales', 'Windows es la plataforma principal de pruebas', 'arranque actual requiere Copilot CLI', 'lectura aprobada', 'resultado vacío', 'copias pueden contener credenciales', 'no implica funcionamiento sin conexión', 'verificación varían según el cliente', 'resultado desconocido, no reintentes']],
      ['pt-BR', ['servidores MCP locais', 'Windows é a principal plataforma testada', 'instalação inicial exige Copilot CLI', 'leitura aprovada', 'resultado vazio', 'backups podem conter credenciais', 'não significa operar offline', 'verificação variam entre clientes', 'resultado desconhecido, não repita']],
      ['fr', ['serveurs MCP locaux', 'Windows est la principale plateforme testée', 'initiale passe actuellement par Copilot CLI', 'lecture approuvée', 'résultat vide', 'sauvegardes peuvent contenir des identifiants', 'ne signifie pas un fonctionnement hors ligne', 'vérification diffèrent selon les clients', 'résultat inconnu, ne réessayez pas']],
      ['de', ['Lokale MCP-Server', 'Windows ist die hauptsächlich getestete Plattform', 'Ersteinrichtung erfolgt derzeit über Copilot CLI', 'genehmigten Lesezugriff', 'leeres Ergebnis', 'Sicherungen können Zugangsdaten enthalten', 'weder Offline-Betrieb', 'Prüftiefe unterscheiden sich je nach Client', 'unbekanntem Ergebnis nicht erneut aufrufen']],
      ["zh-TW", ["共用本機 MCP", "Windows 是主要測試平台", "初次安裝須透過 Copilot CLI", "唯讀工作", "空結果", "設定與備份可能含有認證資訊", "共用不等於離線", "相容性與驗證程度各不相同", "結果不明時不要重試"]],
      ["ko", ["로컬 MCP 서버 공유", "Windows가 주요 테스트 플랫폼", "초기 설치는 Copilot CLI", "읽기 전용 작업", "빈 결과", "구성과 백업에는 자격 증명", "오프라인 실행", "검증 범위가 다릅니다", "시간 초과는 재시도하지"]],
      ["it", ["server MCP locali", "Windows è la piattaforma principale di test", "installazione passa attualmente da Copilot CLI", "lettura approvata", "risultato vuoto", "backup possono contenere credenziali", "non significa lavorare offline", "verifica variano tra i client", "esito sconosciuto"]],
      ["ru", ["локальные MCP-серверы", "Windows — основная тестируемая платформа", "установка сейчас выполняется через Copilot CLI", "разрешённое чтение", "пустой результат", "копии могут содержать учётные данные", "не означает автономную работу", "глубина проверки зависят от клиента", "Не повторяйте вызов"]],
      ["tr", ["yerel MCP sunucularını", "ana test platformu Windows", "kurulum şu anda Copilot CLI", "salt okunur", "boş sonuç", "yedekler kimlik bilgileri içerebilir", "çevrimdışı", "doğrulama düzeyi istemciye göre değişir", "yeniden denemeyin"]],
      ["vi", ["máy chủ MCP cục bộ", "Windows là nền tảng được kiểm thử chính", "đầu hiện phải qua Copilot CLI", "tác vụ chỉ đọc, vô hại và đã được cho phép", "kết quả rỗng", "bản sao lưu có thể chứa thông tin xác thực", "không có nghĩa hoạt động offline", "mức kiểm chứng khác nhau", "không thử lại"]],
      ["id", ["server MCP lokal", "Windows adalah platform utama yang diuji", "Instalasi awal saat ini melalui Copilot CLI", "pembacaan yang disetujui", "hasil kosong", "cadangan dapat berisi kredensial", "bukan berarti offline", "verifikasi berbeda antarklien", "Jangan ulangi panggilan"]],
      ["hi", ["स्थानीय MCP सर्वर", "Windows मुख्य परीक्षण प्लेटफ़ॉर्म", "पहली स्थापना अभी Copilot CLI", "केवल डेटा पढ़ने वाला स्वीकृत काम", "खाली परिणाम", "बैकअप में क्रेडेंशियल हो सकते हैं", "ऑफलाइन", "सत्यापन का स्तर अलग है", "दोबारा कोशिश न करें"]],
      ["ar", ["خوادم MCP المحلية", "Windows منصة الاختبار الرئيسية", "التثبيت الأول حاليًا عبر Copilot CLI", "قراءة معتمدة", "نتيجة فارغة", "النسخ الاحتياطية على بيانات اعتماد", "لا تعني العمل دون اتصال", "مستويات التوافق والتحقق", "لا تعاود المحاولة"]]
    ]);
    assert.ok(selected.has(language.code), `${language.code}: localized workflow contract required`);
    if (language.code === 'hi') assert.ok(text.includes('केवल अधिकृत, गैर-संवेदनशील परीक्षण मानों का उपयोग करें'), 'hi: authorized non-sensitive test arguments');
    if (language.code === 'vi') assert.ok(text.includes('các giá trị thử nghiệm được phép và không chứa thông tin nhạy cảm'), 'vi: authorized non-sensitive test arguments');
    if (language.code === 'id') {
      assert.ok(text.includes('antarsesi agen pemrograman'));
      assert.ok(text.includes('berbeda antarklien'));
    }
    const ownershipGuards = new Map([
      ["zh-CN", "结果不明时，独占后端会保持阻塞，直到网关重启；释放认领或断开客户端连接不能安全解除阻塞，断开连接也不等于取消操作。"],
      ["zh-TW", "結果不明時，獨佔後端會維持封鎖，直到閘道重新啟動；釋放認領或中斷用戶端連線都不能安全解除封鎖，中斷連線也不等於取消作業。"],
      ["ja", "結果が不明な場合、排他バックエンドはゲートウェイを再起動するまでブロックされたままです。予約の解除やクライアントの切断では安全に解除できず、切断は操作のキャンセルを意味しません。"],
      ["ko", "결과가 불명확하면 배타적 접근이 필요한 백엔드는 게이트웨이를 재시작할 때까지 차단된 상태로 유지됩니다. 예약 해제나 클라이언트 연결 종료로 안전하게 차단을 해제할 수 없으며, 연결 종료는 작업 취소가 아닙니다."],
      ["es", "Si el resultado es desconocido, el backend exclusivo permanece bloqueado hasta reiniciar el gateway; liberar la reserva o desconectar el cliente no lo desbloquea de forma segura, y desconectar no cancela la operación."],
      ["pt-BR", "Se o resultado for desconhecido, o backend exclusivo permanece bloqueado até o gateway ser reiniciado; liberar a reserva ou desconectar o cliente não desbloqueia o backend com segurança, e desconectar não cancela a operação."],
      ["fr", "Si le résultat est inconnu, le backend exclusif reste bloqué jusqu’au redémarrage de la passerelle ; libérer la réservation ou déconnecter le client ne permet pas de le débloquer en toute sécurité, et une déconnexion n’annule pas l’opération."],
      ["de", "Bei unbekanntem Ergebnis bleibt das exklusive Backend bis zum Neustart des Gateways gesperrt; die Reservierung freizugeben oder den Client zu trennen hebt die Sperre nicht sicher auf. Eine Trennung bricht den Vorgang nicht ab."],
      ["it", "Se l’esito è sconosciuto, il backend esclusivo resta bloccato fino al riavvio del gateway; rilasciare la prenotazione o disconnettere il client non lo sblocca in sicurezza, e la disconnessione non annulla l’operazione."],
      ["ru", "При неизвестном исходе бэкенд с монопольным доступом остаётся заблокированным до перезапуска шлюза; освобождение захвата или отключение клиента не снимает блокировку безопасным образом. Отключение не отменяет операцию."],
      ["tr", "Sonuç bilinmiyorsa tek oturumun erişimine ayrılan arka uç, ağ geçidi yeniden başlatılana kadar engelli kalır; sahipliği bırakmak veya istemcinin bağlantısını kesmek engeli güvenli biçimde kaldırmaz. Bağlantıyı kesmek işlemi iptal etmez."],
      ["vi", "Khi chưa biết kết quả, backend chỉ cho phép một phiên truy cập vẫn bị chặn cho đến khi gateway khởi động lại; nhả quyền hoặc ngắt kết nối ứng dụng khách không thể gỡ chặn an toàn. Ngắt kết nối không hủy thao tác."],
      ["id", "Jika hasilnya tidak diketahui, backend eksklusif tetap diblokir sampai gateway dimulai ulang; melepaskan klaim atau memutus koneksi klien tidak membuka blokir dengan aman. Memutus koneksi tidak membatalkan operasi."],
      ["hi", "परिणाम अज्ञात होने पर, एक समय में केवल एक सत्र को पहुँच देने वाला बैकएंड गेटवे के रीस्टार्ट होने तक अवरुद्ध रहता है। पहुँच छोड़ना या क्लाइंट का कनेक्शन तोड़ना सुरक्षित रूप से अवरोध नहीं हटाता; कनेक्शन टूटने से ऑपरेशन रद्द नहीं होता।"],
      ["ar", "إذا كانت النتيجة مجهولة، تبقى الخدمة الخلفية ذات الوصول الحصري محظورة حتى إعادة تشغيل البوابة؛ تحرير الحجز أو فصل العميل لا يرفع الحظر بأمان، وفصل الاتصال لا يلغي العملية."]
    ]);
    assert.ok(text.includes(ownershipGuards.get(language.code)), `${language.code}: unknown-outcome blocked/release/disconnect/cancellation guard`);
    assert.ok(text.includes('../REFERENCE.md#planned-exit'), `${language.code}: planned exit route`);
    const measuredMetricLabels = new Map([["ar", ["قياس تجهيز خفيف: زاد مجموع working set للعمليات", "المقاس هو مجموع working set للعمليات؛ لم تُقَس الذاكرة الفعلية دون العد المكرر ولا البايتات الخاصة (private bytes)."]], ["de", ["Leichte Fixture gemessen: summiertes Prozess-Working-Set erhöht", "Gemessen wurde das summierte Prozess-Working-Set; physischer Speicher ohne Mehrfachzählung und private Bytes wurden nicht gemessen."]], ["es", ["Fixture ligero medido: aumentó el working set sumado de procesos", "Se midió el working set sumado de procesos; no se midieron la memoria física sin duplicación ni los bytes privados (private bytes)."]], ["fr", ["Fixture léger mesuré : hausse du working set cumulé des processus", "La mesure porte sur le working set cumulé des processus ; ni la mémoire physique sans double comptage ni les octets privés (private bytes) n’ont été mesurés."]], ["hi", ["हल्के फ़िक्चर का मापा परिणाम: प्रक्रियाओं के working set का योग बढ़ा", "प्रक्रियाओं के working set का योग मापा गया; दोहराव हटाकर भौतिक मेमोरी और निजी बाइट्स (private bytes) नहीं मापे गए।"]], ["id", ["Fixture ringan terukur: jumlah working set proses meningkat", "Yang diukur adalah jumlah working set proses; memori fisik tanpa penghitungan ganda dan private bytes (memori privat proses) tidak diukur."]], ["it", ["Fixture leggero misurato: aumento del working set sommato dei processi", "Si è misurato il working set sommato dei processi; memoria fisica senza duplicazioni e byte privati (private bytes) non sono stati misurati."]], ["ja", ["軽量フィクスチャの実測：プロセスのワーキングセット合計が増加", "測定値は各プロセスのワーキングセットの合計です。重複を除いた物理メモリとプライベートバイト（private bytes）は未測定です。"]], ["ko", ["경량 테스트 실측: 프로세스 작업 집합 합계 증가", "측정값은 프로세스 작업 집합의 합계입니다. 중복을 제외한 물리 메모리와 전용 바이트(private bytes)는 측정하지 않았습니다."]], ["pt-BR", ["Fixture leve medido: aumentou o working set somado dos processos", "Mediu-se o working set somado dos processos; memória física sem duplicação e bytes privados (private bytes) não foram medidos."]], ["ru", ["Измерение лёгкой фикстуры: сумма рабочих наборов процессов выросла", "Измерена сумма рабочих наборов процессов; физическая память без повторного учёта и частные байты (private bytes) не измерялись."]], ["tr", ["Hafif düzenek ölçümü: süreçlerin toplam working set değeri arttı", "Ölçüm süreçlerin working set toplamıdır; tekrar sayımı çıkarılmış fiziksel bellek ve özel baytlar (private bytes) ölçülmedi."]], ["vi", ["Fixture nhẹ đã đo: tổng working set của các tiến trình tăng", "Đã đo tổng working set của các tiến trình; chưa đo bộ nhớ vật lý loại trừ phần tính trùng hay private bytes (bộ nhớ riêng của tiến trình)."]], ["zh-CN", ["轻量后端实测：进程工作集总和增加", "测量的是进程工作集总和；去重后的物理内存与私有字节（private bytes）均未测量。"]], ["zh-TW", ["輕量後端實測：程序工作集總和增加", "測量的是程序工作集總和；去除重複計算的實體記憶體與私有位元組（private bytes）均未測量。"]]]);
    for (const metricLabel of measuredMetricLabels.get(language.code)) assert.ok(text.includes(metricLabel), `${language.code}: measured summed-working-set scope`);
    assert.equal((text.match(/\[Copilot CLI\]\(\.\.\/CLIENTS\.md#shared-gateway-prerequisite\)/g) ?? []).length, 8, `${language.code}: bootstrap explicit for all client routes`);
    const approvedRequest = text.match(/^> .+$/gm)?.filter(line => !line.includes('README'));
    assert.ok(approvedRequest?.length, `${language.code}: native copyable approved-read request`);
    assert.ok(text.includes('../REFERENCE.md#unknown-exclusive-result'), `${language.code}: no-retry operator handoff`);
    assert.ok(text.includes('../BENCHMARK.md#configuration-only-connection-continuity'), `${language.code}: verified configuration-only continuity scope`);
    assert.match(text, /^# MCPGateway /m, language.code);
    const topologyLabels = new Map([
      ["zh-CN", "智能体", "集成服务", "连接器", "多个工具"],
      ["zh-TW", "智慧代理", "整合服務", "連接器", "多個工具"],
      ["ja", "エージェント", "連携サービス", "コネクター", "複数のツール"],
      ["ko", "에이전트", "연동 서비스", "커넥터", "여러 도구"],
      ["es", "Agente", "Integración", "conector", "varias herramientas"],
      ["pt-BR", "Agente", "Integração", "conector", "várias ferramentas"],
      ["fr", "Agent", "Intégration", "connecteur", "plusieurs outils"],
      ["de", "Agent", "Integration", "Konnektor", "mehrere Tools"],
      ["it", "Agente", "Integrazione", "connettore", "più strumenti"],
      ["ru", "Агент", "Интеграция", "коннектор", "несколько инструментов"],
      ["vi", "Tác nhân", "Tích hợp", "bộ kết nối", "nhiều công cụ"],
      ["id", "Agen", "Integrasi", "konektor", "banyak alat"],
      ["hi", "एजेंट", "इंटीग्रेशन", "कनेक्टर", "कई टूल"],
      ["ar", "وكيل", "تكامل", "موصّل", "أدوات متعددة"],
      ["tr", "Ajan", "Entegrasyon", "bağlayıcı", "birçok araç"]
    ].map(([code, ...labels]) => [code, labels]));
    const topology = text.match(/```text\r?\n([\s\S]*?)\r?\n```/)?.[1];
    assert.ok(topology, `${language.code}: opening shared topology`);
    const topologyLines = topology.split(/\r?\n/);
    assert.equal(topologyLines.length, 3, `${language.code}: three illustrative agent/integration paths`);
    const [agentLabel, integrationLabel, connectorLabel, toolsLabel] = topologyLabels.get(language.code);
    for (const [index, letter] of ['A', 'B', 'C'].entries()) {
      assert.ok(topologyLines[index].includes(`${agentLabel} ${letter}`), language.code);
      assert.ok(topologyLines[index].includes(`${integrationLabel} ${letter}: ${toolsLabel}`), language.code);
    }
    assert.ok(topologyLines[1].includes(`─ ${connectorLabel} ─ MCPGateway ─`), language.code);
    assert.ok(text.indexOf('](#first-use)') < text.indexOf('<img'), `${language.code}: action before artwork`);
    const heroPreface = text.slice(0, text.indexOf('<img'));
    assert.equal(heroPreface.replace(/<a id="languages"><\/a>\s*<details>[\s\S]*?<\/details>/, '').trim().split(/\r?\n\r?\n/).filter(Boolean).length, 3, `${language.code}: title, value, compact navigation only before image`);
    assert.doesNotMatch(heroPreface, /^- |5 × 1\.5|Node\.js/m, `${language.code}: no long preface before image`);
    assert.ok(text.indexOf('](#first-use)') < text.indexOf('| 5 × 1.5 GB'), `${language.code}: action before full arithmetic`);
    assert.match(text, /<img src="\.\.\/\.\.\/assets\/mcp-gateway-benefits\.png"[^>]*width="780"/);
    await access(new URL('../../assets/mcp-gateway-benefits.png', url));
    const installBlock = text.match(/```powershell\r?\n([\s\S]*?)\r?\n```/)?.[1];
    assert.equal(installBlock?.replaceAll('\r', ''), [
      'copilot plugin marketplace add yeelam-gordon/MCPGateway',
      'copilot plugin install shared-mcp-gateway@mcp-gateway'
    ].join('\n'), `${language.code}: exact untranslated bootstrap commands`);
    const workflow = text.match(/^2\. (.+)$/m)?.[1];
    assert.ok(workflow, `${language.code}: first read workflow`);
    let previous = -1;
    for (const tool of ['list_servers', 'search_tools', 'get_tool_schema', 'call_tool']) {
      const index = workflow.indexOf('`' + tool + '`');
      assert.ok(index > previous, `${language.code}: ${tool} discovery order`);
      previous = index;
    }
    for (const startup of ['5 × 12 = 60', '60 - 12 = 48', '48 / 60 × 100 = 80%', '`k`', 'stdio']) {
      assert.ok(text.includes(startup), `${language.code}: qualified startup work-count illustration`);
    }
    for (const evidence of ['426.2 ms', '21.1 ms', '19.0 ms', '503.5 ms', '894.3 ms', '1886.7 ms', '5 → 1', '5 → 7', '357.0 MiB → 564.0 MiB', 'Node 24.13.1', '../BENCHMARK.md']) {
      assert.ok(text.includes(evidence), `${language.code}: complete measured fixture evidence, including adverse totals`);
    }
    const secondSession = text.match(/^4\. (.+)$/m)?.[1];
    assert.ok(secondSession?.includes('`list_servers`') && secondSession.includes('`search_tools`') && secondSession.includes('`ready`'), `${language.code}: observable second-session sharing check`);
    assert.equal((text.match(/^4\. /gm) ?? []).length, 1, `${language.code}: no duplicate sharing step`);
    assert.ok(secondSession.includes('../BENCHMARK.md#method'), `${language.code}: multi-client process reuse method`);
    assert.ok(secondSession.includes('../../test/catalog-scale.test.js'), `${language.code}: distinct catalog-cache evidence`);
    assert.ok(!secondSession.includes('#configuration-only-connection-continuity'), `${language.code}: evidence matches sharing check`);
    assert.ok(!text.includes('1.5 GB + overhead;'), `${language.code}: localized overhead`);
    assert.ok(!text.includes('[6 tools / 2 clients]'), `${language.code}: localized discovery proof label`);
    const migration = text.split(/\r?\n\r?\n/).find(paragraph => paragraph.includes('**10**'));
    assert.ok(migration && !migration.includes('#cross-client-migration'), `${language.code}: short migration example separate from validation guidance`);
    assert.equal((text.match(/^- /gm) ?? []).length, 6, `${language.code}: scannable migration safeguards`);
    assert.match(text, /Node\.js 24/, language.code);
    for (const phrase of selected.get(language.code)) {
      assert.ok(text.includes(phrase), `${language.code}: ${phrase}`);
    }
    for (const required of [
      'copilot plugin marketplace add yeelam-gordon/MCPGateway',
      'copilot plugin install shared-mcp-gateway@mcp-gateway',
      '/mcp-gateway-setup', 'readinessCommand',
      'list_servers', 'search_tools', 'get_tool_schema', 'call_tool',
      'requiresExclusiveAccess: true', 'claim_server', 'release_server',
      '../../README.md#first-use', '../CLIENTS.md#compatibility-summary',
      '../REFERENCE.md#state-and-privacy', '../REFERENCE.md#setup-recovery',
      'Gemini CLI', 'Antigravity', 'Kimi'
    ]) {
      assert.ok(text.includes(required), `${language.code}: ${required}`);
    }
    for (const scenario of ['5 × 1.5 GB = 7.5 GB', '1.5 GB +', '7.5 GB - 1.5 GB = 6 GB', '(1000 - 6) / 1000 × 100 = 99.4%', '../../test/catalog-scale.test.js']) {
      assert.ok(text.includes(scenario), `${language.code}: bounded RAM/definition illustration`);
    }
    assert.ok(text.includes('../../README.md'), language.code);
    assert.ok(text.includes('../../LICENSE'), language.code);
    assert.equal((text.match(/^```/gm) ?? []).length % 2, 0, language.code);
    for (const match of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      if (/^https?:/.test(match[1])) continue;
      await access(new URL(match[1], url));
    }
  }
});


test('all sixteen openings separate memory, startup work and configuration-only connection continuity', async () => {
  const { languages } = JSON.parse(await readFile(new URL('docs/i18n/languages.json', root), 'utf8'));
  const meanings = new Map([
    ['en', ['duplicate backend memory', 'repeated startup work', 'without restarting the current agent-side MCP connection']],
    ['zh-CN', ['重复占用内存', '重复启动工作', '无需重启该连接']],
    ['zh-TW', ['重複占用記憶體', '重複啟動工作', '不必重啟該連線']],
    ['ja', ['メモリの重複', '起動処理を再利用', '既存 MCP 接続を再起動せず']],
    ['ko', ['메모리 중복', '시작 작업을 재사용', 'MCP 연결을 재시작 없이']],
    ['es', ['RAM duplicada', 'trabajo de arranque', 'sin reiniciar la conexión MCP actual']],
    ['pt-BR', ['RAM duplicada', 'trabalho de inicialização', 'sem reiniciar a conexão MCP atual']],
    ['fr', ['RAM dupliquée', 'travail de démarrage', 'sans redémarrer la connexion MCP actuelle']],
    ['de', ['doppelten RAM', 'Startarbeit wiederverwenden', 'bestehende MCP-Verbindung des Agenten neu zu starten']],
    ['it', ['RAM duplicata', 'lavoro di avvio', 'senza riavviare la connessione MCP attuale']],
    ['ru', ['дублирования RAM', 'работу запуска', 'без перезапуска текущего MCP-соединения']],
    ['tr', ['yinelenen RAM', 'başlatma işini', 'MCP bağlantısını yeniden başlatmadan']],
    ['vi', ['RAM trùng lặp', 'công việc khởi động', 'không khởi động lại kết nối MCP hiện tại']],
    ['id', ['RAM duplikat', 'pekerjaan memulai backend', 'tanpa memulai ulang koneksi MCP agen']],
    ['hi', ['RAM का दोहराव', 'शुरू करने का काम', 'MCP कनेक्शन बिना रीस्टार्ट']],
    ['ar', ['تكرار الذاكرة', 'عمل بدء التشغيل', 'دون إعادة تشغيل اتصال MCP الحالي']]
  ]);
  for (const language of languages) {
    const text = await readFile(new URL(language.path, root), 'utf8');
    const prehero = text.slice(0, text.indexOf('<img'));
    let previous = -1;
    for (const meaning of meanings.get(language.code)) {
      const index = prehero.indexOf(meaning);
      assert.ok(index > previous, `${language.code}: separate ordered opening payoff: ${meaning}`);
      previous = index;
    }
    assert.ok(prehero.includes('SDK/stdio'), `${language.code}: bounded connection route before hero`);
    const benefits = text.slice(text.indexOf('<img'), text.indexOf('<a id="first-use">'));
    const bullets = benefits.match(/^- \*\*.+$/gm);
    assert.equal(bullets?.length, 3, `${language.code}: exactly three primary proof bullets`);
    for (const value of ['5 × 1.5 GB', '6 GB']) assert.ok(bullets[0].includes(value), `${language.code}: memory illustration ${value}`);
    assert.ok(bullets[1].includes('60 → 12'), `${language.code}: starts, not elapsed-time gains`);
    assert.ok(bullets[1].includes('stdio'), `${language.code}: startup count applies to stdio services`);
    assert.ok(bullets[2].includes('SDK/stdio'), `${language.code}: bounded continuity evidence`);
    assert.ok(bullets[2].includes('configuration-only-connection-continuity'), `${language.code}: continuity method link`);
    assert.ok(text.indexOf('<a id="mechanism">') === -1 || text.indexOf('<a id="mechanism">') > text.indexOf('<a id="resource-examples">'), `${language.code}: mechanism remains secondary`);
    const licenseLink = language.code === 'en' ? '[LICENSE](LICENSE)' : '[MIT](../../LICENSE)';
    assert.ok(text.trim().split('\n').at(-1).includes(licenseLink), `${language.code}: license really last`);
    const ids = [...text.matchAll(/<a id="([^"]+)"><\/a>/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${language.code}: unique explicit navigation anchors`);
    assert.equal((text.match(/<details>/g) ?? []).length, (text.match(/<\/details>/g) ?? []).length, `${language.code}: closed progressive disclosure`);
  }
});

test('six repaired locales offer ordinary local recovery before the full English fallback', async () => {
  const recovery = new Map([
    ['zh-CN', ['目录为空时', '所选配置与迁移预览', '后端自身工具说明', '身份验证出错或就绪检查失败', '不要反复调用', '绕过网关']],
    ['ja', ['一覧が空なら', '設定と移行プレビュー', 'バックエンド自身のツール説明', '認証エラーや準備確認の失敗', '呼び出しを繰り返したり', '迂回したりしない']],
    ['es', ['catálogo está vacío', 'configuración seleccionada', 'propio backend', 'autenticación o disponibilidad', 'sin repetir llamadas', 'eludir el gateway']],
    ['pt-BR', ['catálogo estiver vazio', 'configuração selecionada', 'próprio backend', 'autenticação ou prontidão', 'sem repetir chamadas', 'contornar o gateway']],
    ['fr', ['catalogue est vide', 'configuration choisie', 'backend lui-même', 'authentification ou de disponibilité', 'sans répéter les appels', 'contourner la passerelle']],
    ['de', ['leerem Katalog', 'gewählte Konfiguration und Migrationsvorschau', 'Backends selbst', 'Authentifizierungsfehlern', 'Aufrufe zu wiederholen', 'Umgehungsprozess']]
  ]);
  for (const [code, phrases] of recovery) {
    const text = await readFile(new URL(`docs/i18n/README.${code}.md`, root), 'utf8');
    const step4 = text.indexOf('4. ');
    const fallback = text.indexOf('../../README.md#first-use', step4);
    const localRecovery = text.slice(step4, fallback);
    for (const phrase of phrases) assert.ok(localRecovery.includes(phrase), `${code}: ordinary recovery: ${phrase}`);
    for (const anchor of ['native-http-oauth', 'setup-recovery']) assert.ok(localRecovery.includes(`../REFERENCE.md#${anchor}`), `${code}: bounded recovery route`);
  }
  const korean = await readFile(new URL('docs/i18n/README.ko.md', root), 'utf8');
  assert.ok(korean.includes('재시작 후 배타적 이용을 다시 예약해야 합니다.'));
  assert.ok(!korean.includes('예약어야'));
});
