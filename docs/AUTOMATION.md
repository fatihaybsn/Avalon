# Avalon otomasyonları: mimari ve kullanım

## Sorumluluklar

Önceki uygulama yalnızca Başlangıç → Araştırma → Bitiş zincirini kabul ediyor, bağlantıları sıralı bir listeye dönüştürüyor ve Electron tarafında aynı sırayı tekrar denetliyordu. Node-RED yalnızca adım kimliği gönderiyor, sonuç verisi almıyordu. Hermes görevleri, koşullar ve geri dönüşler desteklenmiyordu.

Artık Node-RED bağlantıları, switch/change/catch düğümleri, koşullu yönlendirme ve düzeltme kollarının sahibidir. Avalon gelen görev isteğini doğrular, mevcut GPT Researcher veya Hermes bağlantısını çağırır, kimlik ve sonucu kalıcılaştırır ve aynı isteğe yanıt verir. Avalon bir sonraki düğümü seçmez. Görev deneme sınırı ve çalışma zaman aşımı güvenlik bütçeleridir; tekrarın yapılıp yapılmayacağını Node-RED bağlantıları belirler.

GPT Researcher motoru, mevcut araştırma ayarları, ResearchStore rapor arşivi, automationMemory kayıt/coverage mantığı ve Hermes zamanlayıcısı korunur. Yeni bağımlılık veya ikinci bir zamanlayıcı eklenmez. Manuel başlangıç da mevcut headless giriş noktasını ve aynı akış kilidini kullanır.

## Kullanım

1. Windows x64 üzerinde mevcut Hermes ve GPT Researcher kurulumunu tamamlayın. Hermes Görevi için mevcut yerel interactive / serve taşıyıcısı gerekir. Uzak runs_api bu düğümde desteklenmez; açık hata döner.
2. Avalon → Planlama → Otomasyonlar → Yeni otomasyon oluştur / düzenle yolunu açın. Node-RED kurulmamışsa önce Kur'u kullanın.
3. Avalon Başlangıç → Avalon Araştırma → Hermes Görevi → Hermes Görevi → Avalon Bitiş bağlayın.
4. Araştırma düğümünde eski Konu, Amaç, Kaynaklar, tür, genişlik ve derinlik ayarları kullanılabilir. Hermes düğümünde doğal dil talimatını ve önceki çıktı seçimlerini girin.
5. Çalışma klasörü, IRIS_HERMES_CWD ayarlıysa bu kökün, değilse araştırma çıktı klasörünün altında olmalıdır. Boş değer kökü kullanır; örneğin proje için göreli bir alt klasör girin.
6. Done → Deploy sonrasında Avalon kartından Şimdi çalıştır'ı kullanın. Bu işlem için zamanlama oluşturmak gerekmez. Zamanla mevcut Hermes zamanlayıcısında yalnızca başlangıcı zamanlar.
7. Sonucu aç mevcut okuyucuyu kullanır. Dosya klasörünü aç ve gerekli dosya referansları üretilen dosyalara erişim sağlar. Önceki turlar ve bütün denemeler korunur.

Yeni kurulum üç örnek akış oluşturur; mevcut kullanıcı akışları değiştirilmez. Mevcut kurulumlarda aşağıdaki JSON dosyaları içe aktarılabilir:

- [Eski doğrusal araştırma](../automation/nodes/examples/avalon-example.json)
- [Araştırma → Python projesi → HTML dokümantasyonu](../automation/nodes/examples/research-hermes.json)
- [Değerlendirme ve sınırlı düzeltme döngüsü](../automation/nodes/examples/research-revision.json)

Örnekleri çalıştırmak gerçek servis ve dosya işlemleri yapar. Geliştirme doğrulamasında bu örnekler yalnızca derlenip simüle edilmiştir.

## Düğüm ayarları ve yönlendirme

Hermes Görevi; ad, prompt, seçili önceki çıktılar, çalışma klasörü, çıktı türü, zaman aşımı (1 saniye–2 saat), düğüm başına toplam deneme sınırı (1–100, varsayılan 3), hata davranışı ve isteğe bağlı başlatma onayı sunar. İptal veya zaman aşımı native Hermes durdurma isteği gönderir; bağımsız bir “iptali yok say ve devam et” modu sunulmaz.

- Metin: boş olmayan sonuç.
- JSON: JSON nesnesi ve isteğe bağlı virgülle ayrılmış zorunlu üst seviye alanlar.
- Değerlendirme: outcome = approved / revision_required / needs_review / failed. İsteğe bağlı reason gibi alanlar zorunlu tutulabilir.
- Dosyalar: her satırda çalışma klasörüne göre gerekli bir dosya. Dosyalar var, boş olmayan ve kapsam içinde olmalıdır. Önceki dosyalar otomatik silinmez; varlık kontrolü dosyanın bu denemede üretildiğini veya içeriğinin doğru olduğunu kanıtlamaz.

Başarılı görev sonucu msg.payload içinde bulunur. Değerlendirme için switch özelliği payload.value.outcome, türü msg, “check all rules” kapalı olmalıdır. approved çıkışını sonraki göreve, revision_required çıkışını bir change düğümüne bağlayın. change ile msg.feedback içine düzeltme metni veya payload.value kopyalayın; çıkışı önceki göreve bağlayın. needs_review çıkışını Bitiş'e bağlamak çalışmayı “inceleme gerekiyor” durumunda bitirir. Bu durum için otomatik devam düğmesi yoktur; kaydı inceleyip gerekiyorsa yeni bir çalışma başlatın.

Araştırma veya Hermes hatasında varsayılan akış durur. “İkinci çıkışa gönder” seçildiğinde hata kolunu bağlayın. “Catch düğümüne gönder” seçildiğinde görevi kapsayan tek bir Node-RED catch kullanın. Başarısız sonuçta başarılı çıktı referansı üretilmez. Hata kolu doğrudan Bitiş'e giderse sonuç başarısız/kısmi kalır; bir kurtarma görevi gerçekten tamamlanırsa yeni başarılı sonuçla bitebilir.

Değerlendirme isteğe bağlıdır; yalnızca değerlendirme düğümü eklenirse model çağrısı yapılır. Model kararı doğruluk kanıtı değildir. Alan, dosya ve boş rapor kontrolleri ek mekanik kontrollerdir.

İlk kapsam tek etkin mesaj koludur: koşullu kollar ve geri dönüşler desteklenir; bir çıkıştan paralel çoğaltma, birden çok eşleşen switch çıkışı, subflow, function/exec/inject, HTTP/dosya düğümleri ve JSONata kabul edilmez. switch/change yalnızca payload/topic/feedback üzerinde çalışır; Avalon kimlik ve referansları değiştirilemez. Dış işlemleri Hermes'in kendi araçları yürütür.

## Mesaj ve kayıt sözleşmesi

Çalışma başlangıcı: start {version:1, runId}. Görev isteği: task {runId, id:stepId, requestId, outputs, feedback}. Yanıt: taskResult {requestId, result}. Sonuç:

    {
      "attemptId": "requestId",
      "status": "completed",
      "ref": {
        "runId": "...",
        "stepId": "...",
        "attemptId": "...",
        "kind": "research veya hermes",
        "file": "kalıcı sonuç dosyası",
        "outputPath": "çıktı klasörü",
        "files": ["doğrulanmış gerekli dosyalar"],
        "researchId": "yalnızca araştırmada"
      },
      "value": { "outcome": "approved" }
    }

Hatalar status/error/code/attemptId taşır; ref taşımaz. value yalnızca yapılandırılmış sonuçlarda bulunur ve yönlendirme için 16.000 karakterle sınırlıdır. Büyük raporlar IPC boyunca kopyalanmaz. Hermes önceki çıktıları açık dosya referansları olarak alır. GPT Researcher mevcut rapor-içeriği adaptörünü ve mevcut sentez sınırlarını kullanır. Seçilen referanslar aynı çalışma ve aynı kolda tamamlanmış denemeyle eşleşmelidir.

run.json mevcut runs/<runId> altında akış, çalışma, adım, deneme, native görev/oturum kimliği, durum, çıktı referansları ve hatayı saklar. Hermes metni deneme klasöründeki output.md, araştırma raporu mevcut ResearchStore içindedir. Her deneme yeni bir kayıt/araştırma oluşturur; önceki rapor silinmez. Sonuç, Node-RED'e yanıt verilmeden önce kaydedilir. Aynı requestId tekrar gelirse kayıtlı yanıt gönderilir. Program adım sırasını görev dizisinin konumundan çıkarmaz.

## İzin, kesinti ve iptal

Hermes mevcut HermesGatewayClient ve HermesInteractiveTransport üzerinden çağrılır. Her görev ayrı native oturum kullanır; standart native izin modu uygulanır. Başlatma onayı gerekiyorsa görev henüz gönderilmeden beklenir. Native araç onayları ve açıklama istekleri otomasyon kartında gösterilir; yanıt yalnızca doğru çalışma/deneme/interaction kimliğiyle kabul edilir. Otomasyon arayüzü yalnızca “bu kez” ve “reddet” izinleri sunar; otomatik veya kalıcı onay vermez. Gizli değer/parola istekleri yanıt dosyasına yazılmaz; çalışma inceleme gerektirerek durur.

Rapor ve dosya içerikleri talimat veya kullanıcı izni sayılmaz. İstenen çalışma klasörü ve doğrulanan çıktı referansları kök ve gerçek dosya yollarıyla kontrol edilir; junction/symlink kaçışları reddedilir. Bu bir işletim sistemi sandbox'ı değildir. Hermes'in bütün araçlarının dosya erişimi, tarayıcı ve bilgisayar yetenekleri kullanıcının mevcut Hermes yapılandırması ve native izinlerine bağlıdır. Taşıyıcının desteklemediği Desktop yüzeyleri varmış gibi sunulmaz.

Node-RED yeniden başlar/bağlantısı koparsa veya çalıştırıcı kaybolursa run.json kalıcı “interrupted” durumuna uzlaştırılır. Tamamlanmış adımlar yeniden yürütülmez; aynı çalışma otomatik devam ettirilmez. Yeni çalışma kullanıcı tarafından ayrıca başlatılır ve baştan başlar. Native görev kimliği korunur; harici işlemin durumunu yeniden çalıştırmadan önce inceleyin. Node-RED mesaj bağlamının kesinti sonrası güvenli biçimde geri yüklenmesi bu sürümde sunulmaz.

Zaman aşımı veya iptalden sonra Hermes'in dış etkilerinin geri alındığı varsayılmaz. İptal doğrulanamıyorsa cancellationUnconfirmed kaydedilir. Hermes zaman aşımı “needs_review” ile durur. Kaybolan prompt.submit kabul yanıtı da belirsiz teslim olarak kaydedilir; görev başarısız göründü diye körlemesine tekrar yapılmaz. Belirsiz native oturuma durdurma isteği gönderilir.

Belirsiz iptal veya kesinti bulunan akışın sonraki manuel ve zamanlanmış başlangıçları engellenir. Karttaki “Görevi ve dış işlemleri kontrol ettim” işlemi yalnızca kullanıcı kontrolünden sonra ilgili runId için reviewed.json kaydı yazar. Bu kayıt Hermes aracına izin vermez, eski çalışmayı sürdürmez ve eski sonuçları silmez; yeni başlangıç engelini kaldırır. Harici servislerde tam bir kez yürütme garantisi verilmez.

Her çalışma immutable revision.json ve flows.json kopyası kullanır. Mevcut Deploy kilidi de korunur. Hermes zamanlayıcısının occurrence kimliği ve mevcut flow lock çakışan/tekrarlanan tetiklemeyi eler; Node-RED'e inject veya ikinci zamanlayıcı eklenmez.

## Yükseltme ve güvenli kurtarma

1. Eski sürümdeki etkin turların bitmesini bekleyin veya iptal edip temizliğin tamamlandığını doğrulayın. Avalon'u tamamen kapatın; uygulamayı güncelledikten sonra Avalon'u ve Node-RED düzenleyicisini yeniden başlatın. Açık editör eski düğüm tanımlarını bellekte tutabilir. Hermes Görevi kartı için Hermes/Node-RED runtime yeniden kurulmaz; mevcut akışlar korunur, yeni örnekler ayrıca içe aktarılabilir.
2. Güncel uygulamada Planlama zamanlamalarını yenileyin. Bilinen Avalon başlatıcıları v2'ye geçirilirken `.py`, `.json`, görev kaydı ve mevcut native görev tanımlarının yedeği `HERMES_HOME/scripts/avalon-backups/<scheduleId>/` altına alınır. Yapılandırması gömülü `.py` dosyasının atomik değişimi geçiş noktasıdır. Native kimlikler, zamanlama ayarları ve geçmiş korunur. `LAUNCHER_BUSY` geçişin etkin iş nedeniyle ertelendiğini gösterir; iş bitince tekrar yenileyin. Değiştirilmiş/bilinmeyen başlatıcılar otomatik ezilmez.
3. Kaydedilmiş executable/runner yollarının yeni konumda geçerli olduğunu kontrol edin. v2 başlatıcı runner protokolünü denetler; karışık sürüm çalıştırılmaz ve bir cron tetiklemesi atlanabilir. Katılımsız kullanımdan önce geçiş tamamlanmalıdır. Hermes sürümü, yamaları ve kurulum sözleşmesi değişmez.
4. Kilit yardımcısı ölürse worker iptal edilir. Yeni çakışan başlangıç, aynı OS kilidi altında önceki çalışma kaydı uzlaştırıldıktan sonra değerlendirilir. `running` veya `executionPending` kaydı canlı worker'a aitken, görev terminal görünse bile temizlik bitmeden yeni iş kabul edilmez. Bu işaret yalnızca kaynaklar kapatıldıktan sonra temizlenir. Belirsiz Hermes işi mevcut inceleme engelini korur; onay canlı temizliğin üzerinden atlayamaz.
5. Takılan işte önce **Turu iptal et** kullanın. Sonlanmıyorsa kayıttaki PID'yi ve komut satırını doğrulayıp yalnızca ilgili Avalon runner sürecini sonlandırın; yardımcı süreci tek başına öldürmek kurtarma değildir. Sonraki durum yenilemesi/başlangıç ölü worker kaydını uzlaştırır ve sonuçları korur. Hermes görevinin ve dış işlemlerin durduğunu ayrıca kontrol ettikten sonra **Görevi ve dış işlemleri kontrol ettim** ile o runId'yi onaylayın. Zamanlanmış/headless başlangıçlar da aynı engeli kullanır; inceleme masaüstü kartından yapılabilir. Canlı ama PID'si yeniden kullanılmış şüpheli kayıtta başka bir süreci körlemesine durdurmayın; doğrulanmış yeniden başlatma sonrasında uzlaştırın. Kilit/çalışma/occurrence dosyalarını silerek veya süre dolduğu gerekçesiyle engeli kaldırmayın.
6. Geri dönüşte etkin işleri güvenli sonlandırın; B öncesi uygulama ile başlatıcı yedeğindeki `.py`/`.json` çiftini birlikte geri alın. Aynı kaynak OS kilidi altında geçici dosya + atomik rename kullanın. Sonraki cron başlangıcından önce eşleşen sürüm ve yolları doğrulayın. Güncel native job/state dosyalarını yedekten körlemesine geri yazmayın; yedekler karşılaştırma içindir. Raporları, kullanıcı ayarlarını ve occurrence geçmişini koruyun.

Kurtarma otomatik bir eski-iş tekrarı yapmaz. Ölü araştırma worker'ının mevcut checkpoint kurtarması yeniden kullanılır; belirsiz Hermes yan etkileri insan incelemesi ister. Farklı akışlar ve bağımsız araştırma kapsamları birbirini engellemez.

## JSON paylaşımı

Avalon kartındaki “Güvenli JSON şablonu” yalnızca izinli yapısal alanları dışa aktarır. Promptlar, isimler, serbest metin, change/switch sabit değerleri, yerel yollar, gerekli dosya adları ve bilinmeyen yapılandırma kaldırılır; düğüm kimlikleri yeniden oluşturulur. Dosya çıktısı ayarı yeniden yapılandırılmak üzere metne çevrilir. Kullanıcı kendi promptlarını, koşul değerlerini ve dosya ayarlarını yeniden girmelidir. Node-RED'in ham dışa aktarım menüsü gizlidir.

“JSON içe aktar” akış şemasını ve desteklenen düğümleri doğrular, çalışan tur sırasında reddeder ve mevcut kimlikleri ezmez. Aynı şablonu ikinci kez eklemek için Node-RED'in kimlikleri yenileyen içe aktarımını kullanabilirsiniz. Kaynak JSON dosyaları ile runtime/env/credential kayıtları birbirinden ayrıdır; yerel kayıtları paylaşılan şablon olarak kullanmayın.

## Doğrulama ve bakım

node scripts/test-automation.mjs yalnızca çevrimdışı testleri çalıştırır. Eski kurulum yapan canlı kontrol betiği kaldırılmıştır. Mock Hermes/GPT Researcher, üretim Avalon sınır düğümleri, kontrollü Node-RED kolları ve kalıcı geçici test kayıtları kullanılır. Kurulu Node-RED varsa switch/change kaynak kodu ayrıca bellekte test edilir; yoksa ilgili iki çekirdek/yükleme testi skip olur (AVALON_TEST_NODE_RED_DIR ile kurulum yolu verilebilir). Sunucu, gerçek Hermes/GPT araştırması, tarayıcı veya bilgisayar otomasyonu başlatılmaz.

Değişen ana dosyalar: automation/flows.cjs, automation/host.cjs, automation/nodes/avalon.js ve avalon.html; automationRunner.mjs, automationHermes.mjs, automationRuntime.mjs, automationService.mjs; paylaşılan hermesRuntime.mjs; researchRunner.mjs; main/preload/applicationMethods IPC; AutomationPanel ve mevcut sonuç okuyucu tipleri/mobil köprüsü/stilleri; örnek JSON'lar; otomasyon testleri ve syntax kontrolü. Mevcut Hermes aday-yol kodu ortak modüle taşınmıştır; eski doğrusal compile/sıra kontrolü ve tekrar eden iptal UI kodu silinmiştir.

Doğrulama sonuçları [validation/automation-upgrade/RESULTS.md](../validation/automation-upgrade/RESULTS.md) dosyasındadır. Gerçek servis, dağıtılmış uygulama paketi veya canlı UI davranışı bu testlerle doğrulanmış sayılmaz.

Node-RED yükleme ayarları ve kullanılan çekirdek düğümler için kaynak: [Node-RED 5.0.9 registry](https://github.com/node-red/node-red/blob/5.0.9/packages/node_modules/%40node-red/registry/lib/localfilesystem.js), [runtime configuration](https://nodered.org/docs/user-guide/runtime/configuration).
