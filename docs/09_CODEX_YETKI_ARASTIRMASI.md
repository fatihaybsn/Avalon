# 09 — Codex çalışma klasörü ve yetki araştırması

14 Ekim 2026. Bu kayıt araştırma sonucudur; çalışan görev bağlantısı veya izolasyon doğrulaması değildir.

## Gerçek mevcut durum ve kanıt

- Gerçek `C:\Users\Fatih\.openclaw-jarvis\openclaw.json:356` profilinde `tools.exec.security="deny"`, `ask="always"`; ayrıca tools deny listesinde `exec` bulunuyor. `config/jarvis.openclaw.json:286` aynı politikayı içeriyor. `scripts/jarvis-policy-config.mjs:28` bunu hazırlıyor, `assertPolicy` mevcut tools politikasını beklenenle karşılaştırıyor. Bu nedenle önceki “engelli veya izin listesi” ifadesi belirsizdi: bu profilde mevcut sonuç **deny**.
- `plugins/jarvis/policy.ts` içindeki `evaluate`, görev kökü içindeki read/write/edit erişimini ayrı değerlendiriyor; serbest executable sözleşmesi bağlı olmadığından exec ve native tool türlerini reddediyor. `plugins/jarvis/index.ts:325` bu kararı before-tool hook'una bağlıyor. Bu bütün Windows programlarının komut çalıştırmasını engellemez; OpenClaw/JARVIS araç yolunun sınırıdır. Geliştirme terminali ve native Windows belge yardımcıları ayrı yetkili yollardır.
- Kurulu `@openclaw/codex@2026.10.2` paketindeki `config-0Gxk3_eq.mjs` export `r` gerçek profille çalıştırıldı: `{mode:"deny",security:"deny",ask:"always",touched:true}`. `config-security-KAPScztc.mjs` export `g` bu çıktıyla `AgentHarnessPreflightError: ... effective tools.exec.mode=deny` üretti. Bu native eklentinin gerçek ön kontrolünün salt okunur çağrısıdır; canlı model/görev testi değildir.
- Aynı ön kontrolün bellekteki alternatiflerle sonucu: deny ve allowlist reddedilir; auto ve full kabul edilir. Profil dosyası değiştirilmedi.
- Önemli düzeltme: bu native yolun hiçbir şekilde çalışamayacağı anlamına gelmez. Aynı eklentinin `resolveOpenClawExecPolicyForCodexAppServer({..., permissionMode:"full"})` yolu `{mode:"full",security:"full",ask:"off",touched:true}` üretiyor; ana profil deny kalıyor. `run-attempt-C6-678kR.mjs` seçili native session permission mode'u runtime seçeneklerine iletiyor. Dolayısıyla mevcut native oturum iznini kullanmak aday çözümdür; global ana model exec politikasını açmak zorunlu değildir. Yetkili session/task eşlemesi ve mevcut before-tool guard'ı ayrıca bağlanmalıdır.

## Herhangi bir klasörde çalışma

Çalışma kökü kurulum sırasında Avalon'a sabitlenmemeli. Örneğin `C:\Users\Fatih\Desktop\WebProjesi`, kullanıcı tarafından seçildiğinde ana görevin projectRoot/cwd'si olmalı. JARVIS hedefi ve varsa klasör oluşturmayı belirler; host gerçek yolu ve mevcut kullanıcı görevini doğrular; native Codex thread/turn aynı cwd ile başlar. Başka projeye geçerken yeni kapsam/oturum bağlanır; eski görev izni taşınmaz. “Herhangi bir klasör” Windows ACL/UAC sınırlarını ortadan kaldırmaz.

İki ayrı yetki tercihi vardır:

1. Projede dosya değiştirme ve terminal çalıştırma: native workspace-write/writableRoots seçilen projeyi yazılabilir kılar. Bu proje dışındaki okumaları otomatik kapatmaz.
2. Full access: native danger-full-access sandbox sınırını kaldırır. Cwd başlangıç dizinidir, erişim kafesi değildir. İşçi Windows kullanıcısının erişebildiği diğer dosya/ağ kaynaklarına da ulaşabilir. UAC/admin yetkisi kendiliğinden verilmez. Ayrı Codex profil ve environment temizliği faydalıdır fakat diğer yerel dosyaların okunamayacağını garanti etmez.

Kullanıcı bu takipte Codex'e tam erişim verilmesini ve sonuçların JARVIS tarafından incelenmesini istedi. Bu, ilk 09 promptundaki sandbox zorunluluğu/varsayılan yolo yasağına göre Codex görevleri için yeni bir tercihtir; genel JARVIS/Gemini/araştırma yetkisini açma isteği değildir. Uygulama hedefi, kullanıcının seçtiği Codex görevinde native Full access; genel profil politikasını değiştirmemek, zorunlu host relay'i kaldırmamak, görev dışı araçları açmamak ve yeni backend/brain kurmamaktır. Native onay varsa model tarafından kabul edilmez; gerçek kullanıcı soruları OpenClaw yolunda kalır. Tam erişim ile önceki kesin dosya izolasyonu güvencesi birlikte verilemez.

## Sürüm ayrımı

Gerçek stable `0.160.0` binary'nin ürettiği TurnStartParams şemasında workspaceWrite alanları `writableRoots`, `networkAccess`, `excludeSlashTmp`, `excludeTmpdirEnvVar`, `type`; `readOnlyAccess` yok. Güncel resmi app-server belgesinde restricted read roots ve güncel Windows belgesinde MXC/denied read paths bulunuyor. Bunlar sırf güncel belgede bulunduğu için kurulu sürümde var sayılmadı. Önceki hazırlıkta seçilen unelevated modun resmi belgede denied read paths desteklemediği de açık. Yeni sürüm veya sandbox kurulumu bu araştırmada yapılmadı.

## JARVIS → Codex çalışma talimatının içeriği

Bu, runtime'a henüz bağlanmamış 09 görev devir taslağıdır; geliştirme AGENTS.md'sine persona eklenmez, genel 10 akışı başlatılmaz.

> Kullanıcının hedefini ve seçtiği projectRoot'u belirle. request, purpose, scope, context, output ve verification alanlarını eldeki görev bağlamından tamamla; kullanıcıya rutin form doldurtma. Görevi karşılayan en küçük yeterli planı hazırla ve Codex'e gönder. Codex, kabul edilmiş hedef içinde dosya düzenleme, terminal, gerekli Git/bağımlılık işlemleri ve testleri her küçük adımda soru sormadan yürütür. Eksik bilgi sonucu gerçekten değiştirecekse, plan çelişiyorsa veya kapsam değişecekse durup somut soruyu bildirir. Teknik plan sorusunu JARVIS kayıtlı gereksinimden yanıtlayabilir; kullanıcının tercihi veya gerçek izin/onay gerekiyorsa kullanıcıya iletir. Yeni prompt izni veya kullanıcı onayı yerine geçmez. Çıktıda değişen dosyaları/diff'i, yapılan ilgili doğrulamayı ve kalan engeli bildir. JARVIS sonucu hedefle karşılaştırır, gerekiyorsa aynı göreve devam/yönlendirme gönderir. Native turn/completed yalnız yürütmenin bitişidir; hedefin karşılandığını kanıtlamaz. İptal native interrupt ile gider, kalan süreçlerin durduğu bilinmiyorsa tam iptal denmez.

İyi hazırlanmış prompt ve sonradan sonuç incelemesi hata ihtimalini azaltır; işletim sistemi erişim sınırının yerine geçmez. Kod/dış dosya içeriği de modele ulaşır, yalnız JARVIS promptu etkili değildir.

## Kaynaklar

- [OpenClaw native approval/sandbox](https://docs.openclaw.ai/plugins/codex-harness-reference/approval-and-sandbox)
- [OpenClaw app-server transport](https://docs.openclaw.ai/plugins/codex-harness-reference/app-server-transport)
- [Resmi Codex Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox)
- [Resmi Codex app-server](https://learn.chatgpt.com/docs/app-server)

Bu araştırmada runtime/config değişmedi. Hesap girişi, gerçek görev devir/olay/kimlik/continue/steer/interrupt bağlantısı ve gerçek erişim testleri henüz tamamlanmadı; 09 hazır değildir.
