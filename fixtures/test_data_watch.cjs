/*
 * THE TEST-DATA KEY IN ANY EDITOR (Windows):  npm run testdata:watch
 *
 * Runs in the project folder until stopped (Ctrl+C there). Select a value - or a
 * testData.<key> - in any program and press Alt+T:
 *   - the spec is the one named in the window's title (the editor's); it is saved first
 *     (Ctrl+S) so nothing typed is lost, and the editor reloads it afterwards;
 *   - the selection is copied (the clipboard is put back as it was) and found in that spec;
 *   - a value becomes testData.<key> everywhere in the spec it appears; a testData.<key>
 *     becomes its value again everywhere. A small window lists the places - all ticked, untick
 *     one to keep it as it is; lines marked // testdata:keep start unticked - and asks the key
 *     name for a new value (Enter takes the suggestion). With one place and a key that already
 *     holds the value, it simply happens;
 *   - test-data.json and test-data.base.json get a new key first, then the spec is written,
 *     then its healed copy (test_data_cli.cjs commitToggle - the same as npm run testdata:toggle).
 * Alt+Shift+T always asks for a new key name. With a browser in front, Alt+T goes to the page
 * (the Qualibrix spec editor has its own Alt+T). --hotkey Ctrl+Alt+T picks another key.
 *
 * Windows only: keyboard, clipboard and the small window are fixtures/test_data_hotkey.ps1
 * (lines of JSON both ways); every decision is made here.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const links = require('./test_data_links.cjs');
const cli = require('./test_data_cli.cjs');

const SKIPPED_FOLDERS = new Set(['node_modules', '.git', 'test-results', 'playwright-report', 'allure-results', 'allure-report', 'fixtures', 'masked']);
const SPEC_FILE = /\.spec\.[cm]?[jt]s$/i;

// Every spec of the project, healed copies included (a healed copy can be edited too).
function projectSpecs(root) {
  const found = [];
  const visit = (directory) => {
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name)) visit(full);
      } else if (SPEC_FILE.test(entry.name)) {
        found.push(full);
      }
    }
  };
  visit(path.resolve(root));
  return found.sort();
}

/*
 * The spec the window title names: its full path, else its file name (the longest wins, so
 * x.healed.spec.js beats x.spec.js). null when none is named, or two share the shown name.
 */
function specInTitle(specs, title) {
  const text = String(title || '').toLowerCase();
  let best = null;
  let tie = false;
  for (const file of specs) {
    const full = file.toLowerCase();
    const base = path.basename(file).toLowerCase();
    const score = text.includes(full) ? 10000 + full.length : text.includes(base) ? base.length : 0;
    if (!score) continue;
    if (!best || score > best.score) {
      best = { file, score };
      tie = false;
    } else if (score === best.score) {
      tie = true;
    }
  }
  return best && !tie ? best.file : null;
}

function clip(text, length) {
  const limit = length || 110;
  const value = String(text || '');
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}

/*
 * What happens on each message from the helper. helper.send(command) talks back; log(text)
 * writes to the console. One Alt+T at a time.
 */
function createWatcher(options) {
  const { root, helper } = options;
  const log = options.log || (() => {});
  const hotkey = options.hotkey || 'Alt+T';
  const quotes = new Map();
  let pending = null;
  let sequence = 0;

  function notify(text, level) {
    helper.send({ cmd: 'notify', text: clip(text, 250), level: level || 'info' });
    log(text);
  }

  function finish(text, level) {
    if (text) notify(text, level);
    pending = null;
  }

  function onHotkey(event) {
    // A copy that never answered does not block the key for good.
    if (pending && !(pending.stage === 'copy' && Date.now() - pending.started > 5000)) {
      log(pending.stage === 'dialog'
        ? 'Still waiting for the small window from the last key press: answer it first (it may be behind other windows).'
        : 'Still busy with the last key press.');
      return;
    }
    const specs = projectSpecs(root);
    const titled = specInTitle(specs, event.title);
    const pressed = event.ask ? `${hotkey} with Shift` : hotkey;
    log(`${pressed} in ${event.process || 'a window'}: ${titled
      ? path.relative(root, titled)
      : `no spec named in its title ("${clip(event.title, 60)}"), so every spec is searched`}`);
    sequence += 1;
    pending = { id: sequence, ask: Boolean(event.ask), specs, titled, stage: 'copy', started: Date.now() };
    helper.send({ cmd: 'copy', id: sequence, save: Boolean(titled) });
  }

  function onCopied(event) {
    if (!pending || event.id !== pending.id || pending.stage !== 'copy') return;
    const text = String(event.text || '');
    if (!event.ok || !text.trim()) {
      finish('Select a value (or a testData.<key>) first, then press Alt+T.', 'warning');
      return;
    }
    log(`Selected: ${cli.shown(clip(text.trim(), 80))}`);
    // An editor copies the whole line when nothing is selected.
    if (/\n\s*$/.test(text) || text.trim().includes('\n')) {
      finish('Select just the value (or the testData.<key>), not whole lines, then press Alt+T.', 'warning');
      return;
    }
    const files = pending.titled ? [pending.titled] : pending.specs;
    const found = [];
    const problems = [];
    for (const file of files) {
      try {
        const spec = cli.readSpec(file);
        const info = cli.testDataFor(file, spec.text);
        const plan = links.planToggleForText(spec.text, text, info.store);
        if (plan.kind !== 'none') found.push({ spec, info, plan });
        // The spec in front makes its own testData: say so, rather than "not a value".
        else if (plan.ownData && pending.titled) problems.push(`${path.basename(file)}: ${plan.reason}`);
      } catch (error) {
        problems.push(`${path.basename(file)}: ${error.message}`);
      }
    }
    const where = pending.titled ? path.basename(pending.titled) : "this project's specs";
    if (!found.length) {
      finish(problems[0] || `${cli.shown(text.trim())} is not a value or a testData reference in ${where}.`, 'warning');
      return;
    }
    if (found.length > 1) {
      const names = found.map((item) => path.basename(item.spec.file)).join(', ');
      finish(`${cli.shown(text.trim())} is in ${found.length} specs (${names}). Open the one you mean and press Alt+T again.`, 'warning');
      return;
    }
    Object.assign(pending, found[0], { stage: 'choose' });
    decide();
  }

  // Straight on, or the small window first; `problem` puts it back with what is wrong.
  function decide(problem) {
    const { plan, spec, info } = pending;
    const name = path.basename(spec.file);
    if (plan.kind === 'ref') {
      const reference = `${plan.dataName}.${plan.key}`;
      if (plan.secret) {
        finish(`${reference} looks like a password, so it stays in test data.`, 'warning');
        return;
      }
      const value = plan.original !== undefined ? plan.original : plan.value;
      if (value === undefined) {
        finish(`${reference} is not in test-data.json.`, 'warning');
        return;
      }
      if (!plan.places.some((place) => !place.blocked)) {
        finish(`${reference} is part of a longer expression everywhere in ${name}; change it by hand.`, 'warning');
        return;
      }
      pending.value = value;
      if (plan.places.length === 1 && !problem) {
        apply(plan.places);
        return;
      }
      ask({ message: `Write ${reference} back as ${cli.shown(value)} in ${name}.`, button: 'Write the value', problem });
      return;
    }
    const needKey = pending.ask || !plan.matches.length;
    if (!pending.key) {
      pending.key = pending.ask && plan.matches.length
        ? links.suggestKeyName(spec.text, plan.places[0].start, plan.value, info.keys)
        : plan.suggestedKey;
    }
    if (!needKey && plan.places.length === 1 && !problem) {
      apply(plan.places);
      return;
    }
    const message = needKey
      ? `Make ${cli.shown(plan.value)} test data in ${name}.`
      : `Use ${plan.dataName}.${pending.key} (it holds ${cli.shown(plan.value)}) in ${name}.`;
    ask({ message, button: 'Make test data', needKey, problem });
  }

  function ask(settings) {
    const { plan } = pending;
    pending.stage = 'dialog';
    const ticked = pending.checked || plan.places.map((place) => Boolean(place.current || (!place.kept && !place.blocked)));
    helper.send({
      cmd: 'dialog',
      id: pending.id,
      message: settings.message,
      needKey: Boolean(settings.needKey),
      key: pending.key || '',
      note: settings.needKey ? 'A new key goes into test-data.json. A key that already holds this value is used as it is.' : '',
      error: settings.problem || '',
      places: plan.places.map((place) => {
        let label = `${links.placeName(place, plan.places)}: ${clip(place.preview)}`;
        if (place.kept) label += '   (// testdata:keep)';
        if (place.blocked) label += `   (cannot change: ${place.blocked})`;
        return label;
      }),
      checked: ticked,
      button: settings.button,
    });
    log(`A small window is open: ${plan.places.length > 1 ? `tick the ${plan.places.length} places, ` : ''}` +
      `${settings.needKey ? 'name the key, ' : ''}then press "${settings.button}" (on the taskbar if it is hidden).`);
  }

  function onDialog(event) {
    if (!pending || event.id !== pending.id || pending.stage !== 'dialog') return;
    if (!event.ok) {
      finish('Nothing changed.');
      return;
    }
    const ticked = new Set((Array.isArray(event.checked) ? event.checked : []).map(Number));
    pending.checked = pending.plan.places.map((place, index) => ticked.has(index));
    const chosen = pending.plan.places.filter((place, index) => ticked.has(index) && !place.blocked);
    if (pending.plan.kind === 'literal') {
      const key = String(event.key == null ? '' : event.key).trim() || pending.key;
      pending.key = key;
      const problem = cli.keyProblem(pending.info, key, pending.plan.value);
      if (problem) {
        pending.stage = 'choose';
        decide(problem);
        return;
      }
    }
    if (!chosen.length) {
      finish('No place was ticked, so nothing changed.');
      return;
    }
    apply(chosen);
  }

  function apply(chosen) {
    const { spec, info, plan } = pending;
    const name = path.basename(spec.file);
    try {
      const choice = plan.kind === 'ref'
        ? { value: pending.value, quote: quotes.get(`${spec.file}|${plan.key}`) }
        : { key: pending.key };
      const committed = cli.commitToggle(spec, info, plan, chosen, choice);
      if (plan.kind === 'literal' && committed.quote) quotes.set(`${spec.file}|${pending.key}`, committed.quote);
      const what = plan.kind === 'ref'
        ? `${plan.dataName}.${plan.key} is ${cli.shown(pending.value)} again`
        : `${cli.shown(plan.value)} is ${plan.dataName}.${pending.key} now${committed.testDataAdded.length ? ' (a new key)' : ''}`;
      const healedProblem = committed.healed && !committed.healed.ok;
      finish(`${what} in ${name}, ${links.placesSummary(chosen)}.${healedProblem ? ` ${committed.healed.message}` : ''}`, healedProblem ? 'warning' : 'info');
    } catch (error) {
      finish(error.message, 'warning');
    }
  }

  return {
    handle(message) {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'hotkey') onHotkey(message);
      else if (message.type === 'copied') onCopied(message);
      else if (message.type === 'dialog') onDialog(message);
      else if (message.type === 'passed') {
        log(`${hotkey} in ${message.process}: left to it (browsers and the Claude app keep their own ${hotkey}). Open the spec in an editor.`);
      } else if (message.type === 'error') {
        log(`helper: ${message.message}`);
        if (pending && (message.id === undefined || message.id === null || message.id === pending.id)) finish(null);
      }
    },
    get busy() {
      return Boolean(pending);
    },
  };
}

function run(options) {
  const settings = options || {};
  const root = path.resolve(settings.root || process.cwd());
  const hotkey = settings.hotkey || 'Alt+T';
  if (process.platform !== 'win32') {
    console.error('npm run testdata:watch works on Windows. Elsewhere: npm run testdata:toggle -- <spec>:<line>:<column>');
    return Promise.resolve(1);
  }
  const script = path.join(__dirname, 'test_data_hotkey.ps1');
  console.log(`Starting the test-data key for ${root} ...`);
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Hotkey', hotkey], {
      cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    const helper = {
      send(message) {
        if (child.stdin.writable) child.stdin.write(`${JSON.stringify(message)}\n`);
      },
    };
    const watcher = createWatcher({ root, helper, hotkey, log: (text) => console.log(`[testdata] ${text}`) });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch (_) {
        if (line.trim()) console.log(line);
        return;
      }
      if (message.type === 'ready') {
        console.log(`Ready. Select a value or a testData.<key> in any editor and press ${message.hotkey}` +
          `${message.askHotkey ? ` (${message.askHotkey}: choose a new key name)` : ''}. Ctrl+C here stops it.`);
      } else if (message.type === 'error' && message.fatal) {
        console.error(message.message);
      } else {
        watcher.handle(message);
      }
    });
    readline.createInterface({ input: child.stderr }).on('line', (line) => {
      if (line.trim()) console.error(line);
    });
    const stop = () => {
      try {
        child.stdin.end();
      } catch (_) { /* already closed */ }
      setTimeout(() => child.kill(), 2000).unref();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    child.on('error', (error) => {
      console.error(`PowerShell did not start: ${error.message}`);
      resolve(1);
    });
    child.on('exit', (code) => resolve(code || 0));
  });
}

module.exports = { run, createWatcher, specInTitle, projectSpecs };
