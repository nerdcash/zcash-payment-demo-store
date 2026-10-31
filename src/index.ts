import { createApp } from "./app.js";
import { loadEnvFile } from "./env.js";
import { openOrders } from "./orders.js";
import { createZcashPaymentClient } from "@nerdcash/zcash-payment-client";

loadEnvFile();

const secret = process.env.ZCASH_WEBHOOK_SECRET ?? "";
if (!secret) {
  console.error("Set ZCASH_WEBHOOK_SECRET. Copy .env.example to .env to start.");
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("PORT must be an integer between 1 and 65535");
  process.exit(1);
}

const baseUrl = process.env.ZCASH_PAYMENT_SERVICE_BASE_URL ?? "http://127.0.0.1:8787";
const orders = openOrders(process.env.DATABASE_PATH ?? "data/store.db");
const payments = createZcashPaymentClient({ baseUrl, webhookSecret: secret });
const app = createApp({ orders, payments });

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Halden listening on http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      orders.close();
      process.exit(0);
    });
  });
}
