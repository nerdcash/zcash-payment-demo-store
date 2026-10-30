import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import vm from "node:vm";

const ADDRESS = "u1testaddress42";
const QR_TEXT = `zcash:${ADDRESS}?amount=0.08000000`;
const DETAILS = ".qr-card, .address-block, [data-address], .wallet-link";

/** A minimal stand-in for the order page DOM that pay.js touches. */
class FakeElement {
  textContent: string;
  removed = false;
  constructor(
    readonly selectors: string[],
    text = "",
    readonly page: FakePage,
  ) {
    this.textContent = text;
  }
  remove() {
    this.removed = true;
  }
  addEventListener() {}
}

class FakePage {
  elements: FakeElement[] = [];
  add(selectors: string[], text = "") {
    const element = new FakeElement(selectors, text, this);
    this.elements.push(element);
    return element;
  }
  live() {
    return this.elements.filter((element) => !element.removed);
  }
  querySelectorAll(selector: string) {
    const wanted = selector.split(",").map((part) => part.trim());
    return this.live().filter((element) => element.selectors.some((s) => wanted.includes(s)));
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  /** Everything the page still carries that could reveal the payment target. */
  text() {
    return this.live()
      .map((element) => element.textContent)
      .join("\n");
  }
}

function awaitingPage() {
  const page = new FakePage();
  page.add([".qr-card"], QR_TEXT);
  page.add([".wallet-link"], QR_TEXT);
  page.add([".address-block"], ADDRESS);
  page.add(["[data-address]"], ADDRESS);
  page.add(["[data-copy]"], "Copy");
  page.add(["[data-received]"], "0.00000000");
  page.add(["[data-paid-amount]"], "0.00000000");
  page.add(["[data-watch]"], "Watching for a payment");
  return page;
}

async function runPayScript(page: FakePage, responses: unknown[]) {
  const source = await readFile(new URL("../public/pay.js", import.meta.url), "utf8");
  const timers: Array<() => void> = [];
  let reloads = 0;
  const body = { dataset: { poll: "/api/orders/hd_test", status: "awaiting_payment" } as Record<string, string>, classList: { add() {} } };
  const document = Object.assign(page, { body });
  const context = vm.createContext({
    document,
    navigator: {},
    location: { reload: () => reloads++ },
    window: { setTimeout: (fn: () => void) => timers.push(fn) },
    fetch: async () => {
      const next = responses.shift();
      return { ok: true, json: async () => next };
    },
  });
  vm.runInContext(source, context);
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  await settle();
  return {
    body,
    reloads: () => reloads,
    async nextPoll() {
      const timer = timers.shift();
      assert.ok(timer, "pay.js scheduled another poll");
      timer();
      await settle();
    },
  };
}

const status = (value: string, received: string, receivedZat: number) => ({
  id: "hd_test",
  status: value,
  amount: "0.08000000",
  received,
  amountZat: 8_000_000,
  receivedZat,
  paidAt: value === "paid" ? "2026-10-30T00:00:00Z" : null,
});

describe("pay.js", () => {
  it("removes the address, QR code, and wallet link when the order becomes paid", async () => {
    const page = awaitingPage();
    const script = await runPayScript(page, [status("paid", "0.08000000", 8_000_000)]);

    assert.equal(script.body.dataset.status, "paid");
    assert.equal(page.querySelectorAll(DETAILS).length, 0);
    assert.equal(page.text().includes(ADDRESS), false);
    assert.equal(page.text().includes("zcash:"), false);
    assert.equal(script.reloads(), 0);
  });

  it("keeps the payment details while the order is still awaiting payment", async () => {
    const page = awaitingPage();
    await runPayScript(page, [status("awaiting_payment", "0.00000000", 0)]);

    assert.equal(page.querySelectorAll(DETAILS).length, 4);
    assert.ok(page.text().includes(ADDRESS));
  });

  it("reloads to get the address back when a paid order returns to awaiting payment", async () => {
    const page = awaitingPage();
    const script = await runPayScript(page, [
      status("paid", "0.08000000", 8_000_000),
      status("awaiting_payment", "0.01000000", 1_000_000),
    ]);
    assert.equal(page.text().includes(ADDRESS), false);

    await script.nextPoll();
    assert.equal(script.reloads(), 1);
  });
});
