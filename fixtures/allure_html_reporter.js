const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Fetched with npx only when the project has no 'allure' package installed.
const ALLURE_VERSION = '3.20.1';
// The classic Allure 2 report (Overview, Categories, Suites, Behaviors, Graphs,
// Timeline), built by Allure 3's allure2 plugin - still no Java.
const REPORT_CONFIG = { name: 'Allure Report', plugins: { allure2: { options: {} } } };

function hideFeaturesByStoriesWidget(reportFolder) {
  const indexPath = path.join(reportFolder, 'index.html');
  if (!fs.existsSync(indexPath)) return;
  const marker = 'hide-allure-features-by-stories';
  const html = fs.readFileSync(indexPath, 'utf8');
  if (html.includes(marker)) return;
  const style = `<style id="${marker}">[data-id="behaviors"]{display:none!important}</style>`;
  const updated = html.replace(/<\/head>/i, `${style}</head>`);
  if (updated !== html) fs.writeFileSync(indexPath, updated, 'utf8');
}

function groupResultsByModule(resultsDir) {
  for (const name of fs.readdirSync(resultsDir)) {
    if (!name.endsWith('-result.json')) continue;
    const resultPath = path.join(resultsDir, name);
    let result;
    try {
      result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    } catch (_) {
      continue;
    }

    const titlePathLabel = (result.labels || []).find((label) => label.name === 'titlePath')?.value || '';
    const titleParts = (Array.isArray(result.titlePath) ? result.titlePath : String(titlePathLabel).split(' > '))
      .flatMap((part) => String(part).split(/[\\/]+/))
      .map((part) => part.trim())
      .filter(Boolean);
    const suiteIndex = titleParts.findIndex((part) => /^(sanity|regression)$/i.test(part));
    if (suiteIndex < 0) continue;

    const nextPart = titleParts[suiteIndex + 1] || '';
    const moduleName = nextPart && !/\.(spec|test)\.(js|jsx|ts|tsx|mjs|cjs)$/i.test(nextPart)
      ? nextPart
      : 'Root';
    const labels = (result.labels || []).filter((label) => label.name !== 'parentSuite');
    labels.push({ name: 'parentSuite', value: moduleName });
    result.labels = labels;
    fs.writeFileSync(resultPath, JSON.stringify(result));
  }
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// The healer's own log for this run, one entry per heal attempt.
function readHealEntries(healLogPath) {
  try {
    const entries = JSON.parse(fs.readFileSync(healLogPath, 'utf8'));
    return (Array.isArray(entries) ? entries : []).filter(Boolean);
  } catch (_) {
    return [];
  }
}

// Locators the healer replaced in this run.
function readHealedLocators(healLogPath) {
  return readHealEntries(healLogPath).filter(entry => entry.status === 'healed' &&
    String(entry.healed_locator || '').trim() && String(entry.healed_locator).trim() !== String(entry.original_locator || '').trim());
}

// Heals that were tried and did not work, with the reason the healer gave.
function readFailedHeals(healLogPath) {
  return readHealEntries(healLogPath).filter(entry => entry.status === 'heal_failed');
}

// What the healer could not fix, and why - so a failed heal is not a silent one.
function renderFailedHeals(entries) {
  const code = 'font-family:Consolas,Menlo,monospace;font-size:12px;white-space:pre-wrap;word-break:break-all';
  const blocks = entries.map((entry, index) => {
    const original = String(entry.original_locator || '');
    const step = String(entry.step || '');
    return `<div style="margin:8px 0;padding:8px 10px;border:1px solid #d9d9d9;border-left:4px solid #f85149;border-radius:4px">` +
      `<div style="margin-bottom:4px"><b>${index + 1}. ${escapeHtml(entry.action || 'locator')}</b></div>` +
      (step && step !== original ? `<div style="margin:2px 0"><b>Step:</b> ${escapeHtml(step)}</div>` : '') +
      `<div style="margin:2px 0"><b>Locator:</b> <code style="${code}">${escapeHtml(original)}</code></div>` +
      `<div style="margin:2px 0"><b>Why it was not healed:</b> <span style="white-space:pre-wrap">${escapeHtml(entry.reason || 'Locator failed')}</span></div></div>`;
  });
  return `<h4>Heal attempted, not healed (${entries.length})</h4>${blocks.join('')}`;
}

// One block per healed locator, a label on every line. Allure gives description
// tables no borders or spacing (the cells ran together), so this uses plain blocks
// with inline styles; with the styles stripped it is still one labelled line each.
function renderHealedLocators(entries) {
  const code = 'font-family:Consolas,Menlo,monospace;font-size:12px;white-space:pre-wrap;word-break:break-all';
  const line = (label, value) => `<div style="margin:2px 0"><b>${label}:</b> ` +
    `<code style="${code}">${escapeHtml(value)}</code></div>`;
  const blocks = entries.map((entry, index) => {
    const original = String(entry.original_locator || '');
    const step = String(entry.step || '');
    return `<div style="margin:8px 0;padding:8px 10px;border:1px solid #d9d9d9;border-left:4px solid #3fb950;border-radius:4px">` +
      `<div style="margin-bottom:4px"><b>${index + 1}. ${escapeHtml(entry.action || 'locator')}</b></div>` +
      // The step label is often the locator itself: show it only when it adds something.
      (step && step !== original ? `<div style="margin:2px 0"><b>Step:</b> ${escapeHtml(step)}</div>` : '') +
      line('Original', original) + line('Healed', entry.healed_locator) + `</div>`;
  });
  return `<h4>Healed locators (${entries.length})</h4>${blocks.join('')}`;
}

// A healed test says so on its own page: a "healed" tag (filter Suites by it) and a
// table of every locator the healer replaced - step, action, original, healed.
function addHealedLocators(resultsDir, healLogPath) {
  const healed = readHealedLocators(healLogPath);
  const failed = readFailedHeals(healLogPath);
  if (!healed.length && !failed.length) return 0;
  let tagged = 0;
  for (const name of fs.readdirSync(resultsDir)) {
    if (!name.endsWith('-result.json')) continue;
    const resultPath = path.join(resultsDir, name);
    let result;
    try {
      result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    } catch (_) {
      continue;
    }
    const where = `${result.fullName || ''} ${(result.titlePath || []).join(' ')}`;
    const belongs = entry => {
      if (entry.test_title && entry.test_title !== result.name) return false;
      const specName = entry.spec_file ? path.basename(String(entry.spec_file)) : '';
      return !specName || where.includes(specName);
    };
    const mine = healed.filter(belongs);
    const notHealed = failed.filter(belongs);
    if (!mine.length && !notHealed.length) continue;
    result.descriptionHtml = `${result.descriptionHtml || ''}${mine.length ? renderHealedLocators(mine) : ''}` +
      `${notHealed.length ? renderFailedHeals(notHealed) : ''}`;
    result.labels = (result.labels || []).filter(label => !(label.name === 'tag' && ['healed', 'heal-failed'].includes(label.value)));
    if (mine.length) result.labels.push({ name: 'tag', value: 'healed' });
    if (notHealed.length) result.labels.push({ name: 'tag', value: 'heal-failed' });
    fs.writeFileSync(resultPath, JSON.stringify(result));
    tagged += 1;
  }
  return tagged;
}

// ---------------------------------------------------------------------------
// Run summary: how many spec files and test cases ran, per module and per spec
// file, with every failure listed. Counted from this run's Allure results.
// Shown in the report as a "Run summary" button + panel, and saved as
// run-summary.json next to index.html for other tools.
// ---------------------------------------------------------------------------
const SPEC_FILE = /^(.*?\.(?:spec|test)\.[cm]?[jt]sx?)(?::\d+)*$/i;
const COUNTED_STATUSES = ['passed', 'failed', 'broken', 'skipped'];

function emptyCounts() {
  return { testCases: 0, passed: 0, failed: 0, broken: 0, skipped: 0, unknown: 0 };
}

function countStatus(counts, status) {
  counts.testCases += 1;
  counts[COUNTED_STATUSES.includes(status) ? status : 'unknown'] += 1;
}

function specFileOf(result) {
  const full = String(result.fullName || '').replace(/\\/g, '/');
  const match = SPEC_FILE.exec(full);
  if (match) return match[1];
  const suite = (result.labels || []).find(label => label.name === 'suite');
  return suite ? String(suite.value).replace(/\\/g, '/') : 'unknown spec file';
}

// Same rule as groupResultsByModule: the folder right after sanity/ or regression/.
function moduleOf(specFile) {
  const parts = String(specFile).split('/').filter(Boolean);
  const suiteIndex = parts.findIndex(part => /^(sanity|regression)$/i.test(part));
  const next = suiteIndex >= 0 ? parts[suiteIndex + 1] || '' : '';
  return {
    suite: suiteIndex >= 0 ? parts[suiteIndex].toLowerCase() : '',
    module: next && !/\.(spec|test)\.[cm]?[jt]sx?$/i.test(next) ? next : 'Root',
  };
}

function testCaseKeyOf(name) {
  const text = String(name || '');
  const match = /^\s*Test case id\s*:\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*-/i.exec(text) ||
    /\[(?:testcase_id|test_case_key):\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*\]/i.exec(text);
  return match ? match[1] : null;
}

function summarizeResults(resultsDir) {
  // One entry per test case: a retry writes another result with the same
  // historyId, and the last attempt is the one that counts.
  const latest = new Map();
  for (const name of fs.readdirSync(resultsDir)) {
    if (!name.endsWith('-result.json')) continue;
    let result;
    try { result = JSON.parse(fs.readFileSync(path.join(resultsDir, name), 'utf8')); } catch (_) { continue; }
    const project = ((result.parameters || []).find(item => item.name === 'Project') || {}).value || '';
    const key = result.historyId || `${result.fullName}|${result.name}|${project}`;
    const known = latest.get(key);
    if (!known || (result.stop || 0) >= (known.stop || 0)) latest.set(key, result);
  }

  const totals = emptyCounts();
  const modules = new Map();
  const specs = new Map();
  const failures = [];
  for (const result of latest.values()) {
    const status = String(result.status || 'unknown').toLowerCase();
    const spec = specFileOf(result);
    const { suite, module } = moduleOf(spec);
    const project = ((result.parameters || []).find(item => item.name === 'Project') || {}).value || '';
    countStatus(totals, status);
    if (!modules.has(module)) modules.set(module, { module, suite, specFiles: new Set(), ...emptyCounts() });
    const moduleRow = modules.get(module);
    moduleRow.specFiles.add(spec);
    countStatus(moduleRow, status);
    if (!specs.has(spec)) specs.set(spec, { spec, module, suite, ...emptyCounts() });
    countStatus(specs.get(spec), status);
    if (status === 'failed' || status === 'broken') {
      const message = String((result.statusDetails && result.statusDetails.message) || '')
        .replace(/\u001b\[[0-9;]*m/g, '').trim();
      failures.push({
        module, spec, test: result.name || '', testCaseKey: testCaseKeyOf(result.name), status, project,
        message: message.split('\n').filter(Boolean).slice(0, 3).join(' | ').slice(0, 400),
      });
    }
  }
  const byName = (a, b) => String(a).localeCompare(String(b));
  return {
    generatedAt: new Date().toISOString(),
    totals: { specFiles: specs.size, modules: modules.size, ...totals },
    modules: [...modules.values()].sort((a, b) => byName(a.module, b.module))
      .map(({ specFiles, ...row }) => ({ ...row, specFiles: specFiles.size })),
    specs: [...specs.values()].sort((a, b) => byName(a.spec, b.spec)),
    failures: failures.sort((a, b) => byName(a.module, b.module) || byName(a.spec, b.spec) || byName(a.test, b.test)),
  };
}

// ---------------------------------------------------------------------------
// Charts for the Run summary page, drawn as inline SVG (the report works offline).
// Status colors are the validated status palette: critical / warning / good, plus
// a neutral gray for skipped. Segments go failed -> broken -> passed -> skipped so
// red and green never touch (they are too close for deuteranopia side by side).
// Every value is also in the tables below the charts; hover/focus shows a tooltip.
// ---------------------------------------------------------------------------
const CHART_STATUSES = [
  { key: 'failed', label: 'Failed' },
  { key: 'broken', label: 'Broken' },
  { key: 'passed', label: 'Passed' },
  { key: 'skipped', label: 'Skipped' },
];
const CHART_WIDTH = 800;

function textWidth(text, size = 12) {
  return String(text).length * size * 0.56;
}

function shortLabel(text, max) {
  const value = String(text);
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function niceTicks(max) {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map(m => m * power).find(s => s >= rough && Number.isInteger(s)) || Math.ceil(rough);
  const ticks = [];
  for (let value = 0; value < max + step; value += step) ticks.push(value);
  return ticks;
}

function chartLegend(keys) {
  return `<div class="qs-legend">${CHART_STATUSES.filter(s => keys.includes(s.key))
    .map(s => `<span class="qs-key-item"><span class="qs-swatch qs-f-${s.key}"></span>${s.label}</span>`).join('')}</div>`;
}

// A bar whose right end is the data end: 4px rounded there, square at the baseline.
function dataEndBar(x, y, width, height, roundEnd) {
  const w = Math.max(width, 1);
  const r = roundEnd ? Math.min(4, w / 2, height / 2) : 0;
  if (!r) return `M${x},${y}h${w}v${height}h${-w}z`;
  return `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${height - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${-(w - r)}z`;
}

// 1. The run as one whole: a tall segmented bar, each status its share.
function statusShareChart(totals) {
  const total = CHART_STATUSES.reduce((sum, s) => sum + (totals[s.key] || 0), 0);
  if (!total) return '';
  const parts = CHART_STATUSES.filter(s => totals[s.key] > 0);
  const gap = 2;
  const available = CHART_WIDTH - gap * (parts.length - 1);
  let x = 0;
  const blocks = parts.map(s => {
    const value = totals[s.key];
    const width = Math.max(available * value / total, 2);
    const share = Math.round(value / total * 100);
    const label = `${share}%`;
    const fits = textWidth(label, 13) + 16 <= width;
    const tip = `${s.label}: ${value} of ${total} test cases (${share}%)`;
    const block = `<g class="qs-mark" tabindex="0" role="img" aria-label="${escapeHtml(tip)}" data-tip="${escapeHtml(tip)}">` +
      `<rect class="qs-f-${s.key}" x="${x.toFixed(1)}" y="0" width="${width.toFixed(1)}" height="28" rx="4"/>` +
      (fits ? `<text class="qs-in qs-in-${s.key}" x="${(x + 8).toFixed(1)}" y="18.5">${label}</text>` : '') + '</g>';
    x += width + gap;
    return block;
  }).join('');
  const name = parts.map(s => `${s.label} ${totals[s.key]}`).join(', ');
  return `<div class="qs-chart"><div class="qs-chart-title">Test cases by status</div>
${chartLegend(parts.map(s => s.key))}
<svg class="qs-svg" viewBox="0 0 ${CHART_WIDTH} 28" role="img" aria-label="Test cases by status: ${escapeHtml(name)}">${blocks}</svg></div>`;
}

// 2. Each module as a stacked bar of its statuses, total at the bar's end.
function moduleStatusChart(modules) {
  if (!modules.length) return '';
  const rows = [...modules].sort((a, b) => (b.failed + b.broken) - (a.failed + a.broken) || b.testCases - a.testCases || String(a.module).localeCompare(String(b.module)));
  const labelWidth = Math.min(200, Math.max(70, Math.max(...rows.map(r => textWidth(shortLabel(r.module, 26)))) + 14));
  const x0 = labelWidth, plotWidth = CHART_WIDTH - labelWidth - 44;
  const ticks = niceTicks(Math.max(...rows.map(r => r.testCases)));
  const unit = plotWidth / ticks[ticks.length - 1];
  const band = 34, bar = 20, top = 4;
  const height = top + rows.length * band + 22;
  const grid = ticks.map(t => {
    const gx = (x0 + t * unit).toFixed(1);
    return `<line class="qs-grid" x1="${gx}" x2="${gx}" y1="${top}" y2="${top + rows.length * band}"/>` +
      `<text class="qs-tick" x="${gx}" y="${height - 6}" text-anchor="middle">${t}</text>`;
  }).join('');
  const bars = rows.map((row, index) => {
    const y = top + index * band + (band - bar) / 2;
    const present = CHART_STATUSES.filter(s => row[s.key] > 0);
    let start = 0;
    const segments = present.map((s, i) => {
      const last = i === present.length - 1;
      const sx = x0 + start * unit;
      const width = row[s.key] * unit - (last ? 0 : 2);
      start += row[s.key];
      const tip = `${row.module} · ${s.label}: ${row[s.key]} of ${row.testCases} test cases`;
      return `<g class="qs-mark" tabindex="0" role="img" aria-label="${escapeHtml(tip)}" data-tip="${escapeHtml(tip)}">` +
        `<path class="qs-f-${s.key}" d="${dataEndBar(sx, y, width, bar, last)}"/></g>`;
    }).join('');
    const end = x0 + row.testCases * unit;
    return `<text class="qs-cat" x="${x0 - 10}" y="${y + bar / 2 + 4}" text-anchor="end">${escapeHtml(shortLabel(row.module, 26))}<title>${escapeHtml(row.module)}</title></text>` +
      segments + `<text class="qs-val" x="${(end + 6).toFixed(1)}" y="${y + bar / 2 + 4}">${row.testCases}</text>`;
  }).join('');
  const used = CHART_STATUSES.filter(s => rows.some(r => r[s.key] > 0)).map(s => s.key);
  return `<div class="qs-chart"><div class="qs-chart-title">Test cases by module</div>
${chartLegend(used)}
<svg class="qs-svg" viewBox="0 0 ${CHART_WIDTH} ${height}" role="img" aria-label="Test cases by module, stacked by status">${grid}${bars}</svg></div>`;
}

// 3. Where the failures are: failed + broken test cases per spec file, most first.
function failingSpecsChart(specs) {
  const failing = specs.filter(s => s.failed + s.broken > 0)
    .sort((a, b) => (b.failed + b.broken) - (a.failed + a.broken) || String(a.spec).localeCompare(String(b.spec)));
  const title = '<div class="qs-chart-title">Failures by spec file</div>';
  if (!failing.length) return `<div class="qs-chart">${title}<div class="qs-none">No failures in this run.</div></div>`;
  const shown = failing.slice(0, 10);
  const nameOf = spec => String(spec).split('/').slice(-2).join('/');
  const labelWidth = Math.min(260, Math.max(90, Math.max(...shown.map(s => textWidth(shortLabel(nameOf(s.spec), 36)))) + 14));
  const x0 = labelWidth, plotWidth = CHART_WIDTH - labelWidth - 44;
  const ticks = niceTicks(Math.max(...shown.map(s => s.failed + s.broken)));
  const unit = plotWidth / ticks[ticks.length - 1];
  const band = 30, bar = 18, top = 4;
  const height = top + shown.length * band + 22;
  const grid = ticks.map(t => {
    const gx = (x0 + t * unit).toFixed(1);
    return `<line class="qs-grid" x1="${gx}" x2="${gx}" y1="${top}" y2="${top + shown.length * band}"/>` +
      `<text class="qs-tick" x="${gx}" y="${height - 6}" text-anchor="middle">${t}</text>`;
  }).join('');
  const bars = shown.map((row, index) => {
    const y = top + index * band + (band - bar) / 2;
    const count = row.failed + row.broken;
    const tip = `${row.spec}: ${count} of ${row.testCases} test cases did not pass (${row.failed} failed, ${row.broken} broken)`;
    return `<text class="qs-cat" x="${x0 - 10}" y="${y + bar / 2 + 4}" text-anchor="end">${escapeHtml(shortLabel(nameOf(row.spec), 36))}<title>${escapeHtml(row.spec)}</title></text>` +
      `<g class="qs-mark" tabindex="0" role="img" aria-label="${escapeHtml(tip)}" data-tip="${escapeHtml(tip)}">` +
      `<path class="qs-f-failed" d="${dataEndBar(x0, y, count * unit, bar, true)}"/></g>` +
      `<text class="qs-val" x="${(x0 + count * unit + 6).toFixed(1)}" y="${y + bar / 2 + 4}">${count}</text>`;
  }).join('');
  const more = failing.length > shown.length
    ? `<div class="qs-note">Showing the ${shown.length} spec files with the most failures; all ${failing.length} are in the table below.</div>` : '';
  return `<div class="qs-chart">${title}
<svg class="qs-svg" viewBox="0 0 ${CHART_WIDTH} ${height}" role="img" aria-label="Failed and broken test cases per spec file">${grid}${bars}</svg>${more}</div>`;
}

function renderRunCharts(summary) {
  return `<div class="qs-charts">${statusShareChart(summary.totals)}${moduleStatusChart(summary.modules)}${failingSpecsChart(summary.specs)}</div>`;
}

function renderRunSummary(summary) {
  const t = summary.totals;
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const num = (value, kind) => `<td class="qs-n${value && kind ? ` qs-${kind}` : ''}">${value}</td>`;
  const countCells = row => num(row.testCases) + num(row.passed, 'passed') + num(row.failed, 'failed') +
    num(row.broken, 'broken') + num(row.skipped, 'skipped');
  const countHead = '<th class="qs-n">Test cases</th><th class="qs-n">Passed</th><th class="qs-n">Failed</th><th class="qs-n">Broken</th><th class="qs-n">Skipped</th>';
  const moduleRows = summary.modules.map(row => `<tr><td>${escapeHtml(row.module)}</td><td>${escapeHtml(row.suite || '-')}</td>` +
    `${num(row.specFiles)}${countCells(row)}</tr>`).join('');
  const specRows = summary.specs.map(row => `<tr><td class="qs-code">${escapeHtml(row.spec)}</td><td>${escapeHtml(row.module)}</td>` +
    `${countCells(row)}</tr>`).join('');
  const failureRows = summary.failures.map((row, index) => `<tr><td class="qs-n">${index + 1}</td>` +
    `<td class="qs-key">${escapeHtml(row.testCaseKey || '-')}</td><td>${escapeHtml(row.test)}</td><td>${escapeHtml(row.module)}</td>` +
    `<td class="qs-code">${escapeHtml(row.spec)}</td><td class="qs-${row.status}">${escapeHtml(row.status)}</td>` +
    `<td class="qs-msg">${escapeHtml(row.message || '-')}</td></tr>`).join('');
  const tile = (label, value, kind = '') => `<div class="qs-tile${kind ? ` qs-tile-${kind}` : ''}"><div class="qs-v">${value}</div><div class="qs-l">${label}</div></div>`;
  const table = (head, rows) => `<div class="qs-scroll"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  // The page itself: shown in Allure's content area when the menu item is chosen.
  const page = `<div class="qbx-rs-page">
<h2 class="qs-title">Run summary</h2>
<div class="qs-sub">${plural(t.modules, 'module')}, ${plural(t.specFiles, 'spec file')}, ${plural(t.testCases, 'test case')} &middot; a retried test counts once, by its last attempt</div>
<div class="qs-tiles">${tile('Spec files', t.specFiles)}${tile('Test cases', t.testCases)}${tile('Modules', t.modules)}${tile('Passed', t.passed, 'passed')}${tile('Failed', t.failed, 'failed')}${tile('Broken', t.broken, 'broken')}${tile('Skipped', t.skipped, 'skipped')}</div>
${renderRunCharts(summary)}
<h3>By module</h3>
${table(`<th>Module</th><th>Suite</th><th class="qs-n">Spec files</th>${countHead}`, moduleRows)}
<h3>By spec file</h3>
${table(`<th>Spec file</th><th>Module</th>${countHead}`, specRows)}
<h3>Failures (${summary.failures.length})</h3>
${summary.failures.length
    ? table('<th class="qs-n">#</th><th>Test case id</th><th>Test</th><th>Module</th><th>Spec file</th><th>Status</th><th>Error</th>', failureRows)
    : '<div class="qs-none">No failures in this run.</div>'}
<div class="qs-tip" role="tooltip" hidden></div>
</div>`;
  // A menu entry like Overview / Categories / Suites. Allure rebuilds its menu on
  // every tab switch, so the entry is put back whenever the menu is drawn again.
  // Its route (#run-summary) is unknown to Allure, which shows "Not found" there:
  // the summary page takes that place, and leaves when another tab is chosen.
  return `
<div id="qbx-run-summary" data-generated="${escapeHtml(summary.generatedAt)}">
<style>
/* Its own scroll area filling Allure's content pane: the pane only scrolls when its
   child stays within it, so a long page grew the pane and got clipped (no scroll). */
.qbx-rs-page{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;box-sizing:border-box;padding:24px 32px 48px;font-size:13px;line-height:1.45;color:inherit}
.qbx-rs-page>*:not(.qs-tip){max-width:1216px}
.qbx-rs-page .qs-charts{display:grid;gap:20px;margin-top:24px}
.qbx-rs-page .qs-chart{border:1px solid rgba(127,127,127,.28);border-radius:8px;padding:14px 18px 12px;background:rgba(127,127,127,.04);overflow-x:auto}
.qbx-rs-page .qs-chart-title{font-weight:600;font-size:14px;margin-bottom:8px}
.qbx-rs-page .qs-legend{display:flex;flex-wrap:wrap;gap:16px;margin-bottom:12px;font-size:12px}
.qbx-rs-page .qs-key-item{display:inline-flex;align-items:center;gap:6px}
.qbx-rs-page .qs-swatch{display:inline-block;width:10px;height:10px;border-radius:3px}
.qbx-rs-page .qs-svg{display:block;width:100%;min-width:560px;max-width:800px;height:auto;overflow:visible;font-family:inherit}
.qbx-rs-page .qs-f-failed{fill:#d03b3b;background:#d03b3b}.qbx-rs-page .qs-f-broken{fill:#fab219;background:#fab219}
.qbx-rs-page .qs-f-passed{fill:#0ca30c;background:#0ca30c}.qbx-rs-page .qs-f-skipped{fill:#8c959f;background:#8c959f}
.qbx-rs-page .qs-grid{stroke:rgba(127,127,127,.25);stroke-width:1}
.qbx-rs-page .qs-tick{fill:currentColor;opacity:.6;font-size:11px;font-variant-numeric:tabular-nums}
.qbx-rs-page .qs-cat{fill:currentColor;font-size:12px}
.qbx-rs-page .qs-val{fill:currentColor;font-size:12px;font-weight:600}
.qbx-rs-page .qs-in{font-size:13px;font-weight:600;fill:#ffffff}
.qbx-rs-page .qs-in-broken,.qbx-rs-page .qs-in-skipped{fill:#0b0b0b}
.qbx-rs-page .qs-mark{outline:none}
.qbx-rs-page .qs-mark:hover>path,.qbx-rs-page .qs-mark:hover>rect,.qbx-rs-page .qs-mark:focus-visible>path,.qbx-rs-page .qs-mark:focus-visible>rect{opacity:.8}
.qbx-rs-page .qs-mark:focus-visible>path,.qbx-rs-page .qs-mark:focus-visible>rect{stroke:currentColor;stroke-width:1.5}
.qbx-rs-page .qs-note{opacity:.7;font-size:12px;margin-top:6px}
.qbx-rs-page .qs-tip{position:absolute;z-index:5;pointer-events:none;max-width:360px;padding:6px 10px;border-radius:6px;font-size:12px;line-height:1.4;
  background:#1f2328;color:#ffffff;box-shadow:0 4px 14px rgba(0,0,0,.25)}
html[data-theme="dark"] .qbx-rs-page .qs-tip{background:#f6f8fa;color:#1f2328}
.qbx-rs-page .qs-title{margin:0 0 4px;font-size:22px;font-weight:600}
.qbx-rs-page h3{margin:24px 0 8px;font-size:15px;font-weight:600}
.qbx-rs-page .qs-sub{opacity:.7;margin-bottom:16px}
.qbx-rs-page .qs-tiles{display:flex;flex-wrap:wrap;gap:12px}
.qbx-rs-page .qs-tile{border:1px solid rgba(127,127,127,.28);border-radius:8px;padding:10px 16px;min-width:112px;background:rgba(127,127,127,.05)}
.qbx-rs-page .qs-v{font-size:24px;font-weight:700}.qbx-rs-page .qs-l{opacity:.7;font-size:12px}
.qbx-rs-page .qs-scroll{overflow-x:auto}
.qbx-rs-page table{border-collapse:collapse;width:100%;min-width:640px}
.qbx-rs-page th,.qbx-rs-page td{border:1px solid rgba(127,127,127,.28);padding:6px 10px;text-align:left;vertical-align:top}
.qbx-rs-page th{background:rgba(127,127,127,.1);font-weight:600}
.qbx-rs-page .qs-n{text-align:right;white-space:nowrap}.qbx-rs-page .qs-key{white-space:nowrap}
.qbx-rs-page .qs-code{font-family:Consolas,Menlo,monospace;font-size:12px;word-break:break-all}
.qbx-rs-page .qs-msg{font-family:Consolas,Menlo,monospace;font-size:12px;white-space:pre-wrap;word-break:break-word;max-width:440px}
.qbx-rs-page .qs-none{opacity:.7}
.qbx-rs-page .qs-passed,.qbx-rs-page .qs-tile-passed .qs-v{color:#1a7f37}
.qbx-rs-page .qs-failed,.qbx-rs-page .qs-tile-failed .qs-v{color:#cf222e}
.qbx-rs-page .qs-broken,.qbx-rs-page .qs-tile-broken .qs-v{color:#b35900}
.qbx-rs-page .qs-skipped,.qbx-rs-page .qs-tile-skipped .qs-v{color:#6e7781}
.qbx-rs-page td.qs-passed,.qbx-rs-page td.qs-failed,.qbx-rs-page td.qs-broken{font-weight:600}
html[data-theme="dark"] .qbx-rs-page .qs-passed,html[data-theme="dark"] .qbx-rs-page .qs-tile-passed .qs-v{color:#57d977}
html[data-theme="dark"] .qbx-rs-page .qs-failed,html[data-theme="dark"] .qbx-rs-page .qs-tile-failed .qs-v{color:#ff7b72}
html[data-theme="dark"] .qbx-rs-page .qs-broken,html[data-theme="dark"] .qbx-rs-page .qs-tile-broken .qs-v{color:#f0b35a}
html[data-theme="dark"] .qbx-rs-page .qs-skipped,html[data-theme="dark"] .qbx-rs-page .qs-tile-skipped .qs-v{color:#a0a8b1}
</style>
<template id="qbx-run-summary-page">${page}</template>
<script>(function(){
var ROUTE='#run-summary';
var ICON='<svg class="a-icon a-icon_size_m side-nav__icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'+
  '<path vector-effect="non-scaling-stroke" d="M4 20V10M10 20V4M16 20V13M22 20H2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function addItem(){
  var menu=document.querySelector('ul.side-nav__menu');
  if(!menu||menu.querySelector('.qbx-rs-item'))return;
  var li=document.createElement('li');
  li.className='side-nav__item qbx-rs-item';
  li.setAttribute('data-tooltip','Run summary');
  li.innerHTML='<a class="side-nav__link" href="'+ROUTE+'"><span class="side-nav__icon-lane">'+ICON+'</span><span class="side-nav__text">Run summary</span></a>';
  menu.insertBefore(li,menu.children[1]||null);
}
function sync(){
  var on=location.hash===ROUTE;
  var link=document.querySelector('.qbx-rs-item > a');
  if(link&&link.classList.contains('side-nav__link_active')!==on)link.classList.toggle('side-nav__link_active',on);
  var content=document.querySelector('.app__content');
  if(!content)return;
  var page=content.querySelector(':scope > .qbx-rs-page');
  if(on&&!page){
    Array.prototype.forEach.call(content.children,function(child){child.style.display='none';});
    content.appendChild(document.getElementById('qbx-run-summary-page').content.cloneNode(true));
    document.title='Run summary - Allure Report';
  }else if(!on&&page){
    page.remove();
    Array.prototype.forEach.call(content.children,function(child){child.style.display='';});
  }
}
// Chart tooltips: hover or keyboard focus on a bar part shows its numbers.
function markOf(target){return target&&target.closest?target.closest('.qbx-rs-page [data-tip]'):null;}
function showTip(mark,clientX,clientY){
  var page=mark.closest('.qbx-rs-page'),tip=page&&page.querySelector('.qs-tip');
  if(!tip)return;
  tip.textContent=mark.getAttribute('data-tip');tip.hidden=false;
  var box=page.getBoundingClientRect();
  if(clientX==null){var r=mark.getBoundingClientRect();clientX=r.left+r.width/2;clientY=r.top;}
  // The page scrolls, and the tooltip sits in its scrolled content: add the offsets.
  var left=Math.min(clientX-box.left+12,box.width-tip.offsetWidth-8);
  tip.style.left=(Math.max(8,left)+page.scrollLeft)+'px';tip.style.top=(clientY-box.top-tip.offsetHeight-10+page.scrollTop)+'px';
}
function hideTip(){var tip=document.querySelector('.qbx-rs-page .qs-tip');if(tip)tip.hidden=true;}
document.addEventListener('mousemove',function(e){var m=markOf(e.target);if(m)showTip(m,e.clientX,e.clientY);else hideTip();});
document.addEventListener('focusin',function(e){var m=markOf(e.target);if(m)showTip(m);});
document.addEventListener('focusout',hideTip);
function refresh(){addItem();sync();}
new MutationObserver(refresh).observe(document.body,{childList:true,subtree:true});
window.addEventListener('hashchange',refresh);
refresh();
})();</script>
</div>`;
}

// Writes run-summary.json and puts the summary into index.html (replacing any earlier one).
function addRunSummary(reportFolder, resultsDir) {
  const indexPath = path.join(reportFolder, 'index.html');
  if (!fs.existsSync(indexPath)) return null;
  const summary = summarizeResults(resultsDir);
  fs.writeFileSync(path.join(reportFolder, 'run-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  const html = fs.readFileSync(indexPath, 'utf8')
    .replace(/\n?<div id="qbx-run-summary"[\s\S]*?<\/script>\n<\/div>/, '');
  const block = renderRunSummary(summary);
  const updated = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${block}\n</body>`) : `${html}${block}`;
  fs.writeFileSync(indexPath, updated, 'utf8');
  return summary;
}

// ---------------------------------------------------------------------------
// Executors: who ran this report (Allure's Overview -> Executors panel), from
// executor.json in the results. Precedence:
//   1. an executor.json you put in the project's allure-results yourself;
//   2. Jenkins, read from the variables Jenkins sets for every build
//      (JENKINS_URL, JOB_NAME, BUILD_NUMBER, BUILD_URL);
//   3. a local run: this machine and the run folder.
// Any field can be set with ALLURE_EXECUTOR_NAME / _TYPE / _URL / _BUILD_NAME /
// _BUILD_URL / _BUILD_ORDER / _REPORT_URL / _REPORT_NAME (these win over 2 and 3).
// ---------------------------------------------------------------------------
function executorInfo(outputFolder, env = process.env) {
  const clean = value => (value == null || String(value).trim() === '' ? undefined : String(value).trim());
  const withSlash = value => (value && !value.endsWith('/') ? `${value}/` : value);
  let info;
  if (clean(env.JENKINS_URL) || clean(env.BUILD_URL)) {
    const buildUrl = withSlash(clean(env.BUILD_URL));
    info = {
      name: 'Jenkins',
      type: 'jenkins',
      url: clean(env.JENKINS_URL),
      buildOrder: Number.parseInt(env.BUILD_NUMBER, 10) || undefined,
      buildName: clean(env.BUILD_DISPLAY_NAME) && clean(env.JOB_NAME)
        ? `${env.JOB_NAME} ${env.BUILD_DISPLAY_NAME}`
        : (clean(env.JOB_NAME) ? `${env.JOB_NAME} #${env.BUILD_NUMBER || ''}`.trim() : undefined),
      buildUrl,
      reportUrl: buildUrl ? `${buildUrl}allure` : undefined,
      reportName: 'Allure Report',
    };
  } else {
    // The backend writes each run to test-results/<run-folder>/allure-report.
    const runFolder = path.basename(path.dirname(outputFolder || ''));
    info = {
      name: `Qualibrix local run (${os.hostname()})`,
      type: 'local',
      buildName: /^run-/.test(runFolder) ? runFolder : `run ${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}`,
      reportName: 'Allure Report',
    };
  }
  const overrides = {
    name: clean(env.ALLURE_EXECUTOR_NAME),
    type: clean(env.ALLURE_EXECUTOR_TYPE),
    url: clean(env.ALLURE_EXECUTOR_URL),
    buildName: clean(env.ALLURE_EXECUTOR_BUILD_NAME),
    buildUrl: clean(env.ALLURE_EXECUTOR_BUILD_URL),
    buildOrder: Number.parseInt(env.ALLURE_EXECUTOR_BUILD_ORDER, 10) || undefined,
    reportUrl: clean(env.ALLURE_EXECUTOR_REPORT_URL),
    reportName: clean(env.ALLURE_EXECUTOR_REPORT_NAME),
  };
  for (const [key, value] of Object.entries(overrides)) if (value !== undefined) info[key] = value;
  return Object.fromEntries(Object.entries(info).filter(([, value]) => value !== undefined));
}

// Puts executor.json into the staged results. A file the user placed in the
// results folder is kept as it is (it may be older than this run, so it is
// copied here when the run's own copy step skipped it).
function stageExecutor(staging, resultsDir, outputFolder) {
  const staged = path.join(staging, 'executor.json');
  const own = path.join(resultsDir, 'executor.json');
  if (fs.existsSync(own)) {
    if (!fs.existsSync(staged)) fs.copyFileSync(own, staged);
    return 'your executor.json';
  }
  const info = executorInfo(outputFolder);
  fs.writeFileSync(staged, JSON.stringify(info, null, 2));
  return `${info.name}${info.buildName ? `, ${info.buildName}` : ''}`;
}

class AllureHtmlReporter {
  constructor(options = {}) {
    // Playwright's CLI reporter uses the project-relative allure-results folder;
    // ALLURE_RESULTS_DIR is reserved for the backend's run archive directory.
    this.resultsDir = path.resolve(options.resultsDir || 'allure-results');
    this.outputFolder = path.resolve(process.env.ALLURE_HTML_OUTPUT_DIR || options.outputFolder || 'allure-report');
    this.startedAt = Date.now();
  }

  onBegin() {
    this.startedAt = Date.now();
  }

  printsToStdio() {
    return false;
  }

  // Runs after 'allure-playwright' has written its last files (reporters end in
  // the order they are listed).
  async onEnd() {
    try {
      this.generate();
    } catch (error) {
      console.log(`[allure-html] Allure report not generated: ${error.message}`);
    }
  }

  // The results folder keeps every earlier run's files: report this run's only.
  freshResults() {
    if (!fs.existsSync(this.resultsDir)) return null;
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'allure-run-'));
    let copied = 0;
    for (const name of fs.readdirSync(this.resultsDir)) {
      const file = path.join(this.resultsDir, name);
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.mtimeMs + 1000 < this.startedAt) continue;
      fs.copyFileSync(file, path.join(staging, name));
      copied += 1;
    }
    const previousHistory = path.join(this.resultsDir, 'history');
    if (fs.existsSync(previousHistory) && fs.statSync(previousHistory).isDirectory()) {
      fs.cpSync(previousHistory, path.join(staging, 'history'), { recursive: true });
    }
    if (copied) {
      groupResultsByModule(staging);
      try {
        addHealedLocators(staging, path.resolve(process.cwd(), 'test-results', 'inline_heals.json'));
      } catch (error) {
        console.log(`[allure-html] Healed locators not added to the report: ${error.message}`);
      }
      return staging;
    }
    fs.rmSync(staging, { recursive: true, force: true });
    return null;
  }

  persistHistory() {
    const generatedHistory = path.join(this.outputFolder, 'history');
    if (!fs.existsSync(generatedHistory) || !fs.statSync(generatedHistory).isDirectory()) return;
    const storedHistory = path.join(this.resultsDir, 'history');
    fs.rmSync(storedHistory, { recursive: true, force: true });
    fs.cpSync(generatedHistory, storedHistory, { recursive: true });
  }

  // The project's own Allure 3 (devDependency 'allure'), else the pinned one via npx.
  generator() {
    try {
      const entry = require.resolve('allure', { paths: [process.cwd(), __dirname] });
      return { command: process.execPath, args: [path.join(path.dirname(entry), '..', 'cli.js')], shell: false };
    } catch (_) {
      return { command: 'npx', args: ['--yes', `allure@${ALLURE_VERSION}`], shell: true };
    }
  }

  generate() {
    const staging = this.freshResults();
    if (!staging) {
      console.log('[allure-html] No Allure results from this run; Allure report skipped.');
      return;
    }
    try {
      // Allure 3 has no --clean: a previous report must not leave files behind.
      fs.rmSync(this.outputFolder, { recursive: true, force: true });
      try {
        console.log(`[allure-html] Executor: ${stageExecutor(staging, this.resultsDir, this.outputFolder)}`);
      } catch (error) {
        console.log(`[allure-html] Executor details not added: ${error.message}`);
      }
      const config = path.join(staging, 'allurerc.json');
      fs.writeFileSync(config, JSON.stringify(REPORT_CONFIG));
      const { command, args, shell } = this.generator();
      const all = [...args, 'generate', staging, '-o', this.outputFolder, '--config', config];
      // Through a shell (npx), every argument is quoted: paths may contain spaces.
      const run = spawnSync(command, shell ? all.map(arg => `"${arg}"`) : all,
        { encoding: 'utf8', shell, timeout: 300000, windowsHide: true });
      const index = path.join(this.outputFolder, 'index.html');
      if (run.status === 0 && fs.existsSync(index)) {
        hideFeaturesByStoriesWidget(this.outputFolder);
        try {
          const summary = addRunSummary(this.outputFolder, staging);
          if (summary) {
            const t = summary.totals;
            console.log(`[allure-html] Run summary: ${t.specFiles} spec file(s), ${t.testCases} test case(s) in ${t.modules} module(s); ` +
              `${t.passed} passed, ${t.failed} failed, ${t.broken} broken, ${t.skipped} skipped`);
          }
        } catch (error) {
          console.log(`[allure-html] Run summary not added to the report: ${error.message}`);
        }
        this.persistHistory();
        console.log(`[allure-html] Allure report: ${index}`);
      } else {
        const why = run.error ? run.error.message : `exit ${run.status}`;
        console.log(`[allure-html] Allure report not generated (${why}): ${String(run.stderr || run.stdout || '').trim().slice(-800)}`);
      }
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}

module.exports = AllureHtmlReporter;
