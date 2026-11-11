#!/usr/bin/env node
/*
 * TEST DATA IN THIS PROJECT: values in specs <-> testData, with nothing else running.
 *
 * Run in the project folder:
 *   npm run testdata:watch
 *       select a value (or a testData.<key>) in any editor and press Alt+T - see
 *       fixtures/test_data_watch.cjs (Windows)
 *   npm run testdata:show   -- sanity/Flow_06.spec.js
 *       what is test data (and its value), what is a value test data already holds,
 *       and the other values that could become test data - with line:column
 *   npm run testdata:toggle -- sanity/Flow_06.spec.js:58:40
 *       the value at line 58, column 40 becomes test data - or the testData reference
 *       there becomes its value again - and so does every other place in the spec with the
 *       same value (or key), except lines marked // testdata:keep, --exclude 12,40 lines,
 *       or all of them with --only-here
 *   npm run testdata:toggle -- sanity/Flow_06.spec.js:58:40-58:54 --key pickupCity
 *       just that text, under that key name
 *   npm run testdata:toggle -- sanity/Flow_06.spec.js --line 58 --text "Greensboro, NC"
 *       the text as selected in an editor
 *   npm run testdata:link   -- sanity regression
 *       every value in an XPath that the spec already keeps as test data becomes that
 *       variable (what the recorder does for new specs)
 * Options: --key <name>, --new (a new key even when one holds the value), --only-here,
 * --exclude <lines>, --dry-run, --json.
 *
 * New keys go into the test-data.json the spec imports and its test-data.base.json, then
 * the spec is written, then its healed copy (healed/...) is brought up to date with
 * fixtures/prepare_healed_spec.js. The selector a spec builds stays exactly the same for
 * the current test data. The rules are in fixtures/test_data_links.cjs - the same file the
 * Qualibrix recorder and spec editor use.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const links = require('./test_data_links.cjs');

const SKIPPED_FOLDERS = new Set(['node_modules', '.git', 'test-results', 'playwright-report', 'allure-results', 'allure-report', 'fixtures', 'healed', 'masked']);
const SPEC_FILE = /\.spec\.[cm]?[jt]s$/i;
const HEALED_SPEC_FILE = /\.healed\.spec\.[cm]?[jt]s$/i;

class UsageError extends Error {}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function shown(value) {
  if (typeof value !== 'string') return String(value);
  return JSON.stringify(value.length > 70 ? `${value.slice(0, 67)}...` : value);
}

function relative(file) {
  return path.relative(process.cwd(), file).replace(/\\/g, '/') || '.';
}

// A spec as text with \n line ends; write() puts back its own line ends and BOM.
function readSpec(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const bom = raw.startsWith('﻿');
  const body = bom ? raw.slice(1) : raw;
  const crlf = body.includes('\r\n');
  return {
    file,
    text: crlf ? body.replace(/\r\n/g, '\n') : body,
    write(text) {
      writeAtomic(file, (bom ? '﻿' : '') + (crlf ? text.replace(/\r?\n/g, '\r\n') : text));
    },
  };
}

function writeAtomic(file, content) {
  const temporary = path.join(path.dirname(file), `${path.basename(file)}.sync-${process.pid}.tmp`);
  fs.writeFileSync(temporary, content, 'utf8');
  try {
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch (_) { /* already gone */ }
    throw error;
  }
}

function readJsonObject(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (!text.trim()) return {};
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${relative(file)} is not valid JSON (${error.message}); fix it first.`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${relative(file)} must hold one JSON object of key: value.`);
  return value;
}

// The healer works on a spec under these locks (fixtures/prepare_healed_spec.js); never write under them.
function lockedBy(file) {
  const name = path.basename(file);
  if (fs.existsSync(`${file}.healing.lock`)) return `${name}.healing.lock`;
  try {
    const marker = fs.readdirSync(path.dirname(file)).find((entry) => entry.startsWith(`${name}.running-`) && entry.endsWith('.lock'));
    return marker || null;
  } catch (_) {
    return null;
  }
}

function findProjectRoot(file) {
  let current = path.dirname(path.resolve(file));
  for (let depth = 0; depth < 12; depth += 1) {
    if (fs.existsSync(path.join(current, 'playwright.config.js')) || fs.existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.dirname(path.resolve(file));
}

function basePathOf(dataPath) {
  const name = path.basename(dataPath);
  return path.join(path.dirname(dataPath), name === 'test-data.json' ? 'test-data.base.json' : name.replace(/\.json$/i, '.base.json'));
}

/*
 * The test data a spec reads: the file its import names (what it reads when it runs),
 * else the project's test-data.json. With the editor's view of it (store).
 */
function testDataFor(spec, text) {
  const analysis = links.analyze(text);
  const dataPath = analysis.dataImport && analysis.dataImport.path
    ? path.resolve(path.dirname(spec), analysis.dataImport.path)
    : path.join(findProjectRoot(spec), 'test-data.json');
  const basePath = basePathOf(dataPath);
  const data = readJsonObject(dataPath);
  const baseExists = fs.existsSync(basePath);
  const base = baseExists ? readJsonObject(basePath) : {};
  const fields = Object.entries(data).map(([key, value]) => {
    const secret = links.isSecretKey(key);
    const field = { key, secret };
    if (!secret && ['string', 'number', 'boolean'].includes(typeof value)) {
      field.value = value;
      if (Object.prototype.hasOwnProperty.call(base, key) && JSON.stringify(base[key]) !== JSON.stringify(value)) field.original = base[key];
    }
    return field;
  });
  let importPath = path.relative(path.dirname(spec), dataPath).replace(/\\/g, '/');
  if (!importPath.startsWith('.')) importPath = `./${importPath}`;
  return { dataPath, basePath, data, base, baseExists, importPath, store: links.normalizeFields(fields), keys: new Set(Object.keys(data)) };
}

function isUnderSuite(file) {
  let current = path.dirname(path.resolve(file));
  for (let depth = 0; depth < 8; depth += 1) {
    const name = path.basename(current).toLowerCase();
    if (name === 'sanity' || name === 'regression') return true;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return false;
}

// The healed copy follows the spec (or the spec follows its healed copy), keeping healed locators.
function syncHealedCopy(spec) {
  let prepare;
  try {
    prepare = require('./prepare_healed_spec.js');
  } catch (error) {
    return { ok: false, message: `healed copy not updated: fixtures/prepare_healed_spec.js did not load (${error.message}); run npm install` };
  }
  try {
    if (HEALED_SPEC_FILE.test(spec)) {
      if (typeof prepare.syncSourceFromHealed !== 'function') return { ok: false, message: 'spec not updated from its healed copy: this prepare_healed_spec.js cannot do that' };
      const result = prepare.syncSourceFromHealed(spec);
      return { ok: true, message: `spec updated from the healed copy: ${relative(result.sourceFile)}` };
    }
    if (!isUnderSuite(spec)) return { ok: true, message: 'no healed copy (not under sanity/ or regression/)' };
    const result = prepare.prepareHealedSpec(spec);
    if (result.deferred) return { ok: true, message: `healed copy ${relative(result.outputFile)} is in use by a test run; it follows when the run ends` };
    return { ok: true, message: `healed copy ${result.updated === false ? 'already up to date' : 'updated'}: ${relative(result.outputFile)}` };
  } catch (error) {
    return { ok: false, message: `healed copy not updated: ${error.message}` };
  }
}

function addKeys(info, additions) {
  const names = Object.keys(additions);
  if (!names.length) return [];
  const added = names.filter((key) => !Object.prototype.hasOwnProperty.call(info.data, key));
  if (added.length) {
    writeAtomic(info.dataPath, `${JSON.stringify({ ...info.data, ...pick(additions, added) }, null, 2)}\n`);
  }
  // The backend rebuilds test-data.json from its base before runs: a new key must be there too.
  const baseAdded = info.baseExists ? names.filter((key) => !Object.prototype.hasOwnProperty.call(info.base, key)) : [];
  if (baseAdded.length) {
    writeAtomic(info.basePath, `${JSON.stringify({ ...info.base, ...pick(additions, baseAdded) }, null, 2)}\n`);
  }
  return added;
}

function pick(object, keys) {
  return Object.fromEntries(keys.map((key) => [key, object[key]]));
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

function offsetOf(text, line, column) {
  const lines = text.split('\n');
  if (!Number.isInteger(line) || line < 1 || line > lines.length) throw new UsageError(`Line ${line} is not in the file (it has ${lines.length}).`);
  const content = lines[line - 1];
  if (!Number.isInteger(column) || column < 1 || column > content.length + 1) throw new UsageError(`Column ${column} is not on line ${line} (it has ${content.length + 1}).`);
  let offset = 0;
  for (let index = 0; index < line - 1; index += 1) offset += lines[index].length + 1;
  return offset + column - 1;
}

function positionOf(text, offset) {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - before.lastIndexOf('\n') };
}

function where(text, offset) {
  const { line, column } = positionOf(text, offset);
  return `${line}:${column}`;
}

/*
 * <spec>:<line>:<column>[-<line>:<column>], or <spec> with --line and --text (and
 * --column to choose between the same text twice on that line).
 */
function parseTarget(argument, options) {
  const match = /^(.*):(\d+):(\d+)(?:-(\d+):(\d+))?$/.exec(argument || '');
  if (match && !fs.existsSync(argument)) {
    return { file: path.resolve(match[1]), start: [Number(match[2]), Number(match[3])], end: match[4] ? [Number(match[4]), Number(match[5])] : null };
  }
  if (!argument) throw new UsageError('Name the spec: testdata:toggle -- <spec>:<line>:<column>');
  const line = Number.parseInt(options.line, 10);
  const column = Number.parseInt(options.column, 10);
  if (!Number.isInteger(line)) throw new UsageError('Give the place: <spec>:<line>:<column>, or --line <n> with --text "<selected text>".');
  // An editor shortcut passes what is selected; with nothing selected that is "".
  if (options.text === '' && !Number.isInteger(column)) throw new Error('Select the value (or the testData reference) first, then toggle.');
  if (options.text) return { file: path.resolve(argument), line, column: Number.isInteger(column) ? column : null, text: options.text };
  if (!Number.isInteger(column)) throw new UsageError('Give the column (--column <n>) or the selected text (--text "...").');
  return { file: path.resolve(argument), start: [line, column], end: null };
}

function selectionOf(target, text) {
  if (target.start) {
    const start = offsetOf(text, target.start[0], target.start[1]);
    const end = target.end ? offsetOf(text, target.end[0], target.end[1]) : start;
    return end < start ? [end, start] : [start, end];
  }
  const lineStart = offsetOf(text, target.line, 1);
  const lineEnd = text.indexOf('\n', lineStart) === -1 ? text.length : text.indexOf('\n', lineStart);
  let found = [];
  for (let at = text.indexOf(target.text, lineStart); at !== -1 && at <= lineEnd; at = text.indexOf(target.text, at + 1)) found.push(at);
  if (!found.length) throw new UsageError(`${shown(target.text)} is not on line ${target.line}.`);
  // Whole words first: testData.city is not the start of testData.cityName. Part of a word
  // only inside a string, where a selection may cut a value.
  const isWord = (character) => Boolean(character) && /[\w$]/.test(character);
  const size = target.text.length;
  const whole = found.filter((at) => !(isWord(target.text[0]) && isWord(text[at - 1])) &&
    !(isWord(target.text[size - 1]) && isWord(text[at + size])));
  if (whole.length) {
    found = whole;
  } else {
    const strings = links.analyze(text).tokens.filter((token) => token.type === 'string' || token.type === 'template');
    found = found.filter((at) => strings.some((token) => token.start < at && at + size < token.end));
    if (!found.length) throw new UsageError(`${shown(target.text)} is on line ${target.line} only as part of a longer name.`);
  }
  let at = found[0];
  if (found.length > 1) {
    if (!target.column) throw new UsageError(`${shown(target.text)} is on line ${target.line} ${found.length} times; give --column too.`);
    const caret = lineStart + target.column - 1;
    at = found.reduce((best, item) => (Math.abs(item - caret) < Math.abs(best - caret) ? item : best), found[0]);
  }
  return [at, at + target.text.length];
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/*
 * Can `key` hold `value` in this test data? null when it can, else why not. A key that holds the
 * value already (or recorded it, for a faker field) is used as it is.
 */
function keyProblem(info, key, value) {
  if (!links.isValidKey(key)) return `${shown(key)} cannot be a key: use letters, digits, _ and $, not starting with a digit.`;
  if (!info.keys.has(key)) return null;
  if (links.isSecretKey(key) || info.store.secrets.has(key)) return `${key} is a password field; choose another key name.`;
  if (info.store.values[key] === value || info.store.originals[key] === value) return null;
  return `${key} already holds ${shown(info.data[key])}; choose another key name.`;
}

/*
 * A toggle planned with test_data_links (planToggleAt / planToggleForText), applied to the
 * chosen places: new key into test data (and its base), then the spec, then its healed copy.
 * choice: { key } for a value, { value, quote } for a reference; dryRun writes nothing.
 * The test runner and the key watcher (test_data_watch.cjs) both use this.
 */
function commitToggle(spec, info, plan, chosen, choice) {
  if (!chosen.length) throw new Error('No place is chosen.');
  let applied;
  let added = [];
  if (plan.kind === 'ref') {
    applied = links.applyReferenceToggle(spec.text, chosen, choice.value, { quote: choice.quote });
  } else {
    const problem = keyProblem(info, choice.key, plan.value);
    if (problem) throw new Error(problem);
    applied = links.applyValueToggle(spec.text, chosen, choice.key, { importPath: info.importPath });
    if (!info.keys.has(choice.key)) added = [choice.key];
  }
  if (!applied.ok) throw new Error(applied.reason);
  const result = { text: applied.text, quote: applied.quote || null, count: chosen.length, testDataAdded: added };
  if (!choice.dryRun) {
    const lock = lockedBy(spec.file);
    if (lock) throw new Error(`The healer is working on this spec right now (${lock}); try again when the run ends.`);
    if (added.length) addKeys(info, { [choice.key]: plan.value });
    spec.write(applied.text);
    result.healed = syncHealedCopy(spec.file);
  }
  return result;
}

// --exclude 12,40 or 12:30 -> which places stay as they are.
function excludedBy(option) {
  const items = String(option || '').split(',').map((item) => item.trim()).filter(Boolean);
  for (const item of items) if (!/^\d+(?::\d+)?$/.test(item)) throw new UsageError(`--exclude takes lines (12) or line:column (12:30), comma separated: ${item}`);
  return (place) => items.some((item) => item === String(place.line) || item === `${place.line}:${place.column}`);
}

function toggle(argument, options) {
  const target = parseTarget(argument, options);
  if (!fs.existsSync(target.file)) throw new UsageError(`No such spec: ${relative(target.file)}`);
  const spec = readSpec(target.file);
  const [start, end] = selectionOf(target, spec.text);
  const info = testDataFor(spec.file, spec.text);
  const plan = links.planToggleAt(spec.text, start, end, info.store);
  if (plan.kind === 'none') throw new Error(plan.reason);

  // Every place with the same value (or key), except: --only-here, --exclude, // testdata:keep lines.
  const excluded = excludedBy(options.exclude);
  const skipped = [];
  const chosen = plan.places.filter((place) => {
    let reason = null;
    if (!place.current) {
      if (options.onlyHere) reason = '--only-here';
      else if (excluded(place)) reason = '--exclude';
      else if (place.kept) reason = 'testdata:keep';
      else if (place.blocked) reason = place.blocked;
    }
    if (reason) skipped.push({ at: `${place.line}:${place.column}`, reason });
    return !reason;
  });
  const result = { ok: true, file: relative(spec.file), at: where(spec.text, start), places: chosen.map((place) => `${place.line}:${place.column}`), skipped };

  if (plan.kind === 'ref') {
    const name = `${plan.dataName}.${plan.key}`;
    if (plan.secret) throw new Error(`${name} looks like a password, so it stays in test data.`);
    const value = plan.original !== undefined ? plan.original : plan.value;
    const committed = commitToggle(spec, info, plan, chosen, { value, quote: options.quote, dryRun: options.dryRun });
    Object.assign(result, { action: 'inlined', key: plan.key, value, text: committed.text, testDataAdded: [], healed: committed.healed });
    result.summary = `${name} -> ${shown(value)} in ${placesLabel(chosen)} (the key stays in test data)`;
  } else {
    let key = options.key;
    if (!key) key = plan.matches.length && !options.new ? plan.matches[0] : plan.suggestedKey;
    if (options.new && !options.key && plan.matches.includes(key)) key = links.suggestKeyName(spec.text, plan.start, plan.value, info.keys);
    const problem = keyProblem(info, key, plan.value);
    if (problem) throw (links.isValidKey(key) ? new Error(problem) : new UsageError(problem));
    const committed = commitToggle(spec, info, plan, chosen, { key, dryRun: options.dryRun });
    Object.assign(result, { action: 'linked', key, value: plan.value, text: committed.text, testDataAdded: committed.testDataAdded, healed: committed.healed });
    result.summary = `${shown(plan.value)} -> ${plan.dataName}.${key} in ${placesLabel(chosen)}${committed.testDataAdded.length ? ` (new key, added to ${relative(info.dataPath)})` : ''}`;
    if (!options.key && !plan.matches.length) result.summary += `\n  Named it ${key}; to choose the name, toggle it back and run again with --key <name>.`;
  }
  if (skipped.length) result.summary += `\n  Left as they are: ${skipped.map((item) => `${item.at} (${item.reason})`).join(', ')}`;
  return result;
}

function placesLabel(places) {
  return links.placesSummary(places);
}

function specFilesIn(paths) {
  const found = [];
  const visit = (directory, includeHealed) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name) || (includeHealed && entry.name === 'healed')) visit(full, includeHealed);
      } else if (SPEC_FILE.test(entry.name) && (includeHealed || !HEALED_SPEC_FILE.test(entry.name))) {
        found.push(full);
      }
    }
  };
  for (const item of paths.length ? paths : ['.']) {
    const full = path.resolve(item);
    if (!fs.existsSync(full)) throw new UsageError(`No such file or folder: ${item}`);
    if (fs.statSync(full).isDirectory()) visit(full, path.basename(full) === 'healed' || full.split(path.sep).includes('healed'));
    else found.push(full);
  }
  return [...new Set(found)].sort();
}

function link(paths, options) {
  const results = [];
  for (const file of specFilesIn(paths)) {
    const spec = readSpec(file);
    const info = testDataFor(file, spec.text);
    const linked = links.linkXPathValuesToTestData(spec.text, links.linkableValues(info.store));
    if (!linked.links.length) continue;
    const item = { file: relative(file), links: linked.links.map((entry) => entry.key) };
    if (!options.dryRun) {
      const lock = lockedBy(file);
      if (lock) {
        item.skipped = `the healer is working on it (${lock})`;
        results.push(item);
        continue;
      }
      spec.write(linked.text);
      item.healed = syncHealedCopy(file);
    }
    results.push(item);
  }
  return { ok: true, action: 'link', dryRun: Boolean(options.dryRun), results };
}

function show(paths) {
  const results = [];
  for (const file of specFilesIn(paths)) {
    const spec = readSpec(file);
    const info = testDataFor(file, spec.text);
    const { ranges, dataName, ownData } = links.highlightRanges(spec.text, info.store);
    const items = ranges.map((range) => {
      const item = { kind: range.kind, at: where(spec.text, range.start), text: spec.text.slice(range.start, range.end) };
      if (range.key) item.key = range.key;
      if (range.kind === 'ref') {
        if (info.store.secrets.has(range.key)) item.note = 'password';
        else if (!info.keys.has(range.key)) item.note = 'not in test data';
        else {
          item.value = info.store.values[range.key];
          if (info.store.originals[range.key] !== undefined) item.original = info.store.originals[range.key];
        }
      }
      return item;
    });
    const result = { file: relative(file), testData: relative(info.dataPath), dataName, items };
    if (ownData) result.note = ownData.reason;
    results.push(result);
  }
  return { ok: true, action: 'show', results };
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

const LABELS = { ref: 'test data', candidate: 'linkable ', value: 'value    ' };

function print(result) {
  if (result.action === 'show') {
    for (const spec of result.results) {
      const counts = { ref: 0, candidate: 0, value: 0 };
      console.log(`${spec.file}  (test data: ${spec.testData})`);
      if (spec.note) console.log(`  ${spec.note}`);
      for (const item of spec.items) {
        counts[item.kind] += 1;
        let detail = shown(item.text);
        if (item.kind === 'ref') {
          detail = item.text;
          if (item.note) detail += `  (${item.note})`;
          else detail += ` = ${shown(item.value)}${item.original !== undefined ? ` (recorded ${shown(item.original)})` : ''}`;
        } else if (item.kind === 'candidate') {
          detail += ` is ${spec.dataName}.${item.key}  -> npm run testdata:link`;
        }
        console.log(`  ${LABELS[item.kind]}  ${item.at.padEnd(8)} ${detail}`);
      }
      console.log(`  ${counts.ref} test data, ${counts.candidate} linkable, ${counts.value} other values\n`);
    }
    return;
  }
  if (result.action === 'link') {
    if (!result.results.length) {
      console.log('Nothing to link: no XPath value is held by the test data its spec reads.');
      return;
    }
    for (const item of result.results) {
      const verb = result.dryRun ? 'would link' : item.skipped ? 'skipped' : 'linked';
      console.log(`${item.file}: ${verb} ${item.links.length} (${[...new Set(item.links)].join(', ')})${item.skipped ? ` - ${item.skipped}` : ''}`);
      if (item.healed) console.log(`  ${item.healed.message}`);
    }
    return;
  }
  console.log(`${result.file}:${result.at}  ${result.summary}`);
  if (result.healed) console.log(`  ${result.healed.message}`);
  if (!result.healed) console.log('  (dry run: nothing written)');
}

function parseOptions(argv) {
  const options = { paths: [] };
  const valued = new Set(['key', 'line', 'column', 'text', 'quote', 'exclude', 'hotkey']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      options.paths.push(argument);
      continue;
    }
    const [name, inline] = argument.slice(2).split(/=(.*)/s);
    const camel = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (valued.has(name)) {
      const value = inline !== undefined ? inline : argv[++index];
      if (value === undefined) throw new UsageError(`--${name} needs a value.`);
      options[camel] = value;
    } else if (['dry-run', 'json', 'new', 'help', 'only-here'].includes(name)) {
      options[camel] = true;
    } else {
      throw new UsageError(`Unknown option --${name}.`);
    }
  }
  if (options.quote !== undefined && options.quote !== '"' && options.quote !== "'") throw new UsageError('--quote is " or \'.');
  return options;
}

const HELP = `Test data in this project's specs: values <-> testData.

  npm run testdata:watch                select a value in any editor, press Alt+T (Windows)
  npm run testdata:show   -- [<spec or folder> ...]
  npm run testdata:toggle -- <spec>:<line>:<column>[-<line>:<column>] [--key <name>] [--new]
  npm run testdata:toggle -- <spec> --line <n> --text "<selected text>" [--column <n>]
  npm run testdata:link   -- [<spec or folder> ...]

  toggle changes the value (or testData.<key>) at that place AND every other place in the spec
  with the same value (or key), except lines marked // testdata:keep and:
  --only-here       just that place
  --exclude 12,40   not the places on these lines (or line:column)
  --key <name>      name for a new test-data key (default: suggested, or the key that holds the value)
  --new             a new key even when an existing key holds the value
  --dry-run         show what would change, write nothing
  --json            print the result as JSON
  --hotkey <keys>   (watch) another key than Alt+T, e.g. Ctrl+Alt+T`;

function main(argv) {
  const [command, ...rest] = argv;
  try {
    const options = parseOptions(rest);
    if (!command || options.help || ['help', '--help', '-h', '/?'].includes(command)) {
      console.log(HELP);
      return 0;
    }
    let result;
    if (command === 'watch') {
      // Runs until stopped; the exit code comes when it ends.
      require('./test_data_watch.cjs').run({ root: process.cwd(), hotkey: options.hotkey || 'Alt+T' })
        .then((code) => { process.exitCode = code; });
      return undefined;
    }
    if (command === 'toggle') {
      if (options.paths.length > 1) throw new UsageError('toggle takes one spec.');
      result = toggle(options.paths[0], options);
    } else if (command === 'link') {
      result = link(options.paths, options);
    } else if (command === 'show') {
      result = show(options.paths);
    } else {
      throw new UsageError(`Unknown command "${command}": use watch, toggle, link or show.`);
    }
    if (options.json) {
      const { text, ...printable } = result;
      console.log(JSON.stringify(printable, null, 2));
    } else {
      print(result);
    }
    return result.healed && !result.healed.ok ? 3 : 0;
  } catch (error) {
    console.error(`testdata ${command || ''}: ${error.message}`);
    if (error instanceof UsageError) console.error(`\n${HELP}`);
    return error instanceof UsageError ? 2 : 1;
  }
}

module.exports = {
  main, toggle, link, show,
  // for test_data_watch.cjs
  readSpec, testDataFor, commitToggle, keyProblem, specFilesIn, relative, shown,
};

// Last, after the exports: `watch` loads test_data_watch.cjs, which reads them from this file.
if (require.main === module) {
  const code = main(process.argv.slice(2));
  if (code !== undefined) process.exitCode = code;
}
