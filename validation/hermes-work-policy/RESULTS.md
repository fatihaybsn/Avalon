# C paketi — ortak çalışma güvenliği ve çıktı sözleşmesi

Yalnızca sorun 4 ve 7 uygulandı. Önceki kullanıcı değişiklikleri ile A/B paketleri korundu. Commit oluşturulmadı.

- Normal işlerin korunan dizin listesi ve çalışma alanı talimatı küçük bir ortak yardımcıya taşındı. Varsayılan dizinler, virgülle ayrılan `IRIS_HERMES_PROTECTED_PATHS` ayarı, açıkça adlandırılan klasör istisnası, ilgili Downloads kullanımı ve home dizininde geniş arama yasağı korundu. Normal interactive/runs_api işleri ile otomasyon artık aynı metni kullanıyor. İzinlerin korunması ve dosya/girdilerin talimat veya onay sayılmaması da ortak metinde.
- Otomasyon için alan/dosya adlarını kırpan, boşları ayıklayan, tekrarları kaldıran değişmez bir çıktı sözleşmesi eklendi. Adaptör her görevde bunu bir kez oluşturuyor; talimat ve sonuç doğrulaması aynı nesneyi kullanıyor. Mevcut `validateHermesOutput` arayüzü korunuyor.
- JSON alanları talimatta açık liste halinde belirtiliyor. Adlar birebir üst seviye anahtar; noktalı adlar JSON yolu değil. Mevcut null/boş metin denetimi korunuyor; `false`, `0` ve boş dizi geçerli değerler. Evaluation outcome seçenekleri ortak sözleşmeden geliyor; reason istenmediyse zorunlu değil. Dosya varlığı, doluluk ve gerçek yol/symlink denetimleri korundu.
- Normal işlerin yönlendirmesi, dil ve IRIS yanıt üslubu kendi yolunda kaldı. Otomasyona voice JSON zarfı veya IRIS üslubu eklenmedi; salt okunur sesli v1/v2 yolu çalışma politikası almıyor. Native izin modu/onay RPC'leri değiştirilmedi.

## Testler

İlk iki regresyon testi değişiklikten önce başarısız oldu: otomasyon özel korunan dizinleri içermiyordu; zorunlu JSON alanları talimatta yoktu. Düzeltmelerden sonra geçti.

| Kontrol | Sonuç |
| --- | --- |
| `npm test` | **330/330 geçti**, 0 başarısız, 0 atlanan |
| Yeni politika/sözleşme testleri | **8/8 geçti** |
| `npm run check:electron` | **60 Electron + 3 otomasyon modülü geçti** |
| `git diff --check` | Geçti |

Yeni testler üretim `submitHermesTask` fonksiyonunu Electron/backend yerine doubles ile her iki normal taşıma yolunda çalıştırıyor; otomasyon talimatını yakalıyor; varsayılan/özel dizinleri, normalize sözleşmeyi, zorunlu alanları ve salt okunur sesli v1/v2 sınırını doğruluyor. Genel paket native izin/onay, kuyruk/iptal, sesli sözleşmeler, araştırma ve otomasyon sonuç testlerini de kapsıyor.

## Dosyalar

- [main.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/electron/main.mjs)
- [automationHermes.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/electron/automationHermes.mjs)
- Yeni: [hermesWorkPolicy.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/electron/hermesWorkPolicy.mjs)
- Yeni: [hermesOutputContract.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/electron/hermesOutputContract.mjs)
- Yeni: [hermesWorkPolicy.test.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/test/hermesWorkPolicy.test.mjs)
- Bu rapor.

Hermes kaynakları, yama, sabit commit, kurulum ve native protokoller değiştirilmedi. Korunan yama/manifest/kurulum dosyalarının hash'leri önceki doğrulamayla aynı. Yeni bağımlılık eklenmedi. Canlı Hermes/GPT görevi veya bilgisayar otomasyonu çalıştırılmadı; dağıtım paketi yeniden üretilmedi. Diğer paketlere geçilmedi.

Politika bir talimattır, OS sandbox değildir. Mekanik çıktı doğrulaması, sonucun anlamsal doğruluğunu kanıtlamaz. Normal işlerin serbest metin taleplerinden yeni bir çıktı şeması çıkarılmıyor; açık yapılandırılmış sözleşme otomasyon düğümündeki mevcut ayarlardan geliyor.
