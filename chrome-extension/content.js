/**
 * content.js — runs in every ahlan.sa page.
 *
 * On load, asks the background worker: "do you have an order for this tab?"
 *   - If no order: do nothing (user is just browsing).
 *   - If order: check auth status, then drive the cart flow.
 *
 * Flow (best-effort, conservative — stops at payment):
 *   1. /events/details?event=<slug>  → click "Find Tickets"
 *   2. category picker page          → click the requested category
 *   3. qty selector                  → set qty
 *   4. add-to-cart confirm           → click confirm
 *   5. cart review / checkout        → stop and ping background
 *
 * NEVER clicks any final "Pay" or "Confirm Order" button. Always stops at
 * the payment-review screen so the user enters Visa details themselves.
 */
(async () => {
  if (window.__ahlan_ext_loaded) return; // dedupe — content scripts can re-fire on SPA nav
  window.__ahlan_ext_loaded = true;

  // 1. Ask background if this tab has an order
  let order = null;
  try {
    const r = await chrome.runtime.sendMessage({ type: "content_ready" });
    order = r?.order || null;
  } catch (e) {
    return; // extension context invalidated
  }
  if (!order) return; // user is just browsing — don't interfere

  console.log("[Ahlan Ext] order received:", order);

  // ── Helpers ──────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function waitFor(predicate, { timeout = 15000, interval = 250 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = predicate();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  function findButtonByText(text) {
    text = text.toLowerCase().trim();
    const all = document.querySelectorAll("button, a, [role='button']");
    for (const el of all) {
      const t = (el.textContent || "").toLowerCase().trim();
      if (t === text || t.includes(text)) return el;
    }
    return null;
  }

  function isOnSignIn() {
    return location.pathname.toLowerCase().includes("/signin")
        || location.pathname.toLowerCase().includes("/login")
        || !!findButtonByText("Login");
  }

  function report(status, opts = {}) {
    try {
      chrome.runtime.sendMessage({
        type: "content_status",
        status,
        error_msg: opts.error_msg,
        notes: opts.notes,
      });
    } catch (e) { /* */ }
  }

  // ── Step 0: auth check ───────────────────────────────────────────────
  await sleep(1500); // let the SPA hydrate
  if (isOnSignIn()) {
    report("auth_error", { error_msg: "Not logged in to ahlan.sa", notes: "Sign in and re-queue the order." });
    return;
  }

  // ── Step 1: Find Tickets ─────────────────────────────────────────────
  const findBtn = await waitFor(() => findButtonByText("Find Tickets"), { timeout: 8000 });
  if (!findBtn) {
    // Could already be past this step (SPA might have advanced), or page didn't load.
    // Don't fail — let the next step check.
  } else {
    findBtn.click();
    await sleep(2000);
  }

  // After clicking, ahlan.sa redirects to a category-picker URL.
  // We need to wait for the new page to render.
  await sleep(2000);

  // If we got bounced to sign-in, bail
  if (isOnSignIn()) {
    report("auth_error", { error_msg: "Sign-in required after clicking Find Tickets" });
    return;
  }

  // ── Step 2: pick category ────────────────────────────────────────────
  // The dashboard's order.category is e.g. "CAT 2" or "Premium".
  // Look for a card/button with that exact text. Ahlan uses h2/h3/h4/span
  // for category names; we walk up to find a clickable parent.
  const wantedCat = (order.category || "").toLowerCase().trim();
  if (wantedCat) {
    const catEl = await waitFor(() => {
      const candidates = document.querySelectorAll(
        "h1, h2, h3, h4, h5, button, [role='button'], .ticket-category, [class*='category'], [class*='Category']"
      );
      for (const el of candidates) {
        const t = (el.textContent || "").toLowerCase().trim();
        if (t === wantedCat) {
          // walk up to find a clickable ancestor
          let n = el;
          for (let i = 0; i < 6 && n; i++) {
            if (n.tagName === "BUTTON" || n.tagName === "A" || n.getAttribute("role") === "button") return n;
            if (n.onclick) return n;
            n = n.parentElement;
          }
          return el;
        }
      }
      return null;
    }, { timeout: 10000 });

    if (catEl) {
      catEl.click();
      await sleep(1500);
    } else {
      report("failed", { error_msg: `Couldn't find category "${order.category}" on page`,
                         notes: `Page URL: ${location.href}` });
      return;
    }
  }

  // ── Step 3: set qty ──────────────────────────────────────────────────
  // Try to find a +/- counter or a qty <input>. Increment until we reach
  // target qty. If we can't find it, just leave default qty.
  const targetQty = Math.max(1, parseInt(String(order.qty || 1), 10));
  let qtyOk = false;
  const qtyInput = document.querySelector(
    "input[type='number'][name*='quantity' i], input[name*='qty' i], input[id*='qty' i], input[type='number']"
  );
  if (qtyInput) {
    qtyInput.focus();
    qtyInput.value = String(targetQty);
    qtyInput.dispatchEvent(new Event("input", { bubbles: true }));
    qtyInput.dispatchEvent(new Event("change", { bubbles: true }));
    qtyOk = true;
    await sleep(500);
  } else {
    // Try +/- buttons
    const plusBtn = Array.from(document.querySelectorAll("button, [role='button']"))
      .find(b => {
        const t = (b.textContent || "").trim();
        const aria = (b.getAttribute("aria-label") || "").toLowerCase();
        return t === "+" || aria.includes("increase") || aria.includes("add") || aria.includes("plus");
      });
    if (plusBtn) {
      for (let i = 1; i < targetQty; i++) {
        plusBtn.click();
        await sleep(200);
      }
      qtyOk = true;
    }
  }

  // ── Step 4: add to cart / proceed ────────────────────────────────────
  await sleep(800);
  const addBtn = await waitFor(() =>
    findButtonByText("Add to cart") ||
    findButtonByText("Buy now") ||
    findButtonByText("Proceed") ||
    findButtonByText("Continue") ||
    findButtonByText("Checkout"),
    { timeout: 6000 }
  );
  if (addBtn) {
    addBtn.click();
    await sleep(2500);
  }

  // ── Step 5: stop at payment review ───────────────────────────────────
  // Don't click anything that looks like final payment.
  const payIndicators = [
    "card number", "credit card", "visa", "mastercard", "cvc", "cvv",
    "expiry", "expires", "billing", "complete purchase", "place order"
  ];
  const onPaymentPage = payIndicators.some(t => document.body.textContent?.toLowerCase().includes(t));

  if (onPaymentPage) {
    report("success", {
      notes: `Cart parked at payment page (${location.pathname}). Enter Visa details to complete.`,
    });
    // Flash the page to grab attention
    document.title = `🟢 PAY NOW · ${document.title}`;
  } else if (qtyOk) {
    // We made it past category/qty but no clear payment indicator — still likely success
    report("success", {
      notes: `Cart action completed. Current URL: ${location.pathname}`,
    });
  } else {
    report("failed", {
      error_msg: "Couldn't reach payment page",
      notes: `Stopped at ${location.pathname}`,
    });
  }
})();
