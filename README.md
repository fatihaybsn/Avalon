# Avalon (JARVIS)

Windows 11'de doğrudan çalışan, OpenClaw merkezli kişisel asistan projesi.
Tek merkez **OpenClaw Gateway**, konuşma tarafı **Gemini Live**, ağır görev
modeli **Space Bunny Free**'dir. Mevcut durum: **04. aşama yazılı istemci tamamlandı**
(Gateway, görev izinleri, salt okunur araştırma ve sade Electron/Vite/Lit arayüzü).
05 ile tek yerel hafıza, kontrollü kısa not araçları ve yetkili ortak erişim eklendi.
Başarılı ağır görev/yanıt entegrasyonu OpenCode işçisiyle 10'da, canlı ses 11'de,
sesli onay 13'te; tam kurulabilir dağıtım 16'dadır.

Ayrıntılı mimari: `docs/KESIN_MIMARI.md` · Aşama durumu: `docs/GELISTIRME_DURUMU.md`

## Gereksinimler

- Windows 11, PowerShell 7
- Node.js `>=24.16.0 <25 || >=26.1.0` (doğrulanan: `v24.20.0`; 22/23/25 ve 26.0 desteklenmez)
- npm `11.19.0`, Git
- Hesaplar: OpenCode (görev modeli), Tavily ücretsiz hesap (araştırma), Google AI Studio (konuşma, 11. adıma kadar gerekmez)

## Kurulum (sıfırdan)

```powershell
git clone https://github.com/fatihaybsn/Avalon.git
cd Avalon
npm ci
npm ci --prefix apps/desktop
```

`npm ci` proje-yerel OpenClaw `2026.10.2` sürümünü kurar (bütünlük kilitli).
Global kurulum yapılmaz, mevcut kurulumların üstüne yazılmaz.
`npm ci --prefix apps/desktop` masaüstünün ayrı kilitli bağımlılıklarını kurar:
Electron `44.7.0`, Vite `8.3.1`, Lit `3.3.3` ve TypeScript `6.0.3`.
Komutları bundan sonra depo kökünde çalıştırın; yönetici terminali veya WSL gerekmez.
İlk masaüstü çalıştırmasında Electron'un resmî Windows binary'si indirilebilir;
internet erişimi gerekir. `node_modules`, `dist` ve `release` Git'e alınmaz:
başka bilgisayarda bağımlılıkları kurup uygulamayı yeniden derleyin.

### 1) API anahtarları (kendi bilgisayarınızda, repoya girmez)

| Anahtar | Nereden | Ne için |
|---|---|---|
| `OPENCODE_API_KEY` | [opencode.ai/auth](https://opencode.ai/auth) | Görev modeli kataloğu |
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | 11. adımdaki ses (şimdilik opsiyonel) |
| `TAVILY_API_KEY` | [app.tavily.com](https://app.tavily.com/) | Salt okunur Advanced araştırma; ücretsiz plan |

OpenCode anahtarını komut geçmişine yazmadan kaydetmek için PowerShell 7'de:

```powershell
$secretInput = Read-Host 'OPENCODE_API_KEY' -AsSecureString
$secretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretInput)
try {
  $secretValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPtr)
  [Environment]::SetEnvironmentVariable('OPENCODE_API_KEY', $secretValue, 'User')
  $env:OPENCODE_API_KEY = $secretValue
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr)
  $secretInput.Dispose()
  $secretValue = $null
}
```

Google anahtarı gerektiğinde aynı blokta `OPENCODE_API_KEY` adını tüm yerlerde
`GEMINI_API_KEY` ile değiştirin. Anahtarların değerlerini README'ye, sohbete veya
repo dosyalarına yazmayın. Tavily için hazır maskeli giriş yardımcısını kullanın:

```powershell
.\scripts\set-tavily-key.ps1
```

Tavily panelinde ücretsiz planı koruyun; ücretli abonelik, otomatik ödeme veya
Pay-as-you-go açmayın. Aramalar daima **Advanced** kullanır; Advanced isteği
2 kredidir. Hesabın planını ve kalan kotasını panelden kontrol edin.

### 2) Gateway token'ı üretin

Bu işlem yalnız ilk kurulum içindir. Mevcut kullanıcı token'ını veya eşleşmiş
cihaz kimliğini her çalıştırmada değiştirmeyin. Aşağıdaki blok kullanıcı kaydı
varsa onu korur; yoksa yeni token üretir ve değerini ekrana yazmaz:

```powershell
$token = [Environment]::GetEnvironmentVariable('JARVIS_GATEWAY_TOKEN', 'User')
if ([string]::IsNullOrWhiteSpace($token)) {
  $token = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
  [Environment]::SetEnvironmentVariable('JARVIS_GATEWAY_TOKEN', $token, 'User')
}
$env:JARVIS_GATEWAY_TOKEN = $token
$token = $null
```

Zaten profil `.env` dosyasıyla çalışıyorsanız oradaki mevcut token'ı koruyun;
bu blokla ikinci bir token üretmeyin. Profildeki `${JARVIS_GATEWAY_TOKEN}`
başvurusunu gerçek token metniyle değiştirmeyin; masaüstü aynı kullanıcı
başvurusunu doğrular.

### 3) Yeni PowerShell açın ve doğrulayın

```powershell
cd C:\yol\Avalon
.\scripts\jarvis-status.ps1
```

Anahtar satırları kullanıcı kaydı, bu süreç ve profil `.env` varlığını ayrı gösterir.
Kullanıcı ortamına saklandıysa hem kullanıcı kaydı hem bu süreç `PRESENT` olmalı;
yalnız kullanıcı kaydında varsa terminali/onu başlatan uygulamayı yeniden açın.
Windows Terminal veya Codex gibi üst uygulama eski ortamı taşımaya devam ederse,
kullanıcı kaydındaki mevcut değerleri yalnız bu PowerShell sürecine alın ve
durum kontrolünü yeniden çalıştırın; bu blok sırları yazdırmaz veya değiştirmez:

```powershell
foreach ($name in @('JARVIS_GATEWAY_TOKEN', 'OPENCODE_API_KEY', 'TAVILY_API_KEY', 'GEMINI_API_KEY')) {
  $savedValue = [Environment]::GetEnvironmentVariable($name, 'User')
  if (-not [string]::IsNullOrWhiteSpace($savedValue)) {
    [Environment]::SetEnvironmentVariable($name, $savedValue, 'Process')
  }
}
$savedValue = $null
.\scripts\jarvis-status.ps1
```

Alternatif saklama yolu `%USERPROFILE%\.openclaw-jarvis\.env` dosyasıdır.
Bu alternatifi seçerseniz 4. adımda profil oluştuktan sonra, dosya henüz yoksa
`config/jarvis.env.example` şablonunu bu repo dışı konuma kopyalayın ve bir yerel
editörde kendi değerlerinizi doldurun. Mevcut `.env` dosyasını şablonla ezmeyin;
kullanmadığınız boş anahtar satırlarını kaldırın. Gateway betiği bu dosyayı
yalnız kendi CLI sürecine yükler; masaüstü buradan yalnız Gateway token'ını okur.
Google anahtarı 11. adıma kadar opsiyoneldir. Gerçek profil varsa ayarlar
oradan okunur; yoksa şablon açıkça `TEMPLATE ONLY` olarak gösterilir.
`gateway_health: OK` yalnız kimliği doğrulanan Gateway için gösterilir;
ilk başlatma öncesinde `STOPPED` beklenir. Değerler ekrana yazılmaz.

### 4) Profili hazırlayın ve resmî eklentileri kurun (bir kerelik)

Önce bu bilgisayara ait yolları kullanarak ayrı profili oluşturun. Mevcut
profil varsa korunur; başka bilgisayarın state, kimlik veya anahtarını kopyalamayın.

```powershell
node scripts/init-jarvis-profile.mjs
.\node_modules\.bin\openclaw.cmd --profile jarvis plugins install clawhub:@openclaw/opencode-provider
.\node_modules\.bin\openclaw.cmd --profile jarvis plugins install @openclaw/tavily-plugin@2026.10.2 --pin
node scripts/initialize-jarvis-notes.mjs
node scripts/jarvis-policy-config.mjs
node scripts/jarvis-policy-config.mjs --check "$env:USERPROFILE\.openclaw-jarvis\openclaw.json"
```

Stok pakette Zen sağlayıcısı yoktur (`opencode-go` vardır); resmî Zen eklentisi
bu yüzden ayrıca kurulur. Tavily paketi resmî OpenClaw 2026.10.2 desteğidir;
`npm ci` bu profil eklentilerini kurmaz. Paketler mevcut OpenClaw kurulum yolunu
kullanır; ayrı arama sunucusu kurulmaz. Kurulum veya erişim hatasında durun,
başka paket/sürüm/ücretli sağlayıcıya sessiz geçmeyin.

Politika betiği ilk değişiklik öncesindeki profili repo dışında
`openclaw.before-stage05.json` olarak yedekler. Model/Talk/auth ayarlarını korur;
03 ve 05'in araç, rol, hafıza ve hook sınırlarını uygular. Profil önceki aşamadan geliyorsa
yine eklentileri kurup bu politika komutlarını çalıştırın. Projeyi başka klasöre
taşıdığınızda politika betiğini yeniden çalıştırın; plugin yolu yeni konuma bağlanır.

### 4a) Yerel hafıza modelini kurun

Aynı ayrı `jarvis` profilinde resmî managed llama.cpp eklentisini kurun:

```powershell
.\node_modules\.bin\openclaw.cmd --profile jarvis plugins install clawhub:@openclaw/llama-cpp-provider --pin
.\node_modules\.bin\openclaw.cmd --profile jarvis models auth login --agent main --provider llama-cpp --method local
node scripts/jarvis-policy-config.mjs --check "$env:USERPROFILE\.openclaw-jarvis\openclaw.json"
```

Kurulumda **yalnız embedding-only** yolunu ve EmbeddingGemma'yı kabul edin;
chat modeli teklifi varsa reddedin. Resmî eklenti sürümü `2026.10.2` olmalıdır;
farklı sürüm gelirse sözleşmeyi incelemeden devam etmeyin. Kurulum Windows
llama.cpp runtime'ını ve `embeddinggemma-300m-qat-Q8_0.gguf` modelini indirir;
internet ve disk alanı gerekir. Yaklaşık **313,4 MiB model dosyasıdır**;
Windows runtime, RAM/VRAM ve indeks tüketimi buna eklenir. İkinci hafıza
veritabanı/servisi kurmayın. Kaynaklar `%USERPROFILE%\.openclaw-jarvis\workspace`
altında `MEMORY.md`, `USER.md`, `memory/` olur; başlangıç betiği mevcut
notları ezmez. Ham sohbet kopyalama ve sessionMemory kapalı kalır.
Yerel arama başarısızsa buluta veya başka embedding sağlayıcısına geçilmez.

### 5) Gateway'i başlatın

```powershell
.\scripts\jarvis-gateway.ps1
```

Bu pencere açık kalır. Profil `%USERPROFILE%\.openclaw-jarvis` içindedir;
başlangıç mevcut ayarları ezmez. Önce 4. adımı tamamlayın; başlangıç 03
politikasını ve token kimliğini doğrulayamazsa durur. Port doluysa yabancı
süreci kapatmaz, hatayla durur. Kapatmak için `Ctrl+C`.
İlk başlangıç bu makinedeki testte yaklaşık üç dakika sürdü; `ready`/listening
kaydı ve gerçek sağlık kontrolü gelmeden ikinci Gateway başlatmayın. Yalnız açık
port görülmesi, doğru JARVIS Gateway'ine bağlandığınız anlamına gelmez.

İkinci pencerede sağlık kontrolü:

```powershell
.\node_modules\.bin\openclaw.cmd --profile jarvis gateway status
.\node_modules\.bin\openclaw.cmd --profile jarvis gateway health
.\node_modules\.bin\openclaw.cmd --profile jarvis models list --provider opencode --refresh
```

Gateway hazır olduktan sonra aynı kullanıcıya ait ikinci terminalde yerel
embedding ve indeksi doğrulayın:

```powershell
.\scripts\jarvis-memory-status.ps1 -Deep
.\node_modules\.bin\openclaw.cmd --profile jarvis memory index --force --agent main
```

Deep durumda `embeddingProbe.ok: true`, sağlayıcı `local`, FTS ve vektör
indeksinin kullanılabilir olması beklenir. Eksik model/kurulum görünür kalır.
Model kimlikleri ve yerel servis ayarlarını kurulum üretir; başka bilgisayarın
model yollarını veya kimlik/state dosyalarını kopyalamayın.

### 6) Araştırma erişimini ve izin temelini doğrulayın

Tavily anahtarını tanımladığınız yeni terminalde:

```powershell
node scripts/check-tavily-access.mjs
npm run check
npm test
npm run test:gateway
```

Hesap kontrolü resmî araçla **tek gerçek Advanced arama** yapar ve kredi tüketir;
anahtar veya ham sağlayıcı yanıtını yazdırmaz. Başarıda `ok: true`,
`searchDepth: advanced` beklenir; bu sonuç ücretsiz planı veya kalan kotayı
kanıtlamaz. Hata durumunda eksik anahtar, erişim, kota ya da ağ kategorisi
bildirilir; otomatik tekrar veya alternatif sağlayıcı yoktur.

`npm test` 25 sınır testini çalıştırır; gerçek Tavily hesabına çağrı yapmaz.
Gateway testi ayrı geçici profilde gerçek onay kayıtlarını ve dosya etkisini
kontrol eder: deny/allow-always yazmaz, allow-once sabit parametrelerle yazar.
Test kendi Gateway sürecini ve başarılı profilini kapatıp temizler; ana
`jarvis` profiline test resolver'ı eklemez. Tavily'nin resmî paketi önce kurulmuş olmalıdır.

Araştırma yalnız `tavily_search` ve `web_fetch` kullanır. Host aramayı
Advanced, en çok 5 sonuç, general ve ek cevap kapalı olacak şekilde sabitler.
Genel `web_search`, `tavily_extract`, Firecrawl, browser, shell, yazma,
mesaj, otomasyon ve başka ajanla erişim genişletme bu rolde kapalıdır.
URL/query ve özel ağ sınırları host'tadır; fetch yönlendirmeleri kapalıdır.
Kota/erişim hatası aynı araştırma run'ını durdurur. Yeni kullanıcı isteği
kendi kapsamıyla değerlendirilir. [Tavily ayrıntıları](docs/TAVILY_KURULUM.md).

### 7) Masaüstü istemcisini derleyin ve bağlayın

Gateway terminalini açık bırakın. İkinci PowerShell 7 terminalinde depo kökünde:

```powershell
npm run desktop:build
npm run desktop:start
```

Geliştirme sırasında Vite ile arayüzü yenileyerek çalışmak için bunun yerine
`npm run desktop:dev` kullanın. Aynı anda iki masaüstü modu açmayın; ikinci
uygulama örneği mevcut pencereyi gösterir. Geliştirme portu `127.0.0.1:5173`
başka bir uygulamadaysa Vite hata verir; o uygulamayı zorla kapatmayın.
Renderer yenilemesi Gateway bağlantısını yok etmez. Main/preload kodunu
değiştirdiğinizde geliştirme komutunu yeniden başlatın.

İstemci `%USERPROFILE%\.openclaw-jarvis\openclaw.json` içindeki **loopback**,
token ve cihaz kimliği politikasını kullanır. Endpoint/token/model anahtarı
arayüzden girilmez. Başarıda **Bağlı 2026.10.2** görünür. Gateway sürümü bu
istemciye sabittir; yalnız OpenClaw'ı rastgele daha yeni sürüme yükseltmeyin.

İlk cihaz bağlantısı Gateway'in mevcut yerel pairing politikasından geçer.
**Eşleştirme gerekli** görünürse aynı Gateway'i yöneten yetkili terminalde:

```powershell
.\node_modules\.bin\openclaw.cmd --profile jarvis devices list
# Listedeki güncel isteğin cihaz kimliğini uygulamada gösterilen kimlikle karşılaştırın.
# Yalnız incelediğiniz o isteğin gerçek kimliğini aşağıya yazın:
.\node_modules\.bin\openclaw.cmd --profile jarvis devices approve <requestId>
```

`<requestId>` bir yer tutucudur; komuta listedeki gerçek kimliği yazın. Sonra
uygulamada **Yeniden bağlan** seçin. Pairing veya device-auth kontrolünü
kapatmayın. **Kullanıcı bağlantısı gerekli** durumunda kullanıcı token'ını ve
profil başvurusunu kontrol edin; yeni sır tanımladıysanız masaüstünden tamamen
çıkıp yeniden açın. Cihaz private key ve scoped token'ı Windows kullanıcıya
bağlı DPAPI ile `%APPDATA%\jarvis-desktop\device.dpapi` içinde korunur;
bu dosyayı başka bilgisayara/kullanıcıya taşımayın. Dev ve paket aynı kaydı kullanır.

**Yeni sohbet** ile günlük veya proje türünü seçin, başlık verip **Oluştur**'a
basın. Her sohbet aynı JARVIS workspace'inde ayrı geçmişle başlar; ilk açılışta
otomatik sohbet yaratılmaz. Sohbet değiştirmek devam eden görevi iptal etmez.
İleti için Enter, yeni satır için Shift+Enter kullanılır. Çalışan sohbetin yeni
gönderimi mevcut görev bitene kadar kapalıdır; Gateway yönetim slash komutları
bu istemciden çalıştırılmaz.

Dosya görevi için önce **Görev klasörü seç** ile o sohbetin somut hedefini
native diyalogdan seçin. Bu izin, sonraki gönderimde aynı run/task kimliğiyle
mevcut 03 host politikasına bağlanır; korunan dosyalara genel erişim açmaz.
Klasör seçilmezse yalnız dar hafıza araçları için memory kapsamı bağlanır;
genel dosya/web/exec yetkisi verilmez. Klasör seçimi
uygulama ömründe tutulur; yeniden açılışta gerektiğinde tekrar seçin.
Görev ve bekleyen onaylar sağ panelde native OpenClaw kayıtlarından okunur.
04'te onay **görüntülenir**; karar mevcut yetkili OpenClaw onay istemcisindedir.

X pencereyi **tepsiye gizler**; uygulamayı veya Gateway'i kapatmaz. Tepside
**JARVIS’i göster** yeniden açar; **Uygulamadan çık** istemciyi kapatır.
Gateway ayrı terminalde çalışmaya devam eder. Bağlantı kesilince son gözlem
güncel olmayabilir; **Kayıtları yenile** ile uzlaştırın. **Sonuç belirsiz**
gönderim otomatik tekrar edilmez; sonucu kontrol etmeden aynı işi yeniden
göndermeyin.

Bu sürüm gerçek Gateway bağlantısı ve iletinin kabulünü doğrular; başarılı
Space Bunny yanıtı henüz hazır değildir. Aşağıdaki bilinen `403` davranışı ve
10. adımdaki OpenCode işçisi kararı geçerlidir. Canlı ses, mikrofon/oynatma,
sesli onay sonraki aşamalardadır. Ortak hafıza araçları aynı workspace içindeki
yetkili sohbetlerde kullanılabilir; Gemini araç köprüsü 12'ye aittir.

### 8) Windows çalıştırılabilir klasörünü oluşturun ve kontrolleri çalıştırın

Depo kökünde:

```powershell
npm run desktop:pack:win
.\apps\desktop\release\win-unpacked\JARVIS.exe
```

Bu çıktı native Windows **x64** geliştirme paketidir; yönetici/UAC istemez.
Yalnız `JARVIS.exe` dosyasını ayırıp taşımayın: `win-unpacked` klasöründeki
DLL, kaynak ve diğer dosyalar birlikte gereklidir. Her bilgisayarda yukarıdaki
Gateway/profil/hesap kurulumunu kendi kullanıcı kaydıyla tamamlayın; EXE
Gateway'i kurmaz veya başlatmaz. İmzalı installer, otomatik güncelleme ve
tam günlük dağıtım 16. adımda yapılacak.

Yerel tip ve sınır kontrolleri:

```powershell
npm run check
npm test
npm run test:desktop
```

Masaüstü testi 14 IPC/session/stream/pairing/reconnect sınır kontrolüdür;
gerçek modele çağrı yapmaz. 25 policy/reader/Tavily/hafıza testiyle
birlikte 39 sınır testi vardır. Çalışan JARVIS Gateway'ine karşı Electron
kontrolleri için masaüstünden **Uygulamadan çık** seçin, sonra:

```powershell
npm run test:desktop:electron
npm --prefix apps/desktop run test:dev
npm --prefix apps/desktop run test:packaged
```

İlk ve dev testi için `desktop:build`, paket testi için `desktop:pack:win`
önceden çalışmış olmalıdır. Bu testler sırayla pencere açar; sandbox, dar IPC,
navigation/popup engeli, X ile gizlenme ve renderer reload davranışını kontrol
edip kendi istemcisini kapatır. Testler ana Gateway'i kapatmaz.

`npm --prefix apps/desktop run test:live` isteğe bağlı gerçek profil testidir:
iki adlandırılmış test sohbetini oluşturur/korur ve seçili ücretsiz ana modele
bir ileti gönderir. Native klasör diyaloğunun seçimi yalnız testte kontrollü
tmp dizinine taklit edilir; scope bind ve chat send Gateway'de gerçektir.
Sohbetler otomatik silinmez; bu test başarılı model yanıtı iddiası değildir.
04'te gerçek deneme bilinen `403 FreeTierError` ile sonlandı.

Seçili upstream UI dosyalarının kaynak/sürüm/SHA256/MIT kaydı
`apps/desktop/vendor/openclaw/SOURCE.json` ve `LICENSE` içindedir; build kaynak
hash değişikliğinde durur. Tam OpenClaw deposu ürün içine paketlenmez.
Bu kaynakların özgün satır sonları `.gitattributes` ile korunur; Windows'un
otomatik CRLF dönüşümü başka bilgisayarda SHA256 denetimini bozmaz.
Runtime audit'te 0 bulgu, electron-builder geliştirme zincirinde 8 moderate
bulgu kaydedildi; `npm audit fix --force` veya toplu kurulum betiği onayıyla
kilitli sürümleri değiştirmeyin. Ayrıntılar: [04 uygulama kaydı](docs/04_MASAUSTU_ISTEMCISI.md).

## Bilinen önemli davranış: ücretsiz modeller ve 403

`space-bunny-free` gibi ücretsiz katman modelleri OpenClaw içinden çağrıda
`403 FreeTierError` verir ("yalnız OpenCode istemcisinden kullanılabilir").
Bu anahtar bozukluğu değildir. Aynı model OpenCode uygulamasının kendisi
üzerinden çalışır (doğrulandı). Bu yüzden birincil model kayıtta
`opencode/space-bunny-free` durur, yürütmesi 10. adımda OpenCode işçisine
bağlanacak; sessizce ücretli modele geçilmez.

**13 Ekim 2026 kullanıcı teyidi:** OpenCode istemcisi/işçisi üzerinden kullanım bilinçli ve onaylı bağlantı tercihidir. Bu tercih başlangıçtaki doğrudan HTTP hedefini günceller. Sonraki ajanlar 403'ü kurulum arızası veya mimari ihlali sayıp modeli değiştirmemeli, ücretli yedek açmamalı veya çalışan işçi yolunu yeniden yazmamalıdır. Ret sağlayıcının ücretsiz katman kısıtıdır; Gateway araç izni değildir. OpenClaw tek görev/izin/hafıza merkezi olarak kalır; aşamaların gerçek entegrasyon durumu `docs/GELISTIRME_DURUMU.md` içindedir.

## Başka bir sağlayıcı ekleme (ör. OpenAI)

Anahtarınızı OpenAI'dan alıp profilde saklayın (etkileşimli yardımcı sorar):

```powershell
.\node_modules\.bin\openclaw.cmd --profile jarvis models auth login --provider openai
```

Sonra birincil modeli değiştirin (yol değiştirilebilir; yedek zinciri açılmadıkça
sessiz geçiş olmaz):

```powershell
.\node_modules\.bin\openclaw.cmd --profile jarvis config set agents.defaults.model.primary "openai/gpt-5-mini"
```

> Not: bu iki komut bu depoda denenmedi; genel OpenClaw komutlarıdır.
> Geçerli model adını `models list --provider openai --refresh` ile görün.

## Günlük kullanım

- Durum: `.\scripts\jarvis-status.ps1`
- Hafıza durumu: `.\scripts\jarvis-memory-status.ps1 -Deep`. Kısa notlar `memory/records/<UUID>/r<revizyon>.md` altında kaynak ve tarih bilgisiyle tutulur; proje çıktıları ayrı dosyalarda referanslanır. Düzeltme güncel revizyonu ister; çakışmada eski kayıt ezilmez.
- Hafıza araçları: `jarvis_memory_search/get` okur/arar, `jarvis_note_read/write` kısa kayıt okur/yazar. Kullanıcı tercihi/kararı/düzeltmesi hemen kaydedilir; model/web bulgusu ayrı kaynakla tutulur. Araştırma profili kişisel notları başlangıç bağlamı olarak almaz.
- Başlat: `.\scripts\jarvis-gateway.ps1` · Durdur: `Ctrl+C`
- Masaüstü geliştirme: `npm run desktop:dev`
- Derle/çalıştır: `npm run desktop:build`, ardından `npm run desktop:start`
- Native Windows x64 klasörü: `npm run desktop:pack:win` → `apps/desktop/release/win-unpacked/JARVIS.exe`
- Arayüz (Gateway çalışırken): `http://127.0.0.1:18789/`
- Tanı: `.\node_modules\.bin\openclaw.cmd --profile jarvis doctor --lint`

## Güvenlik

- Sırlar (`OPENCODE_API_KEY`, `GEMINI_API_KEY`, `TAVILY_API_KEY`, `JARVIS_GATEWAY_TOKEN`) yalnız
  kullanıcı ortam değişkenlerinde veya repo dışı profil `.env` dosyasında durur; repoda, prompt'ta, log'da olmaz.
  Şablon: `config/jarvis.env.example`.
- Olağan proje yazmaları görev kapsamıyla yürür; başka hedef için ek izin gerekir.
  Kritik onay yalnız allow-once/deny ve sabit parametrelerle mevcut OpenClaw
  kayıtlarından geçer. Modele genel resolver/config aracı verilmez. Shell, UAC,
  genel kalıcı silme ve force-kill kapalıdır; satın alma/ödeme henüz açılmadı.
- Araştırmaya USER/MEMORY/sohbet/anahtar/proje içeriği eklenmez. Web içeriği ve
  okuyucu özeti veri olarak etiketlenir; onay veya kullanıcı emri sayılmaz.
- Eski FURY klasörü proje dışındadır; state/auth Sohbet içe aktarılmaz.
- Electron cihaz private key/token'ı aynı Windows kullanıcıya bağlı safeStorage/DPAPI kaydındadır;
  renderer yalnız dar sohbet işlemleri ve güvenli durum/onay görünümünü alır.

Masaüstünde X tepsiye gizler; tepsi menüsü veya **Uygulamadan çık** ayrı çıkıştır.
Günlük/proje sohbetleri aynı workspace içinde ayrı geçmiş taşır. Eksik pairing açıkça
gösterilir; belirsiz yazma reconnect'te tekrar edilmez. Ayrıntılar ve test sınırları:
[04 masaüstü istemcisi](docs/04_MASAUSTU_ISTEMCISI.md).

## Proje yapısı

03 izin eklentisi, 05 yerel hafıza araçları ve profiller uygulanmıştır. Sınırlar, gerçek test kanıtı ve kapalı bağlantılar: [03 yetki sınırları](docs/03_YETKI_SINIRLARI.md). Kontroller: `npm run check`, `npm test`, `npm run test:gateway`. Resmî Tavily Advanced + web_fetch yapılandırıldı; gerçek Advanced API erişimi doğrulandı ([güvenli kurulum](docs/TAVILY_KURULUM.md)). Genel web_search kapalıdır; sesli onay 13'e aittir.

```
apps/desktop/ Electron main/preload, Vite + Lit renderer, seçili lisanslı upstream dosyaları
config/    jarvis.openclaw.json (Gateway+model+Talk şablonu), jarvis.env.example
scripts/   profil hazırlama, politika uygulama, maskeli Tavily anahtarı, erişim kontrolü, başlatma/durum
plugins/   jarvis (public SDK görev kapsamı/hook, native araştırma ve onay sınırı)
tests/     politika/okuyucu ve yalnız geçici Gateway'e yüklenen onay fixture
docs/      KESIN_MIMARI.md, GELISTIRME_DURUMU.md, gelistirme plani, kaynak proje kaydi
```
