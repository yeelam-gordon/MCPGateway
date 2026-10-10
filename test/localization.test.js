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
      ["vi", ["máy chủ MCP cục bộ", "Windows là nền tảng được kiểm thử chính", "đầu hiện phải qua Copilot CLI", "đọc dữ liệu đã được phê duyệt", "kết quả rỗng", "bản sao lưu có thể chứa thông tin xác thực", "không có nghĩa hoạt động offline", "mức kiểm chứng khác nhau", "không thử lại"]],
      ["id", ["server MCP lokal", "Windows adalah platform utama yang diuji", "Instalasi awal saat ini melalui Copilot CLI", "pembacaan yang disetujui", "hasil kosong", "cadangan dapat berisi kredensial", "bukan berarti offline", "verifikasi berbeda antarklien", "Jangan ulangi panggilan"]],
      ["hi", ["स्थानीय MCP सर्वर", "Windows मुख्य परीक्षण प्लेटफ़ॉर्म", "पहली स्थापना अभी Copilot CLI", "केवल डेटा पढ़ने वाला स्वीकृत काम", "खाली परिणाम", "बैकअप में क्रेडेंशियल हो सकते हैं", "ऑफलाइन", "सत्यापन का स्तर अलग है", "दोबारा कोशिश न करें"]],
      ["ar", ["خوادم MCP المحلية", "Windows منصة الاختبار الرئيسية", "التثبيت الأول حاليًا عبر Copilot CLI", "قراءة معتمدة", "نتيجة فارغة", "النسخ الاحتياطية على بيانات اعتماد", "لا تعني العمل دون اتصال", "مستويات التوافق والتحقق", "لا تعاود المحاولة"]]
    ]);
    assert.ok(selected.has(language.code), `${language.code}: localized workflow contract required`);
    if (language.code === 'hi') assert.ok(text.includes('केवल अधिकृत, गैर-संवेदनशील परीक्षण मानों का उपयोग करें'), 'hi: authorized non-sensitive test arguments');
    if (language.code === 'id') {
      assert.ok(text.includes('antarsesi agen pemrograman'));
      assert.ok(text.includes('berbeda antarklien'));
    }
    const ownershipGuards = new Map([
      ["zh-CN", "结果不明时，独占后端会保持阻塞，直到网关重启；释放认领或断开客户端连接不能安全解除阻塞，断开连接也不等于取消操作。"],
      ["zh-TW", "結果不明時，獨佔後端會維持封鎖，直到閘道重新啟動；釋放認領或中斷用戶端連線都不能安全解除封鎖，中斷連線也不等於取消作業。"],
      ["ja", "結果が不明な場合、排他バックエンドはゲートウェイを再起動するまでブロックされたままです。所有権の解放やクライアントの切断では安全に解除できず、切断は操作のキャンセルを意味しません。"],
      ["ko", "결과가 불명확하면 배타적 접근이 필요한 백엔드는 게이트웨이를 재시작할 때까지 차단된 상태로 유지됩니다. 소유권 해제나 클라이언트 연결 종료로 안전하게 차단을 해제할 수 없으며, 연결 종료는 작업 취소가 아닙니다."],
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
    assert.match(text, /^# MCPGateway /m, language.code);
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
    const migration = text.split(/\r?\n\r?\n/).find(paragraph => paragraph.includes('**10**'));
    assert.ok(migration && !migration.includes('#cross-client-migration'), `${language.code}: short migration example separate from validation guidance`);
    assert.equal((text.match(/^- /gm) ?? []).length, 3, `${language.code}: scannable migration safeguards`);
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
    assert.doesNotMatch(text, /\b(?:1[.,]5|7[.,]5)\s*GB/, `${language.code}: no hypothetical RAM promise`);
    assert.ok(text.includes('../../README.md'), language.code);
    assert.ok(text.includes('../../LICENSE'), language.code);
    assert.equal((text.match(/^```/gm) ?? []).length % 2, 0, language.code);
    for (const match of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      if (/^https?:/.test(match[1])) continue;
      await access(new URL(match[1], url));
    }
  }
});
