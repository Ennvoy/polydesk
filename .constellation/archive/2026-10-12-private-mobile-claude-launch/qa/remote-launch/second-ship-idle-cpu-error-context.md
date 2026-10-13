# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: perf.spec.ts >> REQ-MON-006 N=10 背景閒置監控 CPU 低水位
- Location: e2e\perf.spec.ts:156:5

# Error details

```
Error: 閒置監控 CPU%（單核）

expect(received).toBeLessThan(expected)

Expected: < 10
Received:   14.322222222222223
```

# Test source

```ts
  76  | test('REQ-PERF-002/003/004 切換 / 開檔 / 按鍵 p95', async () => {
  77  |   test.setTimeout(240_000);
  78  |   const files = Array.from({ length: N_FILE }, (_, i) => `f${i}.txt`);
  79  |   const dirA = seedWs('perf-a', files);
  80  |   const dirB = seedWs('perf-b');
  81  |   const { app, page, userData } = await launchApp();
  82  |   await stubFolderPicker(app, [dirA, dirB]);
  83  |   await addWorkspaceViaUI(page);
  84  |   await addWorkspaceViaUI(page);
  85  |
  86  |   // 先各載入一次（firstLoad，不計入 wsSwitch 桶），再來回切換量 wsSwitch。
  87  |   await page.locator('button[aria-label="開啟工作區 perf-a"]').click();
  88  |   await expect(page.locator('aside[aria-label="工作區列表"]')).toBeVisible();
  89  |   await page.locator('button[aria-label="開啟工作區 perf-b"]').click();
  90  |   await page.waitForTimeout(300);
  91  |   for (let i = 0; i < N_SWITCH; i++) {
  92  |     await page.locator(`button[aria-label="開啟工作區 perf-${i % 2 === 0 ? 'a' : 'b'}"]`).click();
  93  |     await page.waitForTimeout(80);
  94  |   }
  95  |   const sw = await rendererMeasures(page, 'wsSwitch');
  96  |   report.wsSwitch = { p95: Math.round(p95(sw)), n: sw.length, budget: BUDGET.wsSwitch };
  97  |
  98  |   // 開檔：回到 A，逐一開 N 個檔（每次觸發 fileOpen 埋點）。
  99  |   await page.locator('button[aria-label="開啟工作區 perf-a"]').click();
  100 |   await page.waitForTimeout(200);
  101 |   for (const f of files) {
  102 |     await page.getByText(f, { exact: true }).first().click();
  103 |     await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 15000 });
  104 |     await page.waitForTimeout(120);
  105 |   }
  106 |   const fo = await rendererMeasures(page, 'fileOpen');
  107 |   report.fileOpen = { p95: Math.round(p95(fo)), n: fo.length, budget: BUDGET.fileOpen };
  108 |
  109 |   // 按鍵延遲：開終端機、聚焦 xterm、逐鍵輸入（PTY echo 回流記一次往返延遲）。
  110 |   await page.locator('button[aria-label="新增終端機"]').click();
  111 |   await expect(page.locator('.pd-term-pane-label', { hasText: 'PowerShell' }).first()).toBeVisible({ timeout: 15000 });
  112 |   const terminalHost = page.locator('.pd-term-xterm-host').first();
  113 |   await expect(terminalHost).toHaveAttribute('data-initial-size-ready', 'true', { timeout: 15_000 });
  114 |   await expect
  115 |     .poll(
  116 |       () =>
  117 |         terminalHost.evaluate((host) => {
  118 |           const term = (host as HTMLElement & {
  119 |             __pdTerm?: { buffer: { active: { baseY: number; cursorY: number; getLine: (line: number) => { translateToString: (trim: boolean) => string } | undefined } } };
  120 |           }).__pdTerm;
  121 |           const buffer = term?.buffer.active;
  122 |           return buffer?.getLine((buffer.baseY ?? 0) + (buffer.cursorY ?? 0))?.translateToString(true) ?? '';
  123 |         }),
  124 |       { timeout: 15_000 },
  125 |     )
  126 |     .toMatch(/^PS .*>/);
  127 |   // 直接聚焦 xterm 真正接鍵盤的 textarea；點 screen 在 WebGL／版面收斂期間偶爾只命中 canvas，
  128 |   // 會讓 page.keyboard 輸入落到 body，造成 0~2 個樣本的 under-sampling 假失敗。
  129 |   const terminalInput = page.locator('.pd-term-view .xterm-helper-textarea').first();
  130 |   await terminalInput.focus();
  131 |   await expect(terminalInput).toBeFocused();
  132 |   await page.waitForTimeout(100);
  133 |   for (let i = 0; i < N_KEY; i++) {
  134 |     // 每鍵直接送到 textarea，避免字型載入／fit 的 term.focus 在量測中途改變全域 activeElement。
  135 |     await terminalInput.press('a');
  136 |     await page.waitForTimeout(40);
  137 |   }
  138 |   await page.waitForTimeout(400);
  139 |   const kl = await rendererMeasures(page, 'keyLatency');
  140 |   report.keyLatency = { p95: Math.round(p95(kl)), n: kl.length, budget: BUDGET.keyLatency };
  141 |
  142 |   await app.close();
  143 |   rmSync(dirA, { recursive: true, force: true });
  144 |   rmSync(dirB, { recursive: true, force: true });
  145 |   rmSync(userData, { recursive: true, force: true });
  146 |
  147 |   // 樣本數下限（防 under-sampling 假綠：若埋點退化只 fire 一次，p95=該單一樣本即蒙混過關）。
  148 |   expect(sw.length, 'wsSwitch 樣本數').toBeGreaterThanOrEqual(N_SWITCH);
  149 |   expect(p95(sw), 'wsSwitch p95').toBeLessThan(BUDGET.wsSwitch);
  150 |   expect(fo.length, 'fileOpen 樣本數').toBeGreaterThanOrEqual(N_FILE);
  151 |   expect(p95(fo), 'fileOpen p95').toBeLessThan(BUDGET.fileOpen);
  152 |   expect(kl.length, 'keyLatency 樣本數').toBeGreaterThanOrEqual(Math.floor(N_KEY * 0.6)); // echo 往返時序變異，留餘裕
  153 |   expect(p95(kl), 'keyLatency p95').toBeLessThan(BUDGET.keyLatency);
  154 | });
  155 |
  156 | test('REQ-MON-006 N=10 背景閒置監控 CPU 低水位', async () => {
  157 |   test.setTimeout(240_000);
  158 |   const dirs = Array.from({ length: N_IDLE_WS }, (_, i) => seedWs(`idle-${i}`));
  159 |   const { app, page, userData } = await launchApp();
  160 |   await stubFolderPicker(app, dirs);
  161 |   for (let i = 0; i < N_IDLE_WS; i++) await addWorkspaceViaUI(page);
  162 |   await expect(page.locator('aside[aria-label="工作區列表"]')).toBeVisible();
  163 |   await page.waitForTimeout(1500); // 讓監控進入穩態輪詢
  164 |
  165 |   const c0 = await app.evaluate(() => process.cpuUsage());
  166 |   await page.waitForTimeout(IDLE_WINDOW_MS);
  167 |   const c1 = await app.evaluate(() => process.cpuUsage());
  168 |   const cpuMicros = c1.user + c1.system - (c0.user + c0.system);
  169 |   const cpuPct = (cpuMicros / 1000 / IDLE_WINDOW_MS) * 100; // 佔單核百分比
  170 |   report.idleCpu = { pct: Math.round(cpuPct * 10) / 10, workspaces: N_IDLE_WS, windowMs: IDLE_WINDOW_MS, budget: BUDGET.idleCpuPct };
  171 |
  172 |   await app.close();
  173 |   for (const d of dirs) rmSync(d, { recursive: true, force: true });
  174 |   rmSync(userData, { recursive: true, force: true });
  175 |
> 176 |   expect(cpuPct, '閒置監控 CPU%（單核）').toBeLessThan(BUDGET.idleCpuPct);
      |                                   ^ Error: 閒置監控 CPU%（單核）
  177 | });
  178 |
```