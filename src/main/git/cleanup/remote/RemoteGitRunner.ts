import { execFile } from 'node:child_process';
import { buildSpawnEnv } from '../../../security/spawnEnv';
import { networkEnv, readEnv, readHardeningArgs, writeEnv } from '../../gitSafeArgs';

const LOCAL_TIMEOUT_MS = 30_000;
const NETWORK_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 16 * 1024 * 1024;

export interface RemoteGitOutput {
  code: number;
  stdout: string;
  stderr: string;
}

export class RemoteGitRunner {
  run(cwd: string, args: string[]): Promise<RemoteGitOutput> {
    return this.invoke(cwd, args, 'read');
  }

  network(cwd: string, args: string[]): Promise<RemoteGitOutput> {
    return this.invoke(cwd, args, 'network');
  }

  write(cwd: string, args: string[], input?: string): Promise<RemoteGitOutput> {
    return this.invoke(cwd, args, 'write', input);
  }

  private invoke(cwd: string, args: string[], mode: 'read' | 'network' | 'write', input?: string): Promise<RemoteGitOutput> {
    return new Promise((resolve) => {
      const child = execFile('git', [...readHardeningArgs(), ...args], {
        cwd,
        env: {
          ...buildSpawnEnv(),
          ...(mode === 'network' ? networkEnv() : mode === 'write' ? writeEnv() : readEnv()),
          GCM_INTERACTIVE: 'Never',
          GIT_NO_LAZY_FETCH: '1',
          LC_ALL: 'C',
          LANG: 'C',
        },
        timeout: mode === 'network' ? NETWORK_TIMEOUT_MS : LOCAL_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: MAX_BUFFER,
        encoding: 'buffer',
      }, (error, stdout, stderr) => {
        resolve({
          code: error ? (typeof error.code === 'number' ? error.code : 128) : 0,
          stdout: stdout.toString('utf8'),
          stderr: stderr.toString('utf8') || (error?.message ?? ''),
        });
      });
      if (input !== undefined) child.stdin?.end(input);
    });
  }
}
