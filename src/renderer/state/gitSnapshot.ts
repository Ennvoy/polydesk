// renderer 共用 Git 快照 single-flight：同工作區同時發生的活動列、狀態列與 SCM 讀取共用一個 IPC。

import { ipc } from '../ipc/client';
import { record } from '../../shared/perf';
import { createGitSnapshotLoader } from './gitSnapshotLoader';

const loader = createGitSnapshotLoader((wsId) => {
  record('gitSnapshotRequest', 1);
  return ipc.git.snapshot({ wsId });
});

export const loadGitSnapshot = loader;
export const invalidateGitSnapshot = loader.invalidate;
export const refreshGitSnapshot = loader.refresh;
