# Tavily — ücretsiz hesap ve güvenli anahtar

Seçilen paket `@openclaw/tavily-plugin@2026.10.2`, host OpenClaw `2026.10.2` ile uyumludur. Resmî npm paketinin bütünlüğü `sha512-pyuJowWND058yq5JYbJg5s8YKjrGUJ86H8hk258aGhRknCiFM7M16SQMW4BgY/PwA9hGkBX/YLe2ghyBCGPbAw==`; jarvis profiline native `plugins install --pin` yoluyla kuruldu. Ayrı HTTP arama servisi kurulmadı.

## Hesap/anahtar

1. [Tavily panelinde](https://app.tavily.com/) ücretsiz Researcher hesabını açın ve API anahtarı üretin. Kart/ücretli abonelik, Pay-as-you-go ve otomatik ödeme açmayın.
2. Kendi PowerShell 7 terminalinizde proje klasörüne gelin ve çalıştırın:

   ```powershell
   .\scripts\set-tavily-key.ps1
   ```

3. Anahtarı betiğin gizli girişine yapıştırın. Sohbete, komut satırına, repo dosyasına veya log'a yazmayın. Betik mevcut model/Gemini/Gateway anahtarlarını değiştirmez; yalnız `TAVILY_API_KEY` kullanıcı ortam değişkenini ve o terminalin değerini ayarlar. Önceden açık Codex/terminal süreçleri yeni değeri devralmak için yeniden açılmalıdır.
4. Mevcut profil `.env` dosyanızda boş/eski `TAVILY_API_KEY` satırı varsa kullanıcı ortamındaki yeni değeri gölgeleyebilir; aynı anahtarı yalnız repo dışı `%USERPROFILE%\.openclaw-jarvis\.env` dosyasında tutmak da mümkündür. Var olan diğer sır dosyalarını şablonla üstüne yazmayın.
5. Anahtar tanımlanınca yalnız **"anahtar tanımlandı"** yazın. Anahtarın değerini paylaşmayın. Ardından bir Advanced aramanın gerçek hesap/kota sonucunu doğrulayacağız; şu anda hesap erişimi hazır işaretlenmez.

## Advanced uyumluluğu

Bu paketin genel `web_search` sağlayıcısı yalnız `query/count` parametrelerini alıp `searchDepth` göndermiyor; generic yol Basic kullanır. Config şeması da `search_depth` alanı içermiyor. Kullanıcının açık seçimiyle resmî **`tavily_search` + `web_fetch`** yolu uygulandı; genel `web_search` kapalıdır. Host her aramada `search_depth: advanced`, `max_results: 5`, `topic: general`, `include_answer: false` parametrelerini sabitler. Paket/sürüm yaması ve özel arama taşıyıcısı yoktur; gerçek istek resmî Tavily eklentisinden çıkar.

Yalnız host'un onaylı public sorgusu gönderilir; sorgu 256 karakterle sınırlıdır. Sonuç URL'leri host tarafından kaydedilir, yerel `web_fetch` yalnız onaylı/kayıtlı URL'yi okuyabilir. Redirectler kapalıdır (`maxRedirects: 0`); redirect üzerinden query veya özel hedef kontrolü atlanmaz. Private network/proxy istisnası ve Firecrawl/ücretli extraction fallback kapalıdır. Diğer araştırma araçları açılmadı.

Anahtar eksikse `tavily_search` modelin o turdaki araç listesine eklenmez. Anahtarın varlığı hesap/kota doğrulaması değildir. Native kota/auth/network hatasında aynı run durdurulur; başka araç/sağlayıcıyla devam edemez. Yeni gerçek kullanıcı isteği veya düzeltmeden sonraki yeni run kendi kapsamıyla değerlendirilir.

Advanced arama istek başına **2 kredi** kullanır. Ücretsiz **1.000 kredi/ay**, yalnız Advanced arama için yaklaşık **500 yeni istek** eder; diğer Tavily kullanımları bu toplamı azaltabilir. Kota/erişim hatası durma nedenidir; Basic'e, başka sağlayıcıya veya ücretli plana sessiz geçiş yoktur.

Kaynaklar: [OpenClaw Tavily](https://docs.openclaw.ai/tools/tavily), [Tavily kredi maliyeti](https://docs.tavily.com/documentation/api-credits), [Tavily Search sözleşmesi](https://docs.tavily.com/documentation/api-reference/endpoint/search). Advanced kısıtı ayrıca kurulan tam paketin `dist/.setup/tavily-search-provider-DskCyo7n.mjs`, `dist/index.js` ve manifest şemasıyla doğrulandı.

## Gerçek doğrulama — 13 Ekim 2026

Kullanıcı anahtarı maskeli girişle tanımladı. Resmî sabitlenmiş eklenti üzerinden tek gerçek Advanced sorgu 5 sonuç döndürdü; dış içerik untrusted olarak işaretlendi. Anahtar yazdırılmadı ve repo dosyasına kaydedilmedi. API erişimi doğrulandı; ücretsiz hesap planı, otomatik ödeme durumu ve kalan kota bu sorguyla doğrulanmaz. Kullanıcı kalan doğrulamaları tamamladığını ve 03'ü kapattığını bildirdi; bu kullanıcı teyidi doğrudan araç kontrolünden ayrı kaydedilir. Sonraki istemci/işçi/ses entegrasyonları kendi aşamalarında kalır.
