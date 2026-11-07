# D paketi — otomasyon paylaşım JSON'u

Yalnızca sorun 6 uygulandı. Önceki değişiklikler korundu; commit oluşturulmadı.

`portableFlows` içindeki genel anahtar kopyalama kaldırıldı. Dışa aktarım artık düğüm türüne göre yeni nesneler oluşturuyor: yalnızca ilgili seçenekler, doğrulanmış ilkel değerler ve yeniden eşlenmiş referanslar çıkıyor. Bilinmeyen/ilgisiz ayarlar dışarıda bırakılıyor; saklanan alanlarda geçersiz türler reddediliyor. `outputs` kaynak veriden kopyalanmıyor; düğüm türü veya switch kural sayısından hesaplanıyor.

- Sonlu sayısal metinler sayıya çevriliyor; deneme, zaman aşımı, araştırma genişliği/derinliği sınırları denetleniyor. Eksik alanlar mevcut Avalon/Node-RED varsayılanlarını alıyor. Başlatma onayı boolean kalıyor; core düğümlerin desteklenen `true`/`false` metinleri ilgili alanlarda normalleştiriliyor.
- Kimlik, wires, catch scope ve rapor girdileri yalnızca mevcut düğümlere referans verebiliyor. Üretilen şablon mevcut `compileFlow` ile yeniden doğrulanıyor; yeni şema altyapısı veya bağımlılık eklenmedi.
- Serbest talimatlar, etiketler, yerel yollar, gerekli alan/dosya metinleri ve sabit switch/change değerleri paylaşılmıyor. İç içe nesneler kopyalanmıyor. Güvenli msg referansları ile change move/delete işlemleri korunuyor. Dosya çıktısı şablonda mevcut davranış gibi text'e çevriliyor.
- Normal derleme, içe aktarım servisi ve kayıt dosyaları değiştirilmedi. Dışa aktarım girdiyi mutasyona uğratmıyor; otomatik akış göçü/yeniden yazımı yok. Mesaj özellik adları ve bağlantı yapısı paylaşılmaya devam ediyor.

## Kanıt ve testler

İlk regresyon çalışmasında üç test beklenen şekilde başarısız oldu: izinli anahtar içinden gizli nesne sızması, saklanan alanlarda nesne kabulü ve sayısal metinlerin normalleştirilmemesi. Düzeltmeden sonra geçti.

| Kontrol | Sonuç |
| --- | --- |
| Yeni paylaşım testleri | **8/8 geçti** |
| `npm test` | **338/338 geçti**, 0 başarısız, 0 atlanan |
| `npm run check:electron` | **60 Electron + 3 otomasyon modülü geçti** |
| `npm run build` | TypeScript, masaüstü ve mobil build geçti |
| `git diff --check` | Geçti |

Kapsam: geçerli/geçersiz JSON yapıları, izinli anahtarların tamamına iç içe sır yerleştirme, hatalı referanslar, sayısal sınırlar, eski sayısal metinler, core varsayılanları, switch/change/catch, bütün gönderilen örnekler, eski doğrusal araştırma, idempotent JSON round-trip ve kaynak verinin değişmemesi. Mevcut servis içe/dışa aktarım round-trip testleri genel pakette geçti.

Build mevcut büyük chunk ve `inlineDynamicImports` deprecation uyarılarını verdi. Canlı test, Hermes/GPT Researcher görevi veya bilgisayar otomasyonu çalıştırılmadı. Hermes, araştırma motoru, zamanlama, native protokol ve kurulum kodlarına dokunulmadı. Dağıtım EXE paketi yeniden üretilmedi.

Bu paketin dosyaları:

- [flows.cjs](C:/Users/Fatih/Desktop/Avalon/Avalon/automation/flows.cjs)
- [portableFlows.test.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/test/portableFlows.test.mjs)
- Bu rapor.

Paylaşım şablonu, önceki davranış gibi kullanıcıya ait sabit koşul/talimat değerlerini çıkarır; alıcı bunları kendi ortamı için doldurmalıdır. Genel bir metin içi sır tespiti garantisi verilmez; korunması gereken yapısal mesaj alan adları paylaşımda görünür.
