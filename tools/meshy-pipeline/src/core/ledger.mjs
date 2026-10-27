import fs from 'node:fs';
import path from 'node:path';

// Append-only credit ledger. One JSON object per line.
export class Ledger {
  constructor(cfg) {
    this.file = path.join(cfg.paths.assetsRoot, 'Reports', 'ledger.jsonl');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
  }

  record(entry) {
    fs.appendFileSync(this.file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
  }

  entries() {
    if (!fs.existsSync(this.file)) return [];
    return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  spent(jobId) {
    return this.entries()
      .filter((e) => (jobId ? e.jobId === jobId : true))
      .reduce((s, e) => s + (e.actualCredits ?? 0), 0);
  }
}

// Returns { ok, reason }. Paid stages must pass this AND have explicit user approval.
export function checkBudget(cfg, ledger, jobId, estimate) {
  const jobSpent = ledger.spent(jobId);
  if (jobSpent + estimate > cfg.budget.perTaskCredits) {
    return { ok: false, reason: `job budget ${cfg.budget.perTaskCredits}: spent ${jobSpent} + estimate ${estimate}` };
  }
  if (ledger.spent() + estimate > cfg.budget.perBatchCredits) {
    return { ok: false, reason: `batch budget ${cfg.budget.perBatchCredits} would be exceeded` };
  }
  return { ok: true };
}
