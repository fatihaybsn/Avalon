# B paketi — ortak OS görev kilidi

7 Kasım 2026. Yalnızca sorun 3 uygulandı. Önceden bulunan çalışma ağacı değişiklikleri ve A paketi korundu. Commit oluşturulmadı.

## Davranış ve kilit kapsamı

Manuel ResearchService/AutomationService başlangıçları ve `--run`, `--schedule`, `--automation` headless girişleri artık aynı OS kilidinden geçer. Önceki Python supervisor'daki Windows `msvcrt.locking` / POSIX `flock` işlemi ortak, yalnızca standart kitaplık kullanan Python yardımcıya taşındı. Cron'un detached başlatma davranışı korundu; yeni cron başlatıcısı ikinci kilit almaz. Her üst düzey worker bir Python kilit yardımcısı tutar; iç içe araştırma mevcut bellek içi kilit yetkisini devralır, yeni yardımcı açmaz.

| Kaynak paylaşımı | Kilit kapsamı |
| --- | --- |
| Aynı otomasyon akışının manuel/zamanlanmış turları ve araştırma adımları | Mevcut akış hash'i altındaki `supervisor.lock`; ortak automationMemory ve akış durumu |
| Aynı bağımsız araştırma zamanlaması ve onun araştırma kayıtları | Zamanlama kimliği; ortak `seen.json` |
| Bağımsız manuel araştırma | Araştırma kimliği; kendine ait çıktı/ara kayıtlar |
| Farklı akışlar veya araştırma zamanlamaları | Birbirini engellemez; yalnızca ortak çıktı üst dizini seçmek global kilit oluşturmaz |

JSON/PID kayıtları artık kabul kararı vermez. Eski `active.lock` dosyasını okuyup silerek kilit edinme kodu kaldırıldı. Kalıcı OS kilit dosyası silinmez/değiştirilmez. Occurrence kontrolü ve atomik kaydı OS kilidi tutulurken yapılır; yazma hatasında kilit bırakılır. Aynı occurrence çökme sonrasında otomatik tekrarlanmaz. Tamamlanmış/başlamış araştırma kaydı yeni headless çağrıyla yeniden yürütülmez. Supervisor kaybı worker iptal sinyaline dönüşür.

## Mevcut zamanlama geçişi

Depoya bağlı mevcut **bir** başlatıcı yenilendi. Native görev kimliği **`f1dd68a6e200`** korundu. `state.json` ve native `cron/jobs.json` dosyalarının önce/sonra SHA-256 değerleri aynı; zamanlama ayarı, enabled durumu ve occurrence kayıtları değiştirilmedi. Diğer eski/geçici test başlatıcılarına dokunulmadı. Geçişte etkin eski worker bulunmadı.

Yedek: [başlatıcı ve görev tanımları](C:/Users/Fatih/AppData/Local/hermes/scripts/avalon-backups/schedule_313336c7-4c03-4ad9-95cc-1a4df40b2e37/1794048658954-1d638146-dc0e-44b6-b666-77a38657690b).

Yedek dizini `launcher.py`, `launcher.json`, `state.json`, `native-jobs.json` ve hedef yollarını içeren `restore.json` içerir. Geçiş aynı kaynak OS kilidi altında yapılır; etkin görev varsa değişiklik yapılmadan `LAUNCHER_BUSY` ile ertelenir. Bilinen eski şablon hash'i veya doğrulanan v2 şablonu dışında dosya üzerine yazılmaz.

Yeni Python başlatıcısı yapılandırmayı kendi içinde taşır: tek atomik `.py` değişimi kod ve yapılandırmanın birlikte devreye girdiği noktadır. Companion JSON geçiş ortasında kalsa bile çalışan v2 yapılandırması değişmez. Yazma hatasında önceki başlatıcı çifti geri yüklenir. Uygulama zamanlama yenileme, düzenleme, çalıştırma/devam işlemlerinde gerekli geçişi yeniden dener.

**Sürüm uyumluluğu:** v2 başlatıcı runner protokolünü doğrular. Eski runner ile görev başlatmaz. Eski OS kilitli başlatıcı/yeni runner karışımı `already_running` ile güvenli biçimde çıkar; occurrence tüketmez ve model çağırmaz. Bu karışımda o cron tetiklemesi çalışmayabilir; bu nedenle başlatıcı geçişi dağıtımla birlikte yapılmalıdır. Mevcut başlatıcının geçişi tamamlandı. Eski kodu önceden belleğe yüklemiş worker'lar güncelleme öncesinde bitmelidir.

**Geri dönüş:** etkin işler bittikten ve aynı kaynak kilidi alındıktan sonra B öncesi uygulama kodu ile yedekteki `.py`/`.json` birlikte geri alınır; dosyalar geçici dosya + atomik rename ile değiştirilir. Güncel native job dosyası veya state/occurrence arşivi körlemesine geri yazılmaz; geçiş bunları değiştirmedi. Yedek task/native dosyaları karşılaştırma içindir.

## Doğrulama

| Kontrol | Sonuç |
| --- | --- |
| `npm test` | **322/322 geçti**, 0 başarısız, 0 atlanan |
| Kilit ve başlatıcı testleri | **14/14 geçti**; toplam test sayısı 13 arttı |
| `python -B test/research_scheduler_test.py` | **6/6 geçti**; Hermes modülleri sahte |
| `npm run check:electron` | **58 Electron + 3 otomasyon modülü geçti** |
| `npm run check:python` | Geçti; yeni kilit yardımcısı dahil |
| `npm run build` | TypeScript, masaüstü ve mobil build geçti |
| `git diff --check` | Geçti |

İki bağımsız Node yardımcı süreç gerçek OS kilidini yalnızca geçici dosyalar üzerinde sınadı: eşzamanlı kabul, silinmiş/bozuk/canlı ilgisiz PID tanılamaları, owner çökmesi, occurrence tekrarı, ayrı kapsamların paralelliği, iç içe araştırma devri ve hata halinde bırakma. Başlatıcı testlerinde cron/Hermes sahte; gerçek detached test worker'ları yalnızca geçici işaret dosyaları oluşturdu. Ayrıca atomik geçiş hatası, değişmez zamanlama kimliği, karışık sürümler ve özel başlatıcıların korunması sınandı.

Build yalnızca mevcut büyük chunk ve `inlineDynamicImports` deprecation uyarılarını verdi. Gerçek Hermes/GPT Researcher görevi, tarayıcı veya bilgisayar otomasyonu çalıştırılmadı. Dağıtım EXE paketi yeniden üretilmedi. Yeni bağımlılık eklenmedi.

## Bu paketin dosyaları

- [researchRunner.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/electron/researchRunner.mjs), [researchScheduler.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/electron/researchScheduler.mjs), [researchService.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/electron/researchService.mjs), [automationService.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/electron/automationService.mjs)
- Yeni: [researchLock.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/electron/researchLock.mjs), [researchLauncher.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/electron/researchLauncher.mjs), [research_lock.py](C:/Users/Fatih/Desktop/Avalon/Avalon/sidecar/research_lock.py)
- Paket/syntax doğrulaması: [package.json](C:/Users/Fatih/Desktop/Avalon/Avalon/package.json), [python-command.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/scripts/python-command.mjs), [test-research-package.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/scripts/test-research-package.mjs)
- Testler: [researchLock.test.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/test/researchLock.test.mjs), [researchLauncher.test.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/test/researchLauncher.test.mjs), [research.test.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/test/research.test.mjs), [automation.test.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/test/automation.test.mjs), [researchLockWorker.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/test/helpers/researchLockWorker.mjs), [v1 fixture](C:/Users/Fatih/Desktop/Avalon/Avalon/test/fixtures/research-launcher-v1.py)
- Bu rapor ve yukarıda belirtilen mevcut Avalon başlatıcı çifti/yedeği.

Hermes Python kaynakları, sürümü, sabit commit'i, yaması ve kurulum betikleri değişmedi; korunan yama/manifest/kurulum dosyalarının hash'leri aynı. OS kilidi harici işlemlerin kesin bir kez yürütülmesini veya çökmede yan etkilerin geri alınmasını garanti etmez; A paketinin belirsiz Hermes işi için inceleme engeli korunur. Diğer paketlere geçilmedi.
