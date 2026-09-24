# Shared MCP Gateway

[English](../../README.md)

> Bu, yerelleştirilmiş bir genel bakıştır. Tam kurulum, yükseltme ve teknik ayrıntılar için İngilizce [README](../../README.md) ile aşağıda bağlantısı verilen İngilizce istemci kılavuzu yetkili kaynaklardır.

## RAM'den tasarruf edin. Bağlamı işinize ayırın. Araçlar gerektiğinde.

**Daha fazla aracı, aynı MCP yapılandırmasının daha fazla kopyası değil, daha fazla tamamlanan iş anlamına gelmelidir.**

### 5 aracı. 12 MCP bağlantısı. Tek paylaşılan yapılandırma.

*Örnek: **12** bağlantı **1,000** araç sunuyor ve her bağımsız yapılandırma **1.5 GB** yerel işlem RAM'i kullanıyor.*

| Fayda | Her aracı için ayrı yapılandırma | MCPGateway ile |
|---|---|---|
| **RAM tasarrufu** | Beş bağımsız MCP yapılandırmasında **7.5 GB**. | **1.5 GB paylaşımlı**, ağ geçidi/bağlayıcı ek yükü hariç. **6 GB yinelenen bellek önlenir.** |
| **Bağlam işinize kalsın. Araçlar gerektiğinde.** | Her aracı önceden **1,000 araç tanımı** yükler; MCP bağlantıları eklendikçe sayı artabilir. | Önceden yalnızca **6 ağ geçidi aracı, 99.4% daha az tanım**. **1,000** aracın tamamı kullanılabilir; her aracı yalnızca gerekenleri bulup yükler. Yeni bağlantılar, tam katalogların tüm aracılara önceden yüklenmesini gerektirmez. |

**Aracılarınızı ve MCP bağlantılarınızı koruyun. Her oturuma ayrı bir kopya taşıtmayın.**

*RAM değerleri örnektir, ölçülmüş tasarruf değildir; aracıların kendi belleği buna eklenir. Tanım sayıları token tasarrufu anlamına gelmez ve zaten gecikmeli yükleme yapan istemciler daha küçük bir bağlam avantajı görebilir. Paylaşım, modelin bağlam penceresini büyütmez veya toplam RAM kullanımını sabit tutmaz.*

## Nasıl çalışır

Ağ geçidi aracıya her zaman 6 araç sunar: 4'ü yetenekleri bulup çağırmak, 2'si özel iş akışı gerektiren entegrasyonlar içindir. Bağlantı eklemek başlangıç arayüzünü büyütmez; tam şema yalnızca seçilen araç için yüklenir. Önceden yapılandırıp doğruladığınız bağlantılar yeniden kullanılır; hizmet kurulmaz veya kimlik bilgisi sağlanmaz.

Tek bir paylaşılan MCP kataloğu birden fazla aracıya hizmet verebilir: Copilot’ta **10** bağlantıyla başlayın, ardından **2** yeni bağlantı içeren desteklenen bir Claude yapılandırmasını açıkça taşıyın; böylece iki aracı da aynı **12** bağlantıyı kullanabilir, ancak yalnızca eklentiyi kurmak bunları otomatik olarak birleştirmez. Aynı adlı girdiler yalnızca takma ad tanımları birebir aynıysa tekilleştirilir; yalnızca aynı hizmeti göstermeleri yeterli değildir ve çakışmalar inceleme için işlemi durdurur. Taşıma önce önizleme gösterir, yedek oluşturur ve desteklenmeyen yerel ayarları reddeder; bu ayrıca her yerel istemcinin uçtan uca test edildiği iddiası değildir, ayrıntılar için [taşıma kılavuzuna (İngilizce)](../CLIENTS.md#cross-client-migration) bakın.

**Ön koşullar:** Node.js 24 veya üzeri, npm, Git ve mevcut ilk kurulum için eklenti destekli Copilot CLI. Agency isteğe bağlıdır.

## İstemciye göre kurulum ve yükseltme

Paylaşılan çalışma zamanı şu anda Copilot CLI üzerinden oluşturulur; diğer istemciler aynı kararlı bağlayıcıya bağlanır. Aşağıdaki bağlantılar, kurulum ve yükseltmenin yetkili kaynağı olan İngilizce istemci kılavuzuna gider.

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

Kurulum önce önizleme gösterir ve yalnızca onaydan sonra değişiklik yapar. Özel yedekler oluşturur, hazırlık kontrolleri ve tam geri alma komutları verir. Yapılandırma ve yedekler kimlik bilgileri içerebilir; yayımlamayın veya sürüm denetimine işlemeyin.

**Operasyon başvurusu (İngilizce):** [Operasyon başvurusunu aç](../REFERENCE.md)

**Lisans:** [MIT](../../LICENSE)
