# Managed by Avalon; Hermes source and config are not modified.
import json, os, subprocess, sys, time
from pathlib import Path
c = json.loads(Path(__file__).with_suffix('.json').read_text(encoding='utf-8'))
s = json.loads(Path(c['stateFile']).read_text(encoding='utf-8'))
flags = (subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP) if os.name == 'nt' else 0
env = dict(os.environ)
env.update(c.get('env', {}))
if len(sys.argv) > 1 and sys.argv[1] == '--avalon-worker':
    # An OS-owned lock is released even if the supervisor crashes. The native
    # scheduler dispatch can return promptly; its 1h script timeout does not
    # bound a 2h research run. Research state owns the actual completion status.
    lock_path = Path(c['lockFile']) if c.get('lockFile') else Path(c['stateFile']).with_name('supervisor.lock')
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock = open(str(lock_path), 'a+b')
    try:
        if os.fstat(lock.fileno()).st_size == 0:
            lock.write(b'0'); lock.flush()
        lock.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        Path(c['stateFile']).with_name('last-skip.json').write_text(json.dumps({'reason':'already_running','at':int(time.time()*1000)}))
        lock.close()
        sys.exit(0)
    error_file = Path(c['stateFile']).with_name('dispatch-error.json')
    try:
        with open(c['logFile'], 'ab') as log:
            result = subprocess.run([c['executable'], c['runner'], '--schedule', c['stateFile'], '--occurrence', sys.argv[2]], env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    except Exception:
        error_file.write_text(json.dumps({'at':int(time.time()*1000),'error':'Avalon arka plan çalıştırıcısı başlatılamadı. Uygulama yolunu kontrol et.'}))
        lock.close()
        sys.exit(1)
    if result.returncode:
        error_file.write_text(json.dumps({'at':int(time.time()*1000),'error':'Avalon arka plan çalıştırıcısı hata ile kapandı. Son çalışma kaydını kontrol et.'}))
    elif error_file.exists():
        error_file.unlink()
    lock.close()
    sys.exit(result.returncode)
from cron.jobs import get_job
j = get_job(s['nativeId']) or {}
claim = j.get('fire_claim') or {}
occurrence = claim.get('by') or claim.get('at') or j.get('next_run_at')
if not occurrence:
    raise RuntimeError('Scheduled occurrence identity unavailable')
with open(c['logFile'], 'ab') as log:
    subprocess.Popen([sys.executable, __file__, '--avalon-worker', str(occurrence)], env=dict(os.environ), stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=flags, start_new_session=os.name != 'nt', close_fds=True)
print(json.dumps({'queued': True, 'scheduleId': s['id']}))
