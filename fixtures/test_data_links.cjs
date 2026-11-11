/*
 * TEST DATA LINKS: values in a Playwright spec <-> its testData references.
 *
 * One file, used in four places:
 *   - every project, which gets it in fixtures/ next to the healer files: its own
 *     npm run testdata:toggle / link / show (fixtures/test_data_cli.cjs) need nothing
 *     else, no Qualibrix backend;
 *   - the script generator (refine-with-llm.js): every value in an XPath that the
 *     spec already keeps in test data is written as that variable
 *     (linkXPathValuesToTestData);
 *   - the spec editor in the UI (frontend/static/test_data_editor.js loads this
 *     file from GET /api/shared/test-data-links.js): it highlights values and
 *     testData references, and Alt+T turns one into the other;
 *   - the Angular UI, from the same route.
 * The original is backend/tests/fixtures/test_data_links.cjs; projects hold copies.
 *
 * It reads the spec's source text and never runs it. Every change keeps the
 * string the spec builds exactly the same for the test data it has now:
 *
 *   "xpath=//a[.='Skgjjh']"  <->  "xpath=//a[.='" + String(testData.city) + "']"
 *   `xpath=//a[.='Skgjjh']`  <->  `xpath=//a[.='${testData.city}']`
 *   fill('Skgjjh')           <->  fill(testData.city)
 *
 * Plain JavaScript without dependencies: require() in Node, window.TestDataLinks
 * in a browser.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else {
    root.TestDataLinks = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // A value shorter than this never links by itself, so a typed "6" cannot take over an
  // unrelated "6" (the generator's TYPED_VALUE_LINK_MIN_LENGTH and the healer use the same).
  const MIN_LINK_LENGTH = 6;
  // Keys that look like credentials (inline_healer.js uses the same rule): never linked
  // into a locator and never written into a spec as plain text.
  const SECRET_KEY_PATTERN = /pass|pwd|secret|token|otp|apikey|api_key|credential/i;
  const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;
  const DEFAULT_DATA_NAME = 'testData';
  const TEST_DATA_FILE_PATTERN = /(?:test-data|testData)[^'"/\\]*\.json$/i;
  // Calls whose first argument is a selector, and calls whose string arguments are values.
  const SELECTOR_METHODS = new Set(['locator', 'frameLocator', 'waitForSelector']);
  const VALUE_METHODS = new Set(['getByText', 'getByLabel', 'getByPlaceholder', 'getByTitle', 'getByAltText', 'fill', 'type', 'pressSequentially', 'selectOption']);
  const STRING_TRANSFORMS = new Set(['toLowerCase', 'toUpperCase', 'trim', 'toLocaleLowerCase', 'toLocaleUpperCase']);
  const REGEX_AFTER_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
  const PUNCTUATORS = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '**', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>'];
  // Where an operand of a "+" chain ends.
  const TERMINATORS = new Set([',', ')', ']', '}', ';', '?', ':', '=>', '=', '==', '===', '!=', '!==', '<', '>', '<=', '>=', '&&', '||', '??', '+=', '-=', '*=', '/=', '%=', '&&=', '||=', '??=']);
  // Operators that bind tighter than "+": a string next to one cannot become "a" + x + "b"
  // without parentheses, and cannot be merged with a neighbour.
  const TIGHT_BEFORE = new Set(['-', '*', '/', '%', '**', '!', '~', '.', '?.', 'typeof', 'void', 'delete', 'await', 'new']);
  const TIGHT_AFTER = new Set(['.', '?.', '[', '(', '-', '*', '/', '%', '**', '++', '--']);
  const ASSIGNMENT_OPERATORS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??=', '<<=', '>>=', '>>>=', '&=', '|=', '^=']);
  const KEY_NAME_SUFFIXES = ['Dropdown', 'Checkbox', 'Button', 'Option', 'Locator', 'Element', 'Input', 'Field', 'Label', 'Link', 'Item', 'Cell', 'Menu', 'Text', 'Tab', 'Row'];
  const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

  // ---------------------------------------------------------------------------
  // Tokens
  // ---------------------------------------------------------------------------

  function isWhitespace(ch) {
    return /\s/.test(ch) || ch === '﻿';
  }

  function isIdentifierStart(ch) {
    return /[A-Za-z_$]/.test(ch) || (ch > '\x7f' && !isWhitespace(ch));
  }

  function isIdentifierPart(ch) {
    return /[\w$]/.test(ch) || (ch > '\x7f' && !isWhitespace(ch));
  }

  function regexAllowedAfter(previous) {
    if (!previous) return true;
    if (previous.type === 'ident') return REGEX_AFTER_KEYWORDS.has(previous.value);
    if (previous.type === 'punct') {
      return !(previous.value === ')' || previous.value === ']' || previous.value === '}' || previous.value === '++' || previous.value === '--');
    }
    return false;
  }

  // End of a regular expression literal starting at `start`, or -1 when it is not one.
  function scanRegex(text, start) {
    let inClass = false;
    for (let j = start + 1; j < text.length; j += 1) {
      const ch = text[j];
      if (ch === '\\') { j += 1; continue; }
      if (ch === '\n' || ch === '\r') return -1;
      if (inClass) {
        if (ch === ']') inClass = false;
      } else if (ch === '[') {
        inClass = true;
      } else if (ch === '/') {
        let end = j + 1;
        while (end < text.length && /[A-Za-z]/.test(text[end])) end += 1;
        return end;
      }
    }
    return -1;
  }

  /*
   * Strings, template literals (with the code inside ${...}), comments, regular
   * expressions, numbers, identifiers and punctuation, with their positions.
   * Every token carries `ctx`: 0 at the top, otherwise the ${...} it is in.
   */
  function tokenize(source) {
    const text = String(source == null ? '' : source);
    const length = text.length;
    const tokens = [];
    const contexts = new Map();
    const open = [];
    let contextCounter = 0;
    let lastSignificant = null;
    let i = 0;

    const add = (token) => {
      token.ctx = open.length ? open[open.length - 1].ctx : 0;
      tokens.push(token);
      if (token.type !== 'comment') lastSignificant = token;
      return token;
    };

    // Template text from `position` (after ` or a closing }) to the next ${ or the closing `.
    const scanTemplate = (token, position) => {
      let j = position;
      while (j < length) {
        const ch = text[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '`') {
          token.quasis.push({ start: position, end: j });
          token.end = j + 1;
          return j + 1;
        }
        if (ch === '$' && text[j + 1] === '{') {
          token.quasis.push({ start: position, end: j });
          const expression = { open: j, start: j + 2, end: -1, close: -1 };
          token.expressions.push(expression);
          contextCounter += 1;
          contexts.set(contextCounter, { token, expression });
          open.push({ token, expression, depth: 0, ctx: contextCounter });
          return j + 2;
        }
        j += 1;
      }
      token.quasis.push({ start: position, end: length });
      token.end = length;
      token.unterminated = true;
      return length;
    };

    while (i < length) {
      const ch = text[i];
      const next = text[i + 1];
      if (isWhitespace(ch)) { i += 1; continue; }

      if (ch === '/' && next === '/') {
        const newline = text.indexOf('\n', i);
        const end = newline === -1 ? length : newline;
        add({ type: 'comment', start: i, end });
        i = end;
        continue;
      }
      if (ch === '/' && next === '*') {
        const close = text.indexOf('*/', i + 2);
        const end = close === -1 ? length : close + 2;
        add({ type: 'comment', start: i, end });
        i = end;
        continue;
      }

      if (ch === "'" || ch === '"') {
        let j = i + 1;
        let unterminated = false;
        for (;;) {
          if (j >= length) { unterminated = true; break; }
          const c = text[j];
          if (c === '\\') { j += 2; continue; }
          if (c === ch) break;
          if (c === '\n' || c === '\r') { unterminated = true; break; }
          j += 1;
        }
        const contentEnd = Math.min(j, length);
        const end = unterminated ? contentEnd : j + 1;
        add({ type: 'string', start: i, end, quote: ch, contentStart: i + 1, contentEnd, unterminated });
        i = end;
        continue;
      }

      if (ch === '`') {
        const token = add({ type: 'template', start: i, end: length, quote: '`', quasis: [], expressions: [] });
        i = scanTemplate(token, i + 1);
        continue;
      }

      if (open.length && (ch === '{' || ch === '}')) {
        const top = open[open.length - 1];
        if (ch === '}' && top.depth === 0) {
          top.expression.end = i;
          top.expression.close = i;
          open.pop();
          lastSignificant = top.token;
          i = scanTemplate(top.token, i + 1);
          continue;
        }
        top.depth += ch === '{' ? 1 : -1;
        add({ type: 'punct', value: ch, start: i, end: i + 1 });
        i += 1;
        continue;
      }

      if (ch === '/' && regexAllowedAfter(lastSignificant)) {
        const end = scanRegex(text, i);
        if (end > 0) {
          add({ type: 'regex', start: i, end });
          i = end;
          continue;
        }
      }

      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(next || ''))) {
        let j = i + 1;
        while (j < length) {
          const c = text[j];
          if (/[\w.]/.test(c)) { j += 1; continue; }
          if ((c === '+' || c === '-') && /[eE]/.test(text[j - 1]) && !/^0[xX]/.test(text.slice(i, j))) { j += 1; continue; }
          break;
        }
        add({ type: 'number', start: i, end: j });
        i = j;
        continue;
      }

      if (isIdentifierStart(ch)) {
        let j = i + 1;
        while (j < length && isIdentifierPart(text[j])) j += 1;
        add({ type: 'ident', value: text.slice(i, j), start: i, end: j });
        i = j;
        continue;
      }

      let value = ch;
      for (const candidate of PUNCTUATORS) {
        if (text.startsWith(candidate, i)) { value = candidate; break; }
      }
      if (value === '?.' && /[0-9]/.test(text[i + 2] || '')) value = '?';
      add({ type: 'punct', value, start: i, end: i + value.length });
      i += value.length;
    }

    while (open.length) {
      const top = open.pop();
      top.expression.end = length;
      top.token.end = length;
      top.token.unterminated = true;
    }

    return { text, tokens, contexts };
  }

  /*
   * The value a string's raw text stands for. map[k] is where the raw text of
   * value character k starts; map[value.length] is the end of the raw text.
   */
  function decodeRaw(text, start, end, template) {
    let cooked = '';
    const map = [];
    let j = start;
    while (j < end) {
      const ch = text[j];
      if (ch === '\\' && j + 1 < end) {
        const at = j;
        const c = text[j + 1];
        let value = c;
        let next = j + 2;
        if (c === 'n') value = '\n';
        else if (c === 'r') value = '\r';
        else if (c === 't') value = '\t';
        else if (c === 'b') value = '\b';
        else if (c === 'f') value = '\f';
        else if (c === 'v') value = '\v';
        else if (c === '0' && !/[0-9]/.test(text[j + 2] || '')) value = '\0';
        else if (c === 'x' && /^[0-9a-fA-F]{2}$/.test(text.slice(j + 2, j + 4))) {
          value = String.fromCharCode(parseInt(text.slice(j + 2, j + 4), 16));
          next = j + 4;
        } else if (c === 'u' && text[j + 2] === '{') {
          const close = text.indexOf('}', j + 3);
          const hex = close > 0 && close < end ? text.slice(j + 3, close) : '';
          if (/^[0-9a-fA-F]{1,6}$/.test(hex) && parseInt(hex, 16) <= 0x10ffff) {
            value = String.fromCodePoint(parseInt(hex, 16));
            next = close + 1;
          }
        } else if (c === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(j + 2, j + 6))) {
          value = String.fromCharCode(parseInt(text.slice(j + 2, j + 6), 16));
          next = j + 6;
        } else if (c === '\r') {
          value = '';
          next = text[j + 2] === '\n' ? j + 3 : j + 2;
        } else if (c === '\n' || c === ' ' || c === ' ') {
          value = '';
        }
        for (let k = 0; k < value.length; k += 1) map.push(at);
        cooked += value;
        j = next;
        continue;
      }
      if (template && ch === '\r') {
        map.push(j);
        cooked += '\n';
        j += text[j + 1] === '\n' ? 2 : 1;
        continue;
      }
      map.push(j);
      cooked += ch;
      j += 1;
    }
    map.push(Math.min(j, end));
    return { cooked, map };
  }

  // A place in a decoded string where it can be cut without splitting an escape sequence.
  function isCut(map, index) {
    return index === 0 || map[index] !== map[index - 1];
  }

  function cookedIndexAt(map, rawPosition) {
    for (let k = 0; k < map.length; k += 1) {
      if (map[k] === rawPosition && isCut(map, k)) return k;
      if (map[k] > rawPosition) break;
    }
    return -1;
  }

  function encodeStringText(value, quote) {
    let out = '';
    for (const ch of String(value)) {
      if (ch === '\\') out += '\\\\';
      else if (ch === quote) out += `\\${quote}`;
      else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else if (ch === ' ') out += '\\u2028';
      else if (ch === ' ') out += '\\u2029';
      else if (ch < ' ' || ch === '\x7f') out += `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`;
      else out += ch;
    }
    return out;
  }

  function encodeTemplateText(value) {
    let out = '';
    const text = String(value);
    for (let k = 0; k < text.length; k += 1) {
      const ch = text[k];
      if (ch === '\\') out += '\\\\';
      else if (ch === '`') out += '\\`';
      else if (ch === '$' && text[k + 1] === '{') out += '\\$';
      else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else if (ch < ' ' || ch === '\x7f') out += `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`;
      else out += ch;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Reading a spec
  // ---------------------------------------------------------------------------

  function isPunct(token, value) {
    return Boolean(token) && token.type === 'punct' && token.value === value;
  }

  function isIdent(token, value) {
    return Boolean(token) && token.type === 'ident' && (value === undefined || token.value === value);
  }

  function endsOperand(token) {
    if (!token) return false;
    if (token.type === 'number' || token.type === 'string' || token.type === 'template' || token.type === 'regex') return true;
    if (token.type === 'ident') return !REGEX_AFTER_KEYWORDS.has(token.value);
    return token.type === 'punct' && (token.value === ')' || token.value === ']' || token.value === '}');
  }

  function isBinaryPlus(token) {
    return isPunct(token, '+') && endsOperand(token.prev);
  }

  function isTerminator(token) {
    if (!token) return true;
    if (token.type === 'punct') return TERMINATORS.has(token.value);
    return token.type === 'ident' && (token.value === 'in' || token.value === 'instanceof');
  }

  function bindsTightBefore(token) {
    if (!token) return false;
    if (token.type === 'ident') return TIGHT_BEFORE.has(token.value);
    if (token.type !== 'punct') return false;
    return TIGHT_BEFORE.has(token.value) || (token.value === '+' && !isBinaryPlus(token));
  }

  function bindsTightAfter(token) {
    return Boolean(token) && token.type === 'punct' && TIGHT_AFTER.has(token.value);
  }

  function isPlainString(token) {
    return Boolean(token) && !token.unterminated && (token.type === 'string' || (token.type === 'template' && token.expressions.length === 0));
  }

  function decodeToken(text, token) {
    if (token.type === 'template') {
      const quasi = token.quasis[0] || { start: token.start + 1, end: token.start + 1 };
      return decodeRaw(text, quasi.start, quasi.end, true);
    }
    return decodeRaw(text, token.contentStart, token.contentEnd, false);
  }

  function markModuleSpecifiers(sig) {
    for (const token of sig) {
      if (token.type !== 'string') continue;
      const before = token.prev;
      if (isIdent(before, 'from') || isIdent(before, 'import') ||
          (isPunct(before, '(') && (isIdent(before.prev, 'require') || isIdent(before.prev, 'import')))) {
        token.moduleSpecifier = true;
      }
    }
  }

  // `import testData from '../test-data.json'` or `const testData = require('../test-data.json')`.
  function findDataImport(text, sig) {
    for (const token of sig) {
      if (token.ctx !== 0) continue;
      if (isIdent(token, 'import')) {
        const name = token.next;
        const from = name && name.next;
        const file = from && from.next;
        if (isIdent(name) && isIdent(from, 'from') && file && file.type === 'string' &&
            TEST_DATA_FILE_PATTERN.test(decodeToken(text, file).cooked)) {
          return { name: name.value, kind: 'esm', path: decodeToken(text, file).cooked, start: token.start, end: isPunct(file.next, ';') ? file.next.end : file.end };
        }
      }
      if (isIdent(token, 'const') || isIdent(token, 'let') || isIdent(token, 'var')) {
        const name = token.next;
        const equals = name && name.next;
        const call = equals && equals.next;
        const paren = call && call.next;
        const file = paren && paren.next;
        if (isIdent(name) && isPunct(equals, '=') && isIdent(call, 'require') && isPunct(paren, '(') &&
            file && file.type === 'string' && isPunct(file.next, ')') &&
            TEST_DATA_FILE_PATTERN.test(decodeToken(text, file).cooked)) {
          const close = file.next;
          return { name: name.value, kind: 'cjs', path: decodeToken(text, file).cooked, start: token.start, end: isPunct(close.next, ';') ? close.next.end : close.end };
        }
      }
    }
    return null;
  }

  /*
   * A spec that makes testData itself - `const testData = { url: ... }` (older healed copies),
   * an import from another file, or a local testData that hides the import - reads its values
   * from there, not from test-data.json: a new testData.<key> would be undefined there, and a
   * value written back could differ. Returns { line, reason } or null; toggles and links refuse
   * such a spec.
   */
  function findOwnData(text, sig, dataName, dataImport) {
    const lineOf = (offset) => text.slice(0, offset).split('\n').length;
    const own = (token, how) => ({
      line: lineOf(token.start),
      reason: `This spec ${how} on line ${lineOf(token.start)}, not from test-data.json; change its values there by hand.`,
    });
    for (const token of sig) {
      if (dataImport && token.start === dataImport.start) continue;
      if ((isIdent(token, 'const') || isIdent(token, 'let') || isIdent(token, 'var')) && isIdent(token.next, dataName)) {
        return own(token, `makes its own ${dataName}`);
      }
      if (isIdent(token, 'import') && token.ctx === 0 && !isPunct(token.next, '(') && !isPunct(token.next, '.')) {
        for (let cursor = token.next; cursor && !(cursor.type === 'string' && cursor.moduleSpecifier); cursor = cursor.next) {
          if (isIdent(cursor, dataName) && !isIdent(cursor.next, 'as')) return own(token, `imports ${dataName} from another file`);
        }
      }
    }
    return null;
  }

  /*
   * Every testData.key / testData["key"], with what is wrapped around it:
   * String(...), .toLowerCase() and the like, or a whole ${...}.
   */
  function findReferences(text, sig, dataName, contexts, byContext) {
    const refs = [];
    for (const first of sig) {
      if (!isIdent(first, dataName)) continue;
      if (isPunct(first.prev, '.') || isPunct(first.prev, '?.')) continue;
      const access = first.next;
      let key;
      let last;
      let bracket = false;
      if ((isPunct(access, '.') || isPunct(access, '?.')) && isIdent(access.next)) {
        key = access.next.value;
        last = access.next;
      } else if (isPunct(access, '[') && isPlainString(access.next) && isPunct(access.next.next, ']')) {
        key = decodeToken(text, access.next).cooked;
        last = access.next.next;
        bracket = true;
      } else {
        continue;
      }

      const ref = { key, start: first.start, end: last.end, bracket, ctx: first.ctx, wrapped: false, transforms: [], complex: false, template: null, expression: null };
      let outerFirst = first;
      let outerLast = last;
      const openParen = first.prev;
      const closeParen = last.next;
      if (isPunct(openParen, '(') && isPunct(closeParen, ')') && isIdent(openParen.prev, 'String') &&
          !isPunct(openParen.prev.prev, '.') && !isPunct(openParen.prev.prev, '?.') && !isIdent(openParen.prev.prev, 'new')) {
        ref.wrapped = true;
        outerFirst = openParen.prev;
        outerLast = closeParen;
      }

      let cursor = outerLast.next;
      while ((isPunct(cursor, '.') || isPunct(cursor, '?.')) && isIdent(cursor.next) && STRING_TRANSFORMS.has(cursor.next.value) &&
             isPunct(cursor.next.next, '(') && isPunct(cursor.next.next.next, ')')) {
        ref.transforms.push(cursor.next.value);
        outerLast = cursor.next.next.next;
        cursor = outerLast.next;
      }

      // Anything else hanging on the reference (.length, [0], a call, an assignment) makes
      // it part of an expression rather than a value.
      if (cursor && cursor.type === 'punct' &&
          (cursor.value === '.' || cursor.value === '?.' || cursor.value === '[' || cursor.value === '(' ||
           cursor.value === '++' || cursor.value === '--' || ASSIGNMENT_OPERATORS.has(cursor.value))) {
        ref.complex = true;
      }
      const before = outerFirst.prev;
      if (isPunct(before, '++') || isPunct(before, '--') || isIdent(before, 'delete')) ref.complex = true;

      ref.outerFirst = outerFirst;
      ref.outerLast = outerLast;
      ref.outerStart = outerFirst.start;
      ref.outerEnd = outerLast.end;

      if (first.ctx !== 0) {
        const owner = contexts.get(first.ctx);
        const inside = byContext.get(first.ctx) || [];
        if (owner && owner.expression.close >= 0 && inside[0] === outerFirst && inside[inside.length - 1] === outerLast) {
          ref.template = owner.token;
          ref.expression = owner.expression;
        }
      }
      refs.push(ref);
    }
    return refs;
  }

  function referenceRange(ref) {
    if (ref.template) return { start: ref.expression.open, end: ref.expression.close + 1 };
    return { start: ref.outerStart, end: ref.outerEnd };
  }

  /*
   * The operands of `a + b + c` starting at `first`, up to the token that ends the
   * expression (a comma, a closing bracket, ...). null when it is not such a chain.
   */
  function parseChain(first, refByFirst) {
    const operands = [];
    let cursor = first;
    for (;;) {
      if (!cursor || isTerminator(cursor) || isPlus(cursor)) return null;
      const ref = refByFirst.get(cursor);
      if (ref) {
        operands.push({ kind: 'ref', ref, first: ref.outerFirst, last: ref.outerLast });
        cursor = ref.outerLast.next;
      } else if (cursor.type === 'string' || cursor.type === 'template') {
        operands.push({ kind: cursor.type, token: cursor, first: cursor, last: cursor });
        cursor = cursor.next;
      } else {
        const start = cursor;
        let last = cursor;
        let depth = 0;
        while (cursor && !(depth === 0 && (isTerminator(cursor) || isPlus(cursor)))) {
          if (cursor.type === 'punct' && (cursor.value === '(' || cursor.value === '[' || cursor.value === '{')) depth += 1;
          if (cursor.type === 'punct' && (cursor.value === ')' || cursor.value === ']' || cursor.value === '}')) depth -= 1;
          last = cursor;
          cursor = cursor.next;
        }
        operands.push({ kind: 'code', first: start, last });
      }
      if (isPlus(cursor)) {
        cursor = cursor.next;
        continue;
      }
      if (isTerminator(cursor)) {
        return { operands, terminator: cursor || null, start: operands[0].first.start, end: operands[operands.length - 1].last.end };
      }
      return null;
    }
  }

  function isPlus(token) {
    return isPunct(token, '+');
  }

  // A chain as alternating text (decoded, with its map) and code.
  function flattenOperands(text, operands, refByExpression) {
    const parts = [];
    for (const operand of operands) {
      if (operand.kind === 'string') {
        const decoded = decodeRaw(text, operand.token.contentStart, operand.token.contentEnd, false);
        parts.push({ kind: 'text', token: operand.token, quasi: -1, text: decoded.cooked, map: decoded.map });
      } else if (operand.kind === 'template') {
        const token = operand.token;
        token.quasis.forEach((quasi, index) => {
          const decoded = decodeRaw(text, quasi.start, quasi.end, true);
          parts.push({ kind: 'text', token, quasi: index, text: decoded.cooked, map: decoded.map });
          const expression = token.expressions[index];
          if (expression) parts.push({ kind: 'code', ref: refByExpression.get(expression) || null });
        });
      } else {
        parts.push({ kind: 'code', ref: operand.ref || null });
      }
    }
    return parts;
  }

  function looksLikeXPath(textValue) {
    return /^xpath=/.test(textValue) || /^\(*\/\//.test(textValue) || /^\.\./.test(textValue);
  }

  // What an XPath literal is compared with: page text, a human-facing attribute, or anything else.
  function literalRole(context) {
    const before = context.slice(-80);
    const textSource = String.raw`(?:normalize-space\(\s*(?:\.|text\(\))?\s*\)|text\(\)|string\(\s*\.?\s*\)|\.)`;
    if (new RegExp(String.raw`(?:^|[\[\s(,=!<>]|and|or)${textSource}\s*!?=\s*$`).test(before)) return 'text';
    if (new RegExp(String.raw`(?:contains|starts-with|ends-with)\(\s*${textSource}\s*,\s*$`).test(before)) return 'text';
    if (/@(?:aria-label|aria-placeholder|aria-valuetext|title|placeholder|alt|value|label)\s*!?=\s*$/.test(before)) return 'label';
    if (/(?:contains|starts-with|ends-with)\(\s*@(?:aria-label|title|placeholder|alt|value|label)\s*,\s*$/.test(before)) return 'label';
    return 'other';
  }

  /*
   * The quoted literals of an XPath ('...' or "..."), each as runs of its own text
   * and the code parts (test data) inside it.
   */
  function xpathLiterals(selector) {
    const literals = [];
    let current = null;
    let context = '';
    for (const part of selector.parts) {
      if (part.kind === 'code') {
        if (current) {
          current.dynamic = true;
          current.items.push({ kind: 'code', ref: part.ref });
        } else {
          context += '\u0000';
        }
        continue;
      }
      const value = part.text;
      let runStart = current ? 0 : -1;
      for (let k = 0; k < value.length; k += 1) {
        const ch = value[k];
        if (current) {
          if (ch === current.quote) {
            if (k > runStart) current.items.push({ kind: 'text', part, from: runStart, to: k });
            literals.push(current);
            current = null;
            context = '';
            runStart = -1;
          }
        } else if (ch === "'" || ch === '"') {
          current = { quote: ch, items: [], dynamic: false, role: literalRole(context) };
          runStart = k + 1;
        } else {
          context += ch;
        }
      }
      if (current && value.length > runStart) current.items.push({ kind: 'text', part, from: runStart, to: value.length });
    }
    return literals;
  }

  function findSelectors(text, sig, refs, refByFirst) {
    const refByExpression = new Map();
    for (const ref of refs) if (ref.expression) refByExpression.set(ref.expression, ref);
    const selectors = [];
    const covered = new Set();

    for (const token of sig) {
      if (!isIdent(token) || !SELECTOR_METHODS.has(token.value) || !isPunct(token.next, '(')) continue;
      if (isIdent(token.prev, 'function') || isIdent(token.prev, 'class')) continue;
      const chain = parseChain(token.next.next, refByFirst);
      if (!chain || !(isPunct(chain.terminator, ',') || isPunct(chain.terminator, ')'))) continue;
      const parts = flattenOperands(text, chain.operands, refByExpression);
      const head = parts[0];
      const selector = {
        method: token.value,
        start: chain.start,
        end: chain.end,
        parts,
        isXPath: Boolean(head && head.kind === 'text' && looksLikeXPath(head.text)),
      };
      for (const operand of chain.operands) if (operand.token) covered.add(operand.token);
      selectors.push(selector);
    }

    // An XPath kept in a variable or a constant first ("xpath=..." outside a locator call).
    for (const token of sig) {
      if ((token.type !== 'string' && token.type !== 'template') || covered.has(token) || token.unterminated || token.moduleSpecifier) continue;
      const parts = flattenOperands(text, [{ kind: token.type, token }], refByExpression);
      if (parts[0] && parts[0].kind === 'text' && looksLikeXPath(parts[0].text)) {
        selectors.push({ method: null, start: token.start, end: token.end, parts, isXPath: true });
      }
    }

    for (const selector of selectors) selector.literals = selector.isXPath ? xpathLiterals(selector) : [];
    return selectors.sort((a, b) => a.start - b.start);
  }

  /*
   * Everything this module needs to know about a spec. Options: dataName (the
   * variable that holds test data; read from the import by default).
   */
  function analyze(source, options) {
    const settings = options || {};
    const scan = tokenize(source);
    const text = scan.text;
    const sig = scan.tokens.filter((token) => token.type !== 'comment');
    const byContext = new Map();
    sig.forEach((token, index) => {
      token.index = index;
      const list = byContext.get(token.ctx);
      token.next = null;
      if (list) {
        token.prev = list[list.length - 1];
        token.prev.next = token;
        list.push(token);
      } else {
        token.prev = null;
        byContext.set(token.ctx, [token]);
      }
    });
    markModuleSpecifiers(sig);
    const dataImport = findDataImport(text, sig);
    const dataName = settings.dataName || (dataImport && dataImport.name) || DEFAULT_DATA_NAME;
    const ownData = findOwnData(text, sig, dataName, dataImport);
    const refs = findReferences(text, sig, dataName, scan.contexts, byContext);
    const refByFirst = new Map(refs.map((ref) => [ref.outerFirst, ref]));
    const selectors = findSelectors(text, sig, refs, refByFirst);
    const selectorByToken = new Map();
    for (const selector of selectors) {
      for (const part of selector.parts) {
        if (part.token && !selectorByToken.has(part.token)) selectorByToken.set(part.token, selector);
      }
    }
    return { text, tokens: scan.tokens, sig, dataName, dataImport, ownData, refs, selectors, selectorByToken };
  }

  // ---------------------------------------------------------------------------
  // Default links: values in XPaths that are already test data
  // ---------------------------------------------------------------------------

  function isSecretKey(key) {
    return SECRET_KEY_PATTERN.test(String(key || ''));
  }

  function isValidKey(key) {
    return typeof key === 'string' && IDENTIFIER_PATTERN.test(key) && key.length <= 100;
  }

  function referenceText(dataName, key) {
    return IDENTIFIER_PATTERN.test(key) ? `${dataName}.${key}` : `${dataName}[${JSON.stringify(key)}]`;
  }

  // { key: value | [value, ...] } -> [{ key, value }] that may link.
  function linkableEntries(values, minLength) {
    const entries = [];
    for (const [key, raw] of Object.entries(values || {})) {
      if (isSecretKey(key)) continue;
      const list = Array.isArray(raw) ? raw : [raw];
      const seen = new Set();
      for (const value of list) {
        if (typeof value !== 'string' || seen.has(value)) continue;
        seen.add(value);
        if (value !== value.trim() || value.length < minLength) continue;
        entries.push({ key, value });
      }
    }
    return entries;
  }

  /*
   * Where linkXPathValuesToTestData would put a test-data variable: a value of
   * `values` found inside a quoted literal of an XPath, as a whole word or words
   * ("fj7ndnf1, Skgjjh, 9295671" holds three). Options:
   *   minLength (6): shorter values never link;
   *   requireEarlierReference (true): only a key the spec reads BEFORE the XPath,
   *     the way a search is typed before its result is clicked.
   */
  function collectLinkCandidates(analysis, values, options) {
    const settings = options || {};
    const minLength = Number.isFinite(settings.minLength) ? settings.minLength : MIN_LINK_LENGTH;
    const requireEarlier = settings.requireEarlierReference !== false;
    const entries = linkableEntries(values, minLength);
    if (!entries.length || analysis.ownData) return [];

    const referenceStarts = new Map();
    for (const ref of analysis.refs) {
      if (!referenceStarts.has(ref.key)) referenceStarts.set(ref.key, []);
      referenceStarts.get(ref.key).push(ref.start);
    }
    const latestBefore = (key, position) => {
      let latest = -1;
      for (const start of referenceStarts.get(key) || []) if (start < position && start > latest) latest = start;
      return latest;
    };
    // Lines marked // testdata:keep stay exactly as they are.
    const position = positionFinder(analysis.text);
    const kept = keptLines(analysis, position);

    const chosen = [];
    for (const selector of analysis.selectors) {
      if (!selector.isXPath) continue;
      for (const literal of selector.literals) {
        literal.items.forEach((item, itemIndex) => {
          if (item.kind !== 'text' || item.part.token.unterminated) return;
          const run = item.part.text.slice(item.from, item.to);
          const opensLiteral = itemIndex === 0;
          const closesLiteral = itemIndex === literal.items.length - 1;
          const found = new Map();
          for (const entry of entries) {
            for (let from = 0; ;) {
              const at = run.indexOf(entry.value, from);
              if (at === -1) break;
              from = at + 1;
              const end = at + entry.value.length;
              const boundaryBefore = at > 0 ? !WORD_CHARACTER.test(run[at - 1]) : opensLiteral;
              const boundaryAfter = end < run.length ? !WORD_CHARACTER.test(run[end]) : closesLiteral;
              const cookedFrom = item.from + at;
              const cookedTo = item.from + end;
              if (!boundaryBefore || !boundaryAfter || !isCut(item.part.map, cookedFrom) || !isCut(item.part.map, cookedTo)) continue;
              const rawStart = item.part.map[cookedFrom];
              const rawEnd = item.part.map[cookedTo];
              if (kept.has(position(rawStart).line)) continue;
              const slot = `${rawStart}:${rawEnd}`;
              if (!found.has(slot)) found.set(slot, { start: rawStart, end: rawEnd, value: entry.value, part: item.part, keys: [] });
              found.get(slot).keys.push(entry.key);
            }
          }
          const occurrences = [];
          for (const occurrence of found.values()) {
            const ranked = occurrence.keys
              .map((key, order) => ({ key, order, latest: latestBefore(key, occurrence.start) }))
              .filter((item) => !requireEarlier || item.latest >= 0)
              .sort((a, b) => (b.latest - a.latest) || (a.order - b.order));
            if (!ranked.length) continue;
            occurrences.push({ start: occurrence.start, end: occurrence.end, key: ranked[0].key, value: occurrence.value, part: occurrence.part });
          }
          // Longest first, then left to right; never two on the same characters.
          occurrences.sort((a, b) => ((b.end - b.start) - (a.end - a.start)) || (a.start - b.start));
          const taken = [];
          for (const occurrence of occurrences) {
            if (taken.some((other) => occurrence.start < other.end && other.start < occurrence.end)) continue;
            taken.push(occurrence);
          }
          chosen.push(...taken);
        });
      }
    }
    return chosen.sort((a, b) => a.start - b.start);
  }

  function findLinkCandidates(source, values, options) {
    const analysis = analyze(source, options);
    return collectLinkCandidates(analysis, values, options).map((candidate) => ({
      start: candidate.start, end: candidate.end, key: candidate.key, value: candidate.value,
    }));
  }

  function applyEdits(text, edits) {
    const ordered = edits.slice().sort((a, b) => b.start - a.start);
    let result = text;
    let limit = Infinity;
    for (const edit of ordered) {
      if (edit.end > limit) throw new Error('Overlapping edits');
      result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
      limit = edit.start;
    }
    return result;
  }

  // A quoted string with some of its raw ranges replaced by code: "a" + code + "b".
  function splitStringToken(text, token, pieces) {
    const quote = token.quote;
    const out = [];
    let cursor = token.contentStart;
    for (const piece of pieces) {
      if (piece.start > cursor) out.push(quote + text.slice(cursor, piece.start) + quote);
      out.push(piece.code);
      cursor = piece.end;
    }
    if (cursor < token.contentEnd) out.push(quote + text.slice(cursor, token.contentEnd) + quote);
    const joined = out.join(' + ');
    return bindsTightBefore(token.prev) || bindsTightAfter(token.next) ? `(${joined})` : joined;
  }

  /*
   * The spec with every value in its XPaths that it already keeps as test data
   * written as that variable (see collectLinkCandidates for which ones). The
   * XPath stays exactly the same for the current values. Returns { text, links }.
   */
  function linkXPathValuesToTestData(source, values, options) {
    const analysis = analyze(source, options);
    const candidates = collectLinkCandidates(analysis, values, options);
    if (!candidates.length) return { text: analysis.text, links: [] };
    const byToken = new Map();
    for (const candidate of candidates) {
      const token = candidate.part.token;
      if (!byToken.has(token)) byToken.set(token, []);
      byToken.get(token).push(candidate);
    }
    const edits = [];
    for (const [token, list] of byToken) {
      list.sort((a, b) => a.start - b.start);
      if (token.type === 'template') {
        for (const candidate of list) {
          edits.push({ start: candidate.start, end: candidate.end, text: '${' + referenceText(analysis.dataName, candidate.key) + '}' });
        }
      } else {
        const pieces = list.map((candidate) => ({ start: candidate.start, end: candidate.end, code: `String(${referenceText(analysis.dataName, candidate.key)})` }));
        edits.push({ start: token.start, end: token.end, text: splitStringToken(analysis.text, token, pieces) });
      }
    }
    return {
      text: applyEdits(analysis.text, edits),
      links: candidates.map((candidate) => ({ key: candidate.key, value: candidate.value })),
    };
  }

  // ---------------------------------------------------------------------------
  // Alt+T: one value <-> one reference
  // ---------------------------------------------------------------------------

  function none(reason) {
    return { type: 'none', reason };
  }

  function innermost(items, range) {
    return items.slice().sort((a, b) => (range(a).end - range(a).start) - (range(b).end - range(b).start))[0];
  }

  /*
   * What Alt+T acts on for this selection (start === end: the cursor):
   *   { type: 'ref', ref, key }                    a testData reference;
   *   { type: 'literal', value, rawStart, rawEnd } text inside a string; with only a
   *       cursor, the quoted value of the XPath it is in, or the whole string;
   *   { type: 'none', reason }                     nothing to toggle.
   */
  function findToggleTarget(source, selectionStart, selectionEnd, options) {
    const analysis = analyze(source, options);
    if (analysis.ownData) return { type: 'none', reason: analysis.ownData.reason, analysis, ownData: true };
    const text = analysis.text;
    let start = Math.max(0, Math.min(text.length, Number(selectionStart) || 0));
    let end = Math.max(0, Math.min(text.length, selectionEnd === undefined || selectionEnd === null ? start : Number(selectionEnd) || 0));
    if (end < start) [start, end] = [end, start];

    const hits = analysis.refs.filter((ref) => {
      const range = referenceRange(ref);
      return start >= range.start && end <= range.end;
    });
    if (hits.length) {
      const ref = innermost(hits, referenceRange);
      const range = referenceRange(ref);
      return { type: 'ref', analysis, ref, key: ref.key, start: range.start, end: range.end };
    }
    if (end > start && analysis.refs.some((ref) => {
      const range = referenceRange(ref);
      return start < range.end && end > range.start;
    })) {
      return none('Select one value, or put the cursor on one testData reference.');
    }

    const containing = analysis.sig.filter((token) => (token.type === 'string' || token.type === 'template') && start >= token.start && end <= token.end);
    if (!containing.length) return none('Put the cursor in a quoted value or on a testData reference.');
    const token = innermost(containing, (item) => item);
    if (token.moduleSpecifier) return none('That is an import path, not a value.');
    if (token.unterminated) return none('That string is not closed.');

    let contentStart = token.contentStart;
    let contentEnd = token.contentEnd;
    let quasiIndex = -1;
    if (token.type === 'template') {
      quasiIndex = token.quasis.findIndex((quasi) => start >= quasi.start && end <= quasi.end);
      if (quasiIndex === -1) {
        if (start === end && start === token.start) quasiIndex = 0;
        else if (start === end && start === token.end) quasiIndex = token.quasis.length - 1;
        else return none('Select text in one part of the template, between its ${...}.');
      }
      contentStart = token.quasis[quasiIndex].start;
      contentEnd = token.quasis[quasiIndex].end;
    }
    const decoded = decodeRaw(text, contentStart, contentEnd, token.type === 'template');
    const selector = analysis.selectorByToken.get(token) || null;
    const inXPath = Boolean(selector && selector.isXPath);

    let rawStart = start;
    let rawEnd = end;
    let role = null;
    if (start === end) {
      if (inXPath) {
        let found = null;
        for (const literal of selector.literals) {
          for (const item of literal.items) {
            if (item.kind !== 'text' || item.part.token !== token || item.part.quasi !== quasiIndex) continue;
            const itemStart = item.part.map[item.from];
            const itemEnd = item.part.map[item.to];
            if (start >= itemStart && start <= itemEnd) found = { literal, itemStart, itemEnd };
          }
        }
        if (!found) return none('Put the cursor inside a quoted value of the XPath, or select the text.');
        if (found.literal.items.length !== 1) return none('Part of this value is test data already: select the text to change.');
        rawStart = found.itemStart;
        rawEnd = found.itemEnd;
        role = found.literal.role;
      } else {
        if (token.type === 'template' && token.expressions.length) return none('Select the text to turn into test data.');
        rawStart = contentStart;
        rawEnd = contentEnd;
      }
    } else if (start <= contentStart && end >= contentEnd && (start >= token.start && end <= token.end)) {
      rawStart = contentStart;
      rawEnd = contentEnd;
    } else if (start < contentStart || end > contentEnd) {
      return none('Select text inside one string.');
    }

    const from = cookedIndexAt(decoded.map, rawStart);
    const to = cookedIndexAt(decoded.map, rawEnd);
    if (from === -1 || to === -1) return none('The selection cuts an escape sequence (like \\n) in half.');
    const value = decoded.cooked.slice(from, to);
    if (!value) return none('There is no text here to turn into test data.');
    if (!value.trim()) return none('Only spaces are selected.');
    if (inXPath && role === null) {
      for (const literal of selector.literals) {
        for (const item of literal.items) {
          if (item.kind === 'text' && item.part.token === token && item.part.quasi === quasiIndex &&
              item.part.map[item.from] <= rawStart && rawEnd <= item.part.map[item.to]) role = literal.role;
        }
      }
    }
    return {
      type: 'literal', analysis, token, quasi: quasiIndex, rawStart, rawEnd, value, inXPath, role,
      whole: rawStart === contentStart && rawEnd === contentEnd,
    };
  }

  function enclosingCallName(token) {
    let depth = 0;
    for (let cursor = token.prev; cursor; cursor = cursor.prev) {
      if (cursor.type !== 'punct') continue;
      if (cursor.value === ')' || cursor.value === ']' || cursor.value === '}') depth += 1;
      else if (cursor.value === '(' || cursor.value === '[' || cursor.value === '{') {
        if (depth === 0) return cursor.value === '(' && isIdent(cursor.prev) ? cursor.prev.value : null;
        depth -= 1;
      } else if (cursor.value === ';' && depth === 0) {
        return null;
      }
    }
    return null;
  }

  function failure(reason) {
    return { ok: false, reason };
  }

  // The quotes of the nearest string on the same line, so a value written back looks like its neighbours.
  function nearbyQuote(analysis, ref) {
    const text = analysis.text;
    const lineStart = text.lastIndexOf('\n', ref.outerStart - 1) + 1;
    const newline = text.indexOf('\n', ref.outerEnd);
    const lineEnd = newline === -1 ? text.length : newline;
    let best = null;
    let distance = Infinity;
    for (const token of analysis.sig) {
      if (token.type !== 'string' || token.moduleSpecifier || token.ctx !== ref.ctx || token.start < lineStart || token.end > lineEnd) continue;
      const gap = token.start >= ref.outerEnd ? token.start - ref.outerEnd : ref.outerStart - token.end;
      if (gap >= 0 && gap < distance) {
        distance = gap;
        best = token.quote;
      }
    }
    return best;
  }

  // The generator writes selectors and test titles with JSON.stringify ("...") and everything else with '...'.
  function defaultQuoteFor(callName) {
    return SELECTOR_METHODS.has(callName) || callName === 'test' || callName === 'describe' || callName === 'step' ? '"' : "'";
  }

  /*
   * The quotes for a value written back as text: the ones the same call uses elsewhere
   * in the spec (getByTestId("...") stays getByTestId("...")), else those of the
   * nearest string on the line, else the generator's. A value holding one kind of
   * quote gets the other kind, so it needs no escapes.
   */
  function chooseQuote(analysis, ref, value, requested) {
    if (requested === '"' || requested === "'") return requested;
    const callName = enclosingCallName(ref.outerFirst);
    let quote = null;
    if (callName) {
      const tally = { '"': 0, "'": 0 };
      for (const token of analysis.sig) {
        if (token.type !== 'string' || token.moduleSpecifier || !(isPunct(token.prev, '(') || isPunct(token.prev, ','))) continue;
        if (enclosingCallName(token) === callName) tally[token.quote] += 1;
      }
      if (tally['"'] !== tally["'"]) quote = tally['"'] > tally["'"] ? '"' : "'";
    }
    quote = quote || nearbyQuote(analysis, ref) || defaultQuoteFor(callName);
    const other = quote === '"' ? "'" : '"';
    const textValue = String(value);
    return textValue.includes(quote) && !textValue.includes(other) ? other : quote;
  }

  /*
   * Text in a string becomes testData.<key>. The caller owns the test data: the key
   * must hold exactly this value there (a new key gets it). Returns
   * { ok, text, selectionStart, selectionEnd, key, value } - the selection covers the
   * new reference, so Alt+T again turns it back.
   */
  function convertToTestData(source, selectionStart, selectionEnd, key, options) {
    if (!isValidKey(key)) return failure('A key name uses letters, digits, _ and $, and does not start with a digit.');
    const target = findToggleTarget(source, selectionStart, selectionEnd, options);
    if (target.type !== 'literal') return failure(target.type === 'ref' ? 'That is test data already.' : target.reason);
    const { analysis, token } = target;
    const text = analysis.text;
    const ref = referenceText(analysis.dataName, key);
    let result;
    let refStart;
    if (token.type === 'template') {
      result = text.slice(0, target.rawStart) + '${' + ref + '}' + text.slice(target.rawEnd);
      refStart = target.rawStart + 2;
    } else {
      const quote = token.quote;
      const before = text.slice(token.contentStart, target.rawStart);
      const after = text.slice(target.rawEnd, token.contentEnd);
      const inChain = isBinaryPlus(token.prev) || isPlus(token.next);
      let replacement;
      let offset;
      if (!before && !after) {
        replacement = inChain ? `String(${ref})` : ref;
        offset = inChain ? 'String('.length : 0;
      } else {
        const pieces = [];
        if (before) pieces.push(quote + before + quote);
        offset = pieces.length ? pieces[0].length + ' + '.length : 0;
        pieces.push(`String(${ref})`);
        offset += 'String('.length;
        if (after) pieces.push(quote + after + quote);
        replacement = pieces.join(' + ');
        if (bindsTightBefore(token.prev) || bindsTightAfter(token.next)) {
          replacement = `(${replacement})`;
          offset += 1;
        }
      }
      result = text.slice(0, token.start) + replacement + text.slice(token.end);
      refStart = token.start + offset;
    }
    // quote: what the string used, so the editor can write it back exactly the same (inlineTestData's options.quote).
    return { ok: true, text: result, selectionStart: refStart, selectionEnd: refStart + ref.length, key, value: target.value, quote: token.quote };
  }

  /*
   * testData.<key> (in any of its forms) becomes the value it holds, merged into the
   * strings around it: "a" + String(testData.k) + "b" -> "aVALUEb". `value` is what
   * the key holds. Returns { ok, text, selectionStart, selectionEnd, key } - the
   * selection covers the value, so Alt+T again turns it back.
   */
  function inlineTestData(source, selectionStart, selectionEnd, value, options) {
    const settings = options || {};
    const target = findToggleTarget(source, selectionStart, selectionEnd, settings);
    if (target.type !== 'ref') return failure(target.type === 'literal' ? 'That is a value, not test data.' : target.reason);
    const { analysis, ref } = target;
    const text = analysis.text;
    const name = `${analysis.dataName}.${ref.key}`;
    if (ref.complex) return failure(`${name} is part of a longer expression here; change it by hand.`);
    if (isSecretKey(ref.key)) return failure(`${name} looks like a password, so it stays in test data.`);
    if (value === undefined) return failure(`${name} is not in the test data.`);
    if (value === null || typeof value === 'object') return failure(`${name} holds ${Array.isArray(value) ? 'a list' : 'no single value'}, so it cannot be written as text.`);

    let result = ref.wrapped ? String(value) : value;
    if (ref.transforms.length) {
      if (typeof result !== 'string') return failure(`${name} is not text, so ${ref.transforms[0]}() cannot run on it.`);
      for (const transform of ref.transforms) result = String.prototype[transform].call(result);
    }

    if (ref.template) {
      const encoded = encodeTemplateText(String(result));
      const start = ref.expression.open;
      return {
        ok: true, key: ref.key,
        text: text.slice(0, start) + encoded + text.slice(ref.expression.close + 1),
        selectionStart: start, selectionEnd: start + encoded.length,
      };
    }

    const isText = typeof result === 'string';
    const previous = ref.outerFirst.prev;
    const following = ref.outerLast.next;
    let left = null;
    let right = null;
    if (isBinaryPlus(previous) && previous.prev && previous.prev.type === 'string' && !previous.prev.unterminated && !bindsTightBefore(previous.prev.prev)) {
      left = previous.prev;
    }
    if (isPlus(following) && following.next && following.next.type === 'string' && !following.next.unterminated &&
        !bindsTightAfter(following.next.next) && (left || !isBinaryPlus(previous) || isText)) {
      right = following.next;
    }

    if (!left && !right && !isText) {
      const literal = JSON.stringify(result);
      return {
        ok: true, key: ref.key,
        text: text.slice(0, ref.outerStart) + literal + text.slice(ref.outerEnd),
        selectionStart: ref.outerStart, selectionEnd: ref.outerStart + literal.length,
      };
    }

    const quote = left ? left.quote : right ? right.quote : chooseQuote(analysis, ref, result, settings.quote);
    let content = left ? text.slice(left.contentStart, left.contentEnd) : '';
    const valueStart = content.length;
    content += encodeStringText(String(result), quote);
    const valueEnd = content.length;
    if (right) {
      content += right.quote === quote
        ? text.slice(right.contentStart, right.contentEnd)
        : encodeStringText(decodeToken(text, right).cooked, quote);
    }
    const start = left ? left.start : ref.outerStart;
    const end = right ? right.end : ref.outerEnd;
    return {
      ok: true, key: ref.key,
      text: text.slice(0, start) + quote + content + quote + text.slice(end),
      selectionStart: start + 1 + valueStart, selectionEnd: start + 1 + valueEnd,
    };
  }

  // ---------------------------------------------------------------------------
  // For the editor
  // ---------------------------------------------------------------------------

  /*
   * Test data as the editor gets it from GET /api/projects/spec-test-data:
   * fields [{ key, value, original, secret }]. original is the recorded value when a
   * faker field holds a generated one now.
   */
  function normalizeFields(fields) {
    const values = {};
    const originals = {};
    const secrets = new Set();
    for (const field of Array.isArray(fields) ? fields : []) {
      if (!field || typeof field.key !== 'string') continue;
      if (field.secret || isSecretKey(field.key)) secrets.add(field.key);
      if (Object.prototype.hasOwnProperty.call(field, 'value')) values[field.key] = field.value;
      if (Object.prototype.hasOwnProperty.call(field, 'original')) originals[field.key] = field.original;
    }
    return { values, originals, secrets };
  }

  // The values a key may be recognised by: what it holds now, and its recorded value.
  function linkValuesOf(data) {
    const result = {};
    const keys = new Set([...Object.keys(data.values || {}), ...Object.keys(data.originals || {})]);
    for (const key of keys) {
      if ((data.secrets && data.secrets.has(key)) || isSecretKey(key)) continue;
      result[key] = [data.values && data.values[key], data.originals && data.originals[key]].filter((value) => typeof value === 'string');
    }
    return result;
  }

  // Keys (not secret) that hold `value` now or as their recorded value; keys the spec reads first.
  function matchingKeys(analysis, value, data, position) {
    const matches = [];
    const keys = new Set([...Object.keys(data.values || {}), ...Object.keys(data.originals || {})]);
    for (const key of keys) {
      if ((data.secrets && data.secrets.has(key)) || isSecretKey(key)) continue;
      if ((data.values && data.values[key] === value) || (data.originals && data.originals[key] === value)) matches.push(key);
    }
    const rank = (key) => {
      let before = -1;
      let any = false;
      for (const ref of analysis.refs) {
        if (ref.key !== key) continue;
        any = true;
        if (ref.start < position && ref.start > before) before = ref.start;
      }
      return before >= 0 ? 2e9 + before : any ? 1e9 : 0;
    };
    return matches
      .map((key, order) => ({ key, order, score: rank(key) }))
      .sort((a, b) => (b.score - a.score) || (a.order - b.order))
      .map((item) => item.key);
  }

  /*
   * What the editor shows about the selection, and what Alt+T would do:
   *   { kind: 'ref', key, value, original, secret, complex }
   *   { kind: 'literal', value, inXPath, matches: [keys holding this value] }
   *   { kind: 'none', reason }
   */
  function describeSelection(source, selectionStart, selectionEnd, data, options) {
    const target = findToggleTarget(source, selectionStart, selectionEnd, options);
    const store = data || {};
    // The cursor on an amber value (one "Link all" would link): that value and its key,
    // even inside a longer literal ("fj7ndnf1, Skgjjh") or one that is partly test data.
    const caret = Number(selectionStart);
    if (target.type !== 'ref' && caret === Number(selectionEnd === undefined || selectionEnd === null ? caret : selectionEnd)) {
      const analysis = target.analysis || analyze(source, options);
      const hit = collectLinkCandidates(analysis, linkValuesOf(store), options)
        .find((candidate) => candidate.start <= caret && caret <= candidate.end);
      if (hit) {
        return {
          kind: 'literal',
          value: hit.value,
          inXPath: true,
          role: target.type === 'literal' ? target.role : null,
          start: hit.start,
          end: hit.end,
          dataName: analysis.dataName,
          candidate: true,
          matches: [hit.key, ...matchingKeys(analysis, hit.value, store, hit.start).filter((key) => key !== hit.key)],
        };
      }
    }
    if (target.type === 'ref') {
      const key = target.key;
      return {
        kind: 'ref',
        key,
        dataName: target.analysis.dataName,
        value: store.values ? store.values[key] : undefined,
        original: store.originals ? store.originals[key] : undefined,
        secret: Boolean((store.secrets && store.secrets.has(key)) || isSecretKey(key)),
        complex: target.ref.complex,
        start: target.start,
        end: target.end,
      };
    }
    if (target.type === 'literal') {
      return {
        kind: 'literal',
        value: target.value,
        inXPath: target.inXPath,
        role: target.role,
        start: target.rawStart,
        end: target.rawEnd,
        dataName: target.analysis.dataName,
        matches: matchingKeys(target.analysis, target.value, store, target.rawStart),
      };
    }
    return { kind: 'none', reason: target.reason };
  }

  /*
   * Ranges for the editor to paint: 'ref' (test data), 'candidate' (a value the
   * spec already keeps as test data - "Link all" links it) and 'value' (a value in
   * an XPath or a getBy... / fill(...) argument that could become test data).
   */
  function highlightRanges(source, data, options) {
    const analysis = analyze(source, options);
    const store = data || {};
    const ranges = [];
    for (const ref of analysis.refs) {
      const range = referenceRange(ref);
      ranges.push({ start: range.start, end: range.end, kind: 'ref', key: ref.key });
    }
    const candidates = collectLinkCandidates(analysis, linkValuesOf(store), options);
    for (const candidate of candidates) ranges.push({ start: candidate.start, end: candidate.end, kind: 'candidate', key: candidate.key });

    const values = [];
    for (const selector of analysis.selectors) {
      for (const literal of selector.literals) {
        if (literal.role === 'other' || literal.items.length !== 1 || literal.items[0].kind !== 'text') continue;
        const item = literal.items[0];
        values.push({ start: item.part.map[item.from], end: item.part.map[item.to] });
      }
    }
    for (const token of analysis.sig) {
      if (token.type !== 'string' || token.unterminated || token.contentEnd <= token.contentStart) continue;
      if (analysis.selectorByToken.has(token)) continue;
      const call = enclosingCallName(token);
      const inRoleName = isPunct(token.prev, ':') && isIdent(token.prev.prev, 'name') && enclosingCallName(token.prev.prev) === null &&
        isPunct(token.prev.prev.prev, '{') && enclosingCallName(token.prev.prev.prev) === 'getByRole';
      if ((call && VALUE_METHODS.has(call) && (isPunct(token.prev, '(') || isPunct(token.prev, ','))) || inRoleName) {
        values.push({ start: token.contentStart, end: token.contentEnd });
      }
    }
    // A spec with its own testData: no value is offered (Alt+T refuses there).
    for (const value of analysis.ownData ? [] : values) {
      if (ranges.some((range) => value.start < range.end && range.start < value.end)) continue;
      ranges.push({ start: value.start, end: value.end, kind: 'value' });
    }

    ranges.sort((a, b) => a.start - b.start || b.end - a.end);
    const painted = [];
    for (const range of ranges) {
      if (range.end <= range.start) continue;
      const previous = painted[painted.length - 1];
      if (previous && range.start < previous.end) continue;
      painted.push(range);
    }
    return { ranges: painted, candidates: candidates.length, dataName: analysis.dataName, ownData: analysis.ownData };
  }

  function camelCaseWords(words) {
    return words
      .map((word, index) => (index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
      .join('');
  }

  /*
   * A key name for a new test-data value: the locator or input it belongs to
   * (const pickupLocationOption = ... -> pickupLocation), else the value's own words.
   * Never one of takenKeys: name_2, name_3, ... like the generator.
   */
  function suggestKeyName(source, position, value, takenKeys) {
    const text = String(source == null ? '' : source);
    const at = Math.max(0, Math.min(text.length, Number(position) || 0));
    const lineStart = text.lastIndexOf('\n', at - 1) + 1;
    const lineEnd = text.indexOf('\n', at);
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
    let base = '';
    let match = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(line);
    if (match) base = match[1];
    if (!base) {
      match = /([A-Za-z_$][\w$]*)\s*\.\s*(?:fill|type|pressSequentially|selectOption)\s*\(/.exec(line);
      if (match) base = match[1];
    }
    if (base) {
      for (const suffix of KEY_NAME_SUFFIXES) {
        if (base.endsWith(suffix) && base.length - suffix.length >= 3) {
          base = base.slice(0, -suffix.length);
          break;
        }
      }
    }
    if (!base) {
      const plain = String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
      const words = plain.match(/[A-Za-z0-9]+/g) || [];
      base = camelCaseWords(words.slice(0, 4));
      if (/^[0-9]/.test(base)) base = `value${base}`;
    }
    base = base.replace(/[^\w$]/g, '').slice(0, 60);
    if (!IDENTIFIER_PATTERN.test(base)) base = 'value';
    const taken = new Set(takenKeys || []);
    if (!taken.has(base)) return base;
    let suffix = 2;
    while (taken.has(`${base}_${suffix}`)) suffix += 1;
    return `${base}_${suffix}`;
  }

  /*
   * The spec with `import testData from '<importPath>';` (or require(), in a
   * CommonJS spec) when it has no test-data import yet, after its other imports.
   * Returns { text, insertedAt, insertedLength }.
   */
  function ensureTestDataImport(source, importPath, options) {
    const settings = options || {};
    const analysis = analyze(source, settings);
    const text = analysis.text;
    // Imported already - or made by the spec itself, which a second declaration would break.
    if (analysis.dataImport || analysis.ownData) return { text, insertedAt: -1, insertedLength: 0 };
    const name = settings.dataName || DEFAULT_DATA_NAME;
    const file = encodeStringText(String(importPath || './test-data.json'), "'");
    let lastImportEnd = -1;
    let commonJs = false;
    for (const token of analysis.sig) {
      if (token.ctx !== 0) continue;
      if (isIdent(token, 'import') && !isPunct(token.next, '(') && !isPunct(token.next, '.') &&
          (!token.prev || isPunct(token.prev, ';') || isPunct(token.prev, '}'))) {
        let cursor = token.next;
        while (cursor && !(cursor.type === 'string' && cursor.moduleSpecifier)) cursor = cursor.next;
        if (cursor) lastImportEnd = isPunct(cursor.next, ';') ? cursor.next.end : cursor.end;
      }
      if (isIdent(token, 'require') && isPunct(token.next, '(') && token.next.next && token.next.next.type === 'string') {
        commonJs = true;
        if (lastImportEnd === -1 || token.start > lastImportEnd) {
          const close = token.next.next.next;
          if (isPunct(close, ')')) {
            const end = isPunct(close.next, ';') ? close.next.end : close.end;
            const lineBreak = text.indexOf('\n', token.start);
            if (lineBreak === -1 || end <= lineBreak) lastImportEnd = Math.max(lastImportEnd, end);
          }
        }
      }
    }
    const usesImport = analysis.sig.some((token) => isIdent(token, 'import') && token.ctx === 0 && !isPunct(token.next, '('));
    const line = usesImport || !commonJs ? `import ${name} from '${file}';` : `const ${name} = require('${file}');`;
    if (lastImportEnd === -1) {
      return { text: `${line}\n${text}`, insertedAt: 0, insertedLength: line.length + 1 };
    }
    const lineBreak = text.indexOf('\n', lastImportEnd);
    const at = lineBreak === -1 ? text.length : lineBreak + 1;
    const insert = lineBreak === -1 ? `\n${line}` : `${line}\n`;
    return { text: text.slice(0, at) + insert + text.slice(at), insertedAt: at, insertedLength: insert.length };
  }

  // ---------------------------------------------------------------------------
  // Every place: a value changes everywhere in the spec, unless excluded
  // ---------------------------------------------------------------------------

  // Raised when what this file offers changes, so a caller can tell an older copy in a project.
  const MODULE_VERSION = 2;
  // A line holding this comment is left as it is by every-place changes and "Link all":
  //   await page.getByText('Greensboro').click();   // testdata:keep
  const KEEP_MARKER = /testdata\s*:\s*keep\b/i;
  // The title of a test or a step is not test data.
  const TITLE_CALLS = new Set(['test', 'it', 'describe', 'step', 'only', 'skip', 'fixme', 'fail', 'slow']);

  // offset -> { line, column }, both counted from 1.
  function positionFinder(text) {
    const starts = [0];
    for (let k = 0; k < text.length; k += 1) if (text[k] === '\n') starts.push(k + 1);
    return (offset) => {
      let low = 0;
      let high = starts.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (starts[middle] <= offset) low = middle;
        else high = middle - 1;
      }
      return { line: low + 1, column: offset - starts[low] + 1 };
    };
  }

  function keptLines(analysis, position) {
    const lines = new Set();
    for (const token of analysis.tokens) {
      if (token.type === 'comment' && KEEP_MARKER.test(analysis.text.slice(token.start, token.end))) lines.add(position(token.start).line);
    }
    return lines;
  }

  function lineTextAt(text, offset) {
    const start = text.lastIndexOf('\n', offset - 1) + 1;
    const newline = text.indexOf('\n', offset);
    return text.slice(start, newline === -1 ? text.length : newline).trim();
  }

  function isTitleString(token) {
    return isPunct(token.prev, '(') && TITLE_CALLS.has(enclosingCallName(token));
  }

  function placeAt(text, position, kept, start, end, extra) {
    const where = position(start);
    return Object.assign({ start, end, line: where.line, column: where.column, kept: kept.has(where.line), preview: lineTextAt(text, start) }, extra || {});
  }

  /*
   * Every place in the spec's strings that holds `value`: a whole string (or a whole part of a
   * template), or - for values of 3+ characters - whole words inside a longer string, as in the
   * XPath "fj7ndnf1, Skgjjh, 9295671". Never in comments, import paths or test titles.
   * Each place: { start, end, line, column, whole, kept, preview }; kept: its line is marked
   * // testdata:keep.
   */
  function findValuePlaces(source, value, options) {
    const settings = options || {};
    const analysis = settings.analysis || analyze(source, settings);
    const text = analysis.text;
    const target = String(value == null ? '' : value);
    if (!target) return [];
    const position = positionFinder(text);
    const kept = keptLines(analysis, position);
    const places = [];
    for (const token of analysis.sig) {
      if ((token.type !== 'string' && token.type !== 'template') || token.unterminated || token.moduleSpecifier || isTitleString(token)) continue;
      const pieces = token.type === 'template'
        ? token.quasis.map((quasi, index) => ({ start: quasi.start, end: quasi.end, template: true, first: index === 0, last: index === token.quasis.length - 1 }))
        : [{ start: token.contentStart, end: token.contentEnd, template: false, first: true, last: true }];
      const wholeToken = token.type === 'string' || token.expressions.length === 0;
      for (const piece of pieces) {
        const decoded = decodeRaw(text, piece.start, piece.end, piece.template);
        const content = decoded.cooked;
        let lastEnd = -1;
        for (let at = content.indexOf(target); at !== -1; at = content.indexOf(target, at + 1)) {
          const end = at + target.length;
          if (at < lastEnd) continue;
          const whole = wholeToken && at === 0 && end === content.length;
          const before = at > 0 ? !WORD_CHARACTER.test(content[at - 1]) : piece.first;
          const after = end < content.length ? !WORD_CHARACTER.test(content[end]) : piece.last;
          if (!whole && !(target.length >= 3 && before && after)) continue;
          if (!isCut(decoded.map, at) || !isCut(decoded.map, end)) continue;
          places.push(placeAt(text, position, kept, decoded.map[at], decoded.map[end], { whole }));
          lastEnd = end;
        }
      }
    }
    return places.sort((a, b) => a.start - b.start);
  }

  // Every testData.<key> in the spec, in any form; blocked: why one cannot be written as its value.
  function findReferencePlaces(source, key, options) {
    const settings = options || {};
    const analysis = settings.analysis || analyze(source, settings);
    const position = positionFinder(analysis.text);
    const kept = keptLines(analysis, position);
    return analysis.refs
      .filter((ref) => ref.key === key)
      .map((ref) => {
        const range = referenceRange(ref);
        return placeAt(analysis.text, position, kept, range.start, range.end, ref.complex ? { blocked: 'part of a longer expression' } : {});
      })
      .sort((a, b) => a.start - b.start);
  }

  function knownKeys(data) {
    const store = data || {};
    return new Set([
      ...Object.keys(store.values || {}),
      ...Object.keys(store.originals || {}),
      ...(store.secrets ? [...store.secrets] : []),
    ]);
  }

  /*
   * What Alt+T at this selection changes, everywhere in the spec: describeSelection's answer
   * plus `places` - every place holding the same value (or the same testData key), the one at
   * the selection marked current - and, for a value, `suggestedKey`. The caller chooses which
   * places change (by default every one not kept or blocked; the current one always) and
   * applies them with applyValueToggle / applyReferenceToggle.
   */
  function planToggleAt(source, selectionStart, selectionEnd, data, options) {
    const info = describeSelection(source, selectionStart, selectionEnd, data, options);
    if (info.kind === 'none') return info;
    const analysis = analyze(source, options);
    if (info.kind === 'ref') {
      const places = findReferencePlaces(source, info.key, { ...options, analysis })
        .map((place) => (place.start === info.start ? { ...place, current: true } : place));
      return { ...info, places };
    }
    let places = findValuePlaces(source, info.value, { ...options, analysis });
    if (!places.some((place) => place.start === info.start && place.end === info.end)) {
      const position = positionFinder(analysis.text);
      places = places.filter((place) => place.end <= info.start || place.start >= info.end);
      places.push(placeAt(analysis.text, position, keptLines(analysis, position), info.start, info.end, { whole: false }));
      places.sort((a, b) => a.start - b.start);
    }
    places = places.map((place) => (place.start === info.start && place.end === info.end ? { ...place, current: true } : place));
    const suggestedKey = info.matches[0] || suggestKeyName(source, info.start, info.value, knownKeys(data));
    return { ...info, places, suggestedKey };
  }

  // testData.city, testData['city'], String(testData.city).toLowerCase(), ${testData.city} -> 'city'
  function referenceKeyOf(selected, dataName) {
    let text = String(selected).trim();
    if (text.startsWith('${') && text.endsWith('}')) text = text.slice(2, -1).trim();
    text = text.replace(/(?:\s*\.\s*(?:toLowerCase|toUpperCase|trim|toLocaleLowerCase|toLocaleUpperCase)\s*\(\s*\))+$/, '');
    const wrapped = /^String\s*\(\s*([\s\S]*?)\s*\)$/.exec(text);
    if (wrapped) text = wrapped[1];
    const name = dataName.replace(/\$/g, '\\$');
    let match = new RegExp(`^${name}\\s*\\??\\.\\s*([A-Za-z_$][\\w$]*)$`).exec(text);
    if (match) return match[1];
    match = new RegExp(`^${name}\\s*\\[\\s*(['"])(.*)\\1\\s*\\]$`).exec(text);
    return match ? match[2] : null;
  }

  /*
   * The same as planToggleAt for text selected somewhere without its position (an editor
   * outside the UI): a testData reference, else a value - with or without its quotes.
   */
  function planToggleForText(source, selected, data, options) {
    const analysis = analyze(source, options);
    if (analysis.ownData) return { kind: 'none', reason: analysis.ownData.reason, ownData: true };
    const store = data || {};
    const raw = String(selected == null ? '' : selected);
    const key = referenceKeyOf(raw, analysis.dataName);
    if (key !== null) {
      const places = findReferencePlaces(source, key, { ...options, analysis });
      if (places.length) {
        return {
          kind: 'ref', key, dataName: analysis.dataName, places,
          value: store.values ? store.values[key] : undefined,
          original: store.originals ? store.originals[key] : undefined,
          secret: Boolean((store.secrets && store.secrets.has(key)) || isSecretKey(key)),
        };
      }
    }
    let value = raw.trim();
    const quoted = /^(['"`])([\s\S]*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    if (!value) return { kind: 'none', reason: 'Nothing is selected.' };
    let places = findValuePlaces(source, value, { ...options, analysis });
    if (!places.length && value.includes('\\')) {
      const decoded = decodeRaw(value, 0, value.length, false).cooked;
      places = findValuePlaces(source, decoded, { ...options, analysis });
      if (places.length) value = decoded;
    }
    if (!places.length) {
      const shownValue = value.length > 60 ? `${value.slice(0, 57)}...` : value;
      return { kind: 'none', reason: `${JSON.stringify(shownValue)} is not a value in this spec.` };
    }
    const matches = matchingKeys(analysis, value, store, places[0].start);
    return {
      kind: 'literal', value, dataName: analysis.dataName, places, matches,
      suggestedKey: matches[0] || suggestKeyName(source, places[0].start, value, knownKeys(store)),
    };
  }

  // Where a range is after an edit that turned `before` into `after`; null when the edit covered it.
  function trackRange(before, after, range) {
    if (!range) return null;
    let prefix = 0;
    const shortest = Math.min(before.length, after.length);
    while (prefix < shortest && before[prefix] === after[prefix]) prefix += 1;
    let suffix = 0;
    while (suffix < before.length - prefix && suffix < after.length - prefix &&
           before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
    const delta = after.length - before.length;
    if (range.start >= before.length - suffix) return { start: range.start + delta, end: range.end + delta };
    if (range.end <= prefix) return range;
    return null;
  }

  /*
   * The value at `places` becomes testData.<key>, every place in one go (the last first, so the
   * others keep their positions); the spec gets its test-data import when it has none
   * (options.importPath). Returns { ok, text, count, quote, selectionStart, selectionEnd } - the
   * selection is the current place's new reference (-1 when there is none).
   */
  function applyValueToggle(source, places, key, options) {
    const settings = options || {};
    if (!isValidKey(key)) return failure('A key name uses letters, digits, _ and $, and does not start with a digit.');
    if (!places || !places.length) return failure('No place is chosen.');
    let text = String(source);
    let current = null;
    // The quotes of the strings that became a bare reference; written back with them (inlineTestData's
    // options.quote) they come back exactly. Strings split around a reference keep their own quotes.
    const wholeQuotes = new Set();
    for (const place of places.slice().sort((a, b) => b.start - a.start)) {
      const result = convertToTestData(text, place.start, place.end, key, settings);
      if (!result.ok) return failure(`Line ${place.line || '?'}: ${result.reason}`);
      current = trackRange(text, result.text, current);
      if (place.current) current = { start: result.selectionStart, end: result.selectionEnd };
      if (place.whole && (result.quote === '"' || result.quote === "'")) wholeQuotes.add(result.quote);
      text = result.text;
    }
    const quote = wholeQuotes.size === 1 ? [...wholeQuotes][0] : null;
    const imported = ensureTestDataImport(text, settings.importPath || './test-data.json', settings);
    if (current && imported.insertedLength && imported.insertedAt <= current.start) {
      current = { start: current.start + imported.insertedLength, end: current.end + imported.insertedLength };
    }
    return {
      ok: true, text: imported.text, count: places.length, quote, key,
      selectionStart: current ? current.start : -1, selectionEnd: current ? current.end : -1,
    };
  }

  /*
   * testData.<key> at `places` becomes `value`, every place (the last first). options.quote as
   * for inlineTestData. Returns { ok, text, count, selectionStart, selectionEnd }.
   */
  function applyReferenceToggle(source, places, value, options) {
    const settings = options || {};
    if (!places || !places.length) return failure('No place is chosen.');
    let text = String(source);
    let current = null;
    for (const place of places.slice().sort((a, b) => b.start - a.start)) {
      const result = inlineTestData(text, place.start, place.start, value, settings);
      if (!result.ok) return failure(`Line ${place.line || '?'}: ${result.reason}`);
      current = trackRange(text, result.text, current);
      if (place.current) current = { start: result.selectionStart, end: result.selectionEnd };
      text = result.text;
    }
    return { ok: true, text, count: places.length, selectionStart: current ? current.start : -1, selectionEnd: current ? current.end : -1 };
  }

  // The places changed by default: every one not kept by the marker or blocked; the current one always.
  function defaultPlaces(places) {
    return (places || []).filter((place) => place.current || (!place.kept && !place.blocked));
  }

  // "Line 12" - with its column when another of `places` is on the same line.
  function placeName(place, places) {
    const shared = (places || []).some((other) => other !== place && other.line === place.line);
    return shared ? `Line ${place.line}, column ${place.column}` : `Line ${place.line}`;
  }

  // "line 12", "3 places (lines 12, 40)", "2 places (line 12)".
  function placesSummary(places) {
    const lines = [...new Set((places || []).map((place) => place.line))];
    if (places.length === 1) return `line ${lines[0]}`;
    return `${places.length} places (line${lines.length > 1 ? 's' : ''} ${lines.join(', ')})`;
  }

  return {
    MODULE_VERSION,
    KEEP_MARKER,
    MIN_LINK_LENGTH,
    SECRET_KEY_PATTERN,
    IDENTIFIER_PATTERN,
    tokenize,
    analyze,
    decodeRaw,
    isSecretKey,
    isValidKey,
    referenceText,
    findLinkCandidates,
    linkXPathValuesToTestData,
    findToggleTarget,
    convertToTestData,
    inlineTestData,
    normalizeFields,
    linkableValues: linkValuesOf,
    describeSelection,
    highlightRanges,
    suggestKeyName,
    ensureTestDataImport,
    findValuePlaces,
    findReferencePlaces,
    planToggleAt,
    planToggleForText,
    applyValueToggle,
    applyReferenceToggle,
    defaultPlaces,
    placeName,
    placesSummary,
  };
}));
