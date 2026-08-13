import { execFile as nodeExecFile, type ExecFileException, type ExecFileOptionsWithBufferEncoding } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { readEnv, readHardeningArgs } from '../../gitSafeArgs';
import { writeEnv } from '../../gitSafeArgs';
import { buildSpawnEnv } from '../../../security/spawnEnv';

const MAX_BUFFER = 64 * 1024 * 1024;
// 完整預檢會在 Windows Defender / 冷磁碟下平行啟動多個唯讀 Git；沿用一般 10 秒會把
// 暫時啟動延遲誤判成 capability/state unknown，讓同一份 repo 的 lease 不穩定。
const CLEANUP_LOCAL_TIMEOUT_MS = 30_000;

export interface CleanupGitOutput {
  code: number;
  stdout: string;
  stderr: string;
}

export type CleanupGitExec = (
  file: string,
  args: readonly string[],
  options: ExecFileOptionsWithBufferEncoding,
  callback: (error: ExecFileException | null, stdout: Buffer, stderr: Buffer) => void,
) => ChildProcess;

const defaultExec: CleanupGitExec = (file, args, options, callback) => nodeExecFile(file, args, options, callback);

export class CleanupGitRunner {
  constructor(private readonly exec: CleanupGitExec = defaultExec) {}

  run(cwd: string, args: string[], allowFailure = false): Promise<CleanupGitOutput> {
    return this.invoke(cwd, args, { allowFailure, write: false });
  }

  write(cwd: string, args: string[], input?: string, allowFailure = false): Promise<CleanupGitOutput> {
    return this.invoke(cwd, args, { allowFailure, write: true, input });
  }

  private invoke(
    cwd: string,
    args: string[],
    request: { allowFailure: boolean; write: boolean; input?: string },
  ): Promise<CleanupGitOutput> {
    return new Promise((resolve, reject) => {
      const execOptions: ExecFileOptionsWithBufferEncoding = {
        cwd,
        env: {
          ...buildSpawnEnv(),
          ...(request.write ? writeEnv() : readEnv()),
          LC_ALL: 'C',
          LANG: 'C',
          GIT_NO_LAZY_FETCH: '1',
        },
        timeout: CLEANUP_LOCAL_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: MAX_BUFFER,
        encoding: 'buffer',
      };
      const child = this.exec('git', [...readHardeningArgs(), ...args], execOptions, (error, stdout, stderr) => {
        const out = stdout.toString('utf8');
        const err = stderr.toString('utf8');
        if (!error) {
          resolve({ code: 0, stdout: out, stderr: err });
          return;
        }
        const code = typeof error.code === 'number' ? error.code : 128;
        if (request.allowFailure) {
          resolve({ code, stdout: out, stderr: err || error.message });
          return;
        }
        reject(new Error(err.trim() || out.trim() || error.message));
      });
      if (request.input !== undefined) child.stdin?.end(request.input);
    });
  }
}
