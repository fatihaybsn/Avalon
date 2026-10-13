# JARVIS — kesin mimari

Bu kısa özet, kaynak proje kaydındaki seçilmiş A-01–A-16 kararlarını uygular. Kaynak kayıt ve geliştirme planı değişmeden durur; uyuşmazlıkta en güncel kullanıcı kararı ve kaynak kayıttaki son karar geçerlidir.

## Tek merkez ve iki model rolü

- **OpenClaw**, doğrudan Windows 11 üzerinde çalışan tek asistan, Gateway, görev yürütme, araç/izin sahibi ve Memory Core'dur. Electron istemcisi ayrı bir backend veya görev koordinatörü değildir.
- **Gemini Live (`gemini-3.8-live`)**, hazır OpenClaw Talk / Google Live yoluyla `provider-direct` konuşma rolündedir. Kısa sohbet, yetkili kayıtları okuma ve dar küçük işlemleri yapar. Kısa web kontrolü de yalnız aynı salt okunur araştırma profilinden geçer; Gemini'ye genel web, keyfî URL, terminal veya serbest dosya yetkisi verilmez.
- **Space Bunny Free**, HTTP API üzerinden ağır, çok adımlı görevlerin başlangıç modelidir: derin araştırma, kodlama ve uzman işçi yönetimi. Model veya sağlayıcı sessizce değiştirilmez; ücretli yedeğe otomatik geçiş yapılmaz.

## Hafıza ve istemci

- Tek yerel **OpenClaw Memory Core** kullanılır: builtin SQLite indeksi, yerel EmbeddingGemma ve hibrit arama. Önemli kullanıcı notları kontrollü ve kaynak/tarih bilgisiyle tutulur; altı saatlik Dreaming düzenleme içindir. İkinci hafıza ürünü/veritabanı kurulmaz.
- Masaüstü **TypeScript + Electron** olur; ilk arayüz mevcut OpenClaw Control UI'nin **Vite + Lit** temelini kullanır. Ses için hazır **Talk / Google Live provider-direct** yolu temel alınır; JARVIS tarafında yalnız eksik görev/bağlam bağlantısı ve istemci yaşam döngüsü tamamlanır. Ses oturumu, pencere görünürlüğü ve görev iptali ayrı durumlar olarak ele alınır.

## Windows araçları ve dış işçiler

- Önce uygun doğrudan dosya/API/CLI işlemi; tarayıcı için yönetilen **OpenClaw browser + Playwright**; genel Windows GUI için varsayılan **OpenClaw computer/CUA** kullanılır. **Windows-MCP**, yalnız belirgin GUI/toplu işlem katkısı sağladığında aynı OpenClaw merkezinden sınırlı tamamlayıcıdır. Kurulum/teşhis PowerShell 7'yi mevcut OpenClaw izin yolunda kullanır. WSL/Linux katmanı eklenmez.
- Kodlama işçileri **Codex** ve ardından **OpenCode**'dur; uzun bağımsız işler OpenClaw'ın yerleşik alt ajanlarıyla yönetilir. Başlangıç sınırı aynı anda en çok üç bağımsız ağır iştir. Ayrı backend, job queue, koordinatör veya ajan framework'ü eklenmez.

## Görev, izin ve kayıt kimlikleri

- Görev ve sohbet OpenClaw'ın mevcut kimlikleriyle; gerçek çalışma durumu host olaylarıyla kaydedilir. Araç çağrısı ve bekleyen OpenClaw onayı aynı görev/işlem kimliği ve sabit hedef-parametrelerle ilişkilendirilir. İkinci görev veya onay veritabanı oluşturulmaz.
- Yetki görev ve somut işleme özeldir. Salt okunur araştırma eylem izni vermez. Gerekli ek izin ve kritik gönderim tek işlem için yetkili istemciden sesle karara bağlanır; satın alma/bağlı ödeme için olumlu karar elle verilir. Modeller onay çözümleyici kimliği almaz.

## Ham ve kalıcı kayıtlar

- Ham sohbet içeriğinin saklama hedefi **30 gün**; konuşma boşluğunda **60 saniyelik hafif bakım kontrolüdür**. Bu bakımın arşivleme ve fiziksel silme kapsamı ayrı uygulanıp doğrulanmalıdır; arşivleme silme sayılmaz.
- Kalıcı hafıza notları, proje/görev kayıtları ve kullanıcı dosyaları ham sohbet süresinden bağımsızdır. Seçici unutma yalnız ilgili kayıt ve türevlerini hedefler.

## Ertelenen işler ve kurulum gerçeği

- Telefonla arama en sona bırakılmıştır; 16 adımlık ilk sürüm kapsamında değildir. Telefonda Tailscale üzerinden aynı OpenClaw'a web erişimi daha sonraki 15. adımdadır.
- Özgün görsel tasarım, zengin animasyon ve ayrıntılı süreç görselleştirmesi sonraya bırakılır. İzin/onarım bağlantıları, hesaplar, model uç noktaları ve cihaz ses akışı kurulup doğrulanana kadar hazır sayılmaz.
- 01. aşama yalnız geliştirme temelini kurar. Güncel kurulum, sürüm ve bağlantı durumu için [GELISTIRME_DURUMU.md](GELISTIRME_DURUMU.md) okunur.
