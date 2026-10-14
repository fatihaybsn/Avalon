# JARVIS — kesin mimari

Bu kısa özet, kaynak proje kaydındaki seçilmiş A-01–A-16 kararlarını uygular. Kaynak kayıt ve geliştirme planı değişmeden durur; uyuşmazlıkta en güncel kullanıcı kararı ve kaynak kayıttaki son karar geçerlidir.

## Tek merkez ve iki model rolü

- **OpenClaw**, doğrudan Windows 11 üzerinde çalışan tek asistan, Gateway, görev yürütme, araç/izin sahibi ve Memory Core'dur. Electron istemcisi ayrı bir backend veya görev koordinatörü değildir.
- **Gemini Live (`gemini-3.8-live`)**, hazır OpenClaw Talk / Google Live yoluyla `provider-direct` konuşma rolündedir. Kısa sohbet, yetkili kayıtları okuma ve dar küçük işlemleri yapar. Kısa web kontrolü de yalnız aynı salt okunur araştırma profilinden geçer; Gemini'ye genel web, keyfî URL, terminal veya serbest dosya yetkisi verilmez.
- **Space Bunny Free**, ağır, çok adımlı görevlerin başlangıç modelidir: derin araştırma, kodlama ve uzman işçi yönetimi. **13–14 Ekim 2026 kullanıcı kararı:** Space Bunny'ye gönderilen her model isteği OpenCode'un normal istemci/işçi yolu üzerinden gider; OpenClaw doğrudan provider/HTTP isteği göndermez. Bunun nedeni ücretsiz erişimin doğrudan çağrıda verdiği `403 FreeTierError` ve kullanıcının seçtiği OpenCode yoludur. OpenCode'un bütün araçlarını sırf bu nedenle kapatan bir yasak eklenmez; OpenClaw görev, araç ve izin merkezi olarak kalır. Model/sağlayıcı sessizce değiştirilmez, ücretli yedeğe otomatik geçiş yapılmaz. 10. adımın entegrasyon ve ayrı canlı kabul durumu [GELISTIRME_DURUMU.md](GELISTIRME_DURUMU.md) içinde tutulur.

Salt okunur araştırma için seçilen yol resmî Tavily `tavily_search` (daima Advanced) ve yerel `web_fetch` araçlarıdır. Genel `web_search` kapalıdır; ücretsiz hesap erişimi doğrulanmadan arama hazır sayılmaz. Kota/erişim hatasında ücretli veya başka sağlayıcıya sessiz geçiş yapılmaz.

## Hafıza ve istemci

- Tek yerel **OpenClaw Memory Core** kullanılır: builtin SQLite indeksi, yerel EmbeddingGemma ve hibrit arama. Önemli kullanıcı notları kontrollü ve kaynak/tarih bilgisiyle tutulur; altı saatlik Dreaming düzenleme içindir. İkinci hafıza ürünü/veritabanı kurulmaz.
- Masaüstü **TypeScript + Electron** olur; ilk arayüz mevcut OpenClaw Control UI'nin **Vite + Lit** temelini kullanır. Ses için hazır **Talk / Google Live provider-direct** yolu temel alınır; JARVIS tarafında yalnız eksik görev/bağlam bağlantısı ve istemci yaşam döngüsü tamamlanır. Pencere gizleme/reload ses oturumunu kapatmaz. **14 Ekim 2026 son kullanıcı kararı:** Sesli görüşme kapanınca o görüşmeden başlatılan işin native Talk davranışıyla iptal edilmesi kabul edilir; işi ses kapanışından bağımsız sürdürmek için ek geliştirme yapılmaz. Mikrofon susturma ve yalnız oynatmayı kesme görüşmeyi bitirmek değildir.
- **Cihaza yerel ses sahipliği:** Telefondan gönderilen yazılı/sesli talimat, aynı sohbetin açılması, Gateway olayı, bildirim veya reconnect bilgisayardaki mikrofonu, ses yakalamayı, oynatmayı ya da Talk görüşmesini açamaz; uzak istemci bilgisayardaki kapalı/susturulmuş sesi etkinleştiremez. Bilgisayarda görüşme açma/susturmayı kaldırma yalnız o bilgisayardaki açık kullanıcı eylemiyle olur. Telefon sesli kullanılıyorsa mikrofon ve oynatma telefonun kendi izinli istemcisindedir. Uzun görev sırasında başlatan cihazdaki görüşmenin açık tutulması kullanıcı tarafından kabul edilmiştir; telefon erişimi yine 15. aşamada uygulanacaktır.


14 Ekim 2026 ek kullanıcı kararı: Telefondan istenildiğinde sesli görüşme yerine yazılı talimat verilebilir. Yazılı görev mevcut sohbet/görev yoluyla yürür; telefonda veya bilgisayarda mikrofon, oynatma ya da Talk oturumu başlatmaz ve işin sürmesi için hiçbir mikrofonun açık kalmasını gerektirmez. Sesli görüşmenin kapanış davranışı ayrı, yalnız ilgili sesli görüşmeden başlatılan işe aittir. Bu karar 11'in cihaz sınırında ve 15'in telefon kabulünde korunur; 15 şimdi başlatılmaz.

## Windows araçları ve dış işçiler

- Önce uygun doğrudan dosya/API/CLI işlemi; tarayıcı için yönetilen **OpenClaw browser + Playwright**; genel Windows GUI için varsayılan **OpenClaw computer/CUA** kullanılır. **Windows-MCP**, yalnız belirgin GUI/toplu işlem katkısı sağladığında aynı OpenClaw merkezinden sınırlı tamamlayıcıdır. Kurulum/teşhis PowerShell 7'yi mevcut OpenClaw izin yolunda kullanır. WSL/Linux katmanı eklenmez.
- Kodlama işçileri **Codex** ve ardından **OpenCode**'dur; uzun bağımsız işler OpenClaw'ın yerleşik alt ajanlarıyla yönetilir. Başlangıç sınırı aynı anda en çok üç bağımsız ağır iştir. Ayrı backend, job queue, koordinatör veya ajan framework'ü eklenmez.
- **14 Ekim 2026 kullanıcı kararı:** Kullanıcı tarafından seçilen Codex ve ayrıca açıkça onaylanan OpenCode kodlama görevi **Full access** ile çalışır. JARVIS somut çalışma klasörü/planı verir ve gerçek sonucu inceler; çalışma klasörü veya ayrı profil işletim sistemi dosya izolasyonu sağlamaz. Bu seçim ana JARVIS/research araç yetkilerini genişletmez. Tek resmi native Codex işçisi, açık stable binary ve ayrı kullanıcı auth profili; OpenCode için ayrı authenticated loopback server ve sürüm eşleşen V2 client kullanılır; model/işçi yedeği ve modelin insan kararını çözmesi yoktur.

## Görev, izin ve kayıt kimlikleri

- Görev ve sohbet OpenClaw'ın mevcut kimlikleriyle; gerçek çalışma durumu host olaylarıyla kaydedilir. Araç çağrısı ve bekleyen OpenClaw onayı aynı görev/işlem kimliği ve sabit hedef-parametrelerle ilişkilendirilir. İkinci görev veya onay veritabanı oluşturulmaz.
- Yetki görev ve somut işleme özeldir. Salt okunur araştırma eylem izni vermez. Gerekli ek izin ve kritik gönderim tek işlem için yetkili istemciden sesle karara bağlanır; satın alma/bağlı ödeme için olumlu karar elle verilir. Modeller onay çözümleyici kimliği almaz.

## Ham ve kalıcı kayıtlar

- Ham sohbet içeriğinin saklama hedefi **30 gün**; konuşma boşluğunda **60 saniyelik hafif bakım kontrolüdür**. Bu bakımın arşivleme ve fiziksel silme kapsamı ayrı uygulanıp doğrulanmalıdır; arşivleme silme sayılmaz.
- Kalıcı hafıza notları, proje/görev kayıtları ve kullanıcı dosyaları ham sohbet süresinden bağımsızdır. Seçici unutma yalnız ilgili kayıt ve türevlerini hedefler.

## Ertelenen işler ve kurulum gerçeği

- **14 Ekim 2026 kullanıcı kararı:** 07'nin native browser DNS rebinding/alan adı engeli sonraki ayrı düzeltmeye bırakıldı. Özel ağ sınırı korunur; genel site/login/form ve browser'a bağlı görevler düzeltme ve gerçek DNS/yönlendirme/ağ çıkışı doğrulaması yapılmadan hazır sayılmaz. Bu erteleme Windows/dosya/belge/OCR ve salt okunur araştırma yolunu kapatmaz; sonraki aşama bağımsız işleri kendi kapsamıyla ilerleyebilir. Native browser düzeltmesi bu aşamada başlatılmaz.

- Telefonla arama en sona bırakılmıştır; 16 adımlık ilk sürüm kapsamında değildir. Telefonda Tailscale üzerinden aynı OpenClaw'a web erişimi daha sonraki 15. adımdadır.
- Özgün görsel tasarım, zengin animasyon ve ayrıntılı süreç görselleştirmesi sonraya bırakılır. İzin/onarım bağlantıları, hesaplar, model uç noktaları ve cihaz ses akışı kurulup doğrulanana kadar hazır sayılmaz.
- 01. aşama yalnız geliştirme temelini kurar. Güncel kurulum, sürüm ve bağlantı durumu için [GELISTIRME_DURUMU.md](GELISTIRME_DURUMU.md) okunur.
