import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

// Use OpenClaw's native Serve claim. Never reset, adopt or edit another route.
export function prepareMobile(config, status, serve) {
  if(status?.BackendState!=='Running')throw new Error('Tailscale hesabına bu bilgisayarda giriş yapın.');
  const hostname=status?.Self?.DNSName?.replace(/\.$/,'');
  if(typeof hostname!=='string'||! /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/i.test(hostname))throw new Error('Seçili cihazın özel MagicDNS HTTPS adı gerekli.');
  if(!serve||typeof serve!=='object'||Array.isArray(serve)||Object.keys(serve).length)throw new Error('Mevcut Tailscale Serve/Funnel yapılandırması var veya okunamadı; başka route değiştirilmedi.');
  const c=structuredClone(config),g=c.gateway;
  if(!g||g.bind!=='loopback'||g.auth?.mode!=='token'||!g.auth.token)throw new Error('Mevcut loopback/token Gateway yapılandırması gerekli.');
  if(g.auth.password||g.controlUi?.dangerouslyDisableDeviceAuth||g.controlUi?.allowInsecureAuth||g.controlUi?.dangerouslyAllowHostHeaderOriginFallback)throw new Error('Mevcut auth ayarı dar telefon erişimiyle uyuşmuyor; değiştirilmedi.');
  if(g.tailscale?.mode&&g.tailscale.mode!=='off'&&g.tailscale.mode!=='serve')throw new Error('Mevcut Tailscale modu çakışıyor.');
  if(g.tailscale?.serviceName)throw new Error('Mevcut Service route yönetimi çakışıyor.');
  const origin=`https://${hostname.toLowerCase()}`;
  const origins=g.controlUi?.allowedOrigins??[];
  if(!Array.isArray(origins)||origins.some(o=>typeof o!=='string'||o.includes('*')))throw new Error('Geniş/belirsiz origin listesi var; otomatik değiştirilmedi.');
  g.auth.allowTailscale=false;
  g.controlUi={...g.controlUi,allowedOrigins:[...new Set([...origins,origin])]};
  // `resetOnExit` is a Gateway run flag, not a config key. Writing it here made
  // the whole config fail validation and blocked every Gateway startup. The
  // native Gateway owns its own Serve path on shutdown, so config keeps mode only.
  g.tailscale={...g.tailscale,mode:'serve'};
  return {config:c,origin};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const ts=path.join(process.env.ProgramFiles??'C:\\Program Files','Tailscale','tailscale.exe');
  const read=args=>JSON.parse(execFileSync(ts,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000}));
  try {
    const file=path.join(process.env.USERPROFILE,'.openclaw-jarvis','openclaw.json');
    const original=fs.readFileSync(file,'utf8');
    const prepared=prepareMobile(JSON.parse(original),read(['status','--json']),read(['serve','status','--json']));
    if(process.argv.includes('--apply')) {
      const backup=path.join(path.dirname(file),'openclaw.before-stage15-mobile.json');
      if(!fs.existsSync(backup))fs.writeFileSync(backup,original,{flag:'wx'});
      // Refuse an intervening local config edit; do not overwrite it.
      if(fs.readFileSync(file,'utf8')!==original)throw new Error('Gateway config değişti; işlem uygulanmadı.');
      fs.writeFileSync(file,JSON.stringify(prepared.config,null,2)+'\n');
      console.log('Özel HTTPS için native Serve config hazırlandı. Gateway yeniden başlatılmadı; route açılmadı.');
    } else console.log('Ön kontrol geçti. Uygulama: node scripts/jarvis-mobile-config.mjs --apply');
    console.log('Telefon girişi: '+prepared.origin+' — token yalnız Control UI bağlantı alanına elle girilir; cihaz eşleştirme gerekir.');
  } catch {
    // CLI stderr/config may contain account or credential details.
    console.error('Telefon hazırlığı durdu: Tailscale oturumunu, Serve route çakışmasını ve loopback/token/device-auth ayarlarını kontrol edin. Hiçbir route silinmedi.');
    process.exitCode=1;
  }
}
