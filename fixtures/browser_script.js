// backend/src/healing/browser_script.js
//
// Runs inside one document/frame. It discovers visible semantic candidates,
// keeps an in-page number -> Element map for the current healing attempt, and
// returns only JSON-serializable metadata to Node. Open shadow roots are
// traversed. The script reads optional scan settings from
// window.__PW_HEAL_SCAN_OPTIONS__ and never inserts the numbered overlay into
// the application DOM; Node composes the numbered overlay onto captured pixels without live overlay nodes.

// BEGIN RECORDER XPATH ENGINE — copied declarations, not recorder installation.
// listeners.js SHA256: b817d55f326b0145de335d83627e751d681bd557d0bb035f09d7dee8793cd092
// record-trace.js SHA256: 1ca0920b6418d890551bc554446a3c690d826ffda093df343c5f3c103fde96ff
// Re-synced 2026-09-29 from patched-output: 18 declarations updated, 11 added; resolve() starts the search clock.
function createHealingRecorderXPathEngine() {
// Added by the 2026-09-29 re-sync: declarations the current recorder versions depend on.
const SELECTOR_TIME_BUDGET_MS = (() => {
    const override = Number(globalThis.__PW_RECORDER_XPATH_BUDGET_MS__);
    return Number.isFinite(override) && override >= 0 ? override: 30000;
  })();
let selectorSearchDeadlineAt = 0;
function beginSelectorSearchBudget() {
    selectorSearchDeadlineAt = getSelectorSearchNow() + SELECTOR_TIME_BUDGET_MS;
  }
function selectorSearchBudgetExhausted() {
    return getSelectorSearchNow() >= selectorSearchDeadlineAt;
  }
const USER_TYPED_VALUE_MIN_LENGTH = 6;
const userTypedValues = new Set();
function normalizeUserTypedValue(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  }
function rememberUserTypedValue(value, element = null) {
    const normalized = normalizeUserTypedValue(value);
    if (normalized.length < USER_TYPED_VALUE_MIN_LENGTH || normalized.length > 200) {
      return;
    }
    if (String(element?.type || "").toLowerCase() === "password") {
      return;
    }
    userTypedValues.add(normalized);
  }
function isUserTypedValue(value) {
    return userTypedValues.size > 0 && userTypedValues.has(normalizeUserTypedValue(value));
  }
function isSafeFinalAbsoluteXPath(xpath, target) {
    const text = String(xpath || "").trim();
    if (!text || !(target instanceof Element) || !/^\/html(?:\[|\/)/i.test(text)
    || /\/\//.test(text) || /\.\.|\|/.test(text)
    || /\[\s*position\s*\(/i.test(text) || /\[\s*last\s*\(/i.test(text)) {
      return false;
    }
    return matchesOnlyElement(text, target);
  }
function stripXPathStringLiterals(
    xpath
) {
    return String(
        xpath ||
        ""
    ).replace(
        /'[^']*'|"[^"]*"/g,
        "''"
    );
}
// End of added declarations.
const RECORDER_INSTALL_ATTRIBUTE = "data-pw-recorder-listeners-installed";
const RECORDER_LISTENER_VERSION = "2026-09-02-recorder-toolbar-gesture-guard-v59";
const VALIDATION_UI_ATTRIBUTE = "data-pw-recorder-validation-ui";
const GRAPH_ATTRIBUTE_NAME_QUARANTINE = new Set([
    "wire:key",
    "wire:id",
    "wire:snapshot",
    "wire:effects",
    "wire:initial-data",
    "x-data",
    "x-init",
    "x-show",
    "x-model",
    "x-modelable",
    "x-effect",
    "x-ref",
    "x-if",
    "x-for",
    "x-id",
    "x-teleport",
    "x-cloak",
    "x-ignore",
    "x-collapse",
    "icon-class",
  ]);
const GRAPH_ATTRIBUTE_NAME_PREFIX_QUARANTINE = Object.freeze([
    "wire:",
    "x-on:",
    "x-bind:",
    "x-transition",
    "x-model.",
    "v-on:",
    "v-bind:",
    "@",
    ":",
  ]);
const GRAPH_ATTRIBUTE_VALUE_QUARANTINE = Object.freeze([
    "pv_id",
  ]);
const GRAPH_GENERATED_RUNTIME_VALUE_PATTERNS = Object.freeze([
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    /(?:^|[-_:./])\d{8,}(?=$|[-_:./])/,
    /^(?:ember|react-select|headlessui|radix|mui|downshift)(?:[-_:].*)?$/i,
    /^:r[a-z0-9_-]*:?$/i,
    /*
     * React useId(), in every format React has shipped, wherever it sits in
     * the value - form libraries build ids like "_r_1l8_-form-item" from it.
     * The token changes with render order, so it is never a stable locator.
     *   React 18      :r1:     :R2a:
     *   React 19.0    «r1»
     *   React 19.1+   _r_1l8_
     * Matched only as a token of its own, so ids like "user_r_12x" are safe.
     */
    /(?:^|[^a-z0-9]):r[a-z0-9]+:(?=$|[^a-z0-9])/i,
    /«r[a-z0-9]+»/i,
    /(?:^|[^a-z0-9])_r_[a-z0-9]+_(?=$|[^a-z0-9])/i,
    /^tippy-\d+$/i,
    /*
     * Math.random().toString(36) - "0.ywvqvqjsb5d". Slips past the hex and
     * long-token checks because the tail is neither hex nor 16 characters,
     * and a page using it for element ids hands out a different one on every
     * load. Seen live as <nav id="0.ywvqvqjsb5d">.
     */
    /^0\.[a-z0-9]{6,}$/i,
  ]);
const GRAPH_MUTABLE_STATE_ATTRIBUTE_NAMES = new Set([
    "value",
    "checked",
    "selected",
    "disabled",
    "readonly",
    "hidden",
    "open",
    "tabindex",
    "aria-activedescendant",
    "aria-busy",
    "aria-checked",
    "aria-current",
    "aria-describedby",
    "aria-disabled",
    "aria-expanded",
    "aria-hidden",
    "aria-invalid",
    "aria-pressed",
    "aria-selected",
    "aria-valuemax",
    "aria-valuemin",
    "aria-valuenow",
    "aria-valuetext",
    "data-p",
    "data-state",
    "data-headlessui-state",
    "data-highlighted",
    "data-selected",
    "data-checked",
    "data-active",
    "data-open",
  ]);
const GRAPH_XPATH_MAX_LENGTH = 720;
const SELECTOR_PRIMARY_SLICE_STEPS = 12;
const SELECTOR_DOWNWARD_SLICE_STEPS = 8;
const SELECTOR_SLICE_MAX_MS = SELECTOR_TIME_BUDGET_MS;
const SELECTOR_DISPATCH_SETTLE_MAX_MS = SELECTOR_TIME_BUDGET_MS;
const SELECTOR_DISPATCH_SETTLE_MAX_ROUNDS = Number.MAX_SAFE_INTEGER;
const LINEAR_SCAN_MAX_ANCESTOR_DEPTH = 32;
const LINEAR_SCAN_MAX_VISITED = 5000;
const LINEAR_SCAN_MAX_SIBLINGS_PER_RING = 256;
const LINEAR_SCAN_MAX_PEER_CHILDREN_PER_RING = 512;
const LINEAR_SCAN_DOWNWARD_MAX_DEPTH = 6;
const LINEAR_SCAN_DOWNWARD_MAX_VISITED = 1200;
const LINEAR_SCAN_MAX_ANCHOR_XPATHS = 3;
const LINEAR_SCAN_MAX_ANCHOR_CANDIDATES = 5;
const LINEAR_SCAN_MAX_TARGET_NODE_TESTS = 32;
const LINEAR_SCAN_MAX_GENERATED = 3500;
const FAST_XPATH_MAX_MS = SELECTOR_TIME_BUDGET_MS;
const FAST_XPATH_MAX_CANDIDATES = 96;
const FAST_XPATH_MAX_ATTRIBUTES = 12;
const FAST_XPATH_ATTRIBUTE_PRIORITY = Object.freeze([
    "data-testid",
    "data-test",
    "data-qa",
    "data-cy",
    "data-label",
    "id",
    "name",
    "aria-label",
    "placeholder",
    "title",
    "x-tooltip",
    "href",
    "role",
    "type",
  ]);
const STRICT_CONTEXT_ELEMENT_TAGS = new Set([
    "li",
    "option",
  ]);
const STRICT_CONTEXT_ELEMENT_ROLES = new Set([
    "listitem",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "option",
    "treeitem",
  ]);
const STRICT_CONTEXT_LOCAL_ATTRIBUTE_NAMES = new Set([
    "data-value",
    "aria-posinset",
  ]);
const STRICT_CONTEXT_GLOBAL_ATTRIBUTE_NAMES = Object.freeze([
    "id",
    "data-testid",
    "data-test",
    "data-qa",
    "data-cy",
  ]);
const LOCAL_CONTROL_RECOVERY_MAX_MS = SELECTOR_TIME_BUDGET_MS;
const LOCAL_CONTROL_RECOVERY_MAX_ANCHORS = 24;
const LOCAL_CONTROL_RECOVERY_MAX_GENERATED = 64;
const GRAPH_CLASS_RECOVERY_MAX_TOKENS = 12;
const GRAPH_CLASS_RECOVERY_TOKEN_QUARANTINE_PATTERNS = Object.freeze([
    /px/i,
  ]);
const GRAPH_CLASS_RECOVERY_MAX_VARIANTS_PER_NODE = 28;
const GRAPH_CLASS_RECOVERY_DIRECT_MAX_VARIANTS = 8;
const GRAPH_CLASS_RECOVERY_TARGET_VARIANTS_PER_ANCHOR = 28;
const GRAPH_CLASS_RECOVERY_STABLE_ANCESTOR_MAX_VARIANTS = 24;
const GRAPH_CLASS_RECOVERY_CLASS_ANCESTOR_MAX_VARIANTS = 12;
const GRAPH_CLASS_RECOVERY_MAX_GENERATED = 420;
const GRAPH_CLASS_RECOVERY_MAX_MS = SELECTOR_TIME_BUDGET_MS;
const SINGLE_INDEX_FALLBACK_MAX_MATCHES = 3;
const SINGLE_INDEX_FALLBACK_MAX_BASE_CANDIDATES = 64;
const SINGLE_INDEX_FALLBACK_MAX_TARGET_VARIANTS = 24;
const SINGLE_INDEX_FALLBACK_MAX_ANCHOR_VARIANTS = 20;
const SINGLE_INDEX_FALLBACK_MAX_VARIANTS_PER_ANCESTOR = 4;
const GRAPH_SCOPED_RECOVERY_MAX_ANCESTOR_DEPTH = 32;
function isRecorderOverlayElement(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    let current = element;
    const visited = new Set();
    while (current instanceof Element && !visited.has(current)) {
      visited.add(current);
      if (current.tagName?.toLowerCase() === "x-pw-glass") {
        return true;
      }
      if (current.hasAttribute?.(VALIDATION_UI_ATTRIBUTE)) {
        return true;
      }
      const root = current.getRootNode?.();
      if (root && root.host instanceof Element && root.host !== current) {
        current = root.host;
        continue;
      }
      current = current.parentElement;
    }
    return false;
  }
function isGraphAttributeNameQuarantined(attributeName) {
    const normalizedName = String(attributeName || "").trim().toLowerCase();
    if (!normalizedName) {
      return false;
    }
    if (GRAPH_ATTRIBUTE_NAME_QUARANTINE.has(normalizedName)) {
      return true;
    }
    return GRAPH_ATTRIBUTE_NAME_PREFIX_QUARANTINE.some(prefix => {
      return normalizedName.startsWith(String(prefix || "").toLowerCase());
    });
  }
function countCaseTransitions(value) {
    const text = String(value || "");
    let transitions = 0;
    let previousKind = "";
    for (const character of text) {
      let currentKind = "";
      if (/[A-Z]/.test(character)) {
        currentKind = "upper";
      } else if (/[a-z]/.test(character)) {
        currentKind = "lower";
      } else {
        continue;
      }
      if (previousKind && previousKind !== currentKind) {
        transitions += 1;
      }
      previousKind = currentKind;
    }
    return transitions;
  }
function looksLikeGeneratedAlphaNumericToken(token) {
    const value = String(token || "");
    if (value.length < 16 || !/^[A-Za-z0-9]+$/.test(value)) {
      return false;
    }
    const uppercaseCount = (value.match(/[A-Z]/g) || []).length;
    const lowercaseCount = (value.match(/[a-z]/g) || []).length;
    const digitCount = (value.match(/\d/g) || []).length;
    const letterCount = uppercaseCount + lowercaseCount;
    if (uppercaseCount < 3 || lowercaseCount < 3 || digitCount < 1 || letterCount < 8) {
      return false;
    }
    const uppercaseRatio = uppercaseCount / letterCount;
    if (uppercaseRatio < 0.2) {
      return false;
    }
    if (countCaseTransitions(value) < 5) {
      return false;
    }
    if (new Set(value).size < 10) {
      return false;
    }
    return true;
  }
function isGraphGeneratedRuntimeValue(value) {
    const normalizedValue = String(value || "").trim();
    if (!normalizedValue) {
      return false;
    }
    if (isUserTypedValue(normalizedValue)) {
      return false;
    }
    if (GRAPH_GENERATED_RUNTIME_VALUE_PATTERNS.some(pattern => {
      return pattern.test(normalizedValue);
    })) {
      return true;
    }
    /*
     * A hash is a WHOLE token: nothing alphanumeric on either side. The
     * run used to be found anywhere, so product codes whose middle happens
     * to be hex were refused as generated - PSDT2401D09500 holds
     * "2401D09500", LMBP3420D06000 holds "3420D06000" - which left a
     * material-picker cell with no usable text and an absolute /html[1]/...
     * path. Real hashes (a3f9c2e81b, 5f2b9c1e7d4a8b3c, btn-9f2c1e7d4a) are
     * still bounded by separators or the value's edges, so they still match.
     */
    const hexadecimalTokens = normalizedValue.match(/(?<![A-Za-z0-9])[0-9a-f]{10,}(?![A-Za-z0-9])/gi) || [];
    for (const token of hexadecimalTokens) {
      if (/[a-f]/i.test(token) && /\d/.test(token)) {
        return true;
      }
    }
    const alphaNumericTokens = normalizedValue.match(/[A-Za-z0-9]{16,}/g) || [];
    for (const token of alphaNumericTokens) {
      if (looksLikeGeneratedAlphaNumericToken(token)) {
        return true;
      }
    }
    return false;
  }
function isGraphAttributeValueQuarantined(value) {
    const normalizedValue = String(value || "").trim();
    if (!normalizedValue) {
      return false;
    }
    if (isGraphGeneratedRuntimeValue(normalizedValue)) {
      return true;
    }
    const lowerCaseValue = normalizedValue.toLowerCase();
    return GRAPH_ATTRIBUTE_VALUE_QUARANTINE.some(fragment => {
      const normalizedFragment = String(fragment || "").trim().toLowerCase();
      return(!!normalizedFragment && lowerCaseValue.includes(normalizedFragment));
    });
  }
function isGraphMutableStateAttributeName(attributeName) {
    const normalizedName = String(attributeName || "").trim().toLowerCase();
    if (!normalizedName) {
      return false;
    }
    return(GRAPH_MUTABLE_STATE_ATTRIBUTE_NAMES.has(normalizedName) || normalizedName.startsWith("data-p-"));
  }
function isGraphAttributeRejected(attributeName, attributeValue) {
    return(isGraphAttributeNameQuarantined(attributeName) || isGraphMutableStateAttributeName(attributeName)
    || isGraphAttributeValueQuarantined(attributeValue));
  }
function normalizeGraphTextValue(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }
function isRepeatedCompositeGraphText(value) {
    const text = normalizeGraphTextValue(value);
    if (text.length < 2 || text.length % 2 !== 0) {
      return false;
    }
    const half = text.length / 2;
    return text.slice(0, half) === text.slice(half);
  }
function getGraphTextProfile(element) {
    if (!(element instanceof Element)) {
      return null;
    }
    const fullText = normalizeGraphTextValue(element.textContent);
    if (!fullText) {
      return null;
    }
    const directTextParts = Array.from(element.childNodes || []).filter(node => {
      return node.nodeType === Node.TEXT_NODE && !!normalizeGraphTextValue(node.nodeValue);
    }).map(node => normalizeGraphTextValue(node.nodeValue));
    if (directTextParts.length > 1 || (directTextParts.length === 1 && element.children.length > 0)) {
      const directText = directTextParts[0];
      if (isRepeatedCompositeGraphText(directText)) {
        return null;
      }
      return {
        value: directText,
        exactPredicate: `text()[normalize-space()=${xpathLiteral(directText)}]`,
        containsPredicate: snippet => `text()[contains(normalize-space(), ${xpathLiteral(snippet)})]`,
        mode: "direct-text-node",
      };
    }
    if (element.children.length === 0) {
      if (isRepeatedCompositeGraphText(fullText)) {
        return null;
      }
      return {
        value: fullText,
        exactPredicate: `normalize-space(.)=${xpathLiteral(fullText)}`,
        containsPredicate: snippet => `contains(normalize-space(.), ${xpathLiteral(snippet)})`,
        mode: "leaf-text",
      };
    }
    const tagName = String(element.localName || element.tagName || "").toLowerCase();
    const role = String(element.getAttribute("role") || "").toLowerCase();
    const ownsSemanticDescendantText = [
      "button",
      "a",
      "label",
      "option",
      "li",
      "summary",
      "legend",
      "th",
    ].includes(tagName) || [
      "button",
      "link",
      "menuitem",
      "option",
      "tab",
    ].includes(role);
    if (!ownsSemanticDescendantText || isRepeatedCompositeGraphText(fullText)
    || element.querySelector("input, textarea, select, button, [contenteditable='true']")) {
      return null;
    }
    return {
      value: fullText,
      exactPredicate: `normalize-space(.)=${xpathLiteral(fullText)}`,
      containsPredicate: snippet => `contains(normalize-space(.), ${xpathLiteral(snippet)})`,
      mode: "semantic-descendant-text",
    };
  }
function xpathLiteral(value) {
    value = String(value);
    if (!value.includes("'")) {
      return `'${value}'`;
    }
    if (!value.includes('"')) {
      return `"${value}"`;
    }
    return("concat(" + value.split("'").map(part => {
      return `'${part}'`;
    }).join(', "\'", ') + ")");
  }
function getXPathTag(element) {
    const tag = element.localName || element.tagName.toLowerCase();
    if (element.namespaceURI === "http://www.w3.org/2000/svg") {
      return(`*[local-name()=` + `${xpathLiteral(
          tag
        )}]`);
    }
    return tag;
  }
function matchesOnlyElement(xpath, targetElement) {
    try {
      const doc = targetElement?.ownerDocument || document;
      const result = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return(result.snapshotLength === 1 && result.snapshotItem(0) === targetElement);
    } catch {
      return false;
    }
  }
function isGraphAttributeEligible(attribute) {
    if (!attribute) {
      return false;
    }
    const name = String(attribute.name || "").trim().toLowerCase();
    const value = String(attribute.value || "");
    const trimmedValue = value.trim();
    if (!name || !trimmedValue) {
      return false;
    }
    if (isGraphAttributeRejected(name, trimmedValue)) {
      return false;
    }
    if (name === RECORDER_INSTALL_ATTRIBUTE || name.startsWith("data-pw-recorder-")) {
      return false;
    }
    if (/^on[a-z]/i.test(name)) {
      return false;
    }
    if (name === "style" || name === "class") {
      return false;
    }
    if (trimmedValue.length > 220) {
      return false;
    }
    return true;
  }
function getGraphAttributeStabilityPenalty(attribute) {
    const name = String(attribute.name || "").trim().toLowerCase();
    const value = String(attribute.value || "").trim();
    if (isGraphAttributeRejected(name, value)) {
      return Number.POSITIVE_INFINITY;
    }
    let penalty = 0;
    if (value.length <= 2) {
      penalty += 7;
    }
    if (value.length > 80) {
      penalty += 6;
    }
    if (value.length > 140) {
      penalty += 10;
    }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      penalty += 28;
    }
    if (/^[0-9a-f_-]{14,}$/i.test(value)) {
      penalty += 20;
    }
    if (/\d{5,}/.test(value)) {
      penalty += 14;
    }
    const digitCount = (value.match(/\d/g) || []).length;
    if (value.length >= 6 && digitCount / value.length > 0.5) {
      penalty += 12;
    }
    if (/[?&#=]/.test(value)) {
      penalty += 6;
    }
    if (/^(true|false|null|undefined|none|on|off)$/i.test(value)) {
      penalty += 9;
    }
    if (name.length <= 2) {
      penalty += 2;
    }
    return penalty;
  }
function getGraphTextSnippet(value) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    if (normalized.length < 12) {
      return "";
    }
    const tentative = normalized.slice(0, 48);
    const lastSpace = tentative.lastIndexOf(" ");
    if (lastSpace >= 16) {
      return tentative.slice(0, lastSpace).trim();
    }
    return tentative.trim();
  }
function deriveGraphStableFragments(rawValue) {
    const value = String(rawValue || "").trim();
    if (isGraphAttributeValueQuarantined(value)) {
      return[];
    }
    if (value.length < 6) {
      return[];
    }
    const fragments = new Set();
    const addFragment = fragment => {
      const cleaned = String(fragment || "").replace(/^[\s_.:/?#&=-]+|[\s_.:/?#&=-]+$/g, "").trim();
      if (!cleaned || isGraphAttributeValueQuarantined(cleaned)) {
        return;
      }
      if (cleaned.length < 5 || cleaned.length >= value.length || /^\d+$/.test(cleaned)) {
        return;
      }
      fragments.add(cleaned);
    };
    for (const fragment of value.split(/(?:\d{2,}|[0-9a-f]{10,}|[?&#=]+)/gi)) {
      addFragment(fragment);
    }
    for (const fragment of value.split(/[\s_.:/?#&=-]+/)) {
      addFragment(fragment);
    }
    const prefixMatch = value.match(/^[^\d]{5,}/);
    if (prefixMatch) {
      addFragment(prefixMatch[0]);
    }
    const suffixMatch = value.match(/[^\d]{5,}$/);
    if (suffixMatch) {
      addFragment(suffixMatch[0]);
    }
    return Array.from(fragments).sort((left, right) => right.length - left.length).slice(0, 3);
  }
function canUseDirectXPathAttributeName(attributeName) {
    const name = String(attributeName || "").trim();
    if (!name) {
      return false;
    }
    if (/[\s:;]/.test(name)) {
      return false;
    }
    return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name);
  }
function getGraphExactAttributePredicate(attributeName, attributeValue) {
    const name = String(attributeName || "").trim();
    if (isGraphAttributeRejected(name, attributeValue)) {
      return "";
    }
    if (canUseDirectXPathAttributeName(name)) {
      return(`@${name}=` + `${xpathLiteral(
          attributeValue
        )}`);
    }
    return(`@*[name()=` + `${xpathLiteral(
        name
      )}` + ` and .=` + `${xpathLiteral(
        attributeValue
      )}]`);
  }
function getGraphStartsWithAttributePredicate(attributeName, fragment) {
    const name = String(attributeName || "").trim();
    if (isGraphAttributeRejected(name, fragment)) {
      return "";
    }
    if (canUseDirectXPathAttributeName(name)) {
      return(`starts-with(` + `@${name}, ` + `${xpathLiteral(
          fragment
        )})`);
    }
    return(`@*[name()=` + `${xpathLiteral(
        name
      )}` + ` and starts-with(., ` + `${xpathLiteral(
        fragment
      )})]`);
  }
function getGraphContainsAttributePredicate(attributeName, fragments) {
    const name = String(attributeName || "").trim();
    if (isGraphAttributeNameQuarantined(name) || isGraphMutableStateAttributeName(name) || fragments.some(fragment => {
      return isGraphAttributeValueQuarantined(fragment);
    })) {
      return "";
    }
    if (canUseDirectXPathAttributeName(name)) {
      return fragments.map(fragment => {
        return(`contains(` + `@${name}, ` + `${xpathLiteral(
                fragment
              )})`);
      }).join(" and ");
    }
    const conditions = fragments.map(fragment => {
      return(`contains(., ` + `${xpathLiteral(
              fragment
            )})`);
    });
    return(`@*[name()=` + `${xpathLiteral(
        name
      )}` + ` and ` + `${conditions.join(
        " and "
      )}]`);
  }
function isAcceptableGraphXPath(xpath) {
    return(!!xpath && xpath.length <= GRAPH_XPATH_MAX_LENGTH);
  }
function containsNumericPosition(xpath) {
    const text = String(xpath || "");
    return(/\[\s*\d+\s*\]/.test(text) || /\[\s*position\s*\(/i.test(text) || /\[\s*last\s*\(/i.test(text));
  }
function containsExplicitChildAxis(xpath) {
    return /\/child::/i.test(String(xpath || ""));
  }
function containsBlacklistedClassRecoveryToken(xpath) {
    const text = String(xpath || "");
    if (!/@class/i.test(text)) {
      return false;
    }
    /*
     * Judge the class tokens themselves. Testing the whole XPath rejected any
     * selector that merely contained a quarantined substring somewhere else,
     * for example an @src icon filename ending in 24px.svg or visible text
     * such as 1920x1080px, even though its class token was perfectly stable.
     */
    const classRecoveryTokenPattern = /normalize-space\s*\(\s*@class\s*\)[^)]*\)\s*,\s*(?:'([^']*)'|"([^"]*)")/gi;
    let classRecoveryMatch;
    while ((classRecoveryMatch = classRecoveryTokenPattern.exec(text)) !== null) {
      const token = String(classRecoveryMatch[1] ?? classRecoveryMatch[2] ?? "").trim();
      if (token && GRAPH_CLASS_RECOVERY_TOKEN_QUARANTINE_PATTERNS.some(pattern => pattern.test(token))) {
        return true;
      }
    }
    return false;
  }
function isAbsoluteDocumentFallbackXPath(xpath) {
    return /^\/html(?:\[|\/|$)/i.test(String(xpath || "").trim());
  }
function isContextDependentSelectorTarget(target) {
    if (!(target instanceof Element)) {
      return false;
    }
    const tagName = String(target.localName || target.tagName || "").toLowerCase();
    const role = String(target.getAttribute("role") || "").trim().toLowerCase();
    if (STRICT_CONTEXT_ELEMENT_TAGS.has(tagName) || STRICT_CONTEXT_ELEMENT_ROLES.has(role)) {
      return true;
    }
    for (const attributeName of STRICT_CONTEXT_LOCAL_ATTRIBUTE_NAMES) {
      if (target.hasAttribute(attributeName)) {
        return true;
      }
    }
    return false;
  }
function xpathReferencesAttribute(xpath, attributeName) {
    const escapedName = escapeRegularExpression(attributeName);
    return new RegExp(`@${escapedName}(?=[\\s=\\]\\),])`, "i").test(String(xpath || ""));
  }
function xpathHasStableGlobalIdentity(xpath) {
    return STRICT_CONTEXT_GLOBAL_ATTRIBUTE_NAMES.some(attributeName => {
      return xpathReferencesAttribute(xpath, attributeName);
    });
  }
function xpathHasAdditionalUnquotedPathStep(xpath) {
    const text = String(xpath || "").trim();
    const remainder = text.startsWith("//") ? text.slice(2): text;
    let quote = "";
    for (const character of remainder) {
      if (quote) {
        if (character === quote) {
          quote = "";
        }
        continue;
      }
      if (character === "'" || character === '"') {
        quote = character;
        continue;
      }
      if (character === "/") {
        return true;
      }
    }
    return false;
  }
function passesStrictContextStabilityPolicy(xpath, target) {
    if (!(target instanceof Element) || !isContextDependentSelectorTarget(target)) {
      return true;
    }
    /*
     * Local option values/text are commonly cloned into another hidden or
     * subsequently opened dropdown. They are not globally stable identities.
     * A strong globally intended attribute may stand alone; everything else
     * must be tied to an ancestor/sibling/nearby-anchor path.
     */
    return xpathHasStableGlobalIdentity(xpath) || xpathHasAdditionalUnquotedPathStep(xpath);
  }
function escapeRegularExpression(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
function containsQuarantinedAttributeValue(xpath) {
    const xpathText = String(xpath || "");
    const normalizedXPath = xpathText.toLowerCase();
    if (!normalizedXPath) {
      return false;
    }
    for (const attributeName of GRAPH_ATTRIBUTE_NAME_QUARANTINE) {
      const escapedName = escapeRegularExpression(attributeName);
      const directAttributePattern = new RegExp(`@${escapedName}` + `(?=[\\s=\\]\\),])`, "i");
      const nameFunctionPattern = new RegExp(`name\\(\\)\\s*=\\s*` + `(?:'${escapedName}'|` + `"${escapedName}")`, "i");
      if (directAttributePattern.test(xpathText) || nameFunctionPattern.test(xpathText)) {
        return true;
      }
    }
    const nameFunctionLiteralPattern = /name\(\)\s*=\s*(?:'([^']*)'|"([^"]*)")/gi;
    let nameMatch;
    while ((nameMatch = nameFunctionLiteralPattern.exec(xpathText)) !== null) {
      const attributeName = nameMatch[1] ?? nameMatch[2] ?? "";
      if (isGraphAttributeNameQuarantined(attributeName)) {
        return true;
      }
    }
    const quotedLiteralPattern = /'([^']*)'|"([^"]*)"/g;
    let match;
    while ((match = quotedLiteralPattern.exec(xpathText)) !== null) {
      const literal = match[1] ?? match[2] ?? "";
      /*
       * Only the value heuristics apply here. A quoted literal is text or an
       * attribute VALUE; judging it as an attribute NAME quarantined every
       * literal starting with @ or : (a handle such as @johndoe, a Slack
       * emoji token such as :thumbsup:) because those prefixes exist to catch
       * Vue/Alpine binding attribute names. Genuine name() literals are
       * already checked by the dedicated loop above.
       */
      if (isGraphAttributeValueQuarantined(literal)) {
        return true;
      }
    }
    return GRAPH_ATTRIBUTE_VALUE_QUARANTINE.some(fragment => {
      const normalizedFragment = String(fragment || "").trim().toLowerCase();
      return(!!normalizedFragment && normalizedXPath.includes(normalizedFragment));
    });
  }
function containsMutableStateAttributeReference(xpath) {
    const normalizedXPath = String(xpath || "").toLowerCase();
    if (!normalizedXPath) {
      return false;
    }
    if (/@data-p(?:\b|-)/i.test(normalizedXPath)) {
      return true;
    }
    for (const attributeName of GRAPH_MUTABLE_STATE_ATTRIBUTE_NAMES) {
      const escapedName = escapeRegularExpression(attributeName);
      const directAttributePattern = new RegExp(`@${escapedName}(?=[\\s=\\]\\),])`, "i");
      if (directAttributePattern.test(normalizedXPath)) {
        return true;
      }
      if (normalizedXPath.includes(`name()='${attributeName}'`) || normalizedXPath.includes(`name()="${attributeName}"`)) {
        return true;
      }
    }
    return false;
  }
function isSafeFinalGraphXPath(xpath, target = null) {
    if (!xpath || !isAcceptableGraphXPath(xpath) || containsNumericPosition(xpath) || containsExplicitChildAxis(xpath)
    || containsBlacklistedClassRecoveryToken(xpath) || isAbsoluteDocumentFallbackXPath(xpath) || containsQuarantinedAttributeValue(xpath)
    || containsMutableStateAttributeReference(xpath)) {
      return false;
    }
    if (target instanceof Element && (!passesStrictContextStabilityPolicy(xpath, target)
    || !matchesOnlyElement(xpath, target))) {
      return false;
    }
    return true;
  }
function getGraphScopedNodeVariants(element, allowText = false) {
    if (!(element instanceof Element) || isRecorderOverlayElement(element)) {
      return[];
    }
    const tag = getXPathTag(element);
    const variants = [];
    const seen = new Set();
    const pushVariant = (nodeTest, score, strategy) => {
      if (!nodeTest || seen.has(nodeTest) || containsNumericPosition(nodeTest) || containsQuarantinedAttributeValue(nodeTest)
      || containsMutableStateAttributeReference(nodeTest)) {
        return;
      }
      seen.add(nodeTest);
      variants.push({
        nodeTest,
        score,
        strategy,
      });
    };
    const attributes = Array.from(element.attributes || []).filter(isGraphAttributeEligible).filter(attribute => {
      return!isGraphAttributeRejected(attribute.name, attribute.value);
    }).map(attribute => {
      return {
        attribute,
        penalty: getGraphAttributeStabilityPenalty(attribute),
      };
    }).filter(candidate => {
      return Number.isFinite(candidate.penalty);
    }).sort((left, right) => left.penalty - right.penalty);
    for (const {
      attribute,
      penalty,
    }
    of attributes) {
      const exactPredicate = getGraphExactAttributePredicate(attribute.name, attribute.value);
      if (exactPredicate) {
        pushVariant(`${tag}[` + `${exactPredicate}]`, penalty, "scoped-exact-attribute");
      }
      const fragments = deriveGraphStableFragments(attribute.value);
      for (const fragment of fragments) {
        if (isGraphAttributeValueQuarantined(fragment)) {
          continue;
        }
        if (String(attribute.value).startsWith(fragment)) {
          const startsWithPredicate = getGraphStartsWithAttributePredicate(attribute.name, fragment);
          if (startsWithPredicate) {
            pushVariant(`${tag}[` + `${startsWithPredicate}]`, penalty + 10, "scoped-starts-with-attribute");
          }
        }
        const containsPredicate = getGraphContainsAttributePredicate(attribute.name, [
          fragment,
        ]);
        if (containsPredicate) {
          pushVariant(`${tag}[` + `${containsPredicate}]`, penalty + 14, "scoped-contains-attribute");
        }
      }
    }
    const combinationAttributes = attributes.slice(0, 12);
    for (let leftIndex = 0; leftIndex < combinationAttributes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < combinationAttributes.length; rightIndex += 1) {
        const left = combinationAttributes[leftIndex];
        const right = combinationAttributes[rightIndex];
        const leftPredicate = getGraphExactAttributePredicate(left.attribute.name, left.attribute.value);
        const rightPredicate = getGraphExactAttributePredicate(right.attribute.name, right.attribute.value);
        if (!leftPredicate || !rightPredicate) {
          continue;
        }
        pushVariant(`${tag}[` + `${leftPredicate} and ${rightPredicate}]`, left.penalty + right.penalty + 3, "scoped-two-attribute");
      }
    }
    if (allowText) {
      const textProfile = getGraphTextProfile(element);
      const normalizedText = textProfile?.value || "";
      if (textProfile && normalizedText.length <= 80) {
        pushVariant(`${tag}[${textProfile.exactPredicate}]`, 100, `scoped-${textProfile.mode}`);
        for (const {
          attribute,
          penalty,
        }
        of attributes.slice(0, 8)) {
          const exactPredicate = getGraphExactAttributePredicate(attribute.name, attribute.value);
          if (!exactPredicate) {
            continue;
          }
          pushVariant(`${tag}[${exactPredicate} and ${textProfile.exactPredicate}]`,
          penalty + 55, "scoped-attribute-and-text");
        }
      }
      const snippet = getGraphTextSnippet(normalizedText);
      if (snippet && textProfile) {
        pushVariant(`${tag}[${textProfile.containsPredicate(snippet)}]`, 115, "scoped-contains-normalized-text");
      }
    }
    return variants.sort((left, right) => left.score - right.score).slice(0, 64);
  }
function getDirectTargetGraphXPath(element, maxVariants = 64, candidateIsAllowed = null) {
    if (!(element instanceof Element) || isRecorderOverlayElement(element)) {
      return "";
    }
    const variants = getGraphScopedNodeVariants(element, true).slice(0, Math.max(1, maxVariants));
    for (const variant of variants) {
      const xpath = `//${variant.nodeTest}`;
      if (isSafeFinalGraphXPath(xpath, element)
      && (!candidateIsAllowed || candidateIsAllowed(xpath, "direct", [element]))) {
        return xpath;
      }
    }
    return "";
  }
function getFastXPathAttributePriority(attributeName) {
    const normalizedName = String(attributeName || "").trim().toLowerCase();
    const priority = FAST_XPATH_ATTRIBUTE_PRIORITY.indexOf(normalizedName);
    return priority >= 0 ? priority: FAST_XPATH_ATTRIBUTE_PRIORITY.length + 1;
  }
function getFastXPathAttributes(element) {
    if (!(element instanceof Element)) {
      return [];
    }
    return Array.from(element.attributes || []).filter(isGraphAttributeEligible).map(attribute => {
      return {
        name: attribute.name,
        value: attribute.value,
        predicate: getGraphExactAttributePredicate(attribute.name, attribute.value),
        priority: getFastXPathAttributePriority(attribute.name),
        stabilityPenalty: getGraphAttributeStabilityPenalty(attribute),
      };
    }).filter(attribute => {
      return !!attribute.predicate && Number.isFinite(attribute.stabilityPenalty);
    }).sort((left, right) => {
      return left.priority - right.priority || left.stabilityPenalty - right.stabilityPenalty
      || left.name.localeCompare(right.name);
    }).slice(0, FAST_XPATH_MAX_ATTRIBUTES);
  }
function getFastClickXPath(element, candidateIsAllowed = null, options = null) {
    /*
     * options.maxMs caps this call's own time. Only the same-click target
     * chooser passes it, to keep its look at up to four candidates inside a
     * few milliseconds; every other caller keeps the full budget.
     */
    const fastXPathMaxMs = Number.isFinite(options?.maxMs) ? Math.min(options.maxMs, FAST_XPATH_MAX_MS): FAST_XPATH_MAX_MS;
    const diagnostics = {
      attempted: true,
      candidatesChecked: 0,
      elapsedMs: 0,
      exhaustedTimeBudget: false,
      exhaustedCandidateBudget: false,
      winningMethod: null,
      strictWholeDocumentValidation: true,
      hiddenElementsIncluded: true,
      contextDependentTarget: false,
      strictContextCandidatesRejected: 0,
    };
    if (!(element instanceof Element) || isRecorderOverlayElement(element)) {
      return {
        xpath: "",
        strategy: "unresolved",
        diagnostics,
      };
    }
    const startedAt = getSelectorSearchNow();
    diagnostics.contextDependentTarget = isContextDependentSelectorTarget(element);
    const tag = getXPathTag(element);
    const attributes = getFastXPathAttributes(element);
    const seen = new Set();
    const timeRemaining = () => {
      const elapsedMs = getSelectorSearchNow() - startedAt;
      diagnostics.elapsedMs = elapsedMs;
      if (elapsedMs >= fastXPathMaxMs || selectorSearchBudgetExhausted()) {
        diagnostics.exhaustedTimeBudget = true;
        return false;
      }
      return true;
    };
    const tryCandidate = (xpath, method) => {
      if (!xpath || seen.has(xpath)) {
        return "";
      }
      if (diagnostics.candidatesChecked >= FAST_XPATH_MAX_CANDIDATES) {
        diagnostics.exhaustedCandidateBudget = true;
        return "";
      }
      if (!timeRemaining()) {
        return "";
      }
      seen.add(xpath);
      diagnostics.candidatesChecked += 1;
      if (!isSafeFinalGraphXPath(xpath, element)
      || (candidateIsAllowed && !candidateIsAllowed(xpath, method, [element]))) {
        if (!passesStrictContextStabilityPolicy(xpath, element)) {
          diagnostics.strictContextCandidatesRejected += 1;
        }
        return "";
      }
      diagnostics.winningMethod = method;
      diagnostics.elapsedMs = getSelectorSearchNow() - startedAt;
      return xpath;
    };
    for (const attribute of attributes) {
      const xpath = tryCandidate(`//${tag}[${attribute.predicate}]`, "single-attribute");
      if (xpath) {
        /* which attribute won, so candidates can be ranked against each other */
        diagnostics.winningAttribute = attribute.name;
        return {
          xpath,
          strategy: "primary",
          diagnostics,
        };
      }
    }
    const textProfile = getGraphTextProfile(element);
    if (textProfile?.value && textProfile.value.length <= 80) {
      const textXPath = tryCandidate(`//${tag}[${textProfile.exactPredicate}]`, textProfile.mode);
      if (textXPath) {
        return {
          xpath: textXPath,
          strategy: "primary",
          diagnostics,
        };
      }
      for (const attribute of attributes.slice(0, 8)) {
        const xpath = tryCandidate(`//${tag}[${attribute.predicate} and ${textProfile.exactPredicate}]`,
        "attribute-and-text");
        if (xpath) {
          diagnostics.winningAttribute = attribute.name;
          return {
            xpath,
            strategy: "primary",
            diagnostics,
          };
        }
      }
    }
    for (let leftIndex = 0; leftIndex < attributes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < attributes.length; rightIndex += 1) {
        const xpath = tryCandidate(`//${tag}[${attributes[leftIndex].predicate} and ${attributes[rightIndex].predicate}]`,
        "two-attribute");
        if (xpath) {
          return {
            xpath,
            strategy: "primary",
            diagnostics,
          };
        }
        if (diagnostics.exhaustedTimeBudget || diagnostics.exhaustedCandidateBudget) {
          break;
        }
      }
      if (diagnostics.exhaustedTimeBudget || diagnostics.exhaustedCandidateBudget) {
        break;
      }
    }
    if (!diagnostics.exhaustedTimeBudget && !diagnostics.exhaustedCandidateBudget) {
      outer: for (let firstIndex = 0; firstIndex < attributes.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < attributes.length; secondIndex += 1) {
          for (let thirdIndex = secondIndex + 1; thirdIndex < attributes.length; thirdIndex += 1) {
            const xpath = tryCandidate(`//${tag}[${attributes[firstIndex].predicate} and ${attributes[secondIndex].predicate}`
            + ` and ${attributes[thirdIndex].predicate}]`, "three-attribute");
            if (xpath) {
              return {
                xpath,
                strategy: "primary",
                diagnostics,
              };
            }
            if (diagnostics.exhaustedTimeBudget || diagnostics.exhaustedCandidateBudget) {
              break outer;
            }
          }
        }
      }
    }
    diagnostics.elapsedMs = getSelectorSearchNow() - startedAt;
    return {
      xpath: "",
      strategy: "unresolved",
      diagnostics,
    };
  }
function findLocalControlRelationshipXPath(target, candidateIsAllowed = null) {
    if (!(target instanceof Element) || isRecorderOverlayElement(target)) {
      return "";
    }
    const startedAt = getSelectorSearchNow();
    const targetVariants = getGraphScopedNodeVariants(target, false).slice(0, 8);
    if (!targetVariants.length) {
      return "";
    }
    const anchors = [];
    const seen = new Set([
      target,
    ]);
    const pushAnchor = element => {
      if (!(element instanceof Element) || seen.has(element) || isRecorderOverlayElement(element)) {
        return;
      }
      const tagName = element.tagName?.toLowerCase();
      if (tagName === "html" || tagName === "body") {
        return;
      }
      seen.add(element);
      anchors.push(element);
    };
    const parent = target.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(element => element !== target).sort((left, right) => {
        const rank = element => [
          "input",
          "textarea",
          "select",
          "label",
          "button",
        ].indexOf(element.tagName?.toLowerCase()) + 1 || 99;
        return rank(left) - rank(right);
      });
      siblings.forEach(pushAnchor);
    }
    let ancestor = parent;
    let depth = 0;
    while (ancestor instanceof Element && depth < 8 && anchors.length < LOCAL_CONTROL_RECOVERY_MAX_ANCHORS) {
      pushAnchor(ancestor);
      Array.from(ancestor.children).forEach(pushAnchor);
      ancestor = ancestor.parentElement;
      depth += 1;
    }
    let generated = 0;
    for (const anchor of anchors.slice(0, LOCAL_CONTROL_RECOVERY_MAX_ANCHORS)) {
      if (getSelectorSearchNow() - startedAt >= LOCAL_CONTROL_RECOVERY_MAX_MS || generated >= LOCAL_CONTROL_RECOVERY_MAX_GENERATED
      || selectorSearchBudgetExhausted()) {
        break;
      }
      const anchorXPath = getDirectTargetGraphXPath(anchor, 4);
      if (!anchorXPath) {
        continue;
      }
      for (const targetVariant of targetVariants) {
        if (getSelectorSearchNow() - startedAt >= LOCAL_CONTROL_RECOVERY_MAX_MS || generated >= LOCAL_CONTROL_RECOVERY_MAX_GENERATED
        || selectorSearchBudgetExhausted()) {
          break;
        }
        const nodeTest = targetVariant.nodeTest;
        const candidates = [];
        if (anchor.contains(target)) {
          candidates.push(`${anchorXPath}//${nodeTest}`);
        }
        if (anchor.parentElement && anchor.parentElement === target.parentElement) {
          const position = anchor.compareDocumentPosition(target);
          if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
            candidates.push(`${anchorXPath}/following-sibling::${nodeTest}`);
          }
          if (position & Node.DOCUMENT_POSITION_PRECEDING) {
            candidates.push(`${anchorXPath}/preceding-sibling::${nodeTest}`);
          }
        }
        const position = anchor.compareDocumentPosition(target);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
          candidates.push(`${anchorXPath}/following::${nodeTest}`);
        }
        if (position & Node.DOCUMENT_POSITION_PRECEDING) {
          candidates.push(`${anchorXPath}/preceding::${nodeTest}`);
        }
        for (const xpath of candidates) {
          generated += 1;
          if (isSafeFinalGraphXPath(xpath, target)
          && (!candidateIsAllowed || candidateIsAllowed(xpath, "local-relationship", [anchor, target]))) {
            return xpath;
          }
          if (generated >= LOCAL_CONTROL_RECOVERY_MAX_GENERATED) {
            break;
          }
        }
      }
    }
    return "";
  }
function findDescendantBackReferenceXPath(target, candidateIsAllowed = null) {
    const outcome = {
      xpath: "",
      visited: 0,
      generated: 0,
      linearSteps: 0,
      descendantXPath: "",
      descendantStrategy: null,
    };
    if (!(target instanceof Element) || isRecorderOverlayElement(target)) {
      return outcome;
    }
    const targetTag = getXPathTag(target);
    const descendantCancellation = {
      cancelled: false,
    };
    const maxDescendants = 48;
    const maxGenerated = 512;
    const maxLinearSteps = 800;
    const maxLinearStepsPerDescendant = 220;
    for (const entry of iterateLinearDownwardElements(target, descendantCancellation)) {
      if (outcome.visited >= maxDescendants || outcome.generated >= maxGenerated
      || outcome.linearSteps >= maxLinearSteps) {
        break;
      }
      const descendant = entry.element;
      outcome.visited += 1;
      const descendantCandidates = [];
      const seen = new Set();
      let processedCandidateCount = 0;
      const queue = (xpath, strategy) => {
        if (!xpath || seen.has(xpath) || isAbsoluteDocumentFallbackXPath(xpath)
        || containsNumericPosition(xpath)) {
          return;
        }
        seen.add(xpath);
        descendantCandidates.push({
          xpath,
          strategy,
        });
      };
      const tryQueuedBackReferences = () => {
        while (processedCandidateCount < descendantCandidates.length && outcome.generated < maxGenerated) {
          const descendantCandidate = descendantCandidates[processedCandidateCount];
          processedCandidateCount += 1;
          const xpath = `${descendantCandidate.xpath}/ancestor::${targetTag}`;
          outcome.generated += 1;
          if (!isSafeFinalGraphXPath(xpath, target)
          || (candidateIsAllowed && !candidateIsAllowed(xpath, "descendant-back-reference", [descendant, target]))) {
            continue;
          }
          outcome.xpath = xpath;
          outcome.descendantXPath = descendantCandidate.xpath;
          outcome.descendantStrategy = descendantCandidate.strategy;
          return true;
        }
        return false;
      };
      const fast = getFastClickXPath(descendant);
      queue(fast.xpath, "descendant-fast");
      queue(getDirectTargetGraphXPath(descendant, 64), "descendant-direct");
      queue(findLocalControlRelationshipXPath(descendant), "descendant-local-relationship");
      if (tryQueuedBackReferences()) {
        return outcome;
      }

      /*
       * The descendant may also be non-unique by itself. Give it a small
       * upward/surrounding scan so a unique row label or nearby cell can
       * identify it, then climb from that exact descendant back to target.
       * This is the missing case behind paths such as a bare table cell whose
       * only useful identity is a child company name plus a sibling RFP id.
       */
      const linearCancellation = {
        cancelled: false,
      };
      const linearStatistics = {
        visited: 0,
        generated: 0,
      };
      const linearIterator = createLinearXPathSearch(descendant, "upward", linearCancellation,
      new Map(), linearStatistics);
      let descendantLinearSteps = 0;
      while (descendantLinearSteps < maxLinearStepsPerDescendant
      && outcome.linearSteps < maxLinearSteps && outcome.generated < maxGenerated) {
        const next = linearIterator.next();
        descendantLinearSteps += 1;
        outcome.linearSteps += 1;
        if (next.done) {
          queue(next.value, "descendant-linear-upward");
          break;
        }
      }
      linearCancellation.cancelled = true;
      outcome.generated += linearStatistics.generated;
      if (tryQueuedBackReferences()) {
        return outcome;
      }
    }
    return outcome;
  }
function getGraphClassRecoveryTokenPredicate(token) {
    const normalizedToken = String(token || "").trim();
    if (!normalizedToken) {
      return "";
    }
    return(`contains(concat(' ', normalize-space(@class), ' '), ` + `${xpathLiteral(
        ` ${normalizedToken} `
      )})`);
  }
function getGraphClassRecoveryTokens(element, tokenCountCache) {
    if (!(element instanceof Element)) {
      return[];
    }
    const ownerDocument = element.ownerDocument || document;
    const tokens = Array.from(new Set(String(element.getAttribute("class") || "").split(/\s+/).map(token => token.trim()).filter(token => {
      if (!token || token.length > 80) {
        return false;
      }
      if (GRAPH_CLASS_RECOVERY_TOKEN_QUARANTINE_PATTERNS.some(pattern => pattern.test(token))) {
        return false;
      }
      return!/^(?:active|selected|open|closed|checked|disabled|enabled|focused|hovered)$/i.test(token);
    })));
    return tokens.map(token => {
      let matchCount = tokenCountCache.get(token);
      if (!Number.isFinite(matchCount)) {
        try {
          matchCount = ownerDocument.getElementsByClassName(token).length;
        } catch {
          matchCount = Number.MAX_SAFE_INTEGER;
        }
        tokenCountCache.set(token, matchCount);
      }
      const generatedLookingPenalty = /[\[\]{}]|\d{5,}|^[a-f\d]{8,}$/i.test(token) ? 80: 0;
      return {
        token,
        matchCount,
        score: matchCount * 12 + generatedLookingPenalty + Math.min(token.length, 60),
      };
    }).sort((left, right) => left.score - right.score || left.token.length - right.token.length || left.token.localeCompare(right.token)).slice(0,
    GRAPH_CLASS_RECOVERY_MAX_TOKENS);
  }
function getGraphClassRecoveryNodeVariants(element, allowText, tokenCountCache) {
    if (!(element instanceof Element) || isRecorderOverlayElement(element)) {
      return[];
    }
    const tag = getXPathTag(element);
    const classVariants = [];
    const classSeen = new Set();
    const pushClassVariant = (nodeTest, score, strategy) => {
      if (!nodeTest || classSeen.has(nodeTest) || containsNumericPosition(nodeTest) || containsQuarantinedAttributeValue(nodeTest)
      || containsMutableStateAttributeReference(nodeTest)) {
        return;
      }
      classSeen.add(nodeTest);
      classVariants.push({
        nodeTest,
        score,
        strategy,
      });
    };
    const tokenCandidates = getGraphClassRecoveryTokens(element, tokenCountCache);
    const textProfile = allowText ? getGraphTextProfile(element): null;
    const normalizedText = textProfile?.value || "";
    const exactTextPredicate = textProfile && normalizedText.length <= 100 ? textProfile.exactPredicate: "";
    const stableAttributes = Array.from(element.attributes || []).filter(isGraphAttributeEligible).map(attribute => ({
      attribute,
      penalty: getGraphAttributeStabilityPenalty(attribute),
    })).filter(candidate => Number.isFinite(candidate.penalty)).sort((left, right) => left.penalty - right.penalty).slice(0, 4);
    for (const tokenCandidate of tokenCandidates) {
      const classPredicate = getGraphClassRecoveryTokenPredicate(tokenCandidate.token);
      if (!classPredicate) {
        continue;
      }
      pushClassVariant(`${tag}[${classPredicate}]`, tokenCandidate.score + 180, "class-token-recovery");
      if (exactTextPredicate) {
        pushClassVariant(`${tag}[${classPredicate} and ${exactTextPredicate}]`, tokenCandidate.score + 130, "class-token-and-text-recovery");
      }
      for (const {
        attribute,
        penalty,
      }
      of stableAttributes) {
        const attributePredicate = getGraphExactAttributePredicate(attribute.name, attribute.value);
        if (attributePredicate) {
          pushClassVariant(`${tag}[${classPredicate} and ${attributePredicate}]`, tokenCandidate.score + penalty + 115, "class-token-and-attribute-recovery");
        }
      }
    }
    const pairCandidates = tokenCandidates.slice(0, 8);
    for (let leftIndex = 0; leftIndex < pairCandidates.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < pairCandidates.length; rightIndex += 1) {
        const left = pairCandidates[leftIndex];
        const right = pairCandidates[rightIndex];
        const leftPredicate = getGraphClassRecoveryTokenPredicate(left.token);
        const rightPredicate = getGraphClassRecoveryTokenPredicate(right.token);
        if (!leftPredicate || !rightPredicate) {
          continue;
        }
        const pairPredicate = `${leftPredicate} and ` + `${rightPredicate}`;
        pushClassVariant(`${tag}[${pairPredicate}]`, left.score + right.score + 220, "class-token-pair-recovery");
        if (exactTextPredicate) {
          pushClassVariant(`${tag}[${pairPredicate} and ${exactTextPredicate}]`, left.score + right.score + 160, "class-token-pair-and-text-recovery");
        }
      }
    }
    const stableVariants = getGraphScopedNodeVariants(element, allowText).slice(0, 12);
    return[
      ...classVariants.sort((left, right) => left.score - right.score || left.nodeTest.length - right.nodeTest.length).slice(0,
      16),
      ...stableVariants,
    ].slice(0, GRAPH_CLASS_RECOVERY_MAX_VARIANTS_PER_NODE);
  }
function findNonPositionalClassRecoveryXPath(target, candidateIsAllowed = null) {
    const outcome = {
      xpath: "",
      generated: 0,
    };
    if (!(target instanceof Element) || isRecorderOverlayElement(target)) {
      return outcome;
    }
    const startedAt = getSelectorSearchNow();
    const tokenCountCache = new Map();
    const targetVariants = getGraphClassRecoveryNodeVariants(target, true, tokenCountCache);
    const isBudgetAvailable = () => (outcome.generated < GRAPH_CLASS_RECOVERY_MAX_GENERATED && getSelectorSearchNow() - startedAt < GRAPH_CLASS_RECOVERY_MAX_MS
    && !selectorSearchBudgetExhausted());
    const tryXPath = xpath => {
      if (!isBudgetAvailable()) {
        return false;
      }
      outcome.generated += 1;
      if (isSafeFinalGraphXPath(xpath, target)
      && (!candidateIsAllowed || candidateIsAllowed(xpath, "class-token", [target]))) {
        outcome.xpath = xpath;
        return true;
      }
      return false;
    };
    for (const targetVariant of targetVariants.slice(0, GRAPH_CLASS_RECOVERY_DIRECT_MAX_VARIANTS)) {
      if (tryXPath(`//${targetVariant.nodeTest}`)) {
        return outcome;
      }
    }
    const ancestors = [];
    let ancestor = target.parentElement;
    let depth = 0;
    while (ancestor instanceof Element && depth < GRAPH_SCOPED_RECOVERY_MAX_ANCESTOR_DEPTH) {
      const ancestorTag = ancestor.tagName?.toLowerCase();
      if (ancestorTag === "html" || ancestorTag === "body" || isRecorderOverlayElement(ancestor)) {
        break;
      }
      ancestors.push({
        element: ancestor,
        depth,
      });
      ancestor = ancestor.parentElement;
      depth += 1;
    }
    const contextualTargetVariants = targetVariants.slice(0, GRAPH_CLASS_RECOVERY_TARGET_VARIANTS_PER_ANCHOR);
    const stableAncestorCandidates = [];
    const stableAncestorSeen = new Set();
    for (const ancestorEntry of ancestors) {
      const stableVariants = getGraphScopedNodeVariants(ancestorEntry.element, false).slice(0, 4);
      for (const stableVariant of stableVariants) {
        if (stableAncestorSeen.has(stableVariant.nodeTest)) {
          continue;
        }
        stableAncestorSeen.add(stableVariant.nodeTest);
        stableAncestorCandidates.push({
          nodeTest: stableVariant.nodeTest,
          score: (Number.isFinite(stableVariant.score) ? stableVariant.score: 1000) + ancestorEntry.depth * 3,
        });
      }
    }
    stableAncestorCandidates.sort((left, right) => left.score - right.score || left.nodeTest.length - right.nodeTest.length);
    for (const ancestorVariant of stableAncestorCandidates.slice(0, GRAPH_CLASS_RECOVERY_STABLE_ANCESTOR_MAX_VARIANTS)) {
      for (const targetVariant of contextualTargetVariants) {
        if (tryXPath(`//${ancestorVariant.nodeTest}` + `//${targetVariant.nodeTest}`)) {
          return outcome;
        }
        if (!isBudgetAvailable()) {
          return outcome;
        }
      }
    }
    const classAncestorCandidates = [];
    const classAncestorSeen = new Set();
    for (const ancestorEntry of ancestors) {
      if (!isBudgetAvailable()) {
        return outcome;
      }
      const classVariants = getGraphClassRecoveryNodeVariants(ancestorEntry.element, false, tokenCountCache).filter(variant => String(variant.strategy
      || "").startsWith("class-token")).slice(0, 2);
      for (const classVariant of classVariants) {
        if (classAncestorSeen.has(classVariant.nodeTest)) {
          continue;
        }
        classAncestorSeen.add(classVariant.nodeTest);
        classAncestorCandidates.push({
          nodeTest: classVariant.nodeTest,
          score: classVariant.score + ancestorEntry.depth * 6,
        });
      }
    }
    classAncestorCandidates.sort((left, right) => left.score - right.score || left.nodeTest.length - right.nodeTest.length);
    for (const ancestorVariant of classAncestorCandidates.slice(0, GRAPH_CLASS_RECOVERY_CLASS_ANCESTOR_MAX_VARIANTS)) {
      for (const targetVariant of contextualTargetVariants) {
        if (tryXPath(`//${ancestorVariant.nodeTest}` + `//${targetVariant.nodeTest}`)) {
          return outcome;
        }
        if (!isBudgetAvailable()) {
          return outcome;
        }
      }
    }
    return outcome;
  }
function isSafeSingleIndexBaseXPath(xpath) {
    return(!!xpath && isAcceptableGraphXPath(xpath) && !containsNumericPosition(xpath) && !containsExplicitChildAxis(xpath)
    && !containsBlacklistedClassRecoveryToken(xpath) && !isAbsoluteDocumentFallbackXPath(xpath) && !containsQuarantinedAttributeValue(xpath)
    && !containsMutableStateAttributeReference(xpath));
  }
function isSafeFinalSingleIndexedXPath(xpath, target) {
    const text = String(xpath || "").trim();
    const match = /^\(([\s\S]+)\)\[\s*([1-3])\s*\]$/.exec(text);
    if (!match || !isAcceptableGraphXPath(text) || !isSafeSingleIndexBaseXPath(match[1])) {
      return false;
    }
    return matchesOnlyElement(text, target);
  }
function isSameStructuralNodeKind(left, right) {
    return(left instanceof Element && right instanceof Element
    && String(left.localName || left.tagName || "").toLowerCase() === String(right.localName || right.tagName || "").toLowerCase()
    && String(left.namespaceURI || "") === String(right.namespaceURI || ""));
  }
function getStableStructuralStep(element) {
    if (!(element instanceof Element)) {
      return "";
    }
    let ordinal = 1;
    let sibling = element.previousElementSibling;
    while (sibling instanceof Element) {
      if (isSameStructuralNodeKind(sibling, element)) {
        ordinal += 1;
      }
      sibling = sibling.previousElementSibling;
    }
    return `${getXPathTag(element)}[${ordinal}]`;
  }
function buildStableAnchoredRelativePath(anchor, target) {
    if (!(anchor instanceof Element) || !(target instanceof Element)) {
      return "";
    }
    if (anchor === target) {
      return "";
    }
    const steps = [];
    let current = target;
    while (current instanceof Element && current !== anchor) {
      const step = getStableStructuralStep(current);
      if (!step) {
        return "";
      }
      steps.unshift(step);
      current = current.parentElement;
    }
    return current === anchor && steps.length ? `/${steps.join("/")}`: "";
  }
function buildStableAnchoredStructuralXPath(target, candidateIsAllowed = null) {
    if (!(target instanceof Element) || isRecorderOverlayElement(target)) {
      return "";
    }
    const ownerDocument = target.ownerDocument || document;
    if (!(ownerDocument.documentElement instanceof Element) || target.getRootNode?.() !== ownerDocument) {
      return "";
    }
    const candidates = [];
    let anchor = target;
    let depth = 0;
    while (anchor instanceof Element && depth < GRAPH_SCOPED_RECOVERY_MAX_ANCESTOR_DEPTH) {
      const anchorTag = String(anchor.localName || anchor.tagName || "").toLowerCase();
      if (anchorTag === "html" || anchorTag === "body" || isRecorderOverlayElement(anchor)) {
        break;
      }
      const relativePath = buildStableAnchoredRelativePath(anchor, target);
      for (const variant of getGraphScopedNodeVariants(anchor, false).slice(0, 12)) {
        const anchorXPath = `//${variant.nodeTest}`;
        if (!matchesOnlyElement(anchorXPath, anchor)) {
          continue;
        }
        const xpath = `${anchorXPath}${relativePath}`;
        if (!isAcceptableGraphXPath(xpath) || isAbsoluteDocumentFallbackXPath(xpath)
        || !matchesOnlyElement(xpath, target)
        || (candidateIsAllowed && !candidateIsAllowed(xpath, "structural", [anchor, target]))) {
          continue;
        }
        candidates.push({
          xpath,
          score: (Number.isFinite(variant.score) ? variant.score: 1000) + depth * 4 + relativePath.length / 100,
        });
      }
      anchor = anchor.parentElement;
      depth += 1;
    }
    candidates.sort((left, right) => left.score - right.score || left.xpath.length - right.xpath.length);
    return candidates[0]?.xpath || "";
  }
function isSafeFinalStructuralXPath(xpath, target) {
    const text = String(xpath || "").trim();
    if (!text || !(target instanceof Element)) {
      return false;
    }
    /*
     * A structural XPath is proven by still resolving uniquely to the target,
     * not by being byte-identical to the path we would choose right now.
     * Recomputing the preferred path made the proof fail whenever any sibling
     * was added or removed since capture (a spinner, a toast, a lazily
     * rendered row), because the ordinals and the winning anchor shift while
     * the captured XPath keeps matching the element the user pressed.
     */
    if (!text.startsWith("//") || !isAcceptableGraphXPath(text)
    || isAbsoluteDocumentFallbackXPath(text) || containsExplicitChildAxis(text)
    || /\[\s*position\s*\(/i.test(text) || /\[\s*last\s*\(/i.test(text)
    || containsQuarantinedAttributeValue(text) || containsMutableStateAttributeReference(text)
    || containsBlacklistedClassRecoveryToken(text)) {
      return false;
    }
    return matchesOnlyElement(text, target);
  }
function inspectSingleIndexBaseXPath(baseXPath, target) {
    if (!isSafeSingleIndexBaseXPath(baseXPath) || !(target instanceof Element)) {
      return null;
    }
    try {
      const ownerDocument = target.ownerDocument || document;
      const result = ownerDocument.evaluate(baseXPath, ownerDocument, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const matchCount = result.snapshotLength;
      if (matchCount < 1 || matchCount > SINGLE_INDEX_FALLBACK_MAX_MATCHES) {
        return null;
      }
      let targetIndex = - 1;
      for (let index = 0; index < matchCount; index += 1) {
        const match = result.snapshotItem(index);
        if (match === target) {
          targetIndex = index;
        }
      }
      if (targetIndex < 0) {
        return null;
      }
      if (matchCount === 1) {
        return isSafeFinalGraphXPath(baseXPath, target) ? {
          nonIndexedXPath: baseXPath,
          indexedXPath: "",
          baseXPath,
          matchCount,
          ordinal: null,
        }
        : null;
      }
      const ordinal = targetIndex + 1;
      if (ordinal < 1 || ordinal > SINGLE_INDEX_FALLBACK_MAX_MATCHES) {
        return null;
      }
      const indexedXPath = `(${baseXPath})[${ordinal}]`;
      if (!isSafeFinalSingleIndexedXPath(indexedXPath, target)) {
        return null;
      }
      return {
        nonIndexedXPath: "",
        indexedXPath,
        baseXPath,
        matchCount,
        ordinal,
      };
    } catch {
      return null;
    }
  }
function prepareBoundedSemanticFallback(target, candidateIsAllowed = null) {
    const outcome = {
      nonIndexedXPath: "",
      indexedXPath: "",
      baseXPath: "",
      matchCount: null,
      ordinal: null,
      candidatesChecked: 0,
    };
    if (!(target instanceof Element) || isRecorderOverlayElement(target)) {
      return outcome;
    }
    const targetVariants = getGraphScopedNodeVariants(target, true).slice(0, SINGLE_INDEX_FALLBACK_MAX_TARGET_VARIANTS);
    if (!targetVariants.length) {
      return outcome;
    }
    const anchorCandidates = [];
    const anchorSeen = new Set();
    let ancestor = target.parentElement;
    let depth = 0;
    while (ancestor instanceof Element && depth < GRAPH_SCOPED_RECOVERY_MAX_ANCESTOR_DEPTH) {
      const ancestorTag = ancestor.tagName?.toLowerCase();
      if (ancestorTag === "html" || ancestorTag === "body" || isRecorderOverlayElement(ancestor)) {
        break;
      }
      const ancestorVariants = getGraphScopedNodeVariants(ancestor, false).slice(0, SINGLE_INDEX_FALLBACK_MAX_VARIANTS_PER_ANCESTOR);
      for (const ancestorVariant of ancestorVariants) {
        const anchorXPath = `//${ancestorVariant.nodeTest}`;
        if (anchorSeen.has(anchorXPath) || !matchesOnlyElement(anchorXPath, ancestor)) {
          continue;
        }
        anchorSeen.add(anchorXPath);
        anchorCandidates.push({
          xpath: anchorXPath,
          score: ancestorVariant.score + depth * 3,
        });
      }
      ancestor = ancestor.parentElement;
      depth += 1;
    }
    anchorCandidates.sort((left, right) => left.score - right.score || left.xpath.length - right.xpath.length);
    const baseCandidates = [];
    const baseSeen = new Set();
    const pushBaseCandidate = xpath => {
      if (!xpath || baseSeen.has(xpath) || !isSafeSingleIndexBaseXPath(xpath)) {
        return;
      }
      baseSeen.add(xpath);
      baseCandidates.push(xpath);
    };
    for (const anchorCandidate of anchorCandidates.slice(0, SINGLE_INDEX_FALLBACK_MAX_ANCHOR_VARIANTS)) {
      for (const targetVariant of targetVariants) {
        pushBaseCandidate(`${anchorCandidate.xpath}` + `//${targetVariant.nodeTest}`);
      }
    }
    for (const targetVariant of targetVariants) {
      pushBaseCandidate(`//${targetVariant.nodeTest}`);
    }
    for (const baseXPath of baseCandidates) {
      if (outcome.candidatesChecked >= SINGLE_INDEX_FALLBACK_MAX_BASE_CANDIDATES) {
        break;
      }
      outcome.candidatesChecked += 1;
      const inspected = inspectSingleIndexBaseXPath(baseXPath, target);
      if (!inspected) {
        continue;
      }
      if (inspected.nonIndexedXPath
      && (!candidateIsAllowed || candidateIsAllowed(inspected.nonIndexedXPath, "semantic"))) {
        return {
          ...outcome,
          ...inspected,
        };
      }
      if (inspected.indexedXPath && !outcome.indexedXPath
      && (!candidateIsAllowed || candidateIsAllowed(inspected.indexedXPath, "indexed"))) {
        outcome.indexedXPath = inspected.indexedXPath;
        outcome.baseXPath = inspected.baseXPath;
        outcome.matchCount = inspected.matchCount;
        outcome.ordinal = inspected.ordinal;
      }
    }
    return outcome;
  }
function getSelectorSearchNow() {
    return typeof performance?.now === "function" ? performance.now(): Date.now();
  }
function advanceSelectorSearch(iterator, cancellation, maxSteps, diagnostics, diagnosticStepKey) {
    if (!iterator || cancellation.cancelled) {
      return {
        done: true,
        xpath: "",
      };
    }
    const startedAt = getSelectorSearchNow();
    for (let step = 0; step < maxSteps; step += 1) {
      if (cancellation.cancelled) {
        return {
          done: true,
          xpath: "",
        };
      }
      const next = iterator.next();
      diagnostics[diagnosticStepKey] += 1;
      if (next.done) {
        return {
          done: true,
          xpath: typeof next.value === "string" ? next.value: "",
        };
      }
      if (getSelectorSearchNow() - startedAt >= SELECTOR_SLICE_MAX_MS) {
        break;
      }
    }
    return {
      done: false,
      xpath: "",
    };
  }
function cancelSelectorIterator(iterator, cancellation) {
    cancellation.cancelled = true;
    try {
      iterator?.return?.();
    } catch {
    }
  }
function isLinearScanElementAllowed(element, target) {
    if (!(element instanceof Element) || !(target instanceof Element) || !element.isConnected
    || element.ownerDocument !== target.ownerDocument || isRecorderOverlayElement(element)) {
      return false;
    }
    const tagName = String(element.tagName || "").toLowerCase();
    return tagName !== "html" && tagName !== "body";
  }
function getSurroundingLinearSiblings(element) {
    const siblings = [];
    let previous = element?.previousElementSibling || null;
    let next = element?.nextElementSibling || null;
    while ((previous || next) && siblings.length < LINEAR_SCAN_MAX_SIBLINGS_PER_RING) {
      if (previous) {
        siblings.push(previous);
        previous = previous.previousElementSibling;
      }
      if (next && siblings.length < LINEAR_SCAN_MAX_SIBLINGS_PER_RING) {
        siblings.push(next);
        next = next.nextElementSibling;
      }
    }
    return siblings;
  }
function * iterateLinearUpwardElements(target, cancellation = null) {
    if (!isLinearScanElementAllowed(target, target)) {
      return;
    }
    const visited = new Set();
    let visitedCount = 0;
    const emit = function * (element, source, ancestorDepth) {
      if (cancellation?.cancelled || visitedCount >= LINEAR_SCAN_MAX_VISITED || visited.has(element)
      || !isLinearScanElementAllowed(element, target)) {
        return;
      }
      visited.add(element);
      visitedCount += 1;
      yield {
        element,
        source,
        ancestorDepth,
      };
    };
    yield * emit(target, "target", 0);
    for (const sibling of getSurroundingLinearSiblings(target)) {
      if (cancellation?.cancelled || visitedCount >= LINEAR_SCAN_MAX_VISITED) {
        return;
      }
      yield * emit(sibling, "target-sibling", 0);
    }
    let ancestor = target.parentElement;
    let ancestorDepth = 1;
    while (isLinearScanElementAllowed(ancestor, target) && ancestorDepth <= LINEAR_SCAN_MAX_ANCESTOR_DEPTH
    && visitedCount < LINEAR_SCAN_MAX_VISITED) {
      if (cancellation?.cancelled) {
        return;
      }
      yield * emit(ancestor, "ancestor", ancestorDepth);
      const peers = getSurroundingLinearSiblings(ancestor);
      for (const peer of peers) {
        if (cancellation?.cancelled || visitedCount >= LINEAR_SCAN_MAX_VISITED) {
          return;
        }
        yield * emit(peer, "ancestor-peer", ancestorDepth);
      }
      let peerChildrenVisited = 0;
      for (const peer of peers) {
        for (const child of Array.from(peer.children || [])) {
          if (cancellation?.cancelled || visitedCount >= LINEAR_SCAN_MAX_VISITED
          || peerChildrenVisited >= LINEAR_SCAN_MAX_PEER_CHILDREN_PER_RING) {
            break;
          }
          peerChildrenVisited += 1;
          yield * emit(child, "ancestor-peer-child", ancestorDepth);
        }
        if (peerChildrenVisited >= LINEAR_SCAN_MAX_PEER_CHILDREN_PER_RING) {
          break;
        }
      }
      ancestor = ancestor.parentElement;
      ancestorDepth += 1;
    }
  }
function * iterateLinearDownwardElements(target, cancellation = null) {
    if (!isLinearScanElementAllowed(target, target)) {
      return;
    }
    const queue = [];
    for (const child of Array.from(target.children || [])) {
      if (queue.length >= LINEAR_SCAN_DOWNWARD_MAX_VISITED) {
        break;
      }
      queue.push({
        element: child,
        depth: 1,
      });
    }
    const visited = new Set();
    for (let index = 0; index < queue.length && index < LINEAR_SCAN_DOWNWARD_MAX_VISITED; index += 1) {
      if (cancellation?.cancelled) {
        return;
      }
      const entry = queue[index];
      if (visited.has(entry.element) || !isLinearScanElementAllowed(entry.element, target)) {
        continue;
      }
      visited.add(entry.element);
      yield {
        element: entry.element,
        source: "target-descendant",
        ancestorDepth: - entry.depth,
      };
      if (entry.depth >= LINEAR_SCAN_DOWNWARD_MAX_DEPTH) {
        continue;
      }
      for (const child of Array.from(entry.element.children || [])) {
        if (queue.length >= LINEAR_SCAN_DOWNWARD_MAX_VISITED) {
          break;
        }
        queue.push({
          element: child,
          depth: entry.depth + 1,
        });
      }
    }
  }
function getLinearTargetNodeTests(target) {
    if (!(target instanceof Element)) {
      return [];
    }
    const tag = getXPathTag(target);
    const attributes = getFastXPathAttributes(target);
    const tests = [];
    const seen = new Set();
    const push = nodeTest => {
      const xpath = `//${nodeTest}`;
      if (!nodeTest || seen.has(nodeTest) || !isSafeFinalGraphXPath(xpath)) {
        return;
      }
      seen.add(nodeTest);
      tests.push(nodeTest);
    };
    for (const attribute of attributes) {
      push(`${tag}[${attribute.predicate}]`);
    }
    const textProfile = getGraphTextProfile(target);
    if (textProfile?.value && textProfile.value.length <= 80) {
      push(`${tag}[${textProfile.exactPredicate}]`);
      for (const attribute of attributes.slice(0, 8)) {
        push(`${tag}[${attribute.predicate} and ${textProfile.exactPredicate}]`);
      }
    }
    push(tag);
    for (let leftIndex = 0; leftIndex < attributes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < attributes.length; rightIndex += 1) {
        push(`${tag}[${attributes[leftIndex].predicate} and ${attributes[rightIndex].predicate}]`);
        if (tests.length >= LINEAR_SCAN_MAX_TARGET_NODE_TESTS) {
          return tests;
        }
      }
    }
    outer: for (let firstIndex = 0; firstIndex < attributes.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < attributes.length; secondIndex += 1) {
        for (let thirdIndex = secondIndex + 1; thirdIndex < attributes.length; thirdIndex += 1) {
          push(`${tag}[${attributes[firstIndex].predicate} and ${attributes[secondIndex].predicate}`
          + ` and ${attributes[thirdIndex].predicate}]`);
          if (tests.length >= LINEAR_SCAN_MAX_TARGET_NODE_TESTS) {
            break outer;
          }
        }
      }
    }
    return tests.slice(0, LINEAR_SCAN_MAX_TARGET_NODE_TESTS);
  }
function isMeaningfulLinearRelationshipNodeTest(nodeTest, target) {
    const text = String(nodeTest || "").trim();
    if (!text || !(target instanceof Element) || text === getXPathTag(target)) {
      return false;
    }
    const openingBracket = text.indexOf("[");
    const predicateText = openingBracket >= 0 ? text.slice(openingBracket): "";
    if (!predicateText) {
      return false;
    }
    const isSingleGenericControlAttribute = /^\[\s*@(type|role)\s*=([\s\S]+)\]$/i.test(predicateText)
    && !/\s+and\s+/i.test(predicateText);
    return!isSingleGenericControlAttribute;
  }
function getLinearUniqueXPathElement(xpath, ownerDocument, cache) {
    if (cache.has(xpath)) {
      return cache.get(xpath);
    }
    let uniqueElement = null;
    try {
      const result = ownerDocument.evaluate(xpath, ownerDocument, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      if (result.snapshotLength === 1 && result.snapshotItem(0) instanceof Element) {
        uniqueElement = result.snapshotItem(0);
      }
    } catch {
    }
    cache.set(xpath, uniqueElement);
    return uniqueElement;
  }
function getLinearSimpleAnchorXpaths(element, uniquenessCache) {
    if (!(element instanceof Element)) {
      return [];
    }
    const ownerDocument = element.ownerDocument || document;
    const tag = getXPathTag(element);
    const candidateXpaths = [];
    const candidates = [];
    const seen = new Set();
    const queue = xpath => {
      if (!xpath || seen.has(xpath) || candidateXpaths.length >= LINEAR_SCAN_MAX_ANCHOR_CANDIDATES
      || !isSafeFinalGraphXPath(xpath)) {
        return;
      }
      seen.add(xpath);
      candidateXpaths.push(xpath);
    };
    for (const attribute of getFastXPathAttributes(element).slice(0, 3)) {
      queue(`//${tag}[${attribute.predicate}]`);
    }
    const normalizedText = normalizeGraphTextValue(element.textContent);
    if (normalizedText && normalizedText.length <= 80 && !isRepeatedCompositeGraphText(normalizedText)) {
      queue(`//${tag}[normalize-space(.)=${xpathLiteral(normalizedText)}]`);
    }
    queue(`//${tag}`);
    for (const xpath of candidateXpaths) {
      if (getLinearUniqueXPathElement(xpath, ownerDocument, uniquenessCache) === element) {
        candidates.push(xpath);
      }
      if (candidates.length >= LINEAR_SCAN_MAX_ANCHOR_XPATHS) {
        break;
      }
    }
    return candidates;
  }
function * iterateLinearRelationshipCandidates(anchor, target, targetNodeTests, uniquenessCache) {
    if (anchor === target) {
      for (const targetNodeTest of targetNodeTests) {
        yield `//${targetNodeTest}`;
      }
      return;
    }
    const anchorXpaths = getLinearSimpleAnchorXpaths(anchor, uniquenessCache);
    if (!anchorXpaths.length) {
      return;
    }
    const anchorContainsTarget = anchor.contains(target);
    const targetContainsAnchor = target.contains(anchor);
    const sharesParent = !!anchor.parentElement && anchor.parentElement === target.parentElement;
    const position = anchor.compareDocumentPosition(target);
    const meaningfulTargetNodeTests = targetNodeTests.filter(nodeTest => {
      return isMeaningfulLinearRelationshipNodeTest(nodeTest, target);
    });
    for (const anchorXPath of anchorXpaths) {
    const relationshipTargetNodeTests = anchorContainsTarget || targetContainsAnchor || sharesParent
      ? targetNodeTests: meaningfulTargetNodeTests;
      for (const targetNodeTest of relationshipTargetNodeTests) {
        if (sharesParent) {
          if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
            yield `${anchorXPath}/following-sibling::${targetNodeTest}`;
          }
          if (position & Node.DOCUMENT_POSITION_PRECEDING) {
            yield `${anchorXPath}/preceding-sibling::${targetNodeTest}`;
          }
          continue;
        }
        if (anchorContainsTarget) {
          yield `${anchorXPath}//${targetNodeTest}`;
          continue;
        }
        if (targetContainsAnchor) {
          yield `${anchorXPath}/ancestor::${targetNodeTest}`;
          continue;
        }
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
          yield `${anchorXPath}/following::${targetNodeTest}`;
        }
        if (position & Node.DOCUMENT_POSITION_PRECEDING) {
          yield `${anchorXPath}/preceding::${targetNodeTest}`;
        }
      }
    }
  }
function * createLinearXPathSearch(target, direction, cancellation, uniquenessCache, statistics, candidateIsAllowed = null) {
    const targetNodeTests = getLinearTargetNodeTests(target);
    if (!targetNodeTests.length) {
      return "";
    }
    const elementIterator = direction === "downward" ? iterateLinearDownwardElements(target, cancellation)
    : iterateLinearUpwardElements(target, cancellation);
    const seenXpaths = new Set();
    for (const entry of elementIterator) {
      if (cancellation.cancelled || statistics.generated >= LINEAR_SCAN_MAX_GENERATED) {
        return "";
      }
      statistics.visited += 1;
      yield null;
      for (const xpath of iterateLinearRelationshipCandidates(entry.element, target, targetNodeTests, uniquenessCache)) {
        if (cancellation.cancelled || statistics.generated >= LINEAR_SCAN_MAX_GENERATED) {
          return "";
        }
        if (!xpath || seenXpaths.has(xpath)) {
          continue;
        }
        seenXpaths.add(xpath);
        statistics.generated += 1;
        if (isSafeFinalGraphXPath(xpath, target)
        && (!candidateIsAllowed || candidateIsAllowed(xpath, direction, [entry.element, target]))) {
          return xpath;
        }
        yield null;
      }
    }
    return "";
  }
function createLinearSelectorSearch(target, candidateIsAllowed = null) {
    let boundedSemanticFallback = null;
    const upwardCancellation = {
      cancelled: false,
    };
    const downwardCancellation = {
      cancelled: false,
    };
    const uniquenessCache = new Map();
    const upwardStatistics = {
      visited: 0,
      generated: 0,
    };
    const downwardStatistics = {
      visited: 0,
      generated: 0,
    };
    const upwardIterator = createLinearXPathSearch(target, "upward", upwardCancellation, uniquenessCache, upwardStatistics,
    candidateIsAllowed);
    const downwardIterator = createLinearXPathSearch(target, "downward", downwardCancellation, uniquenessCache, downwardStatistics,
    candidateIsAllowed);
    let scheduledTimer = null;
    let settled = false;
    let result = null;
    const settleListeners = new Set();
    const diagnostics = {
      upwardSteps: 0,
      downwardSteps: 0,
      upwardVisited: 0,
      downwardVisited: 0,
      upwardGenerated: 0,
      downwardGenerated: 0,
      upwardDone: false,
      downwardDone: false,
      dispatchSettleRounds: 0,
      classRecoveryGenerated: 0,
      nonPositionalRecovery: null,
      semanticFallbackPrepared: false,
      semanticFallbackAttempted: false,
      semanticFallbackCandidatesChecked: 0,
      descendantBackReferenceAttempted: false,
      descendantBackReferenceUsed: false,
      descendantBackReferenceVisited: 0,
      descendantBackReferenceGenerated: 0,
      descendantBackReferenceLinearSteps: 0,
      descendantBackReferenceSourceXPath: null,
      descendantBackReferenceSourceStrategy: null,
      indexedFallbackPrepared: false,
      indexedFallbackUsed: false,
      indexedFallbackMatchCount: null,
      indexedFallbackOrdinal: null,
      structuralFallbackUsed: false,
      traversalPolicy: "interleaved-linear-upward-and-downward-then-descendant-back-reference-before-positional-fallbacks",
      losingSearchCancelled: false,
    };
    function getBoundedSemanticFallback() {
      if (!boundedSemanticFallback) {
        boundedSemanticFallback = prepareBoundedSemanticFallback(target, candidateIsAllowed);
      }
      diagnostics.semanticFallbackPrepared = !!boundedSemanticFallback.nonIndexedXPath;
      diagnostics.semanticFallbackCandidatesChecked = boundedSemanticFallback.candidatesChecked;
      diagnostics.indexedFallbackPrepared = !!boundedSemanticFallback.indexedXPath;
      diagnostics.indexedFallbackMatchCount = boundedSemanticFallback.matchCount;
      diagnostics.indexedFallbackOrdinal = boundedSemanticFallback.ordinal;
      return boundedSemanticFallback;
    }
    function setCapturedSemanticFallback(fallback) {
      if (settled || boundedSemanticFallback || !fallback) {
        return;
      }
      if (fallback.nonIndexedXPath || fallback.indexedXPath) {
        boundedSemanticFallback = {
          ...fallback,
        };
      }
    }
    function clearScheduledRound() {
      if (scheduledTimer !== null) {
        clearTimeout(scheduledTimer);
        scheduledTimer = null;
      }
    }
    function finish(strategy, xpath) {
      if (settled) {
        return result;
      }
      const isPreparedIndexedXPath = strategy === "indexed" && !!boundedSemanticFallback && !!xpath
      && xpath === boundedSemanticFallback.indexedXPath && boundedSemanticFallback.ordinal >= 1
      && boundedSemanticFallback.ordinal <= SINGLE_INDEX_FALLBACK_MAX_MATCHES
      && xpath === `(${boundedSemanticFallback.baseXPath})` + `[${boundedSemanticFallback.ordinal}]`
      && isSafeSingleIndexBaseXPath(boundedSemanticFallback.baseXPath);
      const isPreparedStructuralXPath = strategy === "structural" && isSafeFinalStructuralXPath(xpath, target);
      const safeXPath = (isPreparedIndexedXPath || isPreparedStructuralXPath
      || (strategy !== "unresolved" && strategy !== "indexed" && strategy !== "structural"
      && isSafeFinalGraphXPath(xpath, target))) ? xpath: "";
      const winningStrategy = safeXPath ? strategy: "unresolved";
      settled = true;
      clearScheduledRound();
      if (winningStrategy === "primary") {
        cancelSelectorIterator(downwardIterator, downwardCancellation);
        diagnostics.losingSearchCancelled = !diagnostics.downwardDone;
      } else if (winningStrategy === "downward") {
        cancelSelectorIterator(upwardIterator, upwardCancellation);
        diagnostics.losingSearchCancelled = !diagnostics.upwardDone;
      } else {
        if (winningStrategy === "indexed" && (!diagnostics.upwardDone || !diagnostics.downwardDone)) {
          diagnostics.losingSearchCancelled = true;
        }
        cancelSelectorIterator(upwardIterator, upwardCancellation);
        cancelSelectorIterator(downwardIterator, downwardCancellation);
      }
      diagnostics.upwardVisited = upwardStatistics.visited;
      diagnostics.downwardVisited = downwardStatistics.visited;
      diagnostics.upwardGenerated = upwardStatistics.generated;
      diagnostics.downwardGenerated = downwardStatistics.generated;
      result = {
        xpath: safeXPath,
        strategy: winningStrategy,
      };
      for (const listener of settleListeners) {
        try {
          listener(result);
        } catch {
        }
      }
      settleListeners.clear();
      return result;
    }
    function finishWithFinalRecovery() {
      const semanticFallback = getBoundedSemanticFallback();
      if (semanticFallback.nonIndexedXPath) {
        diagnostics.nonPositionalRecovery = "bounded-semantic";
        return finish("primary", semanticFallback.nonIndexedXPath);
      }
      diagnostics.descendantBackReferenceAttempted = true;
      const descendantRecovery = findDescendantBackReferenceXPath(target, candidateIsAllowed);
      diagnostics.descendantBackReferenceVisited = descendantRecovery.visited;
      diagnostics.descendantBackReferenceGenerated = descendantRecovery.generated;
      diagnostics.descendantBackReferenceLinearSteps = descendantRecovery.linearSteps;
      diagnostics.descendantBackReferenceSourceXPath = descendantRecovery.descendantXPath || null;
      diagnostics.descendantBackReferenceSourceStrategy = descendantRecovery.descendantStrategy;
      if (descendantRecovery.xpath) {
        diagnostics.descendantBackReferenceUsed = true;
        diagnostics.nonPositionalRecovery = "descendant-back-reference";
        return finish("descendant-back-reference", descendantRecovery.xpath);
      }
      const recovery = findNonPositionalClassRecoveryXPath(target, candidateIsAllowed);
      diagnostics.classRecoveryGenerated = recovery.generated;
      if (recovery.xpath) {
        diagnostics.nonPositionalRecovery = "class-token";
        return finish("primary", recovery.xpath);
      }
      if (semanticFallback.indexedXPath) {
        diagnostics.indexedFallbackUsed = true;
        return finish("indexed", semanticFallback.indexedXPath);
      }
      const structuralXPath = buildStableAnchoredStructuralXPath(target, candidateIsAllowed);
      if (structuralXPath) {
        diagnostics.structuralFallbackUsed = true;
        return finish("structural", structuralXPath);
      }
      return finish("unresolved", "");
    }
    function scheduleRound() {
      if (settled || scheduledTimer !== null) {
        return;
      }
      scheduledTimer = setTimeout(() => {
        scheduledTimer = null;
        runRound(true);
      }, 0);
    }
    function runRound(shouldScheduleNext = true) {
      if (settled) {
        return result;
      }
      clearScheduledRound();
      if (!diagnostics.upwardDone) {
        const upwardProgress = advanceSelectorSearch(upwardIterator, upwardCancellation, SELECTOR_PRIMARY_SLICE_STEPS, diagnostics,
        "upwardSteps");
        diagnostics.upwardDone = upwardProgress.done;
        if (upwardProgress.xpath) {
          return finish("primary", upwardProgress.xpath);
        }
      }
      if (!diagnostics.downwardDone) {
        const downwardProgress = advanceSelectorSearch(downwardIterator, downwardCancellation, SELECTOR_DOWNWARD_SLICE_STEPS, diagnostics,
        "downwardSteps");
        diagnostics.downwardDone = downwardProgress.done;
        if (downwardProgress.xpath) {
          return finish("downward", downwardProgress.xpath);
        }
      }
      diagnostics.upwardVisited = upwardStatistics.visited;
      diagnostics.downwardVisited = downwardStatistics.visited;
      diagnostics.upwardGenerated = upwardStatistics.generated;
      diagnostics.downwardGenerated = downwardStatistics.generated;
      if (diagnostics.upwardDone && diagnostics.downwardDone) {
        diagnostics.semanticFallbackAttempted = true;
        return finishWithFinalRecovery();
      }
      if (shouldScheduleNext) {
        scheduleRound();
      }
      return null;
    }
    function start() {
      return runRound(true);
    }
    function settleForDispatch() {
      clearScheduledRound();
      const settleStartedAt = getSelectorSearchNow();
      while (!settled && diagnostics.dispatchSettleRounds < SELECTOR_DISPATCH_SETTLE_MAX_ROUNDS
      && getSelectorSearchNow() - settleStartedAt < SELECTOR_DISPATCH_SETTLE_MAX_MS
      && !selectorSearchBudgetExhausted()) {
        diagnostics.dispatchSettleRounds += 1;
        runRound(false);
      }
      if (!settled) {
        finishWithFinalRecovery();
      }
      return result;
    }
    function drainToCompletion() {
      clearScheduledRound();
      while (!settled) {
        runRound(false);
      }
      return result;
    }
    function cancel() {
      if (!settled) {
        finish("unresolved", "");
      }
    }
    function whenSettled() {
      if (settled) {
        return Promise.resolve(result);
      }
      return new Promise(resolve => {
        settleListeners.add(resolve);
        scheduleRound();
      });
    }
    function getDiagnostics() {
      return {
        ...diagnostics,
        strategy: result?.strategy || null,
      };
    }
    return {
      start,
      runRound,
      settleForDispatch,
      drainToCompletion,
      whenSettled,
      setCapturedSemanticFallback,
      cancel,
      getDiagnostics,
      get result() {
        return result;
      },
    };
  }
function inspectXPathProofAgainstTarget(xpath, target, strategy, successReason, domSnapshotVersion = null) {
    const normalizedXPath = String(xpath || "").trim();
    if (!normalizedXPath || !(target instanceof Element)) {
      return {
        valid: false,
        reason: !normalizedXPath ? "missing-xpath": "missing-proof-target",
        matchCount: 0,
        matchedTarget: false,
        proofSource: successReason,
        domSnapshotVersion,
      };
    }
    const policyValid = strategy === "indexed" ? isSafeFinalSingleIndexedXPath(normalizedXPath, target): strategy === "structural"
    ? isSafeFinalStructuralXPath(normalizedXPath, target): strategy === "absolute"
    ? isSafeFinalAbsoluteXPath(normalizedXPath, target): isSafeFinalGraphXPath(normalizedXPath, target);
    if (!policyValid) {
      return {
        valid: false,
        reason: "xpath-failed-final-selector-policy",
        matchCount: null,
        matchedTarget: false,
        xpathEvaluated: false,
        proofSource: successReason,
        domSnapshotVersion,
      };
    }
    try {
      const ownerDocument = target.ownerDocument || document;
      const result = ownerDocument.evaluate(normalizedXPath, ownerDocument, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const matchCount = result.snapshotLength;
      const matchedTarget = matchCount === 1 && result.snapshotItem(0) === target;
      return {
        valid: matchedTarget,
        reason: matchedTarget ? successReason: matchCount === 0 ? "xpath-matched-zero-elements": matchCount === 1
        ? "xpath-matched-the-wrong-element": "xpath-matched-multiple-elements",
        matchCount,
        matchedTarget,
        xpath: normalizedXPath,
        strategy,
        proofSource: successReason,
        domSnapshotVersion,
        provenAt: Date.now(),
        xpathEvaluated: true,
        validatedAgainst: "complete-owner-document",
        hiddenElementsFiltered: false,
        targetConnected: target.isConnected,
      };
    } catch (error) {
      return {
        valid: false,
        reason: "xpath-evaluation-threw",
        matchCount: null,
        matchedTarget: false,
        xpathEvaluated: true,
        proofSource: successReason,
        domSnapshotVersion,
        error: String(error?.message || error || "Unknown XPath evaluation error"),
      };
    }
  }
function normalizeXPath(
    value
) {
    if (
        typeof value !==
        "string"
    ) {
        return "";
    }

    const trimmed =
        value.trim();

    if (!trimmed) {
        return "";
    }

    return trimmed.replace(
        /^xpath=/i,
        ""
    );
}
function containsDisallowedClickXPathPosition(
    xpath
) {
    const text =
        stripXPathStringLiterals(
            xpath
        );

    /*
     * Match the listeners.js contract exactly: the complete XPath may contain
     * at most one naked numeric positional predicate, and it may only be
     * [1], [2] or [3]. position(...) and last(...) remain forbidden.
     */
    if (
        /\[\s*position\s*\(/i.test(
            text
        ) ||
        /\[\s*last\s*\(/i.test(
            text
        )
    ) {
        return true;
    }

    const numericPredicates =
        Array.from(
            text.matchAll(
                /\[\s*(\d+)\s*\]/g
            )
        );

    if (
        numericPredicates.length >
        1
    ) {
        return true;
    }

    if (
        numericPredicates.length ===
        1
    ) {
        const index =
            Number(
                numericPredicates[
                    0
                ][
                    1
                ]
            );

        return (
            index < 1 ||
            index > 3
        );
    }

    return false;
}
function isAllowedStructuralClickXPath(
    xpath
) {
    const text =
        stripXPathStringLiterals(
            xpath
        ).trim();

    if (
        !text.startsWith("//") ||
        /^\/\/?(?:html|body)(?:\[|\/|$)/i.test(text) ||
        /\/html(?:\[|\/|$)/i.test(text) ||
        /\/body(?:\[|\/|$)/i.test(text) ||
        /\.\.|\|/.test(text)
    ) {
        return false;
    }

    if (!/@/.test(text)) {
        return false;
    }

    return Array.from(
        text.matchAll(
            /\[\s*(\d+)\s*\]/g
        )
    ).every(match => {
        return Number(match[1]) >= 1;
    });
}

  function resolve(target) {
    // One search clock per resolve, exactly as the recorder starts one per press
    // (createClickSnapshot). It starts at 0, so without this every bounded
    // stage would report its budget as already spent and give up at once.
    beginSelectorSearchBudget();
    if (!(target instanceof Element) || !target.isConnected || isRecorderOverlayElement(target)) {
      throw new Error('Selected target is disconnected or belongs to recorder UI');
    }
    if (target.getRootNode() !== target.ownerDocument) {
      throw new Error('The recorder XPath engine cannot prove a document XPath through a shadow root');
    }
    function prove(result, diagnostics = {}) {
      const xpath = normalizeXPath(result?.xpath);
      if (!xpath) return null;
      const structural = result.strategy === 'structural';
      if (structural ? !isAllowedStructuralClickXPath(xpath) : containsDisallowedClickXPathPosition(xpath)) return null;
      const proof = inspectXPathProofAgainstTarget(xpath, target, result.strategy,
        'unique-selected-grid-target-proof');
      return proof.valid ? {
        xpath, strategy: result.strategy, proof, diagnostics,
        engineVersion: RECORDER_LISTENER_VERSION,
      } : null;
    }
    // Same search functions and bounds as the supplied recorder. The chosen
    // element is already known, so no pointer-event target promotion is used.
    const fast = getFastClickXPath(target);
    const fastResult = prove(fast, fast.diagnostics);
    if (fastResult) return fastResult;
    const local = prove({ xpath: findLocalControlRelationshipXPath(target), strategy: 'contextual' });
    if (local) return local;
    const search = createLinearSelectorSearch(target);
    try {
      const result = search.drainToCompletion();
      const proven = prove(result, search.getDiagnostics());
      if (proven) return proven;
      throw new Error('Recorder XPath search could not prove a unique stable XPath for the selected grid target');
    } finally { search.cancel(); }
  }
  // Test-data values of the project being healed (inline_healer.js passes them
  // in the scan options) count as typed data, exactly as values the user typed
  // do in the recorder: data, never a "generated id" (isUserTypedValue).
  const healingTypedValues = globalThis.__PW_HEAL_SCAN_OPTIONS__?.typedValues;
  if (Array.isArray(healingTypedValues)) {
    for (const value of healingTypedValues) {
      rememberUserTypedValue(value);
    }
  }
  return {
    resolve,
    rejectsAttribute: isGraphAttributeRejected,
    version: RECORDER_LISTENER_VERSION,
  };

}
// END RECORDER XPATH ENGINE

(function scanVisualHealingCandidates() {
  const options = window.__PW_HEAL_SCAN_OPTIONS__ || {};
  const xpathEngine = createHealingRecorderXPathEngine();
  window.__PW_HEAL_XPATH_ENGINE__ = xpathEngine;
  const captureId = typeof options.captureId === 'string' ? options.captureId : '';
  const requestedAction = String(options.action || "click").toLowerCase();
  const maxCandidates = Math.max(0, Number(options.maxCandidates) || 0);
  const fullPage = options.fullPage === true;
  // Elements that are rendered but outside the picture - cut off inside a
  // panel the user can scroll, or outside the captured view - are listed
  // separately ("hidden"), never numbered in the image.
  const collectHidden = options.collectHidden === true;
  // How many to describe in full: every reachable one is scored first, then
  // the best are kept - so a match far down a long list is never cut off.
  const maxHidden = Math.max(0, Number(options.maxHidden) || 0) || 400;
  // Words of the failed step (from the healer), used only for that ranking.
  const hiddenHints = new Set(Array.isArray(options.hiddenHints) ? options.hiddenHints.filter(word => typeof word === 'string') : []);
  // The words of an exact name the locator asks for (exact: true), from the
  // healer: the scan counts the elements of the requested kind whose own
  // name uses only those words ("Save" for "Save now"), so the healer can
  // accept a shortened name only when exactly one such element exists.
  const exactNameWords = new Set(Array.isArray(options.exactNameWords) ? options.exactNameWords.filter(word => typeof word === 'string' && word) : []);
  const targetIntent = options.targetIntent || { kind: 'any' };
  const broadDom = targetIntent.kind === 'all-dom';
  const hasExplicitTargetType = ['tag', 'role', 'text', 'attributes', 'labelled', 'all-dom'].includes(targetIntent.kind);
  const customRules = Array.isArray(options.mappingRules) ? options.mappingRules : [];
  const roleSnapshot = window.__PW_HEAL_ROLE_TARGETS__;
  delete window.__PW_HEAL_ROLE_TARGETS__;
  const roleTargets = roleSnapshot?.captureId === captureId ? roleSnapshot.elements : null;
  function toolingNode(element) {
    for (let current = element; current; current = current.parentElement || current.getRootNode()?.host || null) {
      if (current.localName === 'x-pw-glass' || current.hasAttribute('data-pw-recorder-validation-ui') ||
          current.hasAttribute('data-pw-visual-heal-ui')) return true;
    }
    return false;
  }
  if (targetIntent.kind === 'role' && !(roleTargets instanceof Set)) {
    throw new Error('Exact Playwright role candidates were not prepared for this capture');
  }

  const INTERACTIVE_TAGS = new Set([
    "BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "SUMMARY", "OPTION", "IMG",
  ]);
  const REGION_TAGS = new Set(["FORM", "FIELDSET", "SECTION", "DIALOG"]);
  const INPUT_ROLES = new Set([
    "textbox", "searchbox", "combobox", "spinbutton", "slider",
  ]);
  const CLICK_ROLES = new Set([
    "button", "link", "tab", "menuitem", "menuitemcheckbox",
    "menuitemradio", "option", "checkbox", "radio", "switch",
    "treeitem", "gridcell", "row", "slider",
  ]);
  const KEEP_ATTR_NAMES = [
    "id", "name", "type", "role", "placeholder", "aria-label",
    "aria-labelledby", "aria-describedby", "title", "alt", "for",
    "data-testid", "data-test", "data-qa", "data-cy", "data-label",
    "href", "value", "autocomplete",
  ];
  const DYNAMIC_ID_PATTERN = /(?:^|[-_])(?:pv_id|react-select|headlessui|radix|generated|ember|mui)-?\d+/i;
  const DYNAMIC_VALUE_PATTERN = /(?:^|[-_])[a-f0-9]{10,}(?:$|[-_])/i;

  function compact(value, limit = 120) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > limit ? `${text.slice(0, limit)}...` : text;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(String(value));
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, ch => `\\${ch}`);
  }


  function stableAttribute(name, value) {
    if (xpathEngine.rejectsAttribute(name, String(value || ''))) return false;
    const text = compact(value, 240);
    if (!text || text === "[object Object]") return false;
    if (name === "id" && (DYNAMIC_ID_PATTERN.test(text) || DYNAMIC_VALUE_PATTERN.test(text))) {
      return false;
    }
    return !/^(?:true|false|null|undefined)$/i.test(text);
  }

  function getAttrs(element) {
    const attrs = {};
    const requestedNames = targetIntent.kind === 'attributes' && Array.isArray(targetIntent.names)
      ? targetIntent.names.filter(name => typeof name === 'string') : [];
    for (const name of new Set([...KEEP_ATTR_NAMES, ...requestedNames])) {
      const value = element.getAttribute && element.getAttribute(name);
      if (value != null && value !== "" && stableAttribute(name, value)) {
        attrs[name] = compact(value, 240);
      }
    }
    return attrs;
  }

  function implicitRole(element) {
    const explicit = compact(element.getAttribute && element.getAttribute("role")).toLowerCase();
    if (explicit) return explicit.split(/\s+/)[0];
    const tag = element.tagName;
    if (tag === "BUTTON") return "button";
    if (tag === "A" && element.hasAttribute("href")) return "link";
    if (tag === "SELECT") return element.multiple || Number(element.getAttribute('size')) > 1 ? 'listbox' : 'combobox';
    if (tag === "TEXTAREA") return "textbox";
    if (tag === "SUMMARY") return "button";
    if (tag === "OPTION") return "option";
    const tagRoles = {
      IMG: 'img', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading',
      UL: 'list', OL: 'list', LI: 'listitem', TABLE: 'table', TR: 'row', TD: 'cell',
      TH: element.getAttribute('scope') === 'row' ? 'rowheader' : 'columnheader',
      NAV: 'navigation', MAIN: 'main', ASIDE: 'complementary', DIALOG: 'dialog', FIELDSET: 'group',
      PROGRESS: 'progressbar', METER: 'meter', P: 'paragraph', ARTICLE: 'article',
    };
    if (tagRoles[tag]) return tagRoles[tag];
    if (tag === "INPUT") {
      const type = compact(element.getAttribute("type") || "text").toLowerCase();
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (element.hasAttribute('list')) return 'combobox';
      if (type === "search") return "searchbox";
      return "textbox";
    }
    return "";
  }

  function associatedLabel(element) {
    try {
      if (element.labels && element.labels.length) {
        return compact(Array.from(element.labels).map(label => label.textContent || "").join(" "));
      }
      const id = element.getAttribute && element.getAttribute("id");
      if (id) {
        const label = document.querySelector(`label[for="${cssEscape(id)}"]`);
        if (label) return compact(label.textContent || "");
      }
      const wrappingLabel = element.closest && element.closest("label");
      if (wrappingLabel) return compact(wrappingLabel.textContent || "");
    } catch (_) {}
    return "";
  }

  function labelledByText(element) {
    const ids = compact(element.getAttribute && element.getAttribute("aria-labelledby"), 240);
    if (!ids) return "";
    return compact(ids.split(/\s+/).map(id => document.getElementById(id)?.textContent || "").join(" "));
  }

  function accessibleName(element) {
    return compact(
      element.getAttribute?.("aria-label") ||
      labelledByText(element) ||
      associatedLabel(element) ||
      element.getAttribute?.("alt") ||
      element.getAttribute?.("placeholder") ||
      element.getAttribute?.("title") ||
      element.textContent ||
      element.getAttribute?.("name") ||
      element.getAttribute?.("id") ||
      ""
    );
  }

  function ownText(element) {
    return Array.from(element.childNodes || [])
      .filter(node => node.nodeType === 3 && /\S/.test(node.textContent || ''));
  }

  function targetMatches(element, role) {
    if (targetIntent.kind === 'tag') return element.tagName.toLowerCase() === targetIntent.value;
    if (targetIntent.kind === 'role') return roleTargets.has(element);
    if (targetIntent.kind === 'text') return ownText(element).length > 0;
    if (targetIntent.kind === 'attributes') {
      const names = Array.isArray(targetIntent.names) ? targetIntent.names : [];
      if (!names.length) return false;
      // Values may have changed. Match the recorded attribute names on live
      // nodes, rather than replaying stale IDs, names, labels or classes.
      const matches = name => typeof name === 'string' && element.hasAttribute(name);
      return targetIntent.match === 'any' ? names.some(matches) : names.every(matches);
    }
    if (targetIntent.kind === 'labelled') {
      // Native label association handles both <label for> and wrapping labels.
      // Labels themselves are not substituted for the associated control.
      return Boolean(element.labels?.length || element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby'));
    }
    return true;
  }

  function textRect(element) {
    const boxes = [];
    for (const node of ownText(element)) {
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const box of Array.from(range.getClientRects())) {
        if (box.width > 0 && box.height > 0) boxes.push(box);
      }
      range.detach();
    }
    if (!boxes.length) return null;
    const left = Math.min(...boxes.map(box => box.left));
    const top = Math.min(...boxes.map(box => box.top));
    const right = Math.max(...boxes.map(box => box.right));
    const bottom = Math.max(...boxes.map(box => box.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  // Respect CSS clipping used by screen-reader-only labels as well as normal
  // display/visibility/opacity. Full-page does not mean reveal hidden controls.
  function explicitClip(element, style) {
    const box = element.getBoundingClientRect();
    const legacy = style.clip && style.clip.match(/^rect\((.*)\)$/i);
    const inset = style.clipPath && style.clipPath.match(/^inset\(([^)]*)\)$/i);
    if (!legacy && !inset) return null;
    const px = (value, size, fallback = 0) => value === 'auto' ? fallback :
      value?.endsWith('%') ? parseFloat(value) * size / 100 : parseFloat(value);
    let top, right, bottom, left;
    if (legacy && ['absolute', 'fixed'].includes(style.position)) {
      const values = legacy[1].split(/[,\s]+/).filter(Boolean);
      if (values.length !== 4) return null;
      [top, right, bottom, left] = values.map((value, index) => px(value, index % 2 ? box.width : box.height,
        index === 1 ? box.width : index === 2 ? box.height : 0));
    } else if (inset) {
      const values = inset[1].split(/\s+round\s+/i)[0].trim().split(/\s+/);
      top = px(values[0], box.height); right = box.width - px(values[1] || values[0], box.width);
      bottom = box.height - px(values[2] || values[0], box.height);
      left = px(values[3] || values[1] || values[0], box.width);
    } else return null;
    if (![top, right, bottom, left].every(Number.isFinite)) return null;
    return { top: box.top + top, right: box.left + right, bottom: box.top + bottom, left: box.left + left };
  }

  function clipRenderedRect(element, rect, includeSelfClip = false, viewportOnly = false) {
    try {
      if (!element.isConnected || toolingNode(element) || window.__PW_HEAL_CAPTURE_VISIBILITY__?.isExcluded(element)) return null;
      if (!rect) return null;
      if (rect.width < 1 || rect.height < 1) return null;
      let left = rect.left, right = rect.right, top = rect.top, bottom = rect.bottom;
      let current = element;
      while (current && current.nodeType === 1) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || Number(style.opacity) === 0 || style.contentVisibility === 'hidden' ||
            (current === element && ['hidden', 'collapse'].includes(style.visibility))) return null;
        const explicit = explicitClip(current, style);
        if (explicit) {
          left = Math.max(left, explicit.left); right = Math.min(right, explicit.right);
          top = Math.max(top, explicit.top); bottom = Math.min(bottom, explicit.bottom);
          if (right - left <= 1 || bottom - top <= 1) return null;
        }
        // Full-page capture reveals the outer document, not content hidden
        // inside an independently scrolling/clipped panel.
        if (style.display !== 'contents' && (includeSelfClip || current !== element) && current !== document.body && current !== document.documentElement) {
          const clip = current.getBoundingClientRect();
          if (/^(?:hidden|clip|auto|scroll)$/.test(style.overflowX)) {
            left = Math.max(left, clip.left); right = Math.min(right, clip.right);
          }
          if (/^(?:hidden|clip|auto|scroll)$/.test(style.overflowY)) {
            top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom);
          }
        }
        current = current.parentElement || current.getRootNode?.().host || null;
      }
      // A close-up checks what is on screen now, whatever the first picture was.
      const wholePage = fullPage && !viewportOnly;
      const width = wholePage ? Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0, innerWidth) : innerWidth;
      const height = wholePage ? Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0, innerHeight) : innerHeight;
      const scrollLeft = wholePage ? scrollX : 0;
      const scrollTop = wholePage ? scrollY : 0;
      left = Math.max(left, -scrollLeft); top = Math.max(top, -scrollTop);
      right = Math.min(right, width - scrollLeft); bottom = Math.min(bottom, height - scrollTop);
      if (right - left < 1 || bottom - top < 1) return null;
      return {
        x: left, y: top, width: right - left, height: bottom - top,
        top, right, bottom, left,
      };
    } catch (_) {
      return null;
    }
  }

  function visibleRect(element) {
    let rect = targetIntent.kind === 'text' ? textRect(element) : element.getBoundingClientRect();
    if (broadDom && (!rect || rect.width < 1 || rect.height < 1)) rect = textRect(element);
    return clipRenderedRect(element, rect);
  }

  // Keep each rendered text fragment, including text directly owned by a
  // container and text inside a button. Range boxes avoid outlining a whole
  // wrapping div when only a short label is being highlighted.
  function visibleTextRects(element) {
    const css = getComputedStyle(element);
    const transparent = value => value === 'transparent' || /rgba\([^)]*[,/]\s*0(?:\.0+)?\s*\)$/.test(value || '');
    const fill = css.webkitTextFillColor || css.color;
    // Do not number invisible text used to supply an accessible name.
    if (transparent(fill) && (!css.textShadow || css.textShadow === 'none') &&
        !(parseFloat(css.webkitTextStrokeWidth) > 0 && !transparent(css.webkitTextStrokeColor))) return [];
    const boxes = [];
    let hadRangeBox = false;
    for (const node of ownText(element)) {
      const range = document.createRange();
      try {
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          hadRangeBox ||= rect.width > 0 && rect.height > 0;
          const clipped = clipRenderedRect(element, rect, true);
          if (clipped) boxes.push(clipped);
        }
      } finally { range.detach(); }
    }
    // Some SVG text implementations expose only an element rectangle.
    // Do not use this fallback when text was actually clipped out of view.
    if (!hadRangeBox && ownText(element).length && element.namespaceURI === 'http://www.w3.org/2000/svg') {
      const fallback = clipRenderedRect(element, element.getBoundingClientRect(), true);
      if (fallback) boxes.push(fallback);
    }
    return boxes;
  }

  function isDisabled(element) {
    return Boolean(
      element.disabled ||
      element.getAttribute?.("aria-disabled") === "true" ||
      element.hasAttribute?.("inert")
    );
  }

  function isEditable(element, role) {
    if (element.isContentEditable) return true;
    if (element.tagName === "TEXTAREA") return !element.readOnly && !isDisabled(element);
    if (element.tagName === "SELECT") return !isDisabled(element);
    if (element.tagName === "INPUT") {
      const type = compact(element.getAttribute("type") || "text").toLowerCase();
      return !["button", "submit", "reset", "image", "checkbox", "radio", "file", "hidden"].includes(type)
        && !element.readOnly && !isDisabled(element);
    }
    return INPUT_ROLES.has(role) && element.getAttribute?.("aria-readonly") !== "true" && !isDisabled(element);
  }

  function isClickable(element, role) {
    if (INTERACTIVE_TAGS.has(element.tagName)) return true;
    if (CLICK_ROLES.has(role)) return true;
    if (element.hasAttribute?.("onclick") || element.hasAttribute?.("tabindex")) return true;
    try {
      return getComputedStyle(element).cursor === "pointer";
    } catch (_) {
      return false;
    }
  }

  function candidateKind(element, role, customKind = "") {
    if (customKind) return customKind;
    if (element.tagName === "FORM" || REGION_TAGS.has(element.tagName)) return "region";
    if (isEditable(element, role)) return "input";
    if (["checkbox", "radio", "switch"].includes(role)) return "toggle";
    if (role === "combobox" || element.tagName === "SELECT") return "select";
    if (isClickable(element, role)) return "clickable";
    return "semantic";
  }

  function supportsAction(element, role, kind) {
    if (["fill", "type", "editable"].includes(requestedAction)) return isEditable(element, role);
    if (requestedAction === "selectoption") return role === "combobox" || element.tagName === "SELECT";
    if (["check", "uncheck"].includes(requestedAction)) return ["checkbox", "radio", "switch"].includes(role);
    if (requestedAction === "press") return isEditable(element, role) || isClickable(element, role);
    if (["visible", "enabled"].includes(requestedAction)) return kind !== "semantic" || Boolean(accessibleName(element));
    return isClickable(element, role) || kind === "region" || Boolean(accessibleName(element));
  }


  // Walk the whole rendered DOM. An explicitly configured final limit is
  // reported as truncation; the default does not drop lower-page targets.
  const elementRecords = new Map();
  const fingerprints = new Map();
  function fingerprint(element) {
    const attributes = ['id', 'name', 'type', 'role', 'aria-label', 'placeholder',
      'title', 'alt', 'for', 'href', 'data-testid', 'data-test', 'data-qa', 'data-cy']
      .map(name => [name, element.getAttribute(name)]);
    const text = String(element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
    // No input values, mutable classes, capture styles or coordinates.
    return JSON.stringify([element.namespaceURI, element.localName, attributes, text]);
  }
  const seen = new Set();
  const collected = [];
  const recordsByElement = new Map();
  let localSequence = 0;
  const regionIds = new Map();
  function presentationContext(element) {
    const region = element.closest?.('dialog,[role="dialog"],table,form,fieldset,nav,section,header,footer,main') || document.body;
    if (!regionIds.has(region)) regionIds.set(region, regionIds.size + 1);
    const row = element.closest?.('tr');
    const cell = element.closest?.('td,th');
    const table = cell?.closest('table');
    const ownLabel = compact(ownText(element).map(node => node.textContent).join(' '), 160);
    // Once per region and per table: both lookups search the whole container.
    if (!regionLabels.has(region)) {
      regionLabels.set(region, compact(region.getAttribute?.('aria-label') || region.querySelector?.(':scope > legend,:scope > caption,:scope > h1,:scope > h2,:scope > h3')?.textContent || region.localName, 120));
    }
    const regionLabel = regionLabels.get(region);
    const rowLabel = row ? compact(Array.from(row.cells || []).map(item => compact(item.textContent, 70)).filter(Boolean).slice(0, 3).join(' | '), 160) : '';
    if (table && !columnHeaders.has(table)) columnHeaders.set(table, Array.from(table.querySelectorAll('thead tr:first-child > th,thead tr:first-child > td')));
    const columnLabel = cell && table ? compact(columnHeaders.get(table)[cell.cellIndex]?.textContent, 100) : '';
    return { region_id: regionIds.get(region), region_label: regionLabel, row_label: rowLabel, column_label: columnLabel, own_text: ownLabel };
  }
  const regionLabels = new Map();
  const columnHeaders = new Map();


  // isShown: in the picture (visibleRect), or - for an element listed outside
  // the picture - painted at all (paintedThroughAncestors).
  function controlContext(element, role, isShown = visibleRect) {
    if (!isClickable(element, role) && !isEditable(element, role)) return null;
    const associations = [];
    for (const label of Array.from(element.labels || [])) {
      if (isShown(label)) associations.push({ via: 'native-label', text: compact(label.textContent, 100) });
    }
    for (const id of String(element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)) {
      const label = element.ownerDocument.getElementById(id);
      if (label && isShown(label)) associations.push({ via: 'aria-labelledby', text: compact(label.textContent, 100) });
    }
    // Nearby text is context, not an automatic DOM/control equivalence claim.
    // Limit it to a small shared container with exactly one control.
    const box = element.getBoundingClientRect();
    for (let parent = element.parentElement, depth = 0; parent && depth < 2; parent = parent.parentElement, depth += 1) {
      const bounds = parent.getBoundingClientRect();
      if (bounds.width > Math.max(320, box.width * 3) || bounds.height > Math.max(100, box.height * 3)) break;
      const controls = Array.from(parent.querySelectorAll('button,input,select,textarea,a[href],[role="button"],[role="switch"],[role="checkbox"]'))
        .filter(item => isShown(item));
      if (controls.length !== 1 || controls[0] !== element) continue;
      const text = compact(parent.textContent, 120);
      if (text && text !== compact(element.textContent, 120)) {
        associations.push({ via: 'single-control-small-container', text, association_requires_visual_confirmation: true });
        break;
      }
    }
    return associations.length ? associations : null;
  }

  // ---- Rendered, but outside the picture --------------------------------
  // An element cut off inside a panel the user can scroll, or outside the
  // captured view, has no box in the image. It is listed by text instead,
  // saying where it is, so the model can ask to see it: the healer then
  // scrolls it into view for a close-up. Only scrolling counts - nothing is
  // opened, and nothing hidden by CSS, behind a modal or inert is listed.
  function hostParent(node) {
    return node.parentElement || node.getRootNode?.()?.host || null;
  }
  // Ancestry across shadow roots (Node.contains stops at a shadow boundary).
  function within(ancestor, node) {
    for (let current = node; current; current = hostParent(current)) if (current === ancestor) return true;
    return false;
  }
  function paintedThroughAncestors(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    for (let current = element; current && current.nodeType === 1; current = hostParent(current)) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || Number(style.opacity) === 0 || style.contentVisibility === 'hidden' ||
          (current === element && ['hidden', 'collapse'].includes(style.visibility))) return false;
    }
    return true;
  }
  // While a modal dialog is open nothing outside it can be reached: the
  // browser makes the rest inert for a <dialog> opened with showModal(), and
  // aria-modal="true" declares the same for a painted dialog.
  let openModals = null;
  function modalsOpen() {
    if (openModals) return openModals;
    openModals = [];
    const visitRoot = root => {
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot) visitRoot(element.shadowRoot);
        if (toolingNode(element)) continue;
        let modal = false;
        if (element.localName === 'dialog') { try { modal = element.matches(':modal'); } catch (_) {} }
        if (!modal && ['dialog', 'alertdialog'].includes(compact(element.getAttribute('role')).toLowerCase()) &&
            element.getAttribute('aria-modal') === 'true') modal = paintedThroughAncestors(element);
        if (modal) openModals.push(element);
      }
    };
    try { visitRoot(document); } catch (_) {}
    return openModals;
  }
  // The scrolling that would bring an element outside the picture into view
  // (innermost panel first, then the page), or null when scrolling cannot:
  // hidden by CSS, cut off by a box the user cannot scroll (overflow
  // hidden/clip, or a box too small to show anything), pinned outside the
  // window, beyond what can be scrolled to, behind an open modal, or inert.
  function scrollReach(element, rect) {
    try {
      if (!rect || rect.width < 1 || rect.height < 1 || !element.isConnected) return null;
      if (window.__PW_HEAL_CAPTURE_VISIBILITY__?.isExcluded(element)) return null;
      for (let node = element; node; node = hostParent(node)) if (node.nodeType === 1 && node.hasAttribute('inert')) return null;
      const modals = modalsOpen();
      if (modals.length && !modals.some(modal => within(modal, element))) return null;
      const box = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      const AXES = [['x', 'left', 'right'], ['y', 'top', 'bottom']];
      const steps = [];
      let pinned = false;
      for (let current = element; current && current.nodeType === 1; current = hostParent(current)) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || Number(style.opacity) === 0 || style.contentVisibility === 'hidden' ||
            (current === element && ['hidden', 'collapse'].includes(style.visibility))) return null;
        const explicit = explicitClip(current, style);
        if (explicit) {
          box.left = Math.max(box.left, explicit.left); box.right = Math.min(box.right, explicit.right);
          box.top = Math.max(box.top, explicit.top); box.bottom = Math.min(box.bottom, explicit.bottom);
          if (box.right - box.left <= 1 || box.bottom - box.top <= 1) return null;
        }
        if (style.position === 'fixed') pinned = true;
        if (current === element || style.display === 'contents' || current === document.body || current === document.documentElement) continue;
        const clip = current.getBoundingClientRect();
        for (const [axis, lo, hi] of AXES) {
          const overflow = axis === 'x' ? style.overflowX : style.overflowY;
          if (!/^(?:hidden|clip|auto|scroll)$/.test(overflow)) continue;
          if (box[hi] - 0.5 > clip[lo] && box[lo] + 0.5 < clip[hi]) {
            box[lo] = Math.max(box[lo], clip[lo]); box[hi] = Math.min(box[hi], clip[hi]);
            continue;
          }
          // Wholly outside this box on this axis: only scrolling the box
          // brings it in, and only a box the user can scroll counts.
          const size = axis === 'x' ? current.clientWidth : current.clientHeight;
          if (!/^(?:auto|scroll)$/.test(overflow) || size < 16) return null;
          if (!(axis === 'x' && style.direction === 'rtl')) {
            const start = clip[lo] + (axis === 'x' ? current.clientLeft - current.scrollLeft : current.clientTop - current.scrollTop);
            const end = start + (axis === 'x' ? current.scrollWidth : current.scrollHeight);
            if (box[hi] <= start + 0.5 || box[lo] >= end - 0.5) return null;
          }
          const after = box[lo] >= clip[hi];
          steps.push({ scope: 'panel', panel: current, axis, after,
            distance: Math.max(0, Math.round(after ? box[lo] - clip[hi] : clip[lo] - box[hi])) });
          // Scrolled into this box, the element shows inside the box's own area.
          const length = Math.min(box[hi] - box[lo], clip[hi] - clip[lo]);
          box[lo] = clip[lo]; box[hi] = clip[lo] + length;
        }
      }
      const documentWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0, innerWidth);
      const documentHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0, innerHeight);
      for (const [axis, lo, hi] of AXES) {
        const start = -(axis === 'x' ? scrollX : scrollY);
        const end = start + (axis === 'x' ? documentWidth : documentHeight);
        const view = fullPage ? [start, end] : [0, axis === 'x' ? innerWidth : innerHeight];
        if (box[hi] - 0.5 > view[0] && box[lo] + 0.5 < view[1]) continue;
        // Outside the captured area, so the page itself would have to scroll.
        // Content pinned to the window does not move with it, and nothing
        // scrolls beyond the document.
        if (fullPage || pinned) return null;
        if (box[hi] <= start + 0.5 || box[lo] >= end - 0.5) return null;
        const after = box[lo] >= view[1];
        steps.push({ scope: 'page', axis, after,
          distance: Math.max(0, Math.round(after ? box[lo] - view[1] : view[0] - box[hi])) });
      }
      return steps.length ? steps : null;
    } catch (_) {
      return null;
    }
  }
  const insideFrame = (() => { try { return window.top !== window; } catch (_) { return true; } })();
  // Once per panel: a large panel holds thousands of listed elements.
  const panelNames = new Map();
  function panelName(panel) {
    if (panelNames.has(panel)) return panelNames.get(panel);
    const label = compact(panel.getAttribute('aria-label') || labelledByText(panel), 50);
    let heading = '';
    if (!label) {
      try { heading = compact(panel.querySelector('h1,h2,h3,h4,h5,h6,legend,caption,[role="heading"]')?.textContent, 50); } catch (_) {}
    }
    const id = panel.id && stableAttribute('id', panel.id) ? ` id="${compact(panel.id, 40)}"` : '';
    const name = label || heading;
    const described = `${name ? `"${name}" ` : ''}<${panel.localName}${id}>`;
    panelNames.set(panel, described);
    return described;
  }
  function describeReach(steps) {
    const parts = [];
    for (const step of steps) {
      const direction = step.axis === 'y' ? (step.after ? 'below' : 'above') : (step.after ? 'to the right of' : 'to the left of');
      const previous = parts[parts.length - 1];
      // Both axes of the same panel (or of the page) read as one place.
      if (previous && previous.scope === step.scope && previous.panel === step.panel) {
        previous.directions.push(direction);
        previous.distance = Math.max(previous.distance, step.distance);
      } else parts.push({ scope: step.scope, panel: step.panel, directions: [direction], distance: step.distance });
    }
    return parts.map((part, index) => {
      const direction = part.directions.join(' and ');
      const amount = part.distance > 0 ? ` (about ${part.distance.toLocaleString('en-US')}px)` : '';
      if (part.scope === 'panel') {
        return `${index ? 'that panel sits inside scroll panel' : 'inside scroll panel'} ${panelName(part.panel)}, ${direction} its visible part${amount}`;
      }
      return `${index ? 'and that is ' : ''}${direction} the visible part of ${insideFrame ? 'its embedded frame' : 'the page'}${amount}`;
    }).join('; ');
  }
  // The text of the small box around an element (its row, its field group):
  // a list that re-uses one element for another row must not pass as the
  // element that was listed.
  // Structural, not geometric: the same box is found whatever the layout.
  // Its text pieces are joined with spaces ("Order #15 Approve").
  function spacedText(node, limit = 400) {
    const pieces = [];
    let length = 0;
    try {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text && length <= limit; text = walker.nextNode()) {
        const value = String(text.nodeValue || '').replace(/\s+/g, ' ').trim();
        if (!value) continue;
        pieces.push(value);
        length += value.length + 1;
      }
    } catch (_) {}
    return pieces.join(' ');
  }
  const CONTROL_SELECTOR = 'button,input,select,textarea,a[href],[role="button"],[role="link"],[role="checkbox"],[role="switch"],[role="option"],[role="menuitem"]';
  // Counting stops at `limit`: a table body may hold thousands of controls.
  function holdsMoreControlsThan(node, limit) {
    let count = 0;
    try {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
      for (let element = walker.nextNode(); element; element = walker.nextNode()) {
        if (element.matches(CONTROL_SELECTOR) && ++count > limit) return true;
      }
    } catch (_) {}
    return false;
  }
  function contextAncestor(element) {
    const own = spacedText(element, 200);
    let current = hostParent(element);
    for (let depth = 0; current && current.nodeType === 1 && depth < 4; depth += 1, current = hostParent(current)) {
      if (current === document.body || current === document.documentElement) break;
      if (holdsMoreControlsThan(current, 4)) break;   // a whole list or form, not the element's own row
      const text = spacedText(current, 220);
      if (text.length > 200) break;   // a whole panel, not a row or field group
      if (text && text !== own) return { node: current, text };
    }
    return null;
  }
  function contextSignature(element) {
    return contextAncestor(element)?.text || '';
  }
  const hiddenCollected = [];
  const hiddenPool = [];
  const hiddenControls = new Set();
  const contexts = new Map();
  // The healer's own word splitting (semanticTokens), with identifiers split.
  function hintTokens(value) {
    const ignored = new Set(['a', 'an', 'and', 'for', 'of', 'on', 'the', 'to']);
    return String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').normalize('NFKD').toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(token => token && !ignored.has(token))
      .map(token => token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token);
  }
  // First, for every element outside the picture: is it reachable, can it do
  // what the step does, and how many of the step's words does it carry
  // (cheaply: its own words, its row and its small group). Only the best are
  // described in full afterwards (describeHiddenCandidates).
  function addHiddenCandidate(element, shadowPath, role, custom) {
    let layoutRect = targetIntent.kind === 'text' ? textRect(element) : element.getBoundingClientRect();
    if (broadDom && (!layoutRect || layoutRect.width < 1 || layoutRect.height < 1)) layoutRect = textRect(element);
    const steps = scrollReach(element, layoutRect);
    if (!steps) return;
    if (targetIntent.kind === 'text' && !ownText(element).length) return;
    const interactive = INTERACTIVE_TAGS.has(element.tagName) || CLICK_ROLES.has(role) || INPUT_ROLES.has(role) || element.isContentEditable;
    if (broadDom) {
      // Layout shells, and decoration inside an already listed control, add nothing.
      if (!interactive && !ownText(element).length && !['svg', 'img', 'canvas'].includes(element.localName)) return;
      for (let current = hostParent(element), depth = 0; current && depth < 8; current = hostParent(current), depth += 1) {
        if (hiddenControls.has(current)) return;
      }
    }
    const kind = candidateKind(element, role, compact(custom.kind).toLowerCase());
    const fits = supportsAction(element, role, kind);
    if (!hasExplicitTargetType && !fits && custom.force !== true) return;
    seen.add(element);
    // Its contents are part of it - except for a row, cell or tree item, which
    // hold controls of their own (the same rule as the picture's grouping).
    if (interactive && !['row', 'gridcell', 'treeitem'].includes(role)) hiddenControls.add(element);
    hiddenPool.push({ element, shadowPath: shadowPath.slice(), role, custom, kind, steps, fits: fits ? 1 : 0, score: 0, order: hiddenPool.length });
  }
  // Cheap: its own words, its labels, its table row and its parent's text.
  function hintScore(element) {
    const row = element.closest?.('tr');
    const words = new Set(hintTokens([
      ...['aria-label', 'placeholder', 'title', 'alt', 'name', 'id', 'data-testid', 'data-test', 'data-qa', 'data-cy'].map(name => element.getAttribute(name) || ''),
      spacedText(element, 200),
      ...Array.from(element.labels || []).map(label => spacedText(label, 100)),
      row ? Array.from(row.cells || []).slice(0, 3).map(cell => spacedText(cell, 70)).join(' ') : '',
      hostParent(element) ? spacedText(hostParent(element), 220) : '',
    ].join(' ')));
    let score = 0;
    for (const hint of hiddenHints) if (words.has(hint)) score += 1;
    return score;
  }
  function describeHiddenCandidates() {
    let best = hiddenPool;
    // Ranking is only needed when there are more than can be described.
    if (hiddenPool.length > maxHidden) {
      if (hiddenHints.size) for (const item of hiddenPool) item.score = hintScore(item.element);
      best = hiddenPool.slice().sort((left, right) => (right.fits - left.fits) || (right.score - left.score) || (left.order - right.order))
        .slice(0, maxHidden).sort((left, right) => left.order - right.order);
    }
    for (const item of best) describeHiddenCandidate(item);
  }
  function describeHiddenCandidate({ element, shadowPath, role, custom, kind, steps }) {
    const localId = ++localSequence;
    const context = contextSignature(element);
    elementRecords.set(localId, element);
    fingerprints.set(localId, fingerprint(element));
    contexts.set(localId, context);
    hiddenCollected.push({
      local_id: localId,
      tag: element.tagName.toLowerCase(),
      role,
      kind,
      accessible_name: compact(custom.name || accessibleName(element)),
      label: associatedLabel(element),
      text: compact(targetIntent.kind === 'text' ? ownText(element).map(node => node.textContent).join(' ') : element.textContent || "", 100),
      attributes: getAttrs(element),
      rect: null,
      visible: false,
      hidden: true,
      enabled: !isDisabled(element),
      editable: isEditable(element, role),
      clickable: isClickable(element, role),
      control_context: controlContext(element, role, paintedThroughAncestors),
      context: compact(context, 120),
      shadow_path: shadowPath.slice(),
      xpath: '',
      locator_candidates: [],
      custom_rule: custom.ruleName || "",
      ...presentationContext(element),
      where: describeReach(steps),
      where_steps: steps.map(step => ({ scope: step.scope, axis: step.axis, after: step.after, distance: step.distance,
        panel: step.panel ? panelName(step.panel) : null })),
    });
  }

  // ---- Shortened exact names ---------------------------------------------
  // The name a locator of this kind matches on: the accessible name for a
  // role, the element's own text for text, its label, or the attribute.
  function primaryName(element) {
    if (targetIntent.kind === 'role') return accessibleName(element);
    if (targetIntent.kind === 'text') return ownText(element).map(node => node.textContent).join(' ');
    if (targetIntent.kind === 'labelled') return associatedLabel(element) || element.getAttribute('aria-label') || labelledByText(element);
    if (targetIntent.kind === 'attributes') return element.getAttribute(String(targetIntent.names?.[0] || '')) || '';
    return '';
  }
  // The healer's own word splitting (semanticTokens in inline_healer.js).
  function nameTokens(value) {
    const ignored = new Set(['a', 'an', 'and', 'for', 'of', 'on', 'the', 'to']);
    return new Set(String(value || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
      .split(/\s+/).filter(token => token && !ignored.has(token))
      .map(token => token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token));
  }
  // Every element of the requested kind that can be reached - in the picture
  // or by scrolling - whose name uses only words of the exact name.
  let shortenedNameCount = 0;
  function countShortenedNames() {
    if (!exactNameWords.size) return;
    const elements = [...collected.map(record => elementRecords.get(record.local_id)), ...hiddenPool.map(item => item.element)];
    for (const element of elements) {
      if (!element) continue;
      const words = nameTokens(primaryName(element));
      if (words.size && [...words].every(word => exactNameWords.has(word))) shortenedNameCount += 1;
    }
  }

  function addCandidate(element, shadowPath, custom = {}) {
    if (!element || element.nodeType !== 1 || toolingNode(element) || seen.has(element)) return;
    const role = targetIntent.kind === 'role' && roleTargets.has(element) ? targetIntent.value : implicitRole(element);
    if (!targetMatches(element, role)) return;
    const rect = visibleRect(element);
    if (!rect) {
      if (collectHidden) addHiddenCandidate(element, shadowPath, role, custom);
      return;
    }
    const textBoxes = (broadDom || targetIntent.kind === 'text') ? visibleTextRects(element) : null;
    if (targetIntent.kind === 'text' && !textBoxes.length) return;
    // A text-only leaf with fully clipped/transparent glyphs has nothing to
    // display. Keep real controls/images and independently visible children.
    if (broadDom && ownText(element).length && !textBoxes.length && !element.children.length &&
        !INTERACTIVE_TAGS.has(element.tagName) && !['svg', 'img', 'canvas'].includes(element.localName)) return;
    const kind = candidateKind(element, role, compact(custom.kind).toLowerCase());
    // An explicit role/tag/text request determines what is numbered. Do not
    // discard blank divs, separators, empty status blocks or other requested
    // roles merely because an interactive-role/name heuristic rejects them.
    // The selected node still has to pass the original action's checks later.
    if (!hasExplicitTargetType && !supportsAction(element, role, kind) && custom.force !== true) return;
    seen.add(element);
    const attrs = getAttrs(element);
    const label = associatedLabel(element);
    const name = compact(custom.name || accessibleName(element));
    // Generate the recorder XPath only for the model-selected node, after
    // capture layout restoration. Do not generate competing cheap locators.
    const xpath = '';
    const localId = ++localSequence;
    elementRecords.set(localId, element);
    fingerprints.set(localId, fingerprint(element));
    const record = {
      local_id: localId,
      tag: element.tagName.toLowerCase(),
      role,
      kind,
      accessible_name: name,
      label,
      text: compact(targetIntent.kind === 'text' ? ownText(element).map(node => node.textContent).join(' ') : element.textContent || "", 100),
      attributes: attrs,
      rect,
      ...((broadDom || targetIntent.kind === 'text') ? { text_rects: textBoxes } : {}),
      visible: true,
      enabled: !isDisabled(element),
      editable: isEditable(element, role),
      clickable: isClickable(element, role),
      control_context: controlContext(element, role),
      shadow_path: shadowPath.slice(),
      xpath,
      locator_candidates: [],
      custom_rule: custom.ruleName || "",
      ...(broadDom ? presentationContext(element) : {}),
    };
    recordsByElement.set(element, record);
    collected.push(record);
  }

  function defaultInteresting(element) {
    if (/^(?:SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEAD|META|LINK)$/.test(element.tagName)) return false;
    if (broadDom) {
      // Document shells and non-painted resources have no distinct target
      // surface. All other rendered types enter the conservative dedup pass.
      return /^(?:html|body)$/i.test(element.localName) ? ownText(element).length > 0 :
        !/^(?:defs|clippath|mask|lineargradient|radialgradient|stop|title|desc)$/i.test(element.localName);
    }
    if (targetIntent.kind !== 'any') return targetMatches(element, implicitRole(element));
    if (INTERACTIVE_TAGS.has(element.tagName) || REGION_TAGS.has(element.tagName)) return true;
    const role = implicitRole(element);
    if (role && (CLICK_ROLES.has(role) || INPUT_ROLES.has(role))) return true;
    if (element.isContentEditable) return true;
    if (element.hasAttribute?.("onclick") || element.hasAttribute?.("tabindex")) return true;
    if (element.getAttribute?.("aria-label") || element.getAttribute?.("data-testid") || element.getAttribute?.("data-cy")) return true;
    try {
      return getComputedStyle(element).cursor === "pointer" && Boolean(accessibleName(element));
    } catch (_) {
      return false;
    }
  }

  function visit(element, shadowPath) {
    if (!element || element.nodeType !== 1 || toolingNode(element)) return;
    if (/^(?:SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEAD)$/.test(element.tagName)) return;
    if (defaultInteresting(element)) addCandidate(element, shadowPath);
    if (element.shadowRoot) {
      const nextPath = shadowPath.concat([element.tagName.toLowerCase()]);
      for (const child of Array.from(element.shadowRoot.children)) visit(child, nextPath);
    }
    for (const child of Array.from(element.children || [])) visit(child, shadowPath);
  }

  function shadowPathOf(element) {
    const hosts = [];
    for (let root = element.getRootNode?.(); root?.host; root = root.host.getRootNode?.()) {
      hosts.unshift(root.host.tagName.toLowerCase());
    }
    return hosts;
  }

  try {
    if (targetIntent.kind === 'role') {
      // Enumerate Playwright's exact role result set, not the heuristic DOM
      // walker. This includes any supported role, including unnamed blocks
      // and document-level matches outside document.body.
      for (const element of roleTargets) {
        if (element.closest?.('[data-pw-visual-heal-ui]')) continue;
        addCandidate(element, shadowPathOf(element));
      }
    } else visit(document.documentElement, []);
    for (const rule of customRules) {
      if (!rule || typeof rule.selector !== "string" || !rule.selector.trim()) continue;
      let matches = [];
      try {
        matches = Array.from(document.querySelectorAll(rule.selector));
      } catch (_) {
        continue;
      }
      for (const element of matches) {
        addCandidate(element, [], {
          kind: compact(rule.kind).toLowerCase(),
          name: compact(rule.name),
          force: rule.force === true,
          ruleName: compact(rule.name || rule.selector),
        });
        if (rule.searchDescendants === true) {
          for (const descendant of Array.from(element.querySelectorAll("*"))) {
            if (defaultInteresting(descendant)) addCandidate(descendant, []);
          }
        }
      }
    }
    describeHiddenCandidates();
    countShortenedNames();
  } catch (error) {
    return { error: error?.message || String(error), elements: [] };
  }

  const deduplication = {
    mode: broadDom ? 'rendered-dom-with-conservative-wrapper-grouping' : 'node-identity-only',
    before: collected.length, removed: 0, decorative_descendants: 0,
    layout_wrappers: 0, equivalent_wrappers: 0,
  };
  function deduplicateBroadDom() {
    const removed = new Set();
    const groupedInto = new Map();
    const parentOf = element => element.parentElement || element.getRootNode?.().host || null;
    const identityCache = new Map();
    const textCache = new Map();
    const groupTags = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary', 'option', 'svg', 'img', 'canvas', 'video', 'audio']);
    const regionTags = new Set(['form', 'fieldset', 'section', 'dialog', 'nav', 'main', 'aside', 'article', 'header', 'footer', 'table', 'tr', 'td', 'th', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
    function isGroup(element) {
      const role = implicitRole(element);
      // Focusability/event delegation does not make a page container an
      // atomic control. Nor do composite roles such as row or gridcell.
      return groupTags.has(element.localName?.toLowerCase()) ||
        (CLICK_ROLES.has(role) && !['row', 'gridcell', 'treeitem'].includes(role)) || INPUT_ROLES.has(role) ||
        (element.hasAttribute('contenteditable') && element.isContentEditable);
    }
    function hasIdentity(element) {
      if (identityCache.has(element)) return identityCache.get(element);
      const explicitRole = compact(element.getAttribute('role')).toLowerCase();
      const result = isGroup(element) || regionTags.has(element.localName?.toLowerCase()) || element.localName === 'label' ||
        ['onclick', 'onmousedown', 'onpointerdown', 'tabindex'].some(name => element.hasAttribute(name)) ||
        (explicitRole && !['none', 'presentation'].includes(explicitRole)) ||
        recordsByElement.get(element)?.custom_rule ||
        ['id', 'name', 'aria-label', 'aria-labelledby', 'title', 'alt', 'data-testid', 'data-test', 'data-qa', 'data-cy', 'data-label']
          .some(name => element.hasAttribute(name) && stableAttribute(name, element.getAttribute(name)));
      identityCache.set(element, Boolean(result));
      return Boolean(result);
    }
    function sameText(left, right) {
      for (const element of [left, right]) {
        if (!textCache.has(element)) textCache.set(element, String(element.textContent || '').replace(/\s+/g, ' ').trim());
      }
      return textCache.get(left) === textCache.get(right);
    }
    function passiveGraphic(element) {
      return ['svg', 'img'].includes(element.localName?.toLowerCase()) &&
        !recordsByElement.get(element)?.custom_rule &&
        !['id', 'name', 'role', 'aria-label', 'aria-labelledby', 'alt', 'title', 'tabindex', 'onclick', 'onpointerdown', 'onmousedown', 'data-testid', 'data-test', 'data-qa', 'data-cy']
          .some(name => element.hasAttribute(name) && (['tabindex', 'onclick', 'onpointerdown', 'onmousedown'].includes(name) || stableAttribute(name, element.getAttribute(name))));
    }
    function sameBox(left, right) {
      return ['x', 'y', 'width', 'height'].every(key => Math.abs(left.rect[key] - right.rect[key]) <= 2);
    }
    function hasPaint(element) {
      const css = getComputedStyle(element);
      const colored = css.backgroundColor && css.backgroundColor !== 'transparent' && !/rgba\([^)]*,\s*0(?:\.0+)?\s*\)/.test(css.backgroundColor);
      return Boolean(colored || (css.backgroundImage && css.backgroundImage !== 'none') ||
        (css.boxShadow && css.boxShadow !== 'none') ||
        ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(css[`border${side}Width`]) > 0 && !['none', 'hidden'].includes(css[`border${side}Style`])) ||
        ['::before', '::after'].some(pseudo => {
          const content = getComputedStyle(element, pseudo).content;
          return content && !['none', 'normal', '""', "''"].includes(content);
        }));
    }
    function group(record, owner, reason) {
      while (owner && removed.has(owner.local_id)) owner = groupedInto.get(owner.local_id);
      removed.add(record.local_id);
      groupedInto.set(record.local_id, owner || null);
      deduplication[reason] += 1;
      if (owner) owner.grouped_descendants = (owner.grouped_descendants || 0) + 1 + (record.grouped_descendants || 0);
    }
    for (const record of collected) {
      const element = elementRecords.get(record.local_id);
      const graphic = passiveGraphic(element);
      // Visible text is never discarded as a decorative child or wrapper.
      // Equal wording in separate nodes still maps to separate DOM targets.
      if (record.text_rects?.length || (hasIdentity(element) && !graphic)) continue;
      // Linear ancestor walk. A native/explicit nested control or named
      // region stops grouping, so equal text never merges distinct controls.
      let grouped = false;
      for (let ancestor = parentOf(element); ancestor; ancestor = parentOf(ancestor)) {
        if (!hasIdentity(ancestor)) continue;
        const owner = recordsByElement.get(ancestor);
        if (owner && isGroup(ancestor)) {
          group(record, owner, 'decorative_descendants');
          grouped = true;
        } else if (owner && sameBox(record, owner) && sameText(element, ancestor)) {
          group(record, owner, 'equivalent_wrappers');
          grouped = true;
        }
        break;
      }
      if (grouped) continue;
      // A standalone image/SVG is still a target. Only an unlabelled graphic
      // inside an owning control is grouped into that control's number.
      if (graphic) continue;
      const children = [...Array.from(element.children || []), ...Array.from(element.shadowRoot?.children || [])]
        .filter(child => recordsByElement.has(child));
      const sameChild = children.find(child => sameBox(record, recordsByElement.get(child)) && sameText(element, child));
      // Only a single rendered child with the same full text/box can stand
      // for an unlabelled wrapper. Siblings with identical text are preserved.
      if (children.length === 1 && sameChild && !ownText(element).length) {
        group(record, recordsByElement.get(sameChild), 'equivalent_wrappers');
      } else if (children.length && !ownText(element).length && !hasPaint(element)) {
        // A transparent layout shell contributes neither content nor its own
        // named target. Its independently mapped children cover its content.
        group(record, null, 'layout_wrappers');
      }
    }
    deduplication.removed = removed.size;
    return collected.filter(record => !removed.has(record.local_id));
  }
  const uniqueCandidates = broadDom ? deduplicateBroadDom() : collected;

  const actionPriority = record => {
    if (["fill", "type", "editable"].includes(requestedAction)) return record.editable ? 0 : 5;
    if (["check", "uncheck"].includes(requestedAction)) return record.kind === "toggle" ? 0 : 5;
    if (requestedAction === "selectoption") return record.kind === "select" ? 0 : 5;
    if (["clickable", "toggle", "select"].includes(record.kind)) return 0;
    if (record.kind === "input") return 1;
    if (record.kind === "region") return 4;
    return 3;
  };

  // Prefer the most specific actionable box. Large wrapping containers remain
  // available, but cannot push nested buttons/images/inputs out of the map.
  const ranked = uniqueCandidates.slice().sort((left, right) => {
    const priority = actionPriority(left) - actionPriority(right);
    if (priority) return priority;
    const leftArea = Math.max(1, left.rect.width * left.rect.height);
    const rightArea = Math.max(1, right.rect.width * right.rect.height);
    return leftArea - rightArea;
  });
  if (maxCandidates > 0 && !broadDom) ranked.splice(maxCandidates);

  const selectedIds = new Set([...ranked, ...hiddenCollected].map(record => record.local_id));
  for (const localId of Array.from(elementRecords.keys())) {
    if (!selectedIds.has(localId)) { elementRecords.delete(localId); fingerprints.delete(localId); contexts.delete(localId); }
  }
  function describeNode(node) {
    const text = compact(node?.textContent, 40);
    return node?.localName ? `<${node.localName}>${text ? ` "${text}"` : ''}` : 'another element';
  }

  window.__PW_HEAL_CANDIDATES__ = elementRecords;
  window.__PW_HEAL_CAPTURE_VERSION__ = (window.__PW_HEAL_CAPTURE_VERSION__ || 0) + 1;
  if (captureId && options.retainCapture === true) {
    const captures = window.__PW_HEAL_CAPTURES__ || (window.__PW_HEAL_CAPTURES__ = new Map());
    if (captures.has(captureId)) throw new Error('Duplicate healing capture identity');
    captures.set(captureId, {
      elements: elementRecords,
      numbers: new Map(),
      captureError(localId, reason, stage = 'pre-model-validation') {
        const record = ranked.find(item => item.local_id === localId) || hiddenCollected.find(item => item.local_id === localId);
        const number = this.numbers.get(localId);
        const error = new Error(`HEAL_CAPTURE_STALE: stage=${stage} number=${number ?? 'unassigned'} localId=${localId} tag=${record?.tag || 'unknown'} reason=${reason}`);
        error.code = 'HEAL_CAPTURE_STALE';
        error.details = { number, local_id: localId, tag: record?.tag || 'unknown', reason, stage };
        return error;
      },
      verifyPicture({ pruneInvalid = false } = {}) {
        const valid = [], rejected = [], geometry = [];
        for (const record of ranked) {
          if (!this.numbers.has(record.local_id)) continue;
          const number = this.numbers.get(record.local_id);
          try {
            const element = this.get(record.local_id, number);
            const current = visibleRect(element);
            if (!current) throw this.captureError(record.local_id, 'element-hidden-or-clipped');
            // DOM identity is authoritative. Reflow, animation and responsive
            // layout may change x/y/width/height without changing the target.
            // Return fresh geometry solely so the caller can draw the number
            // on the current pixels; geometry is never a selection identity.
            const textBoxes = record.text_rects ? visibleTextRects(element) : null;
            record.rect = current;
            if (textBoxes) record.text_rects = textBoxes;
            valid.push(number);
            geometry.push({ number, rect: current, text_rects: textBoxes });
          } catch (error) {
            // Only a known per-node stale failure can be pruned. Document/map
            // loss and unexpected algorithm errors still require a fresh capture.
            if (!pruneInvalid || error.code !== 'HEAL_CAPTURE_STALE' ||
                !['node-detached', 'identity-attributes-or-text-changed',
                  'element-hidden-or-clipped'].includes(error.details?.reason)) throw error;
            rejected.push(error.details);
            this.numbers.delete(record.local_id);
          }
        }
        return { version: 3, valid_numbers: valid, rejected, geometry };
      },
      // Bind the picture to node identity and captured identity attributes.
      // A virtualized row reusing the same Element must not pass this check.
      get(localId, gridNumber) {
        const element = elementRecords.get(localId);
        if (!this.numbers.has(localId) || this.numbers.get(localId) !== gridNumber) {
          throw this.captureError(localId, 'number-map-mismatch', 'identity-check');
        }
        if (!element?.isConnected) throw this.captureError(localId, 'node-detached', 'identity-check');
        if (fingerprints.get(localId) !== fingerprint(element)) {
          throw this.captureError(localId, 'identity-attributes-or-text-changed', 'identity-check');
        }
        // An element listed outside the picture also keeps its row/group: a
        // virtualized list may hand the same element to another row on scroll.
        if (contexts.has(localId) && contexts.get(localId) !== contextSignature(element)) {
          throw this.captureError(localId, 'surrounding-row-or-group-changed', 'identity-check');
        }
        return element;
      },
      // After the healer scrolled a listed element into view for a close-up:
      // is it on screen now (box in this frame's window), and is it the
      // topmost thing where it is drawn?
      tileState(localId, number) {
        const element = this.get(localId, number);
        const box = clipRenderedRect(element, element.getBoundingClientRect(), false, true);
        if (!box) return { shown: false, reason: 'still-cut-off-after-scrolling' };
        const plain = rect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        // Its row or field group too, so the close-up shows what it belongs to.
        const around = contextAncestor(element)?.node;
        const aroundBox = around ? clipRenderedRect(around, around.getBoundingClientRect(), false, true) : null;
        const shown = { shown: true, box: plain(box), context_box: aroundBox ? plain(aroundBox) : null };
        let blocker = null;
        for (const [fx, fy] of [[0.5, 0.5], [0.2, 0.5], [0.8, 0.5], [0.5, 0.2], [0.5, 0.8]]) {
          const x = box.x + box.width * fx, y = box.y + box.height * fy;
          let hit = document.elementFromPoint(x, y);
          for (let depth = 0; hit?.shadowRoot && depth < 20; depth += 1) {
            const inner = hit.shadowRoot.elementFromPoint(x, y);
            if (!inner || inner === hit) break;
            hit = inner;
          }
          if (hit && (within(element, hit) || within(hit, element))) return { ...shown, covered_by: null };
          blocker ||= hit;
        }
        return { ...shown, covered_by: describeNode(blocker) };
      },
    });
  }

  return {
    url: location.href,
    title: document.title || "",
    action: requestedAction,
    target_intent: targetIntent,
    broad_dom_version: 4,
    picture_validation_version: 3,
    full_page: fullPage,
    truncated: !broadDom && maxCandidates > 0 && uniqueCandidates.length > maxCandidates,
    deduplication,
    capture_version: window.__PW_HEAL_CAPTURE_VERSION__,
    capture_id: captureId,
    viewport: { width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio || 1 },
    elements: ranked,
    total_seen: collected.length,
    // Rendered elements outside the picture, with where each one is.
    hidden_version: 1,
    hidden_elements: hiddenCollected,
    hidden_total: hiddenPool.length,
    hidden_truncated: hiddenPool.length > hiddenCollected.length,
    // Reachable elements of this kind named with only the exact name's words.
    shortened_name_count: exactNameWords.size ? shortenedNameCount : null,
  };
})();
