# Constellation 出貨驗證證據

> 由 `verify-runner.mjs --scope ship` 寫入，證據筆格式與票內完全相同（見 DESIGN.md §5）。

## 失敗紀錄 2026-10-12T11:14:58.696Z

- `cmd /c npm run typecheck -- --pretty false`（exit 0，19s）：> tsc --noEmit --pretty false
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=1/6`（exit 0，709s）：   Duration  703.16s (transform 1.24s, setup 0ms, collect 11.56s, tests 676.44s, environment 5ms, prepare 5.59s)
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=2/6`（exit 0，541s）：   Duration  534.60s (transform 1.08s, setup 0ms, collect 3.75s, tests 520.68s, environment 3ms, prepare 3.11s)
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=3/6`（exit 0，72s）：   Duration  66.84s (transform 1.01s, setup 0ms, collect 4.25s, tests 52.65s, environment 3ms, prepare 3.10s)
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=4/6`（exit 0，107s）：   Duration  102.24s (transform 961ms, setup 0ms, collect 8.28s, tests 84.58s, environment 3ms, prepare 3.23s)
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=5/6`（exit 0，60s）：   Duration  55.39s (transform 796ms, setup 0ms, collect 4.60s, tests 40.87s, environment 3ms, prepare 3.12s)
- `cmd /c npm test -- --maxWorkers=1 --minWorkers=1 --shard=6/6`（exit 0，53s）：   Duration  48.60s (transform 656ms, setup 0ms, collect 5.92s, tests 35.25s, environment 2ms, prepare 2.42s)
- `cmd /c npm run build`（exit 0，75s）：✓ built in 1m 7s
- `cmd /c npm run e2e -- --workers=1 --shard=1/12 --grep-invert "REQ-PERF-001"`（exit 0，94s）：  11 passed (1.5m)
- `cmd /c npm run e2e -- --workers=1 --shard=2/12 --grep-invert "REQ-PERF-001"`（exit 0，98s）：  11 passed (1.6m)
- `cmd /c npm run e2e -- --workers=1 --shard=3/12 --grep-invert "REQ-PERF-001"`（exit 1，1084s）：  12 passed (18.0m)

未簽章：此段僅供追查耗時與髒資料來源，不參與關票與出貨判定。
