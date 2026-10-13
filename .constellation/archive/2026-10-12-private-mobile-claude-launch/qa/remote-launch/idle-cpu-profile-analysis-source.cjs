const fs = require('node:fs');
const path = 'C:/polydesk-remote-dev/.constellation/qa/remote-launch/idle-cpu-instrumented-profile.json';
const p = JSON.parse(fs.readFileSync(path, 'utf8'));
const v = p.profile;
const nodes = new Map(v.nodes.map(n => [n.id, n]));
const parent = new Map();
for (const n of v.nodes) for (const c of n.children || []) parent.set(c, n.id);
const self = new Map(), inc = new Map();
for (let i = 0; i < v.samples.length; i++) {
  const id = v.samples[i]; const dt = v.timeDeltas[i] || 0;
  self.set(id, (self.get(id) || 0) + dt);
  let cur = id;
  while (cur !== undefined) { inc.set(cur, (inc.get(cur) || 0) + dt); cur = parent.get(cur); }
}
const rank = m => [...m].sort((a, b) => b[1] - a[1]).slice(0, 35).map(([id, t]) => ({
  fn: nodes.get(id).callFrame.functionName, url: nodes.get(id).callFrame.url, line: nodes.get(id).callFrame.lineNumber + 1, ms: Math.round(t / 1000),
}));
const result = { cpuPct: p.cpuPct, counts: p.counts, profileMs: (v.endTime - v.startTime) / 1000, topSelf: rank(self), topInclusive: rank(inc), samples: p.samples };
fs.writeFileSync(path.replace('.json', '-summary.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
