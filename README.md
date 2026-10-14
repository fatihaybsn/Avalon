# Avalon (JARVIS)

Windows 11'de doğrudan çalışan, OpenClaw merkezli kişisel asistan projesi.
Tek merkez **OpenClaw Gateway**, konuşma tarafı **Gemini Live**, ağır görev
modeli **Space Bunny Free**'dir. Mevcut durum: **13'e kadar kod uygulandı; 11–13 ses/araç/onay bağlantısının canlı kabulü ve Codex/OpenCode üç promptlu ortak canlı kabul henüz yapılmadı**
(Gateway, görev izinleri, salt okunur araştırma, yerel GUI node'u ve sade Electron/Vite/Lit arayüzü).
05 ile tek yerel hafıza, kontrollü kısa not araçları, yetkili ortak erişim ve
Gemini ile altı saatlik native Dreaming düzenlemesi eklendi.
06 ile mevcut OpenClaw kayıtlarında kalıcı proje/görev eşlemesi, gerçek host
olaylarından durum, bağımsız iş yönlendirmesi ve kaynak sahipliği eklendi.
07 ile model çağrısı gerektirmeyen Windows menüsü, kimlik doğrulamalı WM_CLOSE,
geri alma kopyası/Çöp Kutusu, yerel belge okuyucuları ve iki ayrı managed browser
profili eklendi. Genel web/login, strict native DNS sınırı nedeniyle hazır değildir.
08 ile hazır OpenClaw Windows node'u, görev kapsamlı CUA ve katalogdan seçilmiş
Windows-MCP okuma/bekleme araçları eklendi. CUA yazması yalnız taze gözlenen
hedefe ve açık background isteğine bağlıdır; SDK teslimi `unknown` raporlayabildiği
için test fixture'ı dışındaki uygulamalarda arka plan garantisi verilmez.
09 ile ayrı kullanıcı hesabına bağlı resmi native Codex işçisi, görev devir
sözleşmesi, olay/diff kaydı, devam/yönlendirme ve native iptal bağlantısı eklendi.
Codex için kullanıcı seçimiyle Full access etkin; bu dosya izolasyonu değildir.
Canlı kabul, 10 sonrasında Codex ve OpenCode ile aynı üç aşamalı not uygulaması
senaryosunda birlikte yapılacaktır; henüz geçtiği iddia edilmez.
10 ile ayrı authenticated OpenCode server'ı, ortak işçi aracı ve Space Bunny'nin
normal OpenCode CLI yönetim rotası eklendi. Çok promptlu proje yönetiminin canlı
kabulü henüz yapılmadı. 11 ile bağımsız, sandboxed Electron ses sahibi ve hazır
Talk/Google Live yolu; 12 ile dar Gemini araçları, güncel görev bağlamı, tek kare
ekran açıklaması ve ses kapalıyken sonuç bildirimi eklendi. Gerçek cihaz/Google
kabulü, bilinen Gateway health/RPC engeli nedeniyle bekler. 13 ile mevcut OpenClaw
onaylarına sesli karar, native işçi soruları, dar izin geri alma ve tek işlem
kanal gönderimi eklendi; gerçek hesap/gönderim kabulü bekliyor. Finansal olumlu
karar sesle açılamaz; ödeme entegrasyonu hazır değildir. Tam kurulabilir dağıtım
16'dadır.

Ayrıntılı mimari: `docs/KESIN_MIMARI.md` · Aşama durumu: `docs/GELISTIRME_DURUMU.md`

## Gereksinimler

- Windows 11, PowerShell 7
- Node.js `>=24.16.0 <25 || >=26.1.0` (doğrulanan: `v24.20.0`; 22/23/25 ve 26.0 desteklenmez)
- npm `11.19.0`, Git
- 08 Windows-MCP yolu için Astral `uv`/`uvx`; kurulum ve paket önbelleği 4d'de.
- Hesaplar: Codex işçisi için uygun ChatGPT/Codex hesabı (girişi kullanıcı yapar), OpenCode (görev modeli), Tavily ücretsiz hesap (araştırma), Google AI Studio (05 Dreaming için gerekli; canlı konuşma 11'de)
- Yerel belge okuma için Python 3.12 ve 4c'deki kütüphaneler; Windows işlemleri ve görsel OCR Python gerektirmez.
- Browser için kurulu Chromium tabanlı Edge/Chrome; Playwright Core mevcut OpenClaw paketinden kullanılır.

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
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | 11–12 Google Live görüşmesi için gerekli; yalnız yazılı kullanımda opsiyonel |
| `JARVIS_DREAMING_GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | 05 Dreaming; seçilmiş hafıza notlarını düzenleyen ayrı anahtar |
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

Dreaming için aynı blokta `OPENCODE_API_KEY` adını tüm yerlerde
`JARVIS_DREAMING_GEMINI_API_KEY` ile değiştirip kendi Google anahtarınızı kaydedin.
Ses aşamasında `GEMINI_API_KEY` için ayrıca uygulayın; Dreaming anahtarı Live
veya mevcut OpenCode hesabının yerine geçmez. Google projesinin ücretsiz
katmanını panelden kontrol edin; faturalandırma/otomatik ödeme açmayın.
[Resmî fiyatlandırmada](https://ai.google.dev/gemini-api/docs/pricing) ücretsiz
görünen model, billing etkin bir projede ücretsiz çağrı garantisi değildir.
Anahtarların değerlerini README'ye, sohbete veya
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
foreach ($name in @('JARVIS_GATEWAY_TOKEN', 'OPENCODE_API_KEY', 'TAVILY_API_KEY', 'JARVIS_DREAMING_GEMINI_API_KEY', 'GEMINI_API_KEY')) {
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
Dreaming anahtarı 05 için gereklidir; yalnız sesin `GEMINI_API_KEY` anahtarı
sesli görüşme kullanılmayacaksa opsiyoneldir. Gerçek profil varsa ayarlar
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
03, 05, 06 ve 07'nin araç, rol, hafıza, browser ve hook sınırlarını uygular. Yalnız Dreaming'e
ayrılan `jarvis-dream-google` sağlayıcısı ve ayrı env SecretRef'ini de kurar;
bu sağlayıcının model listesi aşağıdaki beşli sıraya güncellenir.
Profil önceki aşamadan geliyorsa
yine eklentileri kurup bu politika komutlarını çalıştırın. Projeyi başka klasöre
taşıdığınızda politika betiğini yeniden çalıştırın; plugin yolu yeni konuma bağlanır.

06 için ayrıca servis veya veritabanı kurmayın: aynı politika betiği native
ana ajan ve alt ajan eşzamanlılık sınırını 3 yapar, iki dar çalışma kaydı
aracını açar. Proje/görev geçmişi gerçek profilin mevcut plugin state'inde
`retained` tutulur; geçici test klasörleriyle aynı yerde değildir. Yalnız
06 ayarlarını önceki kurulumunuza eklemek için
`node scripts/jarvis-work-config.mjs` kullanabilirsiniz; ilk profili hazırlayan
bir kurulum betiği değildir. Ayar değişikliğinden sonra Gateway'i kendi
terminalinde `Ctrl+C` ile durdurup 5. adımdan yeniden başlatın.

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

### 4b) Dreaming düzenlemesini hazırlayın

1. adımda `JARVIS_DREAMING_GEMINI_API_KEY` kaydedilmiş, 4. adımda politika
uygulanmış olmalıdır. Native Google bağlantısı OpenClaw'a dahildir;
Gemini için ikinci işçi, veritabanı veya servis kurmayın. Model/anahtar
başvuruları profil hazırlanırken kurulur; anahtar metnini JSON'a yazmayın.

Dreaming yalnız şu metin modellerini bu sırayla kullanır:
**3.8 Flash → 3.6 Flash → 3.5 Flash → 3.5 Flash-Lite → 3.1 Flash-Lite**.
Google'dan kesin yoğunluk/kota/servis hatası dönerse aynı turda sıradakini
dener, ilk geçerli kararda durur. Sonucu belirsiz ağ/zaman aşımı veya
izin/revizyon ihlali otomatik başka çağrıyla aşılmaz. Ana Space Bunny
ve ses modeli değişmez; ücretli-only model veya farklı sağlayıcı yedeği yoktur.

Tek native Memory Core cron'u **00:00 / 06:00 / 12:00 / 18:00** İstanbul
saatinde çalışır (`0 */6 * * *`, `Europe/Istanbul`, stagger 0). Windows
Görev Zamanlayıcı'ya ikinci görev eklemeyin. Otomatik çalışması için Gateway
açık kalmalıdır; masaüstü pencereyi tepsiye gizlemek Gateway'i kapatmaz.
Yalnız Deep açıktır; Light/REM, sessionMemory, session backfill ve ham
sohbet aktarımını açmayın.

Önemli notlar Dreaming'i beklemeden kaynak dosyasına ve yerel aramaya yazılır.
Seçilmiş güncel kısa notlar kaynak/revizyon/tarih/proje referansıyla native
aday olur. Kaynak metadata'sı ve tam metni birlikte 600 karakteri aşan veya
web kaynağından gelen notlar Dreaming adayı yapılmaz; asıl kayıt yine hemen
kaydedilir/aranır. Kaynak kısa not sınırı 1800 karakterdir. Gemini'ye yalnız
seçilmiş adaylar ve bunlarla ilgili sınırlı eski kayıtlar gönderilir; yerel
EmbeddingGemma araması bulut çağrısı değildir. Model kararı host tarafından
denetlenir; görünmeyen kayıtlar veya eski revizyonlar üzerinden yazamaz.
Kalıcı consolidation ve `DREAMS.md` raporunu aynı OpenClaw yazar.

### 4c) Windows, belge/OCR ve browser yolunu hazırlayın

07 için ikinci Windows/voice/MCP paketi kurmayın. Dar Windows araçları mevcut
PowerShell 7 ve Windows API'sini kullanır; OCR, sistemdeki Windows PowerShell
5.1 üzerinden `Windows.Media.Ocr` motoruna bağlanır. Notepad, Calculator ve
Paint'i kullanacaksanız Windows'ta gerçekten kurulu olduklarını kontrol edin.
Eksik uygulama otomatik kurulmaz; yalnız System32 launcher'ının varlığı yeterli
değildir. Güç aracı yalnız cihazda kurulu standart planları seçer.

PDF/DOCX/XLSX/PPTX ve görsel metadata okuyucusu önce bu depodaki `.venv`'i,
yoksa mevcut Codex belge runtime'ını kullanır. Hazır runtime ve gerekli
kütüphaneler varsa ikinci ortam kurmayın. Codex olmayan bilgisayarda
[Python 3.12'nin Windows x64 kurulumunu](https://www.python.org/downloads/windows/)
kendi kullanıcınıza kurup depo kökünde:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r native/windows/document-requirements.txt
.\.venv\Scripts\python.exe -I -c "import pdfplumber, docx, openpyxl, PIL, lxml; print('Belge okuyucuları hazır')"
```

Geliştirici testlerini de çalıştıracaksanız PDF fixture üretimi için
`.\.venv\Scripts\python.exe -m pip install reportlab==4.4.9` komutunu bu aşamada
çalıştırın; uygulamanın belge okuyucusu bu test paketini gerektirmez.

Bu yeni ortam yalnız bu projenin belge kütüphaneleridir; FURY ortamını
kopyalamayın. Activation gerekmez; host interpreter ve helper yolunu sabit
seçer, model exe/shell/config seçemez. `.venv` Git'e alınmaz. Kaynak dosyaları
başka klasöre taşırsanız ortamı orada yeniden oluşturun. Python/kütüphane
eksikliği yalnız ilgili belge işini durdurur; cloud/ücretli fallback yoktur.

OCR dili için Windows **Ayarlar → Zaman ve dil → Dil ve bölge** bölümünde
kullanacağınız dilin seçeneklerindeki **Optik karakter tanıma** bileşenini
kontrol edin; yoksa Windows'un kendi kurulum yoluyla ekleyin. Sistemde kurulu
dilleri şu salt okunur komutla görün:

```powershell
powershell.exe -NoProfile -Command "[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]::AvailableRecognizerLanguages | Select-Object LanguageTag, DisplayName"
```

Bu makinede Türkçe ile gerçek görsel metni doğrulandı. PNG/JPEG/BMP/TIFF ilk
kare OCR desteklenir; taranmış PDF için otomatik dönüştürücü yoktur.
Office formülleri/makroları çalıştırılmaz; eski/makrolu formatlar reddedilir.

İlk profil 4. adımda 07 ayarlarını da alır. Eski profile yalnız 07'yi eklemek
veya helper yolunu yeni depo konumuna bağlamak için Gateway kapalıyken:

```powershell
node scripts/jarvis-quick-config.mjs
node scripts/jarvis-quick-config.mjs --check
node scripts/jarvis-policy-config.mjs --check "$env:USERPROFILE\.openclaw-jarvis\openclaw.json"
```

Önceki ayarlar profil içindeki `openclaw.before-stage07.json` yedeğinde korunur;
başka bilgisayarın bu yedeğini, hesaplarını veya kişisel browser oturumunu
taşımayın. Mevcut Playwright Core yeterlidir; ayrıca Playwright paketi veya
ücretli browser sağlayıcısı kurmayın. `jarvis-visible` (18810, görünür) ve
`jarvis-background` (18811, headless) ayrı yönetilen profillerdir. Port doluysa
sahibini kontrol edin; başka süreci zorla kapatmayın. Görerek yapılacak görev
görünür profilde kalır.

**Browser düzeltmesi sonraya bırakıldı (14 Ekim 2026 kullanıcı kararı):**
OpenClaw 2026.10.2, strict SSRF altında alan adlı gezinmeyi DNS rebinding
koruması eksik olduğundan engeller; incelenen 2026.10.3 paketi de aynı engeli
içerir. Genel site/login/form işleri henüz kullanılamaz. Güvenlik sınırını
kapatmayın, `allowedHostnames` istisnasıyla veya URL'yi IP'ye çevirerek aşmayın.
Native DNS/yönlendirme/ağ çıkışı güvenliği sonraki ayrı düzeltmede doğrulanacak;
bu çözüm tamamlanmadan browser'a bağlı görevler hazır sayılmaz. Dosya/Windows,
OCR ve mevcut salt okunur araştırma yolu bu engelden bağımsızdır. GUI kurulumu
ve kullanım sınırları aşağıdaki 4d ve 5. adımlardadır; tam dağıtım 16'da yapılır.

### 4d) Native Windows GUI node'unu ve sınırlı Windows-MCP'yi hazırlayın

GUI, kullanıcının **etkileşimli Windows oturumunda çalışan hazır OpenClaw
node'u** üzerinden kullanılır. Gateway servisinin tek başına masaüstü erişimi
yoktur. Bu kurulum WSL, Windows Hub, ayrı GUI uygulaması veya ikinci driver
daemon'ı eklemez. Pairing ve OpenClaw araç izinleri açık kalır.

Windows-MCP için Astral `uvx` gerekir. Kurulu değilse resmi WinGet komutunu
çalıştırın; yeni PowerShell açıp sürümü ve paketin ilk indirilmesini doğrulayın:

```powershell
winget install --id=astral-sh.uv -e
uvx --version
uvx --from windows-mcp==0.8.8 windows-mcp --help
```

İlk `uvx` çağrısı internet üzerinden Windows-MCP `0.8.8` paketini önbelleğe
alır; bu komut yalnız yardım ekranını açar, MCP sunucusunu başlatmaz. Gateway
çalışırken ayarlı çağrılar `--offline` kullanır; her araç çağrısı paket
indirmez. `windows-mcp install` komutunu kullanmayın; bu proje servis/zamanlanmış
görev kurmaz. [Astral uv kurulum yönergesi](https://docs.astral.sh/uv/getting-started/installation/).

İlk kurulumda, 4. adım profil ve OpenClaw eklentilerini hazırladıktan sonra,
ayrı native node profilini bir kez oluşturun:

```powershell
node scripts/jarvis-gui-config.mjs --prepare-node
```

Bu `%USERPROFILE%\.openclaw-jarvis-desktop\openclaw.json` oluşturur; tokenı
dosyaya kopyalamaz ve Windows servisi kurmaz. Dosya zaten varsa betik üzerine
yazmayı reddeder; mevcut node ayarını incelemeden silmeyin veya ezmeyin.

### 4e) Native Codex işçisini kurun ve hesabınızı bağlayın

Bu adım 4'teki profil/politika hazırlığından sonra, Gateway başlamadan yapılır.
Çalışan Gateway varsa kendi terminalinde `Ctrl+C` ile normal durdurun; Codex
masaüstü uygulamasını kapatmayın. Resmi eklentiyi seçili OpenClaw sürümüyle
aynı sürüme sabitleyin; `npm ci` profil eklentisini ayrıca kurmaz:

```powershell
.\node_modules\.bin\openclaw.cmd --profile jarvis plugins install @openclaw/codex@2026.10.2 --pin
```

Bu eklentinin managed Codex bağımlılığı stable `0.160.0`'dır. PATH'teki Codex,
masaüstü alpha veya FURY binary'si seçilmez. Aşağıdaki blok yalnız bu profilin
resmi eklenti kurulumundaki Windows binary'sini bulur; belirsizlikte durur:

```powershell
$codexCandidates = @(Get-ChildItem -Path "$env:USERPROFILE\.openclaw-jarvis\npm\projects\openclaw-codex-*\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe" -File -ErrorAction SilentlyContinue)
if ($codexCandidates.Count -ne 1) { throw 'Tek managed stable Codex binary bulunamadı; PATH alternatifi kullanmayın.' }
$codexBinary = $codexCandidates[0].FullName
& $codexBinary --version
```

Beklenen çıktı `codex-cli 0.160.0`'dır. Başka sürüm görünürse devam etmeyin;
ana OpenClaw'ı veya worker modelini kendiliğinden yükseltmeyin. Codex yalnız
seçtiğiniz görevde **Full access** kullanacaktır: terminal/dosya/ağ erişimi
çalışma klasörünün dışına çıkabilir. Bu erişimi seçiyorsanız açık flag ile
ayrı işçiyi hazırlayın, ardından kendi hesabınıza etkileşimli giriş yapın:

```powershell
node scripts/jarvis-codex-config.mjs "$codexBinary" --enable-selected-worker
node scripts/jarvis-policy-config.mjs --check "$env:USERPROFILE\.openclaw-jarvis\openclaw.json"
.\scripts\jarvis-codex-profile.ps1 -Action Login
```

Giriş kodunu/bağlantısını yalnız kendiniz kullanın; credential veya eski state
kopyalamayın. Hesap `jarvis-codex` agent'ında `openai:jarvis-codex` olarak
saklanır. Native Codex home agent kapsamında yönetilir; profil ayrılığı aynı
Windows kullanıcısının bütün dosyalarını izole etmez. Betik binary sürümünü
kontrol eder, eski config'i repo dışında yedekler, native stdio bağlantısını
sabitler, JARVIS/model/Gateway sırlarının ortamdan temizlenmesini ayarlar ve
ana/research araç sınırlarını korur. Flag verilmezse işçi kapalı hazırlanır;
Full access kendiliğinden açılmaz. Genel host exec politikası açılmaz; yeni
serbest command runner, ikinci yürütücü veya ana model kurulmaz.

5. adımda Gateway'i başlatıp `ready` kaydını bekledikten sonra:

```powershell
.\scripts\jarvis-codex-profile.ps1 -Action Check
```

`enabled`, `fullAccessConfigured` ve `authReady` alanları `true` olmalıdır.
`liveTurnVerified:false` henüz gerçek model işi sınanmadığını belirtir.
Kodlama model/düşünme seçimi belirtilmezse Codex için **Luna 6
(`openai/gpt-6-luna`) / xhigh** kullanılır. Açık kullanıcı seçimi önceliklidir;
desteklenmeyen seçimde hata gösterilir, sessiz model/düşünme yedeği yoktur. API anahtarıyla ücretli
veya başka model yedeği yoktur. Codex görev başlatma ayrıca mevcut proje
grant'ına ve yetkili `operator.admin` kullanıcı/cihaz kimliğine bağlıdır;
masaüstünün normal dar sohbet yetkisi bunun yerine geçmez.

Kurulum sonrası eski eklenti instance hatası veya başlangıç reddi olursa,
önce görünen hatayı düzeltin; Gateway'i kendi terminalinde `Ctrl+C` ile
normal durdurup 5'teki betikle yeniden açın. Başlangıç kurtarma beklerken
ikinci Gateway başlatmayın. `taskkill`, genel `doctor --fix` veya Codex
masaüstünü yeniden başlatmak bu kurulumun parçası değildir.

09'un canlı kabulü kullanıcı kararıyla **10 sonrasında** yapılacaktır:
JARVIS aynı basit not uygulamasını Codex ve OpenCode ile ayrı klasörlerde,
üç sonuç odaklı promptla yönetecek; soru, devam/yönlendirme ve iptal de
kontrol edilecektir. [Toplu doğrulama planı](docs/09_10_TOPLU_DOGRULAMA.md)
ve [09 bağlantı sözleşmesi](docs/09_CODEX_ISCISI.md) gerçek sınırları açıklar.
Bu kurulum, 10'un yönetim bağlantısının veya 13'ün sesli karar yolunun hazır
olduğu anlamına gelmez.
### 4f) OpenCode kodlama server'ını ve Space Bunny yönetim rotasını hazırlayın

10 için OpenCode **V2 2.0.28** native Windows CLI gereklidir. `npm ci`, aynı
sürümün hafif `@opencode/client` istemcisini kurar; native CLI ayrıca kurulur.
Mevcut CLI varsa önce `opencode --version` ile kontrol edin; 2.0.28 ise
tekrar kurmayın. Eksikse kendi kullanıcı kurulumunuzda:

```powershell
npm install -g @opencode/cli@2.0.28
opencode --version
```

In-process `@opencode/sdk`, C++ derleme/Visual Studio veya ikinci host runtime
bu bağlantıya gerekli değildir. `OPENCODE_API_KEY` 1. adımda kendi kullanıcı
ortamınızda kayıtlı olmalıdır; eski auth/state dosyası kopyalanmaz.

Native binary yolunu belirleyin; aşağıdaki standart npm kurulum yolunu kendi
bilgisayarınızda kontrol edin. Başka klasöre kurduysanız gerçek `.exe` yolunu
verin; başka sürüm veya FURY binary'sine düşmeyin:

```powershell
$opencodeBinary = Join-Path (npm root -g) '@opencode/cli/bin/opencode.exe'
if (-not (Test-Path -LiteralPath $opencodeBinary -PathType Leaf)) { throw 'Native OpenCode binary yolunu doğrulayın.' }
& $opencodeBinary --version
node scripts/jarvis-opencode-profile.mjs prepare "$opencodeBinary" --full-access
node scripts/jarvis-worker-config.mjs --full-access
node scripts/jarvis-policy-config.mjs --check "$env:USERPROFILE\.openclaw-jarvis\openclaw.json"
```

Bu açık flag, **OpenCode kodlama işçisi için Full access seçiminizdir**:
çalışma klasörü dışında dosya/ağ erişimi mümkün olabilir. Sıradan JARVIS host
shell/research izinleri açılmaz. Ayrı server'ın config/data/cache/state/DB'si
`%USERPROFILE%\.openclaw-jarvis\opencode` içinde olur; eski global OpenCode
server'ı değiştirilmez. Üretilen `server.json` server password ve kendi PID/yol
bilgisini içerir; repoya, sohbete veya başka bilgisayara kopyalamayın.
Provider anahtarı server'a verilir; shell çocuklarına ayrı temiz ortam geçer.
Profil ayrılığı bütün disk dosyalarının OS izolasyonu değildir.

Gateway'den önce ayrı PowerShell 7 penceresinde server'ı başlatın:

```powershell
.\scripts\jarvis-opencode-server.ps1 -Action Start
```

Bu pencere açık kalır; normal durdurma `Ctrl+C`'dir. Server yalnız
`127.0.0.1:18791` adresinde HTTP Basic kimliğiyle çalışır; port doluysa başka
süreci zorla kapatmayın. Başka pencerede gerçek server kimliğini kontrol edin:

```powershell
.\scripts\jarvis-opencode-server.ps1 -Action Check
```

5'te Gateway hazır olduktan sonra:

```powershell
.\node_modules\.bin\openclaw.cmd --profile jarvis gateway call jarvis.worker.setup --json
```

Bu, iki işçiyi ve authenticated OpenCode `2.0.28` / ana
`opencode/space-bunny-free` / `jarvis-opencode-main` rotasını göstermelidir.
Seçili model değişmez; Space Bunny istekleri normal OpenCode CLI/işçi yolundan
geçer. Doğrudan provider model HTTP isteği ve sessiz model/işçi yedeği yoktur.
08'in GUI görüntü/MCP yolu yeniden kurulmaz; Codex 09'un tek native harness'inde
kalır. Model veya native worker unavailable ise durum açık gösterilir.

Kullanıcı görevinde **“Codex ile yap”** veya **“OpenCode ile yap”** seçimini
belirtin; görev kapsamı için mevcut masaüstü klasör seçimini kullanın.
`jarvis_worker` host görev kimliği/kökü/revizyonunu ekler; her küçük işte form
doldurmak gerekmez. Belirsiz/iki işçi içeren seçimde soru gerekir. Model/düşünme alanları atlanırsa **Codex: Luna 6/xhigh**, **OpenCode:
Space Bunny Free/max** kullanılır. Belirtilen kullanıcı seçimi bu varsayılanlardan
önceliklidir. OpenCode seçimleri gerçek server model/variant kataloğuyla denetlenir.
Native işçi sorusu veya izni gerçek pending ID ile bekler; model cevaplamaz.
Yetkili kullanıcı için `jarvis.worker.answer` native once/reject veya form
cevabını taşır. 13'ün sesli karar yolunu aşağıdaki 4h ve 7b ile hazırlayın;
karmaşık/gizli native formlar manuel yüzeyde kalır. Yetkili karar yolu yoksa
bekleme açık gösterilir; model cevaplamaz.

JARVIS sonucu/diff'i isteklerle karşılaştırıp gerektiğinde aynı işe devam veya
düzeltme promptu verir. Üç/beş prompt her işe zorunlu değildir. Kodlama
server'ı kendi teknik oturumlarını tutar; ortak hafızanın sahibi OpenClaw'dır.
Ham kayıt yerleri ve 14 bakım envanteri: [10 bağlantı sözleşmesi](docs/10_OPENCODE_ISCISI.md).
[Codex/OpenCode üç promptlu not uygulaması kabulü](docs/09_10_TOPLU_DOGRULAMA.md)
henüz çalıştırılmadı; kurulum bağlantısı bu canlı proje testinin geçtiği anlamına gelmez.
### 4g) Talk/Google Live ve Gemini dar araç bağlantısını hazırlayın

Sesli kullanım için 1. adımdaki `GEMINI_API_KEY` kendi kullanıcı ortamınızda veya
profil `.env` dosyanızda bulunmalıdır. Ayrı Dreaming anahtarı bunun yerine geçmez.
Google hesabınızın seçili `gemini-3.8-live` modeline erişimini ve hesap/kota
koşullarını kendiniz doğrulayın; anahtarın kayıtlı olması canlı erişim kanıtı değildir.

4. adımda oluşturulan profil hazır Talk yolunu kullanır: Google,
`provider-websocket`, `provider-direct`, `agent-consult` ve `gemini-3.8-live`.
`jarvis-status.ps1` ile kendi profilinizin Talk satırlarını kontrol edin;
başka modele/sağlayıcıya veya Extended Thinking ayarına sessizce geçmeyin.

Gateway'i başlatmadan önce depo kökünde:

```powershell
node scripts/extend-talk.mjs
```

Bu komut yalnız proje-yerel, sabit OpenClaw `2026.10.2` Talk dosyasına JARVIS'in
dar katalog/dispatch bağlantısını ekler. Kaynak sürümü/SHA256 uyuşmazsa durur;
`node_modules` dosyalarını elle değiştirmeyin veya kontrolü atlamayın. Kurulum
makbuzu, bu bilgisayara ait yollarla `node_modules/openclaw/dist/jarvis-talk-extension.json`
içinde oluşur ve Git'e girmez. Kaynak manifest başka bilgisayarın yolu/token'ını taşımaz.
`npm ci` sonrasında komutu tekrar çalıştırın; 5. adımdaki normal Gateway betiği de
aynı kontrolü otomatik yapar. Çalışan Gateway yeni dosyaları otomatik devralmış sayılmaz;
eski kurulumu güncellediyseniz normal kapatma/başlatma sırasında yeni kod yüklenir.

Yeni ses framework'ü, ikinci backend veya ayrı bildirim servisi kurulmaz.
Talk'ın 25 sabit upstream kaynak dosyası repoda korunur; browser bundle'ı 7. adımda
yerel kaynaklardan üretilir. Normal kurulumda kaynakları GitHub'dan tekrar çekmek
veya `vendor-talk.mjs --fetch` çalıştırmak gerekmez. 03 reader, 05 Memory Core ve
06 görev kaydı önceki kurulum adımlarında hazırlanmış olmalıdır.

### 4h) Sesli onay ve dar gönderim yolunu hazırlayın (13)

Önce 4–4g'yi, özellikle 4f'deki ayrı OpenCode profilini hazırlayın. Yeni paket,
karar modeli, onay veritabanı veya ikinci Gateway kurmayın. Mevcut kurulumu
güncelliyorsanız açık işin sonucunu kontrol edin; kendi Gateway ve OpenCode
server terminallerini normal `Ctrl+C` ile durdurun. Depo kökünde:

```powershell
node scripts/jarvis-stage13-config.mjs
```

Komut mevcut `%USERPROFILE%\.openclaw-jarvis\openclaw.json` profiline
`jarvis_send` kataloğunu ve 4f'deki özel OpenCode config'ine dar `jarvis-manager`
agent'ını ekler. Eksik ilk profilin yerine geçmez. Önceki Gateway ayarları aynı
profilde `openclaw.before-stage13.json` olarak bir kez korunur; mevcut yedek
ezilmez. Anahtar, hesap veya cihaz kimliği oluşturmaz/değiştirmez. Başka
bilgisayarın profilini, yedeğini veya `server.json` dosyasını kopyalamayın.

4f'deki `jarvis-opencode-server.ps1 -Action Start` ile OpenCode'u yeniden açın,
ardından 5'te Gateway'i başlatın. Çalışan süreç yeni dosyayı yükledi varsayılmaz.
Normal Space Bunny yöneticisi yalnız görev kapsamındaki OpenClaw MCP araçlarını
kullanır; native agent/session izinleri okunup doğrulanamazsa model turu başlamaz.
Bu ayrım, açıkça seçtiğiniz Codex/OpenCode **kodlama** oturumlarının Full access
terminal/dosya davranışını kaldırmaz. Gerçek mesaj gönderimi veya ödeme görevini
kodlama işçisine vermeyin; Full access işletim sistemi izolasyonu değildir.

Güncellemeden sonra 7'de masaüstünü yeniden derleyin ve cihaz pairing/scope
kontrolünü tamamlayın. `npm ci` veya 4'teki genel profil politikasını yeniden
uyguladıysanız sırasıyla 4f–4h'yi de yeniden uygulayın; 4g'deki Talk uzatmasını
atlamayın. Hesap/kanal bağlantısı ve sesli kullanım aşağıdaki 7b'dedir.

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

Dreaming yapılandırmasını aynı çalışan Gateway'de kontrol edin:

```powershell
.\node_modules\.bin\openclaw.cmd --profile jarvis gateway call jarvis.memory.dreaming.status --json
.\node_modules\.bin\openclaw.cmd --profile jarvis cron list --json
```

Durumda `configuredModel: jarvis-dream-google/gemini-3.8-flash` ve beşli
`modelSequence` görünmelidir. Cron listesinde tek Memory Core Dreaming işi ve
yukarıdaki saatler olmalıdır; farklıysa ikinci cron eklemeyin. İlk kurulumda
`idle` ve `published: false` normaldir. Gerçek seçilmiş aday/model/native yazma
sonrası `native-published` ve `published: true` yalnız o Gateway çalışmasında
gözlenen turu doğrular; yeniden başlatmada önceki başarı canlı kanıt diye
üretilmez. Kalıcı kaynaklar ve native raporlar workspace'te kalır.

İlk GUI pairing'i için 4d'de hazırlanan node'u **yeni, etkileşimli PowerShell
penceresinde** başlatın; bu pencere native node çalıştığı sürece açık kalır:

```powershell
cd C:\yol\Avalon
.\scripts\jarvis-desktop-node.ps1
```

Ayrı bir terminalde yalnız bekleyen gerçek `JARVIS Windows Desktop` isteğini
inceleyip onun gerçek `requestId` değeriyle onaylayın. Ardından bağlı node
durumundan 64 karakterli gerçek `nodeId` değerini alın:

```powershell
.\node_modules\.bin\openclaw.cmd --profile jarvis nodes pending --json
.\node_modules\.bin\openclaw.cmd --profile jarvis nodes approve <requestId>
.\node_modules\.bin\openclaw.cmd --profile jarvis nodes status --connected --json
```

`<requestId>` ve `<nodeId>` yer tutucudur; yalnız inceleyip doğruladığınız
değerleri kullanın. Pairing'i atlamayın. Ana Gateway'i kendi penceresinde
`Ctrl+C` ile durdurun; ana profile değişiklik uygulamadan önce bir kere yedek
alın, sonra GUI ayarını ve profil politikasını doğrulayın:

```powershell
$profileConfig = Join-Path $env:USERPROFILE '.openclaw-jarvis\openclaw.json'
$backup = "$profileConfig.before-stage08-$(Get-Date -Format yyyyMMdd-HHmmss)"
if (Test-Path -LiteralPath $backup) { throw 'Yedek zaten var; üzerine yazmayın.' }
Copy-Item -LiteralPath $profileConfig -Destination $backup
node scripts/jarvis-gui-config.mjs --apply <nodeId>
node scripts/jarvis-policy-config.mjs --check $profileConfig
```

Sonra 5. adımdaki `jarvis-gateway.ps1` ile Gateway'i yeniden başlatın. Native
node penceresini kapatmayın; Gateway'e yeniden bağlanır. Genel GUI varsayılanı
OpenClaw CUA'dır: her yazma güncel pencere/öğe gözlemi ve açık background
isteği ister. Belirsiz sonuçta aynı pencere yeniden okunur, eylem körlemesine
tekrarlanmaz ve foreground'a sessiz geçiş yapılmaz. Kontrollü fixture yazma ve
readback doğrulandı; SDK `deliveryMode: unknown` bildirebildiğinden başka
uygulamalarda background teslim garantisi yoktur. Windows-MCP aynı Gateway'e
stdio ve sabit `0.8.8` paketiyle bağlanır; seçilmiş gerçek katalogdan yalnız
gözlem/bekleme kullanılır, MCP'nin tıklama/yazma araçları kapalıdır. İkinci
browser, genel dosya/PowerShell/Registry ve process araçları açılmaz.

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

`npm test` 57 testi çalıştırır; gerçek Tavily/Gemini hesabına çağrı yapmaz.
07 testleri yerel Windows cihazını ve test dosyaları üzerindeki native recycle/OCR
yolunu kullanır. Belge fixture üretimi için ayrıca `reportlab` gerekir; ayrıntı 8'dedir.
Gateway testi ayrı geçici profilde gerçek onay kayıtlarını ve dosya etkisini
kontrol eder: deny/allow-always yazmaz, allow-once sabit parametrelerle yazar.
Test kendi Gateway sürecini ve başarılı profilini kapatıp temizler. Bellek
yükünü artırmamak için önce ana Gateway'i kendi terminalinde `Ctrl+C` ile
durdurun; test bitince 5. adımdan yeniden başlatın. Test ana
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
11–13 görüşmesi için cihazın `operator.talk`, onay/soru yolu için
`operator.approvals` ve `operator.questions` yetkileri gerekir; istemci ayrıca
mevcut `operator.read` / `operator.write` kapsamlarını kullanır. Eski eşleşmenin
grant'ı kendiliğinden genişletilmez. Eksik scope/pairing hatasında `devices list`
ile gerçek yeni isteği inceleyip yukarıdaki aynı `devices approve <requestId>`
yolunu kullanın; genel admin yetkisi açmayın, token'ı rastgele değiştirmeyin.

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
Aktif görüşmede 13'ün sesli karar yolu kullanılır; manuel kararlar mevcut yetkili
OpenClaw onay istemcisindedir. Kullanım ve sınırlar 7b'dedir.

06 çalışma görünümü aynı sağ paneldedir. İstek normal gönderildiğinde native
run ve kalıcı görev kaydı birlikte ilişkilendirilir. Devam eden işe yön vermek
için panelde o görevi seçip **Bu göreve ilet** kullanın; ayrı uzun iş için
**Bağımsız iş başlat** yeni native alt ajan oturumu açar. Yeni iş eski işi
iptal etmez; her iş kendi klasör/yetki kapsamıyla çalışır. Modelin önerdiği
planı **Bu planı kabul et**, asıl sonucu **Güncel çıktı** ile alın. İptal
yalnız seçili görevin native run'ına gider. Desteklenmeyen pause gösterilmez.

İletildi/kabul edildi/uygulanıyor/uygulandı farklı durumlardır; araç sonucu ile
gerçek dosya etkisi ayrıca gösterilir. Model açıklaması host kanıtı değildir.
Görev görünümü imzalı/eşleşmiş Electron cihazını gerektirir; yalnız token ile
genel CLI çağrısının reddedilmesi bu kimlik sınırının parçasıdır. Restart
sonrasında eski yetki veya shell devam etmiş sayılmaz; belirsiz iş yeniden
gönderilmez. Kaynak kaydı ve native durum uzlaştırılır. Ayrıntılar:
[06 çalışma kaydı](docs/06_CALISMA_KAYDI.md).

07'nin **Hızlı Windows işlemi** menüsü aynı sağ paneldedir. Ses durumunu
okuma, ses/mute/medya ve kurulu güç planı seçimi model çağrısı olmadan yapılır.
Uygulama işlemi için Notepad/Calculator/Paint'i seçin; **Pencereleri oku**
ile güncel hedefleri alın, birden fazla pencere varsa doğru pencereyi seçin.
Host hedefi PID + başlangıç zamanı + exe + HWND ile yeniden doğrular; eski
hedef token'ı 60 saniye sonra yenilenmelidir. Kapatma normal `WM_CLOSE` ister;
"kapatma istendi" ile "kapandı" ayrıdır. Kaydetme penceresi çıkarsa karar sizindir.
Kapatma için host'un sunduğu tek işlem sorusu aktif görüşmede sesle
yanıtlanabilir; görüşme kapalıysa mevcut yetkili OpenClaw kontrolünde manuel
allow-once/deny kullanın. Ayrı bir model erişimli onay düğmesi eklenmedi.

`jarvis_document`, `jarvis_draft` ve `jarvis_recycle` exact görev/klasör kapsamıyla
mevcut Gateway araçlarıdır; bu aşamada masaüstünde ayrı belge/silme düğmesi
yoktur. Draft `.txt` nota yazılır, yalnız `show:true` açık isteğinde Notepad'de
gösterilir. Olağan proje düzenlemeleri `.jarvis-undo` içinde geri alma kopyasını
korur. Silme native Çöp Kutusu ile ve tek işlem onayıyla yapılır; bilinmeyen
kapasite/korunan hedefte kalıcı silmeye düşmez. Scope/RPC ve browser'ın boş sekme
→ exact tab navigate sözleşmesi: [07 dar işlemler](docs/07_DAR_ISLEMLER.md).

X pencereyi **tepsiye gizler**; uygulamayı veya Gateway'i kapatmaz. Tepside
**JARVIS’i göster** yeniden açar; **Uygulamadan çık** istemciyi kapatır.
Gateway ayrı terminalde çalışmaya devam eder. Bağlantı kesilince son gözlem
güncel olmayabilir; **Kayıtları yenile** ile uzlaştırın. **Sonuç belirsiz**
gönderim otomatik tekrar edilmez; sonucu kontrol etmeden aynı işi yeniden
göndermeyin.

Space Bunny'nin normal OpenCode CLI rotası 10'da bağlandı; üç promptlu canlı
proje kabulü henüz yapılmadı. Aşağıdaki doğrudan çağrıya ilişkin bilinen `403`
kararı korunur. 11–12 kodu ve çevrimdışı testleri hazırdır; gerçek Gateway,
Google token/cihaz sesi ve ekran/bildirim kabulü tamamlanmış sayılmaz.

### 7a) Sesli görüşme ve dar araçları kullanın (11–12)

Bağlı bir sohbet seçip bu bilgisayarda **Görüşme aç** kontrolünü kullanın.
Mikrofon/hoparlör cihazını seçebilir, mikrofonu susturabilir veya yalnız mevcut
yanıtın oynatmasını kesebilirsiniz. Görüşmeyi tamamen bitirmek, o görüşmeden
başlatılan işlerin native iptalini ister; başka yazılı/bağımsız işleri iptal etmez.
Pencereyi tepsiye gizlemek veya görünür arayüzü yenilemek görüşmeyi bitirmez.
Varsayılan kısayol `Control+Alt+Space`; çakışıyorsa arayüzden değiştirin.
Boşta otomatik kapanma varsayılan kapalıdır; isteğe bağlı süre yerel ayarda tutulur.
Gelen Gateway olayı, telefon iletisi veya bildirim bilgisayardaki mikrofonu açamaz.

Gemini ilgili hafıza notunu, güncel host görev kaydını ve asıl çıktıyı doğrudan
okur; kısa not/düzeltme ve dar Windows işlemleri için ağır modele ihtiyaç duymaz.
Dosya/kodlama işi vermeden önce **Görev klasörü seç** ile gerçek hedefi seçin.
Yeni bağımsız görev mevcut işi değiştirmez. Yeni koşulun iletilmesi, kabul edilmesi
ve uygulanması ayrı gösterilir; sonucu belirsiz eylemi yeniden göndermeyin.

Kısa araştırmada yalnız açık public sorgu kullanın: örneğin `araştır: ...`.
Reader özel sohbet/hafıza bağlamını almaz; Tavily Advanced/ücretsiz hesap ayarı
6. adımın aynısıdır. Araçtan dönen bulgu/link kullanıcı onayı veya tercihi değildir.
Link göstermek için açık URL'yi veya dönen kaynak referansını belirtin.
`birebir oku` asıl görünür çıktıyı getirir; eksik/kesilmiş çıktı açık belirtilir.

`ekrana bak` tek ekranın bir karesini; `pencere: tam pencere adı` seçili pencerenin
tek karesini mevcut Google Live girişine aktarır. Birden fazla ekran/pencere
eşleşiyorsa önce hedef netleştirilir. Sürekli ekran akışı, kamera zorunluluğu,
yeni vision modeli veya kalıcı screenshot klasörü yoktur.

Electron çalışırken sesli görüşme kapalıysa yeni tamamlanan iş için sessiz Windows
bildirimi gösterilir. Bildirime tıklamak ilgili işi/çıktıyı açar; mikrofon açmaz ve
işlemi onaylamaz. Windows bildirimleri engelliyorsa sonucu **Güncel çıktı** üzerinden
okuyun; native kayıt kaybolmaz. Okunmamış UI işareti uygulama ömrüne aittir.
Uygulama tamamen kapalıyken bağımsız bildirim servisi çalışmaz.

Bu adımlar canlı kabulün yerine geçmez. Gateway health/RPC yanıt vermiyorsa
önceki testleri/model çağrılarını tekrar tekrar çalıştırmayın; bağlantı erişilebilir
olduğunda gerçek görüşme, tek kare ve notification kabulünü ayrıca yapın.
Son düzeltmeler ve sınırlar: [11–12 uygulama notları](docs/11_12_UYGULAMA_NOTLARI.md).

### 7b) Sesli onay, işçi soruları ve gerçek kanal hesabı (13)

4h hazırlığı, 5'in çalışan Gateway'i ve 7'nin yetkili masaüstü cihazı gerekir.
7a'dan görüşmeyi açın. JARVIS gerçek son hedefi, hesabı/alıcıyı, içerik/eki veya
komut/yolu ve görev/revizyon/istek/süre bilgisini sunar. Sorunun seslendirilmesi
bittikten sonra yeni bir mikrofon sözüyle açıkça **evet/onaylıyorum**, **hayır**
veya **iptal** deyin. Önceki turun eveti, sessizlik ve modelin “onaylandı” demesi
işlem açmaz. Birden fazla istek sırayla sunulur; belirsiz/koşullu cevap yeniden
sorulur. Hedef, içerik veya görev revizyonu değişirse yeni onay gerekir.

Codex/OpenCode kodlama sırasında native soru/izin istediğinde aynı yoldan size
sunulur; olağan terminal ve geliştirme işlemleri tekrar soru gerektirmez.
Seçenek sorusunda seçeneğin tam adını, serbest alanda **yanıt ...** diyerek
cevabınızı söyleyin. Çoklu seçimde seçenekleri tek tek söyleyip **bitti** deyin.
Gizli, harici kaynaklı veya koşullu/dinamik alanlar native manuel forma bırakılır;
model sizin yerinize seçenek/default işaretlemez. OpenCode'da bir native izin
isteğini reddetmek aynı oturumdaki diğer bekleyen izinleri de reddedebilir.
Süre dolumu, iptal veya native isteğin çözülmesi sonrası eski cevap gönderilmez.

“Bu görevde hangi izinlerin var?” ile mevcut grant'ları sorabilirsiniz.
“Dosya iznini kaldır” yalnız tek uygun grant varsa uygulanır; çoklu görevde
önce listelenen görevi netleştirin. İzin kaldırmak yapılmış gönderimi geri almaz
ve çalışan alt süreçlerin tamamının durduğunu kanıtlamaz; görev iptali ayrıdır.

**Kanal/hesap kurulumu otomatik değildir.** Bu repo sizin WhatsApp/e-posta
hesabınızı veya oturumunuzu içermez. Kullanacağınız kanalın mevcut OpenClaw
tarafında desteklenen eklentisini ve kendi hesabınızı onun native kurulum/giriş
yoluyla bağlayın; genel browser/terminal ile gönderim kısayolu oluşturmayın.
Desteklenmeyen sağlayıcı için bu adımda hazır bağlantı sözü verilmez.
Gateway hazır olduktan sonra salt okunur kanal durumunu inceleyebilirsiniz:

```powershell
.\node_modules\.bin\openclaw.cmd --profile jarvis gateway call channels.status --json
```

Çıktıda gerçek gönderen hesap yapılandırılmış/bağlı görünmeli ve alıcı native
konuşma/dizin yolunda çözülebilmelidir. Kendi hesap bilgisini başkasıyla veya
repoyla paylaşmayın. Aynı adlı kişi ya da birden fazla hesap eşleşiyorsa tam
alıcı/hesabı sesle netleştirin. “Ali'ye gönder” görev isteğidir; son hesap,
alıcı, metin ve ek hazırlandıktan sonra ayrıca **tek gönderim onayı** istenir.
Ek gönderecekseniz önce 7'de görev klasörünü seçin; yalnız bu izin altındaki
tek normal dosya, en çok **8 MiB**, sabit byte kopyası/SHA256 ile desteklenir.
Ek değişirse yeniden onay gerekir. Hesap yoksa araç bağlantıyı eksik bildirir.
Native kabul/queued cevabı teslim edildi anlamına gelmez; belirsiz sonucu
aynı gönderimi tekrarlayarak çözmeye çalışmayın. Gelen mesaja otomatik cevap
yetkisi açılmaz.

Satın alma/bağlı ödeme için olumlu karar **manuel** kontrolden gelmelidir;
sesle reddetme/iptal mümkündür. Hazır bir ödeme entegrasyonu açılmadı.
Somut finansal etkiyi donduramayan genel browser click/type kapalıdır;
bekleyen native onay/soru varken model GUI girdisi de durur. JARVIS kendi
onay kontrolünü model aracılığıyla kullanmaz. Sesle sunulamayan uzun önizleme
ve manuel kararlar için mevcut OpenClaw kontrol panelindeki native onayı
inceleyin; güvenlik sınırını kapatmayın.

13'ün çevrimdışı sınır testleri geçti; gerçek Gateway/Talk/mikrofon, native
işçi sorusu ve sizin kanal hesabınızın gönderimi henüz canlı kabul edilmiş
değildir. Bilinen Gateway health/RPC sorunu sürerken bu yolları hazır
varsaymayın veya aynı dış işlemi yeniden denemeyin. Güncel kanıt ve eksikler:
[13 uygulama kaydı](docs/GELISTIRME_DURUMU.md#13--uygulama-ve-dar-doğrulama-15-ekim-2026).

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
npm run test:live
npm run test:decisions
```

Belge fixture'larını çalıştıracak geliştirici, 4c'de oluşturduğu ortam için
`.\.venv\Scripts\python.exe -m pip install reportlab==4.4.9` kullanmalıdır;
bu yalnız test PDF üretimi içindir. Mevcut Codex runtime'ında zaten bulunuyorsa
yeniden kurmayın. Masaüstü testi 18 IPC/session/stream/pairing/reconnect/görev
sınır kontrolüdür; gerçek modele çağrı yapmaz. 57 host testiyle birlikte 75
test vardır. `test:live` ayrıca 12'nin 8 host ve 3 Talk sınır testini, ilgili 10 Codex
işçi testiyle birlikte çalıştırır; Talk uzatmasını ve browser bundle'ını yerel olarak
hazırlar. `test:decisions`, 13'ün sesli karar/kimlik/izin/gönderim ve ilgili native
işçi/manager sınırlarını kapsayan **35 çevrimdışı test** çalıştırır; bazı Codex
testleri `test:live` ile ortaktır, sayılar birbirine eklenmez. Hesap veya canlı
modele çağrı yapmaz. Gerçek Gateway/Google/Tavily/worker görevi başlatmaz. Fiziksel cihaz ve
Windows bildirimi bu sentetik kontrollerle doğrulanmış sayılmaz. Çalışan JARVIS Gateway'ine karşı Electron
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

06'nın gerçek native kayıt/yönlendirme kontrolü için önce ana Gateway'i kendi
terminalinde durdurun, ardından `npm run test:work:gateway` çalıştırın.
Test ayrı geçici profilde kayıt kalıcılığı, gerçek dosya etkisi, tekrar olay,
stale yönlendirme, bağımsız alt ajan kabulü ve reload sonrası tekrar dispatch
olmamasını denetler. Test profili başarılı ağır model cevabı üretmez; açık
native hata başarı sayılmaz. Sonra ana Gateway'i 5. adımdan tekrar başlatın.
Başarılı test kendi profilini temizler; başarısız denemelerin geçici dosyaları
repo kökündeki ignored `tmp` altında kalabilir. Bu klasör kullanıcı profilinin
yerine geçmez; test çıktıları Git'e alınmaz.

07'nin ayrı kontrolleri:

```powershell
npm run test:quick:windows
npm run test:quick:gateway
```

Windows testi yalnız kendi Win32 penceresinde minimize/restore/normal close ve
kaydetme bekleme ayrımını kontrol eder. Gateway testi ayrı geçici profilde yerel
araç/onay/kalıcı kayıt ve iki browser profilini doğrular; başlatmadan önce ana
Gateway'i kendi terminalinde durdurun, sonra 5'ten yeniden başlatın. Görünür test
browser penceresi açabilir; kendi küçük test dosyaları Çöp Kutusu'na gider.
Alan adı engelinin beklendiği gibi reddedilmesi web/login başarısı sayılmaz.

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

Aşağıdaki genel ana model değiştirme örneği Codex dış işçisi kurulumu değildir.
09 için 4e'yi kullanın; Space Bunny ana modelini değiştirmeyin.

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
- Dreaming: yukarıdaki `gateway call jarvis.memory.dreaming.status --json` ile durumunu görün. Gateway açıkken altı saatte bir seçilmiş güncel notları Gemini ile düzenler; yeni önemli notları kaydetmek için bu saati beklemeyin. Ham sohbeti hafızaya kopyalamayın; seçici fiziksel unutma ve ham kayıt ömrü 14. adımdadır.
- Çalışma kaydı (06): Electron sağ paneli mevcut native run/session ile retained proje/görev kaydını gösterir. **Bağımsız iş başlat**, fresh native subagent session açar; **Bu göreve ilet**, **Bu planı kabul et**, **Güncel çıktı** ve exact iptal seçili göreve gider. Normal sohbet veya başka sohbet seçimi mevcut işi iptal etmez. Ayrıntılar: [06 çalışma kaydı](docs/06_CALISMA_KAYDI.md). Mevcut profile yalnız 06 ayarlarını eklemek için `node scripts/jarvis-work-config.mjs`; native entegrasyon testi `npm run test:work:gateway`. Pause bu native yolda desteklenmez.
- Dar işlemler (07): sağ panelde **Hızlı Windows işlemi**; belge/OCR, kontrollü not ve recycle için [07 sözleşmesi](docs/07_DAR_ISLEMLER.md). Browser'ın alan adı/login engeli kullanıcı kararıyla ileride çözülecek; hazır kabul etmeyin.
- GUI (08): Gateway'e ek olarak etkileşimli Windows node penceresi açık olmalıdır; `.\scripts\jarvis-desktop-node.ps1` komutunu 5. adımda anlatıldığı gibi çalıştırın. Tarayıcı sayfa işlemlerinde managed Playwright, genel Windows arayüzünde CUA varsayılandır. CUA görev ve taze hedef gözlemiyle sınırlıdır; Windows-MCP yalnız gözlem/bekleme sağlar. SDK teslimi `unknown` raporlayabildiğinden başka uygulamalarda background yazma garantisi yoktur.
- Codex (09): `.\scripts\jarvis-codex-profile.ps1 -Action Check`; ayrı hesap/native işçi bağlantısı. Canlı Codex/OpenCode kabulü 10 sonrasındadır. Model/işçi sessiz değiştirilmez; native sorunun sesli kullanıcı yolu 4h/7b'de hazırlanır, canlı kabulü bekler.
- İşçiler (10): önce `.\scripts\jarvis-opencode-server.ps1 -Action Start`; Gateway açıkken `gateway call jarvis.worker.setup --json`. Kullanıcının Codex/OpenCode seçimi korunur; gerçek sonuç incelemesi ve native devam/iptal aynı görevde yapılır.
- Başlat: `.\scripts\jarvis-gateway.ps1` · Durdur: `Ctrl+C`
- Masaüstü geliştirme: `npm run desktop:dev`
- Derle/çalıştır: `npm run desktop:build`, ardından `npm run desktop:start`
- Native Windows x64 klasörü: `npm run desktop:pack:win` → `apps/desktop/release/win-unpacked/JARVIS.exe`
- Arayüz (Gateway çalışırken): `http://127.0.0.1:18789/`
- Tanı: `.\node_modules\.bin\openclaw.cmd --profile jarvis doctor --lint`

## Güvenlik

- Sırlar (`OPENCODE_API_KEY`, `GEMINI_API_KEY`, `JARVIS_DREAMING_GEMINI_API_KEY`, `TAVILY_API_KEY`, `JARVIS_GATEWAY_TOKEN`) yalnız
  kullanıcı ortam değişkenlerinde veya repo dışı profil `.env` dosyasında durur; repoda, prompt'ta, log'da olmaz.
  Şablon: `config/jarvis.env.example`.
- Olağan proje yazmaları görev kapsamıyla yürür; başka hedef için ek izin gerekir.
  Kritik onay yalnız allow-once/deny ve sabit parametrelerle mevcut OpenClaw
  kayıtlarından geçer. Modele genel resolver/config aracı verilmez. Shell, UAC,
  genel kalıcı silme ve force-kill ana JARVIS yolunda kapalıdır; satın alma/ödeme henüz açılmadı.
- Kullanıcının seçtiği Codex veya OpenCode kodlama görevi Full access ile terminal/dosya/ağ kullanabilir;
  proje klasörü OS izolasyonu değildir. Görev kimliği/grant ve before-tool relay
  korunur; JARVIS sonucu inceler. Ayrı profil ve ortam temizliği bütün disk sırlarına erişimi engellemez.
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

03 izin eklentisi, 05 yerel hafıza, 06 retained çalışma kaydı ve 08 sınırlı Windows GUI yolu uygulanmıştır. Sınırlar ve gerçek test kanıtı: [03 yetki sınırları](docs/03_YETKI_SINIRLARI.md), [06 çalışma kaydı](docs/06_CALISMA_KAYDI.md), [geliştirme durumu](docs/GELISTIRME_DURUMU.md). Kontroller: `npm run check`, `npm test`, `npm run test:gateway`, `npm run test:work:gateway`. Resmî Tavily Advanced + web_fetch yapılandırıldı; gerçek Advanced API erişimi doğrulandı ([güvenli kurulum](docs/TAVILY_KURULUM.md)). Genel web_search kapalıdır. 13'ün sesli onay/native işçi sorusu ve dar gönderim bağlantısı uygulanmıştır; `npm run test:decisions` çevrimdışı kontrolüdür, gerçek ses/hesap/gönderim kabulü bekler.

```
apps/desktop/ Electron main/preload, Vite + Lit renderer, seçili lisanslı upstream dosyaları
config/    jarvis.openclaw.json, jarvis.env.example, windows-mcp-tools.json (Windows-MCP kataloğu)
scripts/   profil hazırlama, politika uygulama, maskeli Tavily anahtarı, erişim kontrolü, başlatma/durum
plugins/jarvis/gui-policy.ts CUA hedef/eylem sınırı ve Windows-MCP katalog guard'ı
scripts/jarvis-gui-config.mjs, jarvis-desktop-node.ps1 GUI profili, pairing sonrası yapılandırma ve başlatma
native/windows/ sabit Windows API/recycle/OCR yardımcıları ve yerel belge okuyucusu
plugins/   jarvis (public SDK görev kapsamı/hook, native araştırma ve onay sınırı)
tests/     politika/okuyucu ve yalnız geçici Gateway'e yüklenen onay fixture
docs/      KESIN_MIMARI.md, GELISTIRME_DURUMU.md, gelistirme plani, kaynak proje kaydi
```
