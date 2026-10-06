// Temporary capture-only layout. Never click in this expanded layout.
// Kept separate from browser_script.js: candidate/XPath generation is unchanged.

// Capture diagnostics are intentionally silent. The caller reports only the
// final old-locator -> new-locator mapping after a successful repair.
const console = Object.freeze({ log() {}, warn() {}, error() {} });

function expandRenderedScrollContainers(options = {}) {
  const saved = new Map();
  const scrolls = new Map();
  const origin = { x: window.scrollX, y: window.scrollY };
  const previousVisibility = window.__PW_HEAL_CAPTURE_VISIBILITY__;
  const excludedBeforeCapture = new WeakSet();
  const visibilityGuard = { isExcluded: element => excludedBeforeCapture.has(element) };
  const report = {
    mode: 'expanded-rendered-scroll-containers', expandedContainers: 0,
    remainingScrollContainers: 0, warnings: [],
    viewport: { width: innerWidth, height: innerHeight },
    before: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    // Expansion cannot create data which the app has not put in the DOM.
    completeness: 'rendered-dom-only',
  };
  const parent = element => element.parentElement || element.getRootNode()?.host || null;
  // This function is serialized into the page: keep the tooling filter local.
  // Match only known recorder UI, never every popover or fixed-position node.
  function toolingNode(node) {
    for (let element = node?.nodeType === 1 ? node : node?.parentElement || node?.host;
      element; element = parent(element)) {
      if (element.localName === 'x-pw-glass' || element.hasAttribute('data-pw-recorder-validation-ui') ||
          element.hasAttribute('data-pw-visual-heal-ui')) return true;
    }
    return false;
  }
  function visible(element, allowOwnText = false) {
    if (!element.getBoundingClientRect().width || !element.getBoundingClientRect().height) {
      if (!allowOwnText) return false;
      let painted = false;
      for (const node of element.childNodes) {
        if (node.nodeType !== 3 || !/\S/.test(node.textContent || '')) continue;
        const range = document.createRange();
        try { range.selectNodeContents(node); painted ||= Array.from(range.getClientRects()).some(box => box.width > 0 && box.height > 0); }
        finally { range.detach(); }
      }
      if (!painted) return false;
    }
    for (let current = element; current; current = parent(current)) {
      const css = getComputedStyle(current);
      if (css.display === 'none' || (current === element && ['hidden', 'collapse'].includes(css.visibility)) ||
          css.contentVisibility === 'hidden' || Number(css.opacity) === 0) return false;
      // aria-hidden controls accessibility, not whether pixels are painted.
      // Do not exclude visible icon glyphs merely because they are decorative.
      if ((/hidden|clip/.test(css.overflowY) && current.clientHeight === 0) ||
          (/hidden|clip/.test(css.overflowX) && current.clientWidth === 0)) return false;
    }
    return true;
  }
  function set(element, name, value) {
    let properties = saved.get(element);
    if (!properties) { properties = new Map(); saved.set(element, properties); }
    if (!properties.has(name)) properties.set(name, {
      value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name),
    });
    element.style.setProperty(name, value, 'important');
    properties.get(name).applied = element.style.getPropertyValue(name);
  }
  function restore() {
    if (window.__PW_HEAL_CAPTURE_VISIBILITY__ === visibilityGuard) {
      if (previousVisibility) window.__PW_HEAL_CAPTURE_VISIBILITY__ = previousVisibility;
      else delete window.__PW_HEAL_CAPTURE_VISIBILITY__;
    }
    for (const [element, properties] of [...saved].reverse()) {
      for (const [name, previous] of properties) {
        // Don't overwrite an application's concurrent inline style change.
        if (element.style.getPropertyValue(name) !== previous.applied ||
            element.style.getPropertyPriority(name) !== 'important') continue;
        if (previous.value) element.style.setProperty(name, previous.value, previous.priority);
        else element.style.removeProperty(name);
      }
    }
    for (const [element, position] of scrolls) {
      if (element.isConnected) element.scrollTo({ left: position.x, top: position.y, behavior: 'instant' });
    }
    window.scrollTo({ left: origin.x, top: origin.y, behavior: 'instant' });
  }
  const nodes = [];
  function visit(root) {
    for (const element of root.querySelectorAll('*')) {
      if (toolingNode(element)) continue;
      nodes.push(element);
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  }
  try {
    visit(document);
    // Remember hidden nodes before expansion. Releasing a scrolling shell's
    // clip must not turn a previously hidden menu/label into a grid candidate.
    // Off-screen rendered content is allowed: it is the reason for full-page capture.
    for (const element of nodes) {
      if (!visible(element, true)) excludedBeforeCapture.add(element);
    }
    window.__PW_HEAL_CAPTURE_VISIBILITY__ = visibilityGuard;
    const panels = [];
    for (const element of nodes) {
      if (options.expandPanels === false || !visible(element) || /^(INPUT|TEXTAREA|SELECT|IFRAME)$/.test(element.tagName)) continue;
      const css = getComputedStyle(element);
      const vertical = /^(auto|scroll)$/.test(css.overflowY) && element.scrollHeight > element.clientHeight + 2;
      const horizontal = /^(auto|scroll)$/.test(css.overflowX) && element.scrollWidth > element.clientWidth + 2;
      if (!vertical && !horizontal) continue;
      if (panels.length >= 200) { report.warnings.push('More than 200 scrolling containers; capture expansion limited.'); break; }
      panels.push({ element, vertical, horizontal, height: element.scrollHeight, width: element.scrollWidth });
      scrolls.set(element, { x: element.scrollLeft, y: element.scrollTop });
    }
    const panelNodes = new Set(panels.map(item => item.element));
    const ancestors = new Set();
    for (const { element } of panels) {
      for (let ancestor = parent(element); ancestor; ancestor = parent(ancestor)) ancestors.add(ancestor);
    }
    // Release clipping only on the path of an actual scrolling panel. Never
    // globally reveal hidden menus, dialogs, tabs, or content-visibility:hidden.
    for (const element of [...ancestors, ...panelNodes]) {
      const css = getComputedStyle(element);
      scrolls.set(element, scrolls.get(element) || { x: element.scrollLeft, y: element.scrollTop });
      set(element, 'transition', 'none');
      set(element, 'scroll-behavior', 'auto');
      set(element, 'scroll-snap-type', 'none');
      set(element, 'overflow', 'visible');
      set(element, 'max-height', 'none');
      set(element, 'height', 'auto');
      set(element, 'flex-shrink', '0');
      if (css.contain !== 'none') set(element, 'contain', 'none');
      // A viewport-fixed app shell otherwise stays a viewport-sized clip.
      if (css.position === 'fixed' || css.position === 'absolute') {
        set(element, 'width', `${element.getBoundingClientRect().width}px`);
        set(element, 'position', 'relative');
        set(element, 'inset', 'auto');
      }
    }
    // Children first, then parents; repeat once to account for reflow.
    for (let pass = 0; pass < 2; pass += 1) {
      for (const item of panels.slice().reverse()) {
        const { element } = item;
        set(element, 'box-sizing', 'border-box');
        if (item.vertical) {
          const border = element.offsetHeight - element.clientHeight;
          set(element, 'height', `${Math.max(item.height, element.scrollHeight) + border}px`);
        }
        if (item.horizontal) {
          const border = element.offsetWidth - element.clientWidth;
          set(element, 'max-width', 'none');
          set(element, 'width', `${Math.max(item.width, element.scrollWidth) + border}px`);
        }
        element.scrollTo({ left: 0, top: 0, behavior: 'instant' });
      }
    }
    report.expandedContainers = panels.length;
    // Capture-only, modest zoom. Never shrink already-small text further.
    // Number badges are drawn offscreen and keep their normal pixel size.
    if (options.zoomOut === true && document.body) {
      let smallestFont = Infinity;
      const effectiveZoom = new Map();
      function zoomOf(element) {
        if (!element) return 1;
        if (effectiveZoom.has(element)) return effectiveZoom.get(element);
        const value = (Number.parseFloat(getComputedStyle(element).zoom) || 1) * zoomOf(parent(element));
        effectiveZoom.set(element, value);
        return value;
      }
      for (const element of nodes) {
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEAD|META|LINK)$/.test(element.tagName)) continue;
        const textNodes = Array.from(element.childNodes).filter(node => node.nodeType === 3 && /\S/.test(node.textContent || ''));
        if (!textNodes.length && !/^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)) continue;
        if (!visible(element, true)) continue;
        const fontSize = Number.parseFloat(getComputedStyle(element).fontSize) * zoomOf(element);
        if (Number.isFinite(fontSize) && fontSize > 0) smallestFont = Math.min(smallestFont, fontSize);
      }
      const factor = Number.isFinite(smallestFont) ? Math.min(1, Math.max(0.9, 12 / smallestFont)) : 1;
      report.captureZoom = { factor, minimumFontBefore: Number.isFinite(smallestFont) ? smallestFont : null, minimumFontAfter: Number.isFinite(smallestFont) ? smallestFont * factor : null };
      if (factor < 1) {
        const existing = Number.parseFloat(getComputedStyle(document.body).zoom) || 1;
        set(document.body, 'zoom', String(existing * factor));
      }
    }
    if (nodes.some(element => /virtual|react-window|ag-body-viewport/i.test(String(element.className)))) {
      report.warnings.push('Possible virtualized content: only currently mounted DOM elements can be numbered.');
    }
    if (document.querySelector('iframe')) report.warnings.push('Iframes retain their own visible frame area; this does not expand iframe documents.');
    return {
      report, restore,
      inspect() {
        report.after = { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight };
        report.remainingScrollContainers = nodes.filter(element => {
          if (!element.isConnected || !visible(element)) return false;
          const css = getComputedStyle(element);
          return (/^(auto|scroll)$/.test(css.overflowY) && element.scrollHeight > element.clientHeight + 2) ||
            (/^(auto|scroll)$/.test(css.overflowX) && element.scrollWidth > element.clientWidth + 2);
        }).length;
        report.completeness = report.remainingScrollContainers ? 'partial-scroll-containers-remain' : 'expanded-rendered-dom';
        if (report.remainingScrollContainers) report.warnings.push('Some scrolling content remains clipped (including native controls).');
        return report;
      },
    };
  } catch (error) { restore(); throw error; }
}

// Read-only inspection. An absolutely-positioned UL/OL (including hidden
// sidebar submenus) is not by itself evidence of an OPEN popup.
function inspectCaptureSurface(options = {}) {
  const nodes = [];
  const ignoredToolingOverlays = [];
  const parent = element => element.parentElement || element.getRootNode()?.host || null;
  // Playwright uses a native manual popover for its transparent debug glass.
  // It is not an application dropdown and must not veto full-page expansion.
  function toolingNode(node) {
    for (let element = node?.nodeType === 1 ? node : node?.parentElement || node?.host;
      element; element = parent(element)) {
      if (element.localName === 'x-pw-glass' || element.hasAttribute('data-pw-recorder-validation-ui') ||
          element.hasAttribute('data-pw-visual-heal-ui')) return true;
    }
    return false;
  }
  function visit(root) {
    for (const element of root.querySelectorAll('*')) {
      if (toolingNode(element)) {
        if (!toolingNode(parent(element))) ignoredToolingOverlays.push({
          tag: element.localName, reason: 'recorder-tooling-not-application-popup',
        });
        continue;
      }
      nodes.push(element);
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  }
  visit(document);
  function paintedRect(element, fullDocument = false) {
    const rect = element.getBoundingClientRect();
    if (!element.isConnected || rect.width <= 0 || rect.height <= 0) return null;
    const leftBound = fullDocument ? -scrollX : 0;
    const topBound = fullDocument ? -scrollY : 0;
    const rightBound = fullDocument ? Math.max(innerWidth, document.documentElement.scrollWidth, document.body?.scrollWidth || 0) - scrollX : innerWidth;
    const bottomBound = fullDocument ? Math.max(innerHeight, document.documentElement.scrollHeight, document.body?.scrollHeight || 0) - scrollY : innerHeight;
    let left = Math.max(leftBound, rect.left), top = Math.max(topBound, rect.top);
    let right = Math.min(rightBound, rect.right), bottom = Math.min(bottomBound, rect.bottom);
    for (let current = element; current; current = parent(current)) {
      const css = getComputedStyle(current);
      if (css.display === 'none' || css.contentVisibility === 'hidden' ||
          (current === element && ['hidden', 'collapse'].includes(css.visibility)) ||
          Number(css.opacity) === 0) return null;
      if (current !== element) {
        const box = current.getBoundingClientRect();
        if (/^(auto|scroll|hidden|clip)$/.test(css.overflowX)) {
          left = Math.max(left, box.left); right = Math.min(right, box.right);
        }
        if (/^(auto|scroll|hidden|clip)$/.test(css.overflowY)) {
          top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom);
        }
      }
    }
    return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
  }
  const roleOf = element => (element.getAttribute('role') || '').trim().split(/\s+/)[0];
  const floating = element => {
    for (let node = element, depth = 0; node && depth < 3; node = parent(node), depth += 1) {
      if (['absolute', 'fixed'].includes(getComputedStyle(node).position)) return true;
      if (node.matches('[data-popper-placement],[data-floating-ui-placement]')) return true;
    }
    return false;
  };
  const popups = new Map();
  const nonBlockingPopups = new Map();
  function note(element, reason, controller = null) {
    if (toolingNode(element)) return;
    const rect = paintedRect(element);
    if (!rect || popups.has(element) || nonBlockingPopups.has(element)) return;
    // A passive hover tooltip is not an interactive dropdown. Its presence
    // must not disable full-page expansion. Do not dismiss it or move the mouse.
    const interactiveSelector = 'button,input,select,textarea,a[href],[contenteditable="true"],[tabindex]:not([tabindex="-1"]),[role="button"],[role="link"],[role="combobox"],[role="listbox"],[role="menu"]';
    function hasControls(root) {
      if (root.querySelector(interactiveSelector)) return true;
      return [...root.querySelectorAll('*')].some(child => child.shadowRoot && hasControls(child.shadowRoot));
    }
    const passiveTooltip = roleOf(element) === 'tooltip' && !element.matches(interactiveSelector) &&
      !hasControls(element) && !(element.shadowRoot && hasControls(element.shadowRoot));
    const pool = passiveTooltip ? nonBlockingPopups : popups;
    pool.set(element, { reason: passiveTooltip ? 'passive-tooltip-does-not-block-expansion' : reason, tag: element.localName, id: element.id || '',
      role: roleOf(element), controller_id: controller?.id || '',
      name: (element.getAttribute('aria-label') || '').slice(0, 100), rect });
  }
  // Open MODAL dialogs: while one is open, everything outside it is out of
  // reach - the browser makes it inert for a <dialog> opened with showModal(),
  // and aria-modal="true" declares exactly that for a painted dialog.
  const modals = [];
  for (const element of nodes) {
    let nativePopover = false;
    try { nativePopover = element.matches(':popover-open'); } catch (_) {}
    if (nativePopover || element.matches('dialog[open]')) {
      note(element, nativePopover ? 'native-popover-open' : 'native-dialog-open');
      let nativeModal = false;
      try { nativeModal = !nativePopover && element.matches(':modal'); } catch (_) {}
      if (nativeModal && popups.has(element)) modals.push(element);
      continue;
    }
    const role = roleOf(element);
    if (role === 'dialog' && element.getAttribute('aria-modal') === 'true') {
      note(element, 'painted-modal-dialog');
      if (popups.has(element)) modals.push(element);
      continue;
    }
    // A semantic popup must actually float and be painted through every ancestor.
    // Navigation accordions and ordinary in-flow lists do not block expansion.
    if (['listbox', 'menu', 'dialog'].includes(role) &&
        !element.closest('nav,[role="navigation"]') && floating(element)) {
      note(element, 'painted-floating-' + role);
    }
    if (element.getAttribute('aria-expanded') !== 'true' || !paintedRect(element)) continue;
    const owns = (element.getAttribute('aria-controls') || element.getAttribute('aria-owns') || '').trim();
    const popupType = element.getAttribute('aria-haspopup');
    for (const id of owns.split(/\s+/).filter(Boolean)) {
      const root = element.getRootNode();
      const panel = root.getElementById?.(id) || document.getElementById(id);
      if (!panel) continue;
      const panelRole = roleOf(panel);
      if (['true', 'menu', 'listbox', 'tree', 'grid', 'dialog'].includes(popupType) ||
          (['listbox', 'menu', 'dialog'].includes(panelRole) && floating(panel))) {
        note(panel, 'expanded-controller', element);
      }
    }
  }
  // Ancestry across shadow roots (Node.contains stops at a shadow boundary).
  const within = (ancestor, node) => {
    for (let current = node; current; current = parent(current)) if (current === ancestor) return true;
    return false;
  };
  const scrolling = [];
  const scrollingBehindModal = [];
  for (const element of nodes) {
    if (/^(INPUT|TEXTAREA|SELECT|IFRAME)$/.test(element.tagName) || !paintedRect(element, options.fullDocument === true)) continue;
    const css = getComputedStyle(element);
    const vertical = /^(auto|scroll)$/.test(css.overflowY) && element.scrollHeight > element.clientHeight + 2;
    const horizontal = /^(auto|scroll)$/.test(css.overflowX) && element.scrollWidth > element.clientWidth + 2;
    if (!vertical && !horizontal) continue;
    const entry = { tag: element.localName, id: element.id || '', role: roleOf(element),
      clientWidth: element.clientWidth, clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth, scrollHeight: element.scrollHeight, vertical, horizontal };
    // Behind an open modal dialog - neither inside it nor holding it - a
    // clipped panel cannot hide anything the test can act on, so it does not
    // count against coverage. Panels inside the dialog (or around it) still do.
    if (modals.length && !modals.some(modal => within(modal, element) || within(element, modal))) {
      scrollingBehindModal.push(entry);
      continue;
    }
    scrolling.push(entry);
  }
  return { popups: [...popups.values()], nonBlockingPopups: [...nonBlockingPopups.values()], ignoredToolingOverlays, remainingScrollContainers: scrolling.length,
    scrollingContainers: scrolling.slice(0, 30), viewport: { width: innerWidth, height: innerHeight },
    ignoredScrollContainersBehindModal: scrollingBehindModal.slice(0, 30),
    document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight } };
}

// Shared by viewport preparation, numbering and pixel capture. Keep CSS zoom
// handling identical across those stages, including Firefox/WebKit.
function readCaptureGeometry(fullPage = true) {
  const root = document.documentElement, body = document.body;
  const zoomed = body && (Number.parseFloat(getComputedStyle(body).zoom) || 1) !== 1;
  const bodyBox = body?.getBoundingClientRect();
  return {
    scrollX, scrollY, viewportWidth: innerWidth, viewportHeight: innerHeight,
    width: fullPage ? Math.ceil(Math.max(innerWidth, root.scrollWidth,
      zoomed ? (bodyBox?.right || 0) + scrollX : body?.scrollWidth || 0)) : innerWidth,
    height: fullPage ? Math.ceil(Math.max(innerHeight, root.scrollHeight,
      zoomed ? (bodyBox?.bottom || 0) + scrollY : body?.scrollHeight || 0)) : innerHeight,
    fullPage,
  };
}

// Optional diagnostic fallback only. Normal headed capture deliberately does
// not call this function, so it cannot resize/unmaximize the browser window.
// Public Playwright APIs only: Chromium, Firefox and WebKit share this path.
async function prepareCaptureViewport(page, options = {}) {
  const original = page.viewportSize();
  const origin = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  const report = { mode: 'prepared-full-page-viewport', original, sizes: [] };
  const deadline = Date.now() + (options.timeout ?? 40000);
  let changedViewport = false, changedScroll = false, restored = false;
  async function restore() {
    if (restored) return;
    restored = true;
    if (page.isClosed()) return;
    const failures = [];
    if (changedViewport) {
      try { await page.setViewportSize(original); } catch (error) { failures.push(error); }
    }
    if (changedScroll) {
      try { await page.evaluate(position => window.scrollTo({ left: position.x, top: position.y, behavior: 'instant' }), origin); }
      catch (error) { failures.push(error); }
    }
    if (failures.length) throw Object.assign(new Error('HEAL_CAPTURE_RESTORE: viewport/scroll restoration failed: ' +
      failures.map(error => error.message).join('; ')), { code: 'HEAL_CAPTURE_RESTORE' });
  }
  try {
    // Grow only, at most three times. Responsive layout / lazy rendering gets
    // its own quiet period on each pass; an infinite feed cannot grow forever.
    for (let pass = 0; pass <= 3; pass += 1) {
      await waitForCaptureStability(page, { timeout: Math.max(1, deadline - Date.now()), quietMs: options.quietMs,
        phase: 'capture-viewport-pass-' + (pass + 1) });
      const geometry = await page.evaluate(readCaptureGeometry, true);
      if (geometry.width <= geometry.viewportWidth && geometry.height <= geometry.viewportHeight &&
          Math.abs(geometry.scrollX) <= 0.5 && Math.abs(geometry.scrollY) <= 0.5) {
        report.prepared = geometry;
        console.log('[visual-heal] Full-page capture view settled: ' + geometry.width + 'x' + geometry.height +
          '; numbering starts now; screenshot will not resize this view.');
        return { report, restore };
      }
      if (options.protectPopup) throw Object.assign(new Error(
        'HEAL_CAPTURE_INCOMPLETE: an open interactive popup needs its current viewport/scroll preserved; ' +
        'the complete document does not fit that view. No partial image will be sent.'), { code: 'HEAL_CAPTURE_INCOMPLETE' });
      if (pass === 3) throw Object.assign(new Error(
        'HEAL_CAPTURE_GEOMETRY: the document kept growing or scrolling during three capture-view preparations.'),
      { code: 'HEAL_CAPTURE_GEOMETRY', details: { geometry, sizes: report.sizes } });
      const needsResize = geometry.width > geometry.viewportWidth || geometry.height > geometry.viewportHeight;
      if (needsResize) {
        if (!original) throw Object.assign(new Error(
          'HEAL_CAPTURE_VIEWPORT_REQUIRED: full-page healing needs an explicit Playwright viewport ' +
          '(for example use.viewport={width:1280,height:720}), not viewport:null, so it can restore it safely.'),
        { code: 'HEAL_CAPTURE_VIEWPORT_REQUIRED' });
        const size = { width: geometry.width, height: geometry.height };
        changedViewport = true; // Even a partially failed resize must be restored.
        report.sizes.push(size);
        console.log('[visual-heal] Preparing full-page view before numbering: ' + size.width + 'x' + size.height + '.');
        await page.setViewportSize(size);
      }
      changedScroll = true;
      await page.evaluate(() => window.scrollTo({ left: 0, top: 0, behavior: 'instant' }));
    }
  } catch (error) { await restore(); throw error; }
}

async function prepareCaptureLayout(page, enabled = true, options = {}) {
  const surface = await page.evaluate(inspectCaptureSurface);
  console.log('[visual-heal] Capture surface: ' + JSON.stringify(surface));
  if (surface.ignoredToolingOverlays.length) {
    console.log('[visual-heal] Ignoring recorder debug UI for popup detection, expansion and DOM readiness: ' +
      surface.ignoredToolingOverlays.map(item => item.tag).join(', ') + '. Website popups remain protected.');
  }
  if (surface.nonBlockingPopups.length) {
    console.log('[visual-heal] Passive tooltip detected; full-page expansion remains enabled. No tooltip click/dismissal: ' +
      JSON.stringify(surface.nonBlockingPopups));
  }
  if (surface.popups.length) {
    const viewport = options.resizeViewport === true && options.fullPage !== false
      ? await prepareCaptureViewport(page, { ...options, protectPopup: true }) : null;
    return {
      report: { mode: 'unchanged-open-popup', expandedContainers: 0, ...surface,
        captureViewport: viewport?.report || { mode: 'native-full-page-no-manual-resize' },
        completeness: surface.remainingScrollContainers ? 'partial-protected-popup' : 'rendered-document',
        warnings: ['Confirmed painted popup: preserving its layout. Guard details are in capture metadata.' +
          (surface.remainingScrollContainers ? ' FULL CONTENT NOT CAPTURED: nested scrolling panels remain clipped while this popup is open.' : '')] },
      restore: viewport?.restore || (async () => {}),
    };
  }
  if (!enabled && options.zoomOut !== true) {
    const viewport = options.resizeViewport === true && options.fullPage !== false
      ? await prepareCaptureViewport(page, options) : null;
    return {
      report: { mode: 'unchanged-layout', ...surface,
        captureViewport: viewport?.report || { mode: 'native-full-page-no-manual-resize' },
        completeness: surface.remainingScrollContainers ? 'partial-expansion-disabled' : 'rendered-document' },
      restore: viewport?.restore || (async () => {}),
    };
  }
  const state = await page.evaluateHandle(expandRenderedScrollContainers, { expandPanels: enabled, zoomOut: options.zoomOut === true });
  let viewport = null, restored = false;
  async function restore() {
    if (restored) return;
    restored = true;
    const failures = [];
    // An explicitly requested diagnostic viewport is restored first. Normal
    // headed runs never resize the browser viewport/window here.
    try { await viewport?.restore(); } catch (error) { failures.push(error); }
    try { await state.evaluate(value => value.restore()); }
    catch (error) {
      // A destroyed document has no layout left to restore. Other errors must
      // stop recovery rather than allowing a click in a modified layout.
      if (!/Execution context was destroyed|Target.*closed|has been closed|Cannot find context/i.test(error.message)) failures.push(error);
    } finally { await state.dispose().catch(() => {}); }
    if (failures.length) throw Object.assign(new Error('HEAL_CAPTURE_RESTORE: ' +
      failures.map(error => error.message).join('; ')), { code: 'HEAL_CAPTURE_RESTORE' });
  }
  try {
    // Let ResizeObserver/layout work settle before scanning the same live DOM.
    await page.evaluate(() => new Promise(resolve => {
      const deadline = setTimeout(resolve, 250); // background tabs may suspend rAF
      requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(deadline); resolve(); }));
    }));
    if (options.resizeViewport === true && options.fullPage !== false) {
      viewport = await prepareCaptureViewport(page, options);
    }
    const report = await state.evaluate(value => value.inspect());
    report.captureViewport = viewport?.report || { mode: 'native-full-page-no-manual-resize' };
    report.popupDetection = { rule: 'interactive-application-popup-v4-passive-tooltips-allowed', matches: surface.popups,
      ignoredToolingOverlays: surface.ignoredToolingOverlays, nonBlockingPopups: surface.nonBlockingPopups };
    report.scrollingBefore = surface.scrollingContainers;
    return { report, restore };
  } catch (error) { await restore(); throw error; }
}



// Bounded read-only readiness gate. Network-idle is deliberately not required:
// polling/WebSockets are normal, but DOM/text/geometry must actually settle.
async function waitForCaptureStability(page, options = {}) {
  const requestedTimeout = options.timeout ?? 40000, quietMs = options.quietMs ?? 700;
  // Readiness cannot become a 40-second veto because one CSS animation keeps
  // moving a child by a fraction of a pixel. Candidate identity/geometry is
  // checked separately after the actual screenshot.
  const timeout = Math.min(requestedTimeout, Math.max(1500, quietMs * 3));
  const phase = options.phase || 'capture';
  const deadline = Date.now() + timeout;
  const unstable = message => Object.assign(new Error('HEAL_DOM_UNSTABLE: ' + message), { code: 'HEAL_DOM_UNSTABLE' });
  const frames = page.frames();
  if (!frames.length || page.isClosed()) throw unstable('page closed before ' + phase);
  console.log('[visual-heal] Waiting for DOM readiness + ' + quietMs + 'ms stable capture extent (' + phase +
    ', advisory limit=' + timeout + 'ms). Moving child elements do not veto capture.');
  try {
    const results = await Promise.all(frames.map(async frame => {
      await frame.waitForLoadState('domcontentloaded', { timeout: Math.max(1, deadline - Date.now()) });
      const result = await frame.evaluate(({ timeout, quietMs }) => new Promise(resolve => {
        const began = performance.now();
        let lastChanged = began, previous = '', mutations = 0, finished = false, timer;
        const observed = new Set();
        const parent = element => element.parentElement || element.getRootNode()?.host || null;
        function toolingNode(node) {
          for (let element = node?.nodeType === 1 ? node : node?.parentElement || node?.host;
            element; element = parent(element)) {
            if (element.localName === 'x-pw-glass' || element.hasAttribute('data-pw-recorder-validation-ui') ||
                element.hasAttribute('data-pw-visual-heal-ui')) return true;
          }
          return false;
        }
        const observer = new MutationObserver(records => {
          const applicationChanges = records.filter(record => {
            if (toolingNode(record.target)) return false;
            if (record.type !== 'childList') return true;
            const changed = [...record.addedNodes, ...record.removedNodes];
            return changed.some(node => !toolingNode(node));
          });
          if (!applicationChanges.length) return;
          // Diagnostic only. A fresh candidate map is built after this gate,
          // so user/application changes here do not make the pending map stale.
          mutations += applicationChanges.length;
        });
        const finish = result => { if (finished) return; finished = true; clearTimeout(timer); observer.disconnect(); resolve(result); };
        function sample() {
          if (finished) return;
          try {
            const root = document.documentElement, body = document.body;
            const bodyBox = body?.getBoundingClientRect();
            const parts = [document.readyState, document.fonts?.status || 'loaded',
              innerWidth, innerHeight, scrollX, scrollY,
              root?.scrollWidth || 0, root?.scrollHeight || 0,
              body?.scrollWidth || 0, body?.scrollHeight || 0,
              Math.round((bodyBox?.width || 0) * 2), Math.round((bodyBox?.height || 0) * 2)];
            function visit(root) {
              if (!observed.has(root)) {
                observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
                observed.add(root);
              }
              for (const element of root.querySelectorAll('*')) {
                if (toolingNode(element)) continue;
                if (element.shadowRoot) visit(element.shadowRoot);
              }
            }
            visit(document);
            const now = performance.now(), signature = parts.join(',');
            if (signature !== previous) { previous = signature; lastChanged = now; }
            if (document.readyState !== 'loading' && document.fonts?.status !== 'loading' &&
                now - lastChanged >= quietMs) {
              finish({ stable: true, elapsedMs: Math.round(now - began), mutations, quietMs }); return;
            }
            if (now - began >= timeout) {
              finish({ stable: false, elapsedMs: Math.round(now - began), mutations,
                quietForMs: Math.round(now - lastChanged), readyState: document.readyState }); return;
            }
            timer = setTimeout(sample, 140);
          } catch (error) { finish({ stable: false, error: String(error.message || error) }); }
        }
        sample();
      }), { timeout: Math.max(1, deadline - Date.now()), quietMs });
      return result;
    }));
    const now = page.frames();
    if (page.isClosed() || now.length !== frames.length || frames.some(frame => !now.includes(frame))) {
      throw unstable('frame set changed while waiting for ' + phase);
    }
    const unsettled = results.filter(result => !result.stable);
    if (unsettled.length) {
      console.warn('[visual-heal] Capture extent did not become quiet within the advisory limit; ' +
        'continuing with a fresh map and post-screenshot verification: ' + JSON.stringify(unsettled));
      return { stable: false, advisory: true, results };
    }
  } catch (error) {
    if (error.code === 'HEAL_DOM_UNSTABLE') throw error;
    throw unstable(phase + ': ' + error.message);
  }
  console.log('[visual-heal] DOM/fonts and full capture extent settled (' + phase + '); continuing with fresh numbering.');
  return { stable: true };
}

module.exports = { prepareCaptureLayout, expandRenderedScrollContainers, waitForCaptureStability, inspectCaptureSurface, readCaptureGeometry };
