// backend/tests/fixtures/inline_healer.js
// Inline self-healer for Playwright tests.
// On locator failure, calls OpenAI mid-test for a replacement, retries.

const fs = require('fs');
const path = require('path');

// Find .env by walking up from this file
function findEnvFile() {
  let cur = path.resolve(__dirname);
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(cur, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

const envPath = findEnvFile();
if (envPath) {
  require('dotenv').config({ path: envPath });
}

// Find browser_script.js by walking up
function findBrowserScript() {
  // First check: same directory as this file (e.g., fixtures/browser_script.js)
  const sameDir = path.resolve(__dirname, 'browser_script.js');
  if (fs.existsSync(sameDir)) return sameDir;
  let cur = path.resolve(__dirname);
  for (let i = 0; i < 10; i++) {
    const candidate = path.resolve(cur, 'src', 'healing', 'browser_script.js');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  cur = process.cwd();
  for (let i = 0; i < 10; i++) {
    const candidate = path.resolve(cur, 'src', 'healing', 'browser_script.js');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

const HEAL_LOG_PATH = path.resolve(process.cwd(), 'test-results', 'inline_heals.json');
const BROWSER_SCRIPT_PATH = findBrowserScript();

// Determine which .spec.js file called heal() by walking the stack trace
function getCallingSpecFile() {
  try {
    const err = new Error();
    const stack = err.stack || '';
    const lines = stack.split('\n');
    // Walk from top, find first line that contains '.spec.js'
    for (const line of lines) {
      const m = line.match(/\(([^()]*\.spec\.js)[^()]*\)|at\s+([^\s()]*\.spec\.js)/i);
      if (m) {
        const fullPath = m[1] || m[2] || '';
        if (fullPath) {
          // Make it relative to cwd
          try {
            const rel = path.relative(process.cwd(), fullPath).replace(/\\/g, '/');
            return rel;
          } catch (_) {
            return fullPath.replace(/\\/g, '/');
          }
        }
      }
    }
  } catch (_) {}
  return '';
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const PER_LOCATOR_TIMEOUT = parseInt(process.env.HEAL_PER_LOCATOR_TIMEOUT || '8000', 10);

// One-time-per-process flag: truncate the heal log on the first heal()
// call. This ensures each `npx playwright test` invocation starts with
// an empty log, so apply-heals only sees current-run data.
let _healLogTruncated = false;
function _truncateHealLogOnce() {
  if (_healLogTruncated) return;
  _healLogTruncated = true;
  try {
    const dir = path.dirname(HEAL_LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(HEAL_LOG_PATH, '[]', 'utf8');
  } catch (e) {
    // Non-fatal â€” if we can't truncate, we'll just append to the old log
    console.error('[inline-heal] Could not truncate heal log:', e.message);
  }
}

function _appendHealLog(entry) {
  _truncateHealLogOnce();
  try {
    const dir = path.dirname(HEAL_LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let log = [];
    if (fs.existsSync(HEAL_LOG_PATH)) {
      try {
        const raw = fs.readFileSync(HEAL_LOG_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) log = parsed;
      } catch (_) { log = []; }
    }
    log.push(entry);
    fs.writeFileSync(HEAL_LOG_PATH, JSON.stringify(log, null, 2), 'utf8');
  } catch (_) {}
}

function _loadBrowserScript() {
  if (!BROWSER_SCRIPT_PATH) return '';
  try {
    return fs.readFileSync(BROWSER_SCRIPT_PATH, 'utf8');
  } catch (_) {
    return '';
  }
}

async function _captureLiveDom(page) {
  try {
    const browserScript = _loadBrowserScript();
    if (!browserScript) return { elements: [], url: page.url() };
    const data = await page.evaluate(browserScript);
    return {
      url: page.url(),
      elements: (data && data.elements) || [],
    };
  } catch (e) {
    return { url: page.url ? page.url() : '', elements: [], error: e.message };
  }
}

function _formatElement(el) {
  const parts = [];
  if (el.tag) parts.push(`tag=${el.tag}`);
  if (el.role) parts.push(`role=${el.role}`);
  if (el.text) parts.push(`text="${(el.text || '').slice(0, 60)}"`);
  const a = el.attributes || {};
  for (const k of ['id', 'name', 'placeholder', 'type', 'aria-label',
                   'data-testid', 'data-test', 'data-qa']) {
    if (a[k]) parts.push(`${k}="${a[k]}"`);
  }
  return parts.join(' ');
}

async function _askOpenAIForFix(stepLabel, action, originalLocatorText, error, dom) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set in .env');
  }

  const elementsText = (dom.elements || [])
    .slice(0, 30)
    .map((el, i) => `  ${i + 1}. ${_formatElement(el)}`)
    .join('\n') || '  (no elements found)';

  const prompt =
`A Playwright locator failed during a test. Suggest the SINGLE BEST replacement locator.

Step label: ${stepLabel}
Action being attempted: ${action}
URL: ${dom.url}
Original locator (failing): ${originalLocatorText}
Error: ${(error || '').slice(0, 400)}

Live elements on the page (top 30):
${elementsText}

Your task:
- Pick the most stable Playwright locator that uniquely identifies the element.
- Prefer in this order: getByTestId, getByRole(name:...), getByLabel,
  getByPlaceholder, locator('[name="..."]'), locator('#id').
- The locator must be UNIQUE. Class-only selectors are forbidden.

Output format â€” a single JSON object on ONE LINE, nothing else:
{"locator_code": "page.getByPlaceholder('Enter the username')", "description": "placeholder Enter the username", "reasoning": "matches the input"}

The "locator_code" must be a complete JS expression that evaluates to a Playwright Locator. It will be run with eval().
`;

  const body = {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: 'You are a Playwright locator-healing assistant. Output only one JSON object per response.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.1,
    max_tokens: 400,
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('OpenAI returned empty content');

  let jsonStr = content.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n([\s\S]+?)\n```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();
  const objMatch = jsonStr.match(/\{[\s\S]+\}/);
  if (objMatch) jsonStr = objMatch[0];

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`OpenAI response not valid JSON: ${jsonStr.slice(0, 200)}`);
  }

  if (!parsed.locator_code) {
    throw new Error('OpenAI response missing locator_code field');
  }

  return parsed;
}

function _locatorToString(locator) {
  try {
    if (locator && typeof locator.toString === 'function') {
      return locator.toString();
    }
  } catch (_) {}
  return '<locator>';
}

async function _runAction(locator, action, value) {
  const opts = { timeout: PER_LOCATOR_TIMEOUT };
  switch (action) {
    case 'fill':
      await locator.fill(value || '', opts);
      break;
    case 'click':
      await locator.click(opts);
      break;
    case 'check':
      await locator.check(opts);
      break;
    case 'uncheck':
      await locator.uncheck(opts);
      break;
    case 'selectOption':
      await locator.selectOption(value, opts);
      break;
    case 'press':
      await locator.press(value || 'Enter', opts);
      break;
    case 'hover':
      await locator.hover(opts);
      break;
    case 'visible':
      await locator.waitFor({ state: 'visible', timeout: PER_LOCATOR_TIMEOUT });
      break;
    default:
      throw new Error(`Unsupported action in heal(): ${action}`);
  }
}

async function heal(page, stepLabel, action, value, locatorFn) {
  const startTime = Date.now();
  let originalLocator;
  let originalLocatorText = '<could not read>';

  try {
    originalLocator = locatorFn();
    originalLocatorText = _locatorToString(originalLocator);
  } catch (e) {
    originalLocatorText = `<locator factory threw: ${e.message}>`;
  }

  if (originalLocator) {
    try {
      await _runAction(originalLocator, action, value);
      return;
    } catch (firstError) {
      console.log(`[inline-heal] step "${stepLabel}" â€” original failed, attempting heal...`);

      let dom;
      try {
        dom = await _captureLiveDom(page);
      } catch (e) {
        dom = { url: '', elements: [], error: e.message };
      }

      let aiResponse;
      try {
        aiResponse = await _askOpenAIForFix(
          stepLabel, action, originalLocatorText,
          firstError && firstError.message ? firstError.message : String(firstError),
          dom,
        );
      } catch (aiError) {
        console.log(`[inline-heal] step "${stepLabel}" â€” OpenAI failed: ${aiError.message}`);
        _appendHealLog({
          timestamp: new Date().toISOString(),
          spec_file: getCallingSpecFile(),
          step: stepLabel, action,
          original_locator: originalLocatorText,
          original_error: (firstError.message || '').slice(0, 300),
          healed_locator: null, healed_description: null,
          status: 'heal_failed',
          reason: `OpenAI failed: ${aiError.message}`.slice(0, 300),
          duration_ms: Date.now() - startTime,
        });
        throw firstError;
      }

      let healedLocator;
      try {
        healedLocator = eval(aiResponse.locator_code);
      } catch (evalError) {
        console.log(`[inline-heal] step "${stepLabel}" â€” eval failed: ${evalError.message}`);
        _appendHealLog({
          timestamp: new Date().toISOString(),
          spec_file: getCallingSpecFile(),
          step: stepLabel, action,
          original_locator: originalLocatorText,
          original_error: (firstError.message || '').slice(0, 300),
          healed_locator: aiResponse.locator_code,
          healed_description: aiResponse.description || '',
          status: 'heal_failed',
          reason: `eval failed: ${evalError.message}`.slice(0, 300),
          duration_ms: Date.now() - startTime,
        });
        throw firstError;
      }

      try {
        await _runAction(healedLocator, action, value);
      } catch (retryError) {
        console.log(`[inline-heal] step "${stepLabel}" â€” healed locator also failed`);
        _appendHealLog({
          timestamp: new Date().toISOString(),
          spec_file: getCallingSpecFile(),
          step: stepLabel, action,
          original_locator: originalLocatorText,
          original_error: (firstError.message || '').slice(0, 300),
          healed_locator: aiResponse.locator_code,
          healed_description: aiResponse.description || '',
          status: 'heal_failed',
          reason: `retry failed: ${retryError.message}`.slice(0, 300),
          duration_ms: Date.now() - startTime,
        });
        throw retryError;
      }

      console.log(`[inline-heal] step "${stepLabel}" â€” HEALED: ${aiResponse.description || aiResponse.locator_code}`);
      _appendHealLog({
        timestamp: new Date().toISOString(),
        spec_file: getCallingSpecFile(),
        step: stepLabel, action,
        original_locator: originalLocatorText,
        original_error: (firstError.message || '').slice(0, 300),
        healed_locator: aiResponse.locator_code,
        healed_description: aiResponse.description || '',
        reasoning: aiResponse.reasoning || '',
        status: 'healed',
        duration_ms: Date.now() - startTime,
      });
      return;
    }
  }

  throw new Error(`[heal] step "${stepLabel}": locator factory failed`);
}

function clearHealLog() {
  try {
    if (fs.existsSync(HEAL_LOG_PATH)) {
      fs.unlinkSync(HEAL_LOG_PATH);
    }
  } catch (_) {}
}

module.exports = { heal, clearHealLog };