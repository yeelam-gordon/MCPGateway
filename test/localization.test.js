import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const languages = JSON.parse(await read('docs/i18n/languages.json')).languages;
const entries = await Promise.all(languages.map(async language => ({ ...language, text: await read(language.path) })));

// Native source anchors detect lost consequential meaning; they are not fluency certification.
const nativeGuards = new Map([
  ['zh-CN', ['不是实测净节省', '不代表启动耗时缩短 80%', '结束活动工作', "不是热加载、活动调用连续性或所有原生对话界面的证明；", '首次注册与运行时升级', '正常批准', '获授权且不敏感', '有说明的空结果', '检查错误', '不要重试', '保持阻塞', '重新认领', '不会关闭网关进程', '保留私有状态、凭据、历史与无关进程']],
  ['zh-TW', ['不是實測淨節省', '不代表啟動耗時縮短 80%', '結束活動工作', "不是熱載入、進行中呼叫的連續性或所有原生對話介面的證明；", '首次註冊與執行階段升級', '正常核准', '獲授權且不敏感', '有說明的空結果', '檢查錯誤', '不要重試', '維持封鎖', '重新認領', '不會關閉閘道程序', '保留私有狀態、認證資訊、歷史與無關程序']],
  ['ja', ['実測の純削減ではありません', '80% 短くなる意味ではありません', '作業完了後', "ホットリロード、実行中の呼び出し継続、全製品の会話 UI の証明ではありません。", '初期登録やランタイム更新', '通常の承認', '許可済みの非機密', '説明付きの空結果', 'エラーを確認', '再試行せずブロック', '新たに予約', 'ゲートウェイは停止しません', '資格情報、履歴、無関係なプロセス']],
  ['ko', ['실측 순절감이 아닙니다', '80% 빨라진다는 뜻이 아닙니다', '작업을 끝낸 뒤', "핫 리로드, 실행 중 호출의 연속성, 모든 제품의 대화 UI 검증이 아닙니다.", '최초 등록·런타임 업그레이드', '일반 승인', '허가된 비민감', '설명된 빈 결과', '오류를 확인', '재시도하지 말고 차단', '다시 예약', '게이트웨이를 종료하지 않습니다', '자격 증명, 기록과 무관한 프로세스']],
  ['es', ['No es ahorro neto medido', 'no significa un arranque 80% más rápido', 'después de finalizar el trabajo', "No demuestra recarga en caliente, continuidad de llamadas activas ni conservación de la conexión en todas las interfaces nativas de conversación.", 'registro inicial', 'aprobaciones normales', 'autorizados y no sensibles', 'resultado vacío documentado', 'comprueba errores', 'no reintentes', 'mantenlo bloqueado', 'vuelve a reservar', 'no detiene el gateway', 'credenciales, historial y procesos ajenos']],
  ['fr', ['pas une économie nette mesurée', 'ne signifie pas un démarrage 80% plus rapide', 'travaux terminés', "Ce n’est ni un rechargement à chaud, ni la continuité des appels actifs, ni une preuve pour toutes les interfaces natives.", 'enregistrement initial', 'approbations normales', 'autorisées et non sensibles', 'résultat vide documenté', 'vérifiez les erreurs', 'ne réessayez pas', 'maintenez le blocage', 'réservez à nouveau', 'n’arrête pas la passerelle', 'identifiants, historique et processus sans rapport']],
  ['de', ['keine gemessene Nettoersparnis', 'nicht 80% schnelleres Starten', 'nach Arbeitsabschluss', "Kein Hot Reload, keine Fortsetzung aktiver Aufrufe und kein Nachweis für alle nativen Gesprächsoberflächen.", 'Erstregistrierung und Runtime-Upgrades', 'üblichen Genehmigungen', 'nicht sensiblen Testwerten', 'dokumentiertes leeres Ergebnis', 'prüfe Fehler', 'nicht erneut aufrufen', 'gesperrt lassen', 'neu reservieren', 'beendet das Gateway nicht', 'Zugangsdaten, Verlauf und fremde Prozesse']],
  ['pt-BR', ['Não é economia líquida medida', 'Não significa iniciar 80% mais rápido', 'depois de concluir o trabalho', "Não demonstra hot reload, continuidade de chamadas ativas nem a preservação da conexão em todas as interfaces nativas de conversa.", 'Registro inicial', 'aprovações normais', 'autorizados e não sensíveis', 'resultado vazio documentado', 'confira erros', 'não repita', 'mantenha o bloqueio', 'reserve novamente', 'não encerra o gateway', 'credenciais, histórico e processos alheios']],
  ['it', ['Non è un risparmio netto misurato', 'Non significa un avvio più rapido', 'a lavoro concluso', "Non dimostra hot reload né continuità delle chiamate attive e non dimostra la continuità della conversazione in tutti i client nativi.", 'Registrazione iniziale', 'approvazioni normali', 'autorizzati e non sensibili', 'risultato vuoto documentato', 'verifica gli errori', 'non riprovare', 'mantieni il blocco', 'prenota di nuovo', 'non arresta il gateway', 'credenziali, cronologia e processi estranei']],
  ['ru', ['не измеренная чистая экономия', 'не ускорение запуска на 80%', 'по завершении работы', "Это не горячая перезагрузка, не продолжение активных вызовов и не проверка всех нативных интерфейсов диалога.", 'Первичная регистрация', 'обычные согласования', 'несекретными тестовыми значениями', 'документированный пустой результат', 'проверь ошибки', 'не повторяй вызов', 'оставь блокировку', 'захватите доступ заново', 'не останавливает шлюз', 'учётные данные, историю и посторонние процессы']],
  ['hi', ['मापी गई शुद्ध बचत नहीं', '80% तेज़ शुरुआत नहीं', 'काम पूरा होने के बाद', "यह hot reload, चलती कॉल की निरंतरता या सभी नेटिव बातचीत UI का प्रमाण नहीं है।", 'पहली बार पंजीकरण', 'सामान्य मंज़ूरी', 'अधिकृत गैर-संवेदनशील', 'समझाया गया खाली परिणाम', 'त्रुटियाँ जाँचें', 'दोबारा कोशिश न करें', 'अवरोध बनाए रखें', 'फिर पहुँच लें', 'गेटवे बंद नहीं होता', 'क्रेडेंशियल, इतिहास और असंबंधित प्रक्रियाएँ']],
  ['id', ['Bukan penghematan bersih terukur', 'Bukan berarti waktu inisialisasi 80% lebih cepat', 'pekerjaan selesai', "Bukan hot reload, kelanjutan panggilan aktif, atau bukti semua UI percakapan native.", 'Registrasi awal', 'persetujuan normal', 'diizinkan dan tidak sensitif', 'hasil kosong terdokumentasi', 'periksa kesalahan', 'jangan ulangi', 'biarkan diblokir', 'klaim lagi', 'tidak menghentikan gateway', 'kredensial, riwayat dan proses lain']],
  ['vi', ['Không phải mức tiết kiệm ròng đã đo', 'Không có nghĩa khởi động nhanh hơn 80%', 'công việc kết thúc', "Không chứng minh hot reload, tính liên tục của lời gọi đang chạy hay mọi giao diện hội thoại native.", 'Đăng ký lần đầu', 'phê duyệt thông thường', 'được phép, không nhạy cảm', 'kết quả rỗng có giải thích', 'kiểm tra lỗi', 'không thử lại', 'giữ trạng thái chặn', 'yêu cầu lại quyền', 'không dừng gateway', 'thông tin xác thực, lịch sử và tiến trình không liên quan']],
  ['tr', ['Ölçülmüş net tasarruf değildir', '%80 daha hızlı başlangıç demek değildir', 'işler bittikten sonra', "Hot reload, etkin çağrıların devamlılığı veya tüm yerel sohbet arayüzleri için kanıt değildir.", 'İlk kayıt', 'Normal onayları', 'hassas olmayan test değerleri', 'belgelenmiş boş sonucu', 'hataları kontrol', 'tekrar deneme', 'engeli koru', 'yeniden sahiplik isteyin', 'ağ geçidini durdurmaz', 'kimlik bilgilerini, geçmişi ve ilgisiz süreçleri']],
  ['ar', ['ليس توفيرًا صافيًا مقاسًا', 'لا يعني بدءًا أسرع بنسبة 80%', 'بعد انتهاء العمل', "لا تثبت hot reload أو استمرار الاستدعاءات النشطة أو جميع واجهات المحادثة الأصلية.", 'التسجيل الأول', 'الموافقات المعتادة', 'مأذون بها وغير حساسة', 'نتيجة فارغة موضحة', 'افحص الأخطاء', 'فلا تكرر المحاولة', 'أبقِ الحظر', 'احجز من جديد', 'لا توقف البوابة', 'بيانات الاعتماد والسجل والعمليات غير ذات الصلة']]
]);

test('all sixteen concise entries have a complete early language chooser and the current three-action image', async () => {
  assert.equal(entries.length, 16); assert.equal(new Set(entries.map(e => e.code)).size, 16);
  const png = await readFile(new URL('assets/mcp-gateway-benefits.png', root));
  assert.equal(png.readUInt32BE(16), 1536); assert.equal(png.readUInt32BE(20), 600);
  for (const entry of entries) {
    const t = entry.text; const url = new URL(entry.path, root);
    assert.ok(t.split('\n').length <= 90, `${entry.code}: expansion guardrail, not readability approval`);
    assert.match(t, /^# MCPGateway /);
    const chooser = t.match(/<details>[\s\S]*?<\/details>/)?.[0];
    assert.ok(chooser.includes('<summary>Languages (16)</summary>'));
    assert.ok(t.indexOf('<summary>') < t.indexOf('<img'));
    const targets = [...chooser.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
    assert.equal(targets.length, 16); assert.equal(new Set(targets.map(m => new URL(m[2], url).href)).size, 16);
    for (const language of languages) assert.ok(targets.some(m => m[1] === language.name && new URL(m[2], url).href === new URL(language.path, root).href), `${entry.code}: ${language.code}`);
    for (const m of targets) await access(new URL(m[2], url));
    const img = t.match(/<img src="([^"]+)" alt="([^"]+)" width="780">/);
    assert.ok(img); assert.equal(new URL(img[1], url).href, new URL('assets/mcp-gateway-benefits.png', root).href);
    assert.ok(img[2].includes('MCP') && img[2].includes('SDK/stdio'));
    assert.doesNotMatch(t, /^\|/m, 'no duplicated numerical/client tables in overview');
    assert.doesNotMatch(t.replace(/<code dir="ltr">[^<]*<\/code>/g, ''), /dir="ltr"/i, 'only numerical code runs may be isolated; native prose stays RTL');
    for (const m of t.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) if (!/^https?:/.test(m[1])) await access(new URL(m[1], url));
  }
});

test('native entries preserve local consequential meaning and numerical scope, not merely English links', () => {
  for (const entry of entries.filter(e => e.code !== 'en')) {
    assert.ok(nativeGuards.has(entry.code));
    for (const phrase of nativeGuards.get(entry.code)) assert.ok(entry.text.replace(/<\/?code[^>]*>/g, '').includes(phrase), `${entry.code}: ${phrase}`);
    const beforeAction = entry.text.slice(0, entry.text.indexOf('```powershell'));
    assert.ok(beforeAction.includes(nativeGuards.get(entry.code).at(-2)), `${entry.code}: persistent-runtime consequence before installation`);
    for (const value of ['5 × 1.5 GB', '6 GB', '60 → 12', 'SDK/stdio', '357.0 → 564.0 MiB', '1886.7 ms', '503.5 ms', 'Node.js 24+', 'npm', 'Git', 'Copilot CLI', 'Windows']) assert.ok(beforeAction.includes(entry.code === 'de' && value === '60 → 12' ? 'Nutzen alle fünf Sitzungen die zwölf stdio-Dienste, sinkt die Zahl der Backendstarts von 60 auf 12.' : value), `${entry.code}: before install ${value}`);
    const benefits = entry.text.slice(entry.text.indexOf('<img'), entry.text.indexOf('<a id="resource-examples">'));
    assert.equal((benefits.match(/^- \*\*/gm) ?? []).length, 3);
    assert.ok(benefits.includes('../BENCHMARK.md#configuration-only-connection-continuity'));
  }
});

test('native first use is one authorized assisted route with discovery, schema and ownership controls', () => {
  for (const entry of entries.filter(e => e.code !== 'en')) {
    const t = entry.text;
    assert.equal((t.match(/copilot plugin install /g) ?? []).length, 1);
    const install = t.match(/```powershell\r?\n([\s\S]*?)\r?\n```/)?.[1]?.replaceAll("\r", "");
    assert.equal(install, 'copilot plugin marketplace add yeelam-gordon/MCPGateway\ncopilot plugin install shared-mcp-gateway@mcp-gateway');
    assert.ok(t.includes('/mcp-gateway-setup')); assert.ok(t.includes('`readinessCommand`'));
    assert.ok(t.includes('../REFERENCE.md#readiness-command-object'));
    assert.ok(!t.includes('$commandArgs'), 'object invocation belongs in canonical reference');
    const request = t.match(/^> (.+)$/m)?.[1]; assert.ok(request);
    for (const tool of ['list_servers', 'search_tools', 'get_tool_schema', 'requiresExclusiveAccess: true', 'claim_server', 'call_tool', 'release_server']) assert.ok(request.includes('`'+tool+'`'), `${entry.code}: ${tool}`);
    assert.ok(request.indexOf('list_servers') < request.indexOf('search_tools'));
    assert.ok(request.indexOf('search_tools') < request.indexOf('get_tool_schema'));
    assert.ok(t.includes('`ready`')); assert.ok(t.includes('../REFERENCE.md#first-shared-workflow'));
    for (const target of ['native-http-oauth', 'setup-recovery', 'unknown-exclusive-result', 'planned-exit']) assert.ok(t.includes(`../REFERENCE.md#${target}`), `${entry.code}: ${target}`);
  }
});

test('canonical guides retain exact readiness, unknown-outcome recovery, all clients and full adverse provenance', async () => {
  const [reference, clients, evidence] = await Promise.all([read('docs/REFERENCE.md'), read('docs/CLIENTS.md'), read('docs/BENCHMARK.md')]);
  for (const value of ['.command', '.args', 'UTF-8', 'not the whole output', 'ConvertFrom-Json', '& $command @commandArgs', 'not arbitrary web/service data', 'a **new claim**', 'Release/disconnect cannot safely clear an unknown-outcome block', 'clients restored; owned daemon stopped; private data retained', 'PID or port alone is not ownership proof']) assert.ok(reference.includes(value), value);
  for (const client of ['copilot-cli', 'vs-code', 'claude-code', 'codex', 'opencode', 'qwen-code', 'kimi-cli', 'antigravity-cli']) for (const action of ['install', 'upgrade']) assert.ok(clients.includes(`id="${client}-${action}"`));
  for (const value of ['357.0', '564.0', '1886.7', '503.5', 'unique physical memory', 'private bytes', 'Source revision for the timing run was not recorded', 'before overhead', 'not 99.4% fewer tokens', 'not 80% faster elapsed startup']) {
    assert.ok(evidence.includes(value), value);
  }
});

const negationMutations = new Map([
  [
    "zh-CN",
    [
      "不是",
      "是"
    ]
  ],
  [
    "zh-TW",
    [
      "不是",
      "是"
    ]
  ],
  [
    "ja",
    [
      "ではありません",
      "です"
    ]
  ],
  [
    "ko",
    [
      "아닙니다",
      "맞습니다"
    ]
  ],
  [
    "es",
    [
      "No demuestra",
      "Demuestra"
    ]
  ],
  [
    "fr",
    [
      "Ce n’est ni",
      "C’est"
    ]
  ],
  [
    "de",
    [
      "Kein Hot Reload, keine",
      "Hot Reload,"
    ]
  ],
  [
    "pt-BR",
    [
      "Não demonstra",
      "Demonstra"
    ]
  ],
  [
    "it",
    [
      "Non dimostra",
      "Dimostra"
    ]
  ],
  [
    "ru",
    [
      "Это не",
      "Это"
    ]
  ],
  [
    "hi",
    [
      "नहीं है",
      "है"
    ]
  ],
  [
    "id",
    [
      "Bukan",
      "Ini"
    ]
  ],
  [
    "vi",
    [
      "Không chứng minh",
      "Chứng minh"
    ]
  ],
  [
    "tr",
    [
      "kanıt değildir",
      "kanıttır"
    ]
  ],
  [
    "ar",
    [
      "لا تثبت",
      "تثبت"
    ]
  ]
]);

test('all fifteen native continuity negation reversals are rejected by consequential guards', () => {
  for (const entry of entries.filter(e => e.code !== 'en')) {
    const [negative, positive] = negationMutations.get(entry.code);
    const clause = nativeGuards.get(entry.code)[3];
    assert.ok(clause.includes(negative), `${entry.code}: mutation targets the full negative clause`);
    assert.ok(entry.text.includes(clause), `${entry.code}: correct current clause`);
    const mutated = entry.text.replace(clause, clause.replace(negative, positive));
    assert.notEqual(mutated, entry.text, `${entry.code}: mutation occurred`);
    assert.throws(() => {
      for (const guard of nativeGuards.get(entry.code)) assert.ok(mutated.replace(/<\/?code[^>]*>/g, '').includes(guard), `${entry.code}: ${guard}`);
    }, assert.AssertionError, `${entry.code}: false continuity claim must fail`);
  }
});

test('Arabic comparative numbers use isolated LTR code runs without forcing Arabic prose', () => {
  const arabic = entries.find(e => e.code === 'ar').text;
  for (const value of ['5 × 1.5 GB', '6 GB', '60 → 12', '80%', '357.0 → 564.0 MiB', '1886.7 ms', '503.5 ms']) {
    assert.ok(arabic.includes(`<code dir="ltr">${value}</code>`), value);
  }
  assert.doesNotMatch(arabic, /<(?:p|div|li|article)[^>]*dir="ltr"/);
});

const firstUseGuards = new Map(Object.entries({
  "en": [
    "Keep your existing agent-to-gateway connection across a settled configuration-only restart on the tested SDK/stdio route.",
    "Save only the returned JSON object; `.command` is the approved executable and `.args` its exact ordered arguments.",
    "Local private state and saved gateway tokens are owner-only, not additionally encrypted.",
    "slower fully cold first shared request (gateway launch through first useful result)"
  ],
  "zh-CN": [
    "从你的智能体到网关的现有连接",
    "只保存返回的 JSON 对象；`.command` 是获批准的可执行程序，`.args` 是顺序不变的精确参数。",
    "本地私有状态和保存的网关令牌仅限所有者访问，未额外加密。",
    "从全新网关启动到首次共享请求的有用结果耗时为"
  ],
  "zh-TW": [
    "從你的代理程式到閘道的現有連線",
    "只儲存傳回的 JSON 物件；`.command` 是已核准的執行檔，`.args` 是保持原順序的精確引數。",
    "本機私有狀態與儲存的閘道權杖僅限擁有者存取，未額外加密。",
    "從全新閘道啟動到首次共用請求的有用結果耗時為"
  ],
  "ja": [
    "エージェントからゲートウェイへの既存の接続",
    "返された JSON オブジェクトだけを保存します。`.command` は承認済み実行ファイル、`.args` は順序を保つ正確な引数です。",
    "ローカルの非公開状態と保存されたゲートウェイトークンは所有者のみアクセス可能で、追加の暗号化はありません。",
    "ゲートウェイを新規起動して最初の共有リクエストの有用な結果を得るまでの時間は"
  ],
  "ko": [
    "에이전트에서 게이트웨이로 이어지는 기존 연결",
    "반환된 JSON 객체만 저장하세요. `.command`는 승인된 실행 파일이고 `.args`는 순서를 그대로 유지할 정확한 인수입니다.",
    "로컬 비공개 상태와 저장된 게이트웨이 토큰은 소유자만 접근할 수 있으며 추가로 암호화되지 않습니다.",
    "게이트웨이를 새로 시작하여 첫 공유 요청의 유용한 결과를 얻기까지는"
  ],
  "es": [
    "conexión existente de tu agente al gateway",
    "Guarda solo el objeto JSON devuelto; `.command` es el ejecutable aprobado y `.args` sus argumentos exactos en orden.",
    "El estado privado local y los tokens guardados del gateway son accesibles solo al propietario, sin cifrado adicional.",
    "la primera solicitud compartida, desde iniciar un gateway nuevo hasta obtener un resultado útil, tardó"
  ],
  "fr": [
    "connexion existante de votre agent à la passerelle",
    "Enregistrez uniquement l’objet JSON retourné ; `.command` est l’exécutable approuvé et `.args` ses arguments exacts dans l’ordre.",
    "L’état privé local et les jetons enregistrés de la passerelle sont accessibles au seul propriétaire, sans chiffrement supplémentaire.",
    "la première requête partagée, du lancement d’une nouvelle passerelle au premier résultat utile, a pris"
  ],
  "de": [
    "bestehende Verbindung von Ihrem Agenten zum Gateway",
    "Speichern Sie nur das zurückgegebene JSON-Objekt; `.command` ist die genehmigte ausführbare Datei und `.args` enthält die exakten Argumente in ihrer Reihenfolge.",
    "Lokaler privater Zustand und gespeicherte Gateway-Tokens sind nur für den Eigentümer zugänglich, nicht zusätzlich verschlüsselt.",
    "die erste gemeinsame Anfrage vom Start eines neuen Gateways bis zum nutzbaren Ergebnis dauerte"
  ],
  "pt-BR": [
    "conexão existente do seu agente ao gateway",
    "Salve apenas o objeto JSON retornado; `.command` é o executável aprovado e `.args` contém os argumentos exatos na ordem original.",
    "O estado privado local e os tokens salvos do gateway têm acesso restrito ao proprietário, sem criptografia adicional.",
    "a primeira solicitação compartilhada, da inicialização de um gateway novo ao primeiro resultado útil, levou"
  ],
  "it": [
    "connessione esistente dal tuo agente al gateway",
    "Salva solo l’oggetto JSON restituito; `.command` è l’eseguibile approvato e `.args` sono gli argomenti esatti nel loro ordine.",
    "Lo stato privato locale e i token salvati del gateway sono accessibili solo al proprietario, senza ulteriore cifratura.",
    "la prima richiesta condivisa, dall’avvio di un nuovo gateway al primo risultato utile, ha richiesto"
  ],
  "ru": [
    "существующее соединение вашего агента со шлюзом",
    "Сохраните только возвращённый JSON-объект: `.command` — одобренный исполняемый файл, `.args` — точные аргументы в исходном порядке.",
    "Локальное приватное состояние и сохранённые токены шлюза доступны только владельцу и дополнительно не шифруются.",
    "первый общий запрос от запуска нового шлюза до полезного результата занял"
  ],
  "hi": [
    "आपके एजेंट से गेटवे तक मौजूदा कनेक्शन",
    "केवल लौटाया गया JSON ऑब्जेक्ट सहेजें; `.command` मंज़ूर किया गया निष्पादन योग्य प्रोग्राम है और `.args` उसके सटीक तर्क उसी क्रम में हैं।",
    "स्थानीय निजी स्थिति और सहेजे गए गेटवे टोकन केवल मालिक के लिए सुलभ हैं; अतिरिक्त एन्क्रिप्शन नहीं है।",
    "नया गेटवे शुरू करने से लेकर पहले साझा अनुरोध का उपयोगी परिणाम मिलने तक का समय"
  ],
  "id": [
    "koneksi yang sudah ada dari agen Anda ke gateway",
    "Simpan hanya objek JSON yang dikembalikan; `.command` adalah program yang disetujui dan `.args` adalah argumen persis dalam urutan aslinya.",
    "Status privat lokal dan token gateway tersimpan hanya dapat diakses pemilik, tanpa enkripsi tambahan.",
    "permintaan bersama pertama, dari memulai gateway baru hingga hasil berguna pertama, memerlukan"
  ],
  "vi": [
    "kết nối hiện có từ agent của bạn tới gateway",
    "Chỉ lưu đối tượng JSON trả về; `.command` là tệp thực thi đã được phê duyệt và `.args` là các đối số chính xác theo đúng thứ tự.",
    "Trạng thái riêng cục bộ và token gateway đã lưu chỉ cho chủ sở hữu truy cập, không được mã hóa thêm.",
    "yêu cầu dùng chung đầu tiên, từ khởi chạy gateway mới đến kết quả hữu ích đầu tiên, mất"
  ],
  "tr": [
    "ajanınızdan ağ geçidine mevcut bağlantı",
    "Yalnız döndürülen JSON nesnesini kaydedin; `.command` onaylanan yürütülebilir dosya, `.args` ise tam ve sıralı argümanlarıdır.",
    "Yerel özel durum ve kayıtlı ağ geçidi tokenları yalnız sahibine açıktır; ayrıca şifrelenmez.",
    "yeni ağ geçidinin başlatılmasından ilk paylaşımlı isteğin yararlı sonucuna kadar geçen süre"
  ],
  "ar": [
    "الاتصال الحالي من وكيلك إلى البوابة",
    "احفظ كائن JSON المُعاد فقط؛ `.command` هو الملف التنفيذي الموافق عليه و`.args` هي وسائطه الدقيقة بالترتيب نفسه.",
    "الحالة الخاصة المحلية ورموز البوابة المحفوظة متاحة للمالك فقط، وليست مشفرة تشفيرًا إضافيًا.",
    "استغرق أول طلب مشترك، من تشغيل بوابة جديدة إلى أول نتيجة مفيدة،"
  ]
}));

test('all sixteen entries explain agent connection, fully cold first request, approved JSON object and local unencrypted state', () => {
  for (const entry of entries) {
    for (const phrase of firstUseGuards.get(entry.code)) assert.ok(entry.text.includes(phrase), `${entry.code}: ${phrase}`);
    const installAt = entry.text.indexOf('```powershell');
    assert.ok(entry.text.indexOf(firstUseGuards.get(entry.code)[2]) < installAt, `${entry.code}: state consequence before install`);
    const prefix = entry.code === 'en' ? 'docs/' : '../';
    for (const anchor of ['copilot-plugin-eligibility', 'copilot-cli-upgrade']) assert.ok(entry.text.includes(`${prefix}CLIENTS.md#${anchor}`));
    assert.equal((entry.text.match(/```powershell/g) ?? []).length, 1);
  }
});

test('Italian all-native-client continuity negation cannot be reversed independently', () => {
  const entry = entries.find(e => e.code === 'it');
  const clause = nativeGuards.get('it')[3];
  const mutated = entry.text.replace('non dimostra la continuità della conversazione', 'dimostra la continuità della conversazione');
  assert.notEqual(mutated, entry.text);
  assert.ok(!mutated.includes(clause), 'full clause rejects reversal of second consequential negation');
});

test('public echo illustration stays source-true and explicitly outside private default aliases', async () => {
  const [reference, fixture, clients] = await Promise.all([read('docs/REFERENCE.md'), read('test/fixtures/lifecycle-backend.mjs'), read('docs/CLIENTS.md')]);
  for (const phrase of ['id="public-echo-illustration"', 'not a backend installation step or real-integration proof', '{"text":"hello"}', 'actual numeric backend `pid`', 'neither `echo` nor a fixture alias is a default']) assert.ok(reference.includes(phrase), phrase);
  for (const phrase of ["registerTool('echo'", 'text: z.string()', 'structuredContent: { text, pid: process.pid }']) assert.ok(fixture.includes(phrase));
  for (const phrase of ['id="copilot-plugin-eligibility"', '`/help`', '`/plugin`', 'no minimum release version is inferred']) assert.ok(clients.includes(phrase));
});

test('final Italian authority and Hindi first-request duration clauses remain explicit', () => {
  const italian = entries.find(e => e.code === 'it').text;
  assert.doesNotMatch(italian, /gateway gestito/);
  assert.equal((italian.match(/gateway sotto la tua autorità/g) ?? []).length, 4);
  const hindi = entries.find(e => e.code === 'hi').text;
  assert.ok(hindi.includes('नया गेटवे शुरू करने से लेकर पहले साझा अनुरोध का उपयोगी परिणाम मिलने तक का समय 1886.7 ms था, जबकि सीधे अनुरोध के लिए 503.5 ms था।'));
  assert.ok(!hindi.includes('1886.7 ms बनाम सीधे 503.5 ms थी'));
});

test('German conditional start-count comparison and Japanese restart authority stay exact', () => {
  const german = entries.find(e => e.code === 'de').text;
  assert.ok(german.includes('Nutzen alle fünf Sitzungen die zwölf stdio-Dienste, sinkt die Zahl der Backendstarts von 60 auf 12. Das bedeutet nicht 80% schnelleres Starten.'));
  const japanese = entries.find(e => e.code === 'ja').text;
  assert.equal((japanese.match(/自分が管理するゲートウェイ/g) ?? []).length, 4);
  assert.ok(!japanese.includes('所有ゲートウェイ'));
});
