# Halden

A small open-source shop that shows how to accept Zcash with [zcash-payment-service](https://github.com/nerdcash/zcash-payment-service).

Halden sells six ordinary objects. At checkout it asks the payment service for a fresh shielded address, shows that address as a QR code, and marks the order paid when the service reports the money.

The integration is one module, [`src/zcash-payment.ts`](src/zcash-payment.ts). Prices, the cart, and the order database stay in the store.

## What you are running

Two processes:

- **This store.** Node.js, TypeScript, and Express. Orders live in a SQLite file. The store sets the price.
- **zcash-payment-service.** A container you run yourself. It turns a unified incoming viewing key (UIVK) into payment addresses, watches the chain, and POSTs a signed webhook when an address receives funds.

A few things that matter:

- **No fees.** The service is read-only. It never takes a cut and it cannot spend what it sees.
- **Self-hosted.** There is no payment-company account. You run the service next to the shop.
- **The service only needs the UIVK** (plus a birthday height and a lightwalletd URL so it can scan). A viewing key reveals incoming notes. It is not a spending key.

The store does not choose the Zcash network. Addresses come from your UIVK, which is either testnet or mainnet. Set `ZCASH_NETWORK` to match the key. Sample prices are plain ZEC amounts.

## Run it with Docker

Install Docker, then from this directory:

```powershell
Copy-Item .env.example .env
```

Edit `.env`:

- `ZCASH_UIVK` — your unified incoming viewing key. Leave this empty in git. The example file is a placeholder on purpose.
- `ZCASH_BIRTHDAY_HEIGHT` — the block height where this wallet starts. The service requires it on first launch.
- `ZCASH_WEBHOOK_SECRET` — a long random string. The store and the payment service must share it. Change the placeholder before anyone else can reach port 3000.

Then:

```powershell
docker compose up --build
```

Open http://127.0.0.1:3000.

The shop container waits until the payment service answers `GET /health`. That happens after the UIVK checks pass. Scan progress is not required for health. The service keeps its wallet data in the `zcash-payment-data` volume. Use the same UIVK on later starts. A different key refuses to boot.

`LIGHTWALLETD_URL` defaults to the public testnet lightwalletd. Point `ZCASH_NETWORK` and the lightwalletd URL at mainnet when the UIVK is a mainnet key.

## Run the store on its own

You need Node.js 22.13 or newer (Node 24 is a good default).

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

The store listens on http://127.0.0.1:3000 and calls `ZCASH_PAYMENT_SERVICE_BASE_URL` (default `http://127.0.0.1:8787`). Start the payment service separately if you want checkout to issue real addresses. The catalog, cart, and pages work without it. Checkout returns a clear error until the service is up.

```powershell
npm test
npm run lint
npm run build
npm start
```

## How a payment works

1. The shopper builds a cart in the browser. The server prices it again. The client cannot name its own price.
2. Checkout `POST`s `/payment-session` on the payment service:

```json
{
  "payment_source": "zcash",
  "label": "Stoneware Espresso Cup",
  "memo": "Order hd_0123456789abcdef",
  "message": "Thank you for your Halden order.",
  "amount": "0.08000000"
}
```

3. The service derives a new unified address from the UIVK and answers:

```json
{
  "address": "u1...",
  "qr_text": "zcash:u1...?amount=0.08000000&memo=Order%20hd_..."
}
```

`qr_text` is ready to encode. This store does not build the URI itself.

4. The order page shows the address, the exact amount, and a QR code. The browser polls the store every two seconds. The payment service does not talk to the browser.
5. When the received total for that address changes, the service `POST`s the store at `/webhooks/zcash-payments`. The body looks like:

```json
{
  "event_id": "zcash:42:v3",
  "payment_source": "zcash",
  "address": "u1...",
  "total_received": "0.08000000",
  "observed_at": "2026-01-01T00:00:00Z"
}
```

`X-Signature` is the lowercase hex HMAC-SHA256 of the raw body, using `ZCASH_WEBHOOK_SECRET`.

6. The store checks the signature, ignores a repeated `event_id`, and ignores an older `zcash:<id>:v<version>` once a newer one is applied. `total_received` is the cumulative amount seen at that address, not a wallet balance. With the service's default of zero confirmations, a mempool receipt can count and can later be revised. The order is paid when the latest total covers the price, and it returns to waiting if a later total drops below the price.
7. The next poll paints the payment-received state.

The webhook URL inside Compose is `http://store:3000/webhooks/zcash-payments`. A non-2xx response is treated by the service as a permanent failure, except `429` and `5xx`, which it retries. A bad signature is `401` on purpose.

## Configuration

| Variable | Used by | Purpose |
| --- | --- | --- |
| `ZCASH_UIVK` | payment service | Unified incoming viewing key. Required on first start. Never commit a real one. |
| `ZCASH_BIRTHDAY_HEIGHT` | payment service | First block to scan. Required on first start. |
| `ZCASH_NETWORK` | payment service | `testnet` or `mainnet`. Must match the key. |
| `LIGHTWALLETD_URL` | payment service | Compact-block server. |
| `ZCASH_WEBHOOK_URL` | payment service | Where to POST observations. Compose sets this to the store. |
| `ZCASH_WEBHOOK_SECRET` | both | HMAC secret for `X-Signature`. |
| `ZCASH_PAYMENT_SERVICE_BASE_URL` | store | Usually `http://zcash-payment-service:8787` in Compose, or `http://127.0.0.1:8787` locally. |
| `DATABASE_PATH` | store | SQLite file. Default `data/store.db`. |
| `PORT` | store | Default `3000`. |

## Tests

`npm test` runs the payment flow against a fake payment service. The fake speaks only `POST /payment-session`. The suite checks the request body, the QR text the service returned, signature failures, partial payment, duplicates, a revised total, and that a down service does not leave an order behind.

## Layout

- `src/zcash-payment.ts` — the only file that speaks to the payment service
- `src/orders.ts` — order rows and webhook application
- `src/app.ts` — HTTP routes
- `public/` — the shop UI and product photographs

Product photographs were generated for this sample and are covered by the MIT license.
