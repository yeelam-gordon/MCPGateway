# MCPGateway — Kodlama ajanı oturumları arasında yerel MCP sunucularını paylaşın

Her Copilot CLI oturumu için aynı MCP sunucusunun yeni bir kopyasını başlatmayın. Yapılandırılmış yerel arka uçları paylaşın, araçları gerektiğinde keşfedin ve bir seferde yalnızca bir oturumun erişebildiği iş akışlarını koordine edin. Kurumsal API yönetişim platformu değildir.

- Ağır arka uçların RAM ve başlatma işini paylaşın, her oturum için kopya çalıştırmayın.
- 6 başlangıç aracıyla yetenekleri ve şemaları ihtiyaç anında keşfedin.
- Arka uç ekleyin, ajanın MCP bağlantısını koruyun. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

Ajanın mevcut MCP bağlantısını yeniden başlatmadan arka uç ekleyin: eklemeleri eşitleyin, etkin işi tamamlayın ve yalnız sahip olunan ağ geçidini yeniden başlatın; mevcut bağlayıcı tekrar bağlanır. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

Aynı arka uç ve kataloğu kullanan birden fazla oturum için uygun; tek oturum veya hafif arka uçlar ek yükü karşılamayabilir.

[Başlayın: kurulum ve ilk izinli okuma](#first-use) · [MCP / Copilot CLI](../CLIENTS.md#shared-core-install) · [6 araç / 2 istemci](../../test/catalog-scale.test.js)

[Yinelenen arka uçların RAM kullanımını azaltın](#resource-examples): 5 × 1.5 GB = 7.5 GB → 1.5 GB + ağ geçidi ve bağlayıcı ek yükü.

<img src="../../assets/mcp-gateway-benefits.png" alt="Ağır arka uçların RAM ve başlatma işini paylaşın, her oturum için kopya çalıştırmayın." width="780">

İngilizce etiketli kavramsal görsel, çalışma ekranı veya performans testi değil. Küme başına 1.5 GB varsayımında 6 GB, ek yükten önce önlenen tekrardır. Ölçülen hafif düzenekte toplam RAM arttı.

<a id="first-use"></a>
## İlk kurulum ve çağrı

**Ön koşullar:** Node.js 24 veya üzeri, npm, Git, eklenti destekli Copilot CLI ve yapılandırılmış, kimliği doğrulanmış MCP hizmetleri. İlk kurulum şu anda Copilot CLI üzerinden yapılır; ana test platformu Windows’tur ve Agency isteğe bağlıdır. Uyumluluk ve doğrulama düzeyi istemciye göre değişir.

Yapılandırma ve yedekler kimlik bilgileri içerebilir: gizli tutun ve yalnız amaçlanan değişiklikleri onaylayın.

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Kurulumdan sonra Copilot CLI’yi açıp `/mcp-gateway-setup` çağırın. Önizlemeyi inceleyin ve yalnızca istediğiniz değişiklikleri onaylayın. Copilot’u kapatıp yeniden açın, döndürülen tam `readinessCommand` komutunu çalıştırın. Özel yedekleri ve geri alma komutlarını saklayın.

Keşif ve şema sahiplik gerektirmez; `requiresExclusiveAccess: true` ise `call_tool` öncesinde `claim_server` gerekir.

2. `list_servers` aracına `{}` gönderin: yapılandırılmış takma adlar, durumlar ve tek oturumla sınırlı erişim göstergeleri görünmelidir. Yetkili bir arka uç seçin, `search_tools` ile görevinize uygun bir terim arayın ve `get_tool_schema` ile aracın giriş şemasını alın. Şemaya uygun bağımsız değişkenler hazırlayıp `call_tool` ile onaylanmış salt okunur işlemi yapın. Beklenen sonuç gerçek kayıt veya belgelenmiş boş sonuçtur; hataları da kontrol edin, yanıt almak tek başına başarı değildir.
3. `requiresExclusiveAccess: true` ise çağrıdan önce `claim_server`, bütün çağrılar tamamlandıktan sonra `release_server` kullanın. Tek oturumla sınırlı erişim gerektirmeyen arka uçlar için rezervasyon gerekmez. Sonucu bilinmeyen zaman aşımında yeniden denemeyin; etkin işleri inceleyip yeniden başlatmayı koordine edin. Sonuç bilinmiyorsa tek oturumun erişimine ayrılan arka uç, ağ geçidi yeniden başlatılana kadar engelli kalır; sahipliği bırakmak veya istemcinin bağlantısını kesmek engeli güvenli biçimde kaldırmaz. Bağlantıyı kesmek işlemi iptal etmez.
4. Aynı bağlayıcı ve kataloğu kullanan ikinci oturumda aynı takma ad için `list_servers` / `search_tools` çağrılarını tekrarlayın. Başlatılmış arka uçta `ready` ve aynı katalog yeteneklerini bekleyin. Aynı takma ad süreç kimliğini veya RAM tasarrufunu kanıtlamaz; açık paylaşım testine bakın. [Süreç paylaşımı yöntemi](../BENCHMARK.md#method) · [Katalog önbelleği testi](../../test/catalog-scale.test.js)

[Tam İngilizce örnek](../../README.md#first-use) · [Uyumluluk](../CLIENTS.md#compatibility-summary)

## Sınırlar, gizlilik ve kurtarma

Claude Code, Codex, Gemini CLI, Kimi veya Qwen CLI üzerinden bu depoyu bulmak doğrudan istemci entegrasyonu garantisi değildir. Gemini CLI kurulum yolu burada belgelenmemiştir; Antigravity başka bir istemcidir. Kimi yalnızca adaptör düzeyinde test edilmiştir. Yapılandırma ve yedekler kimlik bilgileri içerebilir; yayımlamayın veya sürüm denetimine eklemeyin. Arka uçlar uzak hizmetlere bağlanabilir; paylaşım çevrimdışı çalışma ya da sabit RAM/token tasarrufu anlamına gelmez.

Liste boşsa seçilen yapılandırmayı ve taşıma önizlemesini kontrol edin. Eşleşme yoksa arka uç açıklamalarındaki terimleri kullanın. Kimlik doğrulama veya hazırlık hatalarında işletim kılavuzunu izleyin, atlatmak için paralel süreç açmayın. İstemci ayarlarını geri yüklemek kalıcı çalışma zamanını durdurmaz; çıkış için operatöre devir ve tamamlanma kontrollerini izleyin.

[Gizlilik](../REFERENCE.md#state-and-privacy) · [Kurtarma ve geri alma](../REFERENCE.md#setup-recovery) · [Çıkış ve operatöre devir](../REFERENCE.md#planned-exit)

Kurulum önce önizleme gösterir ve yalnızca onaydan sonra değişiklik yapar. Özel yedekler oluşturur, hazırlık kontrolleri ve tam geri alma komutları verir. Yapılandırma ve yedekler kimlik bilgileri içerebilir; yayımlamayın veya sürüm denetimine işlemeyin.

**İşletim kılavuzu (İngilizce):** [İşletim kılavuzunu aç](../REFERENCE.md)

**Lisans:** [MIT](../../LICENSE)


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

**Hafif test düzeneğinin ölçümü: paylaşım var, fakat toplam RAM daha kötü ve soğuk başlangıç daha hızlı değil.** Windows x64 / Node 24.13.1, 3 denemenin medyanı: paylaşılan şema + echo soğuk arka uçta 426.2 ms, ikinci istemcide 21.1 ms, beşincide 19.0 ms. İlk istemci toplamı: doğrudan 503.5 ms, ağ geçidi hazırken paylaşılan 894.3 ms; tamamen soğuk paylaşılan başlangıç 1886.7 ms. Arka uç süreçleri 5 → 1, fakat toplam süreçler 5 → 7 ve working set toplamı 357.0 MiB → 564.0 MiB: toplam RAM daha kötü. Tek echo ağır gerçek hizmetleri temsil etmez; yukarıdaki 1.5 GB ayrı varsayımdır, ölçüm değildir. [BENCHMARK.md](../BENCHMARK.md)

<a id="mechanism"></a>

SDK/stdio testi aynı bağlayıcı ve MCP bağlantısıyla yeniden başlatma sonrası yeni takma adı keşfedip echo çalıştırır; ürünlerin konuşma arayüzleri test edilmedi. Otomatik hot reload değildir; çakışmalar incelenir. İlk kayıt veya runtime yükseltmesi istemci yeniden başlatması gerektirebilir. Kesilen çağrılar tekrarlanmaz; yeniden başlatma sonrası tek oturuma ayrılan erişimi tekrar talep edin.

```text
Ajan A ─┐                          ┌─ Entegrasyon A: birçok araç
Ajan B ─┼─ bağlayıcı ─ MCPGateway ─┼─ Entegrasyon B: birçok araç
Ajan C ─┘                          └─ Entegrasyon C: birçok araç
```

Birden fazla ajan aynı bağlayıcı üzerinden MCPGateway’e erişir; yapılandırılmış arka uçlardan seçilenlere ihtiyaç duyulduğunda bağlanılır. Şema paylaşım mekanizmasını açıklar; performans testi veya çalışma anında doğrulama değildir ve tüm arka uçların başlatıldığı anlamına gelmez.

> Bu, yerelleştirilmiş bir genel bakıştır. Tam kurulum, yükseltme ve teknik ayrıntılar için İngilizce [README](../../README.md) ile aşağıda bağlantısı verilen İngilizce istemci kılavuzu yetkili kaynaklardır.

[English](../../README.md)

Ağ geçidi ajana her zaman 6 araç sunar: 4'ü yetenekleri bulup çağırmak, 2'si bir seferde yalnızca bir oturumun erişebildiği entegrasyonlar içindir. Bağlantı eklemek başlangıç arayüzünü büyütmez; tam şema yalnızca seçilen araç için yüklenir. Önceden yapılandırıp doğruladığınız bağlantılar yeniden kullanılır; hizmet kurulmaz veya kimlik bilgisi sağlanmaz.

Örneğin Copilot’taki **10** bağlantıya, desteklenen Claude yapılandırmasından açıkça taşınan **2** yeni bağlantı eklenince iki ajan da aynı **12** bağlantıyı kullanabilir.

- Eklenti tek başına yapılandırmaları birleştirmez. Aynı adlı girdiler ancak takma ad tanımları birebir aynıysa tekilleştirilir; aynı hizmete işaret etmek yetmez. Çakışmalar inceleme için işlemi durdurur.
- Taşıma önce önizleme gösterir, yedek oluşturur ve desteklenmeyen istemciye özgü ayarları reddeder.
- Bu, her istemcinin kendi ortamında uçtan uca test edildiği anlamına gelmez. [Taşıma kılavuzu (İngilizce)](../CLIENTS.md#cross-client-migration).

| İstemci | Kurulum | Yükseltme |
|---|---|---|
| GitHub Copilot CLI | [Kur](../CLIENTS.md#copilot-cli-install) | [Yükselt](../CLIENTS.md#copilot-cli-upgrade) |
| VS Code (düzenleyici) | [Kur](../CLIENTS.md#vs-code-install) | [Yükselt](../CLIENTS.md#vs-code-upgrade) |
| Claude Code | [Kur](../CLIENTS.md#claude-code-install) | [Yükselt](../CLIENTS.md#claude-code-upgrade) |
| Codex CLI | [Kur](../CLIENTS.md#codex-install) | [Yükselt](../CLIENTS.md#codex-upgrade) |
| OpenCode | [Kur](../CLIENTS.md#opencode-install) | [Yükselt](../CLIENTS.md#opencode-upgrade) |
| Qwen Code | [Kur](../CLIENTS.md#qwen-code-install) | [Yükselt](../CLIENTS.md#qwen-code-upgrade) |
| Kimi CLI | [Kur](../CLIENTS.md#kimi-cli-install) | [Yükselt](../CLIENTS.md#kimi-cli-upgrade) |
| Antigravity CLI | [Kur](../CLIENTS.md#antigravity-cli-install) | [Yükselt](../CLIENTS.md#antigravity-cli-upgrade) |
