# A paketi — Hermes görev yaşam döngüsü

7 Kasım 2026. Yalnızca sorun 1, 2 ve 5 uygulandı. Mevcut çalışma ağacındaki diğer değişiklikler korundu; commit oluşturulmadı.

## Değişen davranış

- Hazırlık, model seçimi, izin kuyruğu ve sesli araç denetimi sırasında iptal edilen görev gönderilmez. Gönderim durumu, gateway'in gerçek soket yazımından hemen önce işaretlenir; soketi bekleyen RPC de iptal edilebilir.
- Görev sahipliği her asenkron hazırlık sınırında doğrulanır. Gönderilmemiş/kuyruktaki görev yerel olarak sonlanır; çalışan görev mevcut native `session.interrupt` yolunu kullanır. Sonlanmış göreve tekrar stop uygulanması başka görevi kesmez.
- Açık close eski başlangıç, fallback, bağlantı ve reconnect devamlarını geçersiz kılar. RPC çağrıları kapalı istemciyi örtülü olarak yeniden açamaz. İlk kullanımda otomatik başlangıç, açık bağlantının yeniden kurulması ve açıkça çağrılan yeni `start()` korunur.
- Otomasyon temizliği görev sinyalinden bağımsız, varsayılan 3 saniyelik bütçe kullanır. Temizlik RPC'leri `start: false` ile yalnızca açık bağlantıyı kullanır. Çalıştırıcı sahip olduğu yürütmenin temizliğini sınırlı süre bekler, sonra adaptörü kapatır. Süresi dolmuş temizliğin geç devamı yeni RPC başlatamaz.
- Bağlantı kaybı otomasyonun bekleyen onayını iptal eder; kayıt ve yanıt posta kutusu temizlenir. Taşıyıcıda soketi bekleyen eski onay yanıtı da geçersizleşir. Normal interaktif reconnect native istekleri yeniden gösterebilir.
- `CANCELLED`, `TIMEOUT` ve `INTERRUPTED` ayrımı korunur. Gönderilmediği bilinen iptal belirsiz iş olarak kaydedilmez. Gönderimden sonraki backend kaybı/kanıtlanamayan iptal inceleme gerektirmeye devam eder.

Mevcut taşıyıcı, gateway istemcisi, adaptör, AbortController ve kuyruk kullanıldı. Küçük ortak yardımcı, eski runner `abortable` işlevinin yerini alır; yeni süreç motoru veya bağımlılık eklenmedi. Node-RED yönlendirmesi, Hermes görev yürütmesi ve GPT Researcher sorumlulukları korunur.

## Regresyon kanıtı ve doğrulama

İlk beş yeni test düzeltmeden önce başarısız oldu: hazırlık iptali, onay sırasında bağlantı kaybı, geç temizlikle yeniden spawn, kapalı istemciye RPC ve close sırasında fallback. İnceleme sırasında sokete gönderim yarışı, bekleyen eski onay yanıtı ve backend çıkışında belirsizlik kaybı da önce başarısız testle gösterildi, ardından düzeltildi.

| Kontrol | Sonuç |
| --- | --- |
| `npm test` | **309/309 geçti**, 0 başarısız, 0 atlanan; 26 yeni test |
| Dört yaşam döngüsü test dosyası | **56/56 geçti** |
| `node scripts/test-automation.mjs` | **49/49 geçti** |
| `npm run check:electron` | **56 Electron + 3 otomasyon modülü geçti** |
| `git diff --check` | Geçti |

Genel paket normal Hermes işleri, sesli v1/v2 sözleşmeleri, izinler/geri alma, kuyruk, yeniden bağlantı, otomasyon iptali ve mevcut araştırma testlerini içerir. Yarışlar bekletilen promise, sahte socket/process ve denetlenebilir zamanlayıcılarla sınandı; gerçek Hermes/GPT görevi, masaüstü veya tarayıcı otomasyonu çalıştırılmadı.

## Bu paketin değiştirdiği dosyalar

- [hermesInteractiveTransport.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/electron/hermesInteractiveTransport.mjs)
- [hermesGatewayClient.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/electron/hermesGatewayClient.mjs)
- [automationHermes.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/electron/automationHermes.mjs)
- [automationRunner.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/electron/automationRunner.mjs)
- [hermesLifecycle.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/electron/hermesLifecycle.mjs) — yeni ortak iptal/bekleme yardımcıları
- [hermesInteractiveTransport.test.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/test/hermesInteractiveTransport.test.mjs)
- [hermesGatewayClient.test.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/test/hermesGatewayClient.test.mjs)
- [automationHermes.test.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/test/automationHermes.test.mjs) — yeni
- [automationRunner.test.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/test/automationRunner.test.mjs)
- [test-automation.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/scripts/test-automation.mjs)
- Bu rapor.

## Sınırlar

Hermes Python kaynaklarına, `avalon-hermes.patch` dosyasına, sabit commit'e ve kurulum betiklerine dokunulmadı. Yama, uyumluluk manifesti ve beş kurulum/çalıştırma dosyasının önce/sonra SHA-256 değerleri aynı. Hermes yaması değişikliği veya yeniden kurulum gerekmiyor.

Çevrimdışı testler gerçek native araçların/alt süreçlerin tüm dış etkilerinin durduğunu kanıtlamaz. Gönderimden sonra belirsizlik varsa mevcut inceleme engeli korunur. Dağıtım paketi yeniden üretilmedi; B–E paketleri uygulanmadı.
