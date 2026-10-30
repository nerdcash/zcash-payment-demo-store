import { randomBytes } from "node:crypto";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { getProduct } from "./catalog.js";
import { MoneyError, formatZatAsZec, zecToZat } from "./money.js";
import { type Order, type OrderStore } from "./orders.js";
import {
  homePage,
  missingOrderPage,
  notFoundPage,
  orderPage,
  productPage,
  cartPage,
  checkoutPage,
} from "./pages.js";
import {
  PaymentServiceError,
  WebhookPayloadError,
  WebhookSignatureError,
  type ZcashPaymentClient,
} from "@nerdcash/zcash-payment-client";

const ORDER_ID = /^hd_[0-9a-f]{16}$/;

export type AppDeps = {
  orders: OrderStore;
  payments: ZcashPaymentClient;
};

class CheckoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutError";
  }
}

export function createApp(deps: AppDeps): express.Express {
  const { orders, payments } = deps;
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post(
    "/webhooks/zcash-payments",
    express.raw({ type: () => true, limit: "64kb" }),
    (req, res, next) => {
      try {
        const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const observation = payments.verifyWebhook(rawBody, req.get("x-signature"));
        const receivedZat = zecToZatOrThrow(observation.total_received);
        const result = orders.applyObservation({
          eventId: observation.event_id,
          address: observation.address,
          receivedZat,
          observedAt: observation.observed_at,
        });
        res.setHeader("cache-control", "no-store");
        res.json({ ok: true, outcome: result.outcome });
      } catch (error) {
        next(error);
      }
    },
  );

  app.use(express.json({ limit: "32kb" }));
  app.use(express.static(path.resolve(import.meta.dirname, "../public"), { index: false }));

  app.get("/", (_req, res) => {
    res.type("html").send(homePage());
  });

  app.get("/cart", (_req, res) => {
    res.type("html").send(cartPage());
  });

  app.get("/checkout", (_req, res) => {
    res.type("html").send(checkoutPage());
  });

  app.get("/products/:id", (req, res) => {
    const product = getProduct(req.params.id);
    if (!product) {
      res.status(404).type("html").send(notFoundPage());
      return;
    }
    res.type("html").send(productPage(product));
  });

  app.get("/orders/:id", asyncRoute(async (req, res) => {
    res.setHeader("cache-control", "no-store");
    const order = findOrder(orders, req.params.id);
    if (!order) {
      res.status(404).type("html").send(missingOrderPage());
      return;
    }
    res.type("html").send(await orderPage(order));
  }));

  app.get("/api/orders/:id", (req, res) => {
    res.setHeader("cache-control", "no-store");
    const order = findOrder(orders, req.params.id);
    if (!order) {
      res.status(404).json({ error: "order not found" });
      return;
    }
    res.json(orderStatus(order));
  });

  app.post("/api/checkout", asyncRoute(async (req, res) => {
    if (rejectCrossSite(req, res)) return;
    const checkout = parseCheckout(req.body);
    const id = `hd_${randomBytes(8).toString("hex")}`;
    const amountZat = checkout.items.reduce((sum, item) => sum + item.unitZat * item.qty, 0);
    const amount = formatZatAsZec(amountZat);
    const label = checkout.items.length === 1 ? checkout.items[0].name : `Halden order · ${checkout.items.length} items`;
    const session = await payments.createPaymentSession({
      label,
      memo: `Order ${id}`,
      message: "Thank you for your Halden order.",
      amount,
    });
    const order = orders.create({
      id,
      email: checkout.email,
      items: checkout.items,
      amountZat,
      address: session.address,
      qrText: session.qr_text,
    });
    res.status(201).json({ orderId: order.id, url: `/orders/${order.id}` });
  }));

  app.use((_req, res) => {
    res.status(404).type("html").send(notFoundPage());
  });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const wantsJson = req.path.startsWith("/api") || req.path.startsWith("/webhooks");
    if (error instanceof CheckoutError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof WebhookSignatureError) {
      res.status(401).json({ error: error.message });
      return;
    }
    if (error instanceof WebhookPayloadError || error instanceof MoneyError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof PaymentServiceError) {
      res.status(502).json({
        error: "Could not start a Zcash payment. The payment service did not return an address.",
        detail: error.message,
      });
      return;
    }
    console.error(error);
    if (wantsJson) {
      res.status(500).json({ error: "something went wrong" });
      return;
    }
    res.status(500).type("html").send(notFoundPage());
  });

  return app;
}

function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

function findOrder(orders: OrderStore, id: string): Order | undefined {
  if (!ORDER_ID.test(id)) return undefined;
  return orders.get(id);
}

function orderStatus(order: Order) {
  return {
    id: order.id,
    status: order.status,
    amount: formatZatAsZec(order.amountZat),
    received: formatZatAsZec(order.amountReceivedZat),
    amountZat: order.amountZat,
    receivedZat: order.amountReceivedZat,
    paidAt: order.paidAt,
  };
}

function zecToZatOrThrow(amount: string): number {
  try {
    return zecToZat(amount);
  } catch (error) {
    if (error instanceof MoneyError) {
      throw new WebhookPayloadError("total_received is not a ZEC amount");
    }
    throw error;
  }
}

function rejectCrossSite(req: Request, res: Response): boolean {
  if (req.get("sec-fetch-site") !== "cross-site") return false;
  res.status(403).json({ error: "cross-site request rejected" });
  return true;
}

type CheckoutItem = { id: string; name: string; qty: number; unitZat: number };

function parseCheckout(body: unknown): { email: string; items: CheckoutItem[] } {
  if (!isRecord(body)) throw new CheckoutError("expected a JSON object");
  if (typeof body.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) || body.email.length > 200) {
    throw new CheckoutError("enter a valid email");
  }
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 20) {
    throw new CheckoutError("your cart is empty");
  }

  const qtyById = new Map<string, number>();
  for (const item of body.items) {
    if (!isRecord(item) || typeof item.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(item.id)) {
      throw new CheckoutError("unknown product");
    }
    if (typeof item.qty !== "number" || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 9) {
      throw new CheckoutError("quantity must be between 1 and 9");
    }
    if (!getProduct(item.id)) throw new CheckoutError("unknown product");
    const next = (qtyById.get(item.id) ?? 0) + item.qty;
    if (next > 9) throw new CheckoutError("quantity must be between 1 and 9");
    qtyById.set(item.id, next);
  }

  const items = [...qtyById.entries()].map(([id, qty]) => {
    const product = getProduct(id);
    if (!product) throw new CheckoutError("unknown product");
    return { id: product.id, name: product.name, qty, unitZat: product.priceZat };
  });
  return { email: body.email.trim(), items };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
