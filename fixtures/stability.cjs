/*
 * STABILITY CHECKS - part of every Playwright run of this project, by default.
 *
 * playwright.config.js and playwright.healed.config.js load this file on their
 * first lines; Playwright loads the config in every test worker, so every run
 * gets it: the product's Run, heal reruns, Jenkins, `npm test`, `npx playwright
 * test`. `npm run stability:off` / `stability:on` switch it off and on for the
 * project (`npm run stability:status` shows what is set); STABILITY=off switches
 * it off for one run; STABILITY_LOG=1 also prints every wait longer than 0.3 s
 * with what it waited for.
 *
 * Everything is about the element the step uses and the work the steps caused:
 *   - BEFORE a click, press, hover, drag, one-shot read (isVisible() ...) or a
 *     "must not be there" assertion, it waits until that element is settled:
 *     exactly one match (several = the page is still changing), the same element
 *     (not a re-rendered copy) in the same place, nothing changing in it or in
 *     the box it sits in, no animation on it or around it, no spinner or busy
 *     sign next to it (or a full-screen loading cover), nothing in motion over
 *     it, not behind an opening/closing modal, handlers attached while the page
 *     is starting up; no short timer (<= 1 s, e.g. a debounced search) set by
 *     the earlier steps or the page's start pending; and no request in flight
 *     that matters to this element. Which requests matter is learned: when an
 *     answer arrives, the part of the page the page's own code changes with it
 *     is noted per address - that code is followed through its timers,
 *     animation frames and hand-offs, so an ad drawing its box at the same
 *     moment is not taken for it (kept between runs in the project's
 *     .stability/memory.json); a request whose answers never change
 *     this element's part of the page is not waited for, one not seen yet is.
 *     In Chrome and Edge (the learning run after a recording too) what the
 *     element's own code holds is read as well (the debugger reads its
 *     closures; the page is never paused): an answer seen changing it - also
 *     when nothing on the screen changes - is waited for before pressing that
 *     element, in every browser ("hiddenNeeds": false / STABILITY_HIDDEN=off).
 *   - fill, select and check go at once (exactly one match is still needed):
 *     setting a value twice does the same as once, so they are checked later
 *     instead - before the next steps, a value a late re-render wiped or reset
 *     is set again (a field the app emptied on purpose, like a chips input that
 *     turned the text into a chip, is left alone).
 *   - AFTER a click-like step it waits for what that step started - the requests
 *     it sent (from its handlers, from the timers it set, from the answers to
 *     its requests, or while the page was still reacting to it), the short
 *     timers it set, a page change - and nothing else: polling, analytics and
 *     other widgets are not its work. Then it checks that the page really
 *     responded; it clicks again (at most twice) only when nothing at all
 *     happened, when a handler ran and nothing observable followed on something
 *     that is not a toggle, or when it set off for another page that never came
 *     (reopening the dropdown it was in, if that closed) - never after anything
 *     but reads went to the server. And it says when the backend did not do it:
 *     a request the step caused that failed, answered 5xx (4xx for changes) or
 *     answered 200 with an error body ({"success": false}, GraphQL "errors").
 * Every wait has a cap (default 10 s; `npm run stability:wait -- 90` for the
 * project, STABILITY_MAX_WAIT_MS for one run); what was still busy at the cap is
 * ignored for the rest of that page's life. A page load (goto /
 * reload) that failed because the server was briefly unreachable or answered
 * 502/503/504 is retried.
 *
 * It never edits the spec and never fails a step by itself. Its own checks are
 * marked internal, so the HTML/Allure reports and the trace show the same steps
 * as without it (a step done again shows up as a second step). Playwright 1.58 -
 * 1.64; Chromium, Firefox, WebKit; nothing here depends on the app's framework.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { AsyncLocalStorage } = require('async_hooks');
const { createRequire } = require('module');

const envText = name => String(process.env[name] || '').trim();
const envNumber = (name, fallback) => {
  const text = envText(name);
  const value = Number(text);
  return text !== '' && Number.isFinite(value) && value >= 0 ? value : fallback;
};
// The project's own settings, kept in its package.json ("stability": { "enabled": false, "maxWaitSeconds": 90 }) and
// set with `npm run stability:off`, `stability:on`, `stability:wait -- <seconds>` (this file run by itself - see
// runCommand). An environment variable for one run wins over them: STABILITY=off / on, STABILITY_MAX_WAIT_MS.
const PROJECT_DIR = path.dirname(__dirname);
const PACKAGE_FILE = path.join(PROJECT_DIR, 'package.json');
function readPackage() {
  try {
    return JSON.parse(fs.readFileSync(PACKAGE_FILE, 'utf8').replace(/^﻿/, ''));
  } catch (_) {
    return null;
  }
}
const SETTINGS = (() => {
  const data = readPackage();
  const settings = data && typeof data === 'object' ? data.stability : null;
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
})();
const DEFAULT_WAIT_MS = 10000;
const OFF = envText('STABILITY') ? /^(0|false|off|no)$/i.test(envText('STABILITY')) : SETTINGS.enabled === false;
const VERBOSE = /^(1|true|on|yes)$/i.test(envText('STABILITY_LOG'));
const MAX_WAIT_MS = envNumber('STABILITY_MAX_WAIT_MS', Number(SETTINGS.maxWaitSeconds) > 0 ? Number(SETTINGS.maxWaitSeconds) * 1000 : DEFAULT_WAIT_MS);
// after a click: 8 s - or the whole limit when the project raised it (an app whose saves take a minute)
const FOLLOW_MAX_MS = MAX_WAIT_MS > DEFAULT_WAIT_MS ? MAX_WAIT_MS : Math.min(MAX_WAIT_MS, 8000);
const SLICE_MS = 250;
const SHORT_TIMER_MS = 1000;
// a request still loading after this long is taken for one that never finishes (until it is seen finishing)
const LONG_REQUEST_MS = Math.max(DEFAULT_WAIT_MS, MAX_WAIT_MS);
const STREAMING_MS = 2000;
// an answer arriving is a beat for the re-render that follows it, never a long wait on its own
const ANSWER_BEAT_MAX_MS = 1000;
// after a click the page visibly answered at once: two or three frames for what it starts right after
const ANSWERED_BEAT_MS = 40;
const NAVIGATION_RETRIES = 3;
const CLICK_RETRIES = 2;
const INPUT_REPAIRS = 2;
const PROBE_GRACE_MS = 1500;
const BODY_LIMIT = 200000;
const LOAD_CAUSE = -1; // the page's own start, before any step
const SKIPPED_REQUEST_TYPES = new Set(['websocket', 'eventsource', 'media', 'ping', 'manifest', 'texttrack', 'other', 'cspreport', 'beacon']);
// what a step can wait for on the network: data the page asked for and page loads. A script, style, image or
// font file still downloading says nothing about an element (one that waits for its code is "not wired yet").
const DATA_TYPES = new Set(['fetch', 'xhr', 'document']);
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const RETRYABLE_NAVIGATION_ERROR = /ERR_(CONNECTION_(REFUSED|RESET|CLOSED|ABORTED|FAILED)|EMPTY_RESPONSE|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|NETWORK_CHANGED|ADDRESS_UNREACHABLE|SOCKET_NOT_CONNECTED)|NS_ERROR_(CONNECTION_REFUSED|NET_RESET|NET_INTERRUPT|UNKNOWN_HOST|NET_TIMEOUT|NET_ON_RESOLVED)|Could not connect to the server|Connection refused|network connection was lost|server with the specified hostname could not be found/i;
const ABORTED_REQUEST = /ABORTED|cancel|NS_BINDING_ABORTED|Load request cancelled/i;
const CLICK_TYPES = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend'];
const INPUT_TYPES = ['input', 'change', 'keydown', 'keyup', 'keypress', 'beforeinput'];

// What each wrapped method is: 'pointer' (click-like), 'hover', 'type', 'press', 'plain' (another action),
// 'read' (a one-shot read; 'readAll' may see several elements), 'nav', 'keyboard', 'mouse'.
const LOCATOR_METHODS = {
  click: 'pointer', dblclick: 'pointer', tap: 'pointer', check: 'pointer', uncheck: 'pointer', setChecked: 'pointer',
  hover: 'hover', dragTo: 'hover',
  fill: 'type', type: 'type', pressSequentially: 'type', clear: 'type', press: 'press',
  selectOption: 'plain', selectText: 'plain', setInputFiles: 'plain', focus: 'plain', blur: 'plain', dispatchEvent: 'plain',
  // (Playwright 1.60: files or data dropped on the element - an upload by drag and drop)
  drop: 'plain',
  textContent: 'read', innerText: 'read', innerHTML: 'read', inputValue: 'read', getAttribute: 'read', isVisible: 'read',
  isHidden: 'read', isEnabled: 'read', isDisabled: 'read', isChecked: 'read', isEditable: 'read', boundingBox: 'read',
  // (the accessibility tree as text, taken once - not retried like toMatchAriaSnapshot)
  ariaSnapshot: 'read', ariaSnapshotJSON: 'read',
  count: 'readAll', allTextContents: 'readAll', allInnerTexts: 'readAll',
};
const PAGE_METHODS = {
  click: 'pointer', dblclick: 'pointer', tap: 'pointer', check: 'pointer', uncheck: 'pointer', setChecked: 'pointer',
  hover: 'hover', dragAndDrop: 'hover',
  fill: 'type', type: 'type', press: 'press',
  selectOption: 'plain', setInputFiles: 'plain', focus: 'plain', dispatchEvent: 'plain',
  textContent: 'read', innerText: 'read', innerHTML: 'read', inputValue: 'read', getAttribute: 'read', isVisible: 'read',
  isHidden: 'read', isEnabled: 'read', isDisabled: 'read', isChecked: 'read', isEditable: 'read',
  goto: 'nav', reload: 'nav',
};
const KEYBOARD_METHODS = { press: 'keyboard', type: 'keyboard', insertText: 'keyboard' };
const MOUSE_METHODS = { click: 'mouse', dblclick: 'mouse' };
// steps whose consequences are followed through before the next step runs
const FOLLOWED = new Set(['pointer', 'press', 'keyboard', 'mouse']);
const FOLLOWED_PLAIN = new Set(['selectOption', 'setInputFiles', 'dispatchEvent', 'drop']);
// steps that set a value: done at once, checked afterwards and set again if a re-render undid them
const VALUE_STEPS = new Set(['fill', 'clear', 'selectOption', 'check', 'uncheck', 'setChecked']);
// clicks whose press point is checked: the middle of the element must not be a different control inside it
const SPOT_METHODS = new Set(['click', 'dblclick', 'tap']);
// the regions of the page's top, as the page names them (signatureOf: "body", "html", "body#app" ...)
const isTopRegion = region => /^(body|html)(?=$|[#[])/.test(String(region));

const insideChecks = new AsyncLocalStorage();
const pageStates = new WeakMap();
// polling and other background requests, learned once for the whole worker
const backgroundKeys = new Set();
let playwright = null;
let wrapped = false;
let warnedInternal = false;
let nextStepId = 1;

function install() {
  playwright = locatePlaywright();
  const utils = playwrightUtils();
  playwright.currentZone = utils && typeof utils.currentZone === 'function' ? utils.currentZone : null;
  requestMap.load();
  const instrumentation = require(playwright.coreDir)._instrumentation;
  if (!instrumentation || typeof instrumentation.addListener !== 'function') throw new Error('this Playwright version has no _instrumentation');
  instrumentation.addListener({
    runAfterCreateBrowserContext: async context => {
      try {
        // what the other workers of this run learned since (another browser among them)
        requestMap.refresh();
        await prepareContext(context);
      } catch (error) {
        warnInternal(error);
      }
    },
    // the test is over: what the pages learned about their requests is kept before they close
    runBeforeCloseBrowserContext: async context => {
      try {
        await Promise.all(context.pages().map(async page => {
          const state = pageState(page);
          const drained = !!(await learnNow(state, page.mainFrame()));
          await hiddenFinish(state, drained).catch(() => {});
        }));
        requestMap.save();
      } catch (_) {}
    },
  });
}

// the exact playwright-core copy the project's @playwright/test runs on
function locatePlaywright() {
  let testDir = null;
  for (const root of [process.cwd(), path.dirname(__dirname)]) {
    try {
      testDir = path.dirname(createRequire(path.join(root, 'package.json')).resolve('@playwright/test/package.json'));
      break;
    } catch (_) {}
  }
  if (!testDir) throw new Error('@playwright/test not found');
  const playwrightDir = path.dirname(createRequire(path.join(testDir, 'package.json')).resolve('playwright/package.json'));
  const coreDir = path.dirname(createRequire(path.join(playwrightDir, 'package.json')).resolve('playwright-core/package.json'));
  const fold = text => (process.platform === 'win32' ? text.toLowerCase() : text);
  return { playwrightDir, coreDir, fold, libraryDirs: [coreDir, playwrightDir, testDir].map(dir => fold(dir) + path.sep) };
}

function playwrightUtils() {
  try {
    return require(path.join(playwright.coreDir, 'lib', 'coreBundle')).utils;
  } catch (_) {
    try {
      return require(path.join(playwright.coreDir, 'lib', 'utils'));
    } catch (__) {
      return null;
    }
  }
}

// This file's own frames stay out of the step locations Playwright shows (the spec line stays).
function boxThisFile() {
  try {
    const utils = playwrightUtils();
    if (utils && typeof utils.setBoxedStackPrefixes === 'function') utils.setBoxedStackPrefixes([playwright.playwrightDir, __filename]);
  } catch (_) {}
}

// ---------------------------------------------------------------- which part of the page each request changes

// Per page (its path, ids as *) and request address (method + path, ids as *): how often its answer changed
// nothing, and which parts of the page it changed (a part = the nearest box with a stable id, a form, a
// section, a table, a dialog ...). The same request can change different things on different pages, so
// each page has its own entries. Timers are kept the same way ("timer <its code and delay>"), with the
// requests they sent, and so are spinners that never stop ("spinner <its name>"). A part not seen changed in
// the last REGION_MEMORY observations is forgotten, so what is kept follows the app as it changes - both ways.
// Kept between runs in the project's .stability/memory.json - committed with the specs, a pipeline's run starts with
// what earlier runs learned (STABILITY_CACHE=<file> or off).
// Besides: how often each page was visited (an entry not seen in its page's last FORGET_VISITS visits is gone -
// counted in visits, not days, so a spec not run for months keeps what it learned), at most MAX_ENTRIES entries
// (the ones seen longest ago go first), which other sites each app's pages use as their own backend, and each
// page's script fingerprint (a new release of the app).
// Since version 3 a change is credited to the answer whose own code made it (see "whose code made a change" in the
// page's tracker), no longer to whatever answer arrived the moment before: an entry seen twice that way drops the
// parts only the older, timing-based look had given it (exact), and the other sites taken for an app's backend by
// that older look are learned again.
const REGION_MEMORY = 20;
const FORGET_VISITS = 30;
const MAX_ENTRIES = 5000;
const requestMap = {
  entries: new Map(),
  visits: new Map(),
  backends: new Map(),
  prints: new Map(),
  file: null,
  dirty: 0,
  load() {
    const setting = envText('STABILITY_CACHE');
    if (/^(0|false|off|no)$/i.test(setting)) return;
    // in the project, kept with its specs (committed with them: a pipeline's run starts with what was learned)
    this.file = setting || path.join(path.dirname(__dirname), '.stability', 'memory.json');
    // (until 2026-10 it was kept in node_modules/.cache, which a pipeline's clean install removes: read from there once)
    const legacy = setting ? '' : path.join(path.dirname(__dirname), 'node_modules', '.cache', 'stability', 'requests.json');
    try {
      let raw = '';
      try {
        raw = fs.readFileSync(this.file, 'utf8');
      } catch (_) {
        if (!legacy) throw _;
        raw = fs.readFileSync(legacy, 'utf8');
        this.dirty += 1;
      }
      const saved = JSON.parse(raw) || {};
      for (const [page, count] of Object.entries(saved.visits || {})) this.visits.set(page, Number(count) || 0);
      for (const [key, entry] of Object.entries(saved.keys || {})) {
        const loaded = this.fromSaved(entry, this.visitsOf(pageOfKey(key)));
        if (!loaded.lastAt) loaded.lastAt = Date.now();
        this.entries.set(key, loaded);
      }
      if (Number(saved.version) >= 3) for (const [appSite, sites] of Object.entries(saved.backends || {})) if (Array.isArray(sites)) this.backends.set(appSite, new Set(sites.slice(0, 20)));
      for (const [page, list] of Object.entries(saved.watch || {})) if (Array.isArray(list)) this.watches.set(page, list.slice(0, 20).map(String));
      for (const [page, print] of Object.entries(saved.prints || {})) if (print && print.fp) this.prints.set(page, { fp: String(print.fp), flips: Number(print.flips) || 0, changed: false });
    } catch (_) {}
    this.readAt = this.stampOf();
    process.on('exit', () => this.save());
  },
  stampOf() {
    try {
      return fs.statSync(this.file).mtimeMs;
    } catch (_) {
      return 0;
    }
  },
  readAt: 0,
  // Another worker of the same run - another browser: Chrome or Edge seeing what Firefox and WebKit cannot - may have
  // written what it learned since this one read the file. Taken in at each test's start when the file changed, so that
  // what one browser learns serves the others in the same run; what this worker learned itself is kept (both, as when
  // saving).
  refresh() {
    if (!this.file) return;
    const stamp = this.stampOf();
    if (!stamp || stamp === this.readAt) return;
    this.readAt = stamp;
    let saved = null;
    try {
      saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (_) {
      return;
    }
    if (!saved || typeof saved !== 'object') return;
    for (const [page, count] of Object.entries(saved.visits || {})) this.visits.set(page, Math.max(this.visitsOf(page), Number(count) || 0));
    for (const [key, raw] of Object.entries(saved.keys || {})) {
      const theirs = this.fromSaved(raw || {}, this.visitsOf(pageOfKey(key)));
      const mine = this.entries.get(key);
      if (!mine) {
        if (!theirs.lastAt) theirs.lastAt = Date.now();
        this.entries.set(key, theirs);
        continue;
      }
      mine.nothing = Math.max(mine.nothing, theirs.nothing);
      mine.seen = Math.max(mine.seen, theirs.seen);
      mine.reads = Math.max(mine.reads, theirs.reads);
      for (const region of theirs.regions) {
        if (mine.regions.has(region) || mine.regions.size >= 40) continue;
        mine.regions.add(region);
        mine.regionSeen.set(region, theirs.regionSeen.get(region) || theirs.seen);
      }
      for (const sent of theirs.sends) if (mine.sends.size < 10) mine.sends.add(sent);
      for (const name of theirs.hidden) if (mine.hidden.size < 20) mine.hidden.add(name);
      mine.guesses = mergeGuesses(mine.guesses, theirs.guesses);
      // (what a build that keeps more - the strict rule's: how often an answer was taken in, what it was cleared for)
      if (typeof mine.looked === 'number') mine.looked = Math.max(mine.looked, theirs.looked || 0);
      if (typeof mine.deep === 'number') mine.deep = Math.max(mine.deep, theirs.deep || 0);
      if (mine.clear && theirs.clear) for (const name of theirs.clear) if (!mine.hidden.has(name)) mine.clear.add(name);
      if (!mine.endlessChanged) mine.endless = theirs.endless;
      const exact = Math.min(mine.exactFrom || Infinity, theirs.exactFrom || Infinity);
      mine.exactFrom = exact === Infinity ? 0 : exact;
    }
    if (Number(saved.version) >= 3) {
      for (const [appSite, sites] of Object.entries(saved.backends || {})) {
        if (!Array.isArray(sites)) continue;
        let mine = this.backends.get(appSite);
        if (!mine) this.backends.set(appSite, (mine = new Set()));
        for (const site of sites.slice(0, 20)) if (mine.size < 20) mine.add(site);
      }
    }
    for (const [page, list] of Object.entries(saved.watch || {})) {
      if (!Array.isArray(list)) continue;
      this.watches.set(page, [...new Set([...(this.watches.get(page) || []), ...list.map(String)])].slice(0, 20));
    }
  },
  // an entry saved before visits were counted starts counting now (it is not forgotten at once)
  fromSaved(entry, visitsNow = 0) {
    const seen = Number(entry.seen) || 0;
    const regions = new Set(Array.isArray(entry.regions) ? entry.regions.slice(0, 40) : []);
    const regionSeen = new Map();
    for (const region of regions) {
      const at = entry.regionSeen && Number(entry.regionSeen[region]);
      regionSeen.set(region, Number.isFinite(at) ? at : seen);
    }
    return {
      nothing: Number(entry.nothing) || 0, seen, regions, regionSeen,
      sends: new Set(Array.isArray(entry.sends) ? entry.sends.slice(0, 10) : []),
      endless: !!entry.endless, endlessChanged: false,
      reads: Number(entry.reads) || 0,
      looked: Number(entry.looked) || 0,
      deep: Number(entry.deep) || 0,
      lastVisit: Number.isFinite(Number(entry.lastVisit)) && entry.lastVisit !== undefined ? Number(entry.lastVisit) : visitsNow,
      lastAt: Number(entry.lastAt) || 0,
      exactFrom: Number(entry.exact) || 0,
      hidden: new Set(Array.isArray(entry.hidden) ? entry.hidden.slice(0, 20) : []),
      guesses: guessesFromSaved(entry.guess),
      clear: new Set(Array.isArray(entry.clear) ? entry.clear.slice(0, 20) : []),
    };
  },
  key: (page, address) => `${page || '/'} ${address}`,
  entryOf(page, address) {
    const key = this.key(page, address);
    let entry = this.entries.get(key);
    if (!entry) this.entries.set(key, (entry = { nothing: 0, seen: 0, regions: new Set(), regionSeen: new Map(), sends: new Set(), endless: false, endlessChanged: false, reads: 0, lastVisit: 0, lastAt: 0, exactFrom: 0, hidden: new Set(), guesses: new Map(), looked: 0, deep: 0, clear: new Set() }));
    return entry;
  },
  // A guess, in any browser: a step went ahead while this answer was on its way and a check failed after it - the
  // element it pressed may need that answer. It adds the same wait as a hidden need until a fact settles it (facts
  // always win): the answer seen changing what the element's code uses (factFor - the guess is a fact then), another
  // answer guessed from the same failure seen doing so (that one explains the failure), or a complete look at what
  // the element's code uses seeing this answer change none of it (refuteGuess). A guess made again after a fact
  // dropped it is firm (again): failing again outweighs the look. Per element name: { at, group (the failure), off
  // (when a fact dropped it), again }.
  noteGuess(page, address, names, group) {
    const entry = this.entryOf(page, address);
    const added = [];
    for (const name of names) {
      if (entry.hidden.has(name)) continue;
      const known = entry.guesses.get(name);
      if (known && !known.off) continue;
      if (!known && entry.guesses.size >= 20) continue;
      entry.guesses.set(name, { at: Date.now(), group, off: 0, again: !!known });
      added.push(name);
    }
    if (added.length) {
      this.touched(page, entry);
      this.dirty += 1;
    }
    return added;
  },
  // a fact: this answer was seen changing what the element's code uses - its guess there is one now, and the other
  // answers guessed from that same failure are explained by it (no longer waited for, unless guessed again since)
  factFor(page, address, names) {
    const entry = this.entries.get(this.key(page, address));
    const confirmed = [];
    const dropped = [];
    if (!entry) return { confirmed, dropped };
    const now = Date.now();
    for (const name of names) {
      const guess = entry.guesses.get(name);
      if (!guess || guess.off) continue;
      guess.off = now;
      confirmed.push(name);
      for (const [key, other] of this.entries) {
        if (other === entry || pageOfKey(key) !== (page || '/')) continue;
        const theirs = other.guesses.get(name);
        if (!theirs || theirs.off || theirs.again || theirs.group !== guess.group) continue;
        theirs.off = now;
        dropped.push(key.slice(pageOfKey(key).length + 1));
      }
    }
    if (confirmed.length) this.dirty += 1;
    return { confirmed, dropped };
  },
  // a complete look at what the element's code uses saw this answer change none of it: its guess there is dropped
  refuteGuess(page, address, names) {
    const entry = this.entries.get(this.key(page, address));
    if (!entry) return false;
    let dropped = false;
    for (const name of names) {
      const guess = entry.guesses.get(name);
      if (!guess || guess.off || guess.again) continue;
      guess.off = Date.now();
      dropped = true;
    }
    if (dropped) this.dirty += 1;
    return dropped;
  },
  // A fact the other way (the strict rule): a look that saw all that an element's code uses watched this answer's first
  // run on a page and none of it changed - the element does not need it. A later sight of it changing (noteHidden) wins.
  noteClear(page, address, names) {
    const entry = this.entryOf(page, address);
    let added = false;
    for (const name of names) {
      if (entry.hidden.has(name) || entry.clear.has(name) || entry.clear.size >= 20) continue;
      entry.clear.add(name);
      added = true;
    }
    if (added) {
      this.touched(page, entry);
      this.dirty += 1;
    }
    return added;
  },
  clearedFor(page, address, chain) {
    const entry = this.entries.get(this.key(page, address));
    if (!entry || !entry.clear.size || !chain || !chain.length) return false;
    const specific = chain.some(region => !isTopRegion(region));
    for (const region of chain) {
      if (specific && isTopRegion(region)) continue;
      if (entry.clear.has(region)) return true;
    }
    return false;
  },
  // the page's code took this answer in (its body, its status or a handler) on an earlier visit
  takenIn(page, address) {
    const entry = this.entries.get(this.key(page, address));
    return !!entry && (entry.looked > 0 || entry.reads > 0);
  },
  // the debugger's look watched this answer arrive (all of its code between two looks): what Chrome and Edge skip by
  // the other rules was seen by a look that reads a button's closure - not only counted where none can (Firefox)
  noteDeep(page, address) {
    const entry = this.entryOf(page, address);
    if (entry.deep >= 1000) return;
    entry.deep += 1;
    this.touched(page, entry);
    this.dirty += 1;
  },
  deepWatched(page, address) {
    const entry = this.entries.get(this.key(page, address));
    return !!entry && entry.deep > 0;
  },
  // whether any answer on this page is guessed for one of these element names (a look then also checks whether it
  // sees all that the element's code uses)
  guessedOn(page, names) {
    const prefix = `${page || '/'} `;
    for (const [key, entry] of this.entries) {
      if (!entry.guesses.size || !key.startsWith(prefix)) continue;
      for (const name of names) {
        const guess = entry.guesses.get(name);
        if (guess && !guess.off) return true;
      }
    }
    return false;
  },
  // An answer that changes what an element's own code uses (its hidden needs - seen in a Chromium-based browser, see
  // hiddenLook): the parts of the page that element is in, kept apart from what the answer visibly changes. Only ever
  // adds a wait; never forgotten by itself (the browsers that cannot see it would not see it again).
  // a part of the page an answer changes that the page's change watch cannot see: a value its code set in a field
  // (no element changes) - found when a value an earlier step set was reset after it arrived
  noteRegion(page, address, region) {
    const entry = this.entryOf(page, address);
    if (entry.regions.has(region) || entry.regions.size >= 40) return;
    entry.regions.add(region);
    entry.regionSeen.set(region, entry.seen || 1);
    this.touched(page, entry);
    this.dirty += 1;
  },
  noteHidden(page, address, names) {
    const entry = this.entryOf(page, address);
    let added = false;
    for (const name of names) {
      if (entry.hidden.has(name) || entry.hidden.size >= 20) continue;
      entry.hidden.add(name);
      added = true;
      entry.clear.delete(name);
    }
    this.touched(page, entry);
    this.dirty += 1;
    return added;
  },
  // 'seen' (a hidden need), 'guess' (from a failure) or '' - for this element's parts of the page
  hiddenKind(page, address, chain) {
    const entry = this.entries.get(this.key(page, address));
    if (!entry || (!entry.hidden.size && !entry.guesses.size) || !chain || !chain.length) return '';
    const specific = chain.some(region => !isTopRegion(region));
    let kind = '';
    for (const region of chain) {
      if (specific && isTopRegion(region)) continue;
      if (entry.hidden.has(region)) return 'seen';
      const guess = entry.guesses.get(region);
      if (guess && !guess.off) kind = 'guess';
    }
    return kind;
  },
  hiddenRelevant(page, address, chain) {
    return !!this.hiddenKind(page, address, chain);
  },
  // the controls the spec pressed on each page (their locators), most recent first: watched there from the start
  watches: new Map(),
  watch(page, selector) {
    if (!selector) return;
    const list = (this.watches.get(page || '/') || []).filter(item => item !== selector);
    list.unshift(selector);
    this.watches.set(page || '/', list.slice(0, 20));
    this.dirty += 1;
  },
  watchedOn(page) {
    return this.watches.get(page || '/') || [];
  },
  // the entry was seen now: on this page's visit number ...
  touched(page, entry) {
    entry.lastVisit = this.visitsOf(page);
    entry.lastAt = Date.now();
  },
  visitsOf(page) {
    return this.visits.get(page || '/') || 0;
  },
  // one more visit of a page (a page loaded, or the app's own address change to it)
  visit(page) {
    this.visits.set(page || '/', this.visitsOf(page) + 1);
    if (this.visits.size > MAX_ENTRIES) this.visits.delete(this.visits.keys().next().value);
    this.dirty += 1;
  },
  // one more observation of what it changed (and, for a timer, what it sent)
  note(page, address, regions, sends = [], exact = false, uncertain = false, looked = true) {
    const entry = this.entryOf(page, address);
    entry.seen += 1;
    // the first observation with the page's code followed
    if (exact && !entry.exactFrom) entry.exactFrom = entry.seen;
    // (an answer whose code ran while another's redraw was waiting may have been drawn by it: no evidence of nothing;
    // an answer the page never looked at - no body, status or handler - brings nothing in: once is enough)
    if (!regions.length && !uncertain) entry.nothing += exact && !looked ? 2 : 1;
    if (looked) entry.looked += 1;
    for (const region of regions) {
      if (entry.regions.size < 40 || entry.regions.has(region)) {
        entry.regions.add(region);
        entry.regionSeen.set(region, entry.seen);
      }
    }
    for (const sent of sends) if (entry.sends.size < 10) entry.sends.add(sent);
    this.forget(entry);
    this.touched(page, entry);
    this.dirty += 1;
  },
  // the page read this answer (took its data in): whatever it changed on the screen, the app may keep it
  noteRead(page, address) {
    const entry = this.entryOf(page, address);
    entry.reads += 1;
    this.touched(page, entry);
    this.dirty += 1;
  },
  isRead(page, address) {
    const entry = this.entries.get(this.key(page, address));
    return !!entry && entry.reads > 0;
  },
  // another site an app's pages use as their own backend (its answers read, the user's identity sent along or the
  // browser's permission check needed)
  isBackend(appSite, site) {
    const sites = this.backends.get(appSite);
    return !!sites && sites.has(site);
  },
  addBackend(appSite, site) {
    let sites = this.backends.get(appSite);
    if (!sites) this.backends.set(appSite, (sites = new Set()));
    if (sites.has(site) || sites.size >= 20) return false;
    sites.add(site);
    this.dirty += 1;
    return true;
  },
  // A page's scripts as the app ships them (their file names change with each new build): returns true when they
  // differ from the last visit - a new release, so what was learned about this page is not trusted for this visit.
  // A page whose names change on every visit (made up for each visit) stops counting as new after 3 changes running.
  release(page, fp) {
    const print = this.prints.get(page);
    if (!print) {
      this.prints.set(page, { fp, flips: 0, changed: true });
      this.dirty += 1;
      return false;
    }
    if (print.fp === fp) {
      if (print.flips) {
        print.flips = 0;
        print.changed = true;
        this.dirty += 1;
      }
      return false;
    }
    print.fp = fp;
    print.flips += 1;
    print.changed = true;
    this.dirty += 1;
    return print.flips <= 2;
  },
  // the parts not seen changed in the last REGION_MEMORY observations: the app no longer changes them; and, once it
  // was seen twice with the page's code followed, the parts only the older timing-based look gave it
  forget(entry) {
    const exactFrom = entry.exactFrom || 0;
    const settled = exactFrom > 0 && entry.seen - exactFrom >= 1;
    for (const [region, at] of entry.regionSeen) {
      if (entry.seen - at > REGION_MEMORY || (settled && at < exactFrom)) {
        entry.regionSeen.delete(region);
        entry.regions.delete(region);
      }
    }
  },
  // the spinners remembered on this page as never stopping (names as the page gives them)
  endlessSpinners(page) {
    const prefix = this.key(page, 'spinner ');
    const names = [];
    for (const [key, entry] of this.entries) if (entry.endless && key.startsWith(prefix)) names.push(key.slice(prefix.length));
    return names;
  },
  // Font families of a site seen still loading after the whole font wait (a font file that never answers): on any
  // page of that site - a font is the site's, not the page's - but those this page saw arrive after all
  stuckFonts(page, site) {
    const address = `font ${site} `;
    const families = new Set();
    const arrivedHere = new Set();
    const here = `${page} ${address}`;
    for (const [key, entry] of this.entries) {
      const at = key.indexOf(' ');
      if (!key.startsWith(address, at + 1)) continue;
      const family = key.slice(at + 1 + address.length);
      if (entry.endless) families.add(family);
      else if (key.startsWith(here)) arrivedHere.add(family);
    }
    return [...families].filter(family => !arrivedHere.has(family));
  },
  // ... and one this page saw arrive: remembered so for this page (an entry that is not endless)
  noteFontArrived(page, address) {
    const entry = this.entryOf(page, address);
    if (!entry.endless && entry.endlessChanged) return;
    entry.endless = false;
    entry.endlessChanged = true;
    this.endlessVersion = (this.endlessVersion || 0) + 1;
    this.touched(page, entry);
    this.dirty += 1;
  },
  // 'irrelevant' only once its answers on this page were seen changing nothing near this element. The page's top
  // (body, html: a class on <html>, a toast added to <body>) comes along with any answer, so for an element inside
  // a more specific part of the page it is no evidence - only the specific parts the answer changed count.
  relevance(page, address, chain) {
    const entry = this.entries.get(this.key(page, address));
    if (!entry) return 'unknown';
    if (!entry.regions.size) return entry.nothing >= 2 ? 'irrelevant' : 'unknown';
    if (!chain || !chain.length) return 'relevant';
    const specific = chain.some(region => !isTopRegion(region));
    for (const region of chain) {
      if (specific && isTopRegion(region)) continue;
      if (entry.regions.has(region)) return 'relevant';
    }
    return 'irrelevant';
  },
  changesNothing(page, address) {
    const entry = this.entries.get(this.key(page, address));
    return !!entry && !entry.regions.size && !entry.hidden.size && entry.nothing >= 2;
  },
  changesSomething(page, address) {
    const entry = this.entries.get(this.key(page, address));
    return !!entry && (entry.regions.size > 0 || entry.hidden.size > 0);
  },
  // seen changing the screen (a hidden need is a fact about one element only: it never takes away a page-wide wait)
  changesVisibly(page, address) {
    const entry = this.entries.get(this.key(page, address));
    return !!entry && entry.regions.size > 0;
  },
  // A request still not finished when a step gave up waiting for it (a tracking call, a worker's script):
  // not waited for again, in later runs too - until it is seen finishing, which shows it was only slow.
  // ... asked and told for both addresses a request may be filed under (pages: the one it was sent from, the page's now)
  isEndlessAt(pages, address) {
    return pages.some(page => !!page && this.isEndless(page, address));
  },
  // ... and on another page of the app: whether an address ever answers is the server's doing, not the page's - an
  // address seen never finishing on one page is one on the app's other pages too, until this page sees it answer
  // (seen: an answer of it was taken in here). The address names its site: one app's never covers another's.
  endlessElsewhere(pages, address) {
    if (this.isEndlessAt(pages, address)) return false;
    for (const page of pages) {
      const entry = page && this.entries.get(this.key(page, address));
      if (entry && entry.seen > 0) return false;
    }
    return this.endlessAddresses().has(address);
  },
  endlessAddresses() {
    const now = Date.now();
    const index = this.endlessIndex;
    if (index && index.version === this.endlessVersion && now - index.at < 500) return index.addresses;
    const addresses = new Set();
    for (const [key, entry] of this.entries) if (entry.endless) addresses.add(key.slice(key.indexOf(' ') + 1));
    this.endlessIndex = { at: now, version: this.endlessVersion, addresses };
    return addresses;
  },
  markEndlessAt(pages, address) {
    for (const page of new Set(pages.filter(Boolean))) this.markEndless(page, address);
  },
  clearEndlessAt(pages, address) {
    for (const page of new Set(pages.filter(Boolean))) this.clearEndless(page, address);
  },
  isEndless(page, address) {
    const entry = this.entries.get(this.key(page, address));
    return !!entry && entry.endless;
  },
  markEndless(page, address) {
    const entry = this.entryOf(page, address);
    if (entry.endless) return;
    entry.endless = true;
    entry.endlessChanged = true;
    this.endlessVersion = (this.endlessVersion || 0) + 1;
    this.touched(page, entry);
    this.dirty += 1;
  },
  clearEndless(page, address) {
    const entry = this.entries.get(this.key(page, address));
    if (!entry || !entry.endless) return;
    entry.endless = false;
    entry.endlessChanged = true;
    this.endlessVersion = (this.endlessVersion || 0) + 1;
    this.touched(page, entry);
    this.dirty += 1;
  },
  save() {
    if (!this.file || !this.dirty) return;
    try {
      let saved = {};
      try {
        saved = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {};
      } catch (_) {}
      // another worker of the same run may have written meanwhile: both are kept, then the same forgetting
      const visits = new Map(Object.entries(saved.visits || {}).map(([page, count]) => [page, Number(count) || 0]));
      for (const [page, count] of this.visits) visits.set(page, Math.max(count, visits.get(page) || 0));
      const merged = saved.keys || {};
      for (const [key, entry] of this.entries) {
        const before = this.fromSaved(merged[key] || {}, entry.lastVisit);
        const together = {
          nothing: Math.max(before.nothing, entry.nothing),
          seen: Math.max(before.seen, entry.seen),
          regions: new Set([...before.regions, ...entry.regions]),
          regionSeen: new Map(before.regionSeen),
          sends: new Set([...before.sends, ...entry.sends]),
          exactFrom: Math.min(before.exactFrom || Infinity, entry.exactFrom || Infinity),
          hidden: new Set([...before.hidden, ...entry.hidden]),
          guesses: mergeGuesses(before.guesses, entry.guesses),
          looked: Math.max(before.looked || 0, entry.looked || 0),
          deep: Math.max(before.deep || 0, entry.deep || 0),
          clear: new Set([...before.clear, ...entry.clear]),
        };
        if (together.exactFrom === Infinity) together.exactFrom = 0;
        for (const [region, at] of entry.regionSeen) together.regionSeen.set(region, Math.max(at, together.regionSeen.get(region) || 0));
        this.forget(together);
        const regions = [...together.regions].slice(0, 40);
        merged[key] = { nothing: together.nothing, seen: together.seen, regions };
        if (together.exactFrom) merged[key].exact = together.exactFrom;
        if (together.hidden.size) merged[key].hidden = [...together.hidden].slice(0, 20);
        if (together.guesses.size) merged[key].guess = guessesToSave(together.guesses, together.hidden);
        if (together.looked) merged[key].looked = together.looked;
        if (together.deep) merged[key].deep = together.deep;
        const clear = [...together.clear].filter(name => !together.hidden.has(name)).slice(0, 20);
        if (clear.length) merged[key].clear = clear;
        if (regions.length) merged[key].regionSeen = Object.fromEntries(regions.map(region => [region, together.regionSeen.get(region) || together.seen]));
        if (together.sends.size) merged[key].sends = [...together.sends].slice(0, 10);
        // what this run saw last decides; otherwise what the file already says
        const endless = entry.endlessChanged ? entry.endless : before.endless;
        if (endless) merged[key].endless = true;
        const reads = Math.max(before.reads, entry.reads);
        if (reads) merged[key].reads = reads;
        merged[key].lastVisit = Math.max(before.lastVisit, entry.lastVisit);
        merged[key].lastAt = Math.max(before.lastAt, entry.lastAt || 0);
      }
      // forgotten: not seen in its page's last FORGET_VISITS visits; then, above MAX_ENTRIES, the ones seen longest ago
      const nowAt = Date.now();
      for (const [key, entry] of Object.entries(merged)) {
        const visitsNow = visits.get(pageOfKey(key)) || 0;
        if (entry.lastVisit === undefined) entry.lastVisit = visitsNow;
        if (!entry.lastAt) entry.lastAt = nowAt;
        if (visitsNow - entry.lastVisit > FORGET_VISITS) {
          delete merged[key];
          this.entries.delete(key);
        }
      }
      const keys = Object.keys(merged);
      if (keys.length > MAX_ENTRIES) {
        keys.sort((a, b) => merged[a].lastAt - merged[b].lastAt);
        for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) {
          delete merged[key];
          this.entries.delete(key);
        }
      }
      const backends = {};
      if (Number(saved.version) >= 3) for (const [appSite, sites] of Object.entries(saved.backends || {})) if (Array.isArray(sites)) backends[appSite] = new Set(sites.slice(0, 20));
      for (const [appSite, sites] of this.backends) backends[appSite] = new Set([...(backends[appSite] || []), ...sites]);
      const prints = saved.prints || {};
      for (const [page, print] of this.prints) if (print.changed || !prints[page]) prints[page] = { fp: print.fp, flips: print.flips };
      // the controls pressed on each page: this run's first, then the file's
      const watch = {};
      for (const [page, list] of Object.entries(saved.watch || {})) if (Array.isArray(list)) watch[page] = list.slice(0, 20);
      for (const [page, list] of this.watches) watch[page] = [...new Set([...list, ...(watch[page] || [])])].slice(0, 20);
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({
        version: 3,
        keys: merged,
        visits: Object.fromEntries([...visits].slice(-MAX_ENTRIES)),
        backends: Object.fromEntries(Object.entries(backends).map(([appSite, sites]) => [appSite, [...sites].slice(0, 20)])),
        prints,
        watch: Object.fromEntries(Object.entries(watch).slice(-MAX_ENTRIES)),
      }));
      fs.renameSync(temporary, this.file);
      this.dirty = 0;
    } catch (_) {}
  },
};

// A page's address as the memory keys it - the same as the page itself says (ids in the path as *, and an app's
// own #/route), so that the calls a page starts before the first look are filed under it.
function pagePathOf(url) {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return '';
    const part = text => (/^\d+$/.test(text) || /^[0-9a-f]{8,}$/i.test(text) || /^[0-9a-f-]{32,36}$/i.test(text) || (text.length > 24 && /\d/.test(text)) ? '*' : text);
    let pagePath = parsed.pathname.split('/').map(part).join('/');
    if (parsed.hash.startsWith('#/')) pagePath += parsed.hash.split('?')[0].split('/').map(part).join('/');
    return pagePath;
  } catch (_) {
    return '';
  }
}

// the page part of a memory key ("/orders GET https://..." -> "/orders")
// A request not to be waited for (any longer) because it never finishes: seen never finishing on this page - or on
// another page of the app and not finished within ENDLESS_ELSEWHERE_MS here (an answer that comes quickly here after
// all is still waited for, and then this page waits for it from now on)
const ENDLESS_ELSEWHERE_MS = 1500;
function neverFinishes(info, pages) {
  if (requestMap.isEndlessAt(pages, info.key)) return true;
  if (Date.now() - info.start < ENDLESS_ELSEWHERE_MS || !requestMap.endlessElsewhere(pages, info.key)) return false;
  // remembered for this page too (cleared, as anywhere, if it is seen finishing after all)
  requestMap.markEndlessAt(pages, info.key);
  return true;
}

function pageOfKey(key) {
  const space = String(key).indexOf(' ');
  return space > 0 ? key.slice(0, space) : '/';
}

// the guesses as saved: { element name: [at, failure, off, again] }
function guessesFromSaved(saved) {
  const guesses = new Map();
  if (!saved || typeof saved !== 'object') return guesses;
  for (const [name, record] of Object.entries(saved).slice(0, 20)) {
    if (!Array.isArray(record)) continue;
    guesses.set(name, { at: Number(record[0]) || 0, group: String(record[1] || ''), off: Number(record[2]) || 0, again: !!record[3] });
  }
  return guesses;
}
// another worker's file and this one's: per element name the latest word (a guess made, or a fact dropping it)
function mergeGuesses(a, b) {
  const merged = new Map(a);
  const latest = record => Math.max(record.at, record.off);
  for (const [name, record] of b) {
    const other = merged.get(name);
    if (!other || latest(record) > latest(other) || (latest(record) === latest(other) && record.off)) merged.set(name, record);
  }
  return merged;
}
// (a guess that became a fact is the fact now; the ones still guessed first, then the dropped ones - kept so that
// another worker's older copy does not bring them back)
function guessesToSave(guesses, hidden) {
  const list = [...guesses].filter(([name, record]) => !(record.off && hidden.has(name)));
  list.sort((x, y) => (!!x[1].off - !!y[1].off) || (Math.max(y[1].at, y[1].off) - Math.max(x[1].at, x[1].off)));
  return Object.fromEntries(list.slice(0, 20).map(([name, record]) => [name, [record.at, record.group, record.off, record.again ? 1 : 0]]));
}

// method + origin + path, with ids in the path as * (/order/123 and /order/456 are the same request)
function addressKey(method, url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').map(part => (/^\d+$/.test(part) || /^[0-9a-f]{8,}$/i.test(part) || /^[0-9a-f-]{32,36}$/i.test(part) || (part.length > 24 && /\d/.test(part)) ? '*' : part));
    return `${String(method || 'GET').toUpperCase()} ${parsed.origin}${parts.join('/')}`;
  } catch (_) {
    return `${String(method || 'GET').toUpperCase()} ${String(url).split('?')[0]}`;
  }
}

// The site an address belongs to - app.example.com and api.example.com are one site (example.com), and so are
// www.example.co.uk and api.example.co.uk. A page's own site is its backend; any other site (ads, analytics,
// video, error trackers, fonts) is somebody else's. Hosts without a dot and IP addresses are their own site.
const SECOND_LEVEL_LABELS = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gob', 'nic', 'mil']);
function siteOf(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (!host.includes('.') || host.includes(':') || /^[\d.]+$/.test(host)) return host;
    const labels = host.split('.');
    const last = labels.length - 1;
    const keep = labels.length > 2 && labels[last].length === 2 && SECOND_LEVEL_LABELS.has(labels[last - 1]) ? 3 : 2;
    return labels.slice(-keep).join('.');
  } catch (_) {
    return '';
  }
}

// a short fingerprint of a text (FNV-1a)
function hashText(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// Sites named by hand (comma-separated host names or sites): STABILITY_BACKEND_SITES are the app's own backend
// wherever they are, STABILITY_IGNORE_SITES are never waited for.
const sitesFromEnv = name => envText(name).split(',').map(text => text.trim()).filter(Boolean)
  .map(text => siteOf(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`)).filter(Boolean);
const NAMED_BACKENDS = new Set(sitesFromEnv('STABILITY_BACKEND_SITES'));
const NAMED_IGNORED = new Set(sitesFromEnv('STABILITY_IGNORE_SITES'));

// The app's own backend: the page's own site; another site the app's pages were seen using as their backend
// (called by the app's own code with the user's identity or past the browser's permission check, its answers read,
// and seen changing the page - remembered per app), or one named by hand; and, before that is known, a call the
// app's own code sends with a login header (the user's token). Ad networks and trackers send cookies and read
// their answers too, and a site's own code may call them (a player's ads, a proxied script) - but they carry no
// login header, and their answers (bids, analytics, video data) do not change the page.
function isAppSite(pageSite, url, info = null) {
  if (!pageSite) return true;
  const site = siteOf(url);
  if (NAMED_IGNORED.has(site)) return false;
  if (site === pageSite || NAMED_BACKENDS.has(site) || requestMap.isBackend(pageSite, site)) return true;
  return !!info && !info.fire && !!info.auth && !!info.from && siteOf(info.from) === pageSite;
}

// requests of another site that may be the app's backend (see absorb), until one of their answers changes the page
const backendCandidates = new Map();

// ---------------------------------------------------------------- what a control's own code uses
// An answer can matter to a button without changing anything on the screen: the app keeps it (the product picked,
// who may edit) and the button's code reads it when pressed. In a Chromium-based browser (Chrome, Edge, Chromium) the
// browser's debugger reads exactly what that code reads (hiddenPrint: its text says which names and what from each;
// each is read in the scope the code would find it in - a bundle's too) without pausing the page or calling any of
// its code - and so can tell when it saw all of it (complete). Firefox's and WebKit's debuggers cannot (they show no
// closure without pausing - checked against both), so there the look reads by name (namesLook): the names the
// button's code mentions, where the page's own top level has them (a page script's variables). Read for the controls
// the spec presses (in the learning run after a recording: every control on the page) after the app's answers arrive:
// when they changed, the answers whose code ran meanwhile are that control's hidden needs, remembered
// (requestMap.noteHidden) - and every browser waits for such an answer before pressing that control. Facts: what a
// look saw. A failure after a step went ahead without an answer adds a guess (explainFailure, requestMap.noteGuess),
// which a look's fact later confirms or drops. Both only ever add a wait: an answer seen nowhere still counts as "not
// seen yet". STABILITY_HIDDEN=off, or "hiddenNeeds": false in the project's "stability" settings, switches all of it
// off.
// whether the debugger can read closures in this process (the self-check in hiddenSession): null not checked yet
let hiddenWorks = null;
const HIDDEN_OFF = /^(0|false|off|no)$/i.test(envText('STABILITY_HIDDEN')) || SETTINGS.hiddenNeeds === false;
// the strict rule (see networkReasons): on with the hidden-needs look, STABILITY_STRICT=off for one run without it
const STRICT = !HIDDEN_OFF && !/^(0|false|off|no)$/i.test(envText('STABILITY_STRICT'));
// the learning run (LEARNING_SPEC set by the product) is a spec's first pass: which controls it presses is not known yet
const LEARNING = !!envText('LEARNING_SPEC');
// the debugger's handles of each look are kept apart (released together when that look is done - never another look's)
const HIDDEN_GROUP = 'pw-stability-hidden';
let hiddenGroups = 0;
const hiddenGroup = () => `${HIDDEN_GROUP}-${(hiddenGroups += 1)}`;
const HIDDEN_WATCHED_MAX = LEARNING ? 60 : 10;
const STRICT_WATCHED_MAX = 40;
const HIDDEN_VALUES_MAX = 160;
// a change is matched to the answers whose code ran before it - reported up to this long after (a redraw may wait)
const HIDDEN_MATCH_MS = 3000;
function hiddenOf(state) {
  if (!state.hidden) {
    // stats: what the looks cost on this page (said when it closes, with STABILITY_LOG=1)
    // mode: how this page's controls are read - 'debugger' (Chrome, Edge), 'names' (everywhere else), null not known yet
    const hidden = state.hidden = {
      off: HIDDEN_OFF, mode: null, cdp: null, starting: null, watched: new Map(), selectors: new Map(), changes: [], answers: [], acts: [], windows: [],
      timer: null, running: false, again: false, lastStart: 0, documents: -1, scanned: null, said: new Set(), failures: 0,
      stats: { looks: 0, ms: 0, prints: 0, links: 0, longest: 0 },
    };
    try {
      state.page.once('close', () => {
        const { stats } = hidden;
        if (VERBOSE && stats.looks) console.log(`[stability] hidden needs on ${state.pagePath}: ${stats.looks} looks, ${stats.prints} controls read, ${stats.ms} ms in all (longest ${stats.longest} ms), ${stats.links} new links`);
      });
    } catch (_) {}
  }
  return state.hidden;
}

// how this page's controls are read: 'debugger' (a Chromium-based browser whose debugger shows closures), 'names'
// (every other browser - and a Chromium whose debugger stopped showing them), null (off)
async function hiddenSession(state) {
  const hidden = hiddenOf(state);
  if (hidden.off || state.page.isClosed()) return null;
  if (hidden.mode) return hidden.mode;
  if (!hidden.starting) {
    hidden.starting = (async () => {
      try {
        const context = state.page.context();
        const browser = context.browser();
        if (browser && browser.browserType().name() !== 'chromium') return null;
        return await internal(context, () => context.newCDPSession(state.page));
      } catch (_) {
        return null;
      }
    })();
  }
  hidden.cdp = await hidden.starting;
  if (hidden.mode) return hidden.mode;
  if (!hidden.cdp) {
    hidden.mode = 'names';
    return hidden.mode;
  }
  // the self-check, once per process: can this browser's debugger still read what a function's closure holds? If
  // not (a newer browser or Playwright changed it), the look reads by name instead - said once
  if (hiddenWorks === null) {
    hiddenWorks = (async () => {
      const group = hiddenGroup();
      try {
        const print = await hiddenPrint(state, hidden.cdp, 'canary', group);
        return !!print && [...print.values()].some(value => value.includes('pw-stability-canary'));
      } catch (_) {
        return false;
      } finally {
        internal(hidden.cdp, () => hidden.cdp.send('Runtime.releaseObjectGroup', { objectGroup: group })).catch(() => {});
      }
    })();
    hiddenWorks.then(works => {
      if (!works) console.log("[stability] hidden needs: this browser's debugger no longer shows what a button's code holds - reading what the page keeps by name instead, as in Firefox and WebKit (buttons learned earlier stay protected)");
    });
  }
  const works = await hiddenWorks;
  if (!hidden.mode) hidden.mode = works ? 'debugger' : 'names';
  return hidden.mode;
}

// whether this page's look reads what a button's code holds through the debugger (Chrome, Edge) - not only by name
function seesClosures(state) {
  const hidden = hiddenOf(state);
  if (hidden.mode) return hidden.mode === 'debugger';
  try {
    const browser = state.page.context().browser();
    return !browser || browser.browserType().name() === 'chromium';
  } catch (_) {
    return true;
  }
}

// What the controls' code uses, read by name (mode 'names'), for several controls at once: id -> print (path ->
// value), with exact and unreached (see the tracker's namesLook) and complete (all that its code uses was read).
// Read inside Playwright's own evaluation: a page whose security policy forbids eval still allows it there.
async function namesLook(state, ids) {
  const frame = state.page.mainFrame();
  const result = await withTimeout(internal(frame, () => frame.evaluate(list => {
    const tracker = window[Symbol.for('pw-stability')];
    const read = name => {
      try {
        return { value: (0, eval)(name) };
      } catch (_) {
        return null;
      }
    };
    return tracker && tracker.namesLook ? tracker.namesLook(list, read) : null;
  }, ids)), 1500);
  const prints = new Map();
  if (!Array.isArray(result)) return prints;
  for (const item of result) {
    if (!item || !item.there || !Array.isArray(item.print)) continue;
    const print = new Map(item.print.map(([path, value]) => [`names|${path}`, value]));
    print.exact = !!item.exact;
    print.unreached = Array.isArray(item.unreached) ? item.unreached : ['?'];
    print.complete = print.exact && !print.unreached.length;
    prints.set(item.id, print);
  }
  return prints;
}

// The learning run watches every control from the page's start: a look that found the page not ready yet (the
// debugger not attached yet, no controls drawn yet) is tried again soon - a few times a visit - so that the app's
// first answers are watched arriving (what Chrome and Edge then know for sure, later runs need not wait to see)
function learningRetry(state) {
  if (!LEARNING) return;
  const hidden = hiddenOf(state);
  const visit = state.visit || '';
  if (hidden.retryVisit !== visit) {
    hidden.retryVisit = visit;
    hidden.retries = 0;
  }
  if (hidden.retries >= 20) return;
  hidden.retries += 1;
  hiddenSoon(state, 200);
}

// soon: after the app's answers, after a step, for a newly watched control (at most one look at a time)
function hiddenSoon(state, delay = 120) {
  const hidden = hiddenOf(state);
  if (hidden.off || hidden.timer || state.page.isClosed()) return;
  const wait = Math.max(delay, 150 - (Date.now() - hidden.lastStart));
  hidden.timer = setTimeout(() => {
    hidden.timer = null;
    hiddenLook(state).catch(() => {});
  }, wait);
  if (hidden.timer.unref) hidden.timer.unref();
}

function hiddenWatch(state, id, selector = '') {
  const hidden = hiddenOf(state);
  if (hidden.off || !id) return;
  if (!hidden.watched.has(id)) {
    if (hidden.watched.size >= (STRICT && hidden.mode === 'names' ? Math.max(HIDDEN_WATCHED_MAX, STRICT_WATCHED_MAX) : HIDDEN_WATCHED_MAX)) return;
    hidden.watched.set(id, { print: null, at: 0, noisy: new Set(), counts: new Map(), names: [], name: '' });
    hiddenSoon(state, 30);
  }
  if (selector) hidden.selectors.set(selector, id);
}

// the control a step presses: watched from now on here, and from the start of this page's later visits
function hiddenTarget(plan, target) {
  const { state } = plan;
  const hidden = hiddenOf(state);
  if (hidden.off || !target || !target.watchId || !plan.acts || plan.frame !== plan.page.mainFrame()) return;
  const selector = plan.locator && typeof plan.locator._selector === 'string' ? plan.locator._selector : '';
  hiddenWatch(state, target.watchId, selector);
  if (selector) requestMap.watch(state.pagePath, selector);
}

// a step is acting: what its own handlers change is its work, not an answer's
function hiddenActs(state) {
  const hidden = hiddenOf(state);
  if (hidden.off) return;
  hidden.acts.push(Date.now());
  if (hidden.acts.length > 50) hidden.acts.shift();
  hiddenSoon(state, 60);
}

// the app's answers taken in (their code ran from ran[0] to ran[1]), as the page reported them
function hiddenAnswers(state, deliveries) {
  const hidden = hiddenOf(state);
  if (hidden.off) return;
  const pageSite = siteOf(safeUrl(state.page));
  let any = false;
  for (const delivery of deliveries) {
    if (!Array.isArray(delivery.ran)) continue;
    // an ad's or a tracker's code does not write the app's own values: only the app's backend is matched
    if (!isAppSite(pageSite, delivery.key.split(' ')[1] || '')) continue;
    hidden.answers.push({ key: delivery.key, page: delivery.page, from: delivery.ran[0], to: delivery.ran[1], doc: state.documents });
    any = true;
  }
  if (hidden.answers.length > 200) hidden.answers.splice(0, hidden.answers.length - 200);
  if (any) {
    hiddenMatch(state);
    hiddenSoon(state);
  }
}

// a new document or a move to another page: its controls are looked up again
function hiddenVisit(state) {
  const hidden = hiddenOf(state);
  if (hidden.off) return;
  if (hidden.documents !== state.documents) {
    hidden.documents = state.documents;
    hidden.watched.clear();
    hidden.selectors.clear();
    // (a new document numbers its elements anew)
    hidden.windows = [];
    hidden.changes = [];
  }
  for (const selector of requestMap.watchedOn(state.pagePath)) if (!hidden.selectors.has(selector)) hidden.selectors.set(selector, 0);
  hiddenSoon(state, 60);
}

// Each change waits for the answers whose code ran in its window (between the look before and the look that saw it).
// It is credited only when that is beyond doubt: exactly one of the app's answers ran code in the window and no step
// acted in it (several answers, or a press, and which one changed it cannot be told - nothing is linked; the other
// checks still hold). A value that changes in more than one window of a visit is the page's own bookkeeping (a
// framework's render flags, a counter, a clock, a tracking id), not something an answer brought: never looked at again
// for that control. A change no answer's code and no step can explain is drift: the same.
// drained: the page's last report has just been taken in (every answer whose code ran is reported)
function hiddenMatch(state, drained = false) {
  const hidden = hiddenOf(state);
  const now = Date.now();
  for (const change of hidden.changes) {
    // decided once a later look has been taken (so a value changing again - bookkeeping - is known) and the window's
    // answers have been reported (a little after their code ran)
    // (until: the end of the reading of the look that saw it - an answer that ran while it read may be in it)
    const until = change.toEnd || change.to;
    if (change.settled || (!drained && now - until < 250) || hidden.lastStart <= change.to) continue;
    const stepActed = hidden.acts.some(at => at >= change.from && at <= until);
    if (stepActed) {
      change.settled = true;
      continue;
    }
    // Several answers' code ran in the window: an answer that ran again - all of its code, start to end - inside another
    // window of this control where these values did not change is not the one that changes them (a step in that window
    // or not: it did not change them either; the tail of this very answer spilling into the next window is not a run
    // again). Credited only when exactly one is left.
    const keys = answersIn(hidden, change.from, until);
    const watched = hidden.watched.get(change.id);
    const paths = change.paths.filter(item => !(watched && watched.noisy.has(item)));
    const left = keys.filter(key => !hidden.windows.some(window => window.id === change.id && window !== change.window
      && answersWithin(hidden, window.fromEnd || window.from, window.to).includes(key) && paths.every(item => !window.changed.has(item))));
    if (left.length !== 1 || !paths.length) {
      if (now - change.to >= HIDDEN_MATCH_MS) change.settled = true;
      continue;
    }
    change.settled = true;
    const ran = hidden.answers.filter(answer => answer.key === left[0] && answer.to >= change.from && answer.from <= until);
    for (const answer of ran) {
      if (change.credited.has(answer.key)) continue;
      change.credited.add(answer.key);
      change.paths = paths;
      const page = answer.page || state.pagePath;
      const text = shortKey(answer.key);
      if (requestMap.noteHidden(page, answer.key, change.names)) {
        hidden.stats.links += 1;
        const said = `${text}|${change.name}`;
        if (!hidden.said.has(said)) {
          hidden.said.add(said);
          console.log(`[stability] ${state.pagePath}: the answer to ${text} changes what ${change.name}'s code uses (${change.paths.slice(0, 3).map(item => item.split('|').pop()).join(', ')}) - waited for before pressing it`);
        }
      }
      // a fact settles the guesses about this control: this one's is a fact now, the others from that failure go
      const settled = requestMap.factFor(page, answer.key, change.names);
      if (settled.confirmed.length) console.log(`[stability] ${state.pagePath}: the guess from an earlier failure is a fact now - the answer to ${text} was seen changing what ${change.name}'s code uses`);
      for (const address of settled.dropped) console.log(`[stability] ${state.pagePath}: ${shortKey(address)} is no longer waited for before pressing ${change.name} - the earlier failure it was guessed from is explained by ${text}`);
    }
  }
  const kept = [];
  for (const change of hidden.changes) {
    if (now - change.to < HIDDEN_MATCH_MS) {
      kept.push(change);
      continue;
    }
    // nothing of the app's ran and no step acted, yet it changed: drift
    const stepActed = hidden.acts.some(at => at >= change.from - 50 && at <= (change.toEnd || change.to));
    const anyAnswer = hidden.answers.some(answer => answer.to >= change.from && answer.from <= (change.toEnd || change.to));
    if (!change.credited.size && !stepActed && !anyAnswer) {
      const watched = hidden.watched.get(change.id);
      if (watched) for (const item of change.paths) watched.noisy.add(item);
    }
  }
  hidden.changes = kept;
}

// The test is over (its context closing): what the looks saw and is not decided yet is decided now, before the memory
// is written - not left to a timer the worker may not wait for. drained: the page's last report has just been taken in;
// a later look is still needed, taken once if the last look saw a change (capped, as before a step).
async function hiddenFinish(state, drained) {
  const hidden = state.hidden;
  if (!hidden || hidden.off) return;
  const open = () => hidden.changes.filter(change => !change.settled);
  if (!open().length) {
    hiddenRefute(state, drained);
    return;
  }
  if (open().some(change => hidden.lastStart <= change.to) && !state.page.isClosed()) {
    if (hidden.running && hidden.current) await withTimeout(hidden.current.catch(() => {}), 150);
    if (hidden.timer) {
      clearTimeout(hidden.timer);
      hidden.timer = null;
    }
    if (!hidden.running) await withTimeout(hiddenLook(state).catch(() => {}), 300);
  }
  hiddenMatch(state, drained);
  hiddenRefute(state, drained);
}

// Facts over guesses: a window between two looks at a control that both saw all that its code uses (complete), with
// no step in it and nothing at all different (quiet), in which an answer's code ran start to end - that answer's first
// on this document: it is not what the control needs, and a guess saying so is dropped. Decided once the window's
// answers have been reported (as for a change), or when the page's last report is in (drained).
function hiddenRefute(state, drained = false) {
  const hidden = hiddenOf(state);
  const now = Date.now();
  if (STRICT && hidden.mode === 'debugger') {
    for (const window of hidden.windows) {
      if (window.deepChecked || (!drained && now - window.to < 250)) continue;
      window.deepChecked = true;
      for (const answer of hidden.answers) {
        if (answer.doc === state.documents && answer.from >= (window.fromEnd || window.from) && answer.to <= window.to) requestMap.noteDeep(answer.page || state.pagePath, answer.key);
      }
    }
  }
  for (const window of hidden.windows) {
    if (window.refuteChecked || !window.complete) continue;
    if (!drained && now - window.to < 250) continue;
    window.refuteChecked = true;
    if (window.step || !window.quiet) continue;
    for (const answer of hidden.answers) {
      // (all of its code after the last look's reading was over and before this look began reading)
      if (answer.doc !== state.documents || answer.from < (window.fromEnd || window.from) || answer.to > window.to) continue;
      if (hidden.answers.find(other => other.key === answer.key && other.doc === answer.doc) !== answer) continue;
      if (STRICT) requestMap.noteClear(answer.page || state.pagePath, answer.key, window.names);
      if (!requestMap.refuteGuess(answer.page || state.pagePath, answer.key, window.names)) continue;
      const watched = hidden.watched.get(window.id);
      console.log(`[stability] ${state.pagePath}: a look at all that ${(watched && watched.name) || 'the control'}'s code uses shows the answer to ${shortKey(answer.key)} changes none of it - no longer waited for before pressing it (it was a guess from an earlier failure)`);
    }
  }
}

// a request's key as said: method and path (the site left out)
function shortKey(key) {
  const space = String(key).indexOf(' ');
  return space > 0 ? `${key.slice(0, space)} ${key.slice(space + 1).replace(/^https?:\/\/[^/]+/, '')}` : String(key);
}

// the app's answers whose code ran between two looks (some of it), and those whose code ran there start to end
function answersIn(hidden, from, to) {
  return [...new Set(hidden.answers.filter(answer => answer.to >= from && answer.from <= to).map(answer => answer.key))];
}
function answersWithin(hidden, from, to) {
  return [...new Set(hidden.answers.filter(answer => answer.from >= from && answer.to <= to).map(answer => answer.key))];
}

// just before a step acts: one look (capped), so that what the answers changed meanwhile is told apart from what the
// step's own handlers change next (past the cap the step goes on; the look finishes by itself)
async function hiddenBeforeAct(state) {
  const hidden = hiddenOf(state);
  if (hidden.off || !hidden.mode || !hidden.watched.size) return;
  // none of the app's answers ran since the last look began, and no request finished since (a finished one's answer is
  // reported by the page a moment later, when its window closes): a look now would tell nothing apart - not taken
  const finishedSince = (state.lastAnyFinish || 0) >= hidden.lastStart;
  if (hidden.lastStart && !hidden.running && !finishedSince && !hidden.answers.some(answer => answer.to >= hidden.lastStart)) return;
  const started = Date.now();
  if (hidden.running && hidden.current) await withTimeout(hidden.current.catch(() => {}), 150);
  if (hidden.timer) {
    clearTimeout(hidden.timer);
    hidden.timer = null;
  }
  const left = 250 - (Date.now() - started);
  if (left > 20 && !hidden.running) await withTimeout(hiddenLook(state).catch(() => {}), left);
}

// What one control's own code reads, through the debugger (Chrome, Edge), as path -> value. The code of its press
// handlers - and of the helpers they call, two levels down - as text (the scanner, makeCodeNames) gives the names it
// uses and what it reads from each (state.cart.items); each name is found where the code itself would find it, the
// nearest of its scopes that has it (a component's, a module's, a whole bundle's - only the names the code uses are
// read there), and what it reads is read, read only: an accessor is never run (it is left out, and the look has then
// not seen everything). A name in none of its scopes is the page's top level: listed in globals, read by name. With
// it: truncated (something it reads was not read in full - too deep, too many, an accessor, a key only the running
// code knows, code the scanner cannot be sure of, more handlers or helpers than are followed).
const nodeCodeNames = makeCodeNames(new Set());
const HIDDEN_HELPER_DEPTH = 2;
async function hiddenPrint(state, cdp, id, group) {
  const send = (method, params) => internal(cdp, () => cdp.send(method, params));
  const print = new Map();
  const look = { budget: HIDDEN_VALUES_MAX, truncated: false, globals: new Set() };
  // id 'canary': the checks' own known function (the self-check)
  const pick = id === 'canary' ? 'tracker.canary()' : `tracker.handlersById(${Number(id)})`;
  const evaluated = await send('Runtime.evaluate', {
    expression: `(() => { const tracker = window[Symbol.for('pw-stability')]; return tracker && tracker.handlersById ? ${pick} : []; })()`,
    objectGroup: group, silent: true, returnByValue: false,
  });
  if (!evaluated || !evaluated.result || !evaluated.result.objectId) return null;
  const list = await send('Runtime.getProperties', { objectId: evaluated.result.objectId, ownProperties: true });
  const all = (list.result || []).filter(item => /^\d+$/.test(item.name) && item.value && item.value.type === 'function');
  const functions = all.slice(0, 4);
  if (all.length > functions.length) look.truncated = true;
  // a value as text, two levels down from where the code reads it (own data fields only)
  const fingerprint = async (path, value, depth) => {
    if (look.budget <= 0) {
      look.truncated = true;
      return;
    }
    if (!value || value.type === 'function') return;
    const { type, subtype } = value;
    if (type !== 'object') {
      look.budget -= 1;
      print.set(path, `${type}:${String(value.value !== undefined ? value.value : value.unserializableValue || value.description || '').slice(0, 80)}`);
      return;
    }
    if (subtype === 'null') {
      look.budget -= 1;
      print.set(path, 'null');
      return;
    }
    // the page's own elements are seen on the screen; windows, documents and events are not the app's values
    if (subtype === 'node' || /^(Window|HTMLDocument|Document|.*Event|CSSStyleDeclaration|Location|Navigator)$/.test(value.className || '')) return;
    look.budget -= 1;
    print.set(path, `${value.className || subtype || 'object'}:${String(value.description || '').slice(0, 40)}`);
    if (subtype === 'regexp' || subtype === 'date') return;
    if (['map', 'set', 'weakmap', 'weakset', 'promise', 'error', 'iterator', 'generator', 'typedarray', 'arraybuffer', 'dataview', 'wasmvalue'].includes(subtype)) {
      if (!/\(0\)$/.test(String(value.description || ''))) look.truncated = true;
      return;
    }
    if (!value.objectId) return;
    if (depth >= 2) {
      look.truncated = true;
      return;
    }
    const props = await send('Runtime.getProperties', { objectId: value.objectId, ownProperties: true });
    if (subtype === 'proxy') {
      const target = (props.internalProperties || []).find(item => item.name === '[[Target]]');
      if (target) await fingerprint(`${path}>`, target.value, depth);
      return;
    }
    const own = (props.result || []).filter(item => item.isOwn !== false && item.name !== '__proto__' && !(subtype === 'array' && item.name === 'length'));
    const items = own.filter(item => item.value && !item.get && !item.set);
    const limit = subtype === 'array' ? 10 : 30;
    if (items.length < own.length || items.length > limit) look.truncated = true;
    for (const item of items.slice(0, limit)) await fingerprint(`${path}.${item.name}`, item.value, depth + 1);
  };
  // one property of an object, read only: its value - not an accessor's (that would run the page's code)
  const property = async (object, name) => {
    if (!object || !object.objectId) return null;
    const props = await send('Runtime.getProperties', { objectId: object.objectId, ownProperties: false });
    const found = (props.result || []).find(item => item.name === name);
    if (!found) return { value: { type: 'undefined' } };
    if (found.get || found.set || !found.value) {
      look.truncated = true;
      return null;
    }
    return { value: found.value };
  };
  const followFunction = async (fn, label, depth) => {
    if (!fn || !fn.objectId) return;
    const internals = (await send('Runtime.getProperties', { objectId: fn.objectId, ownProperties: false })).internalProperties || [];
    // a bound handler (onClick={this.save} in a class component): its target's code, and what it is bound to
    const bound = internals.find(item => item.name === '[[BoundThis]]');
    if (bound) await fingerprint(`${label}|this`, bound.value, 0);
    const target = internals.find(item => item.name === '[[TargetFunction]]');
    if (target && target.value) return followFunction(target.value, label, depth);
    // its code as text, from the page's tracker (the toString taken at the page's start)
    const got = await send('Runtime.callFunctionOn', {
      objectId: fn.objectId, returnByValue: true, silent: true,
      functionDeclaration: 'function () { const tracker = window[Symbol.for(\'pw-stability\')]; return tracker && tracker.sourceOf ? tracker.sourceOf(this) : \'\'; }',
    });
    const text = got && got.result && typeof got.result.value === 'string' ? got.result.value : '';
    if (!text) {
      look.truncated = true;
      return;
    }
    const code = nodeCodeNames(text);
    if (code.ambiguous || code.names.length > 30) look.truncated = true;
    const scopes = internals.find(item => item.name === '[[Scopes]]');
    if (!scopes || !scopes.value || !scopes.value.objectId) {
      look.truncated = true;
      return;
    }
    const scopeList = ((await send('Runtime.getProperties', { objectId: scopes.value.objectId, ownProperties: true })).result || [])
      .filter(item => /^\d+$/.test(item.name) && item.value && !/^Global/.test(item.value.description || ''));
    // what a helper sets itself (a framework's render counter, a scheduler's lanes: renders += 1) is its own
    // bookkeeping, not something the press needs - read only what the press's own code sets
    const own = new Set(depth > 0 ? code.written : []);
    // each name where the code would find it: the nearest scope that has it (looked through only as far as needed)
    const wanted = new Set(code.names.filter(name => !own.has(name)).slice(0, 30));
    const bindings = new Map();
    for (const scope of scopeList) {
      if (!wanted.size) break;
      const variables = (await send('Runtime.getProperties', { objectId: scope.value.objectId, ownProperties: true })).result || [];
      const scopeName = String(scope.value.description || 'scope').replace(/\s+/g, ' ').slice(0, 40);
      for (const variable of variables) {
        if (!wanted.has(variable.name)) continue;
        wanted.delete(variable.name);
        bindings.set(variable.name, { value: variable.value, scopeName });
      }
    }
    for (const name of wanted) look.globals.add(name);
    const done = new Set();
    for (const read of code.reads) {
      const binding = own.has(read.name) ? null : bindings.get(read.name);
      if (!binding) continue;
      const key = `${read.name}.${read.path.join('.')}${read.call ? '()' : ''}`;
      if (done.has(key)) continue;
      done.add(key);
      // what the code reads from it, step by step (a method's code is followed when it calls one)
      let value = binding.value;
      const path = [read.name];
      let reached = true;
      for (const step of read.path) {
        if (!value || value.type !== 'object' || !value.objectId) break;
        const next = await property(value, step);
        if (!next) {
          reached = false;
          break;
        }
        value = next.value;
        path.push(step);
      }
      if (!reached) continue;
      if (read.computed) look.truncated = true;
      const at = `${label}|${binding.scopeName}|${path.join('.')}`;
      // only written into (a.b = x): which object it is, not what it holds
      if (read.base) {
        if (value && value.type === 'object' && value.subtype !== 'node' && value.subtype !== 'null') print.set(at, `${value.className || 'object'}:${String(value.description || '').slice(0, 40)}`);
        continue;
      }
      if (value && value.type === 'function') {
        if (!read.call) continue;
        if (depth < HIDDEN_HELPER_DEPTH) await followFunction(value, `${label}>${path.join('.')}`, depth + 1);
        else look.truncated = true;
        continue;
      }
      await fingerprint(at, value, 0);
    }
  };
  for (const [index, fn] of functions.entries()) await followFunction(fn.value, `h${index}`, 0);
  print.truncated = look.truncated;
  print.globals = [...look.globals];
  return print;
}

// names the debugger's look found in none of a control's code's scopes, read where the page's top level has them (by
// name), for several controls at once
async function topNames(state, lists) {
  const frame = state.page.mainFrame();
  const result = await withTimeout(internal(frame, () => frame.evaluate(all => {
    const tracker = window[Symbol.for('pw-stability')];
    const read = name => {
      try {
        return { value: (0, eval)(name) };
      } catch (_) {
        return null;
      }
    };
    return tracker && tracker.readNames ? all.map(list => tracker.readNames(list, read)) : null;
  }, lists)), 1500);
  return Array.isArray(result) ? result : null;
}

// one look at a time per page; current: the look going on (the look before a step waits for it)
function hiddenLook(state) {
  const hidden = hiddenOf(state);
  if (hidden.off || state.page.isClosed()) return Promise.resolve();
  if (hidden.running) {
    hidden.again = true;
    return hidden.current || Promise.resolve();
  }
  hidden.current = hiddenLookRun(state);
  return hidden.current;
}

async function hiddenLookRun(state) {
  const hidden = hiddenOf(state);
  if (hidden.off || state.page.isClosed()) return;
  const group = hiddenGroup();
  if (hidden.running) {
    hidden.again = true;
    return;
  }
  hidden.running = true;
  let mode = null;
  try {
    mode = await hiddenSession(state);
    if (!mode) {
      learningRetry(state);
      return;
    }
    const frame = state.page.mainFrame();
    // the controls the spec pressed on this page before, found again (once there and only one match)
    for (const [selector, id] of hidden.selectors) {
      if (id && hidden.watched.has(id)) continue;
      const found = await withTimeout(internal(frame, () => frame.locator(selector).evaluateAll(elements => {
        const tracker = window[Symbol.for('pw-stability')];
        return elements.length === 1 && tracker ? tracker.idOf(elements[0]) : 0;
      })), 800).catch(() => 0);
      if (found && found !== TIMED_OUT) hiddenWatch(state, found, selector);
    }
    // the learning run: every control on the page, once per visit (strict, reading by name: at every look)
    const everyControl = STRICT && mode === 'names';
    if ((LEARNING && hidden.scanned !== state.visit) || everyControl) {
      hidden.scanned = state.visit;
      const ids = await withTimeout(internal(frame, () => frame.evaluate(limit => {
        const tracker = window[Symbol.for('pw-stability')];
        return tracker && tracker.pressables ? tracker.pressables(limit) : [];
      }, everyControl ? STRICT_WATCHED_MAX : HIDDEN_WATCHED_MAX)), 1500).catch(() => []);
      if (Array.isArray(ids)) for (const id of ids) hiddenWatch(state, id);
      // (none found - the page's controls not drawn yet: scanned again at the next look)
      if (!Array.isArray(ids) || !ids.length) hidden.scanned = null;
    }
    const ids = [...hidden.watched.keys()];
    if (!ids.length) {
      learningRetry(state);
      return;
    }
    const started = Date.now();
    hidden.lastStart = started;
    const infos = await withTimeout(internal(frame, () => frame.evaluate(list => {
      const tracker = window[Symbol.for('pw-stability')];
      return tracker && tracker.watchInfo ? tracker.watchInfo(list) : null;
    }, ids)), 1500);
    if (!Array.isArray(infos)) return;
    // read by name (every control at once), or through the debugger - each print saying which names it found in none
    // of the code's scopes, read by name next (all controls at once); complete: all that its code reads was read
    const pressable = infos.filter(info => info && info.there && info.handlers && hidden.watched.has(info.id));
    const named = mode === 'names' && pressable.length ? await namesLook(state, pressable.map(info => info.id)).catch(() => new Map()) : new Map();
    const prints = new Map();
    if (mode === 'debugger') {
      for (const info of pressable) {
        const print = await hiddenPrint(state, hidden.cdp, info.id, group).catch(() => null);
        if (print) prints.set(info.id, print);
      }
      const needing = [...prints].filter(([, print]) => print.globals.length);
      const tops = needing.length ? await topNames(state, needing.map(([, print]) => print.globals)).catch(() => null) : null;
      for (const [id, print] of prints) {
        const index = needing.findIndex(([other]) => other === id);
        const extra = index < 0 ? { print: [], unreached: [], exact: true } : tops && tops[index];
        if (!extra) {
          print.complete = false;
          continue;
        }
        for (const [item, value] of extra.print) print.set(`names|${item}`, value);
        print.complete = !print.truncated && extra.exact && !extra.unreached.length;
      }
    }
    // this look read its values between started and now: an answer whose code ran in between may be in them or not -
    // a change is weighed against every answer that ran until now, and a window shows an answer changed nothing only
    // when it ran after the last look's reading was over and before this one's began (readAt: when it was over)
    const readAt = Date.now();
    for (const info of infos) {
      const watched = hidden.watched.get(info.id);
      if (!watched) continue;
      if (!info.there) {
        hidden.watched.delete(info.id);
        continue;
      }
      watched.name = info.name;
      watched.names = info.names || [];
      if (!info.handlers) continue;
      const print = (mode === 'names' ? named.get(info.id) : prints.get(info.id)) || null;
      if (!print) continue;
      hidden.stats.prints += 1;
      if (watched.print) {
        const changed = [];
        for (const [item, value] of print) if (watched.print.has(item) && watched.print.get(item) !== value && !watched.noisy.has(item)) changed.push(item);
        const stepActed = hidden.acts.some(at => at >= watched.at && at <= readAt);
        // every window of this control, with what changed in it (also nothing): what tells the answers apart - and
        // whether both looks saw all that its code uses
        // (quiet: nothing at all differs - a value the busy rule ignores, one that appeared or went, counts too)
        const quiet = print.size === watched.print.size && [...print].every(([item, value]) => watched.print.has(item) && watched.print.get(item) === value);
        const window = { id: info.id, from: watched.at, to: started, fromEnd: watched.readAt || watched.at, toEnd: readAt, changed: new Set(changed), step: stepActed, complete: !!(watched.print.complete && print.complete), quiet, names: watched.names };
        hidden.windows.push(window);
        if (hidden.windows.length > 300) hidden.windows.shift();
        if (changed.length) {
          // a value changing in more than one window with no step in it is the page's bookkeeping (render flags, counters,
          // clocks, tracking ids): not looked at again (a value a step resets and its answer fills changes in one such window)
          if (!stepActed) {
            for (const item of changed) {
              const times = (watched.counts.get(item) || 0) + 1;
              watched.counts.set(item, times);
              if (times >= 2) watched.noisy.add(item);
            }
          }
          hidden.changes.push({ id: info.id, from: watched.at, to: started, toEnd: readAt, paths: changed, names: watched.names, name: watched.name, credited: new Set(), window });
        }
      }
      watched.print = print;
      watched.at = started;
      watched.readAt = readAt;
    }
    hidden.failures = 0;
    hiddenMatch(state);
    hiddenRefute(state);
    // the changes just seen are decided a moment later - also when the page has closed by then (the decision needs only
    // what was recorded here)
    if (hidden.changes.some(change => !change.settled) || hidden.windows.some(window => window.complete && !window.refuteChecked)) {
      const later = setTimeout(() => {
        try {
          hiddenMatch(state);
          hiddenRefute(state);
        } catch (_) {}
      }, 400);
      if (later.unref) later.unref();
    }
    const took = Date.now() - started;
    hidden.stats.looks += 1;
    hidden.stats.ms += took;
    hidden.stats.longest = Math.max(hidden.stats.longest, took);
  } catch (_) {
    // the browser said no too often: no more looks on this page
    hidden.failures += 1;
    if (hidden.failures >= 5) hidden.off = true;
  } finally {
    hidden.running = false;
    const { cdp } = hidden;
    if (mode === 'debugger' && cdp) internal(cdp, () => cdp.send('Runtime.releaseObjectGroup', { objectGroup: group })).catch(() => {});
    if (hidden.again) {
      hidden.again = false;
      hiddenSoon(state);
    }
  }
}

// ---------------------------------------------------------------- per context / page

async function prepareContext(context) {
  boxThisFile();
  await internal(context, () => context.addInitScript({ content: TRACKER_SOURCE }));
  const stateOf = request => {
    try {
      const frame = request.frame();
      const page = frame && frame.page();
      return page ? pageState(page) : null;
    } catch (_) {
      return null;
    }
  };
  context.on('request', request => {
    const state = stateOf(request);
    if (!state) return;
    const url = request.url();
    const now = Date.now();
    if (!/^https?:/i.test(url)) return;
    const type = request.resourceType();
    const key = addressKey(request.method(), url);
    // page: where it was sent from - what is remembered about it (never finishing) belongs to that page
    const info = { start: now, type, key, label: requestLabel(request), method: request.method(), cause: 0, matched: false, entry: null, page: state.pagePath };
    // until the page says which step sent it: the step whose work was going on, if any
    const step = state.step;
    if (step && now <= step.reactUntil) info.cause = step.id;
    else if (!state.anyStep) info.cause = LOAD_CAUSE;
    const waiting = state.unmatchedSends.findIndex(send => send.key === key);
    if (waiting >= 0) {
      info.cause = state.unmatchedSends[waiting].cause;
      info.fire = !!state.unmatchedSends[waiting].fire;
      info.identity = !!state.unmatchedSends[waiting].identity;
      info.auth = !!state.unmatchedSends[waiting].auth;
      info.nonSimple = !!state.unmatchedSends[waiting].nonSimple;
      info.abortable = !!state.unmatchedSends[waiting].abortable;
      info.from = state.unmatchedSends[waiting].from || '';
      info.matched = true;
      state.unmatchedSends.splice(waiting, 1);
    }
    if (type === 'fetch' || type === 'xhr' || type === 'document') {
      info.entry = { label: info.label, method: info.method, type, status: 0, error: '', said: '', request };
      if (type === 'document' && request.frame() === state.page.mainFrame()) info.document = true;
      attach(state, info);
    }
    if (type === 'eventsource') {
      const sseKey = addressKey('SSE', url);
      if (!requestMap.isEndless(state.pagePath, `${sseKey} silent`) && !state.liveFirst.has(sseKey)) {
        const handle = liveRequest(state, sseKey, `events ${requestLabel(request).replace(/^\S+ /, '')} (opening)`, 'first');
        const timer = setTimeout(() => {
          state.liveFirst.delete(sseKey);
          liveFinished(state, handle, false);
        }, LIVE_FIRST_MS);
        if (timer.unref) timer.unref();
        state.liveFirst.set(sseKey, { handle, timer });
      }
    }
    if (SKIPPED_REQUEST_TYPES.has(type)) return;
    noteRhythm(state, key, now);
    state.requests.set(request, info);
    state.byRequest.set(request, info);
  });
  context.on('response', response => {
    const request = response.request();
    const state = stateOf(request);
    if (!state) return;
    const info = state.byRequest.get(request);
    if (info) info.responseAt = Date.now();
    // the tab's page load answered (not a redirect): its document comes next
    if (info && info.document && (response.status() < 300 || response.status() >= 400)) state.lastDocumentAnswer = info;
    if (info && info.entry) info.entry.status = response.status();
    if (response.status() >= 500) remember(state, `${requestLabel(request)} answered ${response.status()}`);
  });
  const finished = request => {
    const state = stateOf(request);
    if (!state) return null;
    const info = state.byRequest.get(request);
    state.requests.delete(request);
    // cancelled with the page it belonged to: no answer for anybody, nothing to learn
    if (info && info.orphaned) return null;
    if (info) {
      info.endedAt = Date.now();
      // a fast answer can be over before the page says whose request it was: still put right then
      if (!info.matched) {
        state.finishedUnmatched.push(info);
        if (state.finishedUnmatched.length > 50) state.finishedUnmatched.shift();
      }
      if (DATA_TYPES.has(info.type) && !requestMap.changesNothing(state.pagePath, info.key)) state.lastFinish.set(info.key, { at: info.endedAt, info });
      // (any of them: the look before a press is not skipped while an answer's report may still be coming)
      if (DATA_TYPES.has(info.type)) state.lastAnyFinish = info.endedAt;
      // (the last answers: which one reset a value an earlier step set is told from them - noteResetBy)
      if (DATA_TYPES.has(info.type) && !info.document) {
        state.recentAnswers.push({ key: info.key, page: info.page || state.pagePath, at: info.endedAt });
        if (state.recentAnswers.length > 50) state.recentAnswers.shift();
      }
      const rhythm = state.rhythm.get(info.key);
      if (rhythm) {
        rhythm.lastEnd = info.endedAt;
        rhythm.lastLasted = rhythm.lastEnd - info.start;
      }
      const step = info.cause > 0 ? state.steps.get(info.cause) : null;
      if (step) step.lastCausedAt = info.endedAt;
    }
    return state;
  };
  context.on('requestfinished', request => {
    const state = finished(request);
    const info = state && state.byRequest.get(request);
    // it did finish: it was only slow, and is waited for again
    if (info) requestMap.clearEndlessAt([info.page, state.pagePath], info.key);
    // what its answer changed: looked at once the answer has been used - every time, not only while it is new (an
    // app's new release can make a known answer change another part of the page; a test's last step leaves no
    // later look to catch it)
    if (info && (info.type === 'fetch' || info.type === 'xhr') && !info.fire) {
      try {
        learnSoon(state, request.frame());
      } catch (_) {}
    }
    const step = info && info.cause > 0 ? state.steps.get(info.cause) : null;
    if (step && info.entry && (info.type === 'fetch' || info.type === 'xhr') && !READ_METHODS.has(info.method)) {
      const reading = internal(request, () => readErrorBody(request)).then(said => { if (said) info.entry.said = said; }, () => {});
      step.reading.push(reading);
      reading.then(() => lateVerdict(state, info));
    } else lateVerdict(state, info);
  });
  context.on('requestfailed', request => {
    const state = finished(request);
    if (!state) return;
    const failure = request.failure();
    const text = (failure && failure.errorText) || '';
    const info = state.byRequest.get(request);
    if (info && info.entry) info.entry.error = text || 'failed';
    if (text && !ABORTED_REQUEST.test(text)) remember(state, `${requestLabel(request)} failed (${text})`);
    lateVerdict(state, info);
  });
  const preparePage = page => {
    const state = pageState(page);
    if (!wrapped) {
      wrapped = true;
      try {
        wrapClasses(page);
      } catch (error) {
        console.log(`[stability] not active: ${firstLine(error)}`);
      }
    }
    page.on('framenavigated', frame => {
      if (frame !== page.mainFrame()) return;
      const previousCommit = state.lastCommitAt;
      state.lastCommitAt = Date.now();
      // the page's address at once (the calls it starts before the first look are its own, not the last page's)
      const pagePath = pagePathOf(frame.url());
      if (pagePath) state.pagePath = pagePath;
      // A new document arrived (a page load answered since the last one - not an address change inside the
      // page): what the old document still had on its way died with it - the browser cancels it, though it does
      // not always say so (Amazon's old page left calls "loading" for ever). Waiting for them is waiting for
      // nobody; and they are not remembered as never finishing. Decided by what the browser must do in order, not
      // by when this event comes (Firefox sends it late, after the new page's first calls): a call a script sends
      // (fetch, XHR) can only be the new page's once the new page's answer has arrived - its scripts cannot run
      // before; anything else only once the new page was asked for.
      const newPage = state.lastDocumentAnswer;
      if (newPage && newPage.responseAt > previousCommit) {
        // a new document: its own visit, and its own judgement of whether the app was rebuilt
        state.documents += 1;
        state.unconfirmed = false;
        for (const [request, info] of state.requests) {
          if (info.document) continue;
          const sentByScript = info.type === 'fetch' || info.type === 'xhr';
          if (info.start >= (sentByScript ? newPage.responseAt : newPage.start)) {
            // the new page's own (it may have started before this event: Firefox sends it late) - filed under it
            if (pagePath) info.page = pagePath;
            continue;
          }
          info.orphaned = true;
          state.requests.delete(request);
        }
        state.unmatchedSends = state.unmatchedSends.filter(send => send.at >= newPage.start);
      }
      if (state.step) state.step.navigated = true;
      // a new document: its own start comes first, the values typed on the old one are gone
      state.inputs = [];
    });

    page.on('websocket', ws => {
      try {
        liveSocket(state, ws);
      } catch (_) {}
    });    // the looks at what controls' code uses begin as the document is ready - not only at the spec's first step
    page.on('domcontentloaded', () => {
      try {
        if (!page.isClosed()) hiddenVisit(state);
      } catch (_) {}
    });
    page.on('popup', () => { if (state.step) state.step.popup = true; });
    page.on('download', () => { if (state.step) state.step.download = true; });
    page.on('dialog', () => { if (state.step) state.step.dialog = true; });
    page.on('close', () => {
      state.requests.clear();
      // a page the test closes itself: what its looks saw and can be decided is decided before the memory is written
      if (state.hidden) {
        try {
          hiddenMatch(state);
        } catch (_) {}
      }
      requestMap.save();
    });
  };
  context.on('page', preparePage);
  for (const page of context.pages()) preparePage(page);
}

function pageState(page) {
  let state = pageStates.get(page);
  if (!state) {
    state = {
      page, requests: new Map(), byRequest: new WeakMap(), rhythm: new Map(), lastFinish: new Map(), unmatchedSends: [], finishedUnmatched: [], recentAnswers: [],
      problems: [], reported: new Set(), noise: new Set(), quietMs: 100, inputs: [], step: null, steps: new Map(), anyStep: false, lastClick: null,
      pagePath: '/', learning: null, lastCommitAt: 0, lastDocumentAnswer: null,
      documents: 0, visit: '', unconfirmed: false, recentSkips: [], liveFirst: new Map(),
    };
    pageStates.set(page, state);
  }
  return state;
}

// a request a step caused belongs to that step (its backend verdict, its follow-through)
// A live connection's answers waited for as requests of their own (WebSocket - Phoenix LiveView, Blazor Server,
// Meteor, SignalR, Socket.IO, ActionCable; Server-Sent Events): its first message after it opens (LIVE_FIRST_MS at
// most), and the reply to each message the page sends on it (LIVE_REPLY_MS at most) - by the same rules as any of the
// app's calls (what they change, what a control's code uses; the page says which step's code sent a message). One
// that stays silent, or whose messages get no reply, is remembered so, and not waited for on later visits (until it
// is seen answering again).
const LIVE_FIRST_MS = 2000;
const LIVE_REPLY_MS = 3000;
function liveRequest(state, key, label, kind) {
  const now = Date.now();
  const handle = { live: kind };
  const info = { start: now, type: 'fetch', key, label, method: key.split(' ')[0], cause: 0, matched: false, entry: null, page: state.pagePath, live: kind };
  const step = state.step;
  if (step && now <= step.reactUntil) info.cause = step.id;
  else if (!state.anyStep) info.cause = LOAD_CAUSE;
  // the page's own word on which step's code sent it, when it came first
  const waiting = kind === 'reply' ? state.unmatchedSends.findIndex(send => send.key === key) : -1;
  if (waiting >= 0) {
    info.cause = state.unmatchedSends[waiting].cause;
    info.matched = true;
    state.unmatchedSends.splice(waiting, 1);
  } else if (kind !== 'reply') {
    info.matched = true;
  }
  state.requests.set(handle, info);
  state.byRequest.set(handle, info);
  return handle;
}
function liveFinished(state, handle, answered) {
  const info = state.byRequest.get(handle);
  state.requests.delete(handle);
  if (!info || info.orphaned) return;
  info.endedAt = Date.now();
  if (!info.matched) {
    state.finishedUnmatched.push(info);
    if (state.finishedUnmatched.length > 50) state.finishedUnmatched.shift();
  }
  // silent: remembered (a key of its own), so later visits do not wait for it; answering again clears that
  const quiet = `${info.key} ${info.live === 'reply' ? 'no reply' : 'silent'}`;
  if (answered) requestMap.clearEndless(info.page || state.pagePath, quiet);
  else requestMap.markEndless(info.page || state.pagePath, quiet);
  if (answered && !requestMap.changesNothing(state.pagePath, info.key)) state.lastFinish.set(info.key, { at: info.endedAt, info });
  if (answered) state.lastAnyFinish = info.endedAt;
  const step = info.cause > 0 ? state.steps.get(info.cause) : null;
  if (step) step.lastCausedAt = info.endedAt;
  if (answered) {
    try {
      learnSoon(state, state.page.mainFrame());
    } catch (_) {}
  }
}
function liveSocket(state, ws) {
  let url = '';
  try {
    url = ws.url();
  } catch (_) {
    return;
  }
  if (!/^wss?:/i.test(url)) return;
  const key = addressKey('WS', url);
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch (_) {
      return url;
    }
  })();
  const pending = [];
  const open = kind => {
    if (requestMap.isEndless(state.pagePath, `${key} ${kind === 'reply' ? 'no reply' : 'silent'}`)) return;
    const handle = liveRequest(state, key, `WebSocket ${path} ${kind === 'reply' ? 'reply' : '(opening)'}`, kind);
    const timer = setTimeout(() => close(handle, false), kind === 'reply' ? LIVE_REPLY_MS : LIVE_FIRST_MS);
    if (timer.unref) timer.unref();
    pending.push({ handle, kind, timer });
  };
  const close = (handle, answered) => {
    const index = pending.findIndex(item => item.handle === handle);
    if (index < 0) return;
    const [item] = pending.splice(index, 1);
    clearTimeout(item.timer);
    liveFinished(state, item.handle, answered);
  };
  open('first');
  ws.on('framesent', () => open('reply'));
  // a message from the server: the connection's first, and the reply to the oldest message still waiting for one
  ws.on('framereceived', () => {
    const first = pending.find(item => item.kind === 'first');
    if (first) close(first.handle, true);
    const reply = pending.find(item => item.kind === 'reply');
    if (reply) close(reply.handle, true);
  });
  const all = () => {
    while (pending.length) close(pending[0].handle, true);
  };
  ws.on('close', all);
  ws.on('socketerror', all);
}

function attach(state, info) {
  const step = info.cause > 0 ? state.steps.get(info.cause) : null;
  if (step && info.entry && !step.requests.includes(info.entry)) step.requests.push(info.entry);
}

function detach(state, info, cause) {
  const step = info.cause > 0 ? state.steps.get(info.cause) : null;
  if (step && info.entry) step.requests = step.requests.filter(entry => entry !== info.entry);
  info.cause = cause;
  attach(state, info);
}

// What the page says about the requests it sent (which step's work each one was) and what their answers changed.
function absorb(state, report) {
  if (!report) return;
  const now = Date.now();
  state.finishedUnmatched = state.finishedUnmatched.filter(info => !info.matched && now - info.endedAt < 2000);
  for (const send of report.sends || []) {
    let match = null;
    for (const info of state.requests.values()) {
      if (!info.matched && info.key === send.key) {
        match = info;
        break;
      }
    }
    if (!match) match = state.finishedUnmatched.find(info => !info.matched && info.key === send.key) || null;
    if (match) {
      match.matched = true;
      match.fire = !!send.fire;
      match.identity = !!send.identity;
      match.auth = !!send.auth;
      match.nonSimple = !!send.nonSimple;
      match.abortable = !!send.abortable;
      match.from = send.from || '';
      if (match.cause !== send.cause) detach(state, match, send.cause);
    } else {
      state.unmatchedSends.push({ key: send.key, cause: send.cause, fire: !!send.fire, identity: !!send.identity, auth: !!send.auth, nonSimple: !!send.nonSimple, abortable: !!send.abortable, from: send.from || '', at: Date.now() });
    }
  }
  state.unmatchedSends = state.unmatchedSends.filter(send => now - send.at < 2000).slice(-50);
  // a frame's report (an iframe's own document) is part of the tab's page: what it learned is filed under the tab's
  // page, as its calls are, and the tab's address stays the page's
  const fromFrame = report.top === false;
  if (fromFrame) {
    const tabPage = state.pagePath || pagePathOf(safeUrl(state.page));
    if (tabPage) for (const item of [...(report.deliveries || []), ...(report.reads || []), ...(report.timerOutcomes || [])]) if (item) item.page = tabPage;
  }
  if (report.page && !fromFrame) {
    state.pagePath = report.page;
    // one more visit of this page: a new document, or the app's own move to another address in it
    const visit = `${state.documents}|${report.page}`;
    if (visit !== state.visit) {
      state.visit = visit;
      requestMap.visit(report.page);
      hiddenVisit(state);
    }
  }
  const pageSite = siteOf(safeUrl(state.page));
  // a new build of the app (its script files renamed): this document's page is visited as if for the first time
  if (Array.isArray(report.scripts)) {
    const own = [...new Set(report.scripts.filter(url => isAppSite(pageSite, url)).map(url => url.split(/[?#]/)[0]))].sort();
    if (own.length && requestMap.release(state.pagePath, hashText(own.join('\n')))) {
      state.unconfirmed = true;
      console.log(`[stability] ${state.pagePath}: the app's scripts changed since the last visit (a new build) - waiting for its calls as on a first visit`);
    }
  }
  for (const read of report.reads || []) {
    requestMap.noteRead(read.page, read.key);
    // another site the page's OWN code calls (not an ad network's or a tracker's script), whose answers it reads,
    // with the user's identity or past the permission check: a candidate for the app's own backend
    const site = siteOf(read.key.split(' ')[1] || '');
    const ownCode = !!read.from && siteOf(read.from) === pageSite;
    if (pageSite && site && site !== pageSite && ownCode && !NAMED_IGNORED.has(site) && (read.identity || read.nonSimple)) {
      backendCandidates.set(read.key, site);
      if (backendCandidates.size > 200) backendCandidates.delete(backendCandidates.keys().next().value);
    }
  }
  for (const delivery of report.deliveries || []) {
    // Another site's answer (an ad, a tracker, an error reporter) reaches the page only through its own code, and that
    // code is followed: what it is credited with is what its own code changed (own). The app's own answers keep the
    // changes of code that could not be followed, made the moment after (regions): their code may go on through a way
    // that is not followed (a worker, the browser's storage).
    const ownSite = isAppSite(pageSite, delivery.key.split(' ')[1] || '');
    const regions = (ownSite || !Array.isArray(delivery.own) ? delivery.regions : delivery.own) || [];
    requestMap.note(delivery.page, delivery.key, regions, [], !!delivery.exact, !!delivery.uncertain, delivery.looked !== false);
    // ... and it is the backend once one of those answers is seen changing the page (a list, a form - not only its
    // top) by the page's code that took it in (followed, not just at the same moment): an app's API does; ad bids,
    // analytics and video data do not
    const own = Array.isArray(delivery.own) ? delivery.own : regions;
    const site = backendCandidates.get(delivery.key);
    if (site && pageSite && own.some(region => !isTopRegion(region)) && requestMap.addBackend(pageSite, site)) {
      console.log(`[stability] ${site} is this app's backend (the app's own code calls it with the user's login or the browser's permission check, reads its answers, and they change the page) - waited for like ${pageSite}`);
    }
  }
  // a live connection's first message (Server-Sent Events: only the page sees it)
  for (const delivery of report.deliveries || []) {
    const first = state.liveFirst.get(delivery.key);
    if (!first) continue;
    state.liveFirst.delete(delivery.key);
    clearTimeout(first.timer);
    liveFinished(state, first.handle, true);
  }
  // ... and whether they changed what a watched control's code uses (Chrome, Edge)
  if (report.deliveries && report.deliveries.length) hiddenAnswers(state, report.deliveries);
  // what the short timers that fired did; spinners still spinning after the patience, and remembered ones that
  // stopped within it after all
  for (const outcome of report.timerOutcomes || []) requestMap.note(outcome.page, `timer ${outcome.key}`, outcome.regions || [], outcome.sends || [], !!outcome.exact);
  for (const name of report.staleSpinners || []) requestMap.markEndless(state.pagePath, `spinner ${name}`);
  for (const name of report.spinnerDone || []) requestMap.clearEndless(state.pagePath, `spinner ${name}`);
  // font families still loading after the whole font wait (never arriving), and remembered ones that arrived
  if (!fromFrame) {
    const fontSite = siteOf(safeUrl(state.page));
    for (const family of report.stuckFonts || []) requestMap.markEndless(state.pagePath, `font ${fontSite} ${family}`);
    for (const family of report.fontsArrived || []) requestMap.noteFontArrived(state.pagePath, `font ${fontSite} ${family}`);
  }
  for (const key of report.background || []) backgroundKeys.add(key);
  if (requestMap.dirty > 25) requestMap.save();
}

// A request finished: once its answer has been used, ask the page what it changed (and again while answers are
// still being taken in). One look at a time per page.
function learnSoon(state, frame) {
  if (state.learning || !frame) return;
  state.learning = setTimeout(async () => {
    state.learning = null;
    const report = await learnNow(state, frame, false);
    if (report && report.open) learnSoon(state, frame);
  }, 200);
  if (state.learning.unref) state.learning.unref();
}

async function learnNow(state, frame, all = true) {
  if (state.page.isClosed() || !frame) return null;
  try {
    const report = await withTimeout(internal(frame, () => frame.evaluate(drainPage, all)), 1500);
    if (report && report !== TIMED_OUT && !report.missing) {
      absorb(state, report);
      return report;
    }
  } catch (_) {}
  return null;
}

function drainPage(all) {
  const tracker = window[Symbol.for('pw-stability')];
  return tracker ? tracker.drain(all) : { missing: true };
}

function requestLabel(request) {
  try {
    const url = new URL(request.url());
    return `${request.method()} ${url.pathname}${url.search ? '?...' : ''}`;
  } catch (_) {
    return `${request.method()} ${String(request.url()).slice(0, 80)}`;
  }
}

function remember(state, text) {
  state.problems.push({ at: Date.now(), text });
  if (state.problems.length > 30) state.problems.splice(0, state.problems.length - 30);
}

// Polling by its beat: the same request starting at steady intervals, or a long poll that restarts the
// moment the previous one ends.
function noteRhythm(state, key, now) {
  if (backgroundKeys.has(key)) return;
  let rhythm = state.rhythm.get(key);
  if (!rhythm) state.rhythm.set(key, (rhythm = { starts: [], lastEnd: 0, lastLasted: 0, restarts: 0 }));
  if (rhythm.lastEnd && now - rhythm.lastEnd < 300) {
    rhythm.restarts += 1;
    if (rhythm.lastLasted >= 2000) backgroundKeys.add(key);
  }
  rhythm.starts.push(now);
  if (rhythm.starts.length > 6) rhythm.starts.shift();
  const gaps = rhythm.starts.slice(1).map((at, index) => at - rhythm.starts[index]);
  const recent = gaps.slice(-2);
  const steady = recent.length === 2 && recent.every(gap => gap >= 200) && Math.abs(recent[0] - recent[1]) <= 0.35 * Math.max(recent[0], recent[1]);
  if (steady || rhythm.restarts >= 2) backgroundKeys.add(key);
}

// A 200 answer that still says the backend did not do it: {"success": false}, {"ok": false},
// {"status": "error"}, {"error": ...}, GraphQL {"errors": [...]}. Only a short message is kept.
async function readErrorBody(request) {
  const response = await request.response();
  if (!response || response.status() >= 400) return '';
  const headers = response.headers();
  if (!/json/i.test(headers['content-type'] || '')) return '';
  if (Number(headers['content-length'] || 0) > BODY_LIMIT) return '';
  const text = await response.text();
  if (!text || text.length > BODY_LIMIT) return '';
  let body;
  try {
    body = JSON.parse(text);
  } catch (_) {
    return '';
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '';
  const words = value => (typeof value === 'string' ? value : value && typeof value === 'object' ? String(value.message || value.error || value.detail || value.title || '') : '');
  const errors = Array.isArray(body.errors) ? body.errors : null;
  let failed = body.success === false || body.ok === false || /^(error|fail|failed|failure)$/i.test(String(body.status || body.result || ''));
  if (errors && errors.length) failed = true;
  if (body.error && (typeof body.error === 'string' || typeof body.error === 'object')) failed = true;
  if (!failed) return '';
  const message = words(body.message) || words(body.error) || (errors && words(errors[0])) || words(body.detail) || 'an error';
  return message.replace(/\s+/g, ' ').trim().slice(0, 140);
}

// ---------------------------------------------------------------- wrapping

const hooks = { plan: planStep, before, after, failed, checked };

// The wrappers are compiled as if they were a Playwright file, so Playwright names each step after the
// method the spec called ("locator.click", "locator.clear") and takes its location from the spec line.
// The original is always called as a method (this[key](...)), never with .apply/.call: inside the test
// runner those turn the name into "locator.apply" / "locator.call". A step with nothing to check calls
// the original at once, exactly as without this file. An assertion that waits first does so inside its
// own Playwright step (an await before it would cut the link to the spec line on Playwright 1.5x).
const WRAPPER_SOURCE = `(function (hooks) {
  return function makeWrapper(method, key, kind, owner) {
    const holder = {
      async [method](...args) {
        const plan = hooks.plan(this, owner, kind, method, args);
        if (!plan) return this[key](...args);
        if (kind === 'expect') {
          // nothing to wait for first: called at once, as without this file; its result only looked at
          if (plan.watchOnly) {
            const result = await this[key](...args);
            await hooks.checked(plan, result, args);
            return result;
          }
          return this._wrapApiCall(async () => {
            await hooks.before(plan);
            const result = await this[key](...args);
            await hooks.checked(plan, result, args);
            return result;
          });
        }
        await hooks.before(plan);
        for (let attempt = 0; ; attempt += 1) {
          let result;
          try {
            result = await this[key](...args);
          } catch (error) {
            if (await hooks.failed(plan, error, attempt)) continue;
            throw error;
          }
          if (await hooks.after(plan, result, attempt)) continue;
          return result;
        }
      },
    };
    return holder[method];
  };
})`;

let wrapperFile = null;

function wrapClasses(page) {
  wrapperFile = path.join(playwright.coreDir, 'lib', 'client', 'stabilityChecks.js');
  const makeWrapper = vm.runInThisContext(WRAPPER_SOURCE, { filename: wrapperFile })(hooks);
  const Locator = page.locator('html').constructor;
  const Page = page.constructor;
  const Frame = page.mainFrame().constructor;
  const Keyboard = page.keyboard && page.keyboard.constructor;
  const Mouse = page.mouse && page.mouse.constructor;
  const wrapAll = (Class, methods, owner) => {
    if (!Class || !Class.prototype) return;
    for (const [method, kind] of Object.entries(methods)) {
      const proto = Class.prototype;
      if (typeof proto[method] !== 'function') continue;
      const key = Symbol(`stability original ${method}`);
      proto[key] = proto[method];
      proto[method] = makeWrapper(method, key, kind, owner);
    }
  };
  wrapAll(Locator, LOCATOR_METHODS, 'locator');
  wrapAll(Page, PAGE_METHODS, 'page');
  wrapAll(Keyboard, KEYBOARD_METHODS, 'keyboard');
  wrapAll(Mouse, MOUSE_METHODS, 'mouse');
  if (Frame && Frame.prototype && typeof Frame.prototype._expect === 'function') wrapAll(Frame, { _expect: 'expect' }, 'frame');
}

const originalOf = (target, method) => {
  const proto = Object.getPrototypeOf(target);
  const key = Object.getOwnPropertySymbols(proto).find(symbol => String(symbol) === `Symbol(stability original ${method})`);
  return key ? (...args) => target[key](...args) : null;
};

// ---------------------------------------------------------------- before / after a step

// Right away, before anything is awaited: does this call get the checks at all? null = no.
function planStep(receiver, owner, kind, method, args) {
  if (insideChecks.getStore()) return null;
  try {
    const caller = callerOf();
    // a Playwright method calling another (pressSequentially -> type): the outer call already waited
    if (kind !== 'expect' && caller.library) return null;
    const plan = planFor(receiver, owner, kind, method, args, caller);
    if (!plan) return null;
    if (plan.kind === 'nav') return plan;
    // the healer's own probing reads are left alone; the spec's reads wait
    if ((plan.kind === 'read' || plan.kind === 'readAll') && caller.fixture) return null;
    // inside another Playwright call already (clear() runs fill() inside its own step)
    if (zoneOpen()) return null;
    // an assertion with nothing to wait for first: only its result is looked at (a failed one is explained)
    if (plan.kind === 'expect' && !plan.negative && !plan.state.inputs.length) plan.watchOnly = true;
    return plan;
  } catch (error) {
    warnInternal(error);
    return null;
  }
}

async function before(plan) {
  try {
    if (plan.kind === 'nav') {
      await insideChecks.run(true, () => waitForSaves(plan));
      closeStep(plan.state);
      return;
    }
    if (plan.kind !== 'expect' || plan.negative) {
      const report = await insideChecks.run(true, () => settle(plan, { cap: MAX_WAIT_MS, learn: true }));
      applySpot(plan, report);
    } else if (plan.state.inputs.length) {
      // an assertion right after values were set: one look, just for those values
      const report = await insideChecks.run(true, () => probe(plan, 0, 'look', watchList(plan)));
      if (report && !report.gone) {
        absorb(plan.state, report);
        plan.watchResults = report.watch;
      }
    }
    await repairInputs(plan);
    if (plan.acts) {
      // what the answers changed in what the watched controls' code uses, up to this moment (Chrome, Edge)
      await insideChecks.run(true, () => hiddenBeforeAct(plan.state)).catch(() => {});
      beginStep(plan);
      // the app's own calls this step went ahead without (learned not to concern its element): said if a later
      // step fails
      if (plan.skipped && plan.skipped.length) {
        plan.state.recentSkips.push({ where: plan.where, method: plan.method, at: Date.now(), calls: plan.skipped, names: (plan.target && plan.target.names) || [] });
        if (plan.state.recentSkips.length > 5) plan.state.recentSkips.shift();
      }
    }
  } catch (error) {
    warnInternal(error);
  }
}

async function after(plan, result, attempt) {
  try {
    if (plan.kind === 'nav') {
      const status = result && typeof result.status === 'function' ? result.status() : 0;
      if (RETRYABLE_STATUS.has(status) && attempt < NAVIGATION_RETRIES) {
        console.log(`[stability] ${plan.where} ${plan.method} got ${status} from the server - loading the page again (${attempt + 1}/${NAVIGATION_RETRIES})`);
        await sleep(1000 * 2 ** attempt);
        return true;
      }
      return false;
    }
    if (plan.scriptPress) {
      // Playwright checked the element (trial); the press itself, on the element, by script. Not done again by
      // the redo rules (a script press is not a gesture they can judge).
      plan.scriptPress = false;
      plan.retries = CLICK_RETRIES;
      const element = plan.owner === 'page' ? plan.locator.first() : plan.locator;
      await insideChecks.run(true, () => internal(plan.frame, () => element.evaluate(pressByScript))).catch(() => {});
    }
    if (plan.step) plan.step.actedAt = Date.now();
    if (plan.acts) hiddenActs(plan.state);
    if (plan.valueStep && plan.locator && plan.target) rememberInput(plan);
    if (!plan.follow) {
      if (plan.step) plan.step.reactUntil = Date.now() + Math.max(250, plan.state.quietMs * 2);
      return false;
    }
    const repeat = await insideChecks.run(true, () => followThrough(plan));
    // done again: what the redo starts is the redo's work (its follow-through, its backend verdict)
    if (repeat) await insideChecks.run(true, () => internal(plan.frame, () => plan.frame.evaluate(armPage, plan.id))).catch(() => {});
    // and where it presses is worked out again on the page as it is now
    if (repeat && plan.spotCheck) applySpot(plan, await insideChecks.run(true, () => probe(plan, 0, 'before')));
    return repeat;
  } catch (error) {
    warnInternal(error);
  }
  return false;
}

function armPage(id) {
  const tracker = window[Symbol.for('pw-stability')];
  if (tracker && tracker.arm) tracker.arm(id);
}

async function failed(plan, error, attempt) {
  try {
    const message = String(error && error.message || error);
    if (plan.kind === 'nav') {
      if (attempt < NAVIGATION_RETRIES && RETRYABLE_NAVIGATION_ERROR.test(message) && !/Timeout \d+ms exceeded/.test(message)) {
        console.log(`[stability] ${plan.where} ${plan.method} could not reach the server (${firstLine(message).slice(0, 120)}) - trying again (${attempt + 1}/${NAVIGATION_RETRIES})`);
        await sleep(1000 * 2 ** attempt);
        return true;
      }
      return false;
    }
    if (plan.step && !plan.step.reported) {
      await withTimeout(Promise.all(plan.step.reading), 1000);
      reportBackend(plan.step);
    }
    await insideChecks.run(true, () => explainFailure(plan, message));
  } catch (_) {}
  return false;
}

function planFor(receiver, owner, kind, method, args, caller) {
  let page = null;
  let frame = null;
  let locator = null;
  let point = null;
  let active = false;
  let negative = false;
  if (owner === 'locator') {
    frame = receiver._frame;
    page = frame && frame.page();
    locator = receiver;
  } else if (owner === 'page') {
    page = receiver;
    frame = page.mainFrame();
    if (kind !== 'nav') {
      if (typeof args[0] !== 'string') return null;
      locator = page.locator(args[0]);
    }
  } else if (owner === 'keyboard' || owner === 'mouse') {
    page = receiver._page;
    frame = page && page.mainFrame();
    if (owner === 'mouse') point = { x: Number(args[0]) || 0, y: Number(args[1]) || 0 };
    else active = true;
  } else if (owner === 'frame') {
    frame = receiver;
    page = frame.page();
    const options = args[1] || {};
    const expression = String(args[0] || '');
    negative = !!options.isNot || expression === 'to.be.hidden' || (expression === 'to.have.count' && options.expectedNumber === 0);
    if (options.selector) locator = frame.locator(options.selector);
  }
  if (!page || !frame || (typeof page.isClosed === 'function' && page.isClosed())) return null;
  const options = (owner === 'page' ? args[2] || args[1] : args[1] || args[0]) || {};
  const force = !!(options && typeof options === 'object' && options.force);
  const trial = !!(options && typeof options === 'object' && options.trial);
  // A locator (and an assertion on one) must find exactly one element - the recorder only writes locators
  // that matched one - so several matches mean the page is still changing. Page-level selectors
  // (page.click('text=...')) may match several: Playwright takes the first.
  const single = owner === 'locator' ? kind !== 'readAll' : owner === 'frame' ? !!locator && String(args[0] || '') !== 'to.have.count' : false;
  const acts = kind !== 'read' && kind !== 'readAll' && kind !== 'expect' && !trial;
  const valueStep = acts && !!locator && VALUE_STEPS.has(method);
  // the spec's own way to call the step off (Playwright 1.62: an AbortSignal in its options): waiting stops with it
  const signal = args.map(arg => (arg && typeof arg === 'object' ? arg.signal : null)).find(item => item && typeof item.aborted === 'boolean') || null;
  return {
    kind, owner, method, args, page, frame, locator, point, active, negative, single, acts, valueStep, signal,
    id: nextStepId++,
    state: pageState(page),
    where: caller.where,
    pointer: (kind === 'pointer' || kind === 'hover' || owner === 'mouse') && !force,
    wired: method === 'fill' || method === 'type' || method === 'pressSequentially' ? INPUT_TYPES
      : kind === 'pointer' ? (method === 'dblclick' ? [...CLICK_TYPES, 'dblclick'] : CLICK_TYPES) : null,
    wantTarget: kind === 'pointer' || kind === 'press' || valueStep,
    // an element the step needs: wait for it to be there (a read may find none, that is its answer)
    needsElement: acts && !!locator,
    follow: acts && (FOLLOWED.has(kind) || FOLLOWED_PLAIN.has(method)),
    // the press point is checked only when the spec left it to Playwright (no position, force or trial)
    spotCheck: SPOT_METHODS.has(method) && !!locator && (owner === 'locator' || owner === 'page') && !force && !trial
      && !(options && typeof options === 'object' && options.position),
    optionsIndex: owner === 'page' ? 1 : 0,
    retries: 0,
    target: null,
  };
}

// The middle of the element is a different control (a button in the middle of a card): the step meant the
// element itself, so it is pressed there instead - at a point of its own, as Playwright's `position`, a real
// press with all of Playwright's checks; or, when no point of it is free, by script on the element itself after
// Playwright's own checks (trial). Worked out from the latest look, again for a redo; otherwise the spec's
// options are left exactly as they were.
function applySpot(plan, report) {
  if (!plan.spotCheck) return;
  const index = plan.optionsIndex;
  if (!plan.spotSaved) {
    plan.spotSaved = true;
    plan.spotOriginal = plan.args[index];
  }
  const original = plan.spotOriginal;
  plan.scriptPress = false;
  const spot = report && !report.gone ? report.spot : null;
  if (!spot || (spot.kind === 'none' && plan.method !== 'click')) {
    if (plan.spotApplied) plan.args[index] = original;
    plan.spotApplied = false;
    return;
  }
  const options = original && typeof original === 'object' ? { ...original } : {};
  if (spot.kind === 'none') {
    options.trial = true;
    plan.scriptPress = true;
    console.log(`[stability] ${plan.where} ${plan.method}: ${spot.element} is covered all over by ${spot.middle} - pressed ${spot.element} itself by script, after Playwright's own checks`);
  } else {
    options.position = { x: spot.x, y: spot.y };
    console.log(`[stability] ${plan.where} ${plan.method}: the middle of ${spot.element} is ${spot.middle} - pressed ${spot.kind === 'own' ? 'its own area' : 'its own content'} at ${spot.x},${spot.y} instead`);
  }
  plan.args[index] = options;
  plan.spotApplied = true;
}

function pressByScript(element) {
  const tracker = window[Symbol.for('pw-stability')];
  if (tracker && tracker.press) return tracker.press(element);
  element.click();
  return true;
}

function beginStep(plan) {
  const { state } = plan;
  closeStep(state);
  plan.startedAt = Date.now();
  plan.step = {
    id: plan.id, plan, method: plan.method, where: plan.where, requests: [], reading: [], navigated: false,
    popup: false, download: false, dialog: false, urlBefore: safeUrl(plan.page), reported: false,
    reactUntil: Date.now() + 60000, lastCausedAt: 0, actedAt: 0,
  };
  state.step = plan.step;
  state.steps.set(plan.id, plan.step);
  state.anyStep = true;
  if (state.steps.size > 40) state.steps.delete(state.steps.keys().next().value);
  // a request that started a moment before (between the last look and now) is this step's work already
  for (const info of state.requests.values()) {
    if (info.cause === 0 && Date.now() - info.start < 50) {
      info.cause = plan.id;
      attach(state, info);
    }
  }
}

// The step is over when the next one starts: what it caused at the backend is said once.
function closeStep(state) {
  const step = state.step;
  state.step = null;
  if (step) {
    step.reactUntil = Math.min(step.reactUntil, Date.now());
    if (!step.reported) reportBackend(step);
  }
}

// what a request's answer says about the backend, or '' when it did its job
function verdictOf(entry) {
  if (entry.error && !ABORTED_REQUEST.test(entry.error)) return `${entry.label} failed (${entry.error})`;
  if (entry.status >= 500) return `${entry.label} answered ${entry.status}`;
  if (entry.status >= 400 && (!READ_METHODS.has(entry.method) || entry.type === 'document')) return `${entry.label} answered ${entry.status}`;
  if (entry.said) return `${entry.label} answered ${entry.status || 200} but said "${entry.said}"`;
  return '';
}

function reportBackend(step) {
  step.reported = true;
  const state = step.plan.state;
  const said = [];
  for (const entry of step.requests) {
    const text = verdictOf(entry);
    // the same answer again on a later step is not said again
    if (text && !said.includes(text) && !state.reported.has(text)) said.push(text);
  }
  for (const text of said) state.reported.add(text);
  if (said.length) console.log(`[stability] ${step.where} ${step.method}: the backend did not do it - ${said.slice(0, 4).join('; ')}`);
}

// An answer to a step's request that came after the step had moved on (its follow-through did not wait for it):
// still said, under that step's line.
function lateVerdict(state, info) {
  const step = info && info.cause > 0 ? state.steps.get(info.cause) : null;
  if (!step || !step.reported || !info.entry) return;
  const text = verdictOf(info.entry);
  if (!text || state.reported.has(text)) return;
  state.reported.add(text);
  console.log(`[stability] ${step.where} ${step.method}: the backend did not do it - ${text} (answered after the step had moved on)`);
}

// Waits until the step's element and the work that matters to it are settled, or the cap. Never throws.
// mode: 'before' (a step), 'follow' (after a click-like step: only that step's work).
// look: only looking (is it still there?), so a missing element is an answer, not something to wait for.
async function settle(plan, { cap, learn, mode = 'before', acted = 0, look = false }) {
  const { state } = plan;
  const started = Date.now();
  const seen = new Map();
  let previousIds = null;
  let lastReport = null;
  const follow = mode === 'follow';
  const light = plan.valueStep && !follow;
  for (let round = 0; ; round += 1) {
    if (plan.page.isClosed()) return null;
    // called off by the spec (its signal): Playwright says so as the step goes on
    if (plan.signal && plan.signal.aborted) return lastReport;
    // (the values earlier steps set, looked at in every round - the last look before acting is the one that counts:
    // an answer's redraw may reset one while this step waits)
    const watch = !follow && !look && state.inputs.length ? watchList(plan) : null;
    const report = await probe(plan, round === 0 && !follow ? 0 : SLICE_MS, mode, watch);
    if (report && report.gone) return null;
    if (report) {
      lastReport = report;
      plan.lastReport = report;
      absorb(state, report);
      state.quietMs = report.quietMs || state.quietMs;
      if (watch) plan.watchResults = report.watch;
    }
    const reasons = report ? [...report.reasons] : [{ kind: 'unresponsive', text: 'the page did not answer' }];
    if (report && !follow) {
      if (report.count === 0 && plan.needsElement && !look) reasons.push({ kind: 'missing', text: 'waiting for the element to be there' });
      if (plan.single && report.count > 1) reasons.push({ kind: 'ambiguous', text: `${report.count} elements match` });
      if (!light && report.count >= 1) {
        const ids = report.ids.join(',');
        if (previousIds !== null && ids !== previousIds) reasons.push({ kind: 'replaced', text: 'the element was re-rendered' });
        previousIds = ids;
      }
      if (report.unwired && (report.booting || startingUp(state))) reasons.push({ kind: 'unwired', text: 'its handlers are not attached yet' });
      if (report.count >= 1 && report.target) {
        plan.target = { ...report.target, id: report.ids[0] };
        hiddenTarget(plan, report.target);
      }
      plan.unwired = report.count >= 1 && !!report.unwired;
    }
    // a beat for the page to react - a short one when it visibly answered at once (late answers are still said)
    if (follow && Date.now() - acted < (report && report.answered ? ANSWERED_BEAT_MS : state.quietMs)) reasons.push({ kind: 'acted', text: 'the step just happened' });
    if (!light) reasons.push(...networkReasons(plan, report, mode, started));
    if (!light && !follow) reasons.push(...timerReasons(plan, report, started));
    let left = reasons.filter(reason => !reason.key || !state.noise.has(reason.key));
    for (const reason of left) seen.set(reason.text || reason.kind, (seen.get(reason.text || reason.kind) || 0) + 1);
    if (left.length && left.every(reason => reason.kind === 'answer') && Date.now() - started >= ANSWER_BEAT_MAX_MS) left = [];
    if (!left.length) {
      if (VERBOSE && Date.now() - started > 300) console.log(`[stability] ${plan.where} ${plan.method} ${follow ? 'followed through for' : 'waited'} ${seconds(Date.now() - started)}: ${topReasons(seen)}`);
      return lastReport;
    }
    if (Date.now() - started >= cap) {
      // a request still not finished after the whole wait: remembered, so later runs do not pay for it again
      // (until it is seen finishing)
      for (const reason of left) if (reason.kind === 'request' && reason.address) requestMap.markEndlessAt([reason.page, state.pagePath], reason.address);
      if (learn) {
        const learnable = left.filter(reason => reason.key);
        for (const reason of learnable) state.noise.add(reason.key);
        console.log(`[stability] ${plan.where} ${plan.method}: still busy after ${seconds(cap)} (${describeReasons(left)}) - going ahead${learnable.length ? '; that activity is ignored on this page from now on' : ''}`);
      } else {
        // a request of the step that never ended (a stream, a long poll it opened) is not waited for again -
        // the endless mark above, which a later finish clears (a run-long "background" mark would not be)
        if (VERBOSE) console.log(`[stability] ${plan.where} ${plan.method}: still busy after ${seconds(cap)} (${describeReasons(left)})`);
      }
      return lastReport;
    }
    // the page itself is still; only the network side is not: look again shortly
    if (report && report.ready) await sleep(40);
  }
}

function startingUp(state) {
  for (const info of state.requests.values()) {
    if (info.type === 'script' || info.type === 'document' || info.type === 'stylesheet') return true;
  }
  return false;
}

// Earlier steps' saves still on their way (to the page's own site, not reads, not fire-and-forget): leaving the
// page now could cut them off.
function savesInFlight(state, pageSite, exceptId) {
  const list = [];
  const now = Date.now();
  for (const info of state.requests.values()) {
    if (!(info.cause > 0) || info.cause === exceptId) continue;
    if (READ_METHODS.has(info.method) || info.fire || info.document || !DATA_TYPES.has(info.type)) continue;
    if (now - info.start > LONG_REQUEST_MS || neverFinishes(info, [info.page, state.pagePath])) continue;
    if (!isAppSite(pageSite, info.key.split(' ')[1] || '', info)) continue;
    list.push(info);
  }
  return list;
}

// Before going to another page (goto, reload, back, forward): the earlier steps' saves still on their way.
async function waitForSaves(plan) {
  const { state } = plan;
  const started = Date.now();
  const pageSite = siteOf(safeUrl(plan.page));
  let last = [];
  for (;;) {
    if (plan.page.isClosed()) return;
    const pending = savesInFlight(state, pageSite, plan.id);
    if (!pending.length || Date.now() - started >= FOLLOW_MAX_MS) {
      const waited = Date.now() - started;
      if (pending.length) console.log(`[stability] ${plan.where} ${plan.method}: still saving after ${seconds(waited)} (${pending.slice(0, 2).map(info => info.label).join('; ')}) - going ahead`);
      else if (VERBOSE && waited > 300) console.log(`[stability] ${plan.where} ${plan.method} waited ${seconds(waited)}: ${last.slice(0, 2).map(info => `${info.label} still saving`).join('; ')} (the page is about to be left)`);
      return;
    }
    last = pending;
    await sleep(50);
  }
}

// The short timers that keep a step waiting (at most 1 s each): the ones never watched yet (in doubt), the ones
// seen changing this element's part of the page, and the ones that send a request that matters to it (a
// debounced search). A timer seen at least twice changing nothing near it - an analytics flush, a carousel tick -
// does not hold it up; seen changing that part again, it does again.
function timerReasons(plan, report, waitStarted = 0) {
  const reasons = [];
  if (!report || !report.timers || !report.timers.length) return reasons;
  const page = plan.state.pagePath;
  const chain = report.chain;
  const pageSite = stepSite(plan, report);
  for (const timer of report.timers) {
    if (reasons.length >= 3) break;
    // Set while this step was already waiting, by code that drew no answer of the app (a timer set by a timer: an ad
    // refreshing, a tracker batching its reports): only when it is known to change this element's part of the page.
    // What the earlier steps left pending (a debounced search) fires within a second and is waited for as before; a
    // redraw that the app's answer put off a moment is part of drawing that answer.
    const during = waitStarted > 0 && Number(timer.setAt) > waitStarted + 20;
    const byApp = !!timer.by && isAppSite(pageSite, timer.by.split(' ')[1] || '');
    if (during && !byApp && !timerKnownRelevant(page, timer.key, chain, pageSite)) continue;
    // a new build of the app: nothing learned about this page is trusted for this visit
    if (!plan.state.unconfirmed && !timerMatters(page, timer.key, chain, pageSite)) continue;
    reasons.push({
      kind: 'timer',
      key: `timer ${timer.key}`,
      text: `a timer fires in ${timer.in} ms (${timer.start ? 'set while the page started' : 'set by an earlier step'}, ${timer.delay} ms)`,
    });
  }
  return reasons;
}

// seen changing this element's part of the page (itself, or by a request it sends) - not merely not seen yet
function timerKnownRelevant(page, key, chain, pageSite) {
  const address = `timer ${key}`;
  if (requestMap.relevance(page, address, chain) === 'relevant') return true;
  const entry = requestMap.entries.get(requestMap.key(page, address));
  for (const sent of (entry && entry.sends) || []) {
    if (requestMap.relevance(page, sent, chain) === 'relevant') return true;
  }
  return false;
}

function timerMatters(page, key, chain, pageSite) {
  const address = `timer ${key}`;
  if (requestMap.relevance(page, address, chain) !== 'irrelevant') return true;
  const entry = requestMap.entries.get(requestMap.key(page, address));
  for (const sent of (entry && entry.sends) || []) {
    const own = isAppSite(pageSite, sent.split(' ')[1] || '');
    const relevance = requestMap.relevance(page, sent, chain);
    if (own ? relevance !== 'irrelevant' : relevance === 'relevant') return true;
  }
  return false;
}

// A change (not a read) that an earlier step - not this one, not the page's own start - sent and that is still on its
// way (page loads aside), whose answer is not known to change anything the page shows: one that does (a list drawn
// from it, a "Saved" message) is waited for after the click that sent it, and judged by its parts like any call; this
// is for the ones whose answers show nothing (the server must still have them before the step that depends on them).
function earlierWrite(info, plan) {
  return info.cause > 0 && info.cause !== plan.id && !info.document && !READ_METHODS.has(String(info.method || 'GET').toUpperCase())
    && !requestMap.changesVisibly(info.page || plan.state.pagePath, info.key);
}

function strictWait(plan, info, chain) {
  const page = info.page || plan.state.pagePath;
  return STRICT && !!plan.acts && !info.document && (!seesClosures(plan.state) || inFrame(plan) || !requestMap.deepWatched(page, info.key)) && isAppSite(stepSite(plan), info.key.split(' ')[1] || '', info)
    && requestMap.takenIn(page, info.key) && !requestMap.hiddenRelevant(page, info.key, chain) && !requestMap.clearedFor(page, info.key, chain);
}

// a step on an element inside a frame (the page's own word, or the frame Playwright acts in): Chrome's and Edge's look
// covers the main frame only - strict there as in Firefox
function inFrame(plan) {
  try {
    if (plan.lastReport && plan.lastReport.top === false) return true;
    return !!(plan.frame && plan.page && plan.frame !== plan.page.mainFrame());
  } catch (_) {
    return false;
  }
}

// The requests that keep a step waiting - data and page loads only (DATA_TYPES). Before a step: those in
// flight whose answers change this element's part of the page (or that were not seen yet). After a click:
// the ones that click sent. waitStarted: when this step began waiting (an answer counts before a step only
// if its request was on its way by then: the data the step waited for, not the page's trickle of new ones).
function networkReasons(plan, report, mode, waitStarted = 0) {
  const { state } = plan;
  const now = Date.now();
  const chain = report && report.chain;
  const reasons = [];
  const page = state.pagePath;
  // (a step inside a frame from another site - a payment field, an embedded form - waits for that frame's own calls)
  const pageSite = stepSite(plan, report);
  // the app's own backend (its page's site, or another site it uses as its backend), or any address when the
  // page's site cannot be told
  const ownSite = info => isAppSite(pageSite, info.key.split(' ')[1] || '', info);
  // the work this control stops (its code aborts it): an earlier step's call that can be stopped
  const stopped = info => mode !== 'follow' && !!plan.acts && !!(report && report.target && report.target.stops) && !!info.abortable && info.cause > 0 && info.cause !== plan.id;
  const counts = info => {
    if (stopped(info)) return false;
    if (mode === 'follow' && info.abortable && report && report.stopControl) return false;
    // fire-and-forget (the page asked for no answer: keepalive, or one it may not read) and requests that
    // never finished last time are never waited for
    if (backgroundKeys.has(info.key) || !DATA_TYPES.has(info.type) || info.fire || neverFinishes(info, [info.page, page])) return false;
    if (mode === 'follow' && info.cause !== plan.id) return false;
    // a page load in the main frame counts wherever it goes (a sign-in page on another site too). After a step,
    // until the new page is there (answered and shown in the tab: the old page is gone) - the rest of its loading
    // is the next step's business (it waits while the page is still being read in; an expect retries by itself).
    if (info.document) return !(mode === 'follow' && info.responseAt && state.lastCommitAt >= info.responseAt);
    if (NAMED_IGNORED.has(siteOf(info.key.split(' ')[1] || ''))) return false;
    const own = ownSite(info);
    // a new build of the app: what was learned about this page is not trusted for this visit - its own calls are
    // waited for as on a first visit
    if (own && state.unconfirmed) return true;
    // Before pressing anything: a change an earlier step sent to the app's own server (not a read) still on its way -
    // whatever its answer shows, the server may need it done first (a save before the submit that depends on it)
    if (mode !== 'follow' && own && plan.acts && earlierWrite(info, plan)) return true;
    // after a step: its requests to its own site (their answers are its backend verdict) - all but those seen at
    // least twice changing nothing (an own-site log call); another site's (ads, analytics, video, error trackers)
    // only once seen changing the page
    if (mode === 'follow') return own ? !requestMap.changesNothing(info.page || page, info.key) : requestMap.changesSomething(info.page || page, info.key);
    // Before an action: a call from the page's start whose answer the page reads (takes its data in) but that was
    // never seen changing anything on the screen holds it back while on its way - an answer like that is only kept
    // by the app (who may edit, the settings, which features are on) for the buttons to use. One that fills a part
    // of the page (a logo, a list) is judged by that part, as any call.
    if (own && plan.acts && info.cause === LOAD_CAUSE && requestMap.isRead(info.page || page, info.key) && !requestMap.changesVisibly(info.page || page, info.key)) return true;
    // Before acting: one of the app's answers seen redrawing the part of the page where an earlier step set a value
    // (a field, a choice, a tick) - its redraw would reset that value under this step: waited for
    if (plan.acts && own && state.inputs.some(input => input.chain && input.frame === plan.frame && input.locator !== plan.locator
      && requestMap.relevance(info.page || page, info.key, input.chain) === 'relevant')) return true;
    // an answer seen changing what this element's own code uses (in any earlier run), or guessed from a failure: its
    // hidden need
    if (plan.acts && requestMap.hiddenRelevant(info.page || page, info.key, chain)) return true;
    // Strict, where the look cannot see all that a button's code uses (Firefox, WebKit): one of the app's own answers the
    // page's code takes in (its body, its status or a handler - seen on an earlier visit) is waited for before pressing,
    // unless a fact clears it for this element (a look that saw all its code uses watched it arrive and change none of it)
    if (strictWait(plan, info, chain)) return true;
    if (!own) return requestMap.relevance(page, info.key, chain) === 'relevant';
    return chain ? requestMap.relevance(page, info.key, chain) !== 'irrelevant' : !requestMap.changesNothing(page, info.key);
  };
  // the app's own calls on their way that this step does not wait for (said if a later step fails)
  const skipped = [];
  // a click on a link to another page: an earlier step's save still on its way would be cut off by leaving
  const leaving = mode !== 'follow' && !!(report && report.target && report.target.link && !report.target.blank && !report.target.download);
  if (leaving) {
    for (const info of savesInFlight(state, pageSite, plan.id)) {
      if (reasons.length < 3) reasons.push({ kind: 'request', key: `request ${info.key}`, address: info.key, page: info.page, text: `${info.label} still saving (this step leaves the page)` });
    }
  }
  for (const info of state.requests.values()) {
    const age = now - info.start;
    if (age > LONG_REQUEST_MS) {
      // still loading after a whole wait's worth of time: remembered like one a step gave up on (cleared when
      // it is seen finishing)
      if (DATA_TYPES.has(info.type)) requestMap.markEndlessAt([info.page, page], info.key);
      continue;
    }
    if (info.responseAt && now - info.responseAt > STREAMING_MS) continue;
    if (!counts(info)) {
      if (mode !== 'follow' && !info.document && !info.fire && DATA_TYPES.has(info.type) && ownSite(info) && !stopped(info) && skipped.length < 3) skipped.push(info);
      continue;
    }
    const hidden = mode !== 'follow' && plan.acts ? requestMap.hiddenKind(info.page || page, info.key, chain) : '';
    const write = mode !== 'follow' && plan.acts && earlierWrite(info, plan);
    const why = hidden === 'seen' ? " (its answer changes what this element's code uses)" : hidden === 'guess' ? ' (this element failed without its answer before)'
      : mode !== 'follow' && strictWait(plan, info, chain) ? ' (the page takes its answer in - not yet known not to matter to this element)' : '';
    if (reasons.length < 3) reasons.push({ kind: 'request', key: `request ${info.key}`, address: info.key, page: info.page, text: `${info.label} still ${write ? 'saving (an earlier step\'s change)' : 'loading'}${why}` });
  }
  if (mode !== 'follow' && report) plan.skipped = skipped.map(info => ({ label: info.label, start: info.start, fromStart: info.cause === LOAD_CAUSE, key: info.key, page: info.page || page }));
  // sent by the page a moment ago, not seen as a request yet (the page reports only fetch / XHR)
  for (const send of state.unmatchedSends) {
    if (reasons.length >= 4) break;
    if (counts({ key: send.key, cause: send.cause, type: 'fetch', fire: send.fire, identity: send.identity, auth: send.auth, nonSimple: send.nonSimple, from: send.from })) reasons.push({ kind: 'request', text: 'the page just sent a request' });
  }
  // an answer that matters just arrived: its re-render comes next. After a click only the click's own
  // answers; before a step only answers to requests that were already on their way when it began waiting.
  for (const [key, finish] of state.lastFinish) {
    if (now - finish.at >= Math.min(state.quietMs, 100)) continue;
    if (!counts(finish.info)) continue;
    if (mode !== 'follow' && waitStarted && finish.info.start >= waitStarted) continue;
    reasons.push({ kind: 'answer', key: `answer ${key}`, text: 'an answer just arrived' });
    break;
  }
  return reasons;
}

// One look at the page (round 0: right away; later: the page itself waits up to sliceMs for readiness).
async function probe(plan, sliceMs, mode, watch = null) {
  const options = {
    sliceMs,
    mode,
    watch,
    step: plan.id,
    arm: plan.acts && mode === 'before' ? plan.id : 0,
    // any step, a read included, ends the page's start-up: what start-up work chains on after it is nobody's
    endStart: mode !== 'follow',
    spot: mode === 'before' && !!plan.spotCheck,
    // spinners remembered on this page as never stopping: not waited for
    // (a new build of the app: its spinners are looked at again, as on a first visit)
    quietSpinners: mode === 'before' && !plan.state.unconfirmed ? requestMap.endlessSpinners(plan.state.pagePath) : [],
    // font families of this site remembered as never arriving: not waited for
    quietFonts: mode === 'before' && !plan.state.unconfirmed ? requestMap.stuckFonts(plan.state.pagePath, siteOf(safeUrl(plan.page))) : [],
    light: plan.valueStep && mode === 'before',
    pointer: mode === 'before' && plan.pointer,
    wired: mode === 'before' ? plan.wired : null,
    wantTarget: plan.wantTarget,
    globalDom: mode === 'before' && plan.single,
    point: plan.point,
    active: plan.active,
    ignore: [...plan.state.noise],
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let report;
    try {
      const evaluation = internal(plan.frame, () => (plan.locator ? plan.locator.evaluateAll(probeElements, options) : plan.frame.evaluate(probePage, options)));
      evaluation.catch(() => {});
      report = await withTimeout(evaluation, sliceMs + PROBE_GRACE_MS);
    } catch (error) {
      const message = String(error && error.message || error);
      if (/closed|Target crashed|has been closed/i.test(message)) return { gone: true };
      if (/detached/i.test(message) && plan.frame !== plan.page.mainFrame()) return { gone: true };
      // navigating: the old document is gone and the new one is not ready yet
      await sleep(50);
      continue;
    }
    if (report === TIMED_OUT) return null;
    if (report && report.missing) {
      await internal(plan.frame, () => plan.frame.evaluate(TRACKER_SOURCE)).catch(() => {});
      continue;
    }
    return report;
  }
  return null;
}

function probeElements(elements, options) {
  const tracker = window[Symbol.for('pw-stability')];
  return tracker ? tracker.probe(elements, options) : { missing: true };
}

function probePage(options) {
  const tracker = window[Symbol.for('pw-stability')];
  return tracker ? tracker.probe(null, options) : { missing: true };
}

// After a click-like step: wait for what it started, then make sure the page really responded.
// true = do the step again (the wrapper calls it once more).
async function followThrough(plan) {
  const acted = Date.now();
  if (plan.step) plan.step.reactUntil = acted + 60000;
  const report = await settle(plan, { cap: FOLLOW_MAX_MS, learn: false, mode: 'follow', acted });
  const step = plan.step;
  if (step) {
    step.reactUntil = Date.now() + Math.max(150, plan.state.quietMs);
    await withTimeout(Promise.all(step.reading), 1500);
    reportBackend(step);
  }
  const target = plan.target || {};
  const changedServer = !!step && step.requests.some(entry => !READ_METHODS.has(entry.method));
  const repeat = await respondedOrAgain(plan, report, step, target, changedServer);
  if (!repeat && plan.kind === 'pointer' && plan.locator) {
    plan.state.lastClick = { plan, at: Date.now(), opener: !!target.opener, changedServer };
  }
  return repeat;
}

// Did the page really respond to the step? true = do it again.
async function respondedOrAgain(plan, report, step, target, changedServer) {
  if (!report || !step || plan.owner === 'mouse' || plan.owner === 'keyboard' || plan.retries >= CLICK_RETRIES || plan.valueStep) return false;
  const gesture = report.gesture;
  const quiet = plan.state.quietMs;
  const elsewhere = step.navigated || step.popup || step.download || step.dialog;
  const ours = !!gesture && gesture.age <= Date.now() - plan.startedAt + 100;

  // 0. the element moved while it was pressed (a line above it filled in): the press landed on it, the
  //    click on what was around it, and nothing answered either - the browser never clicked it. Playwright
  //    checks only where the press lands. Done again once the element holds still.
  if (ours && gesture.slipped && !elsewhere && !step.requests.length && (plan.method === 'click' || plan.method === 'tap')) {
    const ready = await settle(plan, { cap: MAX_WAIT_MS, learn: false });
    if (ready && ready.count === 1) return again(plan, `the element moved while it was pressed - the ${plan.method} landed on ${gesture.clickedOn || 'the page around it'}, not on it; doing it again`);
    return false;
  }

  // 1. the page never noticed: the element had no handler when it was clicked, none ran, and nothing the
  //    browser does by itself (links, inputs, labels, submit buttons) applies - the click was lost
  if (ours && plan.unwired && !elsewhere && !step.requests.length && !target.native && gesture.handled === 0 && !gesture.prevented) {
    const started = Date.now();
    while (Date.now() - started < MAX_WAIT_MS && !plan.page.isClosed()) {
      const look = await probe({ ...plan, wired: CLICK_TYPES }, 0, 'before');
      if (look && !look.gone && look.count === 1 && !look.unwired) {
        await settle(plan, { cap: MAX_WAIT_MS, learn: false });
        return again(plan, `the page did not respond to the ${plan.method} (it was not listening yet) - doing it again`);
      }
      if (!look || look.gone || look.count !== 1) return false;
      await sleep(100);
    }
    return false;
  }
  // 2. a handler ran, but nothing at all followed (no change, no request, no timer, no storage write),
  //    on something that is not a toggle, a link or a form control
  const pause = Math.max(500, quiet * 2) * 4 ** plan.retries;
  if (ours && !elsewhere && !step.requests.length && !target.native && !target.stateful && !gesture.effect && !gesture.prevented && gesture.handled > 0 && (plan.kind === 'pointer' || plan.kind === 'press')) {
    await sleep(pause);
    const ready = await settle(plan, { cap: MAX_WAIT_MS, learn: false, look: true });
    // it did answer after all, a moment later (a new tab, a download, a dialog, another page, a request)
    if (wentElsewhere(step) || step.requests.length) return false;
    if (ready && ready.count === 1) return again(plan, `nothing happened after the ${plan.method} (the page was not ready for it) - doing it again`);
    return false;
  }
  // 3. it set off for another page (a link, a page request), but the page never got there
  const linkAway = !!target.link && !target.blank && !target.download && withoutHash(target.link) !== withoutHash(step.urlBefore);
  const setOff = linkAway || step.requests.some(entry => entry.type === 'document');
  const arrived = () => step.navigated || withoutHash(safeUrl(plan.page)) !== withoutHash(step.urlBefore);
  if (setOff && !arrived() && !step.popup && !step.download && !step.dialog && !changedServer) {
    await stepWorkDone(plan, step, Math.min(FOLLOW_MAX_MS, 4000));
    // the pause ends early once the page got there or the new tab came
    for (const until = Date.now() + pause; Date.now() < until && !arrived() && !wentElsewhere(step);) await sleep(25);
    if (arrived() || wentElsewhere(step)) return false;
    const ready = await settle(plan, { cap: MAX_WAIT_MS, learn: false, look: true });
    // the page got there, or the link's page opened in a new tab (a site's script opens it a moment later)
    if (arrived() || wentElsewhere(step)) return false;
    if (ready && ready.count === 1) return again(plan, `the ${plan.method} started loading another page but the page never got there - doing it again`);
    if (ready && ready.count === 0 && await reopen(plan)) return again(plan, `the ${plan.method} started loading another page but the page never got there - reopened its menu and doing it again`);
    console.log(`[stability] ${plan.where} ${plan.method} started loading another page but the page never got there, and the element is gone`);
  }
  return false;
}

// the step's answer went somewhere else than this page: a new tab, a download, a dialog, another page
const wentElsewhere = step => !!(step.navigated || step.popup || step.download || step.dialog);

// Before deciding that a step's page change never came: the step's own work still under way - its requests
// (all of them, whatever they were learned to change) and its timers - is waited out first. A site's script may
// open the link's page a moment later, in a new tab (Amazon's search results do), after its own request or timer.
async function stepWorkDone(plan, step, capMs) {
  const started = Date.now();
  while (Date.now() - started < capMs && !plan.page.isClosed() && !wentElsewhere(step)) {
    const now = Date.now();
    const requests = [...plan.state.requests.values()].some(info => info.cause === step.id && DATA_TYPES.has(info.type) && !info.fire
      && now - info.start < LONG_REQUEST_MS && !neverFinishes(info, [info.page, plan.state.pagePath]));
    if (!requests) {
      const look = await probe(plan, 0, 'follow');
      if (!look || !(look.stepTimers > 0)) return;
    }
    await sleep(50);
  }
}

function again(plan, text) {
  plan.retries += 1;
  console.log(`[stability] ${plan.where} ${text} (${plan.retries}/${CLICK_RETRIES})`);
  plan.id = nextStepId++;
  beginStep(plan);
  return true;
}

// The element was in a dropdown that closed: open it again with the click that opened it - only a real
// opener (aria-expanded / aria-haspopup / <select> / <details>), now closed, whose click sent nothing but
// reads to the server.
async function reopen(plan) {
  const opener = plan.state.lastClick;
  if (!opener || opener.plan === plan || !opener.opener || opener.changedServer || Date.now() - opener.at > 60000) return false;
  try {
    const look = await internal(opener.plan.frame, () => opener.plan.locator.evaluateAll(elements => elements.map(element => ({
      expanded: element.getAttribute('aria-expanded'),
      open: element.localName === 'details' ? element.open : null,
    }))));
    if (!look || look.length !== 1 || look[0].expanded === 'true' || look[0].open === true) return false;
    const click = originalOf(opener.plan.locator, opener.plan.method);
    if (!click) return false;
    await click(...opener.plan.args);
    await settle({ ...opener.plan }, { cap: FOLLOW_MAX_MS, learn: false, mode: 'follow', acted: Date.now() });
    const ready = await settle(plan, { cap: 3000, learn: false });
    return !!(ready && ready.count === 1);
  } catch (_) {
    return false;
  }
}

// ---------------------------------------------------------------- values set at once, checked later

function rememberInput(plan) {
  const { state, method, args, target } = plan;
  let watch = null;
  if (method === 'fill') watch = { kind: 'value', expected: String(args[0] ?? '') };
  else if (method === 'clear') watch = { kind: 'value', expected: '' };
  else if (method === 'check') watch = { kind: 'checked', expected: true };
  else if (method === 'uncheck') watch = { kind: 'checked', expected: false };
  else if (method === 'setChecked') watch = { kind: 'checked', expected: !!args[0] };
  else if (method === 'selectOption') {
    const wanted = [].concat(args[0]).map(item => (item && typeof item === 'object' ? item.value ?? item.label : item)).filter(item => item != null).map(String);
    watch = { kind: 'selected', expected: wanted };
  }
  if (!watch || (watch.kind === 'value' && watch.expected === '')) return;
  // the same field set again replaces its earlier entry
  state.inputs = state.inputs.filter(input => input.locator !== plan.locator);
  // (chain: the parts of the page the field sits in - an answer seen redrawing one of them resets the value)
  state.inputs.push({ ...watch, id: target.id, before: target.value || '', locator: plan.locator, frame: plan.frame, method, args, where: plan.where, repairs: 0, chain: (plan.lastReport && plan.lastReport.chain) || null, setAt: Date.now() });
  if (state.inputs.length > 30) state.inputs.shift();
}

// What the page is asked about the values of earlier steps, folded into a step's first look.
function watchList(plan) {
  return plan.state.inputs.filter(input => input.frame === plan.frame).map(input => ({ id: input.id, kind: input.kind, expected: input.expected, before: input.before }));
}

// Before a step: the values set by earlier steps are still there - a late re-render that wiped or reset one
// gets it set again. A field the app emptied itself (the typed text now shows elsewhere on the page, like a
// chips input) is left alone. Checked in the step's own first look; only a field that was drawn again (a
// new element) is looked up through its locator.
async function repairInputs(plan) {
  const { state } = plan;
  if (!state.inputs.length) return;
  const results = new Map((plan.watchResults || []).map(result => [result.id, result.status]));
  const keep = [];
  for (const input of state.inputs) {
    if (plan.locator === input.locator && plan.valueStep) continue; // set again by this very step
    let status = input.frame === plan.frame ? results.get(input.id) : undefined;
    if (status === 'ok') {
      keep.push(input);
      continue;
    }
    if (status === undefined || status === 'gone') {
      // another frame, or drawn again: the element the locator finds now
      let look;
      try {
        look = await insideChecks.run(true, () => internal(input.frame, () => input.locator.evaluateAll(elements => {
          const tracker = window[Symbol.for('pw-stability')];
          if (!tracker || elements.length !== 1) return { count: elements.length };
          return { count: 1, id: tracker.idOf(elements[0]) };
        })));
      } catch (_) {
        continue;
      }
      if (!look || look.count !== 1) continue; // gone or ambiguous: nothing to repair
      if (look.id !== input.id) {
        // a fresh element: whatever it holds now, the step's value is not in it unless it says so
        input.id = look.id;
        input.replaced = true;
      }
      const again = await internal(input.frame, () => input.frame.evaluate(watchOne, { id: input.id, kind: input.kind, expected: input.expected, before: input.before, replaced: !!input.replaced })).catch(() => null);
      status = again && again.status;
      if (status === 'gone' || !status) continue;
      if (status === 'ok') {
        keep.push(input);
        continue;
      }
    }
    if (status === 'undone' && input.repairs < INPUT_REPAIRS) {
      noteResetBy(plan, input);
      const redo = originalOf(input.locator, input.method);
      if (redo) {
        input.repairs += 1;
        console.log(`[stability] ${input.where} the page re-rendered and undid what ${input.method}() set - setting it again`);
        try {
          await redo(...input.args);
          input.replaced = false;
        } catch (_) {}
      }
    }
    keep.push(input);
  }
  state.inputs = keep;
}

// A value an earlier step set was found reset: the app's own answers that arrived since it was set are remembered as
// changing the part of the page that holds it (a value the app's code sets changes no element - the change watch
// does not see it). Later visits then wait for them before setting values there and before the next action, instead
// of repairing in a hurry.
function noteResetBy(plan, input) {
  const { state } = plan;
  const region = (input.chain || []).find(name => !isTopRegion(name));
  if (!region || !input.setAt) return;
  const pageSite = siteOf(safeUrl(state.page));
  for (const answer of state.recentAnswers) {
    if (answer.at < input.setAt || !isAppSite(pageSite, answer.key.split(' ')[1] || '')) continue;
    requestMap.noteRegion(answer.page, answer.key, region);
  }
}

function watchOne(watch) {
  const tracker = window[Symbol.for('pw-stability')];
  return tracker ? tracker.watch(watch) : null;
}

// One line when a step fails: what the page was doing then.
async function explainFailure(plan, message) {
  const notes = [];
  const now = Date.now();
  const recent = plan.state.problems.filter(problem => now - problem.at < 15000).map(problem => `${problem.text} ${seconds(now - problem.at)} before`);
  if (recent.length) notes.push(`server trouble: ${recent.slice(-3).join('; ')}`);
  if (plan.locator) {
    try {
      const look = await withTimeout(internal(plan.frame, () => plan.locator.evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { shown: box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none', width: innerWidth, height: innerHeight };
      }))), 1500);
      if (Array.isArray(look) && look.length > 1 && /strict mode violation/i.test(message)) notes.push(`${look.length} elements still matched after waiting for the page to settle`);
      if (Array.isArray(look) && look.length >= 1 && look.every(item => !item.shown)) notes.push(`the element is on the page but not visible (window ${look[0].width}x${look[0].height})`);
      if (Array.isArray(look) && look.length === 0) notes.push('nothing on the page matches the locator');
    } catch (_) {}
  }
  const busy = networkReasons(plan, null, 'before').map(reason => reason.text);
  if (busy.length) notes.push(`still loading: ${busy.join('; ')}`);
  // an earlier step that went ahead while the app's own calls were still on their way (they were not seen
  // changing its element's part of the page): if one of their answers matters here, the app let that step act
  // before it was ready - a race in the app that a person, slower than a test, rarely meets
  const skips = plan.state.recentSkips.filter(item => now - item.at < 60000).slice(-2);
  for (const skip of skips) {
    const calls = skip.calls.map(call => `${call.label}${call.fromStart ? ' (started with the page)' : ''}`).join(', ');
    notes.push(`earlier, ${skip.where} ${skip.method} went ahead while ${calls} ${skip.calls.length > 1 ? 'were' : 'was'} still loading`);
  }
  // ... learned from (every browser): from now on that step's element waits for those calls - a guess, which a fact
  // (a look at what its code uses, in this or a later run) confirms or drops (noteGuess)
  if (!HIDDEN_OFF) {
    const group = `${plan.state.pagePath}|${now}`;
    const learned = [];
    for (const skip of skips) {
      if (!skip.names || !skip.names.length) continue;
      // (a guess covers the element's own part of the page - the whole page only when it has no part of its own)
      const specific = skip.names.filter(name => !isTopRegion(name));
      const names = specific.length ? specific : skip.names;
      for (const call of skip.calls) {
        if (call.key && requestMap.noteGuess(call.page || plan.state.pagePath, call.key, names, group).length) learned.push(`${skip.where} ${skip.method} waits for ${call.label}`);
      }
    }
    if (learned.length) notes.push(`learned from this failure: from now on ${learned.join(', ')} (until a look at its code shows otherwise)`);
  }
  if (notes.length) console.log(`[stability] ${plan.where} ${plan.kind === 'expect' ? 'expect' : plan.method} failed - ${notes.join(' | ')}`);
}

// An assertion that did not pass (Playwright gives its result back rather than throwing here): what the page was
// doing, as for a failed step. Never changes the result.
async function checked(plan, result, args) {
  try {
    if (!result || typeof result.matches !== 'boolean') return;
    const options = args[1] || {};
    if (result.matches !== !!options.isNot) return;
    await insideChecks.run(true, () => explainFailure(plan, 'the check did not pass'));
  } catch (_) {}
}

// ---------------------------------------------------------------- helpers

const TIMED_OUT = Symbol('timed out');

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise(resolve => { timer = setTimeout(() => resolve(TIMED_OUT), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// Playwright's current API call ("zone"), the same on 1.58 - 1.64
function openApiCall() {
  try {
    return playwright.currentZone ? playwright.currentZone().data('apiZone') || null : null;
  } catch (_) {
    return null;
  }
}

// Our own look at the page: never a step of its own, also inside an assertion's step (where Playwright
// would otherwise show it as an extra "Evaluate" step).
function internal(owner, run) {
  if (!owner || typeof owner._wrapApiCall !== 'function') return run();
  const open = openApiCall();
  if (open && !open.internal) {
    try {
      return playwright.currentZone().with('apiZone', { ...open, internal: true, reported: true, userData: undefined, stepId: undefined }).run(() => run());
    } catch (_) {}
  }
  return owner._wrapApiCall(() => run(), { internal: true });
}

// Inside another Playwright call already (e.g. clear() runs fill() inside its own step)
function zoneOpen() {
  return !!openApiCall();
}

function safeUrl(page) {
  try {
    return page.url();
  } catch (_) {
    return '';
  }
}

// The site whose calls are a step's own: its page's - or, for a step inside a frame from another site (a payment
// field, an embedded form, a sign-in box), that frame's: what the frame's own code asks its own site for is what its
// fields wait for.
function stepSite(plan, report = plan.lastReport) {
  try {
    // (the page's own word on where the element is: a frame locator's step runs on the main frame's object)
    if (report && report.origin && report.origin !== 'null') {
      const site = siteOf(report.origin);
      if (site) return site;
    }
    if (plan.frame && plan.page && plan.frame !== plan.page.mainFrame()) {
      const site = siteOf(plan.frame.url());
      if (site) return site;
    }
  } catch (_) {}
  return siteOf(safeUrl(plan.page));
}

const withoutHash = url => String(url || '').split('#')[0];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const seconds = ms => `${(ms / 1000).toFixed(1)} s`;

function firstLine(value) {
  return String(value && value.message || value || '').replace(/\x1b\[[0-9;]*m/g, '').split('\n').map(part => part.trim()).filter(Boolean)[0] || '';
}

function describeReasons(reasons) {
  const texts = [];
  for (const reason of reasons) {
    const text = reason.text || reason.kind;
    if (!texts.includes(text)) texts.push(text);
  }
  return texts.slice(0, 4).join('; ');
}

function topReasons(seen) {
  if (!seen.size) return 'nothing to wait for - the browser was slow to answer the look';
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([text]) => text).join('; ');
}

function warnInternal(error) {
  if (warnedInternal) return;
  warnedInternal = true;
  console.log(`[stability] internal problem, checks skipped where it happens: ${firstLine(error)}`);
}

// Who called the wrapped method: the spec (or another test file), the healer's fixtures, or Playwright
// itself - and the spec line to name in messages.
function callerOf() {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 40;
  const stack = String(new Error().stack || '');
  Error.stackTraceLimit = limit;
  const fold = playwright.fold;
  const fixtures = fold(path.dirname(__filename)) + path.sep;
  const self = fold(__filename);
  const wrapper = fold(wrapperFile || '');
  let seenWrapper = false;
  let immediate = null;
  for (const raw of stack.split('\n').slice(1)) {
    // Node's own frames (node:internal/...): never the spec - and their "node:" must not be read as a drive letter
    if (/\bnode:|\(internal\/|\sinternal\//.test(raw)) continue;
    const line = raw.replace(/file:\/\/\/?/g, '');
    const match = line.match(/\(?((?:[a-zA-Z]:)?[^():]+):(\d+):\d+\)?\s*$/);
    if (!match) continue;
    const file = fold(match[1].trim().replace(/^at\s+/, ''));
    if (file === self || file.startsWith('node:') || file.startsWith('internal')) continue;
    if (file === wrapper) {
      seenWrapper = true;
      continue;
    }
    if (!seenWrapper) continue;
    const library = playwright.libraryDirs.some(dir => file.startsWith(dir));
    if (!immediate) immediate = { library, fixture: !library && file.startsWith(fixtures) };
    if (library) continue;
    const shown = path.relative(process.cwd(), match[1].trim().replace(/^at\s+/, '')).replace(/\\/g, '/');
    return { ...immediate, where: `${shown}:${match[2]}` };
  }
  return { library: false, fixture: false, ...(immediate || {}), where: 'spec' };
}

// ---------------------------------------------------------------- inside the page

// Runs in every page and frame before the app's own scripts (and, late, in any page that missed it).
// It only watches: the app sees the same behaviour; everything stays off window's own keys.
// What a function's code uses, from its text (the scanner both the page's tracker and the checks' own process use -
// written into the page's tracker as it is): the names that are not its own (parameters, its variables, functions and
// classes, catch names), not a property after a dot, not an object key, not a keyword, and not the browser's own
// (browserNames); for each, what is read from it (reads: the property path after it - state.cart.items - and whether
// it is called), and ambiguous when the code holds something that keeps the scanner from being sure (this, a
// contextual keyword used as a name, with, eval).
function makeCodeNames(browserNames) {
  const KEYWORDS = new Set(('break case catch class const continue debugger default delete do else enum export extends false finally for '
    + 'function if import in instanceof let new null return super switch this throw true try typeof var void while with yield await '
    + 'arguments eval undefined NaN Infinity globalThis').split(' '));
  // (words that are keywords only in some places: where one is seen, which names the code uses is not certain)
  const CONTEXTUAL = new Set(['async', 'get', 'set', 'static', 'of', 'implements', 'interface', 'package', 'private', 'protected', 'public']);
  const NAME_START = /[A-Za-z_$À-￿]/;
  const NAME_PART = /[\w$À-￿]/;
  const REGEX_AFTER = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);
  return text => {
    const used = [];
    const reads = [];
    const declared = new Set();
    // the names the code itself sets (x = 1, x += 1, x++): a helper's own bookkeeping
    const written = new Set();
    let ambiguous = false;
    const n = text.length;
    let i = 0;
    // the last token: a punctuation character, 'word:<w>', or 'value' (a string, a number, a regular expression)
    let last = '';
    // ( [ { and ${ open; for each ${ the depth it opened at, for each ( what came before it and its names
    let depth = 0;
    const templates = [];
    const groups = [];
    // after let / const / var: { depth, value } - its names are declared until its = (its value's names are used)
    let declaring = null;
    // after function / class the next name is declared; after function / catch the next ( holds parameters
    let nameNext = false;
    let paramsNext = false;
    // where in used a name that may be a method's own name (name() { }) is
    let methodAt = -1;
    const skipSpace = from => {
      let j = from;
      for (;;) {
        while (j < n && /\s/.test(text[j])) j += 1;
        if (text[j] === '/' && text[j + 1] === '/') {
          while (j < n && text[j] !== '\n') j += 1;
          continue;
        }
        if (text[j] === '/' && text[j + 1] === '*') {
          const end = text.indexOf('*/', j + 2);
          j = end < 0 ? n : end + 2;
          continue;
        }
        return j;
      }
    };
    const wordAt = from => {
      if (!NAME_START.test(text[from] || '')) return '';
      let j = from + 1;
      while (j < n && NAME_PART.test(text[j])) j += 1;
      return text.slice(from, j);
    };
    // what is read from a name: the property names after it (a.b?.c), until something that is not one ([x] - a key
    // only the running code knows: computed), and whether the last is called
    const pathAfter = from => {
      const path = [];
      let j = skipSpace(from);
      let computed = false;
      for (;;) {
        if (text[j] === '?' && text[j + 1] === '.') j += 1;
        if (text[j] === '.' && text[j + 1] !== '.') {
          const k = skipSpace(j + 1);
          const property = wordAt(k);
          if (!property) break;
          path.push(property);
          j = skipSpace(k + property.length);
          continue;
        }
        if (text[j] === '[') computed = true;
        break;
      }
      // a plain assignment (a.b = x, not a.b += x or ==): written, not read - what is read is only the object written
      // into (which one, not what it holds)
      const assigned = !computed && text[j] === '=' && text[j + 1] !== '=' && text[j + 1] !== '>';
      // (read and set again: x += 1, x++)
      const op = text.slice(j, j + 4);
      const updated = !computed && (/^(?:\+\+|--)/.test(op) || /^(?:\*\*|<<|>>>?|\?\?|\|\||&&|[-+*/%&|^])=/.test(op));
      return { path, call: text[j] === '(', computed, assigned, updated };
    };
    const templateText = () => {
      while (i < n) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === '`') {
          i += 1;
          return false;
        }
        if (text[i] === '$' && text[i + 1] === '{') {
          i += 2;
          return true;
        }
        i += 1;
      }
      return false;
    };
    const regexAllowed = () => !last || (last.length === 1 && !')]'.includes(last)) || (last.startsWith('word:') && REGEX_AFTER.has(last.slice(5)));
    while (i < n) {
      i = skipSpace(i);
      if (i >= n) break;
      const c = text[i];
      if (c === '"' || c === "'") {
        i += 1;
        while (i < n && text[i] !== c) i += text[i] === '\\' ? 2 : 1;
        i += 1;
        last = 'value';
        continue;
      }
      if (c === '`' || (c === '}' && templates.length && templates[templates.length - 1] === depth - 1)) {
        if (c === '}') {
          templates.pop();
          depth -= 1;
        }
        i += 1;
        if (templateText()) {
          templates.push(depth);
          depth += 1;
          last = '{';
        } else {
          last = 'value';
        }
        continue;
      }
      if (c === '/' && regexAllowed()) {
        i += 1;
        let inClass = false;
        while (i < n && (inClass || text[i] !== '/')) {
          if (text[i] === '\\') i += 1;
          else if (text[i] === '[') inClass = true;
          else if (text[i] === ']') inClass = false;
          i += 1;
        }
        i += 1;
        while (i < n && NAME_PART.test(text[i])) i += 1;
        last = 'value';
        continue;
      }
      if (/\d/.test(c) || (c === '.' && /\d/.test(text[i + 1] || ''))) {
        while (i < n && /[\w.]/.test(text[i])) i += 1;
        last = 'value';
        continue;
      }
      if (NAME_START.test(c)) {
        const word = wordAt(i);
        i += word.length;
        const before = last;
        last = `word:${word}`;
        const after = skipSpace(i);
        // a property (after a dot) or a key ({ key: ... }, in a pattern too)
        if (before === '.' || ((before === '{' || before === ',') && text[after] === ':')) continue;
        if (word === 'let' || word === 'const' || word === 'var') {
          declaring = { depth, value: false };
          continue;
        }
        if (word === 'function' || word === 'class') {
          nameNext = true;
          paramsNext = word === 'function';
          continue;
        }
        if (word === 'catch') {
          paramsNext = true;
          continue;
        }
        // for (const x of list): list is used
        if ((word === 'in' || word === 'of') && declaring && !declaring.value) {
          declaring.value = true;
          continue;
        }
        // the code's own object (a class's state, a component's): not reachable by name
        if (word === 'this' || word === 'super' || word === 'with' || word === 'eval') ambiguous = true;
        if (KEYWORDS.has(word)) continue;
        if (CONTEXTUAL.has(word)) {
          // a keyword here (async () =>, async function, get name() { }) - or a name the code uses: not certain which
          const next = wordAt(after);
          const syntax = (word === 'async' && (next === 'function' || text[after] === '(' || (!!next && text[skipSpace(after + next.length)] === '=')))
            || ((word === 'get' || word === 'set' || word === 'static') && (!!next || text[after] === '[' || text[after] === '#'));
          if (!syntax) ambiguous = true;
          continue;
        }
        if (nameNext) {
          declared.add(word);
          nameNext = false;
          continue;
        }
        if (text[after] === '=' && text[after + 1] === '>') {
          declared.add(word);
          continue;
        }
        if (declaring && !declaring.value) {
          declared.add(word);
          continue;
        }
        // (a method's name in a class or an object - name() { } - is told from a call when its ) is followed by {)
        if (text[after] === '(' && ['{', ',', ';', '}'].includes(before)) methodAt = used.length;
        if (groups.length) groups[groups.length - 1].names.push(word);
        const read = { name: word, ...pathAfter(i) };
        let k = i - word.length - 1;
        while (k > 0 && /\s/.test(text[k])) k -= 1;
        if (!read.path.length && (read.assigned || read.updated || ((text[k] === '+' || text[k] === '-') && text[k - 1] === text[k]))) written.add(word);
        // (a name only ever assigned - x = 1 - is not something the code reads; a.b = 1 reads a, only as which object)
        if (read.assigned && !read.path.length) {
          used.push(null);
          reads.push(null);
          continue;
        }
        if (read.assigned) {
          read.path = read.path.slice(0, -1);
          read.base = true;
        }
        used.push(word);
        reads.push(read);
        continue;
      }
      if (c === '.' && text[i + 1] === '.' && text[i + 2] === '.') {
        i += 3;
        last = '...';
        continue;
      }
      if (c === '(') {
        groups.push({ names: [], params: paramsNext, before: last, methodAt: last.startsWith('word:') ? methodAt : -1 });
        paramsNext = false;
        nameNext = false;
        methodAt = -1;
        depth += 1;
      } else if (c === ')') {
        depth -= 1;
        const group = groups.pop();
        if (group) {
          const next = skipSpace(i + 1);
          const arrow = text[next] === '=' && text[next + 1] === '>';
          const method = text[next] === '{' && group.before.startsWith('word:') && !KEYWORDS.has(group.before.slice(5));
          if (arrow || group.params || method) for (const name of group.names) declared.add(name);
          else if (groups.length) groups[groups.length - 1].names.push(...group.names);
          if (method && group.methodAt >= 0) {
            used[group.methodAt] = null;
            reads[group.methodAt] = null;
          }
        }
      } else if (c === '[' || c === '{') {
        depth += 1;
      } else if (c === ']' || c === '}') {
        depth -= 1;
      }
      if (declaring) {
        if (depth < declaring.depth || (c === ';' && depth === declaring.depth)) declaring = null;
        else if (depth === declaring.depth && c === '=' && text[i + 1] !== '=' && text[i + 1] !== '>' && !'=!<>+-*/%&|^'.includes(text[i - 1] || '')) declaring.value = true;
        else if (depth === declaring.depth && c === ',') declaring.value = false;
      }
      last = c;
      i += 1;
    }
    const free = name => name && !declared.has(name) && !browserNames.has(name);
    const names = [...new Set(used)].filter(free);
    return { names, reads: reads.filter(read => read && free(read.name)), ambiguous, written: [...written].filter(free) };
  };
}

function pageTracker(SHORT_TIMER_MS, LOAD_CAUSE, makeCodeNames) {
  const KEY = Symbol.for('pw-stability');
  if (window[KEY]) return;
  const now = performance.now.bind(performance);
  const nativeSetTimeout = window.setTimeout;
  const nativeRaf = window.requestAnimationFrame;
  const NativeObserver = window.MutationObserver;
  const nativeAdd = EventTarget.prototype.addEventListener;
  const nativeRemove = EventTarget.prototype.removeEventListener;
  const toSource = Function.prototype.toString;
  const nativePortPost = window.MessagePort && MessagePort.prototype.postMessage;

  const QUIET_MIN = 100;
  const QUIET_MAX = 400;
  const ANIMATION_MAX_LEFT = 3000;
  const SPINNER_FRESH_MS = 3000;
  // spinners remembered as never stopping that are spinning now (name -> the node and when it started), to see
  // whether one stops after all
  const spinnerWatch = new Map();
  const spinsEndlessly = node => {
    let spinning = false;
    quietly(() => {
      for (const animation of node.getAnimations()) {
        if (animation.playState !== 'running' || !animation.effect) continue;
        const timing = animation.effect.getComputedTiming();
        if (timing.endTime === Infinity || timing.activeDuration === Infinity) spinning = true;
      }
    });
    return spinning;
  };
  const BUSY_FRESH_MS = 10000;
  const HOT_SLOTS = 6;
  const RECORDS_KEPT = 600;
  const DELIVERY_MS = 120;
  const INTERACTION = new Set(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'touchstart', 'touchend', 'keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'change', 'submit']);
  // an XHR's events while and once its answer is in
  const XHR_EVENTS = new Set(['readystatechange', 'loadstart', 'progress', 'load', 'loadend', 'error', 'abort', 'timeout']);

  const S = {
    lastGlobal: -1e9, // last DOM change outside endlessly changing parts
    lastLayout: -1e9, // last image/frame/font load or resize
    lastListener: -1e9, // last event handler attached to a node
    lastUrl: -1e9, // last history.pushState / replaceState / popstate / hashchange
    frameMs: 1000 / 60,
    handled: 0, // page handlers run for interaction events
    scheduled: 0, // timers, intervals, animation frames, message-channel tasks asked for
    stored: 0, // storage writes
    sent: 0, // fetch / XHR / beacon / websocket sends
    background: false, // inside a setInterval callback or a self-re-arming timer
    gesture: null,
    // whose work is running: a step's id (its handlers, the timers it set, the answers to its requests,
    // and anything while the page is still reacting to it), LOAD_CAUSE while the page starts, else 0
    inside: 0,
    // the answer whose code is running (see "whose code made a change"): null not known, KNOWN no answer's
    ctx: null,
    // an answer's mark was set and the code queued with it has not all run yet (see enterAnswer)
    sameMoment: null,
    armed: null,
    everArmed: false,
    armedWork: 0, // requests, timers and storage writes that were the armed step's work
  };
  const records = [];
  const inserted = new WeakMap();
  const hotSlots = new WeakMap();
  const rectSeen = new WeakMap();
  const ids = new WeakMap();
  let nextId = 1;
  const timers = new Map();
  const timerCycles = new Map();
  const timerKeys = new WeakMap();
  const listeners = new WeakMap();
  const wrappers = new WeakMap();
  const scrolledAt = new WeakMap();
  const backgroundSeen = new Map();
  const sends = [];
  // answers the page read (took their data in), said at the next look - at once, not when their window closes: a
  // test's last step may close the page right after
  const readsSaid = [];
  // looked: the page's code looked at the answer at all - its body, its status or headers, a handler of its own on it.
  // An answer nobody looks at cannot bring anything into the page: one sighting of it changing nothing is enough.
  const markLooked = sent => {
    if (!sent || sent.looked) return;
    sent.looked = true;
    if (sent.delivery) sent.delivery.looked = true;
  };
  const markRead = sent => {
    markLooked(sent);
    if (!sent || sent.read) return;
    sent.read = true;
    readsSaid.push({ key: sent.key, page: pagePathNow(), identity: !!sent.identity, nonSimple: !!sent.nonSimple, from: sent.from || '' });
    if (readsSaid.length > 100) readsSaid.shift();
  };
  const deliveries = [];
  const finishedDeliveries = [];
  // what each short timer that fired did (its key, the page, the parts changed, the requests sent)
  const timerWindows = [];
  const finishedTimers = [];

  const quietly = run => {
    try {
      run();
    } catch (_) {}
  };
  const quietMs = () => Math.min(QUIET_MAX, Math.max(QUIET_MIN, Math.round(6 * S.frameMs)));
  const reactMs = () => Math.max(250, quietMs() * 2);

  // ---- whose work is running. The mark stays until the current task is over (the promise callbacks that
  // follow in the same task belong to it too).
  // A cause passes through timers and requests a few links deep (a click -> its request -> the request its
  // answer starts ...), not forever: a page that keeps chaining work (a self-refreshing widget) does not stay
  // the click's - or the page's start's, which ends at the first step - work for ever.
  const MAX_LINKS = 4;
  // work known to be no step's (the page's own background, its start once the first step ran, a chain past
  // its links): it is not taken for the reacting step's either
  const FOREIGN = -2;
  let clearPosted = false;
  let clearChannel = null;
  let clearPort = null;
  quietly(() => {
    clearChannel = new MessageChannel();
    clearPort = clearChannel.port2;
    clearChannel.port1.onmessage = () => {
      clearPosted = false;
      S.inside = 0;
      S.insideLinks = 0;
      // the answer whose code ran (see "whose code made a change" below) is over with its task too
      if (S.ctx) {
        quietly(() => onMutations(observer.takeRecords()));
        S.ctx = null;
      }
    };
  });
  const postClear = () => {
    if (!clearPosted && clearPort && nativePortPost) {
      clearPosted = true;
      quietly(() => nativePortPost.call(clearPort, 0));
    }
  };
  const touch = cause => {
    if (S.armed && cause === S.armed.id) S.armed.last = now();
  };
  const setInside = (cause, links = 0) => {
    if (cause && cause !== FOREIGN && links <= MAX_LINKS && !(cause === LOAD_CAUSE && S.everArmed)) {
      S.inside = cause;
      S.insideLinks = links;
      touch(cause);
    } else if (!S.inside) {
      // only when no step's work is running in this task: an old request aborted inside a step's handler
      // leaves the rest of that handler the step's
      S.inside = FOREIGN;
      S.insideLinks = 0;
    } else return;
    postClear();
  };
  // whose work something started now is, one link further than the work that started it
  const causeNow = () => {
    let cause = 0;
    let links = 1;
    if (S.background || S.inside === FOREIGN) cause = 0;
    else if (S.inside) {
      cause = S.inside;
      links = (S.insideLinks || 0) + 1;
    } else if (S.armed && now() - S.armed.last <= reactMs()) cause = S.armed.id;
    else cause = S.everArmed ? 0 : LOAD_CAUSE;
    return links > MAX_LINKS ? { cause: 0, links } : { cause, links };
  };
  const armedEvent = () => {
    if (S.armed && now() - S.armed.at < 10000) setInside(S.armed.id, 0);
  };

  // ---- the parts of the page: the nearest box with a stable id, a form, a section, a table, a dialog ...
  const REGION_TAGS = new Set(['form', 'dialog', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'table', 'tbody', 'ul', 'ol', 'fieldset', 'details']);
  const REGION_ROLES = new Set(['dialog', 'alertdialog', 'region', 'grid', 'treegrid', 'listbox', 'menu', 'menubar', 'tablist', 'tabpanel', 'list', 'table', 'form', 'navigation', 'banner', 'main', 'complementary', 'contentinfo', 'search', 'toolbar', 'tree', 'alert', 'status']);
  const stableId = id => !!id && id.length <= 40 && /^[A-Za-z][\w-]*$/.test(id) && !/\d{2,}/.test(id);
  const signatureOf = element => {
    const tag = element.localName;
    if (stableId(element.id)) return `${tag}#${element.id}`;
    const role = element.getAttribute && element.getAttribute('role');
    return role && REGION_ROLES.has(role) ? `${tag}[role=${role}]` : tag;
  };
  const isRegion = element => {
    if (!element || element.nodeType !== 1) return false;
    if (stableId(element.id)) return true;
    if (REGION_TAGS.has(element.localName)) return true;
    const role = element.getAttribute('role');
    return !!role && REGION_ROLES.has(role);
  };
  const parentOf = node => {
    if (!node) return null;
    if (node.nodeType === 11 && node.host) return node.host;
    if (node.assignedSlot) return node.assignedSlot;
    const parent = node.parentNode;
    if (parent && parent.nodeType === 11 && parent.host) return parent.host;
    return parent;
  };
  const regionOf = node => {
    for (let element = node && node.nodeType === 1 ? node : parentOf(node); element && element.nodeType === 1; element = parentOf(element)) {
      if (isRegion(element) || element.localName === 'body' || element.localName === 'html') return element;
    }
    return null;
  };
  const chainOf = element => {
    const chain = [];
    for (let node = element; node && node.nodeType === 1; node = parentOf(node)) {
      if (isRegion(node) || node.localName === 'body' || node.localName === 'html') chain.push(signatureOf(node));
    }
    return chain;
  };

  // ---- DOM changes, also inside shadow roots
  const nodeOf = node => (node && node.nodeType === 3 ? node.parentNode : node);
  // A part of the page that never stops changing: many times a second (an animation driven by script),
  // or on a steady beat of its own (a clock, a polled status). Its changes say nothing about a step.
  const markHot = (node, t) => {
    if (!node || typeof node !== 'object') return false;
    const slot = Math.floor(t / 100);
    let entry = hotSlots.get(node);
    if (!entry) hotSlots.set(node, (entry = { slots: [], times: [] }));
    const { slots, times } = entry;
    if (slots[slots.length - 1] !== slot) slots.push(slot);
    while (slots.length && slots[0] < slot - 10) slots.shift();
    if (!times.length || t - times[times.length - 1] > 50) {
      times.push(t);
      if (times.length > 5) times.shift();
    }
    if (slots.length >= HOT_SLOTS) return true;
    if (times.length < 4) return false;
    if (S.gesture && S.gesture.lastAt >= times[0] - 1000) return false;
    const gaps = times.slice(1).map((at, index) => at - times[index]);
    const longest = Math.max(...gaps);
    return Math.min(...gaps) >= 150 && longest - Math.min(...gaps) <= 0.35 * longest;
  };
  // A small element with an id of its own (a price, a label, a button, a line of text) is not a part of the page
  // by itself: what changes in it changes the box it sits in too - the section, form, card or list around it,
  // where the button next to it is (a new release's answer fills the price the Buy button beside it needs).
  const LEAF_TAGS = new Set(['span', 'a', 'button', 'input', 'select', 'textarea', 'label', 'img', 'svg', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'b', 'i', 'small', 'option', 'abbr', 'code', 'time', 'output', 'progress', 'meter', 'canvas', 'video', 'audio', 'picture']);
  const namesOf = node => {
    const region = regionOf(node);
    if (!region) return [];
    const names = [signatureOf(region)];
    if (LEAF_TAGS.has(region.localName)) {
      for (let element = parentOf(region); element && element.nodeType === 1; element = parentOf(element)) {
        if ((isRegion(element) && !LEAF_TAGS.has(element.localName)) || element.localName === 'body' || element.localName === 'html') {
          names.push(signatureOf(element));
          break;
        }
      }
    }
    return names;
  };
  const attribute = (record, t) => {
    let names = null;
    const add = regions => {
      if (names === null) names = namesOf(record.target);
      for (const name of names) if (regions.size < 20) regions.add(name);
    };
    // made by code that was followed (see "whose code made a change"): only its answer's - or, made by code that
    // handled no answer (a press, a page script, another frame's message), nobody's. Only a change by code not
    // followed falls back on timing: whatever answer arrived the moment before.
    const ctx = record.ctx;
    if (ctx) {
      for (const delivery of [ctx.a].concat(ctx.with || [])) {
        if (!delivery || !deliveries.includes(delivery)) continue;
        add(delivery.regions);
        add(delivery.own);
      }
      // the answers handled while this code waited to run: it may be drawing them too (a framework that draws several
      // answers at once) - not credited to them (an ad's answer arriving at that moment is not part of the app's
      // redraw), but what they changed is not known for sure this time
      if (ctx.also) for (const delivery of ctx.also) delivery.joined = true;
      if (ctx.t && timerWindows.includes(ctx.t)) add(ctx.t.regions);
      return;
    }
    for (const delivery of deliveries) {
      if (t < delivery.from || t > delivery.until) continue;
      add(delivery.regions);
    }
    // (a short timer's code is always followed - see setTimeout: what other code changes meanwhile is not its)
  };
  // background: made by a setInterval callback or a timer background work set (taken right after it ran);
  // gesture: made by a real press or key while the browser handed it to the page (taken right after)
  const onMutations = (list, background = false, pressed = false) => {
    const t = now();
    const gesture = pressed || (!background && inGesture());
    for (const record of list) {
      const target = nodeOf(record.target);
      const hot = markHot(target, t);
      if (record.type === 'childList') {
        for (const node of record.addedNodes) if (node.nodeType === 1) inserted.set(node, t);
      }
      if (!hot) S.lastGlobal = t;
      // cause: whose work made it (the task's mark when the observer reports, right at the end of that task)
      const entry = { t, target, hot, type: record.type, background, gesture, cause: background ? 0 : S.inside, ctx: S.ctx };
      records.push(entry);
      if (!hot && !background && !gesture && (deliveries.length || timerWindows.length)) attribute(entry, t);
    }
    if (records.length > RECORDS_KEPT) records.splice(0, records.length - RECORDS_KEPT);
  };
  const observer = new NativeObserver(list => onMutations(list));
  const observe = root => quietly(() => observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true }));
  observe(document);

  // ---- whose code made a change. A change on the page is credited to the answer whose code made it: the code that
  // runs when the page takes an answer in (the rest of that task: the page's promise callbacks run in it too), and
  // what that code set off - timers, animation frames, idle callbacks, posted tasks and message-channel hand-offs
  // (React's scheduler) - followed the same way, for at most CONTEXT_MS after the answer. The browser runs one task at
  // a time, so an ad's answer drawing its box at the same moment is told apart from the app's answer drawing its list.
  // Nothing is changed in what the page's code does: the same functions run with the same arguments, in the same
  // order; only a mark is set before them.
  const CONTEXT_MS = 1500;
  // known: code that handles no answer (a real press or key, a page script's own first run, another frame's message)
  const KNOWN = Object.freeze({ known: true, a: null, t: null, at: 0, also: null });
  // the answers whose code ran lately: a task waiting to run while one was handled may draw it too
  const answersEntered = [];
  const enterCtx = ctx => {
    // when an answer's code last ran (the look at hidden needs matches what changed to the answers whose code ran)
    if (ctx) {
      const t = now();
      for (const delivery of [ctx.a].concat(ctx.with || [])) if (delivery) delivery.ranTo = t;
    }
    if (S.ctx === ctx) return;
    // what changed so far was the code before this one's
    onMutations(observer.takeRecords());
    S.ctx = ctx;
    if (ctx) postClear();
  };
  const answerCtx = sent => {
    const delivery = sent.delivery;
    if (!delivery) return null;
    if (!sent.ctx || sent.ctx.a !== delivery) sent.ctx = { known: true, a: delivery, t: null, at: delivery.at, also: null };
    return sent.ctx;
  };
  const enterAnswer = sent => {
    let ctx = answerCtx(sent);
    if (!ctx) return;
    // Another answer's mark set in this same moment - before the code queued with it has all run (the little marker
    // below runs after it): the browser took several answers in at once, and the page's code for each (its callbacks
    // on promises made from them) runs only after all of these marks. Which of them a change belongs to cannot be
    // told, so the changes are credited to all of them (never to none).
    const before = S.ctx;
    if (before && before.a && before.a !== ctx.a && S.sameMoment) {
      const group = [before.a].concat(before.with || []).filter(delivery => delivery !== ctx.a);
      ctx = { known: true, a: ctx.a, t: null, at: ctx.at, also: null, with: group };
      for (const delivery of [ctx.a].concat(group)) delivery.shared = true;
    }
    enterCtx(ctx);
    const moment = {};
    S.sameMoment = moment;
    quietly(() => Promise.resolve().then(() => { if (S.sameMoment === moment) S.sameMoment = null; }));
    answersEntered.push({ at: now(), a: ctx.a });
    if (answersEntered.length > 50) answersEntered.shift();
  };
  const scriptRunning = () => {
    try {
      return !!document.currentScript;
    } catch (_) {
      return false;
    }
  };
  // what a task set off now carries: the answer being handled (not past CONTEXT_MS), or "no answer's" when known
  const scheduleCtx = () => {
    let ctx = S.ctx;
    if (ctx && ctx.a && now() - ctx.at > CONTEXT_MS) ctx = KNOWN;
    if (!ctx && scriptRunning()) ctx = KNOWN;
    if (ctx) for (const delivery of [ctx.a].concat(ctx.with || [])) if (delivery) delivery.pending += 1;
    return { ctx, at: now(), done: false };
  };
  const settleScheduled = scheduled => {
    if (!scheduled || scheduled.done) return;
    scheduled.done = true;
    const ctx = scheduled.ctx;
    if (ctx) for (const delivery of [ctx.a].concat(ctx.with || [])) if (delivery) delivery.pending = Math.max(0, delivery.pending - 1);
  };
  // ... and when it runs: that, with the answers handled while it waited (they may be drawn by it: see attribute)
  const runCtx = scheduled => {
    settleScheduled(scheduled);
    const base = scheduled && scheduled.ctx;
    if (!base) return null;
    // a frame asked for by a frame (an animation running on): no redraw collecting answers
    if (scheduled.loop) return base;
    const also = [];
    const t = now();
    for (const entered of answersEntered) {
      if (entered.at > scheduled.at && t - entered.at < 300 && entered.a !== base.a && !also.includes(entered.a)) also.push(entered.a);
    }
    if (!also.length) return base;
    return { known: true, a: base.a, t: base.t, at: base.at, also, with: base.with };
  };
  // a callback wrapped in strict code: the page's function gets exactly the `this` the browser gives (undefined
  // stays undefined)
  const marked = (function () {
    'use strict';
    return (callback, before, after) => function () {
      try {
        before();
      } catch (_) {}
      try {
        return Reflect.apply(callback, this, arguments);
      } finally {
        if (after) {
          try {
            after();
          } catch (_) {}
        }
      }
    };
  })();
  // a learned short timer's own window gets what its code changes (also when whose code set it is not known: the timer's
  // code is its own)
  const withTimer = (ctx, watched) => (watched ? { known: true, a: ctx ? ctx.a : null, t: watched, at: ctx ? ctx.at : 0, also: ctx ? ctx.also : null, with: ctx ? ctx.with : null } : ctx);
  const scheduledTimers = new Map();
  const pairedChannels = new WeakSet();
  const portPartner = new WeakMap();
  const portQueues = new WeakMap();
  // a message arriving at a port: the answer whose code posted it (when posted from here), else not known
  const portCtx = port => {
    const queue = portQueues.get(port);
    return queue && queue.length ? runCtx(queue.shift()) : null;
  };

  quietly(() => {
    const nativeAttachShadow = Element.prototype.attachShadow;
    if (!nativeAttachShadow) return;
    Element.prototype.attachShadow = new Proxy(nativeAttachShadow, {
      apply(target, self, args) {
        const root = Reflect.apply(target, self, args);
        observe(root);
        return root;
      },
    });
  });

  // ---- an answer arrived: what changes on the page in the moment after it is what it changes
  const pathPart = part => (/^\d+$/.test(part) || /^[0-9a-f]{8,}$/i.test(part) || /^[0-9a-f-]{32,36}$/i.test(part) || (part.length > 24 && /\d/.test(part)) ? '*' : part);
  const pagePathNow = () => {
    let text = '/';
    quietly(() => {
      text = location.pathname.split('/').map(pathPart).join('/');
      if (location.hash.startsWith('#/')) text += location.hash.split('?')[0].split('/').map(pathPart).join('/');
    });
    return text;
  };
  // one answer is one observation: its headers arriving and its body being read extend the same window
  const delivered = (key, cause, lookBack, links, sent) => {
    setInside(cause, links);
    const t = now();
    if (sent && sent.delivery && deliveries.includes(sent.delivery)) {
      sent.delivery.until = t + DELIVERY_MS;
      return;
    }
    // own: the parts its own code changed (followed, not timed); pending: the tasks that code set off, not run yet
    const delivery = { key, page: pagePathNow(), from: t - (lookBack || 0), until: t + DELIVERY_MS, regions: new Set(), own: new Set(), at: t, pending: 0 };
    if (sent) {
      sent.delivery = delivery;
      delivery.looked = !!sent.looked;
    }
    deliveries.push(delivery);
    if (lookBack) for (const record of records) if (record.t >= delivery.from && !record.hot && !record.background && !record.gesture) attribute(record, record.t);
  };
  const closeDeliveries = t => {
    for (let index = deliveries.length - 1; index >= 0; index -= 1) {
      const delivery = deliveries[index];
      // open while what its code set off has not run yet (a redraw after a short wait), within CONTEXT_MS
      if (t <= delivery.until || (delivery.pending > 0 && t - delivery.at <= CONTEXT_MS)) continue;
      deliveries.splice(index, 1);
      // uncertain: nothing seen changed by its own code, but its code ran while another's redraw was waiting
      // ran: when its code ran (wall-clock ms, as the test's process counts them)
      const origin = performance.timeOrigin || 0;
      finishedDeliveries.push({
        key: delivery.key, page: delivery.page, regions: [...delivery.regions], own: [...delivery.own], exact: true, uncertain: !!delivery.joined && !delivery.own.size,
        looked: !!delivery.looked, shared: !!delivery.shared,
        ran: [Math.round(origin + delivery.at), Math.round(origin + Math.max(delivery.at, delivery.ranTo || 0))],
      });
    }
    if (finishedDeliveries.length > 200) finishedDeliveries.splice(0, finishedDeliveries.length - 200);
    for (let index = timerWindows.length - 1; index >= 0; index -= 1) {
      const watched = timerWindows[index];
      if (t <= watched.until) continue;
      timerWindows.splice(index, 1);
      finishedTimers.push({ key: watched.key, page: watched.page, regions: [...watched.regions], sends: [...watched.sends], exact: true });
    }
    if (finishedTimers.length > 200) finishedTimers.splice(0, finishedTimers.length - 200);
  };
  // ---- a short timer fired: what changes in the moment after it, and what it sends, is what it does
  const TIMER_WINDOWS_OPEN = 30;
  const openTimerWindow = key => {
    if (timerWindows.length >= TIMER_WINDOWS_OPEN) return null;
    const t = now();
    const watched = { key, page: pagePathNow(), from: t, until: t + DELIVERY_MS, regions: new Set(), sends: new Set() };
    timerWindows.push(watched);
    return watched;
  };

  // ---- things that move the layout without a DOM change; address changes
  const layoutMoved = () => { S.lastLayout = now(); };
  // when the fonts now loading started loading (0: none loading)
  const FONT_PATIENCE_MS = 2000;
  let fontsLoadingSince = 0;
  quietly(() => {
    if (!document.fonts) return;
    nativeAdd.call(document.fonts, 'loading', () => { if (!fontsLoadingSince) fontsLoadingSince = now(); });
    nativeAdd.call(document.fonts, 'loadingdone', () => { fontsLoadingSince = 0; });
    nativeAdd.call(document.fonts, 'loadingerror', () => { fontsLoadingSince = 0; });
  });
  quietly(() => {
    nativeAdd.call(window, 'load', event => { const tag = event.target && event.target.localName; if (['img', 'iframe', 'video', 'link', 'object'].includes(tag)) layoutMoved(); }, true);
    nativeAdd.call(window, 'error', event => { if (event.target && event.target.localName === 'img') layoutMoved(); }, true);
    nativeAdd.call(window, 'resize', layoutMoved);
    if (document.fonts) nativeAdd.call(document.fonts, 'loadingdone', layoutMoved);
    nativeAdd.call(window, 'popstate', () => { S.lastUrl = now(); });
    nativeAdd.call(window, 'hashchange', () => { S.lastUrl = now(); });
  });
  quietly(() => {
    for (const name of ['pushState', 'replaceState']) {
      const native = History.prototype[name];
      History.prototype[name] = new Proxy(native, {
        apply(target, self, args) {
          const result = Reflect.apply(target, self, args);
          S.lastUrl = now();
          return result;
        },
      });
    }
  });

  // ---- a gesture: one press of the mouse, finger or a key. These listeners are the page's very first,
  // so they see the press before any handler of the page does.
  const activeNow = () => {
    let active = document.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
    return active;
  };
  // the element really under the pointer (inside a shadow root too); only readable while the event runs
  const realTarget = event => {
    try {
      const path = event.composedPath ? event.composedPath() : [];
      return path.length ? path[0] : event.target;
    } catch (_) {
      return event.target;
    }
  };
  const startGesture = event => {
    armedEvent();
    const t = now();
    const gesture = S.gesture;
    if (gesture && t - gesture.lastAt < 50 && gesture.kind === (event.type === 'keydown' ? 'key' : 'pointer')) {
      gesture.lastAt = t;
      gesture.events.push(event);
      gesture.targets.push(realTarget(event));
      return;
    }
    S.gesture = {
      kind: event.type === 'keydown' ? 'key' : 'pointer',
      started: t,
      lastAt: t,
      events: [event],
      targets: [realTarget(event)],
      handled: S.handled,
      scheduled: S.scheduled,
      stored: S.stored,
      sent: S.sent,
      work: S.armedWork,
      active: activeNow(),
    };
  };
  const followGesture = event => {
    armedEvent();
    const gesture = S.gesture;
    if (gesture && now() - gesture.lastAt < 1000) {
      gesture.lastAt = now();
      gesture.events.push(event);
      gesture.targets.push(realTarget(event));
    }
  };
  // What a real press or key changes while the browser hands it to the page (from our first listener to our last)
  // is that press's work, never an answer's - whatever answer happens to be arriving at the same moment. Only real
  // input (isTrusted: a page's own dispatchEvent is not) and only presses and keys (focus can come from code).
  // The browser hands the changes over after each of the page's listeners (not at the end), so a change counts as the
  // press's own while that press is still being handed out: its eventPhase is not 0 (back to 0 once it is over - also
  // when the page stopped it on the way, so nothing later is taken for it).
  const GESTURE_TYPES = ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'pointerup', 'mouseup', 'touchend', 'click', 'dblclick', 'keyup', 'keypress', 'beforeinput', 'input'];
  const gestureBegins = event => {
    if (!event.isTrusted) return;
    onMutations(observer.takeRecords());
    // a real press or key is no answer's code - nor is what its handlers set off
    enterCtx(KNOWN);
    S.gestureEvent = event;
  };
  const gestureEnds = event => {
    if (!event.isTrusted) return;
    onMutations(observer.takeRecords(), false, true);
    if (S.gestureEvent === event) S.gestureEvent = null;
  };
  const inGesture = () => {
    try {
      return !!S.gestureEvent && S.gestureEvent.eventPhase !== 0;
    } catch (_) {
      return false;
    }
  };
  quietly(() => {
    for (const type of GESTURE_TYPES) nativeAdd.call(window, type, gestureBegins, true);
    for (const type of ['pointerdown', 'mousedown', 'touchstart', 'keydown']) nativeAdd.call(window, type, startGesture, true);
    for (const type of ['pointerup', 'mouseup', 'touchend', 'click', 'dblclick', 'keyup', 'keypress', 'beforeinput', 'input', 'change', 'submit', 'focusin']) nativeAdd.call(window, type, followGesture, true);
    for (const type of GESTURE_TYPES) nativeAdd.call(window, type, gestureEnds, false);
  });

  // ---- timers. Short ones (<= 1 s) set by a step or by the page's start mean something is about to happen;
  // timers that keep re-arming themselves (polling, tickers) are recognised after three rounds, and what
  // they and setInterval start is background.
  const keyOf = (handler, delay) => {
    let source = 'code';
    if (typeof handler === 'function') {
      source = timerKeys.get(handler);
      if (!source) {
        try {
          source = toSource.call(handler).slice(0, 160);
        } catch (_) {
          source = 'function';
        }
        timerKeys.set(handler, source);
      }
    }
    return `${Math.round(delay / 50)}|${source}`;
  };
  const inBackground = (handler, background, cause, links) => function () {
    const was = S.background;
    S.background = was || background;
    // a timer no step's work set is no step's work when it fires
    setInside(S.background ? 0 : cause, links);
    if (!S.background) return Reflect.apply(handler, this, arguments);
    // what background work changes is not what an answer arriving at the same moment changed
    onMutations(observer.takeRecords());
    try {
      return Reflect.apply(handler, this, arguments);
    } finally {
      S.background = was;
      onMutations(observer.takeRecords(), true);
    }
  };
  quietly(() => {
    window.setTimeout = new Proxy(nativeSetTimeout, {
      apply(target, self, args) {
        S.scheduled += 1;
        const handler = args[0];
        const delay = Math.max(0, Number(args[1]) || 0);
        const key = keyOf(handler, delay);
        const t = now();
        const cycle = timerCycles.get(key);
        let chain = false;
        if (cycle) {
          if (cycle.firedAt && t - cycle.firedAt < delay + 1000) cycle.rounds += 1;
          else if (!cycle.firedAt || t - cycle.firedAt > delay + 5000) cycle.rounds = 0;
          cycle.firedAt = 0;
          chain = cycle.rounds >= 3;
        }
        // set by background work (inside a setInterval callback, a polling chain): background as well
        const background = chain || (!!cycle && cycle.rounds >= 2) || S.background;
        const origin = background ? { cause: 0, links: 0 } : causeNow();
        const cause = origin.cause;
        if (S.armed && cause && cause === S.armed.id) S.armedWork += 1;
        const box = { id: 0 };
        let callArgs = args;
        let scheduled = null;
        if (typeof handler === 'function') {
          const run = inBackground(handler, background, cause, origin.links);
          // the timers a step may wait for (short, someone's work) are watched when they fire: learned
          const learned = delay <= SHORT_TIMER_MS && !background && !!cause;
          // the answer whose code set it (see "whose code made a change")
          scheduled = background ? null : scheduleCtx();
          const fire = function () {
            timers.delete(box.id);
            scheduledTimers.delete(box.id);
            const entry = timerCycles.get(key) || { rounds: 0, firedAt: 0 };
            entry.firedAt = now();
            timerCycles.set(key, entry);
            if (timerCycles.size > 500) timerCycles.delete(timerCycles.keys().next().value);
            const watched = learned ? openTimerWindow(key) : null;
            quietly(() => enterCtx(background ? KNOWN : withTimer(runCtx(scheduled), watched)));
            return Reflect.apply(run, this, arguments);
          };
          callArgs = [fire, ...Array.prototype.slice.call(args, 1)];
        }
        box.id = Reflect.apply(target, self, callArgs);
        // by: the answer whose code set it (a redraw put off a moment is part of drawing that answer)
        if (delay <= SHORT_TIMER_MS) timers.set(box.id, { due: t + delay, delay, key, chain, cause, by: scheduled && scheduled.ctx && scheduled.ctx.a ? scheduled.ctx.a.key : '' });
        if (scheduled && scheduled.ctx && scheduled.ctx.a) {
          scheduledTimers.set(box.id, scheduled);
          if (scheduledTimers.size > 500) scheduledTimers.delete(scheduledTimers.keys().next().value);
        }
        return box.id;
      },
    });
    window.clearTimeout = new Proxy(window.clearTimeout, {
      apply(target, self, args) {
        timers.delete(args[0]);
        quietly(() => {
          settleScheduled(scheduledTimers.get(args[0]));
          scheduledTimers.delete(args[0]);
        });
        return Reflect.apply(target, self, args);
      },
    });
    window.setInterval = new Proxy(window.setInterval, {
      apply(target, self, args) {
        S.scheduled += 1;
        let callArgs = args;
        if (typeof args[0] === 'function') {
          const run = inBackground(args[0], true, 0, 0);
          callArgs = [function () {
            quietly(() => enterCtx(KNOWN));
            return Reflect.apply(run, this, arguments);
          }, ...Array.prototype.slice.call(args, 1)];
        }
        return Reflect.apply(target, self, callArgs);
      },
    });
    // animation frames, message-channel tasks (React's scheduler) and microtasks: the page reacting
    const counted = (owner, name) => {
      if (owner && typeof owner[name] === 'function') {
        owner[name] = new Proxy(owner[name], {
          apply(target, self, args) {
            S.scheduled += 1;
            return Reflect.apply(target, self, args);
          },
        });
      }
    };
    counted(window, 'queueMicrotask');
    // (window.postMessage is left alone: a frame calling parent.postMessage through a wrapper would have its message
    // arrive as the page's own - event.source and event.origin are taken from the code that calls it)
    // animation frames, idle callbacks and posted tasks carry the answer whose code asked for them; cancelling one
    // lets its answer go
    const carried = (owner, name, cancelName) => {
      if (!owner || typeof owner[name] !== 'function') return;
      const waiting = new Map();
      // inside one of its own callbacks now (a frame asking for the next frame: a loop)
      const inside = { depth: 0 };
      owner[name] = new Proxy(owner[name], {
        apply(target, self, args) {
          S.scheduled += 1;
          const callback = args[0];
          if (typeof callback !== 'function') return Reflect.apply(target, self, args);
          let scheduled = null;
          quietly(() => {
            scheduled = scheduleCtx();
            scheduled.loop = inside.depth > 0;
          });
          const box = { id: undefined };
          const callArgs = Array.prototype.slice.call(args);
          callArgs[0] = marked(callback, () => {
            waiting.delete(box.id);
            inside.depth += 1;
            enterCtx(runCtx(scheduled));
          }, () => {
            inside.depth = Math.max(0, inside.depth - 1);
          });
          box.id = Reflect.apply(target, self, callArgs);
          if (cancelName && scheduled && scheduled.ctx && scheduled.ctx.a) {
            waiting.set(box.id, scheduled);
            if (waiting.size > 500) waiting.delete(waiting.keys().next().value);
          }
          return box.id;
        },
      });
      if (cancelName && typeof owner[cancelName] === 'function') {
        owner[cancelName] = new Proxy(owner[cancelName], {
          apply(target, self, args) {
            quietly(() => {
              settleScheduled(waiting.get(args[0]));
              waiting.delete(args[0]);
            });
            return Reflect.apply(target, self, args);
          },
        });
      }
    };
    carried(window, 'requestAnimationFrame', 'cancelAnimationFrame');
    carried(window, 'requestIdleCallback', 'cancelIdleCallback');
    // scheduler.postTask (its callback runs as a task of its own; cancelled through its signal - left to run out)
    quietly(() => {
      const proto = window.scheduler && Object.getPrototypeOf(window.scheduler);
      if (proto && Object.prototype.hasOwnProperty.call(proto, 'postTask')) carried(proto, 'postTask', null);
    });
    // message channels (React's scheduler hands its work to the next task this way): a message carries the answer
    // whose code posted it to the port that receives it - the other port of its channel, paired when the page first
    // takes either port; messages arrive in the order posted
    quietly(() => {
      const proto = window.MessageChannel && MessageChannel.prototype;
      if (!proto) return;
      const pair = channel => {
        if (pairedChannels.has(channel)) return;
        pairedChannels.add(channel);
        const one = getPort1.call(channel);
        const two = getPort2.call(channel);
        portPartner.set(one, two);
        portPartner.set(two, one);
      };
      const descriptor1 = Object.getOwnPropertyDescriptor(proto, 'port1');
      const descriptor2 = Object.getOwnPropertyDescriptor(proto, 'port2');
      if (!descriptor1 || !descriptor2 || typeof descriptor1.get !== 'function' || typeof descriptor2.get !== 'function') return;
      const getPort1 = descriptor1.get;
      const getPort2 = descriptor2.get;
      for (const [name, descriptor, getter] of [['port1', descriptor1, getPort1], ['port2', descriptor2, getPort2]]) {
        Object.defineProperty(proto, name, {
          ...descriptor,
          get: new Proxy(getter, {
            apply(target, self, args) {
              quietly(() => pair(self));
              return Reflect.apply(target, self, args);
            },
          }),
        });
      }
    });
    if (window.MessagePort && typeof MessagePort.prototype.postMessage === 'function') {
      MessagePort.prototype.postMessage = new Proxy(MessagePort.prototype.postMessage, {
        apply(target, self, args) {
          S.scheduled += 1;
          quietly(() => {
            const partner = portPartner.get(self);
            if (!partner) return;
            let queue = portQueues.get(partner);
            if (!queue) portQueues.set(partner, (queue = []));
            queue.push(scheduleCtx());
            // a port handed to a worker or another frame: its messages are not received here
            if (queue.length > 200) settleScheduled(queue.shift());
          });
          return Reflect.apply(target, self, args);
        },
      });
    }
  });

  // ---- what goes to the server: each request with whose work it was; requests started in the background
  // are named; the answers are watched for what they change
  const addressOf = (method, url) => {
    try {
      const absolute = new URL(String(url), location.href);
      const parts = absolute.pathname.split('/').map(part => (/^\d+$/.test(part) || /^[0-9a-f]{8,}$/i.test(part) || /^[0-9a-f-]{32,36}$/i.test(part) || (part.length > 24 && /\d/.test(part)) ? '*' : part));
      return `${String(method || 'GET').toUpperCase()} ${absolute.origin}${parts.join('/')}`;
    } catch (_) {
      return `${String(method || 'GET').toUpperCase()} ${String(url).split('?')[0]}`;
    }
  };
  // What a call carries, from the page's own code: the user's identity (a login header, or the user's cookies sent
  // to another site), and whether the browser must ask another site first (another method than GET/HEAD/POST, or
  // headers and content types beyond the plain ones - a CORS preflight). An app's own backend calls do; tracking
  // and ads are built not to.
  const SAFE_HEADERS = new Set(['accept', 'accept-language', 'content-language', 'content-type', 'range']);
  const SAFE_TYPES = new Set(['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']);
  const SIMPLE_METHODS = new Set(['GET', 'HEAD', 'POST']);
  const headersOf = headers => {
    const found = { names: [], contentType: '' };
    if (!headers) return found;
    const add = (name, value) => {
      const lower = String(name).toLowerCase();
      found.names.push(lower);
      if (lower === 'content-type') found.contentType = String(value);
    };
    if (typeof Headers !== 'undefined' && headers instanceof Headers) headers.forEach((value, name) => add(name, value));
    else if (Array.isArray(headers)) {
      for (const pair of headers) if (pair && pair.length >= 2) add(pair[0], pair[1]);
    } else if (typeof headers === 'object') for (const name of Object.keys(headers)) add(name, headers[name]);
    return found;
  };
  const flagsOf = (method, names, contentType, credentials) => ({
    // a login header: the user's own token (ad and tracking code sends cookies, not this)
    auth: names.includes('authorization'),
    identity: names.includes('authorization') || credentials === 'include',
    nonSimple: !SIMPLE_METHODS.has(String(method || 'GET').toUpperCase()) || names.some(name => !SAFE_HEADERS.has(name))
      || (!!contentType && !SAFE_TYPES.has(contentType.split(';')[0].trim().toLowerCase())),
  });
  // Whose code sends a call to another site: the script file of the code that called fetch / XHR (the innermost
  // frame with an address). An app's own calls to its API come from the app's own code; an ad network's or a
  // tracker's from its own script, loaded from its own site - though it may send cookies and read what it gets.
  const callerOf = () => {
    let found = '';
    quietly(() => {
      const match = String(new Error().stack || '').match(/(https?:\/\/[^\s()'"]+?):\d+:\d+/);
      if (match) found = new URL(match[1]).origin;
    });
    return found;
  };
  // fire: the page asked for no answer it could use - keepalive (meant to outlive the page: tracking), or a
  // no-cors request, whose answer the page is not allowed to read
  const sending = (method, url, fire = false, flags = null) => {
    const key = addressOf(method, url);
    const { cause, links } = causeNow();
    if (S.background) {
      backgroundSeen.set(key, now());
      if (backgroundSeen.size > 200) backgroundSeen.delete(backgroundSeen.keys().next().value);
    }
    const identity = !!(flags && flags.identity);
    const auth = !!(flags && flags.auth);
    const nonSimple = !!(flags && flags.nonSimple);
    const reported = fire ? { key, cause, fire: true } : { key, cause };
    // (sent so that the page can stop it: a fetch given an abort signal, an XHR)
    if (flags && flags.abortable) reported.abortable = true;
    if (identity) reported.identity = true;
    if (auth) reported.auth = true;
    if (nonSimple) reported.nonSimple = true;
    // only for a call to another origin: which code sent it
    let from = '';
    quietly(() => { if (new URL(String(url), location.href).origin !== location.origin) from = callerOf(); });
    if (from) reported.from = from;
    sends.push(reported);
    if (sends.length > 200) sends.shift();
    // a timer that just fired sent it (a debounced search): what it sends is part of what it does
    if (timerWindows.length) {
      const t = now();
      for (const watched of timerWindows) if (t >= watched.from && t <= watched.until && watched.sends.size < 10) watched.sends.add(key);
    }
    if (S.armed && cause === S.armed.id) S.armedWork += 1;
    touch(cause);
    return { key, cause, links, identity, auth, nonSimple, from, read: false };
  };
  const responses = new WeakMap();
  const xhrRequests = new WeakMap();
  // A message arriving on a live connection (WebSocket, Server-Sent Events): an answer of its own - the reply to the
  // oldest message the page sent on it (in the last LIVE_PAIR_MS) that has none yet (that step's work), or the
  // server's own news (no step's). One answer per message, however many of the page's handlers take it.
  const LIVE_PAIR_MS = 3000;
  const liveSent = new WeakMap();
  const liveAnswers = new WeakMap();
  const liveAnswer = (socket, event) => {
    let sent = event && typeof event === 'object' ? liveAnswers.get(event) : null;
    if (!sent) {
      const t = now();
      const queue = liveSent.get(socket) || [];
      while (queue.length && t - queue[0].at > LIVE_PAIR_MS) queue.shift();
      const reply = queue.shift();
      const method = window.EventSource && socket instanceof EventSource ? 'SSE' : 'WS';
      const key = addressOf(method, socket.url);
      sent = reply ? { key, cause: reply.cause, links: reply.links, read: false } : { key, cause: 0, links: null, read: false };
      if (event && typeof event === 'object') liveAnswers.set(event, sent);
      delivered(sent.key, sent.cause, 0, sent.links, sent);
      // a handler of the page's own takes the message: it looks at it
      markLooked(sent);
    }
    enterAnswer(sent);
  };
  // the page's own handler of an XHR is about to take its answer in (it is done: answered, failed or stopped) - the
  // code it runs is that answer's
  const xhrAnswer = xhr => {
    const opened = xhrRequests.get(xhr);
    if (!opened || !opened.sent || xhr.readyState !== 4) return;
    delivered(opened.sent.key, opened.sent.cause, 0, opened.sent.links, opened.sent);
    // a handler of the page's own takes the answer: it looks at it
    markLooked(opened.sent);
    enterAnswer(opened.sent);
  };
  quietly(() => {
    if (window.fetch) {
      window.fetch = new Proxy(window.fetch, {
        apply(target, self, args) {
          S.sent += 1;
          let sent = null;
          quietly(() => {
            const input = args[0];
            const init = args[1] || {};
            const isRequest = typeof Request !== 'undefined' && input instanceof Request;
            const keepalive = init.keepalive === true || (isRequest && input.keepalive === true && init.keepalive !== false);
            const mode = init.mode || (isRequest ? input.mode : '');
            const method = init.method || (isRequest ? input.method : 'GET');
            let flags = null;
            quietly(() => {
              const headers = headersOf(init.headers || (isRequest ? input.headers : null));
              flags = flagsOf(method, headers.names, headers.contentType, init.credentials || (isRequest ? input.credentials : ''));
            });
            if (init.signal) flags = { ...(flags || {}), abortable: true };
            sent = sending(method, isRequest ? input.url : input, keepalive || mode === 'no-cors', flags);
          });
          const result = Reflect.apply(target, self, args);
          // ours runs before the page's own callbacks on it (attached first): the page's code that takes the answer
          // in runs as this answer's
          if (sent) {
            quietly(() => result.then(response => {
              quietly(() => responses.set(response, sent));
              quietly(() => delivered(sent.key, sent.cause, 0, sent.links, sent));
              quietly(() => enterAnswer(sent));
            }, () => {
              quietly(() => delivered(sent.key, sent.cause, 0, sent.links, sent));
              quietly(() => enterAnswer(sent));
            }));
          }
          return result;
        },
      });
    }
    // reading the body is when the app gets the data: that moment counts too - and the answer is one the page
    // reads (its data goes into the app, wherever it shows on the screen)
    if (window.Response) {
      for (const name of ['json', 'text', 'blob', 'arrayBuffer', 'formData']) {
        const native = Response.prototype[name];
        if (typeof native !== 'function') continue;
        Response.prototype[name] = new Proxy(native, {
          apply(target, self, args) {
            const result = Reflect.apply(target, self, args);
            const sent = responses.get(self);
            if (sent) {
              quietly(() => markRead(sent));
              quietly(() => result.then(() => {
                quietly(() => delivered(sent.key, sent.cause, 0, sent.links, sent));
                quietly(() => enterAnswer(sent));
              }, () => {}));
            }
            return result;
          },
        });
      }
      // read as a stream (an answer that keeps coming, drawn as it arrives) - and its status or headers looked at
      for (const name of ['body', 'ok', 'status', 'statusText', 'headers', 'redirected', 'type', 'url']) {
        quietly(() => {
          const descriptor = Object.getOwnPropertyDescriptor(Response.prototype, name);
          if (!descriptor || typeof descriptor.get !== 'function') return;
          Object.defineProperty(Response.prototype, name, {
            ...descriptor,
            get: new Proxy(descriptor.get, {
              apply(target, self, args) {
                const sent = responses.get(self);
                if (sent) quietly(() => (name === 'body' ? markRead(sent) : markLooked(sent)));
                return Reflect.apply(target, self, args);
              },
            }),
          });
        });
      }
    }
    const XHR = window.XMLHttpRequest && XMLHttpRequest.prototype;
    if (XHR) {
      XHR.open = new Proxy(XHR.open, {
        apply(target, self, args) {
          quietly(() => xhrRequests.set(self, { method: args[0], url: args[1], names: [], contentType: '', sent: null }));
          return Reflect.apply(target, self, args);
        },
      });
      XHR.setRequestHeader = new Proxy(XHR.setRequestHeader, {
        apply(target, self, args) {
          quietly(() => {
            const opened = xhrRequests.get(self);
            if (!opened) return;
            const name = String(args[0]).toLowerCase();
            opened.names.push(name);
            if (name === 'content-type') opened.contentType = String(args[1]);
          });
          return Reflect.apply(target, self, args);
        },
      });
      XHR.send = new Proxy(XHR.send, {
        apply(target, self, args) {
          S.sent += 1;
          const opened = xhrRequests.get(self);
          if (opened) {
            quietly(() => {
              let flags = null;
              quietly(() => { flags = flagsOf(opened.method, opened.names, opened.contentType, self.withCredentials ? 'include' : ''); });
              const sent = sending(opened.method, opened.url, false, { ...(flags || {}), abortable: true });
              opened.sent = sent;
              // the app's own load handlers may run before this one: the changes just before count too
              nativeAdd.call(self, 'loadend', () => delivered(sent.key, sent.cause, 60, sent.links, sent), { once: true });
            });
          }
          return Reflect.apply(target, self, args);
        },
      });
      // the answer read by the page's code (its load handler takes the text / the parsed answer)
      for (const name of ['responseText', 'response', 'responseXML']) {
        quietly(() => {
          const descriptor = Object.getOwnPropertyDescriptor(XHR, name);
          if (!descriptor || typeof descriptor.get !== 'function') return;
          const getter = descriptor.get;
          Object.defineProperty(XHR, name, {
            ...descriptor,
            get() {
              const opened = xhrRequests.get(this);
              if (opened && opened.sent && this.readyState === 4) quietly(() => markRead(opened.sent));
              return getter.call(this);
            },
          });
        });
      }
    }
    if (navigator.sendBeacon) {
      navigator.sendBeacon = new Proxy(navigator.sendBeacon, {
        apply(target, self, args) {
          S.sent += 1;
          return Reflect.apply(target, self, args);
        },
      });
    }
    if (window.WebSocket) {
      WebSocket.prototype.send = new Proxy(WebSocket.prototype.send, {
        apply(target, self, args) {
          S.sent += 1;
          // a message the page sends on a live connection: its reply is the answer to this step's work (liveAnswer)
          quietly(() => {
            const sent = sending('WS', self.url);
            sent.at = now();
            let queue = liveSent.get(self);
            if (!queue) liveSent.set(self, (queue = []));
            queue.push(sent);
            if (queue.length > 50) queue.shift();
          });
          return Reflect.apply(target, self, args);
        },
      });
    }
    const storageWrite = (proto, names) => {
      for (const name of names) {
        if (proto && typeof proto[name] === 'function') {
          proto[name] = new Proxy(proto[name], {
            apply(target, self, args) {
              S.stored += 1;
              if (S.armed && S.inside === S.armed.id) S.armedWork += 1;
              return Reflect.apply(target, self, args);
            },
          });
        }
      }
    };
    storageWrite(window.Storage && Storage.prototype, ['setItem', 'removeItem', 'clear']);
    storageWrite(window.IDBObjectStore && IDBObjectStore.prototype, ['put', 'add', 'delete', 'clear']);
  });

  // ---- which nodes have handlers (so "visible but not wired up yet" can be seen), whether a handler of
  // the page ran for a press, and that what a step's handlers do is that step's work
  quietly(() => {
    const flagOf = options => (options === true || (options && typeof options === 'object' && options.capture) ? 2 : 1);
    // Which listeners are wrapped, by what they listen to: presses and keys (counted, and no answer's code), an XHR's
    // answer events (the code that takes the answer in: that answer's - see "whose code made a change"), a live
    // connection's messages (each one an answer: liveAnswer), a message port's messages (the answer whose code posted them) and the window's messages (from another frame: no answer
    // of this page's). The same function added for another event or target stays the page's own, unwrapped.
    const kindOf = (node, type) => {
      if (INTERACTION.has(type)) return 'press';
      try {
        if (XHR_EVENTS.has(type) && window.XMLHttpRequest && node instanceof XMLHttpRequest) return 'answer';
        if (type === 'message' && window.MessagePort && node instanceof MessagePort) return 'port';
        if (type === 'message' && ((window.WebSocket && node instanceof WebSocket) || (window.EventSource && node instanceof EventSource))) return 'live';
        if (type === 'message' && node === window) return 'frame';
      } catch (_) {}
      return '';
    };
    const wrapperOf = (listener, type, flag, kind) => {
      let byType = wrappers.get(listener);
      if (!byType) wrappers.set(listener, (byType = new Map()));
      const key = `${flag}|${type}|${kind}`;
      let wrapper = byType.get(key);
      if (!wrapper) {
        wrapper = function (event) {
          if (kind === 'press') {
            if (event && INTERACTION.has(event.type)) {
              S.handled += 1;
              armedEvent();
            }
            if (event && event.isTrusted) quietly(() => enterCtx(KNOWN));
          } else if (kind === 'answer') quietly(() => xhrAnswer(this));
          else if (kind === 'live') quietly(() => liveAnswer(this, event));
          else if (kind === 'port') quietly(() => enterCtx(portCtx(this)));
          else if (kind === 'frame') quietly(() => { if (event && event.source && event.source !== window) enterCtx(KNOWN); });
          if (typeof listener === 'function') return Reflect.apply(listener, this, arguments);
          return listener.handleEvent(event);
        };
        byType.set(key, wrapper);
      }
      return wrapper;
    };
    EventTarget.prototype.addEventListener = new Proxy(nativeAdd, {
      apply(target, self, args) {
        const listener = args[1];
        if (!listener || (typeof listener !== 'function' && typeof listener !== 'object')) return Reflect.apply(target, self, args);
        const flag = flagOf(args[2]);
        // Playwright's own listeners (its injected script puts some on window when an element is looked
        // at from the page's world) are not the page's: left out entirely
        if ((self == null || self === window || self === document) && (String(args[0]).startsWith('__playwright') || /\bInjectedScript\b/.test(String(new Error().stack)))) {
          return Reflect.apply(target, self, args);
        }
        try {
          const node = self == null ? window : self;
          if (node === window || node.nodeType) {
            let types = listeners.get(node);
            if (!types) listeners.set(node, (types = new Map()));
            let entries = types.get(args[0]);
            if (!entries) types.set(args[0], (entries = new Map()));
            entries.set(listener, (entries.get(listener) || 0) | flag);
            if (node !== window) S.lastListener = now();
          }
        } catch (_) {}
        const kind = kindOf(self == null ? window : self, args[0]);
        if (!kind) return Reflect.apply(target, self, args);
        const callArgs = Array.prototype.slice.call(args);
        callArgs[1] = wrapperOf(listener, args[0], flag, kind);
        return Reflect.apply(target, self, callArgs);
      },
    });
    EventTarget.prototype.removeEventListener = new Proxy(nativeRemove, {
      apply(target, self, args) {
        const listener = args[1];
        if (!listener || (typeof listener !== 'function' && typeof listener !== 'object')) return Reflect.apply(target, self, args);
        const flag = flagOf(args[2]);
        try {
          const node = self == null ? window : self;
          const entries = listeners.get(node) && listeners.get(node).get(args[0]);
          if (entries && entries.has(listener)) {
            const left = entries.get(listener) & ~flag;
            if (left) entries.set(listener, left);
            else entries.delete(listener);
          }
        } catch (_) {}
        const byType = wrappers.get(listener);
        const wrapper = byType && byType.get(`${flag}|${args[0]}|${kindOf(self == null ? window : self, args[0])}`);
        if (!wrapper) return Reflect.apply(target, self, args);
        const callArgs = Array.prototype.slice.call(args);
        callArgs[1] = wrapper;
        return Reflect.apply(target, self, callArgs);
      },
    });
    // element.onclick = ... handlers count too (reading el.onclick still gives the page its own function)
    const originals = new WeakMap();
    const counting = handler => {
      const wrapper = function () {
        S.handled += 1;
        armedEvent();
        return Reflect.apply(handler, this, arguments);
      };
      originals.set(wrapper, handler);
      return wrapper;
    };
    const owners = [window.HTMLElement && HTMLElement.prototype, window.SVGElement && SVGElement.prototype, window.Document && Document.prototype, window.Window && Window.prototype, window];
    for (const owner of owners) {
      if (!owner) continue;
      for (const type of INTERACTION) {
        const name = `on${type}`;
        const descriptor = Object.getOwnPropertyDescriptor(owner, name);
        if (!descriptor || typeof descriptor.get !== 'function' || typeof descriptor.set !== 'function' || !descriptor.configurable) continue;
        Object.defineProperty(owner, name, {
          configurable: true,
          enumerable: descriptor.enumerable,
          get: new Proxy(descriptor.get, {
            apply(target, self, args) {
              const value = Reflect.apply(target, self, args);
              return (value && originals.get(value)) || value;
            },
          }),
          set: new Proxy(descriptor.set, {
            apply(target, self, args) {
              const value = args[0];
              return Reflect.apply(target, self, [typeof value === 'function' && !originals.has(value) ? counting(value) : value]);
            },
          }),
        });
      }
    }
    // xhr.onload = ..., port.onmessage = ..., window.onmessage = ...: as their listeners above
    const marking = (handler, kind) => {
      const wrapper = function (event) {
        if (kind === 'answer') quietly(() => xhrAnswer(this));
        else if (kind === 'live') quietly(() => liveAnswer(this, event));
        else if (kind === 'port') quietly(() => enterCtx(portCtx(this)));
        else if (kind === 'frame') quietly(() => { if (event && event.source && event.source !== window) enterCtx(KNOWN); });
        return Reflect.apply(handler, this, arguments);
      };
      originals.set(wrapper, handler);
      return wrapper;
    };
    const markHandlers = (owner, names, kind) => {
      if (!owner) return;
      for (const name of names) {
        quietly(() => {
          const descriptor = Object.getOwnPropertyDescriptor(owner, name);
          if (!descriptor || typeof descriptor.get !== 'function' || typeof descriptor.set !== 'function' || !descriptor.configurable) return;
          Object.defineProperty(owner, name, {
            configurable: true,
            enumerable: descriptor.enumerable,
            get: new Proxy(descriptor.get, {
              apply(target, self, args) {
                const value = Reflect.apply(target, self, args);
                return (value && originals.get(value)) || value;
              },
            }),
            set: new Proxy(descriptor.set, {
              apply(target, self, args) {
                const value = args[0];
                return Reflect.apply(target, self, [typeof value === 'function' && !originals.has(value) ? marking(value, kind) : value]);
              },
            }),
          });
        });
      }
    };
    markHandlers(window.XMLHttpRequestEventTarget && XMLHttpRequestEventTarget.prototype, ['onloadstart', 'onprogress', 'onabort', 'onerror', 'onload', 'ontimeout', 'onloadend'], 'answer');
    markHandlers(window.XMLHttpRequest && XMLHttpRequest.prototype, ['onreadystatechange'], 'answer');
    markHandlers(window.MessagePort && MessagePort.prototype, ['onmessage'], 'port');
    markHandlers(window.WebSocket && WebSocket.prototype, ['onmessage'], 'live');
    markHandlers(window.EventSource && EventSource.prototype, ['onmessage'], 'live');
    for (const owner of [window.Window && Window.prototype, window]) markHandlers(owner, ['onmessage'], 'frame');
  });

  // ---- helpers
  const byId = new Map();
  const idOf = element => {
    if (!element || typeof element !== 'object') return 0;
    let id = ids.get(element);
    if (!id) {
      ids.set(element, (id = nextId++));
      quietly(() => {
        byId.set(id, new WeakRef(element));
        if (byId.size > 2000) byId.delete(byId.keys().next().value);
      });
    }
    return id;
  };
  // A value an earlier step set (fill, select, check): still there? 'gone' = that element is not on the
  // page any more (perhaps drawn again - the caller looks for the new one).
  const checkWatch = watch => {
    const ref = byId.get(watch.id);
    const element = ref && ref.deref();
    if (!element || !element.isConnected) return { id: watch.id, status: 'gone' };
    let undone = false;
    if (watch.kind === 'value') {
      const value = 'value' in element ? String(element.value) : String(element.textContent || '');
      const lost = watch.expected !== '' && value !== watch.expected && (value === '' || value === (watch.before || ''));
      // a field drawn again (a new element) lost it for sure; the same field emptied may have been emptied
      // on purpose when the app used the text (a chips input shows it as a chip): then it is left alone
      undone = lost && (watch.replaced || (String(watch.expected).length >= 3 && !String((document.body && document.body.innerText) || '').includes(watch.expected)));
    } else if (watch.kind === 'checked') {
      const checked = 'checked' in element ? !!element.checked : element.getAttribute('aria-checked') === 'true';
      undone = checked !== watch.expected;
    } else if (watch.kind === 'selected' && element.localName === 'select') {
      const chosen = Array.from(element.selectedOptions).flatMap(option => [option.value, option.label]);
      undone = watch.expected.length > 0 && !watch.expected.some(item => chosen.includes(item));
    }
    return { id: watch.id, status: undone ? 'undone' : 'ok' };
  };
  const contains = (outer, inner) => {
    for (let node = inner; node; node = parentOf(node)) if (node === outer) return true;
    return false;
  };
  const depthBetween = (outer, inner) => {
    let depth = 0;
    for (let node = inner; node; node = parentOf(node), depth += 1) if (node === outer) return depth;
    return Infinity;
  };
  const describe = element => {
    if (!element || !element.localName) return 'element';
    const id = element.id ? `#${element.id}` : '';
    const classes = typeof element.className === 'string' ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(name => `.${name}`).join('') : '';
    return `${element.localName}${id}${classes}`.slice(0, 60);
  };
  const shown = element => {
    try {
      if (typeof element.checkVisibility === 'function' && !element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    } catch (_) {
      return false;
    }
  };
  const inView = box => box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth;
  const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const viewportShare = box => {
    const width = Math.max(0, Math.min(box.right, innerWidth) - Math.max(box.left, 0));
    const height = Math.max(0, Math.min(box.bottom, innerHeight) - Math.max(box.top, 0));
    return (width * height) / Math.max(1, innerWidth * innerHeight);
  };
  // A spinner or busy sign that is about the element: over it, around it, or in the same small box;
  // or a cover over most of the screen.
  const about = (node, target, targetBox) => {
    const box = node.getBoundingClientRect();
    if (viewportShare(box) >= 0.5) return true;
    if (!target) return false;
    if (contains(node, target) || contains(target, node) || (targetBox && overlaps(box, targetBox))) return true;
    const region = regionOf(parentOf(target));
    return !!region && region.localName !== 'body' && region.localName !== 'html' && contains(region, node) && viewportShare(region.getBoundingClientRect()) < 0.5;
  };
  const youngest = (element, t) => {
    let age = Infinity;
    for (let node = element; node && node.nodeType === 1; node = parentOf(node)) {
      const at = inserted.get(node);
      if (at !== undefined) age = Math.min(age, t - at);
    }
    return age;
  };
  // the element changed: in itself or inside, or the box right around it (its parent and grandparent rebuilt,
  // a close container restyled) - not something elsewhere on the page. The page's top (body, html) is not a
  // box around it: toasts, portals and overlays come and go there (one in front of the element is "covered").
  const touchedAge = (element, t, window) => {
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index];
      if (t - record.t >= window) break;
      if (record.hot || !record.target) continue;
      if (record.target === element || contains(element, record.target)) return t - record.t;
      if (record.target.localName === 'body' || record.target.localName === 'html') continue;
      const depth = depthBetween(record.target, element);
      if (depth === Infinity) continue;
      if ((record.type === 'attributes' && depth <= 3) || (record.type !== 'attributes' && depth <= 2)) return t - record.t;
    }
    return Infinity;
  };
  const recentlyTouched = (element, t, window) => youngest(element, t) < window || touchedAge(element, t, window) < window;
  const hasHandler = (element, types) => {
    for (let node = element; node; node = node.nodeType === 9 ? null : parentOf(node)) {
      const map = listeners.get(node);
      for (const type of types) {
        if (map && map.get(type) && map.get(type).size) return true;
        if (typeof node[`on${type}`] === 'function') return true;
        if (node.nodeType === 1 && node.hasAttribute(`on${type}`)) return true;
      }
      if (node.nodeType === 9) break;
    }
    const map = listeners.get(window);
    return types.some(type => (map && map.get(type) && map.get(type).size) || typeof window[`on${type}`] === 'function');
  };

  // ---- where a click lands. Playwright presses the middle of the element's first box and takes anything inside
  // the element there as the element. A different control at that point (a button in the middle of a card) is a
  // different click: the recorder records the nearest control at or below the press, never one above it, so a
  // step naming the card never meant a control inside it - it pressed the card itself (or its plain content),
  // even when that control was drawn only after the recording. What counts as a control mirrors the recorder's
  // own test (isRecordableInteractiveOwner in listeners.js).
  const CONTROL_TAGS = new Set(['a', 'button', 'input', 'label', 'option', 'select', 'summary', 'textarea']);
  const CONTROL_ROLES = new Set(['button', 'checkbox', 'combobox', 'link', 'listbox', 'menuitem', 'option', 'radio', 'switch', 'tab', 'treeitem', 'gridcell', 'listitem', 'row', 'textbox']);
  const CONTROL_ROOT_NAMES = new Set(['autocomplete', 'cascadeselect', 'dropdown', 'multiselect', 'select', 'treeselect']);
  const CLICK_BINDING_ATTRIBUTE = /(?:^|[:@\-(.])click(?:$|[.:)])/i;
  const OWN_CLICK_TYPES = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'];
  const hasOwnClickHandler = element => {
    const map = listeners.get(element);
    if (map) for (const type of OWN_CLICK_TYPES) if (map.get(type) && map.get(type).size) return true;
    try {
      for (const key of Object.keys(element)) {
        if (!key.startsWith('__reactProps$')) continue;
        const props = element[key];
        if (props && (typeof props.onClick === 'function' || typeof props.onMouseDown === 'function' || typeof props.onPointerDown === 'function')) return true;
      }
    } catch (_) {}
    return typeof element.onclick === 'function' || element.hasAttribute('onclick');
  };
  const isControl = element => {
    if (!element || element.nodeType !== 1) return false;
    const tag = element.localName;
    if (tag === 'html' || tag === 'body') return false;
    if (CONTROL_TAGS.has(tag)) return !(tag === 'input' && element.type === 'hidden');
    const role = String(element.getAttribute('role') || '').trim().toLowerCase();
    if (CONTROL_ROLES.has(role)) return true;
    const popup = String(element.getAttribute('aria-haspopup') || '').trim().toLowerCase();
    if (popup && popup !== 'false') return true;
    if (element.isContentEditable) return true;
    if (tag === 'li' && (element.hasAttribute('data-label') || element.hasAttribute('data-value'))) return true;
    const rootName = String(element.getAttribute('data-pc-name') || '').trim().toLowerCase();
    const rootSection = String(element.getAttribute('data-pc-section') || '').trim().toLowerCase();
    if ((rootSection === 'root' || !rootSection) && CONTROL_ROOT_NAMES.has(rootName)) return true;
    for (const attribute of element.attributes) if (CLICK_BINDING_ATTRIBUTE.test(attribute.name)) return true;
    if (element.hasAttribute('tabindex') && Number(element.getAttribute('tabindex')) >= 0) return true;
    return hasOwnClickHandler(element);
  };
  // the element under a point, inside shadow roots too
  const deepHit = (x, y) => {
    let hit = document.elementFromPoint(x, y);
    for (let depth = 0; hit && hit.shadowRoot && depth < 10; depth += 1) {
      const inner = hit.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    return hit;
  };
  // the control between a hit and the element (exclusive), if any
  const controlBetween = (element, hit) => {
    for (let node = hit; node && node !== element; node = parentOf(node)) if (isControl(node)) return node;
    return null;
  };
  // the point Playwright presses: the element's first box cut to the window, its middle
  const pressPoint = element => {
    for (const box of Array.from(element.getClientRects())) {
      const left = Math.max(box.left, 0);
      const top = Math.max(box.top, 0);
      const right = Math.min(box.right, innerWidth);
      const bottom = Math.min(box.bottom, innerHeight);
      if ((right - left) * (bottom - top) > 0.99) return { x: (left + right) / 2, y: (top + bottom) / 2 };
    }
    return null;
  };
  // null: the middle is the element or its own content. Otherwise where to press instead, as Playwright's
  // `position` (from the top-left corner of the padding box): a point of the element itself, else of its plain
  // content (no control in between), nearest the middle first; kind 'none' when there is neither.
  const clickSpot = element => {
    const point = pressPoint(element);
    if (!point) return null;
    const hit = deepHit(point.x, point.y);
    if (!hit || !contains(element, hit)) return null;
    const other = controlBetween(element, hit);
    if (!other) return null;
    // a label's own control: the browser sends a click on the label to it anyway - the same click
    if (element.localName === 'label' && element.control && (other === element.control || contains(element.control, other))) return null;
    const rect = element.getBoundingClientRect();
    const left = Math.max(rect.left, 0) + 3;
    const top = Math.max(rect.top, 0) + 3;
    const right = Math.min(rect.right, innerWidth) - 3;
    const bottom = Math.min(rect.bottom, innerHeight) - 3;
    let own = null;
    let plain = null;
    if (right > left && bottom > top) {
      const points = [];
      for (let column = 0; column <= 12; column += 1) {
        for (let row = 0; row <= 8; row += 1) points.push({ x: left + ((right - left) * column) / 12, y: top + ((bottom - top) * row) / 8 });
      }
      points.sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y));
      for (const candidate of points) {
        const at = deepHit(candidate.x, candidate.y);
        if (!at || !contains(element, at)) continue;
        if (at === element) {
          own = candidate;
          break;
        }
        if (!plain && !controlBetween(element, at)) plain = candidate;
      }
    }
    const spot = own || plain;
    let border = { left: 0, top: 0 };
    quietly(() => {
      const style = getComputedStyle(element);
      border = { left: parseInt(style.borderLeftWidth, 10) || 0, top: parseInt(style.borderTopWidth, 10) || 0 };
    });
    const origin = { x: rect.left + border.left, y: rect.top + border.top };
    const round = value => Math.round(value * 100) / 100;
    return {
      kind: own ? 'own' : plain ? 'plain' : 'none',
      element: describe(element),
      middle: `${describe(other)}${other.textContent && other.textContent.trim() ? ` "${other.textContent.trim().replace(/\s+/g, ' ').slice(0, 30)}"` : ''}`,
      x: spot ? round(spot.x - origin.x) : 0,
      y: spot ? round(spot.y - origin.y) : 0,
    };
  };
  // a press done by script on the element itself, the whole sequence (for apps that act on the press)
  const scriptPress = element => {
    const point = pressPoint(element) || { x: 0, y: 0 };
    const init = { bubbles: true, cancelable: true, composed: true, clientX: point.x, clientY: point.y, button: 0, detail: 1, view: window };
    const fire = (Type, type, buttons) => quietly(() => element.dispatchEvent(new Type(type, { ...init, buttons, pointerId: 1, pointerType: 'mouse', isPrimary: true })));
    const PointerType = window.PointerEvent || MouseEvent;
    fire(PointerType, 'pointerdown', 1);
    fire(MouseEvent, 'mousedown', 1);
    fire(PointerType, 'pointerup', 0);
    fire(MouseEvent, 'mouseup', 0);
    fire(MouseEvent, 'click', 0);
    return true;
  };

  const worksWithoutScript = element => {
    for (let node = element; node && node.nodeType === 1; node = parentOf(node)) {
      const tag = node.localName;
      if ((tag === 'a' || tag === 'area') && node.hasAttribute('href')) return true;
      if (tag === 'button' && node.form && /^(submit|reset|)$/i.test(node.getAttribute('type') || '')) return true;
      if (tag === 'input' && node.type !== 'hidden') return true;
      if (['select', 'textarea', 'option', 'summary', 'label', 'details', 'video', 'audio'].includes(tag)) return true;
      if (node.isContentEditable) return true;
    }
    return false;
  };
  const STATEFUL_ROLES = /^(checkbox|radio|switch|tab|option|menuitemcheckbox|menuitemradio|treeitem|button)$/;
  const isStateful = element => {
    for (let node = element; node && node.nodeType === 1; node = parentOf(node)) {
      if (['aria-pressed', 'aria-checked', 'aria-expanded', 'aria-selected'].some(name => node.hasAttribute(name))) return true;
      const role = node.getAttribute('role') || '';
      if (role !== 'button' && STATEFUL_ROLES.test(role)) return true;
      if (node.localName === 'input' && /^(checkbox|radio)$/i.test(node.type)) return true;
      if (node.localName === 'button' || node.localName === 'a') break;
    }
    return false;
  };
  const isOpener = element => !!element && (element.hasAttribute('aria-expanded') || element.hasAttribute('aria-haspopup') || element.localName === 'select' || element.localName === 'summary' || element.localName === 'details');
  const linkOf = element => {
    for (let node = element; node && node.nodeType === 1; node = parentOf(node)) {
      if ((node.localName === 'a' || node.localName === 'area') && node.hasAttribute('href')) {
        const href = node.getAttribute('href') || '';
        if (/^\s*(javascript:|#)/i.test(href)) return null;
        return { link: node.href, blank: /^_blank$/i.test(node.getAttribute('target') || ''), download: node.hasAttribute('download') };
      }
    }
    return null;
  };
  const inMotion = (element, t, animatedTargets) => {
    for (let node = element; node && node.nodeType === 1; node = parentOf(node)) {
      if (animatedTargets.has(node)) return true;
    }
    return recentlyTouched(element, t, 1000);
  };
  const stateOf = element => (element ? { value: 'value' in element ? String(element.value) : null, checked: 'checked' in element ? !!element.checked : null } : null);

  // ---- what the last press led to
  const DOWN_EVENTS = new Set(['pointerdown', 'mousedown', 'touchstart']);
  // the press landed on the element, the click did not: it moved while pressed, and the browser clicks
  // what is under both the press and the release (something around it) - and nothing at all answered the
  // press or that click (no change made by the step's work, no request, timer or storage write, no address
  // change, nothing cancelled). An element that acts on the press itself has answered it.
  const slippedOff = (gesture, element) => {
    if (!element || !element.isConnected || gesture.kind !== 'pointer') return false;
    const inside = node => !!node && contains(element, node);
    let pressed = false;
    for (let index = 0; index < gesture.events.length; index += 1) {
      const event = gesture.events[index];
      const target = gesture.targets[index];
      if (DOWN_EVENTS.has(event.type)) {
        if (!inside(target)) return false;
        pressed = true;
      }
      if (event.type === 'click' && inside(target)) return false;
      if (event.defaultPrevented) return false;
    }
    if (!pressed || !gesture.events.some(event => event.type === 'click' || event.type === 'pointerup' || event.type === 'mouseup' || event.type === 'touchend')) return false;
    if (S.armedWork > gesture.work || S.lastUrl >= gesture.started) return false;
    const id = S.armed && S.armed.id;
    for (let index = records.length - 1; index >= 0 && records[index].t >= gesture.started; index -= 1) {
      if (records[index].cause === id) return false;
    }
    return true;
  };
  const gestureReport = element => {
    const gesture = S.gesture;
    if (!gesture) return null;
    const t = now();
    // any change at all counts here, the endlessly changing parts too: in doubt, it did something
    const changed = records.length > 0 && records[records.length - 1].t >= gesture.started;
    const targetNow = gesture.events[0] && gesture.events[0].target;
    const effect = changed || S.lastUrl >= gesture.started || S.scheduled > gesture.scheduled || S.stored > gesture.stored || S.sent > gesture.sent || (gesture.kind === 'key' && activeNow() !== gesture.active);
    let clickedOn = '';
    for (let index = 0; index < gesture.events.length; index += 1) if (gesture.events[index].type === 'click') clickedOn = describe(gesture.targets[index]);
    return {
      age: Math.round(t - gesture.started),
      handled: S.handled - gesture.handled,
      prevented: gesture.events.some(event => event.defaultPrevented),
      effect,
      target: describe(targetNow),
      slipped: slippedOff(gesture, element),
      clickedOn,
    };
  };

  // ---- one look: what still keeps this step from going
  const assess = (elements, options) => {
    onMutations(observer.takeRecords());
    const t = now();
    closeDeliveries(t);
    const quiet = quietMs();
    const ignore = new Set(options.ignore || []);
    const follow = options.mode === 'follow';
    const light = !!options.light;
    const reasons = [];
    const add = (kind, key, text) => {
      if (key && ignore.has(key)) return;
      if (reasons.length < 12) reasons.push({ kind, key, text });
    };
    if (options.arm) {
      if (!S.armed || S.armed.id !== options.arm) S.armed = { id: options.arm, at: t, last: t };
      S.everArmed = true;
    }
    if (options.endStart) S.everArmed = true;
    const report = {
      count: elements ? elements.length : -1,
      ids: elements ? elements.map(idOf) : [],
      reasons,
      quietMs: quiet,
      // still starting up: the document is not loaded (scripts still loading are seen by the caller)
      booting: document.readyState !== 'complete',
      background: [],
      page: pagePathNow(),
    };
    if (options.watch && options.watch.length) report.watch = options.watch.map(checkWatch);
    // the page's script files as this document has them (their names change with each new build of the app):
    // said once per document
    if (!S.scriptsSaid) {
      S.scriptsSaid = true;
      quietly(() => {
        const urls = [];
        for (const script of document.querySelectorAll('script[src], link[rel="modulepreload"][href], link[rel="preload"][as="script"][href]')) {
          const url = script.src || script.href;
          if (url && urls.length < 60) urls.push(String(url));
        }
        report.scripts = urls;
      });
    }
    for (const [key, at] of backgroundSeen) if (t - at < 60000) report.background.push(key);
    // (after a step that brought a new page: the next step waits for the rest of it, when it acts)
    if (!follow && document.readyState === 'loading') add('document', null, 'the document is still loading');

    let target = null;
    if (!follow) {
      if (elements && elements.length >= 1) target = elements[0];
      else if (options.point) target = document.elementFromPoint(options.point.x, options.point.y);
      else if (options.active) target = activeNow();
    }
    const targetBox = target && target.isConnected ? target.getBoundingClientRect() : null;
    if (target && target.isConnected) report.chain = chainOf(target);

    // short timers: set by this step (after it), by the earlier steps or the page's start (before a step).
    // After a step that already visibly answered - the page changed because of it, or its address did - its
    // timers are its own housekeeping (analytics batching and the like), not more of its answer.
    let answered = false;
    const gesture = S.gesture;
    if (follow && gesture && S.armed && S.armed.id === options.step && gesture.started >= S.armed.at) {
      if (S.lastUrl >= gesture.started) answered = true;
      for (let index = records.length - 1; !answered && index >= 0 && records[index].t >= gesture.started; index -= 1) {
        if (records[index].cause === options.step) answered = true;
      }
    }
    if (!light && !answered) {
      let pending = 0;
      for (const [id, timer] of timers) {
        if (t > timer.due + 2000) {
          timers.delete(id);
          continue;
        }
        if (timer.chain || !timer.cause) continue;
        if (follow) {
          if (timer.cause !== options.step) continue;
          if (pending++ < 3) add('timer', `timer ${timer.key}`, `a timer fires in ${Math.max(0, Math.round(timer.due - t))} ms (set by this step, ${Math.round(timer.delay)} ms)`);
        } else if (pending++ < 20) {
          // before a step: whether it matters to this element is known from what it did before (decided by the caller)
          // setAt: when it was set (wall-clock ms, as the test's process counts them)
          (report.timers = report.timers || []).push({
            key: timer.key, in: Math.max(0, Math.round(timer.due - t)), start: timer.cause === LOAD_CAUSE, delay: Math.round(timer.delay),
            setAt: Math.round((performance.timeOrigin || 0) + timer.due - timer.delay), by: timer.by || '',
          });
        }
      }
    }
    // the step's own short timers not fired yet (whatever the page did meanwhile): its work is still under way
    if (options.step) {
      let own = 0;
      for (const timer of timers.values()) if (timer.cause === options.step && !timer.chain) own += 1;
      report.stepTimers = own;
    }
    // still busy with the step's own work - until the page visibly answered it (what follows is then covered:
    // the step's own requests are still followed, late answers are said)
    if (follow && !answered && S.armed && S.armed.id === options.step && t - S.armed.last < quiet) add('reacting', null, 'the page is still reacting to the step');
    // fonts still loading reflow the text when they arrive - which they do early; one still loading after a
    // while is stuck (a font file that never answers) and holds no step up
    if (!light && !follow && document.fonts && document.fonts.status === 'loading') {
      if (!fontsLoadingSince) fontsLoadingSince = t;
      // the faces still loading, without those remembered as never arriving (the browser not saying which: all)
      const quietFonts = new Set(options.quietFonts || []);
      let loading = [];
      quietly(() => { loading = [...document.fonts].filter(face => face.status === 'loading').map(face => String(face.family)); });
      const waiting = [...new Set(loading.filter(family => !quietFonts.has(family)))];
      if (t - fontsLoadingSince < FONT_PATIENCE_MS) {
        if (waiting.length || !loading.length) add('fonts', 'fonts', 'fonts are loading');
      } else if (waiting.length) {
        // still loading after the whole wait: never arriving - said, so that later visits do not wait for them
        report.stuckFonts = waiting;
      }
    }
    // a family remembered as never arriving that did arrive this time: waited for again on this page
    if (!light && !follow && document.fonts && options.quietFonts && options.quietFonts.length) {
      const quietFonts = new Set(options.quietFonts);
      let arrived = [];
      quietly(() => { arrived = [...document.fonts].filter(face => face.status === 'loaded' && quietFonts.has(String(face.family))).map(face => String(face.family)); });
      if (arrived.length) report.fontsArrived = [...new Set(arrived)];
    }

    // animations: finite ones on or around the element, or big ones (a dialog, a page sliding in) when it
    // is not there yet; endless ones on fresh visible elements next to it - a spinner or a skeleton - or
    // covering most of the screen. Nothing elsewhere on the page.
    const animatedTargets = new Set();
    const quietSpinners = new Set(options.quietSpinners || []);
    if (!light) {
      let animations = [];
      try {
        animations = document.getAnimations ? document.getAnimations() : [];
      } catch (_) {}
      const timelineNow = document.timeline && typeof document.timeline.currentTime === 'number' ? document.timeline.currentTime : t;
      for (const animation of animations) {
        if (animation.playState !== 'running') continue;
        const effect = animation.effect;
        const node = effect && effect.target;
        if (!node || node.nodeType !== 1) continue;
        let timing;
        try {
          timing = effect.getComputedTiming();
        } catch (_) {
          continue;
        }
        if (timing.endTime === Infinity || timing.activeDuration === Infinity) {
          const age = typeof animation.startTime === 'number' ? timelineNow - animation.startTime : 0;
          if (shown(node) && about(node, target, targetBox)) {
            const name = describe(node);
            if (age >= SPINNER_FRESH_MS) {
              // still spinning after the whole patience: remembered for this page, not waited for next time
              report.staleSpinners = report.staleSpinners || [];
              if (!report.staleSpinners.includes(name)) report.staleSpinners.push(name);
            } else if (quietSpinners.has(name)) {
              // remembered as never stopping: not waited for - but watched, in case it stops after all
              if (!spinnerWatch.has(name)) spinnerWatch.set(name, { node, first: t - age });
            } else add('busy', `spinner ${name}`, `${name} is spinning`);
          }
          continue;
        }
        const left = timing.endTime - (timing.localTime || 0);
        if (!(left > 0) || left > ANIMATION_MAX_LEFT) continue;
        animatedTargets.add(node);
        if (follow) continue;
        let near;
        if (target) near = contains(node, target) || contains(target, node) || (targetBox && overlaps(node.getBoundingClientRect(), targetBox));
        else near = shown(node) && viewportShare(node.getBoundingClientRect()) >= 0.25;
        if (near) add('animation', `animation ${describe(node)}`, `${describe(node)} is animating`);
      }
      // a remembered "never stopping" spinner that did stop, within the patience: a real, short spinner after all
      for (const [name, watched] of spinnerWatch) {
        if (watched.node.isConnected && spinsEndlessly(watched.node)) continue;
        spinnerWatch.delete(name);
        if (t - watched.first < SPINNER_FRESH_MS) (report.spinnerDone = report.spinnerDone || []).push(name);
      }
      quietly(() => {
        for (const node of document.querySelectorAll('[aria-busy="true"],[role="progressbar"]')) {
          if (node.getAttribute('role') === 'progressbar' && node.hasAttribute('aria-valuenow')) continue;
          if (!shown(node) || !about(node, target, targetBox)) continue;
          let since = inserted.has(node) ? inserted.get(node) : -1e9;
          for (let index = records.length - 1; index >= 0; index -= 1) {
            if (records[index].target === node) {
              since = Math.max(since, records[index].t);
              break;
            }
          }
          if (since === -1e9 ? t > BUSY_FRESH_MS : t - since > BUSY_FRESH_MS) continue;
          add('busy', `busy ${describe(node)}`, `${describe(node)} says it is busy`);
        }
      });
    }

    if (target && target.isConnected && !follow) {
      const box = targetBox;
      if (!light) {
        if (recentlyTouched(target, t, quiet)) add('rendering', null, 'the element is still rendering');
        const seen = rectSeen.get(target);
        const same = seen && Math.abs(seen.box.x - box.x) < 1 && Math.abs(seen.box.y - box.y) < 1 && Math.abs(seen.box.width - box.width) < 1 && Math.abs(seen.box.height - box.height) < 1;
        if (!same) rectSeen.set(target, { box, since: t });
        const pageStill = t - S.lastGlobal >= quiet && t - S.lastLayout >= quiet;
        if (!pageStill && (!same || t - seen.since < quiet)) add('moving', null, 'the element is still moving');
      }
      if (options.pointer && !options.active && !light) {
        if (!inView(box) && !options.point) {
          // out of sight: bring it to the middle once, then let it settle there (lazy loading, sticky headers)
          const last = scrolledAt.get(target);
          if (box.width > 0 && box.height > 0 && (!last || t - last > 2000)) {
            scrolledAt.set(target, t);
            quietly(() => {
              target.scrollIntoView({ block: 'center', inline: 'center' });
              add('scrolling', null, 'scrolling to the element');
            });
          }
        } else if (inView(box)) {
          const x = Math.min(Math.max(box.left + box.width / 2, 0), innerWidth - 1);
          const y = Math.min(Math.max(box.top + box.height / 2, 0), innerHeight - 1);
          const root = target.getRootNode && target.getRootNode();
          const hit = root && typeof root.elementFromPoint === 'function' ? root.elementFromPoint(x, y) : document.elementFromPoint(x, y);
          const viaLabel = target.labels && Array.prototype.some.call(target.labels, label => hit && contains(label, hit));
          if (hit && !contains(target, hit) && !viaLabel && !options.point && inMotion(hit, t, animatedTargets)) add('covered', null, `${describe(hit)} is over the element`);
          // a click whose middle is a different control: where to press instead
          if (options.spot) quietly(() => { report.spot = clickSpot(target); });
        }
        let modal = null;
        quietly(() => { modal = document.querySelector('dialog:modal'); });
        const blocker = (target.closest && target.closest('[inert]')) || (modal && !contains(modal, target) ? modal : null);
        if (blocker && inMotion(blocker, t, animatedTargets)) add('blocked', null, `${describe(blocker)} is in front of the element`);
      }
      // handlers: for a click, natively working elements (links, inputs, labels, submit buttons) need none;
      // typing needs the page's input handlers while the page is starting up
      if (options.wired) {
        const typing = options.wired.includes('input');
        if ((typing || !worksWithoutScript(target)) && !hasHandler(target, options.wired)) report.unwired = true;
      }
      if (options.wantTarget) {
        const link = linkOf(target);
        report.target = {
          // the element itself, for the look at its hidden needs - and its parts of the page as the memory names them
          watchId: idOf(target),
          stops: stopsWork(target),
          names: namesOf(target),
          native: worksWithoutScript(target),
          stateful: isStateful(target),
          opener: isOpener(target),
          link: link ? link.link : null,
          blank: link ? link.blank : false,
          download: link ? link.download : false,
          ...stateOf(target),
        };
      }
    } else if (!follow && !light && options.globalDom && elements && elements.length > 1 && t - S.lastGlobal < quiet && !ignore.has('dom')) {
      add('rendering', 'dom', 'the page is still changing');
    }
    if (follow) {
      report.gesture = gestureReport(elements && elements.length === 1 ? elements[0] : null);
      report.answered = answered;
      // the step's own code put a control on the page that stops its work: the app is used while that work runs
      if (gesture && S.armed && S.armed.id === options.step) report.stopControl = stopControlSince(gesture.started);
    }
    report.ready = reasons.length === 0;
    // where the element lives (a step inside another site's frame - reached by a frame locator - waits for that
    // frame's own calls: stepSite)
    quietly(() => { report.origin = location.origin; });
    // (inside a frame: the debugger's look at what a button's code uses covers the main frame only)
    quietly(() => { report.top = window === window.top; });
    return report;
  };

  const probe = (elements, options) => new Promise(resolve => {
    const started = now();
    let lastFrame = 0;
    const look = () => {
      let report;
      try {
        report = assess(elements, options);
      } catch (error) {
        report = { count: elements ? elements.length : -1, ids: [], reasons: [], quietMs: quietMs(), error: String(error && error.message || error) };
      }
      const t = now();
      if (report.ready || t - started >= (options.sliceMs || 0) || report.error) {
        report.waitedMs = Math.round(t - started);
        // what was sent and what the answers changed since the last look - taken once, with the answer
        closeDeliveries(t);
        report.sends = sends.splice(0, sends.length);
        report.reads = readsSaid.splice(0, readsSaid.length);
        report.deliveries = finishedDeliveries.splice(0, finishedDeliveries.length);
        report.timerOutcomes = finishedTimers.splice(0, finishedTimers.length);
        resolve(report);
        return;
      }
      let done = false;
      const next = stamp => {
        if (done) return;
        done = true;
        if (typeof stamp === 'number') {
          if (lastFrame) S.frameMs = S.frameMs * 0.8 + Math.min(200, stamp - lastFrame) * 0.2;
          lastFrame = stamp;
        } else lastFrame = 0;
        look();
      };
      if (nativeRaf && document.visibilityState === 'visible') nativeRaf.call(window, next);
      nativeSetTimeout.call(window, next, 40);
    };
    look();
  });

  // what the answers changed, for a request still being learned (no step needed)
  const drain = all => {
    const t = now();
    onMutations(observer.takeRecords());
    closeDeliveries(all ? Infinity : t);
    return {
      deliveries: finishedDeliveries.splice(0, finishedDeliveries.length),
      timerOutcomes: finishedTimers.splice(0, finishedTimers.length),
      sends: sends.splice(0, sends.length),
      reads: readsSaid.splice(0, readsSaid.length),
      open: deliveries.length + timerWindows.length,
      page: pagePathNow(),
      top: (() => {
        let top = true;
        quietly(() => { top = window === window.top; });
        return top;
      })(),
    };
  };
  const arm = id => {
    S.armed = { id, at: now(), last: now() };
    S.everArmed = true;
  };
  // ---- what an element's own code keeps (for the look at its hidden needs - Chrome, Edge: see hiddenLook): the
  // functions that run when it is pressed - the page's listeners on it and on the boxes around it up to the body,
  // React's and Vue's handlers on them, their on... handlers. Only looked at, never called.
  const PRESS_EVENTS = ['click', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'keydown', 'submit', 'change', 'input'];
  const REACT_HANDLERS = ['onClick', 'onClickCapture', 'onMouseDown', 'onPointerDown', 'onMouseUp', 'onPointerUp', 'onKeyDown', 'onSubmit', 'onChange', 'onInput'];
  const elementOf = id => {
    const ref = byId.get(id);
    const element = ref && ref.deref();
    return element && element.isConnected ? element : null;
  };
  const pressHandlers = element => {
    const found = [];
    const add = fn => {
      if (typeof fn !== 'function' || found.includes(fn) || found.length >= 6) return;
      found.push(fn);
      // Vue 2 keeps the handler on its invoker
      quietly(() => {
        const inner = fn.fns;
        if (typeof inner === 'function') add(inner);
        else if (Array.isArray(inner)) inner.forEach(add);
      });
    };
    quietly(() => {
      for (let node = element, depth = 0; node && node.nodeType === 1 && depth < 8 && found.length < 6; node = parentOf(node), depth += 1) {
        if (node.localName === 'body' || node.localName === 'html') break;
        const types = listeners.get(node);
        if (types) {
          for (const type of PRESS_EVENTS) {
            const entries = types.get(type);
            if (entries) for (const listener of entries.keys()) add(typeof listener === 'function' ? listener : listener && listener.handleEvent);
          }
        }
        for (const type of PRESS_EVENTS) {
          let own = null;
          try { own = node[`on${type}`]; } catch (_) {}
          add(own);
        }
        for (const key of Object.keys(node)) {
          if (key.startsWith('__reactProps$') || key.startsWith('__reactEventHandlers$')) {
            const props = node[key];
            if (props) for (const name of REACT_HANDLERS) add(props[name]);
          } else if (key.startsWith('__zone_symbol__') && PRESS_EVENTS.some(type => key === `__zone_symbol__${type}false` || key === `__zone_symbol__${type}true`)) {
            // zone.js (Angular) listens with one callback of its own and keeps the page's listeners as its tasks
            const tasks = node[key];
            if (Array.isArray(tasks)) for (const task of tasks) add(task && task.callback);
          } else if (/^jQuery\d+$/.test(key) && node[key] && node[key].events) {
            const events = node[key].events;
            for (const type of PRESS_EVENTS) if (Array.isArray(events[type])) for (const handle of events[type]) add(handle && handle.handler);
          } else if (key === '_vei' && node._vei) {
            for (const name of Object.keys(node._vei)) {
              const value = node._vei[name] && node._vei[name].value;
              if (Array.isArray(value)) value.forEach(add);
              else add(value);
            }
          }
        }
      }
    });
    return found;
  };
  // a control whose code stops the app's work (see stopsWork in the checks): it calls one of these on something
  const STOP_CALLS = /\.\s*(?:abort|abortAll|cancelAll|unsubscribe|terminate)\s*\(|\.\s*cancel\s*\(\s*\)/;
  const stopsWork = element => {
    let stops = false;
    quietly(() => {
      for (const fn of pressHandlers(element).slice(0, 4)) {
        let code = '';
        try {
          code = toSource.call(fn);
        } catch (_) {}
        if (STOP_CALLS.test(code)) stops = true;
      }
    });
    return stops;
  };
  const stopControlSince = since => {
    let found = false;
    quietly(() => {
      const candidates = document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a[href]');
      let looked = 0;
      for (const element of candidates) {
        if (found || looked >= 200) break;
        // put on the page since (itself or a part around it), or changed since (shown)
        let fresh = false;
        for (let node = element; node && node.nodeType === 1 && !fresh; node = parentOf(node)) {
          const at = inserted.get(node);
          if (at !== undefined && at >= since) fresh = true;
        }
        for (let index = records.length - 1; !fresh && index >= 0 && records[index].t >= since; index -= 1) {
          if (records[index].target === element) fresh = true;
        }
        if (!fresh) continue;
        looked += 1;
        if (shown(element) && stopsWork(element)) found = true;
      }
    });
    return found;
  };
  const handlersById = id => {
    const element = elementOf(id);
    return element ? pressHandlers(element) : [];
  };
  // a watched element: still there, its name, the parts of the page it is in (as the memory names them)
  const watchInfo = list => list.map(id => {
    const element = elementOf(id);
    return element ? { id, there: true, name: describe(element), names: namesOf(element), handlers: pressHandlers(element).length } : { id, there: false };
  });
  // the learning run looks at every control on the page: what can be pressed and has code of its own to run
  const pressables = limit => {
    const out = [];
    quietly(() => {
      const candidates = document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="link"], [role="option"], [role="menuitem"], [role="tab"], [role="checkbox"], [onclick], [tabindex]');
      for (const element of candidates) {
        if (out.length >= limit) break;
        if (!shown(element) || !pressHandlers(element).length) continue;
        out.push(idOf(element));
      }
    });
    return out;
  };

  // ---- what a control's code uses, by name (every browser: Firefox and WebKit have no debugger that shows a closure).
  // The names its press handlers' code mentions that are the page's own - not a property after a dot, an object key, a
  // keyword, the code's own parameters and variables, or anything the browser itself provides (the names the window
  // has before the page's scripts run) - read where the page's top level has them: a page script's variables and
  // functions (a function among them is read the same way, one level down). A value kept inside a function or a
  // bundle cannot be reached by name: the look then says it did not see everything (complete: false).
  const BROWSER_NAMES = new Set();
  quietly(() => {
    for (let object = window; object; object = Object.getPrototypeOf(object)) for (const name of Object.getOwnPropertyNames(object)) BROWSER_NAMES.add(name);
  });
  const codeNames = makeCodeNames(BROWSER_NAMES);
  const codeCache = new WeakMap();
  const namesOfCode = fn => {
    let known = codeCache.get(fn);
    if (!known) {
      let text = '';
      try { text = toSource.call(fn); } catch (_) {}
      // (a browser's own function, or a bound one: its code is not there to read)
      known = !text || /\{\s*\[native code\]\s*\}\s*$/.test(text) ? { names: [], ambiguous: true } : codeNames(text);
      codeCache.set(fn, known);
    }
    return known;
  };
  const describeGetter = (object, name) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    return descriptor && descriptor.get;
  };
  const mapSize = describeGetter(Map.prototype, 'size');
  const setSize = describeGetter(Set.prototype, 'size');
  const getTime = Date.prototype.getTime;
  const objectKind = Object.prototype.toString;
  const PLAIN = new Set([Object.prototype, Array.prototype, null]);
  // a value as text, two levels down - own data fields only (an accessor would run the page's code: not read)
  const fingerprint = (out, path, value, depth, look) => {
    if (look.budget <= 0) { look.truncated = true; return; }
    if (typeof value === 'function') return;
    if (value === null || typeof value !== 'object') {
      look.budget -= 1;
      out.push([path, `${typeof value}:${String(value).slice(0, 80)}`]);
      return;
    }
    let kind = 'Object';
    try { kind = objectKind.call(value).slice(8, -1); } catch (_) { look.truncated = true; return; }
    if ((typeof Node === 'function' && value instanceof Node) || value === window || /^(Window|HTMLDocument|Document|.*Event|CSSStyleDeclaration|Location|Navigator)$/.test(kind)) return;
    look.budget -= 1;
    if (kind === 'Map' || kind === 'Set') {
      let size = -1;
      try { size = (kind === 'Map' ? mapSize : setSize).call(value); } catch (_) {}
      out.push([path, `${kind}:${size}`]);
      if (size !== 0) look.truncated = true;
      return;
    }
    if (kind === 'Date') {
      let time = '';
      try { time = getTime.call(value); } catch (_) {}
      out.push([path, `Date:${time}`]);
      return;
    }
    if (kind !== 'Array' && kind !== 'Object') {
      out.push([path, kind]);
      look.truncated = true;
      return;
    }
    let names = [];
    let symbols = 0;
    let prototype = null;
    try {
      names = Object.getOwnPropertyNames(value).filter(name => !(kind === 'Array' && name === 'length'));
      symbols = Object.getOwnPropertySymbols(value).length;
      prototype = Object.getPrototypeOf(value);
    } catch (_) {
      look.truncated = true;
      return;
    }
    out.push([path, `${kind}:${names.length}`]);
    // (a class's instance may keep more than its own fields show)
    if (symbols || !PLAIN.has(prototype)) look.truncated = true;
    const fields = names.filter(name => !/^[_$]|_$/.test(name));
    if (fields.length < names.length) look.truncated = true;
    if (depth >= 2) {
      if (fields.length) look.truncated = true;
      return;
    }
    const limit = kind === 'Array' ? 10 : 30;
    if (fields.length > limit) look.truncated = true;
    for (const name of fields.slice(0, limit)) {
      let descriptor = null;
      try { descriptor = Object.getOwnPropertyDescriptor(value, name); } catch (_) {}
      if (!descriptor || descriptor.get || descriptor.set) { look.truncated = true; continue; }
      fingerprint(out, `${path}.${name}`, descriptor.value, depth + 1, look);
    }
  };
  // whether reading this name could run the page's code: a getter or setter for it on the window or what it inherits
  // from (an element's id there - the browser's named access - or a plain value runs nothing)
  const accessorOf = name => {
    for (let object = window; object; object = Object.getPrototypeOf(object)) {
      let descriptor = null;
      try {
        descriptor = Object.getOwnPropertyDescriptor(object, name);
      } catch (_) {
        return true;
      }
      if (descriptor) return !!(descriptor.get || descriptor.set);
    }
    return false;
  };
  // read: the reader Playwright's evaluation hands in (a page whose security policy forbids eval still allows it).
  // exact: everything reached was read in full (no name it was unsure of, no accessor, nothing cut); unreached: the
  // names the code uses that are not the page's top level's (a function's or a bundle's own - the debugger's closure
  // look covers those in Chrome and Edge)
  const namesLook = (ids, read) => ids.map(id => {
    const element = elementOf(id);
    if (!element) return { id, there: false };
    const out = [];
    const look = { budget: 160, truncated: false };
    const unreached = [];
    let exact = true;
    const visited = new Set();
    const visit = (fn, depth) => {
      if (visited.has(fn)) return;
      visited.add(fn);
      const code = namesOfCode(fn);
      if (code.ambiguous || code.names.length > 20) exact = false;
      // (what a helper sets itself is its own bookkeeping, as in the debugger's look)
      const own = new Set(depth > 0 ? code.written || [] : []);
      for (const name of code.names.filter(item => !own.has(item)).slice(0, 20)) {
        // an accessor (its getter is the page's code): not read
        if (accessorOf(name)) {
          exact = false;
          continue;
        }
        const got = read(name);
        if (!got) {
          unreached.push(name);
          continue;
        }
        if (typeof got.value === 'function') {
          if (depth < 1) visit(got.value, depth + 1);
          else exact = false;
          continue;
        }
        fingerprint(out, name, got.value, 0, look);
      }
    };
    let handlers = [];
    quietly(() => { handlers = pressHandlers(element); });
    if (handlers.length > 4) exact = false;
    for (const fn of handlers.slice(0, 4)) visit(fn, 0);
    if (look.truncated) exact = false;
    return { id, there: true, print: out, unreached: [...new Set(unreached)], exact };
  });

  // a function's code as text (the debugger's look scans it in the checks' own process); the page's own
  // Function.prototype.toString may be replaced - the one taken at the start is used
  const sourceOf = fn => {
    let text = '';
    try {
      text = toSource.call(fn);
    } catch (_) {}
    return /\{\s*\[native code\]\s*\}\s*$/.test(text) ? '' : text;
  };
  // names read where the page's top level has them (the debugger's look found them in none of the code's own scopes)
  const readNames = (list, read) => {
    const out = [];
    const look = { budget: 160, truncated: false };
    const unreached = [];
    let exact = true;
    for (const name of list.slice(0, 40)) {
      if (BROWSER_NAMES.has(name)) continue;
      if (accessorOf(name)) {
        exact = false;
        continue;
      }
      const got = read(name);
      if (!got) {
        unreached.push(name);
        continue;
      }
      // (a function: its code is the debugger look's business - not a value)
      if (typeof got.value === 'function') continue;
      fingerprint(out, name, got.value, 0, look);
    }
    if (look.truncated || list.length > 40) exact = false;
    return { print: out, unreached, exact };
  };

  // the self-check of the look at hidden needs: a function whose closure holds a known value - the debugger must see it
  const canary = (() => {
    const marker = 'pw-stability-canary';
    return [() => marker];
  })();

  Object.defineProperty(window, KEY, { value: { probe, idOf, drain, watch: checkWatch, arm, press: scriptPress, handlersById, watchInfo, pressables, namesLook, sourceOf, readNames, canary: () => canary }, configurable: false, enumerable: false, writable: false });
}

// (the scanner goes into the page with the tracker)
const TRACKER_SOURCE = `(${pageTracker.toString()})(${SHORT_TIMER_MS}, ${LOAD_CAUSE}, ${makeCodeNames.toString()});`;

// ---- the project's commands: `node fixtures/stability.cjs <command>`, behind the npm scripts the product adds
// (stability:status / stability:off / stability:on / stability:wait -- <seconds> / learning:off / learning:on).
// They change only the "stability" section of the project's package.json; a setting back at its default is taken
// out, and the section with it once it is empty.
const COMMANDS_HELP = [
  '  npm run stability:status           what is set for this project',
  '  npm run stability:off              switch the stability checks off',
  '  npm run stability:on               switch them back on',
  '  npm run stability:wait -- 90       let a step wait up to 90 s for the page (default 10 s)',
  '  npm run stability:wait -- default  back to 10 s',
  '  npm run learning:off               no learning run after a recording',
  '  npm run learning:on                the learning run after each recording again (default)',
];
const MAX_WAIT_SECONDS_ALLOWED = 600;

function sectionOf(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('package.json does not hold an object');
  if (data.stability === undefined) return {};
  if (!data.stability || typeof data.stability !== 'object' || Array.isArray(data.stability)) throw new Error('the "stability" entry in package.json is not a section ({ ... }) - fix it by hand first');
  return { ...data.stability };
}

function changeSettings(change) {
  const raw = fs.readFileSync(PACKAGE_FILE, 'utf8');
  const bom = raw.charCodeAt(0) === 0xfeff ? '﻿' : '';
  const data = JSON.parse(raw.slice(bom.length));
  const settings = sectionOf(data);
  change(settings);
  if (Object.keys(settings).length) data.stability = settings;
  else delete data.stability;
  const indent = (raw.match(/^[ \t]+(?=")/m) || ['  '])[0];
  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  const text = `${bom}${JSON.stringify(data, null, indent).replace(/\n/g, newline)}${newline}`;
  const temp = `${PACKAGE_FILE}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, PACKAGE_FILE);
  } catch (_) {
    // the rename can be refused while another program holds package.json open
    try { fs.unlinkSync(temp); } catch (__) { /* gone already */ }
    fs.writeFileSync(PACKAGE_FILE, text);
  }
}

function settingsReport() {
  const settings = sectionOf(readPackage());
  const lines = [];
  const on = settings.enabled !== false;
  lines.push(`Stability checks:    ${on ? 'on' : 'off (package.json)'}`);
  const forRun = envText('STABILITY');
  if (forRun) lines.push(`  STABILITY=${forRun} is set in this terminal: runs started from it are ${/^(0|false|off|no)$/i.test(forRun) ? 'off' : 'on'}, whatever package.json says`);
  const waitSeconds = Number(settings.maxWaitSeconds) > 0 ? Number(settings.maxWaitSeconds) : 0;
  lines.push(`Longest wait a step: ${waitSeconds ? `${waitSeconds} s (package.json)` : `${DEFAULT_WAIT_MS / 1000} s (default)`}`);
  if (envText('STABILITY_MAX_WAIT_MS')) lines.push(`  STABILITY_MAX_WAIT_MS=${envText('STABILITY_MAX_WAIT_MS')} is set in this terminal: runs started from it wait up to ${seconds(MAX_WAIT_MS)}`);
  const learning = settings.learningRun === false ? 'off (package.json)' : on ? 'on' : 'on, but skipped while the stability checks are off';
  lines.push(`Learning run after a recording: ${learning}`);
  lines.push(`Hidden needs (Chrome/Edge read what a button's code uses): ${settings.hiddenNeeds === false ? 'off (package.json)' : 'on'}`);
  if (envText('STABILITY_HIDDEN')) lines.push(`  STABILITY_HIDDEN=${envText('STABILITY_HIDDEN')} is set in this terminal`);
  return lines;
}

function runCommand(args) {
  const [command = 'status', value] = args.map(arg => String(arg).trim().toLowerCase());
  const say = lines => console.log([''].concat(lines, '').join('\n'));
  try {
    if (!fs.existsSync(PACKAGE_FILE)) throw new Error(`no package.json in ${PROJECT_DIR}`);
    if (command === 'status') {
      say(settingsReport().concat('', 'Commands:', COMMANDS_HELP));
    } else if (command === 'on' || command === 'off') {
      changeSettings(settings => { if (command === 'off') settings.enabled = false; else delete settings.enabled; });
      say([command === 'off' ? 'The stability checks are off for this project.' : 'The stability checks are on for this project.', ''].concat(settingsReport()));
    } else if (command === 'wait') {
      if (!value) {
        say(settingsReport().concat('', 'Give the seconds: npm run stability:wait -- 90   (npm run stability:wait -- default = back to 10 s)'));
        return;
      }
      const backToDefault = ['default', 'reset', '0'].includes(value);
      const wanted = Number(value.replace(/\s*s(ec(ond)?s?)?$/, ''));
      if (!backToDefault && !(Number.isFinite(wanted) && wanted >= 1 && wanted <= MAX_WAIT_SECONDS_ALLOWED)) {
        throw new Error(`"${value}" is not a number of seconds from 1 to ${MAX_WAIT_SECONDS_ALLOWED} (or "default")`);
      }
      const waitSeconds = backToDefault ? 0 : Math.round(wanted * 10) / 10;
      changeSettings(settings => { if (!waitSeconds || waitSeconds * 1000 === DEFAULT_WAIT_MS) delete settings.maxWaitSeconds; else settings.maxWaitSeconds = waitSeconds; });
      const lines = [`A step now waits up to ${waitSeconds || DEFAULT_WAIT_MS / 1000} s for the page.`];
      if (waitSeconds * 1000 > DEFAULT_WAIT_MS) {
        lines.push(
          'That covers the wait after a click too, and a call is taken for one that never finishes only after that long.',
          `The first time a page meets a call that really never finishes (a live-update connection), that step can wait the whole ${waitSeconds} s once; it is remembered after that.`,
          'The test as a whole still has its own limit (timeout in playwright.config.js).',
        );
      }
      say(lines.concat('').concat(settingsReport()));
    } else if (command === 'learning' && (value === 'on' || value === 'off')) {
      changeSettings(settings => { if (value === 'off') settings.learningRun = false; else delete settings.learningRun; });
      say([value === 'off' ? 'No learning run after a recording in this project.' : 'A learning run after each recording in this project.', ''].concat(settingsReport()));
    } else {
      say([`Unknown command: ${args.join(' ') || '(none)'}`, '', 'Commands:'].concat(COMMANDS_HELP));
      process.exitCode = 1;
    }
  } catch (error) {
    console.log(`\n[stability] ${firstLine(error)}\n`);
    process.exitCode = 1;
  }
}

// last, once everything above exists
if (require.main === module) {
  runCommand(process.argv.slice(2));
} else if (!OFF && !globalThis.__pwStabilityInstalled) {
  globalThis.__pwStabilityInstalled = true;
  try {
    install();
  } catch (error) {
    console.log(`[stability] not active: ${firstLine(error)}`);
  }
}

module.exports = { pageTracker, TRACKER_SOURCE };
