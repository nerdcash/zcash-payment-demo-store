const KEY = "halden.cart";

function readCatalog() {
  const node = document.getElementById("catalog-data");
  if (!node) return [];
  try {
    const parsed = JSON.parse(node.textContent || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const catalog = readCatalog();

function productOf(id) {
  return catalog.find((item) => item.id === id);
}

function readCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((line) => line && typeof line.id === "string" && Number.isInteger(line.qty) && line.qty > 0)
      .map((line) => ({ id: line.id, qty: Math.min(9, line.qty) }));
  } catch {
    return [];
  }
}

function writeCart(lines) {
  localStorage.setItem(KEY, JSON.stringify(lines));
  renderCount();
}

function pricedLines() {
  return readCart()
    .map((line) => ({ ...line, product: productOf(line.id) }))
    .filter((line) => line.product);
}

function formatZec(zat) {
  const negative = zat < 0;
  const absolute = Math.abs(zat);
  const whole = Math.floor(absolute / 100000000);
  const fraction = String(absolute % 100000000).padStart(8, "0").replace(/0+$/, "");
  const digits = fraction.length < 2 ? fraction.padEnd(2, "0") : fraction;
  return `${negative ? "-" : ""}${whole}.${digits}`;
}

function renderCount() {
  const el = document.querySelector("[data-cart-count]");
  if (!el) return;
  const total = pricedLines().reduce((sum, line) => sum + line.qty, 0);
  el.textContent = String(total);
}

function setQty(id, qty, focusAction) {
  const capped = Math.min(9, qty);
  let found = false;
  const next = [];
  for (const line of readCart()) {
    if (!productOf(line.id)) continue;
    if (line.id !== id) {
      next.push(line);
      continue;
    }
    found = true;
    if (capped > 0) next.push({ id, qty: capped });
  }
  if (!found && capped > 0 && productOf(id)) next.push({ id, qty: capped });
  writeCart(next);
  renderPage();
  if (focusAction) focusCartControl(id, focusAction, capped);
}

function focusCartControl(id, action, qty) {
  const root = document.getElementById("cart-root");
  if (!root) return;
  const selector = qty > 0
    ? `[data-product="${CSS.escape(id)}"][data-action="${action}"]`
    : "button, a";
  const target = root.querySelector(selector);
  if (target instanceof HTMLElement) target.focus();
}

function h(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === "class") node.className = String(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children || []) node.append(child);
  return node;
}

function text(value) {
  return document.createTextNode(value);
}

function renderCart(root) {
  const cart = pricedLines();
  root.replaceChildren();
  if (cart.length === 0) {
    root.append(
      h("p", { class: "lede" }, [text("Your cart is empty.")]),
      h("a", { class: "button", href: "/" }, [text("Browse the shelf")]),
    );
    return;
  }

  const list = h("ul", { class: "cart-list" });
  for (const line of cart) {
    const dec = h("button", { type: "button", class: "step", "data-product": line.id, "data-action": "dec", "aria-label": `Fewer ${line.product.name}` }, [text("−")]);
    const inc = h("button", { type: "button", class: "step", "data-product": line.id, "data-action": "inc", "aria-label": `More ${line.product.name}` }, [text("+")]);
    dec.addEventListener("click", () => setQty(line.id, line.qty - 1, "dec"));
    inc.addEventListener("click", () => setQty(line.id, line.qty + 1, "inc"));
    const remove = h("button", { type: "button", class: "text-button", "data-product": line.id, "data-action": "remove" }, [text("Remove")]);
    remove.addEventListener("click", () => setQty(line.id, 0, "remove"));
    const lineTotal = formatZec(line.product.priceZat * line.qty);
    list.append(
      h("li", {}, [
        h("img", { src: line.product.image, alt: "", width: "96", height: "96" }),
        h("div", {}, [
          h("h2", {}, [text(line.product.name)]),
          h("p", { class: "muted" }, [text(`${line.product.price} ZEC each`)]),
          h("div", { class: "steps" }, [dec, h("span", { class: "qty" }, [text(String(line.qty))]), inc]),
          remove,
        ]),
        h("p", { class: "price" }, [text(`${lineTotal} ZEC`)]),
      ]),
    );
  }

  const total = cart.reduce((sum, line) => sum + line.product.priceZat * line.qty, 0);
  const summary = h("aside", { class: "summary" }, [
    h("p", { class: "eyebrow" }, [text("Total")]),
    h("p", { class: "amount amount-summary" }, [text(formatZec(total)), h("span", { class: "unit" }, [text("ZEC")])]),
    h("a", { class: "button", href: "/checkout" }, [text("Checkout")]),
  ]);
  root.append(h("div", { class: "cart-layout" }, [list, summary]));
}

function renderCheckout(root) {
  const cart = pricedLines();
  root.replaceChildren();
  if (cart.length === 0) {
    root.append(
      h("p", { class: "lede" }, [text("Your cart is empty.")]),
      h("a", { class: "button", href: "/" }, [text("Browse the shelf")]),
    );
    return;
  }

  const list = h("ul", { class: "lines" });
  for (const line of cart) {
    list.append(
      h("li", {}, [
        h("span", {}, [text(`${line.product.name} × ${line.qty}`)]),
        h("span", { class: "num" }, [text(formatZec(line.product.priceZat * line.qty))]),
      ]),
    );
  }

  const email = h("input", {
    id: "email",
    name: "email",
    type: "email",
    autocomplete: "email",
    required: "required",
    placeholder: "you@example.com",
  });
  const error = h("p", { class: "form-error", role: "alert" });
  error.hidden = true;
  const button = h("button", { class: "button", type: "submit" }, [text("Create payment")]);
  const form = h("form", { class: "checkout-form" }, [
    h("label", { for: "email" }, [text("Email for the receipt")]),
    email,
    error,
    button,
    h("p", { class: "fine" }, [text("The next screen shows a Zcash address and a QR code. Halden never sees a spending key.")]),
  ]);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    button.disabled = true;
    button.textContent = "Asking for an address…";
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          email: email.value.trim(),
          items: cart.map((line) => ({ id: line.id, qty: line.qty })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = payload.detail ? ` ${payload.detail}` : "";
        throw new Error(`${payload.error || "Could not start checkout."}${detail}`);
      }
      writeCart([]);
      location.assign(payload.url);
    } catch (err) {
      error.hidden = false;
      error.textContent = err instanceof Error ? err.message : "Could not start checkout.";
      button.disabled = false;
      button.textContent = "Create payment";
    }
  });

  const total = cart.reduce((sum, line) => sum + line.product.priceZat * line.qty, 0);
  const summary = h("aside", { class: "summary" }, [
    h("p", { class: "eyebrow" }, [text("Due")]),
    h("p", { class: "amount amount-summary" }, [text(formatZec(total)), h("span", { class: "unit" }, [text("ZEC")])]),
    list,
  ]);
  root.append(h("div", { class: "cart-layout" }, [form, summary]));
}

function renderPage() {
  const cartRoot = document.getElementById("cart-root");
  const checkoutRoot = document.getElementById("checkout-root");
  if (cartRoot) renderCart(cartRoot);
  if (checkoutRoot) renderCheckout(checkoutRoot);
}

document.querySelectorAll("[data-add]").forEach((button) => {
  button.addEventListener("click", () => {
    const id = button.getAttribute("data-add");
    if (!id || !productOf(id)) return;
    const current = readCart().find((line) => line.id === id);
    setQty(id, (current?.qty ?? 0) + 1);
    const previous = button.textContent;
    button.textContent = "Added";
    window.setTimeout(() => {
      button.textContent = previous;
    }, 900);
  });
});

renderCount();
renderPage();
