# 07 — dar Windows, dosya/belge ve yönetilen browser sözleşmesi

Bu aşama OpenClaw 2026.10.2 üzerinde çalışır. Genel Windows GUI, CUA/MCP, işçi, Live ve sesli onay sonraki aşamalardadır. Dar yardımcılar PowerShell 7 + Windows API/.NET kullanır; Python ses yardımcısı ve ses bağımlılıkları kurulmaz. Yerel belge okuyucusu repo `.venv/Scripts/python.exe` varsa onu, yoksa mevcut Codex runtime Python kütüphanelerini kullanır; sabit host yolu caller parametresi değildir. Başka bilgisayarda hazırlama sırası README 4c'dedir. Bu geliştirme ortamı 16'nın bağımsız dağıtım paketi değildir.

## Araçlar

| Araç | Parametre / davranış |
|---|---|
| `jarvis_windows` | `action`; uygulama işleminde `app`: `notepad`, `calculator`, `paint`. Genel exe, shell, argv, kısayol veya config parametresi yok. Katalog host kodunda genişletilebilir; makinedeki her kurulu programın keşfi/otomatik açılması iddia edilmez. |
| Pencere işlemleri | `resolve/open/status/focus/minimize/restore/close`; son dört işlemde gözlenen `window:{pid,started,exe,hwnd}`. `started` .NET UTC ticks, `hwnd` ondalık string. Uygulama adına genel kapatma izni yok. Her eylemden önce exe/PID/başlangıç/HWND güncel denetlenir. |
| Ses/medya/güç | `audio_status`, `volume(value:0..100)`, `mute(value:boolean)`, `media(value:play_pause/next/previous/stop)`, `power_status`, `power(value:saver/balanced/performance)`. Yalnız kurulu standart güç planları; eksik plan üretilmez. Medya gerçek SendInput adetlerini verir; oynatma etkisi gözlenmeden `confirmed:true` dönmez. |
| `jarvis_recycle` | Tek `path`; proje kökünün altında mevcut dosya/dizin. Genel silme, kalıcı fallback veya otomatik yeniden deneme yok. Native onaydan sonra bağlantı/korunan alt içerik ve gerçek kapasite tekrar kontrol edilir. |
| `jarvis_document` | `path`, `kind:text/pdf/office/image/ocr`. Yerel UTF-8, pdfplumber, python-docx/openpyxl/ZIP/XML, Pillow okuyucuları. PDF 20 sayfa, çıktı ve ZIP açılımı sınırlıdır; XLSX formülleri yürütülmez. DOCX/XLSX/PPTX dışındaki eski/makrolu Office dosyaları reddedilir. OCR, sabit Windows PowerShell helper üzerinden kurulu `Windows.Media.Ocr` motorunu kullanır; bu makinede Türkçe doğrulandı. PNG/JPEG/BMP/TIFF ilk kare, 25 MiB/16 milyon piksel/native boyut sınırı ve 20 bin karakter çıktısı; çok kare ve kesilmiş metin `partial:true`. OCR dili kurulmamışsa açık engel; taranmış PDF için otomatik raster dönüştürücü yok. |
| `jarvis_draft` | Kapsamlı `.txt` `path`, sınırlı `content`, isteğe bağlı `show:true`. Önce geri alma kopyası, sonra gerçek içerik doğrulaması. `show` yalnız açıkça kabul edilmiş parametreyse sabit Notepad'e kontrollü dosya argümanı verilir. |
| Native `read/write/edit` | Mevcut OpenClaw dosya araçları korunur. Olağan proje yazmalarında `.jarvis-undo` içine önceki byte'lar/existence ve görev kimliği saklanır; geçmiş model yazma/silmesine kapalıdır. Repo diff'i korunur. Başka dosyanın 03 kapsam uzatma onayı beklerken o dosya okunarak/yazılarak yedek üretilmez; geri alma gerektiren olağan düzenleme için insan seçimiyle o projenin kökü bağlanır. |

Kapatma yalnız bir `WM_CLOSE` uygulamasından geçer. `closeRequested`, `windowClosed`, `saveDecisionRequired` ayrı sonuçlardır. Açık kalan pencere başarı değildir; model kaydet/discard seçimi yapmaz. PID/başlık/app adı üzerinden force-kill, `requires_opencode`, genel tuş/kısayol veya serbest GUI yolu yoktur. Çoklu pencere için kullanıcı tek gözlenen hedefi seçer; model rastgele seçim yapmaz.

## Host kabulü ve model gerektirmeyen çağrı

Mevcut authenticated `jarvis.scope.bind` artık en fazla 24 adet `quick:[{tool,params}]` alır. Bunlar gerçek operator/device/session kapsamındaki **tam işlem snapshot'larıdır**; araştırma rolü alamaz. Model başka hedef/parametre seçemez. Mutasyon snapshot'ı yürütme başında tüketilir; başarısız/belirsiz işlemin otomatik tekrarı yoktur. Read/status tekrar okunabilir. Onay, grant ve yerel sonuç ikinci bir veritabanında tutulmaz.

Authenticated `jarvis.quick.execute` yalnız dört JARVIS yerel aracını çağırır:

```json
{"sessionKey":"gerçek session key","agentId":"main","runId":"önceden bağlanan run","callId":"tek-kullanımlık-call","tool":"jarvis_windows","params":{"action":"audio_status"}}
```

Native `before_tool_call` politikası, mevcut `plugin.approval.request` ve `after_tool_call` kaydı aynen kullanılır. Close/recycle için yalnız `allow-once/deny`; karar verilmeden etki yoktur. Aynı call yeniden yürütülmez. Sonuç host kaydı yayımlanmadan RPC başarı cevabı verilmez. Retained 06 kayıtlarında `execution:local`, gerçek yardımcı sonucu ve sınırlı native çıktı tutulur; bunun için `chat.send`, Space Bunny veya yeni görev kuyruğu çalıştırılmaz. Reload sonrası eski yetki canlandırılmaz.

Tek işlemli direct grant çağrı sonunda bırakılır. Aynı session'da yeni gerçek operator turn'ü, tamamlanmış direct local grant'ları temizler; devam eden native/yerel işi iptal etmez. Browser tab hedefi native gözlemdeki 32 haneli CDP ID'dir; friendly tab adı/alias lease kimliği olarak kullanılamaz. Windows tuple lease'i alan sırası veya exe harf büyüklüğüyle değişmez; recycle dizini alt dosya yazmasıyla çatışır.

Electron sağ panelindeki **Hızlı Windows işlemi** aynı operator yolunu kullanır. Pencere kimliğini renderer parametrelerinden oluşturmaz; host'un gözlediği hedef token'ını seçtirir, 60 saniye sonra yeni gözlem ister. Kapatma onayı mevcut yetkili OpenClaw istemcisinde yapılır; 13'ün sesli onay köprüsü değildir. Dosya/belge/draft araçları Gateway/model aracıdır; Electron'a genel dosya/RPC/exec IPC eklenmedi.

## Çöp Kutusu sınırı

Yalnız yerel sabit NTFS volume, doğrulanmış volume kimliği, `NukeOnDelete=0`, gerçek per-volume `MaxCapacity`, `SHQueryRecycleBin` doluluğu ve boş disk alanı kabul edilir. Eksik/kapalı/belirsiz kapasite reddedilir; 1 GB garantisi yoktur. Sistem kökü, `$Recycle.Bin`, korunan alan/alt içerik, reparse/junction/hardlink, kapsam kaçışı ve sınırsız traversal kapalıdır. Kullanıcı dosyası için tek runtime silme yolu budur.

`IFileOperation`, `FOFX_RECYCLEONDELETE` + undo/early-failure/no-error-UI kullanır. UAC açılmaz. Progress sink, recycle bayrağı olmayan işlemi iptal eder; PreDeleteItem'da native kaynak/scope, ancestor/reparse, korunan alt içerik ve handle üzerinden hardlink bilgisini yeniden denetler. Başarı için native final/aborted raporu, PostDeleteItem'ın başarılı HRESULT'u (pozitif Shell başarı kodu da geçerlidir), gerçek yeni recycle IShellItem yolu ve o öğenin halen Çöp Kutusu'nda varlığı gerekir. Kaynak yoldan kaybolmak tek başına başarı değildir. Belirsiz sonuç yeniden gönderilmez.

Sözleşme: [Microsoft operation flags](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ifileoperation-setoperationflags), [PostDeleteItem sonucu](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ifileoperationprogresssink-postdeleteitem).

## Yönetilen browser ve açık native engel

**14 Ekim 2026 kullanıcı kararı:** Alan adı/DNS rebinding engeli sonraki ayrı düzeltmede çözülecek; bu aşamada native yama veya güvenlik istisnası yapılmaz. Browser'a bağlı genel web/login/form görevleri engelli kalır. Windows/dosya/belge/OCR ve salt okunur araştırma çalışmaları bu ertelemeden bağımsızdır. Kabul için native DNS/yönlendirme/private ağ ve popup/service-worker/subresource sınırı, iki yönetilen profil ve kritik işlem onayı birlikte doğrulanacaktır. Salt okunur incelenen resmî 2026.10.3 aynı hostname/proxy-routed reddini içerir; kurulu sürüm değiştirilmedi.

Native bundled browser + Playwright kullanılır; ikinci sürücü yoktur. `jarvis-visible` (18810, headed) ve `jarvis-background` (18811, headless) ayrı JARVIS profilidir. Kişisel profil/session/cookie import, remote/node hedefi, JS evaluate, generic key/koordinat/batch/upload/download kapalıdır. `target:host`, exact profile, tab ID ve snapshot ref gerekir. Görerek/görünür isteği background profile dönüştürülmez; ortam `OPENCLAW_BROWSER_HEADLESS` ile sessiz override başlangıçta reddedilir. Profil/tab kaynak sahipliği 06 kanıtına bağlanır.

`status/start/tabs/open/navigate/snapshot/screenshot/text/focus/close`, sınırlı `act:{kind:click/type/hover,ref,...}` kabul edilir. İlk sekme native `open about:blank`, ardından exact tab üzerinde Playwright `navigate` yoludur: yerel managed engine'in doğrudan HTTP `open` yolu strict redirect-hop inspection sağlamadığından reddedilir. Bu özel boş sayfa başka non-network şemalara izin vermez. Her act ve close son dış işlem olabileceğinden frozen native **elle allow-once** ister; ödeme için ses/model kararı kabul edilmez. Hesap girişi gerektiğinde kullanıcı yalnız bu yönetilen profilde kendi girişini yapar; giriş yapılmış veya hesap erişimi hazır varsayılmaz. Browser çıktısı/veri kullanıcı yetkisi yerine geçmez.

**OpenClaw 2026.10.2 native engeli:** `dangerouslyAllowPrivateNetwork:false` altında hostname navigation, DNS rebinding koruması bulunmadığı için `IP-literal URL required` ile reddedilir. JARVIS bunu aşmak için `allowedHostnames`, private-network izni, IP'ye sessiz URL dönüşümü veya başka browser sürücüsü eklemez. Dolayısıyla normal alan adlı web/login akışı **hazır değildir**; public IP hedefindeki native lifecycle/Playwright ayrı doğrulanabilir. Host DNS preflight, native özel ağ/redirect/document guard'ına ilavedir, bu native hostname engelini kaldırmaz.

Native sınır da tam bir egress firewall değildir: popup ilk isteği, service worker ve bütün arka plan/subresource trafiği için eksiksiz izolasyon garantisi verilmez. Alan adlı genel kullanım için desteklenen native DNS/egress sözleşmesinin yeniden doğrulanması gerekir; sürüm/sağlayıcı/izin sessiz değiştirilmeyecek. [Resmî browser yapılandırması](https://docs.openclaw.ai/tools/browser/configuration) ve kurulu `dist/chrome-D7PwFEoa.mjs:assertBrowserNavigationAllowed` bu sınırların kaynağıdır.

## Kurulum ve kontroller

```powershell
node scripts/jarvis-quick-config.mjs
node scripts/jarvis-policy-config.mjs --check "$env:USERPROFILE/.openclaw-jarvis/openclaw.json"
npm run check
npm test
npm run test:quick:windows
npm run test:quick:gateway
npm run test:desktop
npm run desktop:build
```

07 config uygulaması yalnız native helper root/tool/browser ayarlarını değiştirir; önceki gerçek profil `openclaw.before-stage07.json` olarak repo dışında korunur. Helper yolu snapshot paketinin göreli yolundan çıkarılmaz: host config'teki sabit `nativeRoot` kullanılır ve bu kaynaklar runtime yazmasından korunur. Python runtime yoksa belge aracı durur; otomatik kurulum veya cloud/ücretli fallback yoktur. FURY kaynak/ayar/state/ses kurulumu değiştirilmez.
