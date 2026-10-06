// backend/src/healing/browser_script.js
//
// Runs INSIDE the browser via page.evaluate() / Playwright fixture.
// Returns a JSON-serializable structure describing the page.
// Pierces OPEN shadow roots automatically.

(function walk() {
  const INTERESTING_TAGS = new Set([
    "BUTTON", "A", "INPUT", "SELECT", "TEXTAREA",
    "LABEL", "SUMMARY", "OPTION",
  ]);

  const INTERESTING_ROLES = new Set([
    "button", "link", "tab", "menuitem", "checkbox",
    "radio", "switch", "textbox", "combobox", "searchbox",
  ]);

  const KEEP_ATTR_NAMES = [
    "id", "name", "type", "role", "placeholder",
    "aria-label", "aria-labelledby", "title",
    "data-testid", "data-test", "data-qa", "data-cy",
    "href", "value",
  ];

  function isInteresting(el) {
    if (!el || el.nodeType !== 1) return false;
    if (INTERESTING_TAGS.has(el.tagName)) return true;
    const role = el.getAttribute && el.getAttribute("role");
    if (role && INTERESTING_ROLES.has(role.toLowerCase())) return true;
    if (el.getAttribute && (
        el.getAttribute("data-testid") ||
        el.getAttribute("data-test") ||
        el.getAttribute("data-qa") ||
        el.getAttribute("data-cy") ||
        el.getAttribute("aria-label") ||
        el.id
    )) return true;
    if (el.hasAttribute && el.hasAttribute("contenteditable")) return true;
    return false;
  }

  function getText(el) {
    if (!el) return "";
    const t = (el.textContent || "").trim().replace(/\s+/g, " ");
    return t.length > 80 ? t.slice(0, 80) + "..." : t;
  }

  function getAttrs(el) {
    const out = {};
    for (const name of KEEP_ATTR_NAMES) {
      const v = el.getAttribute && el.getAttribute(name);
      if (v != null && v !== "") out[name] = v.toString().slice(0, 200);
    }
    return out;
  }

  function getRole(el) {
    const explicit = el.getAttribute && el.getAttribute("role");
    if (explicit) return explicit.toLowerCase();
    const tag = el.tagName;
    if (tag === "BUTTON") return "button";
    if (tag === "A" && el.hasAttribute("href")) return "link";
    if (tag === "INPUT") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (["button", "submit", "reset"].includes(t)) return "button";
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      return "textbox";
    }
    if (tag === "SELECT") return "combobox";
    if (tag === "TEXTAREA") return "textbox";
    return "";
  }

  function getAccessibleName(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const txt = getText(el);
    if (txt) return txt;
    const ph = el.getAttribute("placeholder");
    if (ph) return ph.trim();
    const ti = el.getAttribute("title");
    if (ti) return ti.trim();
    return "";
  }

  function buildStableLocators(rec) {
    const locators = [];
    const a = rec.attributes || {};
    const name = rec.accessible_name;
    if (a["data-testid"]) locators.push(`getByTestId("${a["data-testid"]}")`);
    if (a["data-test"])   locators.push(`getByTestId("${a["data-test"]}")`);
    if (a["data-qa"])     locators.push(`getByTestId("${a["data-qa"]}")`);
    if (rec.role && name) {
      locators.push(`getByRole("${rec.role}", { name: ${JSON.stringify(name)} })`);
    }
    if (a["aria-label"]) {
      locators.push(`getByLabel(${JSON.stringify(a["aria-label"])})`);
    }
    if (a["placeholder"]) {
      locators.push(`getByPlaceholder(${JSON.stringify(a["placeholder"])})`);
    }
    if (a["id"] && /^[A-Za-z_][\w-]*$/.test(a["id"])) {
      locators.push(`#${a["id"]}`);
    }
    if (a["name"]) {
      locators.push(`[name=${JSON.stringify(a["name"])}]`);
    }
    return locators.slice(0, 4);
  }

  function isVisible(el) {
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      return true;
    } catch (_) {
      return false;
    }
  }

  function serialize(el, shadowPath) {
    const rec = {
      tag: el.tagName.toLowerCase(),
      role: getRole(el),
      accessible_name: getAccessibleName(el),
      text: getText(el),
      attributes: getAttrs(el),
      shadow_path: shadowPath.slice(),
      visible: isVisible(el),
    };
    rec.stable_locators = buildStableLocators(rec);
    return rec;
  }

  const collected = [];

  function visit(node, shadowPath) {
    if (!node || node.nodeType !== 1) return;
    if (isInteresting(node)) {
      collected.push(serialize(node, shadowPath));
    }
    if (node.shadowRoot) {
      const host = node.tagName.toLowerCase();
      const newPath = shadowPath.concat([host]);
      for (const child of Array.from(node.shadowRoot.children)) {
        visit(child, newPath);
      }
    } else if (node.tagName && node.tagName.includes("-")) {
      collected.push({
        tag: node.tagName.toLowerCase(),
        role: "",
        accessible_name: getAccessibleName(node),
        text: getText(node),
        attributes: getAttrs(node),
        shadow_path: shadowPath.slice(),
        visible: isVisible(node),
        stable_locators: buildStableLocators({
          role: getRole(node),
          accessible_name: getAccessibleName(node),
          attributes: getAttrs(node),
        }),
        shadow_host_closed: true,
      });
    }
    for (const child of Array.from(node.children)) {
      visit(child, shadowPath);
    }
  }

  try {
    visit(document.body, []);
  } catch (e) {
    return { error: e && e.message ? e.message : String(e), elements: [] };
  }

  const MAX = 400;
  return {
    url: location.href,
    title: document.title || "",
    elements: collected.slice(0, MAX),
    total_seen: collected.length,
  };
})();