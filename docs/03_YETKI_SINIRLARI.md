# 03 — JARVIS host yetkileri

13 Ekim 2026; yalnız OpenClaw **2026.10.2** public plugin SDK sözleşmesi. Kaynak `plugins/jarvis/`; manifest startup yüklemesini açıkça ister. Son kullanıcı seçimiyle resmî `@openclaw/tavily-plugin@2026.10.2` Advanced araması ve native `web_fetch` kullanılır. JARVIS ayrı arama/HTTP araç motoru kayıt etmez. Aynı eklenti sonraki aşamaların dar araçlarını barındırabilir. Yeni sunucu, görev kuyruğu veya onay/hafıza veritabanı yoktur.

## Uygulanan sınırlar

| Yüzey | Gerçek davranış |
|---|---|
| `main` | Katalog yalnız mevcut `read/write/edit`. Her çağrı host kapsamı gerektirir. |
| `research` | İzin listesi yalnız resmî `tavily_search` + native `web_fetch`. Tavily anahtarı eksikse modelin tur araç listesinde yalnız `web_fetch` vardır; hesabı hazır göstermez. Başka araç, skill, hafıza, session devri veya resolver yok. |
| Serbest komut/işçi | `exec/bash/process`, Code Mode, `apply_patch`, worker ve bilinmeyen araçlar kapalı. Executable/argv/cwd/erişim sözleşmesi doğrulanmadan regex ile izin verilmez. Dar Windows/işçi bağlantıları 07–10'a aittir. |
| Hesap/dış etki | Browser, computer, mesaj, otomasyon, satın alma/bağlı ödeme ve genel hesap/sır erişimi kapalı. Bağlanmamış işlev katalogda yoktur. |
| Dosya | Mutlak yerel Windows yolu; görev kökü altında olağan okuma/yazma/düzenleme. UNC/device path, ADS, traversal, DOS kısa adları, junction/symlink/hardlink, Windows/credential alanları ve runtime talimat dosyaları reddedilir. JARVIS'in kendi çalışan politika/başlangıç/config/dependency kodu olağan runtime proje yazma izninin dışındadır. Başka projelerin olağan `scripts/` gibi klasörleri yazılabilir. |
| Başlangıç | Gateway betiği şema kontrolünden önce 03 profilinin ve seçilen SDK sürümünün yerinde olduğunu denetler; eksik/değişmiş politikayla başlamaz. |

## Görev izni

`jarvis.scope.bind` bir **istemci RPC'sidir**, model aracı değildir. OpenClaw router'ında `operator.write`, `profileAccess: required`, `sessionAccess: write` gerekir. Kullanıcı kimliği Gateway'in doğrulanmış profilinden; cihaz kimliği kabul edilmiş imzalı device bağlantısından; agent/session/session incarnation ise host'un `sessionAccessAuthority.target` nesnesinden alınır. Parametrelerden kullanıcı, cihaz veya session UUID kabul edilmez. Kontrol UI'nin device-auth bypass ayarıyla izin bağlanmaz.

İstemci mevcut session'a, bir `runId`, `projectId`, `taskId`, rol ve somut hedeflerle kapsam bağlar. `runId`, mevcut OpenClaw çağrısının kimliğidir; seçilen sürümün `agent` girişindeki `idempotencyKey` aynı kimliği kullanır. Host scope kaydı bundan önce bağlanabilir. Bilinmeyen/sıfırlanmış session, başka run/agent/incarnation, sona ermiş veya geri alınmış yetki kapalıdır. Restart sonrasında modelin sohbetten eski izin iddiası geçmez; yetkili istemci yeniden bağlar.

Proje rolü `root` altında normal dosya işlemlerini tek izinyle taşır. Her dosyada yeniden soru yoktur. `confirmationPaths` yalnız istemcinin açıkça seçtiği ayrı **tam hedef yollarıdır**; üst dizin yetkisi veya otomatik erişim artışı değildir. O hedefteki her somut çağrı `requireApproval` ister. Başka hedefler ve bilinmeyen parametreler reddedilir. Hesap araçları bağlı olmadığı için bir hesap hedefi şu anda izin kapsamına çevrilemez.

JSON metadata OpenClaw `api.runContext` içindedir. Eklentinin kısa ömürlü map'i yalnız retained host authority/iptal sinyali tutar; bir görev veya onay deposu değildir. Bitmiş run, session/kimlik geri alımı ve süre sonu yeni araç çağrılarını kapatır. Varsayılan süre 15 dakika, üst sınır bir saattir. Mevcut görev kapsamını sonraki istemci/işçi çağrısına taşıyan ürün akışı 04/06/09–12'de bağlanır; henüz tamamlanmış sayılmaz.

## Araştırma

Okuyucu ayrı, başlangıçta boş workspace kullanır. `skipBootstrap: true` dosya üretimini, `contextInjection: never` mevcut bootstrap dosyalarının eklenmesini kapatır; skills ve subagent listesi boştur. `before_prompt_build` sabit okuyucu sistem metnini ve iki dar okuma aracını seçer; anahtar eksikse arama aracı çıkarılır. `before_agent_run` yalnız o run'ın hostça seçilmiş **tek public sorgu veya URL** girişini, boş geçmişi ve sabit sistem metnini kabul eder. Özel kullanıcı/proje/anahtar bağlamı veya eski sohbet içeren giriş gönderilmeden engellenir.

`tavily_search` host'un onaylı sorgusundan başka metin gönderemez. Host `search_depth: advanced`, beş sonuç, general topic ve AI answer kapalı parametrelerini sabitler; model Basic veya başka seçenek seçemez. Endpoint `https://api.tavily.com` ile sabittir. Genel `web_search` bu SDK'da Advanced taşıyamadığı için kapalıdır; `tavily_extract` da açık değildir.

Native `web_fetch` yalnız önceden onaylı veya gerçek Tavily sonucundan host'un kaydettiği URL'yi okuyabilir. HTTPS/443 dışı, credentials, fragment, query ve belirsiz encoded URL reddedilir. Hook DNS/özel ağ denetimi yapar; native SDK gerçek taşıyıcıda tekrar DNS kontrolü/pinning uygular. Redirectler tamamen kapalıdır (`maxRedirects: 0`); önceki özel okuyucunun redirect işlemi kullanılmaz. Proxy/özel ağ istisnası, custom header ve ücretli fetch provider yoktur. Sınır 10 saniye, 256 KiB yanıt ve 20.000 karakter çıktıdır. Firecrawl kapalı ve plugin allowlist'i yalnız seçili JARVIS/Tavily/OpenCode/Google/Memory Core bileşenlerini içerir.

Native araç sonuçlarındaki kaynak URL/final URL/tarih ve metadata SHA256 host tarafından alınır. Persist edilen sonuç `external-data`, `trust: untrusted`, `authority: none` zarfına girer; kaynaklar mevcut host olayına yazılır. Persist edilen okuyucu metin özetleri de `reader-summary` veri zarfına alınır. Host yalnız güvenli sonuç URL'lerini aynı salt okunur run'ın fetch hedeflerine ekler; içerik talimatı yetki genişletemez. Metinler hafıza tercihi/iptal/onay sayılmaz. Ana ajan için kalıcı "web gördü, tüm kullanıcı eylemlerini engelle" işareti yoktur; sonraki gerçek kullanıcı görevi kendi kapsamıyla değerlendirilir.

**Gerçek sınırlama:** Resmî Tavily paketi kuruldu ve yapılandırıldı; API anahtarı maskeli girişle tanımlandı ve resmî araçla tek gerçek Advanced arama 5 sonuç döndürdü. Ücretsiz plan ve kalan kota bu API yanıtından doğrulanmaz. Anahtar eksik sorgu çalışması başlamadan açık hata verir. Query taşıyan URL'ler kapalıdır; public arama sorgusu ayrı scope alanıdır. Native kota/auth/network hatası aynı araştırma run'ını durdurur. Ücretli sağlayıcı, Basic, model veya başka fallback açılmaz. Gemini'ye genel web aracı verilmedi; kısa kontrolün aynı profilden istenmesine yönelik Live istemci bağlantısı 12'de yapılır. Anahtar adımı: [TAVILY_KURULUM.md](TAVILY_KURULUM.md).

## Onay

`before_tool_call` gerçek yürütmeden önce gate'dir. Ayrı hedef için seçilen parametreler kopyalanır; onay başlığı/hedef/görev/SHA256 sabit çağrıyı tanımlar. SDK ilk `requireApproval` snapshot'ını dondurur; daha sonraki hook onaylı parametreyi değiştiremez. Yalnız `allow-once/deny`, 60 saniye; timeout/iptal/eksik route kapalıdır. Native exec/worker politikası değiştirilmez veya bypass edilmez.

Native kind-agnostic resolver, elle enjekte edilmiş `allow-always` kararını kendi canonical registry kaydına alabilir; bu JARVIS yürütme izni değildir. `requireApproval.allowedDecisions` ile public SDK yürütme sınırı yalnız izin verilen kararları kabul eder. Canlı testte böyle bir enjeksiyonun dosya yazmasını açmadığı ayrıca doğrulandı; registry sürümüne yama uygulanmadı.

Üretimde eklenti resolver veya genel config aracı kayıt etmez. Yetkili insan istemcisi mevcut `plugin.approval.requested/resolved`, `approval.get/resolve` ve OpenClaw'ın **aynı durable approval registry** yolunu kullanır. `operator.approvals` token'ı modele/okuyucuya/işçiye verilmez. Satın alma/bağlı ödeme bu aşamada tamamen kapalıdır; model/ses olumlu karar veremez. Elle karar bağlaması ve diğer ses kararlarının istemci bağlantısı **13'te** uygulanır.

## Doğrulama ve kullanım

- `npm run check`: public SDK tip kontrolü. Paket, public `runtime-fetch` export'unun `.d.ts` dosyasını yayınlamadığı için yalnız doğrulanan imza yerel `sdk-compat.d.ts` ile tanımlanır. Native Node fetch ile paket Undici sürümü karıştırılmaz.
- `npm test`: 16 sınır testi; kimlik/incarnation, normal çok dosyalı yazma, unknown tool/parametre, Windows link/alias, SDK snapshot, kaynak etiketi, kota sonrası durma ve gerçek resmî eklentinin mocked HTTP gönderiminde Advanced parametresi doğrulanır. Eski yerel okuyucu yardımcı testleri yalnız regresyon dosyasıdır; o yardımcı üretim kataloğunda değildir.
- `npm run test:gateway`: ayrı geçici Gateway/profilde gerçek eklenti+scope RPC, production `before_tool_call`, SDK deferred snapshot, authenticated native registry dispatch ve insan `approval.get/resolve`. Test fixture yalnız bu profilde RPC'dir; üretim kataloğuna yüklenmez. Model/API çağrısı yapılmaz. Kendi test süreci ve doğrulanmış geçici klasörü temizlenir.
- `node scripts/jarvis-policy-config.mjs`: mevcut jarvis profiline 03 ayarlarını uygular; mevcut model/Talk/provider/auth korunur. İlk önce repo dışındaki `openclaw.before-stage03.json` yedeğini bırakır. `--check <profile-config>` salt okunur başlangıç kontrolüdür.

Önceki yerel okuyucuyla gerçek HTTPS okuma `https://example.com/` üzerinde doğrulandı; son seçim native `web_fetch`tir. Tavily gerçek hesap çağrısı anahtar tanımlanınca sınanacaktır; sahte anahtarla ağ taklidi gerçek erişim kanıtı değildir. Seçili ana model/Live ses üzerinden uçtan uca okuyucu görevi bu aşamada denenmedi; OpenCode işçisi ve ses istemcisi sonraki aşamalardır. Ana `jarvis` Gateway'i bu çalışmada başlatılmadı; mevcut süreçte Gateway token devralınmadığından şema kontrolü bunu açık uyarı olarak gösterir.

Sözleşme kaynakları: kurulu `2026.10.2` package exports/SDK types/runtime ve [public tool-policy hook belgesi](https://docs.openclaw.ai/plugins/hooks/tool-policy), [manifest/activation](https://docs.openclaw.ai/plugins/manifest/capabilities), [Gateway approval RPC](https://docs.openclaw.ai/gateway/protocol/rpc-devices-nodes-and-approvals), [bootstrap izolasyonu](https://docs.openclaw.ai/gateway/config-agents/workspace-and-bootstrap).

## 03 kapanışı — kullanıcı teyidi, 13 Ekim 2026

Kullanıcı kalan doğrulamaları yaptığını ve 03'ün tamamlandığını bildirdi. Ajanın otomatik testleri, gerçek Gateway onay testi ve doğrudan Tavily erişim kanıtı yukarıda ayrı belirtilmiştir; kullanıcı teyidi yeni bir ajan testi olarak sunulmaz. İstemci, işçi ve ses bağlantıları kendi sonraki aşamalarında kalır.
