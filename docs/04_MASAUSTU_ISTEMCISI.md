# 04 — sade Windows masaüstü istemcisi

13 Ekim 2026. Yalnız 04 uygulanmıştır. Kaynak `apps/desktop/`.

## Çalıştırma ve native derleme

Proje kökünde:

```powershell
npm ci
npm ci --prefix apps/desktop
# Gateway'i ayrı terminalde, mevcut yetkili kullanıcı ortamı/.env ile başlatın:
.\scripts\jarvis-gateway.ps1
# Geliştirme: Vite renderer + Electron main/preload
npm run desktop:dev
# Derlenmiş istemci
npm run desktop:build
npm run desktop:start
# Windows x64; yönetici yetkisi istemeyen, yerel çalıştırılabilir klasör
npm run desktop:pack:win
.\apps\desktop\release\win-unpacked\JARVIS.exe
```

Gateway Electron tarafından başlatılmaz/kapatılmaz; mevcut tek OpenClaw merkezine
bağlanır. Electron'dan çıkış ayrı, X ile kapatma tepsiye gizlemedir. Tepsi menüsü
pencereyi açar veya uygulamadan çıkar. İkinci örnek mevcut pencereyi gösterir.
Geliştirmede renderer Vite ile yenilenir; main/preload değişikliklerinde geliştirme
komutunu yeniden başlatın. Sıfırdan kurulumda Electron kendi sürümünün resmî native
binary'sini indirir. npm'nin bu paket için izin kaydı `allowScripts` içindedir;
alakasız `electron-winstaller` betiği açılmamıştır.

Windows klasör derlemesi gerçek makinede geçti. Bu bir imzasız geliştirme çıktısıdır;
kurulum sihirbazı, imzalama, otomatik güncelleme ve günlük dağıtım 16'dadır.

## Kaynak ve bağlantı sözleşmesi

- OpenClaw **2026.10.2**, commit
  `b8952d477f0c932d8ddc6da5c89cab5a169b6ff1`; seçili Control UI
  `base.css`, `panel-empty-state.ts`, `text-direction.ts` ve Gateway client
  `device-auth.ts` dosyaları değiştirilmeden tutulur. `vendor/openclaw/SOURCE.json`
  her dosyanın kaynak URL'sini ve SHA256'sını, `LICENSE` tam MIT metnini ve
  copyright'ı korur. Build hash değişikliğinde durur. `OpenClawLitElement` için
  yerel ince Lit adaptörü açıkça işaretlidir. Tam OpenClaw deposu, FURY UI veya
  Python voice kodu ürün içine alınmamıştır.
- Electron **44.7.0**, Vite **8.3.1**, Lit **3.3.3**, TypeScript **6.0.3**,
  ws **8.22.0**, electron-builder **26.15.3** kilitlidir. React/Tauri eklenmedi.
- Protokol **v4**, nonce + server timestamp ile upstream **v3 Ed25519 imzası**.
  Cihaz `openclaw-control-ui`, `mode: ui`, `role: operator` olarak bağlanır.
  İstenen grant yalnız `operator.read/write/approvals`; admin ve pairing yönetim
  yetkisi istemez. Sürüm/build kimliği seçili Gateway ile eşleşir; farklı sürüm
  sessizce kabul edilmez.
- RPC: `sessions.subscribe/list/create`, `sessions.messages.subscribe`,
  `chat.history/send`, mevcut `jarvis.scope.bind`,
  `plugin.approval.list`, `exec.approval.list`, `approval.get`.
  Olaylar: `sessions.changed`, `chat`, approval requested/resolved, tick/shutdown.
  `chat` v4 snapshot/delta/replace semantiği uygulanır; `agent` assistant text
  ayrıca biriktirilmez. Sıra boşluğu, reconnect ve 15 saniyelik salt okunur
  uzlaştırma host kayıtlarını yeniden okur.
- Onay listeleri bu sürümde **array** döndürür. Pending referanslar için canonical
  `approval.get` okunur; renderer yalnız güvenli presentation ve işlem/sohbet/run
  kimliklerini alır. Onay çözme köprüsü eklenmemiştir: 04 yalnız görünüm sağlar;
  insan kararı mevcut yetkili OpenClaw onay istemcisindedir. Sesli karar ve ödeme
  bağlantısı 13'te kalır.

Resmî sözleşmeler: [Gateway auth](https://docs.openclaw.ai/gateway/protocol/auth),
[session control](https://docs.openclaw.ai/gateway/protocol/rpc-session-control),
[events](https://docs.openclaw.ai/gateway/protocol/rpc-bootstrap-and-events),
[approvals](https://docs.openclaw.ai/gateway/protocol/rpc-devices-nodes-and-approvals),
[Electron security](https://www.electronjs.org/docs/latest/tutorial/security).
Kurulu SDK/runtime ve aynı sürüm kaynak şemaları ayrıca incelenmiştir.

## Sohbet, görev ve izin

Günlük ve proje sohbetleri `main` agent'ın aynı JARVIS workspace'inde ayrı
`agent:main:jarvis:<daily|project>:<uuid>` anahtarlarıyla oluşturulur. Sabit
`agent:main:main` bağımlılığı yoktur. `sessions.create` parent/fork/history/cwd,
model/işçi değişikliği veya ilk tur göndermez; ortak hafıza 05'e bırakılmıştır.
İlk bağlanma/reconnect otomatik sohbet yaratmaz. Sohbet seçimi sadece subscribe ve
history okur; abort/reset/steer çağrısı yoktur. Seçili sohbetin son 100 görünür
mesajı ve en fazla 250 KB geçmişi gösterilir; liste ilk 200 görünür ana sohbetle
sınırlıdır. Ham tool/system mesajları renderer'a aktarılmaz; metin Lit tarafından
escape edilir, HTML çalıştırılmaz.

İsteğe bağlı **Görev klasörü seç** native dizin diyaloğudur. Seçili sohbet ve
session incarnation ile ilişkilidir; yeniden oluşturulan session eski klasör
grant'ını devralmaz. Sonraki kullanıcı iletisi için `jarvis.scope.bind`, ardından
aynı run/task/idempotency kimliğiyle `chat.send` yapılır. Hedef kökü, kimlik ve
politika 03 host sınırından geçer; renderer kullanıcı/cihaz kimliği veya genel
dosya yolu RPC'si veremez. Klasör seçilmezse dosya araçları scope olmadan açılmaz.
Gateway yönetim slash komutları bu dar istemcide kapalıdır; admin-only provenance
bayrakları gönderilmez. Uygulama model API anahtarlarını sohbet metnine eklemez.

Görev görünümü `hasActiveRun`, `activeRunIds`, kuyruk bilgisi ve gerçek chat
olaylarından gelir. Gönderimin kabulü, çalışmanın tamamlanması değildir. Gönderim
kimlikleri yalnız app ömründe, en fazla 50 kayıtla tutulur; yeni görev/onay/hafıza
veritabanı yoktur. Belirsiz yazma otomatik yeniden gönderilmez; `chat.history`
`inputRunIds/inputReceipts` ile yalnız kabul kaydı uzlaştırılır. Scope bağlaması
belirsizse chat iletisi hiç gönderilmez. Kapalı/başlangıçta/meşgul/eksik token veya
pairing durumları görünürdür; erişim yokken eski gözlem güncelmiş gibi sunulmaz.

## Electron ve sır sınırı

Gateway bağlantısı, private key ve device token main'dedir. Sabit kullanıcı
profilinden yalnız loopback/token/cihaz-auth politikası doğrulanır. Bootstrap
token yalnız mevcut süreç, kullanıcı profil `.env` dosyası veya Windows'un aynı
kullanıcı `JARVIS_GATEWAY_TOKEN` kaydından okunur. Değer yazdırılmaz, yeni token
üretilmez. `.env` içindeki model anahtarları renderer'a gitmez. Cihaz key/token
`%APPDATA%\jarvis-desktop\device.dpapi` dosyasında Electron safeStorage/Windows
kullanıcı şifrelemesiyle saklanır; adres ve cihaz kimliği doğrulanır. Şifreleme
yoksa plaintext fallback yoktur. Dev ve paket aynı cihaz kaydını kullanır.

Gerçek yerel bağlantı Gateway'in **mevcut direct-loopback otomatik pairing**
politikasıyla, imzalı cihaz ve mevcut yetkili kullanıcı token'ı üzerinden kabul
edildi. Pairing politikası/bypass değiştirilmedi. Manuel pairing gereken ortamda
istemci güncel request/device ID'yi gösterir ve otomatik onaylamaz. Yetkili kullanıcı
aynı sürüm CLI ile `openclaw --profile jarvis devices list`, ardından yalnız
incelediği güncel `devices approve <requestId>` işlemini yapar ve yeniden bağlanır.
Device-token mismatch veya scope hatasında kimlik değiştirme/retry döngüsü yoktur.

Preload tek doğrulanan action kanalı ve güvenli snapshot aboneliği açar.
IPC sender ID, mainFrame, tam renderer origin/path kontrol edilir; bilinmeyen
action ve ek alanlar reddedilir. Shell, keyfî dosya/network/RPC veya approval
resolver kanalı yoktur. Context isolation + sandbox açık; nodeIntegration,
webview ve insecure content kapalıdır. Local `jarvis://app/` protokolü yalnız
paket renderer dosyalarını verir. Navigation/redirect/popup/download/izinler
engellidir; CSP ve renderer ağ filtresi dış içeriği kapatır. Dev'de yalnız sabit
127.0.0.1:5173 Vite origin'i açılır.

Gateway/controller ömrü BrowserWindow'dan bağımsızdır. X, pencere açma ve renderer
reload bunu yok etmez; 11'deki kalıcı ses sahibinin yeri main app ömründedir.
Henüz mikrofon, oynatma, Talk session, ses motoru, bildirim veya animasyon yoktur.

## Gerçek doğrulama ve sınırlar

- `npm run check`, önceki **16** policy/reader/Tavily testi ve **14** desktop/WS
  sınır testi geçti. Desktop testleri: sender/parametre filtresi, sohbet değiştirme,
  gecikmiş geçmiş, session incarnation, tek scope/run kimliği, belirsiz send'in
  tekrar edilmemesi, canonical onay replay'i, v4 stream ve imzalı pairing hatası.
  Fixture anahtar/WS yanıtları gerçek hesap erişimi kanıtı olarak sunulmaz.
- Gerçek Electron + JARVIS 2026.10.2: cihaz admission, session create/list/history,
  iki farklı sohbet, üretim `jarvis.scope.bind`, aynı kimlikte `chat.send` kabulü,
  proje sohbetine geçerken günlük görev devamı, boş proje geçmişi, native onay
  listelerinin okunması ve renderer reload doğrulandı. Native klasör seçimi
  otomasyon testinde kontrollü tmp dizinine taklit edildi; Gateway scope RPC'si
  ve host politikası gerçekti. Test klasörüne dosya yazan model aracı çağrılmadı.
- `tests/electron-live.mjs` elle çalıştırılan gerçek profil testidir: iki açıkça
  adlandırılmış test sohbetini korur ve tek ücretsiz ana model denemesi gönderir.
  Bunlar kullanıcı profilindeki native sohbetlerdir; otomatik silinmez. Test
  çıktısı model cevabının başarıyla üretildiği iddiası değildir.
- Bu testte Gateway iletinin kabulünü doğruladı; seçili ana modelden yanıt
  denemesi mevcut bilinen `403 FreeTierError` politikasıyla sona erdi. Model,
  sağlayıcı, fallback veya OpenCode işçisi değiştirilmedi. OpenCode işçisiyle
  başarılı ağır görev/yanıt entegrasyonu **10'dadır**; 02 yeniden açılmadı.
- Electron uygulamasında ve **paketlenmiş native Windows exe'de** sandbox,
  nodeIntegration kapalı, popup/navigation engeli, X ile gizlenme, yeniden gösterme
  ve reload kontrolleri geçti. **Vite dev modunda** aynı kontroller ve gerçek
  Gateway bağlantısı da geçti. ASAR denetiminde OpenClaw runtime dosyası sayısı
  **0**; upstream LICENSE/SOURCE ve THIRD_PARTY_NOTICES pakette doğrulandı. Komutlar:
  `npm run test:desktop`, `npm run test:desktop:electron`,
  `npm --prefix apps/desktop run test:dev`, `npm --prefix apps/desktop run test:packaged`.
- `npm audit --omit=dev`: **0** runtime bulgusu. Paketleme geliştirme zincirinde
  electron-builder'ın geçişli paketleri için **8 moderate** kayıt vardır; force
  upgrade/downgrade veya toplu script izni uygulanmadı. Dağıtım 16'da tekrar
  değerlendirilmelidir.

05 hafıza, 06 kalıcı görev/olay eşlemesi, 11 canlı ses, 13 sesli onay ve 16 tam
kurulabilir dağıtım yapılmış sayılmaz. 04'ün çıktısı gerçek Gateway bağlantılı sade
Electron yazılı istemcisidir.
