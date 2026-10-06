// backend/tests/fixtures/prepare_healed_spec.js
//
// Mirrors a generated sanity/regression spec into tests/healed/<suite>/.
// Imports stay file-specific. Only the test(() => { ... }) body is kept in sync.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// Spec synchronization stays silent during test execution.
const console = Object.freeze({ log() {}, warn() {}, error() {} });

const LOCATOR_FACTORY_METHODS = new Set([
  'locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder',
  'getByTestId', 'getByAltText', 'getByTitle', 'filter', 'first', 'last', 'nth', 'and', 'or',
]);

// The executing module keeps its original source locations even after a repair.
// Keep that baseline and apply each subsequent edit against its original ranges.
const editors = new Map();

function canonicalFile(file) {
  const absolute = path.resolve(file);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function assertHealedSpec(file) {
  if (!/\.healed\.spec\.[cm]?[jt]sx?$/i.test(file)) throw new Error('Only a .healed.spec file may be updated; original specs are read-only to the healer');
  let directory = path.dirname(file);
  while (path.basename(directory).toLowerCase() !== 'healed') {
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error('Refusing to edit a spec outside a healed folder');
    directory = parent;
  }
  const actualRoot = fs.realpathSync(directory);
  const actualFile = fs.realpathSync(file);
  const relative = path.relative(actualRoot, actualFile);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ||
      canonicalFile(actualFile) !== canonicalFile(file)) {
    throw new Error('Refusing a redirected/symlinked healed spec path');
  }
}

function createHealedSpecEditor(specFile) {
  const file = path.resolve(specFile);
  assertHealedSpec(file);
  const key = canonicalFile(file);
  if (editors.has(key)) return editors.get(key);
  const baseline = fs.readFileSync(file, 'utf8');
  let expected = baseline;
  let tree = null;
  const edits = new Map();
  const lineStarts = [0];
  for (let i = 0; i < baseline.length; i += 1) if (baseline[i] === '\n') lineStarts.push(i + 1);

  function parse(source) {
    let parser;
    try { parser = require('@babel/parser'); }
    catch (_) { throw new Error('Spec updates require @babel/parser. Run npm install --save-dev @babel/parser in Moon.'); }
    return parser.parse(source, {
      sourceType: 'unambiguous',
      plugins: /\.[cm]?tsx?$/i.test(file) ? ['typescript', ...(/\.tsx$/i.test(file) ? ['jsx'] : [])] : ['jsx'],
    });
  }

  function methodOf(node) {
    return node?.type === 'CallExpression' && node.callee?.type === 'MemberExpression' &&
      !node.callee.computed && node.callee.property.type === 'Identifier' ? node.callee.property.name : null;
  }

  function indexTree() {
    if (tree) return tree;
    const ast = parse(baseline);
    const calls = [];
    const parents = new WeakMap();
    function visit(node, parent) {
      if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
      if (parent) parents.set(node, parent);
      if (LOCATOR_FACTORY_METHODS.has(methodOf(node))) calls.push(node);
      for (const [name, value] of Object.entries(node)) {
        if (['loc', 'tokens', 'comments', 'leadingComments', 'trailingComments', 'innerComments', 'extra'].includes(name)) continue;
        if (Array.isArray(value)) for (const child of value) visit(child, node);
        else if (value && typeof value === 'object') visit(value, node);
      }
    }
    visit(ast, null);
    tree = { calls, parents };
    return tree;
  }

  function chainIncludes(outer, inner) {
    let current = outer;
    while (current?.type === 'CallExpression') {
      if (current === inner) return true;
      if (current.callee?.type !== 'MemberExpression') break;
      current = current.callee.object;
    }
    return false;
  }

  function callAt(site) {
    if (!site || canonicalFile(site.file) !== key || !Number.isInteger(site.line) || !Number.isInteger(site.column)) {
      throw new Error('The locator does not have a precise construction location in this healed spec');
    }
    const start = lineStarts[site.line - 1];
    const offset = start + site.column - 1;
    if (start === undefined || site.column < 1) throw new Error('Invalid locator source position');
    const matches = indexTree().calls.filter(node => methodOf(node) === site.method && node.start <= offset && offset < node.end);
    matches.sort((a, b) => (a.end - a.start) - (b.end - b.start));
    if (!matches.length || matches.some(node => !chainIncludes(node, matches[0]))) {
      throw new Error('Cannot map the locator stack location to exactly one source chain; no guessed edit was made');
    }
    return matches[0];
  }

  function checkDisk() {
    assertHealedSpec(file);
    if (fs.readFileSync(file, 'utf8') !== expected) {
      throw new Error('The healed spec was changed by another worker/editor; refusing to overwrite those changes');
    }
  }

  function render(proposed) {
    let result = baseline;
    const ordered = [...proposed.values()].sort((a, b) => b.start - a.start);
    let rightBoundary = baseline.length;
    for (const edit of ordered) {
      if (edit.end > rightBoundary) throw new Error('Locator repairs overlap; refusing an ambiguous source edit');
      result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
      rightBoundary = edit.start;
    }
    parse(result); // Parse only: never execute source supplied by the model/spec.
    return result;
  }

  const editor = {
    file,
    describeIntent(origin, immediateAction, operationSite = null) {
      // Read only straight-line uses of this exact binding. No execution,
      // source-text similarity, cross-variable guesses, or fill values.
      let node = callAt(origin?.site);
      const { parents } = indexTree();
      for (;;) {
        const member = parents.get(node), outer = member && parents.get(member);
        if (member?.type !== 'MemberExpression' || member.object !== node ||
            outer?.callee !== member || !LOCATOR_FACTORY_METHODS.has(methodOf(outer))) break;
        node = outer;
      }
      const declaration = parents.get(node), statement = declaration && parents.get(declaration);
      const block = statement && parents.get(statement);
      const fallback = { immediate_action: immediateAction, intended_action: immediateAction, operations: [], source: 'current-operation-only' };
      if (declaration?.type !== 'VariableDeclarator' || declaration.init !== node || declaration.id.type !== 'Identifier' ||
          statement?.type !== 'VariableDeclaration' || statement.declarations.length !== 1 ||
          !Array.isArray(block?.body)) return fallback;
      const name = declaration.id.name, operations = [];
      const actions = new Set(['click', 'dblclick', 'fill', 'type', 'press', 'pressSequentially', 'hover', 'check', 'uncheck', 'setChecked', 'selectOption', 'setInputFiles']);
      // A reused binding may have an earlier click and a later fill. Start at
      // the CURRENT operation's source location, never its first historical use.
      if (!operationSite || canonicalFile(operationSite.file) !== key) return fallback;
      const operationOffset = lineStarts[operationSite.line - 1] + operationSite.column - 1;
      const operationIndex = block.body.findIndex(item => item.start <= operationOffset && operationOffset < item.end);
      if (operationIndex <= block.body.indexOf(statement)) return fallback;
      for (const next of block.body.slice(operationIndex)) {
        const expression = next.type === 'ExpressionStatement' && next.expression?.type === 'AwaitExpression' ? next.expression.argument : null;
        if (!expression || expression.type !== 'CallExpression') break;
        const method = methodOf(expression), object = expression.callee?.object;
        if (object?.type === 'Identifier' && object.name === name && actions.has(method)) {
          operations.push({ method, line: next.loc.start.line });
          // Do not stop at a focus click: the next use may be fill().
          // This reads intent only; the test still executes one operation at a time.
          continue;
        }
        let assertionTarget = object, negated = false;
        if (object?.type === 'MemberExpression' && !object.computed && object.property?.name === 'not') {
          negated = true; assertionTarget = object.object;
        }
        const isExpect = assertionTarget?.type === 'CallExpression' && assertionTarget.callee?.type === 'Identifier' &&
          assertionTarget.callee.name === 'expect' && assertionTarget.arguments?.[0]?.type === 'Identifier' &&
          assertionTarget.arguments[0].name === name;
        if (!isExpect || !/^to[A-Z]/.test(method || '')) break;
        operations.push({ method, line: next.loc.start.line, ...(negated ? { negated: true } : {}) });
      }
      const actionMethods = operations.filter(item => actions.has(item.method)).map(item => item.method);
      const editsText = actionMethods.some(method => ['fill', 'type', 'pressSequentially'].includes(method));
      const clicks = actionMethods.some(method => ['click', 'dblclick'].includes(method));
      // Choose an evidence-backed target compatible with the whole consecutive
      // use, especially enabled -> click -> fill. Never inspect another binding.
      const intended = editsText ? 'fill' : actionMethods.includes('selectOption') ? 'selectOption' :
        actionMethods.find(method => ['check', 'uncheck', 'setChecked', 'setInputFiles'].includes(method)) ||
        (clicks ? 'click' : actionMethods[0]) || immediateAction;
      return { immediate_action: immediateAction, intended_action: intended, locator_variable: name,
        declaration_line: statement.loc.start.line, operations,
        requirements: { assertion_only: actionMethods.length === 0, click: clicks, editable: editsText },
        source: 'same-binding-straight-line-source' };
    },
    plan(origin, xpath) {
      checkDisk();
      if (typeof xpath !== 'string' || !xpath.trim()) throw new Error('A proven XPath is required');
      const root = callAt(origin?.root);
      let node = callAt(origin?.site);
      const { parents } = indexTree();
      // Include chained locator refinements, but never an action/assertion or a
      // containing filter's argument. Only walk the callee.object relationship.
      for (;;) {
        const member = parents.get(node);
        const outer = member && parents.get(member);
        if (member?.type !== 'MemberExpression' || member.object !== node || outer?.callee !== member ||
            !LOCATOR_FACTORY_METHODS.has(methodOf(outer))) break;
        node = outer;
      }
      if (!chainIncludes(node, root)) {
        throw new Error('A locator alias/helper splits this source chain; refusing to guess its page/frame scope');
      }
      const scope = root.callee.object;
      if (!scope || scope.start === undefined) throw new Error('Missing source page/frame scope');
      const scopeCode = baseline.slice(scope.start, scope.end);
      const replacement = `${scopeCode}.locator(${JSON.stringify(`xpath=${xpath}`)})`;
      const edit = { start: node.start, end: node.end, replacement };
      const editKey = `${edit.start}:${edit.end}`;
      const proposed = new Map(edits);
      proposed.set(editKey, edit);
      render(proposed);
      return {
        file, line: node.loc.start.line,
        original_expression: baseline.slice(node.start, node.end),
        replacement_expression: replacement,
        commit() {
          // Cooperating Playwright workers must not pass the compare/write
          // check simultaneously. Never remove somebody else's lock.
          const lockFile = `${file}.healing.lock`;
          const lock = fs.openSync(lockFile, 'wx');
          try {
            checkDisk();
            const nextEdits = new Map(edits);
            nextEdits.set(editKey, edit);
            const next = render(nextEdits);
            if (next === expected) return { updated: true, file, line: node.loc.start.line, unchanged: true };
            const temporary = `${file}.healing-${crypto.randomBytes(8).toString('hex')}.tmp`;
            let created = false;
            try {
              fs.writeFileSync(temporary, next, { encoding: 'utf8', flag: 'wx', mode: fs.statSync(file).mode });
              created = true;
              checkDisk();
              fs.renameSync(temporary, file);
              created = false;
            } finally {
              if (created) try { fs.unlinkSync(temporary); } catch (_) {}
            }
            expected = next;
            edits.set(editKey, edit);
            try {
              syncSourceFromHealed(file, { fromCommit: true });
            } catch (error) {
              console.warn('[healed-spec] Could not mirror this repair into the source spec: ' + error.message);
            }
            return { updated: true, file, line: node.loc.start.line,
              original_expression: baseline.slice(node.start, node.end), replacement_expression: replacement };
          } finally {
            try { fs.closeSync(lock); } catch (error) { console.warn(`[healed-spec] Lock close: ${error.message}`); }
            try { fs.unlinkSync(lockFile); } catch (error) { console.warn(`[healed-spec] Could not remove owned lock ${lockFile}: ${error.message}`); }
          }
        },
      };
    },
  };
  editors.set(key, editor);
  return editor;
}

function slash(value) {
  return String(value).replace(/\\/g, '/');
}

function relativeModule(fromDirectory, absoluteTarget) {
  let result = slash(path.relative(fromDirectory, absoluteTarget));
  if (!result.startsWith('.')) result = `./${result}`;
  return result;
}

function locateSuite(sourceFile) {
  let current = path.dirname(sourceFile);
  for (let index = 0; index < 8; index += 1) {
    const name = path.basename(current).toLowerCase();
    if (name === 'sanity' || name === 'regression') {
      return { suiteName: name, suiteDirectory: current, testsRoot: path.dirname(current) };
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Source spec is not under a sanity or regression folder: ${sourceFile}`);
}

function rewriteRelativeModules(source, sourceDirectory, outputDirectory) {
  const rewrite = moduleName => {
    if (!moduleName.startsWith('.')) return moduleName;
    return relativeModule(outputDirectory, path.resolve(sourceDirectory, moduleName));
  };

  let result = source.replace(
    /(\bfrom\s*)(['"])(\.[^'"\r\n]+)\2/g,
    (_match, prefix, quote, moduleName) => `${prefix}${quote}${rewrite(moduleName)}${quote}`
  );
  result = result.replace(
    /(\brequire\(\s*)(['"])(\.[^'"\r\n]+)\2(\s*\))/g,
    (_match, prefix, quote, moduleName, suffix) =>
      `${prefix}${quote}${rewrite(moduleName)}${quote}${suffix}`
  );
  return result;
}

function isTestCallee(node) {
  if (!node) return false;
  if (node.type === 'Identifier' && node.name === 'test') return true;
  return node.type === 'MemberExpression' && !node.computed &&
    node.object?.type === 'Identifier' && node.object.name === 'test' &&
    ['only', 'skip', 'fixme', 'fail'].includes(node.property?.name);
}

function literalTitle(node) {
  if (!node) return '';
  if (node.type === 'StringLiteral' || (node.type === 'Literal' && typeof node.value === 'string')) return node.value;
  if (node.type === 'TemplateLiteral' && Array.isArray(node.expressions) && node.expressions.length === 0) {
    return node.quasis?.[0]?.value?.cooked || '';
  }
  return '';
}

function listTestCallbacks(source, file) {
  const ast = parseSyncSource(source, file);
  const tests = [];
  function visit(node) {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
    if (node.type === 'CallExpression' && isTestCallee(node.callee) && node.arguments.length >= 2) {
      const callback = node.arguments[node.arguments.length - 1];
      if (callback && (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression') &&
          callback.body && Number.isInteger(callback.body.start) && Number.isInteger(callback.body.end)) {
        tests.push({
          title: literalTitle(node.arguments[0]),
          start: callback.body.start,
          end: callback.body.end,
          code: source.slice(callback.body.start, callback.body.end),
        });
      }
    }
    for (const [name, value] of Object.entries(node)) {
      if (['loc', 'tokens', 'comments', 'leadingComments', 'trailingComments', 'innerComments', 'extra'].includes(name)) continue;
      if (Array.isArray(value)) for (const child of value) visit(child);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  tests.sort((a, b) => a.start - b.start);
  return tests;
}

function copyTestBodies(donorSource, targetSource, donorFile, targetFile, donorDirectory, targetDirectory) {
  const donorTests = listTestCallbacks(donorSource, donorFile);
  const targetTests = listTestCallbacks(targetSource, targetFile);
  if (!donorTests.length) throw new Error('No test(() => ...) body found in ' + donorFile);
  if (!targetTests.length) throw new Error('No test(() => ...) body found in ' + targetFile);
  const used = new Set();
  const replacements = [];
  for (let index = 0; index < targetTests.length; index += 1) {
    const targetTest = targetTests[index];
    let donorIndex = -1;
    if (targetTest.title) {
      donorIndex = donorTests.findIndex((item, itemIndex) => !used.has(itemIndex) && item.title === targetTest.title);
    }
    if (donorIndex < 0 && !used.has(index) && index < donorTests.length) donorIndex = index;
    if (donorIndex < 0) donorIndex = donorTests.findIndex((_item, itemIndex) => !used.has(itemIndex));
    if (donorIndex < 0) continue;
    used.add(donorIndex);
    const rewritten = rewriteRelativeModules(donorTests[donorIndex].code, donorDirectory, targetDirectory);
    if (rewritten !== targetTest.code) {
      replacements.push({ start: targetTest.start, end: targetTest.end, replacement: rewritten });
    }
  }
  let result = targetSource;
  for (const edit of replacements.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  parseSyncSource(result, targetFile);
  return { content: result, updated: replacements.length > 0 };
}

function jsString(value) {
  return `'${slash(value).replace(/'/g, "\\'")}'`;
}

function isPreambleLine(line) {
  const text = String(line || '').trim();
  if (!text) return true;
  if (text.startsWith('// AUTO-GENERATED') || text.startsWith('// Synced from') || text.startsWith('// Source (relative')) return true;
  if (/^import\s+testData\s+from\s+['"][^'"]+['"]\s*;?$/.test(text)) return true;
  if (/^const\s+testData\s*=\s*require\(\s*['"][^'"]+['"]\s*\)\s*;?$/.test(text)) return true;
  if (/^import\s*\{[^}]*\}\s*from\s*['"]@playwright\/test['"]\s*;?$/.test(text)) return true;
  if (/^const\s*\{[^}]*\}\s*=\s*require\(\s*['"]@playwright\/test['"]\s*\)\s*;?$/.test(text)) return true;
  if (/^const\s*\{[^}]*\}\s*=\s*require\(\s*['"][^'"]*walker_fixture\.js['"]\s*\)\s*;?$/.test(text)) return true;
  if (/^import\s*\{[^}]*\}\s*from\s*['"][^'"]*walker_fixture\.js['"]\s*;?$/.test(text)) return true;
  if (/^const\s*\{[^}]*\}\s*=\s*require\(\s*['"][^'"]*inline_healer\.js['"]\s*;?\s*\)\s*;?$/.test(text)) return true;
  if (/^const\s*\{[^}]*\}\s*=\s*require\(\s*['"][^'"]*inline_healer\.js['"]\s*\)\s*;?$/.test(text)) return true;
  if (/^import\s*\{[^}]*\}\s*from\s*['"][^'"]*inline_healer\.js['"]\s*;?$/.test(text)) return true;
  return false;
}

function stripSpecPreamble(source) {
  const lines = String(source || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  let index = 0;
  while (index < lines.length && isPreambleLine(lines[index])) index += 1;
  return lines.slice(index).join('\n').replace(/^\s+/, '');
}

function looksLikeHealWrapped(source) {
  return /require\(\s*['"][^'"]*inline_healer\.js['"]\s*\)/.test(source)
    || /\bheal\s*\(\s*(?:page|[\w$.]+)\s*,/.test(source);
}

function installCanonicalHealedHeader(body, fixtureModule, testDataModule) {
  const trimmed = stripSpecPreamble(body);
  return [
    `const { test, expect } = require(${jsString(fixtureModule)});`,
    `import testData from ${jsString(testDataModule)};`,
    '',
    trimmed,
  ].join('\n').replace(/\s+$/, '') + '\n';
}

function installCanonicalSourceHeader(body, testDataModule) {
  const trimmed = stripSpecPreamble(body);
  return [
    `import testData from ${jsString(testDataModule)};`,
    `import { test, expect } from '@playwright/test';`,
    '',
    trimmed,
  ].join('\n').replace(/\s+$/, '') + '\n';
}

function locateTestDataFile(fromFile) {
  for (const start of [path.dirname(fromFile), process.cwd()]) {
    let current = path.resolve(start);
    for (let index = 0; index < 12; index += 1) {
      const candidate = path.join(current, 'test-data.json');
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  try {
    return path.join(locateSuite(fromFile).testsRoot, 'test-data.json');
  } catch (_) {
    return path.resolve(path.dirname(fromFile), '..', '..', 'test-data.json');
  }
}

function removeSyncSidecar(file) {
  const stateFile = `${file}.sync.json`;
  if (fs.existsSync(stateFile)) {
    try { fs.unlinkSync(stateFile); } catch (_) {}
  }
}

function locateSourceFromHealed(healedFile) {
  const file = path.resolve(healedFile);
  assertHealedSpec(file);
  let directory = path.dirname(file);
  const parts = [];
  while (path.basename(directory).toLowerCase() !== 'healed') {
    parts.unshift(path.basename(directory));
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const testsRoot = path.dirname(directory);
  const sourceName = path.basename(file).replace(/\.healed\.spec\.([cm]?[jt]sx?)$/i, '.spec.$1');
  const candidates = [path.join(testsRoot, ...parts, sourceName)];
  if (!parts.length) {
    candidates.push(path.join(testsRoot, 'sanity', sourceName));
    candidates.push(path.join(testsRoot, 'regression', sourceName));
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not locate the source spec for ${file}`);
}

const inFlightSync = new Set();

function syncSourceFromHealed(healedFile, options = {}) {
  const file = path.resolve(healedFile);
  assertHealedSpec(file);
  const key = canonicalFile(file);
  if (inFlightSync.has(key)) return { updated: false, skipped: true, reason: 'in-flight' };
  inFlightSync.add(key);
  try {
    const sourceFile = locateSourceFromHealed(file);
    const sourceKey = canonicalFile(sourceFile);
    if (inFlightSync.has(sourceKey) && !options.fromCommit) {
      return { updated: false, skipped: true, reason: 'source-in-flight' };
    }
    inFlightSync.add(sourceKey);
    try {
      const healedContent = fs.readFileSync(file, 'utf8');
      const currentSource = fs.existsSync(sourceFile) ? fs.readFileSync(sourceFile, 'utf8') : '';
      if (looksLikeHealWrapped(healedContent) && currentSource && !looksLikeHealWrapped(currentSource)) {
        console.warn('[healed-sync] Skipping reverse sync because the healed spec is still heal()-wrapped.');
        return { updated: false, skipped: true, sourceFile, outputFile: file };
      }
      const healedDirectory = path.dirname(file);
      const sourceDirectory = path.dirname(sourceFile);
      if (!currentSource) {
        throw new Error('Source spec does not exist for reverse test-body sync: ' + sourceFile);
      }
      const copied = copyTestBodies(healedContent, currentSource, file, sourceFile, healedDirectory, sourceDirectory);
      if (!copied.updated) {
        removeSyncSidecar(file);
        return { updated: false, sourceFile, outputFile: file };
      }
      fs.mkdirSync(sourceDirectory, { recursive: true });
      writeAtomic(sourceFile, copied.content);
      removeSyncSidecar(file);
      console.log('[healed-sync] ' + sourceFile + ' <- ' + file + ' (test body only)');
      return { updated: true, sourceFile, outputFile: file };
    } finally {
      inFlightSync.delete(sourceKey);
    }
  } finally {
    inFlightSync.delete(key);
  }
}

function syncSourcesFromHealed(testsRoot = process.cwd(), options = {}) {
  const root = path.resolve(testsRoot);
  const healedRoot = path.join(root, 'healed');
  const results = [];
  const errors = [];
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', 'fixtures'].includes(entry.name.toLowerCase())) visit(file);
      } else if (/\.healed\.spec\.[cm]?[jt]sx?$/i.test(entry.name)) {
        try {
          const result = syncSourceFromHealed(file, options);
          results.push(result);
        } catch (error) {
          errors.push({ file, error });
          console.error('[healed-sync] ' + file + ': ' + error.message);
        }
      }
    }
  }
  visit(healedRoot);
  if (errors.length && options.throwOnError !== false) {
    throw new Error('Source sync failed for ' + errors.length + ' healed spec(s); resolve the errors above before running tests.');
  }
  return { results, errors };
}

function syncSpecPair(file, options = {}) {
  const absolute = path.resolve(file);
  if (/\.healed\.spec\./i.test(absolute) || slash(absolute).split('/').some(part => part.toLowerCase() === 'healed')) {
    return syncSourceFromHealed(absolute, options);
  }
  return prepareHealedSpec(absolute, options);
}

function companionTextFiles(sourceFile, explicitTextFile) {
  const candidates = [];
  if (explicitTextFile) candidates.push(path.resolve(explicitTextFile));
  candidates.push(sourceFile.replace(/\.spec\.([cm]?[jt]s)$/i, '.txt'));
  candidates.push(path.join(path.dirname(sourceFile), `${path.parse(sourceFile).name}.txt`));
  return Array.from(new Set(candidates)).filter(candidate => fs.existsSync(candidate));
}


function parseSyncSource(source, file) {
  return require('@babel/parser').parse(source, {
    sourceType: 'unambiguous',
    plugins: /\.[cm]?tsx?$/i.test(file) ? ['typescript', ...(/\.tsx$/i.test(file) ? ['jsx'] : [])] : ['jsx'],
  });
}

function syncShape(node, replacements = new Map()) {
  if (replacements.has(node)) return { type: 'RecordedLocatorSlot' };
  if (Array.isArray(node)) return node.map(value => syncShape(value, replacements));
  if (!node || typeof node !== 'object') return node;
  const result = {};
  for (const key of Object.keys(node).sort()) {
    if (['start', 'end', 'loc', 'extra', 'comments', 'tokens', 'leadingComments', 'trailingComments', 'innerComments', 'errors'].includes(key)) continue;
    result[key] = syncShape(node[key], replacements);
  }
  return result;
}

function syncLocatorSlots(source, file) {
  const ast = parseSyncSource(source, file);
  const slots = [];
  const method = node => node?.type === 'CallExpression' && node.callee?.type === 'MemberExpression' &&
    !node.callee.computed ? node.callee.property.name : null;
  function visit(node, parent, grandparent) {
    if (!node || typeof node !== 'object') return;
    if (LOCATOR_FACTORY_METHODS.has(method(node))) {
      const chained = parent?.type === 'MemberExpression' && parent.object === node &&
        grandparent?.callee === parent && LOCATOR_FACTORY_METHODS.has(method(grandparent));
      if (!chained) {
        slots.push({
          node, start: node.start, end: node.end, code: source.slice(node.start, node.end),
          shape: JSON.stringify(syncShape(node)),
          binding: parent?.type === 'VariableDeclarator' && parent.init === node && parent.id.type === 'Identifier' ? parent.id.name : null,
        });
        return; // Nested filter arguments are part of this one source chain.
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'extra', 'comments', 'tokens'].includes(key)) continue;
      if (Array.isArray(value)) for (const child of value) visit(child, node, parent);
      else if (value && typeof value === 'object') visit(value, node, parent);
    }
  }
  visit(ast, null, null);
  slots.sort((a, b) => a.start - b.start);
  const markers = new Map(slots.map(slot => [slot.node, true]));
  return { slots, structure: JSON.stringify(syncShape(ast, markers)) };
}

function mergeMirrorRepairs(base, current, next, file) {
  const before = syncLocatorSlots(base, file);
  const repaired = syncLocatorSlots(current, file);
  const incoming = syncLocatorSlots(next, file);
  if (before.structure !== repaired.structure || before.slots.length !== repaired.slots.length) {
    throw new Error('HEAL_SYNC_CONFLICT: the healed spec contains edits outside locator expressions. Move those edits to the source spec before syncing; neither file was overwritten.');
  }
  const edits = [];
  let dropped = 0;
  for (let index = 0; index < before.slots.length; index += 1) {
    const original = before.slots[index], repair = repaired.slots[index];
    if (original.shape === repair.shape) continue;
    const uniqueBinding = original.binding && before.slots.filter(slot => slot.binding === original.binding).length === 1;
    const matches = incoming.slots.filter(slot => uniqueBinding
      ? slot.binding === original.binding && slot.shape === original.shape
      : !slot.binding && slot.shape === original.shape);
    if (matches.length !== 1 || (!uniqueBinding && before.slots.filter(slot => slot.shape === original.shape).length !== 1)) {
      dropped += 1; continue; // Source changed/deleted this locator; the source wins.
    }
    edits.push({ ...matches[0], replacement: repair.code });
  }
  let result = next;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  parseSyncSource(result, file);
  return { content: result, preserved: edits.length, dropped };
}

function writeAtomic(file, content) {
  const temporary = file + '.sync-' + crypto.randomBytes(8).toString('hex') + '.tmp';
  let created = false;
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
    created = true;
    fs.renameSync(temporary, file);
    created = false;
  } finally { if (created) try { fs.unlinkSync(temporary); } catch (_) {} }
}

// Called by the fixture during a run. The sync watcher waits for all workers
// using this mirror to finish, so it cannot overwrite an executing module.
const activeRunMarkers = new Map();
process.once('exit', () => {
  for (const marker of activeRunMarkers.values()) {
    try { fs.unlinkSync(marker); } catch (_) {}
  }
});

function beginHealedSpecRun(file) {
  assertHealedSpec(file);
  const marker = file + '.running-' + process.pid + '-' + crypto.randomBytes(5).toString('hex') + '.lock';
  // The worker can execute several tests from the same already-loaded module.
  // Hold the marker until the worker exits, not just until one page closes.
  if (activeRunMarkers.has(canonicalFile(file))) return;
  const lockFile = file + '.healing.lock';
  const lock = fs.openSync(lockFile, 'wx');
  try { fs.writeFileSync(marker, String(process.pid), { flag: 'wx' }); }
  finally { fs.closeSync(lock); fs.unlinkSync(lockFile); }
  activeRunMarkers.set(canonicalFile(file), marker);
}

function mirrorIsRunning(file, ignoreWriteLock = false) {
  const prefix = path.basename(file) + '.running-';
  return (!ignoreWriteLock && fs.existsSync(file + '.healing.lock')) ||
    fs.readdirSync(path.dirname(file)).some(name => name.startsWith(prefix) && name.endsWith('.lock'));
}

function syncMirrorFile(sourceFile, outputFile, next) {
  const current = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : null;
  if (current !== null) assertHealedSpec(outputFile);
  if (mirrorIsRunning(outputFile)) return { deferred: true, updated: false };
  let merged = { content: next, preserved: 0, dropped: 0 };
  if (current !== null) {
    try { merged = mergeMirrorRepairs(next, current, next, outputFile); }
    catch (error) {
      if (!String(error.message).includes('HEAL_SYNC_CONFLICT')) throw error;
      merged = { content: next, preserved: 0, dropped: 0 };
    }
  } else parseSyncSource(next, outputFile);
  if (current === merged.content) {
    removeSyncSidecar(outputFile);
    return { updated: false, ...merged };
  }
  const lockFile = outputFile + '.healing.lock';
  const lock = fs.openSync(lockFile, 'wx');
  try {
    if (mirrorIsRunning(outputFile, true)) return { deferred: true, updated: false };
    if ((fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : null) !== current) {
      throw new Error('HEAL_SYNC_CONFLICT: mirror changed while preparing sync; retry after the current writer finishes');
    }
    if (current !== merged.content) writeAtomic(outputFile, merged.content);
    removeSyncSidecar(outputFile);
    return { updated: current !== merged.content, ...merged };
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockFile);
  }
}

function syncHealedSpecs(testsRoot = process.cwd(), options = {}) {
  const root = path.resolve(testsRoot);
  const results = [], errors = [];
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!['healed', 'node_modules', '.git', 'fixtures'].includes(entry.name.toLowerCase())) visit(file);
      } else if (/\.spec\.[cm]?[jt]sx?$/i.test(entry.name) && !/\.healed\.spec\./i.test(entry.name)) {
        try {
          const result = prepareHealedSpec(file, options);
          results.push(result);
          if (result.updated) console.log('[healed-sync] ' + result.outputFile + ' (repairs retained=' + (result.preserved || 0) + ', source-changed repairs dropped=' + (result.dropped || 0) + ')');
        } catch (error) { errors.push({ file, error }); console.error('[healed-sync] ' + file + ': ' + error.message); }
      }
    }
  }
  visit(path.join(root, 'sanity'));
  visit(path.join(root, 'regression'));
  if (errors.length && options.throwOnError !== false) throw new Error('Healed sync failed for ' + errors.length + ' source spec(s); resolve the errors above before running tests.');
  return { results, errors };
}

function resolveTestsRoot(input) {
  const start = path.resolve(input || process.cwd());
  let current = start;
  try {
    if (fs.existsSync(start) && fs.statSync(start).isFile()) current = path.dirname(start);
  } catch (_) {}
  for (let index = 0; index < 12; index += 1) {
    if (fs.existsSync(path.join(current, 'playwright.config.js')) ||
        fs.existsSync(path.join(current, 'playwright.healed.config.js')) ||
        (fs.existsSync(path.join(current, 'package.json')) && fs.existsSync(path.join(current, 'fixtures')))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return fs.existsSync(start) && fs.statSync(start).isDirectory() ? start : path.dirname(start);
}

function isNoiseFile(name) {
  const base = path.basename(String(name || ''));
  if (!base) return true;
  if (/\.(lock|bak|tmp)$/i.test(base)) return true;
  if (/\.sync\.json$/i.test(base)) return true;
  if (/\.sync-[0-9a-f]+\.tmp$/i.test(base)) return true;
  return false;
}

function isWatchableSpec(file) {
  return /\.spec\.[cm]?[jt]sx?$/i.test(path.basename(file)) && !isNoiseFile(file);
}

function isUnderWatchedTree(root, file) {
  const rel = slash(path.relative(root, file));
  if (!rel || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) return false;
  const top = rel.split('/')[0].toLowerCase();
  if (['node_modules', '.git', 'test-results', 'playwright-report', 'allure-results', 'fixtures'].includes(top)) {
    return false;
  }
  return ['sanity', 'regression', 'healed'].includes(top);
}

// A deleted sanity/regression spec takes its healed twin with it. Only specs
// this watcher has seen existing count, so a healed spec that was already
// orphaned before the watcher started is never touched. The spec must stay
// gone for SOURCE_DELETE_GRACE_MS (editors and git briefly remove files while
// saving or switching branches), a twin that is running or being healed waits,
// and the twin goes to the Recycle Bin, so it can be restored.
const SOURCE_DELETE_GRACE_MS = 3000;
const TWIN_REMOVAL_RETRY_MS = 60000;

// The same sanity/regression specs syncHealedSpecs mirrors.
function listSourceSpecs(root) {
  const found = [];
  function visit(directory) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!['healed', 'node_modules', '.git', 'fixtures'].includes(entry.name.toLowerCase())) visit(file);
      } else if (/\.spec\.[cm]?[jt]sx?$/i.test(entry.name) && !/\.healed\.spec\./i.test(entry.name) && !isNoiseFile(entry.name)) {
        found.push(file);
      }
    }
  }
  visit(path.join(root, 'sanity'));
  visit(path.join(root, 'regression'));
  return found;
}

function isSourceSpecPath(root, file) {
  const top = slash(path.relative(root, file)).split('/')[0].toLowerCase();
  return (top === 'sanity' || top === 'regression') && isWatchableSpec(file) && !/\.healed\.spec\./i.test(file);
}

// Where prepareHealedSpec puts a spec's mirror: healed/<suite>/<subfolders>/.
// The legacy flat healed/<name>.healed.spec.js belongs to a top-level spec and
// goes only when neither sanity/<name> nor regression/<name> exists any more.
function healedTwinsOf(root, sourceFile) {
  const parts = path.relative(root, sourceFile).split(/[\\/]/);
  const name = parts.pop();
  const healedName = name.replace(/\.spec\.([cm]?[jt]sx?)$/i, '.healed.spec.$1');
  if (healedName === name || !parts.length) return [];
  parts[0] = parts[0].toLowerCase();
  const twins = [path.join(root, 'healed', ...parts, healedName)];
  if (parts.length === 1 && !['sanity', 'regression'].some(suite => fs.existsSync(path.join(root, suite, name)))) {
    twins.push(path.join(root, 'healed', healedName));
  }
  return twins;
}

// Windows: the Recycle Bin, silently (no confirmation, progress or error UI),
// all files in one call. Elsewhere there is no bin to use, so they are
// removed. Returns the files that are still there.
function sendToRecycleBin(files) {
  if (process.platform !== 'win32') {
    for (const file of files) { try { fs.unlinkSync(file); } catch (_) {} }
    return files.filter(file => fs.existsSync(file));
  }
  const script = [
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class HealedTwinRecycleBin {',
    '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]',
    '  private struct SHFILEOPSTRUCT {',
    '    public IntPtr hwnd; public uint wFunc;',
    '    [MarshalAs(UnmanagedType.LPWStr)] public string pFrom;',
    '    [MarshalAs(UnmanagedType.LPWStr)] public string pTo;',
    '    public ushort fFlags; [MarshalAs(UnmanagedType.Bool)] public bool fAnyOperationsAborted;',
    '    public IntPtr hNameMappings; [MarshalAs(UnmanagedType.LPWStr)] public string lpszProgressTitle;',
    '  }',
    '  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]',
    '  private static extern int SHFileOperation(ref SHFILEOPSTRUCT operation);',
    '  public static int Send(string newlineSeparatedFiles) {',
    '    SHFILEOPSTRUCT operation = new SHFILEOPSTRUCT();',
    '    operation.wFunc = 3;                                   // FO_DELETE',
    '    operation.pFrom = string.Join("\\0", newlineSeparatedFiles.Split(new[] { (char)10 }, StringSplitOptions.RemoveEmptyEntries)) + "\\0\\0";',
    '    operation.fFlags = 0x0040 | 0x0010 | 0x0004 | 0x0400;  // ALLOWUNDO NOCONFIRMATION SILENT NOERRORUI',
    '    return SHFileOperation(ref operation);',
    '  }',
    '}',
    '"@',
    'exit [HealedTwinRecycleBin]::Send($env:HEALED_TWINS_TO_RECYCLE)',
  ].join('\n');
  spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
  ], { env: { ...process.env, HEALED_TWINS_TO_RECYCLE: files.join('\n') }, encoding: 'utf8', timeout: 120000, windowsHide: true });
  return files.filter(file => fs.existsSync(file));
}

function watchHealedSpecs(testsRoot = process.cwd()) {
  const root = resolveTestsRoot(testsRoot);
  const watchers = new Map();
  const pending = new Map();
  const deferredFiles = new Map();
  const knownSources = new Map();
  const missingSince = new Map();
  const retryTwinRemovalAt = new Map();

  function rememberSources() {
    for (const file of listSourceSpecs(root)) knownSources.set(canonicalFile(file), file);
  }

  function removeTwinsOfDeletedSources() {
    try { removeTwinsNow(); } catch (error) { console.warn('[healed-sync] Deleted-spec check failed: ' + error.message); }
  }

  function removeTwinsNow() {
    const now = Date.now();
    const due = [];   // { key, source, twins, waiting }
    for (const [key, source] of [...knownSources]) {
      if (fs.existsSync(source)) {
        missingSince.delete(key);
        continue;
      }
      if (!missingSince.has(key)) missingSince.set(key, now);
      if (now - missingSince.get(key) < SOURCE_DELETE_GRACE_MS) continue;
      if ((retryTwinRemovalAt.get(key) || 0) > now) continue;
      const entry = { key, source, twins: [], waiting: false };
      for (const twin of healedTwinsOf(root, source)) {
        if (!fs.existsSync(twin)) continue;
        if (mirrorIsRunning(twin)) entry.waiting = true;   // running or being healed: later
        else entry.twins.push(twin);
      }
      due.push(entry);
    }
    const toRecycle = due.flatMap(entry => entry.twins);
    const stillThere = new Set((toRecycle.length ? sendToRecycleBin(toRecycle) : []).map(canonicalFile));
    for (const entry of due) {
      for (const twin of entry.twins) {
        if (stillThere.has(canonicalFile(twin))) {
          entry.waiting = true;
          retryTwinRemovalAt.set(entry.key, now + TWIN_REMOVAL_RETRY_MS);
          console.warn('[healed-sync] Could not move ' + twin + ' to the Recycle Bin after ' + entry.source + ' was deleted; retrying later');
        } else {
          removeSyncSidecar(twin);
          console.log('[healed-sync] ' + entry.source + ' was deleted, so its healed twin went to the Recycle Bin: ' + twin);
        }
      }
      if (!entry.waiting) {
        knownSources.delete(entry.key);
        missingSince.delete(entry.key);
        retryTwinRemovalAt.delete(entry.key);
      }
    }
  }

  function closeWatcher(key) {
    const watcher = watchers.get(key);
    if (!watcher) return;
    try { watcher.close(); } catch (_) {}
    watchers.delete(key);
  }

  function attach(directory) {
    const key = canonicalFile(directory);
    if (watchers.has(key) || !fs.existsSync(directory)) return;
    try {
      const watcher = fs.watch(directory, { recursive: true }, (_event, filename) => {
        if (!filename || isNoiseFile(filename)) return;
        schedule(path.join(directory, filename));
      });
      if (typeof watcher.on === 'function') {
        watcher.on('error', (error) => {
          console.warn('[healed-sync] Watcher error on ' + directory + ': ' + error.message);
          closeWatcher(key);
        });
      }
      watchers.set(key, watcher);
      console.log('[healed-sync] Watching ' + directory);
    } catch (error) {
      console.warn('[healed-sync] Could not watch ' + directory + ': ' + error.message);
    }
  }

  function refresh() {
    for (const suite of ['sanity', 'regression', 'healed']) attach(path.join(root, suite));
  }

  function schedule(file) {
    const absolute = path.resolve(file);
    if (isNoiseFile(absolute) || !isWatchableSpec(absolute) || !isUnderWatchedTree(root, absolute)) return;
    if (!fs.existsSync(absolute)) {
      // Possibly deleted: note it now, act once the grace period has passed.
      if (isSourceSpecPath(root, absolute)) {
        removeTwinsOfDeletedSources();
        setTimeout(removeTwinsOfDeletedSources, SOURCE_DELETE_GRACE_MS + 250);
      }
      return;
    }
    const key = canonicalFile(absolute);
    if (isSourceSpecPath(root, absolute)) knownSources.set(key, absolute);
    clearTimeout(pending.get(key));
    pending.set(key, setTimeout(() => {
      pending.delete(key);
      try {
        const result = syncSpecPair(absolute, { throwOnError: false });
        if (result && result.deferred) deferredFiles.set(key, absolute);
        else deferredFiles.delete(key);
      } catch (error) {
        console.warn('[healed-sync] ' + absolute + ': ' + error.message);
      }
    }, 400));
  }

  try { rememberSources(); } catch (_) {}
  refresh();
  const poll = setInterval(() => {
    refresh();
    for (const file of deferredFiles.values()) schedule(file);
    // Also catches a deleted folder, which reports no per-file events.
    removeTwinsOfDeletedSources();
  }, 2500);
  const sweep = setInterval(() => {
    try { rememberSources(); } catch (_) {}
    syncHealedSpecs(root, { throwOnError: false });
    syncSourcesFromHealed(root, { throwOnError: false });
  }, 8000);

  console.log('[healed-sync] Watching spec pairs under ' + root + '. Only test(() => { ... }) bodies stay in sync.');
  return () => {
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
    clearInterval(poll);
    clearInterval(sweep);
    for (const key of [...watchers.keys()]) closeWatcher(key);
  };
}

function prepareHealedSpec(sourceFile, options = {}) {
  const absoluteSource = path.resolve(sourceFile);
  if (!fs.existsSync(absoluteSource)) throw new Error(`Spec file does not exist: ${absoluteSource}`);
  if (/\.healed\.spec\./i.test(absoluteSource) || slash(absoluteSource).split('/').some(part => part.toLowerCase() === 'healed')) {
    throw new Error('Use the original sanity/regression spec, not a healed mirror, as the sync source');
  }
  const suite = locateSuite(absoluteSource);
  const outputDirectory = options.outputDirectory
    ? path.resolve(options.outputDirectory)
    : path.join(suite.testsRoot, 'healed', suite.suiteName, path.relative(suite.suiteDirectory, path.dirname(absoluteSource)));
  const sourceName = path.basename(absoluteSource);
  const healedName = sourceName.replace(/\.spec\.([cm]?[jt]sx?)$/i, '.healed.spec.$1');
  if (healedName === sourceName) {
    throw new Error(`Source filename must end in .spec.js/.spec.ts: ${sourceName}`);
  }
  const outputFile = path.join(outputDirectory, healedName);
  const fixtureFile = options.fixtureFile
    ? path.resolve(options.fixtureFile)
    : path.join(suite.testsRoot, 'fixtures', 'walker_fixture.js');
  if (!fs.existsSync(fixtureFile)) {
    throw new Error(`Healing fixture does not exist: ${fixtureFile}`);
  }

  fs.mkdirSync(outputDirectory, { recursive: true });
  const original = fs.readFileSync(absoluteSource, 'utf8');
  const sourceKey = canonicalFile(absoluteSource);
  const outputKey = canonicalFile(outputFile);
  if (inFlightSync.has(sourceKey) || inFlightSync.has(outputKey)) {
    return { sourceFile: absoluteSource, outputFile, copiedTextFiles: [], fixtureFile, updated: false, skipped: true, reason: 'in-flight' };
  }
  inFlightSync.add(sourceKey);
  inFlightSync.add(outputKey);
  let sync;
  try {
    const sourceDirectory = path.dirname(absoluteSource);
    if (fs.existsSync(outputFile)) {
      const currentHealed = fs.readFileSync(outputFile, 'utf8');
      const copied = copyTestBodies(original, currentHealed, absoluteSource, outputFile, sourceDirectory, outputDirectory);
      if (!copied.updated) {
        sync = { updated: false, deferred: false, preserved: 0, dropped: 0 };
      } else {
        writeAtomic(outputFile, copied.content);
        removeSyncSidecar(outputFile);
        sync = { updated: true, deferred: false, preserved: 0, dropped: 0 };
        console.log('[healed-sync] ' + outputFile + ' <- ' + absoluteSource + ' (test body only)');
      }
    } else {
      const body = rewriteRelativeModules(stripSpecPreamble(original), sourceDirectory, outputDirectory);
      const fixtureModule = relativeModule(outputDirectory, fixtureFile);
      const testDataModule = relativeModule(outputDirectory, locateTestDataFile(absoluteSource));
      const mirrored = installCanonicalHealedHeader(body, fixtureModule, testDataModule);
      sync = syncMirrorFile(absoluteSource, outputFile, mirrored);
    }
  } finally {
    inFlightSync.delete(sourceKey);
    inFlightSync.delete(outputKey);
  }
  if (sync.deferred) return { sourceFile: absoluteSource, outputFile, copiedTextFiles: [], fixtureFile, ...sync };

  const copiedTextFiles = [];
  for (const textFile of companionTextFiles(absoluteSource, options.textFile)) {
    const target = path.join(outputDirectory, path.basename(textFile));
    if (!fs.existsSync(target) || !fs.readFileSync(textFile).equals(fs.readFileSync(target))) fs.copyFileSync(textFile, target);
    copiedTextFiles.push(target);
  }

  const { content, ...status } = sync;
  return { sourceFile: absoluteSource, outputFile, copiedTextFiles, fixtureFile, ...status };
}

function parseCli(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--watch') options.watch = true;
    else if (token === '--sync') options.sync = true;
    else if (token === '--from-healed') options.fromHealed = true;
    else if (token === '--text') options.textFile = argv[++index];
    else if (token === '--output-dir') options.outputDirectory = argv[++index];
    else if (token === '--fixture') options.fixtureFile = argv[++index];
    else positional.push(token);
  }
  return { sourceFile: positional[0], options };
}

if (require.main === module) {
  try {
    const { sourceFile, options } = parseCli(process.argv.slice(2));
    if (options.watch) {
      watchHealedSpecs(sourceFile || process.cwd());
    } else if (options.fromHealed) {
      if (sourceFile && /\.healed\.spec\./i.test(sourceFile)) {
        const result = syncSourceFromHealed(sourceFile, options);
        console.log(`[healed-spec] ${result.sourceFile} <- ${result.outputFile}`);
      } else {
        syncSourcesFromHealed(sourceFile || process.cwd());
      }
    } else if (options.sync) {
      syncHealedSpecs(sourceFile || process.cwd());
    } else {
    if (!sourceFile) {
      throw new Error(
        'Usage: node prepare_healed_spec.js <sanity-or-regression.spec.js> ' +
        '[--text trace.txt] [--output-dir tests/healed/sanity]\n' +
        '       node prepare_healed_spec.js --from-healed [<healed.spec.js>]\n' +
        '       node prepare_healed_spec.js --sync [testsRoot]\n' +
        '       node prepare_healed_spec.js --watch [testsRoot]'
      );
    }
    if (/\.healed\.spec\./i.test(sourceFile) || slash(sourceFile).split('/').some(part => part.toLowerCase() === 'healed')) {
      const result = syncSourceFromHealed(sourceFile, options);
      console.log(`[healed-spec] ${result.sourceFile} <- ${result.outputFile}`);
    } else {
      const result = prepareHealedSpec(sourceFile, options);
      console.log(`[healed-spec] ${result.outputFile}`);
      for (const copied of result.copiedTextFiles) console.log(`[healed-text] ${copied}`);
    }
    }
  } catch (error) {
    console.error(`[healed-spec] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  prepareHealedSpec,
  createHealedSpecEditor,
  LOCATOR_FACTORY_METHODS,
  syncHealedSpecs,
  watchHealedSpecs,
  beginHealedSpecRun,
  syncSourceFromHealed,
  syncSourcesFromHealed,
  syncSpecPair,
};
