// renderer 共用 Git 快照 single-flight：同工作區同時發生的活動列、狀態列與 SCM 讀取共用一個 IPC。

import { ipc } from '../ipc/client';
import { createGitSnapshotLoader } from './gitSnapshotLoader';

export const loadGitSnapshot = createGitSnapshotLoader((wsId) => ipc.git.snapshot({ wsId }));
