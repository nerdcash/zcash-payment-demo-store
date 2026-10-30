import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MoneyError, formatZatAsZec, formatZecDisplay, zecToZat } from "../src/money.js";

describe("ZEC amounts", () => {
  it("parses whole and fractional ZEC into zatoshis", () => {
    assert.equal(zecToZat("0.08000000"), 8_000_000);
    assert.equal(zecToZat("0.08"), 8_000_000);
    assert.equal(zecToZat("1"), 100_000_000);
    assert.equal(zecToZat("1.5"), 150_000_000);
    assert.equal(zecToZat("-0.01"), -1_000_000);
  });

  it("rejects amounts the payment service would not produce", () => {
    assert.throws(() => zecToZat("0.123456789"), MoneyError);
    assert.throws(() => zecToZat("abc"), MoneyError);
    assert.throws(() => zecToZat(""), MoneyError);
  });

  it("formats zatoshis with eight decimal places and a shorter display form", () => {
    assert.equal(formatZatAsZec(8_000_000), "0.08000000");
    assert.equal(formatZatAsZec(100_000_000), "1.00000000");
    assert.equal(formatZecDisplay(8_000_000), "0.08");
    assert.equal(formatZecDisplay(100_000_000), "1.00");
    assert.equal(formatZecDisplay(12_345_678), "0.12345678");
  });
});
