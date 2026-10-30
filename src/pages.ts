import QRCode from "qrcode";
import { catalogClientData, priceLabel, products, type Product } from "./catalog.js";
import { escapeHtml, jsonForScript } from "./html.js";
import { formatZatAsZec } from "./money.js";
import type { Order } from "./orders.js";

type Page = {
  title: string;
  description?: string;
  main: string;
  bodyClass?: string;
  bodyAttrs?: string;
  extraScripts?: string;
};

export function homePage(): string {
  const cards = products.map((product) => productCard(product)).join("");
  return layout({
    title: "Halden",
    description: "A sample shop that accepts Zcash with a self-hosted payment service.",
    main: `
      <section class="hero">
        <p class="eyebrow">A sample shop</p>
        <h1>Ordinary objects.<br>Private payment.</h1>
        <p class="lede">Halden asks a self-hosted Zcash service for a fresh address at checkout. When the payment lands, the order updates on its own. No account. No fee.</p>
        <a class="button" href="#shelf">Shop the shelf</a>
      </section>
      <section id="shelf" class="shelf">
        <div class="section-head">
          <h2>The shelf</h2>
          <p>Six things. Prices are in ZEC.</p>
        </div>
        <div class="grid">${cards}</div>
      </section>
    `,
  });
}

export function productPage(product: Product): string {
  return layout({
    title: `${product.name} · Halden`,
    description: product.blurb,
    main: `
      <article class="product">
        <a class="back" href="/">Back to the shelf</a>
        <div class="product-layout">
          <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" width="1200" height="1200">
          <div>
            <p class="eyebrow">Halden</p>
            <h1>${escapeHtml(product.name)}</h1>
            <p class="lede">${escapeHtml(product.description)}</p>
            <p class="price price-large">${escapeHtml(priceLabel(product.priceZat))} <span>ZEC</span></p>
            <button class="button" type="button" data-add="${escapeHtml(product.id)}">Add to cart</button>
            <p class="fine">Paid in Zcash at checkout. You get a new shielded address for this order.</p>
          </div>
        </div>
      </article>
    `,
  });
}

export function cartPage(): string {
  return layout({
    title: "Cart · Halden",
    main: `
      <section class="panel-page">
        <p class="eyebrow">Your cart</p>
        <h1>Cart</h1>
        <div id="cart-root"><p class="muted">Loading your cart…</p></div>
      </section>
    `,
  });
}

export function checkoutPage(): string {
  return layout({
    title: "Checkout · Halden",
    main: `
      <section class="panel-page">
        <p class="eyebrow">Checkout</p>
        <h1>Pay with Zcash</h1>
        <div id="checkout-root"><p class="muted">Loading your order…</p></div>
      </section>
    `,
  });
}

export async function orderPage(order: Order): Promise<string> {
  const qr = await qrMarkup(order.qrText);
  const items = order.items
    .map(
      (item) => `
        <li>
          <span>${escapeHtml(item.name)} <em>× ${item.qty}</em></span>
          <span class="num">${escapeHtml(formatZatAsZec(item.unitZat * item.qty))}</span>
        </li>`,
    )
    .join("");
  const received = formatZatAsZec(order.amountReceivedZat);
  const due = formatZatAsZec(order.amountZat);

  return layout({
    title: order.status === "paid" ? "Payment received · Halden" : "Pay order · Halden",
    description: "Send Zcash to the address for this order.",
    bodyClass: "is-pay",
    bodyAttrs: `data-status="${order.status}" data-order="${escapeHtml(order.id)}" data-poll="/api/orders/${escapeHtml(order.id)}"`,
    extraScripts: `<script src="/pay.js" defer></script>`,
    main: `
      <section class="pay" aria-live="polite">
        <div class="awaiting">
          <div class="pay-layout">
            <div class="qr-card">
              ${qr}
              <a class="wallet-link" href="${escapeHtml(order.qrText)}">Open in a Zcash wallet</a>
            </div>
            <div class="pay-copy">
              <p class="eyebrow">Order ${escapeHtml(order.id)}</p>
              <h1>Send exactly</h1>
              <p class="amount">${escapeHtml(due)} <span>ZEC</span></p>
              <p class="status-line"><span class="pulse" aria-hidden="true"></span> <span data-watch>Watching for a payment</span></p>
              <p class="progress">Received <strong data-received>${escapeHtml(received)}</strong> of <strong>${escapeHtml(due)}</strong> ZEC</p>
              <div class="address-block">
                <div class="address-label">
                  <span>Unified address</span>
                  <button class="text-button" type="button" data-copy>Copy</button>
                </div>
                <p class="address" data-address>${escapeHtml(order.address)}</p>
              </div>
              <ul class="lines">${items}</ul>
              <p class="fine">This page updates when zcash-payment-service reports the total received at this address. The service is watching with a viewing key. It cannot spend the funds, and it does not take a fee.</p>
              <p class="fine">Receipt for ${escapeHtml(order.email)}</p>
            </div>
          </div>
        </div>
        <div class="received-panel">
          <div class="check" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="42" height="42">
              <path d="M5 12.5 9.2 17 19 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <p class="eyebrow">Order ${escapeHtml(order.id)}</p>
          <h1>Payment received</h1>
          <p class="amount amount-paid"><span data-paid-amount>${escapeHtml(received)}</span> <span>ZEC</span></p>
          <p class="lede">This order is paid. The payment service reported the total with a signed webhook. Nothing in the middle took a fee.</p>
          <p class="address address-quiet" data-address>${escapeHtml(order.address)}</p>
          <a class="button" href="/">Back to the shelf</a>
        </div>
      </section>
    `,
  });
}

export function notFoundPage(): string {
  return layout({
    title: "Not found · Halden",
    main: `
      <section class="panel-page">
        <p class="eyebrow">404</p>
        <h1>Nothing at this address.</h1>
        <p class="lede">That page is not part of the shop.</p>
        <a class="button" href="/">Back to the shelf</a>
      </section>
    `,
  });
}

export function missingOrderPage(): string {
  return layout({
    title: "Order not found · Halden",
    main: `
      <section class="panel-page">
        <p class="eyebrow">Order</p>
        <h1>We can't find that order.</h1>
        <p class="lede">The link may be incomplete. Orders live only in this shop's database.</p>
        <a class="button" href="/">Back to the shelf</a>
      </section>
    `,
  });
}

function productCard(product: Product): string {
  const href = `/products/${product.id}`;
  return `
    <article class="card">
      <a class="card-media" href="${href}">
        <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" width="900" height="900">
      </a>
      <div class="card-body">
        <h2><a href="${href}">${escapeHtml(product.name)}</a></h2>
        <p>${escapeHtml(product.blurb)}</p>
        <div class="card-row">
          <p class="price">${escapeHtml(priceLabel(product.priceZat))} <span>ZEC</span></p>
          <button class="button button-small" type="button" data-add="${escapeHtml(product.id)}">Add to cart</button>
        </div>
      </div>
    </article>
  `;
}

async function qrMarkup(text: string): Promise<string> {
  try {
    const svg = await QRCode.toString(text, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#1c1915", light: "#ffffff" },
    });
    const inline = svg.replace(/^\s*<\?xml[^>]*>\s*/i, "");
    if (!inline.includes("<svg") || /<script/i.test(inline)) {
      return `<p class="muted">QR code unavailable. Use the address below.</p>`;
    }
    return `<div class="qr">${inline}</div>`;
  } catch {
    return `<p class="muted">QR code unavailable. Use the address below.</p>`;
  }
}

function layout(page: Page): string {
  const description = page.description ?? "Halden, a sample store that accepts Zcash.";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(page.title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="theme-color" content="#f3eee6">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,620&family=IBM+Plex+Mono:wght@400;500&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="${page.bodyClass ?? ""}" ${page.bodyAttrs ?? ""}>
  <a class="skip" href="#content">Skip to content</a>
  <header class="site-header">
    <a class="wordmark" href="/">Halden</a>
    <nav>
      <a class="cart-link" href="/cart">Cart <span data-cart-count>0</span></a>
    </nav>
  </header>
  <main id="content">${page.main}</main>
  <noscript><p class="noscript">This sample uses JavaScript for the cart and for live payment updates.</p></noscript>
  <footer class="site-footer">
    <p>Halden is an open-source sample. Payment goes to the unified incoming viewing key on your <a href="https://github.com/nerdcash/zcash-payment-service">zcash-payment-service</a>. The service cannot spend it.</p>
  </footer>
  <script id="catalog-data" type="application/json">${jsonForScript(catalogClientData())}</script>
  <script src="/cart.js" defer></script>
  ${page.extraScripts ?? ""}
</body>
</html>`;
}
