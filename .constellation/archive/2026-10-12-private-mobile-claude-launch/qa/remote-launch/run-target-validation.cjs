const { spawnSync } = require('node:child_process');
const { writeFileSync, appendFileSync } = require('node:fs');
const { join } = require('node:path');
const log = join(__dirname, 'target-validation.log');
const append = process.argv.includes('--lifecycle-fix') || process.argv.includes('--queue-fix');
if (append) appendFileSync(log, `\n${process.argv.includes('--queue-fix') ? 'Queue capacity fix' : 'Lifecycle fix'} validation ${new Date().toISOString()}\n`, 'utf8');
else writeFileSync(log, `Target validation ${new Date().toISOString()}\n`, 'utf8');
const commands = append ? [
  'npm run typecheck',
  'npm test -- src/main/remote/RemoteService.test.ts src/main/remote/TailscaleGateway.test.ts',
  'npm run build',
  'npm run e2e -- e2e/remote-launch.spec.ts',
] : [
  'npm run typecheck',
  'npm test -- src/main/remote/RemoteService.test.ts src/main/remote/TailscaleGateway.test.ts src/main/pty/PtyManager.test.ts',
  'npm run build',
  'npm run e2e -- e2e/remote-launch.spec.ts e2e/onboarding-help.spec.ts e2e/terminal-ai-launch.spec.ts',
];
for (const command of commands) {
  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', command], {
    cwd: join(__dirname, '../../..'), encoding: 'utf8', windowsHide: true, timeout: 600000, maxBuffer: 8 * 1024 * 1024,
  });
  appendFileSync(log, `\nCOMMAND: ${command}\n${result.stdout ?? ''}${result.stderr ?? ''}\nexit=${result.status}; error=${result.error?.message ?? 'none'}\n`, 'utf8');
  process.stdout.write(`${command}: exit=${result.status}\n`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
