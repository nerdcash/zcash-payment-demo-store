import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { getProduct } from "../src/catalog.js";
import { formatZatAsZec } from "../src/money.js";
import { openOrders, type OrderStore } from "../src/orders.js";
import { createApp } from "../src/app.js";
import { createZcashPaymentClient, WebhookSignatureError } from "../src/zcash-payment.js";

const SECRET = "test-webhook-secret";

type Captured = { method: string; url: string; body: unknown };
type Issued = { address: string; qr_text: string };

let orders: OrderStore;
let requests: Captured[];
let issued: Issued;
let serviceStatus = 200;
const serviceBody = { error: "wallet error: uivk unavailable" };
let baseUrl = "";
let closeAll: () => Promise<void> = async () => {};

describe("payment flow", { concurrency: false }, () => {

  before(async () => {
    requests = [];
    let session = 0;
    const service = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString("utf8");
      const body: unknown = raw ? JSON.parse(raw) : null;
      requests.push({ method: req.method ?? "", url: req.url ?? "", body });
      if (req.method !== "POST" || req.url !== "/payment-session") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      if (serviceStatus !== 200) {
        res.writeHead(serviceStatus, { "content-type": "application/json" });
        res.end(JSON.stringify(serviceBody));
        return;
      }
      session += 1;
      const amount = isRecord(body) && typeof body.amount === "string" ? body.amount : "0.00000000";
      issued = {
        address: `u1testaddress${session}`,
        qr_text: `zcash:u1testaddress${session}?amount=${encodeURIComponent(amount)}&memo=Order%20hd_test`,
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(issued));
    });

    const serviceListener = await listen(service);
    orders = openOrders(":memory:");
    const payments = createZcashPaymentClient({ baseUrl: serviceListener.url, webhookSecret: SECRET });
    const store = await listen(http.createServer(createApp({ orders, payments })));
    baseUrl = store.url;
    closeAll = async () => {
      await store.close();
      await serviceListener.close();
      orders.close();
    };
  });

  after(async () => {
    await closeAll();
  });

  it("creates a payment session with the service contract and shows the returned address", async () => {
    const cup = mustProduct("espresso-cup");
    requests.length = 0;
    const created = await checkout([{ id: cup.id, qty: 1 }]);
    assert.equal(created.status, 201);
    const payload = (await created.json()) as { orderId: string; url: string };

    const session = record(requests[0]?.body);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, "/payment-session");
    assert.equal(session.payment_source, "zcash");
    assert.equal(session.label, cup.name);
    assert.equal(session.memo, `Order ${payload.orderId}`);
    assert.equal(session.message, "Thank you for your Halden order.");
    assert.equal(session.amount, formatZatAsZec(cup.priceZat));
    assert.equal(typeof session.amount, "string");

    const page = await fetch(`${baseUrl}${payload.url}`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.ok(html.includes('data-status="awaiting_payment"'));
    assert.ok(html.includes(issued.address));
    assert.ok(html.includes(issued.qr_text.replaceAll("&", "&amp;")));
    assert.ok(html.includes(formatZatAsZec(cup.priceZat)));
    assert.ok(html.includes(`/api/orders/${payload.orderId}`));
    assert.ok(html.includes("<svg"));

    const status = await orderStatus(payload.orderId);
    assert.equal(status.status, "awaiting_payment");
    assert.equal(status.received, "0.00000000");
  });

  it("rejects a bad signature, then follows the webhook total up, down, and only once", async () => {
    const cup = mustProduct("espresso-cup");
    const created = await checkout([{ id: cup.id, qty: 1 }]);
    const { orderId } = (await created.json()) as { orderId: string };
    const due = formatZatAsZec(cup.priceZat);
    const address = issued.address;

    const partial = await postWebhook(observation("zcash:7:v1", address, "0.04000000"));
    assert.equal(partial.status, 200);
    assert.equal((await partial.json()).outcome, "applied");
    assert.equal((await orderStatus(orderId)).status, "awaiting_payment");
    assert.equal((await orderStatus(orderId)).received, "0.04000000");

    const full = observation("zcash:7:v2", address, due);
    const forged = signedBody(full);
    const bad = await fetch(`${baseUrl}/webhooks/zcash-payments`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": "ab".repeat(32) },
      body: forged.body,
    });
    assert.equal(bad.status, 401);
    assert.equal((await orderStatus(orderId)).status, "awaiting_payment");

    const paid = await postWebhook(full);
    assert.equal(paid.status, 200);
    assert.equal((await paid.json()).outcome, "applied");
    const paidStatus = await orderStatus(orderId);
    assert.equal(paidStatus.status, "paid");
    assert.equal(paidStatus.received, due);
    assert.ok(paidStatus.paidAt);

    const duplicate = await postWebhook(full);
    assert.equal((await duplicate.json()).outcome, "duplicate");
    assert.equal((await orderStatus(orderId)).received, due);

    const stale = await postWebhook(observation("zcash:7:v0", address, "0.01000000"));
    assert.equal((await stale.json()).outcome, "stale");
    assert.equal((await orderStatus(orderId)).status, "paid");

    const paidHtml = await (await fetch(`${baseUrl}/orders/${orderId}`)).text();
    assert.ok(paidHtml.includes('data-status="paid"'));
    assert.equal(paidHtml.includes(address), false);

    const reorg = await postWebhook(observation("zcash:7:v3", address, "0.01000000"));
    assert.equal((await reorg.json()).outcome, "applied");
    const revised = await orderStatus(orderId);
    assert.equal(revised.status, "awaiting_payment");
    assert.equal(revised.received, "0.01000000");
    assert.equal(revised.paidAt, null);

    const html = await (await fetch(`${baseUrl}/orders/${orderId}`)).text();
    assert.ok(html.includes('data-status="awaiting_payment"'));
    assert.ok(html.includes("0.07000000"));
    assert.ok(html.includes("amount=0.07000000"));
    assert.equal(html.includes("amount=0.08000000"), false);
    assert.ok(html.includes("Partial payment seen"));
    assert.ok(html.includes(address));
  });

  it("prices a multi-item cart itself and ignores an unknown address", async () => {
    const cup = mustProduct("espresso-cup");
    const notebook = mustProduct("cloth-notebook");
    requests.length = 0;
    const created = await checkout([
      { id: cup.id, qty: 1 },
      { id: notebook.id, qty: 1 },
    ]);
    assert.equal(created.status, 201);
    const session = record(requests[0]?.body);
    assert.equal(session.label, "Halden order · 2 items");
    assert.equal(session.amount, formatZatAsZec(cup.priceZat + notebook.priceZat));

    const unknown = await postWebhook(observation("zcash:9:v1", "u1someoneelse", "1.00000000"));
    assert.equal(unknown.status, 200);
    assert.equal((await unknown.json()).outcome, "unknown_address");
  });

  it("does not store an order when the payment service fails", async () => {
    const beforeCount = orders.count();
    serviceStatus = 500;
    requests.length = 0;
    try {
      const created = await checkout([{ id: "espresso-cup", qty: 1 }]);
      assert.equal(created.status, 502);
      const payload = (await created.json()) as { detail: string };
      assert.match(payload.detail, /uivk unavailable/);
      assert.equal(requests.length, 1);
      assert.equal(orders.count(), beforeCount);
    } finally {
      serviceStatus = 200;
    }
  });

  it("rejects invalid checkout before calling the service", async () => {
    requests.length = 0;
    const response = await checkout([{ id: "not-a-product", qty: 1 }]);
    assert.equal(response.status, 400);
    const empty = await checkout([]);
    assert.equal(empty.status, 400);
    assert.equal(requests.length, 0);
  });

  it("checks the webhook signature against the raw body", async () => {
    const client = createZcashPaymentClient({ baseUrl: "http://127.0.0.1:9", webhookSecret: SECRET });
    const raw = Buffer.from(
      JSON.stringify({
        event_id: "zcash:1:v1",
        payment_source: "zcash",
        address: "u1direct",
        total_received: "0.08000000",
        observed_at: "2026-01-01T00:00:00Z",
      }),
    );
    const signature = createHmac("sha256", SECRET).update(raw).digest("hex");
    const tampered = Buffer.from(raw.toString("utf8").replace("0.08000000", "9.08000000"));
    assert.throws(() => client.verifyWebhook(tampered, signature), WebhookSignatureError);

    const observationResult = client.verifyWebhook(raw, signature.toUpperCase());
    assert.equal(observationResult.event_id, "zcash:1:v1");
    assert.equal(observationResult.total_received, "0.08000000");

    const wrongSource = signedBody({
      event_id: "zcash:1:v8",
      payment_source: "bitcoin",
      address: "u1direct",
      total_received: "0.08000000",
      observed_at: "2026-01-01T00:00:00Z",
    });
    const rejected = await fetch(`${baseUrl}/webhooks/zcash-payments`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": wrongSource.signature },
      body: wrongSource.body,
    });
    assert.equal(rejected.status, 400);
  });
});

function mustProduct(id: string) {
  const product = getProduct(id);
  assert.ok(product);
  return product;
}

function record(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value));
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function observation(eventId: string, address: string, total: string) {
  return {
    event_id: eventId,
    payment_source: "zcash",
    address,
    total_received: total,
    observed_at: "2026-01-01T00:00:00Z",
  };
}

async function checkout(items: Array<{ id: string; qty: number }>, email = "ada@example.com") {
  return fetch(`${baseUrl}/api/checkout`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email, items }),
  });
}

async function orderStatus(id: string) {
  const response = await fetch(`${baseUrl}/api/orders/${id}`);
  assert.equal(response.status, 200);
  return (await response.json()) as { status: string; received: string; paidAt: string | null };
}

function signedBody(payload: unknown): { body: string; signature: string } {
  const body = JSON.stringify(payload);
  return { body, signature: createHmac("sha256", SECRET).update(body).digest("hex") };
}

async function postWebhook(payload: unknown) {
  const signed = signedBody(payload);
  return fetch(`${baseUrl}/webhooks/zcash-payments`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": signed.signature },
    body: signed.body,
  });
}

function listen(server: http.Server): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
            server.closeAllConnections();
          }),
      });
    });
  });
}
