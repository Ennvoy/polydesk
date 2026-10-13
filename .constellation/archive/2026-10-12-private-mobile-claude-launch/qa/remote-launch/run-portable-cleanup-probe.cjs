const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const project = 'C:/polydesk-remote-dev';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-portable-cleanup-probe-'));
const qa = 'C:/Users/ennvoy.lin/Documents/polydesk-dist/qa-v0.40.0';
const mode = process.argv[2];
assert(['red', 'green'].includes(mode));
const { patchPortableTemplate } = require(path.join(project, 'build/portableBuilder.js'));
const patched = patchPortableTemplate(fs.readFileSync(path.join(project, 'node_modules/app-builder-lib/templates/nsis/portable.nsi'), 'utf8')).replaceAll('\r\n', '\n');
const tail = patched.slice(patched.lastIndexOf('  SetOutPath $EXEDIR\n'));
assert(tail.endsWith('SectionEnd\n') || tail.endsWith('SectionEnd'));
const compiler = path.join(process.env.LOCALAPPDATA, 'electron-builder/Cache/nsis/nsis-3.0.4.1/makensis.exe');
const lockerSource = `param([string]$Target,[string]$Ready,[int]$Hold)\n$lockStream = [System.IO.File]::Open($Target,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read)\ntry { [System.IO.File]::WriteAllText($Ready,'ready'); Start-Sleep -Milliseconds $Hold } finally { $lockStream.Dispose() }\n`;
const lockerFile = path.join(root, 'lock.ps1'); fs.writeFileSync(lockerFile, lockerSource);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const evidence = { root, mode, startedAt: new Date().toISOString(), cases: [], error: null };
async function runCase(name, hold, preserve) {
  const work = path.join(root, name); const target = path.join(work, 'app');
  fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, 'image.bin'), 'owned simulated image mapping');
  const source = path.join(work, 'probe.nsi'); const exe = path.join(work, 'probe.exe');
  fs.writeFileSync(source, `Unicode True\nSilentInstall silent\nRequestExecutionLevel user\nOutFile "${exe}"\nSection\n  StrCpy $INSTDIR "${target}"\n  StrCpy $R6 ${preserve ? 1 : 0}\n  StrCpy $0 ${preserve ? 1 : 0}\n  SetErrorLevel $0\n${tail}`);
  cp.execFileSync(compiler, ['/V2', source], { windowsHide: true, stdio: 'pipe' });
  let locker; let lockerExit;
  try {
    if (hold) {
      const ready = path.join(work, 'ready');
      locker = cp.spawn('powershell.exe', ['-NoProfile', '-File', lockerFile, '-Target', path.join(target, 'image.bin'), '-Ready', ready, '-Hold', String(hold)], { windowsHide: true, stdio: 'ignore' });
      locker.once('exit', code => { lockerExit = code; });
      const deadline = Date.now() + 15000;
      while (!fs.existsSync(ready) && Date.now() < deadline) { if (lockerExit !== undefined) throw new Error('Locker exited before ready'); await sleep(20); }
      assert(fs.existsSync(ready), 'lock must be established');
    }
    const start = Date.now();
    const result = await new Promise((resolve, reject) => { const child = cp.spawn(exe, [], { windowsHide: true, stdio: 'ignore' }); child.once('error', reject); child.once('exit', code => resolve({ code, ms: Date.now() - start, removed: !fs.existsSync(target) })); });
    evidence.cases.push({ name, holdMs: hold, preserve, ...result });
    if (mode === 'red') { assert.equal(result.code, 0); assert.equal(result.removed, false, 'old cleanup should reproduce false success'); }
    else if (preserve) { assert.equal(result.code, 1); assert.equal(result.removed, false); }
    else if (hold > 5000) { assert.equal(result.code, 1); assert.equal(result.removed, false); assert(result.ms >= 4800 && result.ms < 12000); }
    else { assert.equal(result.code, 0); assert.equal(result.removed, true); }
  } finally {
    if (locker && lockerExit === undefined) { const deadline = Date.now() + 15000; while (lockerExit === undefined && Date.now() < deadline) await sleep(20); if (lockerExit === undefined) throw new Error('Owned locker did not finish'); }
  }
}
(async () => {
  try {
    await runCase('temporary-lock', 1800, false);
    if (mode === 'green') { await runCase('retry-exhausted', 6500, false); await runCase('preserve', 0, true); }
  } catch (error) { evidence.error = error.stack; process.exitCode = 1; }
  finally { evidence.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(qa, 'portable-cleanup-probe-' + mode + '.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2)); }
})();
