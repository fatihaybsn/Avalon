# 09–10 — Birlikte canlı Vibe Coding doğrulaması

14 Ekim 2026 kullanıcı kararı: 09'un canlı görev doğrulaması, 10'daki OpenCode işçisi ve Space Bunny yönetim bağlantısı tamamlandıktan sonra Codex ve OpenCode ile birlikte yapılacak. Bu kayıt testin geçtiği anlamına gelmez. Son kullanıcı yönlendirmesiyle üç promptlu doğrulama daha sonra başlatılacak; bu ayar güncellemesinde uygulama oluşturulmaz veya kodlama görevi gönderilmez. 10 uygulama durumu GELISTIRME_DURUMU.md içindedir.

## JARVIS'e verilecek görev

> Masaüstümde yeni, boş bir proje klasörü oluştur. İçinde yalnız notlarımı tutacağım basit bir not defteri uygulaması yap: not ekleme, düzenleme, silme ve uygulama yeniden açıldığında notların korunması yeterli. Gereksiz hesap, bulut, sunucu veya ek özellik ekleme. Üç aşamalı bir plan hazırla ve seçtiğim kodlama işçisine üç promptu sırayla gönder. İlk sonucu ve gerçek değişiklikleri inceleyerek ikinci promptu, ikinci sonucu inceleyerek üçüncü promptu hazırla. Rutin adımları bana tekrar tekrar sorma; kullanıcı tercihi veya kapsam değişikliği gerekiyorsa gerçek soruyu bana ilet. Sonunda uygulamayı nasıl açacağımı, doğrulamaları ve kalan sorunları bildir.

Bu aynı görev iki ayrı çalışmada, ayrı yeni klasörlerde yapılır: önce kullanıcı tarafından seçilen Codex, sonra OpenCode. Mevcut klasör veya notlar ezilmez; klasör adı çakışırsa yeni hedef seçilir. İşçi sessiz değiştirilmez. JARVIS/Space Bunny gerçek yönetici olmalıdır; geliştirme ajanının buradan üç promptu göndermesi JARVIS yönetimi kanıtı değildir.

## Üç promptun akışı

1. İlk prompt: amacı, somut klasörü, kapsamı, ilgili bağlamı, beklenen çıktıyı ve doğrulamayı ver; en basit yeterli not uygulamasını oluşturmasını iste.
2. İkinci prompt: ilk turdaki gerçek sonuç/diff ve kontrolleri incele; görülen eksik/hatalar için somut düzeltmeleri ilet. Eksik yoksa notların düzenlenmesi/silinmesi ve yeniden açılınca korunmasını doğrulat; gereksiz yeni özellik üretme.
3. Üçüncü prompt: ikinci turun gerçek sonucuna göre son gerekli düzeltme/doğrulamayı, çalıştırma açıklamasını ve kalan sınırları iste; hedefe göre son kabul değerlendirmesini JARVIS yapsın.

Üç aşama baştan planlanır; ikinci/üçüncü prompt sonucu görmeden kesinleştirilmez. Üç prompt bu kabul senaryosuna özeldir, bütün Vibe Coding işlerine zorunlu prompt sayısı eklenmez.

## Model ve soru koşulları

Son kullanıcı kararı: Codex için **Luna 6 (`openai/gpt-6-luna`) / xhigh**, OpenCode için **Space Bunny Free (`opencode/space-bunny-free`) / max** kullanılacak. Model veya düşünme alanı belirtilmezse bu varsayılanlar geçerli; açık kullanıcı seçimi önceliklidir. Canlı doğrulama öncesi hesaptaki resmi model kimliği ve kurulu stable protokolün desteklediği düşünme seçenekleri doğrulanır; isim/parametre tahmin edilmez. Desteklenmiyorsa açık engel bildirilir; başka model veya ücretli API sessiz kullanılmaz. OpenCode kodlama işçisinin modeli aynı olduğu varsayılmaz; kullanıcı seçimi ve gerçek hesap desteğiyle belirlenir. Space Bunny ana yönetici olarak normal OpenCode yolunu kullanır; doğrudan provider/HTTP çağrısı yoktur.

Proje adı gibi gerçek bir tercih sorusu çıkarsa JARVIS bunu mevcut OpenClaw kullanıcı karar yoluna taşımalı, kullanıcı yanıtı aynı bekleyen native request/thread/turn kimliğine bağlanmalıdır. Soru üretmek için sahte olay yazılmaz. 13 öncesinde sesli yanıt beklenmez; mevcut yetkili yazılı karar yolu yoksa gerçek bekliyor/kapalı durumu gösterilir. Model insan kararı vermez. Bu kontrol için ilk talimatta proje adını kesinleştirmemek tercih edilebilir.

## Kabul kanıtları

- JARVIS'in planı, üç sıralı promptu ve sonuçlara dayalı inceleme/düzeltme kararları mevcut görev kaydında görünür.
- Native işçi session/thread/turn/item/request kimlikleri, gerçek sonuç/diff ve yalnız ilgili kontroller aynı 06 görevine bağlanır; reasoning kaydedilmez.
- Not ekleme/düzenleme/silme ve yeniden açıldığında saklama gerçek uygulamada çalışır; uygulama çalıştırma açıklaması vardır.
- Aynı görevde desteklenen yönlendirme/devam yolu ayrıca gözlenir. Üç prompt tek başına interrupt kanıtı değildir: ayrı kısa sahipli işlemde native iptal kontrolü yapılır; durduğu bilinmeyen alt süreç için tam iptal iddiası yoktur.
- Her işçi için sonuç ayrı kaydedilir. Birinin başarısı diğerinin doğrulaması sayılmaz. 09 ve 10'un canlı kapanışı ancak ilgili gerçek kanıtlar sonrası güncellenir.

Uygulama takibi: 10'un kod/private server/ortak işçi bağlantısı uygulandı; gerçek çok promptlu proje kabulü ayrı bir sonraki kullanıcı doğrulamasıdır. Bağlantı durumu için GELISTIRME_DURUMU.md ve 10_OPENCODE_ISCISI.md okunmalıdır.
