# MCPGateway — Programlama oturumları arasında yerel MCP arka uçlarını paylaşın

<a id="languages"></a>
<details>
<summary>Languages (16)</summary>

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md) · [Italiano](README.it.md) · [Русский](README.ru.md) · [العربية](README.ar.md) · [हिन्दी](README.hi.md) · [Bahasa Indonesia](README.id.md) · [Türkçe](README.tr.md) · [Tiếng Việt](README.vi.md)

</details>

Birden çok oturum tek arka uç kümesini kullanır: yinelenen bellek ve başlatma işinden kaçının. Doğrulanan SDK/stdio yolu, yapılandırma eklenirken mevcut MCP bağlantısını korur (ajanınızdan ağ geçidine mevcut bağlantı).

[Başlayın](#first-use) · [Uyumluluk (İngilizce)](../CLIENTS.md#compatibility-summary) · [Kanıt ve sınırlar (İngilizce)](../BENCHMARK.md) · [Copilot güncellemeleri](../CLIENTS.md#copilot-cli-upgrade)

<img src="../../assets/mcp-gateway-benefits.png" alt="Arka uç kopyaları ortak kümeye dönüşür; başlatma işi yeniden kullanılır; SDK/stdio deneyinde iş tamamlandıktan sonra yönetilen ağ geçidi yeniden başlarken mevcut MCP bağlantısı korunur." width="780">

İngilizce etiketli kavramsal çizimdir; ekran görüntüsü veya performans ölçümü değildir. [SVG](../../assets/mcp-gateway-benefits.svg)

- **Yinelenen arka uç belleğinden kaçının:** Her biri 1.5 GB olan beş arka uç kümesinin (5 × 1.5 GB) tek kümede paylaşıldığı varsayımda ağ geçidi/bağlayıcı ek yükünden **önce** 6 GB yinelenen bellek kullanımı önlenir. Ölçülmüş net tasarruf değildir.
- **Arka uç başlatma işini yeniden kullanın:** Beş oturumun tamamı on iki stdio hizmetini kullanırsa başlatma sayısı 60 → 12 olur. Bu, %80 daha hızlı başlangıç demek değildir.
- **Mevcut MCP bağlantısını koruyun:** SDK/stdio deneyi yalnız yapılandırma eklenip işler bittikten sonra yönetilen ağ geçidi yeniden başlatıldığında bağlantıyı korudu. Hot reload, etkin çağrıların devamlılığı veya tüm yerel sohbet arayüzleri için kanıt değildir. İlk kayıt ve runtime yükseltmeleri istemci yeniden başlatması gerektirebilir. [SDK/stdio](../BENCHMARK.md#configuration-only-connection-continuity)

<a id="resource-examples"></a>
**Ne zaman kullanmalı veya atlamalı:** Aynı bağlayıcı ve katalogla çalışan birden çok oturum için. Tek oturum ya da hafif arka uçta doğrudan MCP daha basit olabilir. Hafif testte süreç working set toplamı 357.0 → 564.0 MiB oldu; yeni ağ geçidinin başlatılmasından ilk paylaşımlı isteğin yararlı sonucuna kadar geçen süre 1886.7 ms, doğrudan kullanım 503.5 ms idi. Net fayda ek yüke bağlıdır. [BENCHMARK](../BENCHMARK.md#sharing-model-and-evidence)

<a id="first-use"></a>
## İlk yararlı sonuç: ağ geçidinden izinli salt okunur işlem

Node.js 24+, npm, Git, eklenti destekli Copilot CLI ve yapılandırılmış, gerekli kimlik doğrulaması tamamlanmış MCP entegrasyonları gerekir. İlk kurulum Copilot CLI üzerinden; Windows ana test platformudur. Doğrulama düzeyi istemciye göre değişir. [Copilot `/help` · `/plugin`](../CLIENTS.md#copilot-plugin-eligibility).

**Kurulumdan önce:** Yapılandırma, özel katalog ve yedekler kimlik bilgileri içerebilir: yayımlamayın. Arka uçlar uzak hizmetlere bağlanabilir. Kalıcı runtime kurulur; yapılandırmayı geri yüklemek veya eklentiyi kaldırmak ağ geçidini durdurmaz. [REFERENCE](../REFERENCE.md#planned-exit) Yerel özel durum ve kayıtlı ağ geçidi tokenları yalnız sahibine açıktır; ayrıca şifrelenmez.

```powershell
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

1. Copilot CLI’yi açıp `/mcp-gateway-setup` çağırın. Önizlemeyi inceleyin ve yalnız istediğiniz değişiklikleri onaylayın. Özel yedekleri ve geri alma komutlarını saklayın. Eklenti tek başına yapılandırmaları birleştirmez.
2. Copilot’u kapatıp yeniden açın; komut nesnesi açıklamasına göre döndürülen tam `readinessCommand` komutunu çalıştırın. Yalnız kontrol yapan komut çalışmayan ağ geçidini başlatmaz. [readinessCommand](../REFERENCE.md#readiness-command-object) Yalnız döndürülen JSON nesnesini kaydedin; `.command` onaylanan yürütülebilir dosya, `.args` ise tam ve sıralı argümanlarıdır.
3. Mevcut entegrasyonda zararsız, izinli salt okunur görev seçin. Yalnız köşeli parantezdeki görevi değiştirin; takma ad, araç ve bağımsız değişkenleri keşif ve şemadan alın, tahmin etmeyin.

> Ağ geçidini [izinli salt okunur görevim] için kullan. `list_servers`, hedefli `search_tools` ve `get_tool_schema` çalıştır; izinli, hassas olmayan test değerleriyle şemaya uygun bağımsız değişkenler hazırla. Normal onayları al. `requiresExclusiveAccess: true` ise `call_tool` öncesinde bir kez `claim_server`, bütün çağrılar bitince `release_server` kullan; özel erişim istemeyen arka uçlar için sahiplik talebi gerekmez. Gerçek kaydı veya belgelenmiş boş sonucu göster ve hataları kontrol et; yalnız ağ geçidi yanıtını başarı sayma. Sonuç bilinmiyorsa tekrar deneme: engeli koru ve kurulum sorumlusuna özel olarak devret.

4. Aynı bağlayıcı ve kataloglu ikinci oturumda aynı takma adı arayın: `ready` ve aynı yetenekler beklenir. Bu, ortak keşif kontrolüdür; süreç kimliği veya RAM tasarrufu kanıtı değildir. [MCP](../REFERENCE.md#first-shared-workflow) [Açık echo örneği ve sonucu](../REFERENCE.md#public-echo-illustration).

**Başarısız olursa:** Boş katalogda yapılandırmayı ve önizlemeyi kontrol edin; arka uç açıklamalarından terimler arayın. Kimlik doğrulama veya hazırlık hatalarında kılavuzu izleyin, atlatma süreci çalıştırmayın. Sahipliği bırakmak ya da bağlantıyı kesmek bilinmeyen özel erişim sonucunu iptal etmez veya güvenle açmaz. Sonucu uzlaştırın, yönetilen ağ geçidi yeniden başlatmasını koordine edip yeniden sahiplik isteyin. [Authentication](../REFERENCE.md#native-http-oauth) · [Recovery](../REFERENCE.md#setup-recovery) · [Unknown outcome](../REFERENCE.md#unknown-exclusive-result)

**Kullanımı bırakın:** İşleri ve çağrıları bitirin, ilgili istemci bağlayıcılarını geri yükleyin veya kaldırın; operatöre devirle yönetilen ağ geçidinin durduğunu doğrulayın. Yapılandırmayı geri almak ağ geçidi sürecini durdurmaz. Özel durumu, kimlik bilgilerini, geçmişi ve ilgisiz süreçleri koruyun. [Exit](../REFERENCE.md#planned-exit)

<a id="clients"></a>
Bu yerelleştirilmiş özettir. Yöntemler, sayıların kaynağı ve işlem ayrıntıları İngilizce kılavuzlardadır. Yerel istemci desteği, çevirinin gerçek kişilerce anlaşıldığının onayı değildir. [CLIENTS](../CLIENTS.md) · [REFERENCE](../REFERENCE.md) · [BENCHMARK](../BENCHMARK.md)

MIT — [LICENSE](../../LICENSE).
