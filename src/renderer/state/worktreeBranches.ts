import { ipc } from '../ipc/client';
import { createWorktreeBranchLoader } from './worktreeBranchLoader';

const loader = createWorktreeBranchLoader((wsId) => ipc.git.worktreeList({ wsId }));

export const loadWorktreeBranch = loader.load;
export const invalidateWorktreeBranches = loader.invalidate;
export const subscribeWorktreeBranches = loader.subscribe;
