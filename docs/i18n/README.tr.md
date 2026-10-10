# MCPGateway — Kodlama ajanı oturumları arasında yerel MCP sunucularını paylaşın

[English](../../README.md)

> Bu, yerelleştirilmiş bir genel bakıştır. Tam kurulum, yükseltme ve teknik ayrıntılar için İngilizce [README](../../README.md) ile aşağıda bağlantısı verilen İngilizce istemci kılavuzu yetkili kaynaklardır.

Her Copilot CLI oturumu için aynı MCP sunucusunun yeni bir kopyasını başlatmayın. Yapılandırılmış yerel arka uçları paylaşın, araçları gerektiğinde keşfedin ve bir seferde yalnızca bir oturumun erişebildiği iş akışlarını koordine edin. Kurumsal API yönetişim platformu değildir.

**Ön koşullar:** Node.js 24 veya üzeri, npm, Git, eklenti destekli Copilot CLI ve yapılandırılmış, kimliği doğrulanmış MCP hizmetleri. İlk kurulum şu anda Copilot CLI üzerinden yapılır; ana test platformu Windows’tur ve Agency isteğe bağlıdır. Uyumluluk ve doğrulama düzeyi istemciye göre değişir.

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

## İlk kurulum ve çağrı

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Kurulumdan sonra Copilot CLI’yi açıp `/mcp-gateway-setup` çağırın. Önizlemeyi inceleyin ve yalnızca istediğiniz değişiklikleri onaylayın. Copilot’u kapatıp yeniden açın, döndürülen tam `readinessCommand` komutunu çalıştırın. Özel yedekleri ve geri alma komutlarını saklayın.
2. `list_servers` aracına `{}` gönderin: yapılandırılmış takma adlar, durumlar ve tek oturumla sınırlı erişim göstergeleri görünmelidir. Yetkili bir arka uç seçin, `search_tools` ile görevinize uygun bir terim arayın ve `get_tool_schema` ile aracın giriş şemasını alın. Şemaya uygun bağımsız değişkenler hazırlayıp `call_tool` ile onaylanmış salt okunur işlemi yapın. Beklenen sonuç gerçek kayıt veya belgelenmiş boş sonuçtur; hataları da kontrol edin, yanıt almak tek başına başarı değildir.
3. `requiresExclusiveAccess: true` ise aramadan önce `claim_server`, bütün çağrılar tamamlandıktan sonra `release_server` kullanın. Tek oturumla sınırlı erişim gerektirmeyen arka uçlar için rezervasyon gerekmez. Sonucu bilinmeyen zaman aşımında yeniden denemeyin; etkin işleri inceleyip yeniden başlatmayı koordine edin. Sonuç bilinmiyorsa tek oturumun erişimine ayrılan arka uç, ağ geçidi yeniden başlatılana kadar engelli kalır; sahipliği bırakmak veya istemcinin bağlantısını kesmek engeli güvenli biçimde kaldırmaz. Bağlantıyı kesmek işlemi iptal etmez.

[Tam İngilizce örnek](../../README.md#first-use) · [Uyumluluk](../CLIENTS.md#compatibility-summary)

## Sınırlar, gizlilik ve kurtarma

Claude Code, Codex, Gemini CLI, Kimi veya Qwen CLI üzerinden bu depoyu bulmak doğrudan istemci entegrasyonu garantisi değildir. Gemini CLI kurulum yolu burada belgelenmemiştir; Antigravity başka bir istemcidir. Kimi yalnızca adaptör düzeyinde test edilmiştir. Yapılandırma ve yedekler kimlik bilgileri içerebilir; yayımlamayın veya sürüm denetimine eklemeyin. Arka uçlar uzak hizmetlere bağlanabilir; paylaşım çevrimdışı çalışma ya da sabit RAM/token tasarrufu anlamına gelmez.

Liste boşsa seçilen yapılandırmayı ve taşıma önizlemesini kontrol edin. Eşleşme yoksa arka uç açıklamalarındaki terimleri kullanın. Kimlik doğrulama veya hazırlık hatalarında işletim kılavuzunu izleyin, atlatmak için paralel süreç açmayın. İstemci ayarlarını geri yüklemek kalıcı çalışma zamanını durdurmaz; çıkış için operatöre devir ve tamamlanma kontrollerini izleyin.

[Gizlilik](../REFERENCE.md#state-and-privacy) · [Kurtarma ve geri alma](../REFERENCE.md#setup-recovery) · [Çıkış ve operatöre devir](../REFERENCE.md#planned-exit)

Kurulum önce önizleme gösterir ve yalnızca onaydan sonra değişiklik yapar. Özel yedekler oluşturur, hazırlık kontrolleri ve tam geri alma komutları verir. Yapılandırma ve yedekler kimlik bilgileri içerebilir; yayımlamayın veya sürüm denetimine işlemeyin.

**İşletim kılavuzu (İngilizce):** [İşletim kılavuzunu aç](../REFERENCE.md)

**Lisans:** [MIT](../../LICENSE)
