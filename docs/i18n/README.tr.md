# Shared MCP Gateway hızlı başlangıç

[English](../../README.md)

> Bu, yerelleştirilmiş bir hızlı başlangıç kılavuzudur. Gelişmiş kullanım ve en güncel teknik ayrıntılar için İngilizce [README](../../README.md) yetkili kaynaktır.

## Mevcut MCP arka uçlarınız için tek ağ geçidi

Shared MCP Gateway, Copilot'ın başlangıçta yalnızca **6 ağ geçidi aracından** oluşan sabit bir arayüz yüklemesini; daha sonra önceden yapılandırdığınız arka uç araçlarını gerektiğinde arayıp çağırmasını sağlar. Katalogda yaklaşık **1.000 araç** olsa bile tüm tanımların en başta istemciye verilmesi gerekmez.

Arka uç kataloğu ve bağlantıları birden fazla Copilot CLI oturumunda yeniden kullanılır; böylece yerel sunucuların tekrar tekrar başlatılması azalır. Ağ geçidi MCP sunucularını kurmaz veya kimlik bilgisi sağlamaz. Sunucuları ve kimlik doğrulamayı mevcut yönteminizle yapılandırmaya devam edin.

6 araç; keşif/yürütme için 4 araçtan ve genel sunucu kiralaması için 2 araçtan oluşur. Kiralama, özel iş akışı durumu gerektiren her arka uçta kullanılabilir ve tarayıcı otomasyonuyla sınırlı değildir.

## Ön koşullar

- Node.js 24 veya üzeri, npm ve Git
- Eklenti desteğine sahip Copilot CLI
- Mevcut bir Copilot MCP yapılandırması ve arka uçların gerektirdiği kimlik doğrulama
- Agency isteğe bağlıdır; normal Copilot CLI kullanımı için gerekli değildir

## Kurulum

Bu komutları Copilot sohbetinde değil, **terminalde** çalıştırın:

```text
copilot plugin marketplace add yeelam-gordon/MCPGateway
copilot plugin install shared-mcp-gateway@mcp-gateway
```

Ardından Copilot'ı başlatın ve Copilot içinde şunu çalıştırın:

```text
/mcp-gateway-setup
```

Yalnızca eklentiyi kurmak MCP yapılandırmasını taşımaz. Kurulum önce bir önizleme gösterir; onaydan sonra mevcut yapılandırmayı yedekler, arka uç tanımlarını özel bir dizinde saklar ve istemci yapılandırmasını paylaşılan ağ geçidi bağlayıcısına geçirir.

Gösterilen yedekleme yolunu ve tam geri yükleme komutunu saklayın. Arka uç kataloğu ve yedekler kimlik bilgileri içerebilir; bunları yayımlamayın veya sürüm denetimine işlemeyin.

Tamamlandıktan sonra Copilot'ı kapatıp yeniden açın. Bağlayıcı ilk kullanıldığında ağ geçidi otomatik başlar; ayrı bir terminali açık tutmanız gerekmez.

## Nasıl çalışır

1. `list_servers`, tüm arka uçları başlatmadan yapılandırılmış takma adları listeler.
2. `search_tools`, belirli bir arka uçta ilgili araç özetlerini arar.
3. `get_tool_schema`, yalnızca seçilen aracın tam giriş şemasını getirir.
4. `call_tool`, aracı çağırmadan önce bağımsız değişkenleri ve izin listesini doğrular.
5. `claim_server` ve `release_server`, özel erişim gerektiren sunucunun tüm iş akışını korur ve etkin çağrılar bittikten sonra kiralamayı serbest bırakır.

MCP istemcisi, ağ geçidi ve MCP sunucusu farklı rollere sahiptir; ancak günlük kullanımda protokol ayrıntılarını bilmeniz gerekmez. Arka uçlarınızı her zamanki gibi yapılandırın ve Copilot'ın bunları ağ geçidi üzerinden bulup çağırmasına izin verin.

## Güncelleme ve geri yükleme

Eklentiyi güncelledikten sonra yeni çalışma zamanını açıkça benimsemek için `/mcp-gateway-setup` komutunu çalıştırın. Etkin çağrıların bitmesini bekleyin, güncellemeyi uygulayın ve Copilot'ı yeniden açın; yalnızca eklentiyi indirmek çalışan ağ geçidini değiştirmez.

Kurulum başarısız olursa Copilot'ı kapatın ve çıktıda gösterilen tam yedekleme yoluyla geri yükleme komutunu kullanın. Kurtarma amacıyla özel arka uç dizinini silmeyin.
Yapılandırma eşitleme, istemci entegrasyonu, kiralamalar ve sorun giderme için İngilizce [README](../../README.md) dosyasına bakın.

**Lisans:** [MIT](../../LICENSE)
