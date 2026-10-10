# MCPGateway — Kodlama ajanı oturumları arasında yerel MCP sunucularını paylaşın

<a id="languages"></a>
<details>
<summary>Languages / 语言 / 言語 / اللغات (16)</summary>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [العربية](README.ar.md) · [हिन्दी](README.hi.md) · [Bahasa Indonesia](README.id.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md)

</details>

Yerel MCP arka uçlarını oturumlar arasında paylaşın: yinelenen RAM kullanımını önleyin, başlatma işini yeniden kullanın ve yalnız yapılandırma eklerken ajanın mevcut MCP bağlantısını yeniden başlatmadan koruyun (SDK/stdio yolu; net fayda ek yüke bağlı).

[Copilot CLI ile başlayın](#first-use) · [İstemci doğrulaması](../CLIENTS.md#compatibility-summary) · [Kanıt](#resource-examples)

<img src="../../assets/mcp-gateway-benefits.png" alt="Sunucu sürecini yeniden kullanın; her oturum ayrı kopya başlatıp ayrı RAM tüketmesin." width="780">

İngilizce etiketli kavramsal görsel, çalışma ekranı veya performans testi değil.

- **Yinelenen arka uç belleğini önleyin:** Varsayımsal örnek: 5 × 1.5 GB → bir küme; ağ geçidi/bağlayıcı ek yükünden **önce** 6 GB tekrar önlenir, ölçülmüş tasarruf değildir.
- **Tekrarlanan başlatma işini yeniden kullanın:** 5 oturumun tümü 12 stdio hizmetini kullanırsa: 60 → 12 arka uç başlatması, %80 daha hızlı başlangıç değil.
- **Yalnız yapılandırma ekleyin; ajan bağlantısını koruyun:** SDK/stdio: 1 ilklendirme, iş tamamlandıktan sonra sahip olunan ağ geçidinin yeniden başlatılmasında korunur; bağlayıcı çalışmaya devam eder. Hot reload veya yerel konuşma arayüzü doğrulaması değildir. İlk kayıt/runtime yükseltmesi istemci yeniden başlatması gerektirebilir. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

Aynı arka uç ve kataloğu kullanan birden fazla oturum için uygun; tek oturum veya hafif arka uçlar ek yükü karşılamayabilir.

<a id="first-use"></a>
## İlk kurulum ve çağrı

**Ön koşullar:** Node.js 24 veya üzeri, npm, Git, eklenti destekli Copilot CLI ve yapılandırılmış, kimliği doğrulanmış MCP hizmetleri. İlk kurulum şu anda Copilot CLI üzerinden yapılır; ana test platformu Windows’tur ve Agency isteğe bağlıdır. Uyumluluk ve doğrulama düzeyi istemciye göre değişir.

Yapılandırma ve yedekler kimlik bilgileri içerebilir: gizli tutun ve yalnız amaçlanan değişiklikleri onaylayın.

[Çıkış ve kalıcı runtime](../REFERENCE.md#planned-exit) · [rollback ≠ daemon shutdown](../REFERENCE.md#setup-recovery)

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Kurulumdan sonra Copilot CLI’yi açıp `/mcp-gateway-setup` çağırın. Önizlemeyi inceleyin ve yalnızca istediğiniz değişiklikleri onaylayın. Copilot’u kapatıp yeniden açın, döndürülen tam `readinessCommand` komutunu çalıştırın. Özel yedekleri ve geri alma komutlarını saklayın.

Keşif ve şema sahiplik gerektirmez; `requiresExclusiveAccess: true` ise `call_tool` öncesinde `claim_server` gerekir.

> Ağ geçidini [izinli salt okunur görevim] için kullan: sunucuları listele, aracı keşfet, şemasını incele ve izinli hassas olmayan test değerleriyle bağımsız değişkenleri hazırla. Normal onayları al, tek oturuma ayrılan yürütmeden önce sahipliği talep et ve bütün çağrılar bitince bırak. Gerçek sonucu göster. Bilinmeyen sonucu tekrar deneme; kurulum sorumlusuna devret.

[SDK tool flow: `list_servers` → `search_tools` → `get_tool_schema` → `claim_server` (exclusive) → `call_tool` → `release_server`](../../README.md#first-use) · [REFERENCE](../REFERENCE.md#unknown-exclusive-result)

2. `list_servers` aracına `{}` gönderin: yapılandırılmış takma adlar, durumlar ve tek oturumla sınırlı erişim göstergeleri görünmelidir. Yetkili bir arka uç seçin, `search_tools` ile görevinize uygun bir terim arayın ve `get_tool_schema` ile aracın giriş şemasını alın. Şemaya uygun bağımsız değişkenler hazırlayıp `call_tool` ile onaylanmış salt okunur işlemi yapın. Beklenen sonuç gerçek kayıt veya belgelenmiş boş sonuçtur; hataları da kontrol edin, yanıt almak tek başına başarı değildir.
3. `requiresExclusiveAccess: true` ise çağrıdan önce `claim_server`, bütün çağrılar tamamlandıktan sonra `release_server` kullanın. Tek oturumla sınırlı erişim gerektirmeyen arka uçlar için rezervasyon gerekmez. Sonucu bilinmeyen zaman aşımında yeniden denemeyin; etkin işleri inceleyip yeniden başlatmayı koordine edin. Sonuç bilinmiyorsa tek oturumun erişimine ayrılan arka uç, ağ geçidi yeniden başlatılana kadar engelli kalır; sahipliği bırakmak veya istemcinin bağlantısını kesmek engeli güvenli biçimde kaldırmaz. Bağlantıyı kesmek işlemi iptal etmez.
4. Aynı bağlayıcı ve kataloğu kullanan ikinci oturumda aynı takma ad için `list_servers` / `search_tools` çağrılarını tekrarlayın. Başlatılmış arka uçta `ready` ve aynı katalog yeteneklerini bekleyin. Aynı takma ad süreç kimliğini veya RAM tasarrufunu kanıtlamaz; açık paylaşım testine bakın. [Süreç paylaşımı yöntemi](../BENCHMARK.md#method) · [Katalog önbelleği testi](../../test/catalog-scale.test.js)

[Tam İngilizce örnek](../../README.md#first-use) · [Uyumluluk](../CLIENTS.md#compatibility-summary)

## Sınırlar, gizlilik ve kurtarma

Claude Code, Codex, Gemini CLI, Kimi veya Qwen CLI üzerinden bu depoyu bulmak doğrudan istemci entegrasyonu garantisi değildir. Gemini CLI kurulum yolu burada belgelenmemiştir; Antigravity başka bir istemcidir. Kimi yalnızca adaptör düzeyinde test edilmiştir. Yapılandırma ve yedekler kimlik bilgileri içerebilir; yayımlamayın veya sürüm denetimine eklemeyin. Arka uçlar uzak hizmetlere bağlanabilir; paylaşım çevrimdışı çalışma ya da sabit RAM/token tasarrufu anlamına gelmez.

Liste boşsa seçilen yapılandırmayı ve taşıma önizlemesini kontrol edin. Eşleşme yoksa arka uç açıklamalarındaki terimleri kullanın. Kimlik doğrulama veya hazırlık hatalarında işletim kılavuzunu izleyin, atlatmak için paralel süreç açmayın. İstemci ayarlarını geri yüklemek kalıcı çalışma zamanını durdurmaz; çıkış için operatöre devir ve tamamlanma kontrollerini izleyin.

[Gizlilik](../REFERENCE.md#state-and-privacy) · [Kurtarma ve geri alma](../REFERENCE.md#setup-recovery) · [Çıkış ve operatöre devir](../REFERENCE.md#planned-exit)

<a id="resource-examples"></a>

**Yinelenen arka uçların RAM kullanımını azaltın**

Ölçüm değil, varsayımsal örnek: 5 oturumun her biri aynı 12 bağlantıya ihtiyaç duyar; tam bir arka uç kümesi 1.5 GB kullanır. Uyumlu oturumlar aynı bağlayıcı ve katalog üzerinden gerçek süreçleri paylaşır.

| Dağıtım | Arka uç RAM |
|---|---|
| Bağımsız kopyalar | 5 × 1.5 GB = 7.5 GB |
| Paylaşılan tek küme | 1.5 GB + ağ geçidi ve bağlayıcı ek yükü |

Ek yükten önce önlenen yinelenen RAM: 7.5 GB - 1.5 GB = 6 GB. Toplam tasarruf ölçülene kadar bilinmez. 1.5 GB her iş yükü veya istemcide sabit değildir; beş modelin RAM tasarrufu değildir.

**Başlatma işini de yeniden kullanın.** 5 oturumun tümü 12 stdio hizmetini kullanırsa, ayrı kopyalarda en fazla `5 × 12 = 60`, paylaşımda `12` başlatma gerekir: `60 - 12 = 48` tekrar önlenir, `48 / 60 × 100 = 80%` daha az başlatma. İhtiyaç anında yalnız kullanılan `k` arka uca bağlanılır; kullanılmayanlar başlatılmaz. İşlem sayısıdır, %80 daha hızlı başlangıç değildir. Gecikme ölçülmedi; eşzamanlılık, kimlik doğrulama ve platform süreyi etkiler.

1000 araç → 6 başlangıç tanımı: (1000 - 6) / 1000 × 100 = 99.4% daha az tanım, token değil. Sonradan istenen şemaların da maliyeti vardır; zaten gecikmeli yükleyen istemcilerin kazancı daha az olabilir. Sentetik katalog testi altı aracı ve iki istemci arasında paylaşılan keşif önbelleğini doğrular, RSS performansını değil. [catalog-scale.test.js](../../test/catalog-scale.test.js)

**Hafif düzenek ölçümü: süreçlerin toplam working set değeri arttı** Windows x64 / Node 24.13.1, 3 denemenin medyanı: paylaşılan şema + echo soğuk arka uçta 426.2 ms, ikinci istemcide 21.1 ms, beşincide 19.0 ms. İlk istemci toplamı: doğrudan 503.5 ms, ağ geçidi hazırken paylaşılan 894.3 ms; tamamen soğuk paylaşılan başlangıç 1886.7 ms. Arka uç süreçleri 5 → 1, fakat toplam süreçler 5 → 7 ve working set toplamı 357.0 MiB → 564.0 MiB: toplam süreç working set değeri daha yüksek; benzersiz fiziksel bellek ölçülmedi. Tek echo ağır gerçek hizmetleri temsil etmez; yukarıdaki 1.5 GB ayrı varsayımdır, ölçüm değildir. [BENCHMARK.md](../BENCHMARK.md)

Ölçüm süreçlerin working set toplamıdır; tekrar sayımı çıkarılmış fiziksel bellek ve özel baytlar (private bytes) ölçülmedi.

<a id="mechanism"></a>

## Nasıl çalışır

Ajanın mevcut MCP bağlantısını yeniden başlatmadan arka uç ekleyin: eklemeleri eşitleyin, etkin işi tamamlayın ve yalnız sahip olunan ağ geçidini yeniden başlatın; mevcut bağlayıcı tekrar bağlanır. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

SDK/stdio testi aynı bağlayıcı ve MCP bağlantısıyla yeniden başlatma sonrası yeni takma adı keşfedip echo çalıştırır; ürünlerin konuşma arayüzleri test edilmedi. Otomatik hot reload değildir; çakışmalar incelenir. İlk kayıt veya runtime yükseltmesi istemci yeniden başlatması gerektirebilir. Kesilen çağrılar tekrarlanmaz; yeniden başlatma sonrası tek oturuma ayrılan erişimi tekrar talep edin.

Kurumsal API yönetişim platformu değildir.

Ağ geçidi ajana her zaman 6 araç sunar: 4'ü yetenekleri bulup çağırmak, 2'si bir seferde yalnızca bir oturumun erişebildiği entegrasyonlar içindir. Bağlantı eklemek başlangıç arayüzünü büyütmez; tam şema yalnızca seçilen araç için yüklenir. Önceden yapılandırıp doğruladığınız bağlantılar yeniden kullanılır; hizmet kurulmaz veya kimlik bilgisi sağlanmaz.

```text
Ajan A ─┐                          ┌─ Entegrasyon A: birçok araç
Ajan B ─┼─ bağlayıcı ─ MCPGateway ─┼─ Entegrasyon B: birçok araç
Ajan C ─┘                          └─ Entegrasyon C: birçok araç
```

Birden fazla ajan aynı bağlayıcı üzerinden MCPGateway’e erişir; yapılandırılmış arka uçlardan seçilenlere ihtiyaç duyulduğunda bağlanılır. Şema paylaşım mekanizmasını açıklar; performans testi veya çalışma anında doğrulama değildir ve tüm arka uçların başlatıldığı anlamına gelmez.

<a id="clients"></a>
## İstemciye göre kurulum ve yükseltme

> Bu, yerelleştirilmiş bir genel bakıştır. Tam kurulum, yükseltme ve teknik ayrıntılar için İngilizce [README](../../README.md) ile aşağıda bağlantısı verilen İngilizce istemci kılavuzu yetkili kaynaklardır.

<details>
<summary>İstemciye göre kurulum ve yükseltme</summary>

Örneğin Copilot’taki **10** bağlantıya, desteklenen Claude yapılandırmasından açıkça taşınan **2** yeni bağlantı eklenince iki ajan da aynı **12** bağlantıyı kullanabilir.

- Eklenti tek başına yapılandırmaları birleştirmez. Aynı adlı girdiler ancak takma ad tanımları birebir aynıysa tekilleştirilir; aynı hizmete işaret etmek yetmez. Çakışmalar inceleme için işlemi durdurur.
- Taşıma önce önizleme gösterir, yedek oluşturur ve desteklenmeyen istemciye özgü ayarları reddeder.
- Bu, her istemcinin kendi ortamında uçtan uca test edildiği anlamına gelmez. [Taşıma kılavuzu (İngilizce)](../CLIENTS.md#cross-client-migration).

| İstemci | Kurulum | Yükseltme  Gerekli ilk kurulum | Doğrulama düzeyi |
|---|---|------|---|
| GitHub Copilot CLI | [Kur](../CLIENTS.md#copilot-cli-install) | [Yükselt](../CLIENTS.md#copilot-cli-upgrade)  [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Marketplace/kurulum yolu; yalıtılmış ayrıştırma](../CLIENTS.md#compatibility-summary) |
| VS Code (düzenleyici) | [Kur](../CLIENTS.md#vs-code-install) | [Yükselt](../CLIENTS.md#vs-code-upgrade)  [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Kayıt/biçim bağdaştırıcısı test edildi; yerel istemcide uçtan uca oturum test edilmedi](../CLIENTS.md#compatibility-summary) |
| Claude Code | [Kur](../CLIENTS.md#claude-code-install) | [Yükselt](../CLIENTS.md#claude-code-upgrade)  [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Yalıtılmış yapılandırma ayrıştırıldı; model/arka uç çalışmadı](../CLIENTS.md#compatibility-summary) |
| Codex CLI | [Kur](../CLIENTS.md#codex-install) | [Yükselt](../CLIENTS.md#codex-upgrade)  [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [İstemcinin kendi doğrulaması politika nedeniyle engellendi](../CLIENTS.md#compatibility-summary) |
| OpenCode | [Kur](../CLIENTS.md#opencode-install) | [Yükselt](../CLIENTS.md#opencode-upgrade)  [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Kayıt/biçim bağdaştırıcısı test edildi; yerel istemcide uçtan uca oturum test edilmedi](../CLIENTS.md#compatibility-summary) |
| Qwen Code | [Kur](../CLIENTS.md#qwen-code-install) | [Yükselt](../CLIENTS.md#qwen-code-upgrade)  [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Kayıt/biçim bağdaştırıcısı test edildi; yerel istemcide uçtan uca oturum test edilmedi](../CLIENTS.md#compatibility-summary) |
| Kimi CLI | [Kur](../CLIENTS.md#kimi-cli-install) | [Yükselt](../CLIENTS.md#kimi-cli-upgrade)  [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Kayıt/biçim bağdaştırıcısı test edildi; yerel istemcide uçtan uca oturum test edilmedi](../CLIENTS.md#compatibility-summary) |
| Antigravity CLI | [Kur](../CLIENTS.md#antigravity-cli-install) | [Yükselt](../CLIENTS.md#antigravity-cli-upgrade)  [Copilot CLI](../CLIENTS.md#shared-gateway-prerequisite) | [Kayıt/biçim bağdaştırıcısı test edildi; yerel istemcide uçtan uca oturum test edilmedi](../CLIENTS.md#compatibility-summary) |

</details>

**İşletim kılavuzu (İngilizce):** [İşletim kılavuzunu aç](../REFERENCE.md)

**Lisans:** [MIT](../../LICENSE)
