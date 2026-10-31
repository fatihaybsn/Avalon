"""Windows integration tests. Tampering is confined to a disposable TEMP home.

Run with Python 3.12+ on Windows. --installed-home may reuse only an installer-
owned directory underneath TEMP; it never accepts a personal Hermes home.
"""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

parser = argparse.ArgumentParser()
parser.add_argument('--installed-home', type=Path)
parser.add_argument('--avalon-root', type=Path)
parser.add_argument('--report', type=Path)
parser.add_argument('--without-system-git', action='store_true', help='Test the verified portable-Git bootstrap branch')
parser.add_argument('--cache-from', type=Path, help='Reuse only the UV artifact cache of an idle, installer-owned TEMP fixture')
options = parser.parse_args()
PACKAGE = Path(__file__).resolve().parents[1]
TEMP = Path(tempfile.gettempdir()).resolve()
WORK = Path(tempfile.mkdtemp(prefix='Avalon package tests ')).resolve()
TEST_HOME = options.installed_home.resolve() if options.installed_home else WORK / 'Hermes \u00e7 test'
if not TEST_HOME.is_relative_to(TEMP) or TEST_HOME == TEMP:
    raise SystemExit('Tests refuse a Hermes home outside TEMP')
SHELL51 = Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
ENV = {k: v for k, v in os.environ.items() if not k.endswith(('API_KEY', 'AUTH_TOKEN', 'ACCESS_TOKEN'))}
for k in ('HERMES_HOME', 'HERMES_RUNTIME_DIR', 'PYTHONPATH', 'PYTHONHOME', 'VIRTUAL_ENV', '__HERMES_ACTIVATED'):
    ENV.pop(k, None)
ENV.update(PYTHONUTF8='1', PYTHONIOENCODING='utf-8', GIT_TERMINAL_PROMPT='0')
if options.without_system_git:
    ENV['PATH'] = os.pathsep.join(p for p in ENV.get('PATH', '').split(os.pathsep) if not (Path(p) / 'git.exe').is_file())
REPORT = {'platform': sys.platform, 'testHome': str(TEST_HOME), 'results': [], 'providerRequests': 0}

def run(args, timeout=300, cwd=None):
    p = subprocess.run([str(a) for a in args], cwd=cwd, env=ENV, capture_output=True, encoding='utf-8', errors='replace', timeout=timeout)
    return p

def script(name, *args, shell=SHELL51, timeout=300):
    return run([shell, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PACKAGE / 'scripts' / name, *args], timeout=timeout)

def native(*args, timeout=180):
    return run([TEST_HOME / 'avalon-bin/avalon-hermes.exe', *args], timeout=timeout)

def read_env(path):
    return dict(line.split('=', 1) for line in path.read_text(encoding='utf-8').splitlines() if line and not line.startswith('#') and '=' in line)

@contextmanager
def changed_file(path, content):
    path = path.resolve()
    if not path.is_relative_to(TEST_HOME):
        raise AssertionError('Tamper test escaped the disposable home')
    before = path.read_bytes()
    try:
        path.write_bytes(content)
        yield
    finally:
        path.write_bytes(before)

class WindowsPackage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if options.installed_home:
            owner = json.loads((TEST_HOME / 'avalon-install-owner.json').read_text(encoding='utf-8-sig'))
            if not owner.get('release', '').startswith('avalon-hermes-'):
                raise RuntimeError('Not an installer-owned disposable home')
        else:
            if options.cache_from:
                cache_home = options.cache_from.resolve()
                if not cache_home.is_relative_to(TEMP) or not (cache_home / 'avalon-install-owner.json').is_file():
                    raise RuntimeError('Cache reuse requires an installer-owned TEMP fixture')
                import shutil
                manifest = json.loads((PACKAGE / 'compat/hermes/compatibility.json').read_text(encoding='utf-8'))
                TEST_HOME.mkdir(parents=True)
                (TEST_HOME / 'avalon-install-owner.json').write_text(json.dumps({'schemaVersion': 1, 'release': manifest['release'], 'createdUtc': 'test artifact-cache fixture'}), encoding='utf-8')
                # Never transplant an installation, interpreter, venv, source,
                # credentials or PM facts. Only reusable downloaded artifacts.
                shutil.copytree(cache_home / 'cache/uv', TEST_HOME / 'cache/uv')
                REPORT['artifactCacheReused'] = True
            p = script('setup-hermes.ps1', '-HermesHome', TEST_HOME, timeout=5400)
            (WORK / 'fresh-install.log').write_text(p.stdout + '\n' + p.stderr, encoding='utf-8')
            if p.returncode:
                raise RuntimeError('Fresh install failed; inspect ' + str(WORK / 'fresh-install.log'))
        cls.launcher = TEST_HOME / 'avalon-bin/avalon-hermes.exe'
        cls.source = TEST_HOME / 'hermes-agent'
        cls.receipt = json.loads((TEST_HOME / 'avalon-runtime.json').read_text(encoding='utf-8'))
        p = native('--avalon-verify')
        if p.returncode:
            raise RuntimeError('Initial verification failed: ' + p.stderr)
        cls.initial = json.loads(p.stdout)
        cls.git = cls.receipt['git']
        if options.without_system_git and not Path(cls.git).is_relative_to(TEST_HOME / 'tools'):
            raise RuntimeError('The missing-Git test did not select the pinned portable Git')

    def checked(self, p):
        self.assertEqual(p.returncode, 0, (p.stdout + '\n' + p.stderr)[-4000:])

    def rejected(self, p):
        self.assertNotEqual(p.returncode, 0, 'Unsafe/invalid operation was accepted')

    def test_01_source_and_runtime_workspace(self):
        p = native('--avalon-verify'); self.checked(p)
        data = json.loads(p.stdout)
        self.assertEqual(data['contractVersions'], [1, 2])
        self.assertGreaterEqual(data['runtimePythonFilesChecked'], 2479)

    def test_02_windows_51_idempotence_and_key_preservation(self):
        before = (TEST_HOME / '.env').read_bytes()
        p = script('setup-hermes.ps1', '-HermesHome', TEST_HOME, '-SkipGatewayProbe', timeout=300)
        self.checked(p); self.assertEqual(before, (TEST_HOME / '.env').read_bytes())
        token = read_env(TEST_HOME / '.env')['API_SERVER_KEY']
        self.assertTrue(token not in p.stdout + p.stderr, 'Local API secret leaked')

    def test_03_powershell7_reentry(self):
        import shutil
        shell = shutil.which('pwsh.exe')
        if not shell:
            self.skipTest('PowerShell 7 is not installed; Windows PowerShell 5.1 is the required baseline')
        self.checked(script('setup-hermes.ps1', '-HermesHome', TEST_HOME, '-SkipGatewayProbe', shell=shell))

    def test_04_authenticated_websocket_ready(self):
        self.checked(script('verify-hermes.ps1', '-HermesHome', TEST_HOME, '-GatewayProbe'))

    def test_05_independent_updates_are_blocked(self):
        for args in [('update', '--check'), ('pm', 'update', '--check'), ('pm', 'repair')]:
            with self.subTest(command=args):
                p = native(*args); self.assertEqual(p.returncode, 72)
                self.assertIn('updates are disabled', p.stderr)

    def test_06_guard_file_tamper_is_blocked(self):
        p = TEST_HOME / 'avalon-compat/scripts/hermes-runtime.py'
        with changed_file(p, p.read_bytes() + b'\n# tamper test\n'):
            result = native('--avalon-verify'); self.assertEqual(result.returncode, 72)
            self.assertIn('guard/receipt changed', result.stderr)

    def test_07_partial_patch_is_refused_and_preserved(self):
        p = self.source / 'agent/final_reply_request.py'; altered = p.read_bytes() + b'\n# partial patch test\n'
        with changed_file(p, altered):
            self.rejected(native('--avalon-verify'))
            self.rejected(script('setup-hermes.ps1', '-HermesHome', TEST_HOME, '-SkipGatewayProbe'))
            self.assertEqual(p.read_bytes(), altered)

    def test_08_unrelated_source_change_is_blocked(self):
        p = self.source / 'hermes_cli/main.py'
        with changed_file(p, p.read_bytes() + b'\n# unrelated change test\n'):
            self.rejected(native('--avalon-verify'))

    def test_09_workspace_mismatch_is_blocked(self):
        p = Path(self.initial['selectedEnvironment']).parent / 'workspace/agent/turn_final_policy.py'
        with changed_file(p, p.read_bytes() + b'\n# stale workspace test\n'):
            self.rejected(native('--avalon-verify'))

    def test_10_unknown_destination_is_preserved(self):
        target = WORK / 'occupied home'; target.mkdir(); sentinel = target / 'keep.txt'; sentinel.write_text('keep', encoding='utf-8')
        self.rejected(script('setup-hermes.ps1', '-HermesHome', target))
        self.assertEqual(sentinel.read_text(), 'keep')
        self.assertEqual(list(target.iterdir()), [sentinel])

    def test_11_wrong_head_is_refused(self):
        base = self.receipt['baseCommit']
        try:
            p = run([self.git, '-C', self.source, '-c', 'user.name=Avalon QA', '-c', 'user.email=qa@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + str(WORK / 'no-hooks'), 'commit', '--allow-empty', '-m', 'Disposable wrong-revision test'])
            self.checked(p); self.rejected(native('--avalon-verify'))
            self.rejected(script('setup-hermes.ps1', '-HermesHome', TEST_HOME, '-SkipGatewayProbe'))
        finally:
            self.checked(run([self.git, '-C', self.source, 'update-ref', 'HEAD', base]))

    def test_12_application_env_is_merged_without_erasing_keys(self):
        app = WORK / 'Avalon app fixture'; (app / 'electron').mkdir(parents=True)
        (app / 'package.json').write_text('{"productName":"Avalon"}', encoding='utf-8')
        (app / 'electron/main.mjs').write_text('// fixture\n', encoding='utf-8')
        (app / '.env').write_text('GEMINI_API_KEY=QA-NOT-A-REAL-KEY\nIRIS_EVREN_API_KEY=QA-PRESERVE\nCUSTOM_OPTION=keep\n', encoding='utf-8')
        self.checked(script('setup-hermes.ps1', '-HermesHome', TEST_HOME, '-AvalonRoot', app, '-SkipGatewayProbe'))
        env = read_env(app / '.env')
        self.assertEqual(env['GEMINI_API_KEY'], 'QA-NOT-A-REAL-KEY')
        self.assertEqual(env['IRIS_EVREN_API_KEY'], 'QA-PRESERVE')
        self.assertEqual(env['CUSTOM_OPTION'], 'keep')
        self.assertEqual(Path(env['HERMES_BIN']), self.launcher)
        self.assertEqual(env['API_SERVER_KEY'], read_env(TEST_HOME / '.env')['API_SERVER_KEY'])
        self.assertTrue(list((TEST_HOME / 'backups').glob('environment-*.env')))
        REPORT['applicationFixture'] = str(app)

    def test_13_actual_avalon_gateway_client(self):
        import shutil
        node = shutil.which('node.exe')
        if not options.avalon_root or not node:
            self.skipTest('Supply --avalon-root with dependencies installed and Node on PATH')
        p = run([node, PACKAGE / 'tests/test-gateway-client.mjs', options.avalon_root, TEST_HOME], timeout=180)
        self.checked(p)
        REPORT['actualAvalonClient'] = [json.loads(line) for line in p.stdout.splitlines() if line.startswith('{')]

    def test_14_guard_alias_uses_same_runtime(self):
        self.checked(run([TEST_HOME / 'avalon-bin/hermes.exe', '--avalon-verify']))

    def test_15_final_verification_after_restoration(self):
        self.checked(native('--avalon-verify'))

    def test_16_windows_native_argument_quoting(self):
        def literal(text):
            return "'" + str(text).replace("'", "''") + "'"
        arguments = ['a b', 'quote"x', '', 'C:\\trailing\\', 'T\u00fcrk\u00e7e']
        code = 'import json,sys;print(json.dumps(sys.argv[1:],ensure_ascii=True))'
        script_path = WORK / 'argument-quoting.ps1'
        text = 'Import-Module ' + literal(PACKAGE / 'scripts/Avalon.Hermes.Common.psm1') + ' -DisableNameChecking\n'
        text += '$r = Invoke-AvalonProcess -File ' + literal(sys.executable) + ' -Arguments @(' + ','.join(literal(a) for a in ['-c', code, *arguments]) + ')\nWrite-Output $r.Stdout\n'
        script_path.write_text(text, encoding='utf-8-sig')
        p = run([SHELL51, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script_path])
        self.checked(p); self.assertEqual(json.loads(p.stdout), arguments)

    def test_17_guarded_application_start_environment(self):
        if not options.avalon_root:
            self.skipTest('Supply --avalon-root to exercise the actual Electron executable')
        import shutil
        app = WORK / 'Avalon launch fixture'
        for sub in ('electron', 'scripts', 'dist', 'dist-mobile'):
            (app / sub).mkdir(parents=True, exist_ok=True)
        (app / 'package.json').write_text('{"name":"avalon-installer-fixture","productName":"Avalon","type":"module","main":"electron/main.mjs"}', encoding='utf-8')
        native_dist = options.avalon_root / 'node_modules/electron/dist'
        shutil.copytree(native_dist, app / 'node_modules/electron/dist')
        body = "import {app} from 'electron';import path from 'node:path';app.setPath('userData',path.join(import.meta.dirname,'../isolated-profile'));app.disableHardwareAcceleration();console.log(JSON.stringify({home:process.env.HERMES_HOME,bin:process.env.HERMES_BIN,firstPath:process.env.PATH.split(path.delimiter)[0],apiUrl:process.env.HERMES_API_URL,relay:process.env.IRIS_BRAIN_RELAY,transport:process.env.IRIS_HERMES_TRANSPORT}));app.whenReady().then(()=>app.quit());"
        (app / 'electron/main.mjs').write_text(body, encoding='utf-8')
        (app / 'dist/index.html').write_text('fixture', encoding='utf-8')
        (app / 'dist-mobile/index.html').write_text('fixture', encoding='utf-8')
        p = script('start-avalon.ps1', '-HermesHome', TEST_HOME, '-AvalonRoot', app)
        self.checked(p); data = next(json.loads(line) for line in p.stdout.splitlines() if line.startswith('{'))
        self.assertEqual(Path(data['bin']), self.launcher)
        self.assertEqual(Path(data['firstPath']), TEST_HOME / 'avalon-bin')
        self.assertEqual(Path(data['home']), TEST_HOME)
        self.assertEqual(data['relay'], 'true'); self.assertEqual(data['transport'], 'interactive')
        self.assertTrue(data['apiUrl'].startswith('http://127.0.0.1:'))
        REPORT['actualElectronLaunch'] = {'ok': True, 'spacesInApplicationPath': True, 'isolatedProfile': True}

    def test_18_actual_avalon_http_client_and_saved_configuration(self):
        import shutil
        node = shutil.which('node.exe')
        if not options.avalon_root or not node:
            self.skipTest('Supply --avalon-root and Node to test the actual application HTTP client')
        environment = Path(REPORT['applicationFixture']) / '.env'
        p = run([node, PACKAGE / 'tests/test-http-client.mjs', options.avalon_root, TEST_HOME, environment], timeout=150)
        self.checked(p); REPORT['actualAvalonHttpClient'] = json.loads(p.stdout)

    def test_19_relative_application_root_after_set_location(self):
        def literal(value):
            return "'" + str(value).replace("'", "''") + "'"
        app = Path(REPORT['applicationFixture'])
        command = WORK / 'relative-path-test.ps1'
        body = '[IO.Directory]::SetCurrentDirectory(' + literal(TEMP) + ')\nSet-Location -LiteralPath ' + literal(app) + '\n'
        body += '& ' + literal(PACKAGE / 'scripts/setup-hermes.ps1') + ' -HermesHome ' + literal(TEST_HOME) + ' -AvalonRoot . -SkipGatewayProbe\nexit $LASTEXITCODE\n'
        command.write_text(body, encoding='utf-8-sig')
        self.checked(run([SHELL51, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', command], timeout=300))

    def test_20_actual_brain_adapter_uses_managed_python(self):
        import shutil
        node = shutil.which('node.exe')
        if not options.avalon_root or not node:
            self.skipTest('Supply --avalon-root and Node to test the provider adapter')
        p = run([node, PACKAGE / 'tests/test-brain-adapter.mjs', options.avalon_root, TEST_HOME], timeout=90)
        self.checked(p); REPORT['actualBrainAdapter'] = json.loads(p.stdout)

class RecordingResult(unittest.TextTestResult):
    def addSuccess(self, test):
        super().addSuccess(test); REPORT['results'].append({'test': test.id(), 'status': 'passed'})
    def addFailure(self, test, err):
        super().addFailure(test, err); REPORT['results'].append({'test': test.id(), 'status': 'failed'})
    def addError(self, test, err):
        super().addError(test, err); REPORT['results'].append({'test': test.id(), 'status': 'error'})
    def addSkip(self, test, reason):
        super().addSkip(test, reason); REPORT['results'].append({'test': test.id(), 'status': 'skipped', 'reason': reason})

if __name__ == '__main__':
    started = time.monotonic()
    result = unittest.TextTestRunner(verbosity=2, resultclass=RecordingResult).run(unittest.defaultTestLoader.loadTestsFromTestCase(WindowsPackage))
    REPORT.update(ok=result.wasSuccessful(), seconds=round(time.monotonic()-started, 2), testsRun=result.testsRun, failures=len(result.failures), errors=len(result.errors), skipped=len(result.skipped), workDirectory=str(WORK))
    destination = options.report or WORK / 'results.json'; destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(REPORT, indent=2), encoding='utf-8')
    print('Validation report: ' + str(destination))
    raise SystemExit(0 if result.wasSuccessful() else 1)
