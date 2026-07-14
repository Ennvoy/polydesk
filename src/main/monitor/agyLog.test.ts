import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAgyLog, readAgySessions } from './agyLog';

const HEAD = 'I0714 10:25:17.426290 30644 server.go:233] Creating CLI server backend: product=antigravity workspaceDirs=[C:\\proj\\a] appDataDir=C:\\home';

describe('Agy log 狀態解析', () => {
  it('剛啟動停在輸入列 → done；串流開始 → working；完成 → done', () => {
    expect(parseAgyLog(HEAD)?.state).toBe('done');
    expect(parseAgyLog(`${HEAD}\nI0714 10:25:19.381486 30644 conversation_manager.go:520] Streaming conversation 23a21468-b459-468c-9ffc-6a893d6627af`)?.state).toBe('working');
    expect(parseAgyLog(`${HEAD}\nI0714 10:25:19.381486 30644 conversation_manager.go:520] Streaming conversation 23a21468-b459-468c-9ffc-6a893d6627af\nI0714 10:25:25.059685 30644 conversation_manager.go:596] Stream completed for 23a21468-b459-468c-9ffc-6a893d6627af, clearing ResponsePending`)?.state).toBe('done');
  });

  it('明確等待工具核准 → awaiting；核准結果出現後 → working', () => {
    const running = `${HEAD}\nI0714 10:25:19.381486 30644 conversation_manager.go:520] Streaming conversation 23a21468-b459-468c-9ffc-6a893d6627af`;
    const waiting = `${running}\nI0714 10:25:20.000000 30644 tool_confirmation_manager.go:80] Surfacing tool confirmation: "RunCommand" at step 2`;
    expect(parseAgyLog(waiting)?.state).toBe('awaiting');
    expect(parseAgyLog(`${waiting}\nI0714 10:25:21.000000 30644 server.go:1716] Tool confirmation for conversation 23a21468-b459-468c-9ffc-6a893d6627af step 2 approved=true`)?.state).toBe('working');
  });

  it('啟動設定 toolPermission=request-review 不是待確認；缺 workspace 回 null', () => {
    expect(parseAgyLog(`${HEAD}\nCLI settings initialized: permissions=<nil>, toolPermission=request-review`)?.state).toBe('done');
    expect(parseAgyLog('Streaming conversation 23a21468-b459-468c-9ffc-6a893d6627af')).toBeNull();
  });
});

describe('readAgySessions', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('同 workspace 取最新 log，回 tool=agy', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pd-agy-log-'));
    roots.push(root);
    writeFileSync(join(root, 'cli-old.log'), `${HEAD}\nStreaming conversation 23a21468-b459-468c-9ffc-6a893d6627af`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    writeFileSync(join(root, 'cli-new.log'), `${HEAD}\nStreaming conversation 23a21468-b459-468c-9ffc-6a893d6627af\nStream completed for 23a21468-b459-468c-9ffc-6a893d6627af`);
    const out = await readAgySessions(root);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ cwd: 'C:\\proj\\a', state: 'done', tool: 'agy' });
  });
});
