'use strict';
const { spawn } = require('node:child_process');
const { createWriteStream, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const cwd = 'C:/polydesk-remote-dev';
const qa = join(cwd, '.constellation/qa/remote-launch');
const reportDir = join(qa, 'idle-cpu-original-repeat');
mkdirSync(reportDir, { recursive: true });
const args = ['test', 'e2e/perf.spec.ts', '--grep', 'REQ-MON-006', '--workers=1'];
const started = Date.now();
const log = createWriteStream(join(qa, 'idle-cpu-original-repeat.txt'));
const child = spawn(process.execPath, [join(cwd, 'node_modules/@playwright/test/cli.js'), ...args], {
  cwd, windowsHide: true, env: { ...process.env, PD_SHOT_DIR: reportDir }, stdio: ['ignore', 'pipe', 'pipe'],
});
const output = data => { process.stdout.write(data); log.write(data); };
child.stdout.on('data', output); child.stderr.on('data', output);
child.on('error', error => { output(String(error)); process.exitCode = 1; log.end(); });
child.on('close', exitCode => {
  const result = { startedAt: new Date(started).toISOString(), args, exitCode, durationMs: Date.now() - started, scope: 'Unmodified original idle CPU case; diagnosis only, not full ship evidence' };
  writeFileSync(join(qa, 'idle-cpu-original-repeat.json'), JSON.stringify(result, null, 2) + '\n');
  output('\nSCOPED RESULT ' + JSON.stringify(result) + '\n');
  process.exitCode = exitCode === 0 ? 0 : 1; log.end();
});
