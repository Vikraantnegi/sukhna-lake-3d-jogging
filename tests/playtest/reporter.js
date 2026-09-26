// Prints a pass/fail table when the run ends and writes report/summary.md and results.json.
import fs from 'node:fs';
import path from 'node:path';
import { REPORT } from './helpers.js';

export default class PlaytestReporter {
  constructor() { this.rows = []; this.start = Date.now(); }
  onBegin(config, suite) { this.total = suite.allTests().length; console.log(`\nSukhna playtest: ${this.total} scenario(s)\n`); }
  onTestBegin(test) { process.stdout.write(`  … ${this.name(test)}\n`); }
  onTestEnd(test, result) {
    const first = result.errors?.[0]?.message?.replace(/\u001b\[[0-9;]*m/g, '') ?? '';
    const row = { scenario: this.name(test), file: path.basename(test.location.file), status: result.status, seconds: +(result.duration / 1000).toFixed(1), error: first.split('\n').slice(0, 12).join('\n') };
    this.rows.push(row);
    process.stdout.write(`  ${row.status === 'passed' ? 'PASS' : 'FAIL'} ${row.scenario} (${row.seconds}s)\n`);
  }
  name(test) { return test.titlePath().filter(Boolean).slice(-1)[0]; }
  onEnd(result) {
    fs.mkdirSync(REPORT, { recursive: true });
    const pad = (s, n) => String(s).padEnd(n);
    const w = Math.max(10, ...this.rows.map((r) => r.scenario.length));
    const lines = [`| ${pad('Scenario', w)} | Result | Time |`, `|${'-'.repeat(w + 2)}|--------|------|`];
    for (const r of this.rows) lines.push(`| ${pad(r.scenario, w)} | ${r.status === 'passed' ? 'PASS  ' : 'FAIL  '} | ${r.seconds}s |`);
    const passed = this.rows.filter((r) => r.status === 'passed').length;
    const table = lines.join('\n');
    console.log(`\n${table}\n\n${passed}/${this.rows.length} passed in ${((Date.now() - this.start) / 1000).toFixed(0)} s. Report: tests/playtest/report/summary.md\n`);
    const failures = this.rows.filter((r) => r.status !== 'passed').map((r) => `### ${r.scenario}\n\n\`\`\`\n${r.error}\n\`\`\``).join('\n\n');
    fs.writeFileSync(path.join(REPORT, 'summary.md'), `# Sukhna playtest\n\n${new Date().toISOString()}\n\n${table}\n\n${passed}/${this.rows.length} passed.\n\n${failures}\n`);
    fs.writeFileSync(path.join(REPORT, 'results.json'), JSON.stringify(this.rows, null, 2));
  }
}
