import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type OrderStatus = "awaiting_payment" | "paid";

export type OrderItem = {
  id: string;
  name: string;
  qty: number;
  unitZat: number;
};

export type Order = {
  id: string;
  email: string;
  items: OrderItem[];
  amountZat: number;
  amountReceivedZat: number;
  address: string;
  qrText: string;
  status: OrderStatus;
  lastEventId: string | null;
  lastEventVersion: number | null;
  lastObservedAt: string | null;
  createdAt: string;
  paidAt: string | null;
};

export type NewOrder = {
  id: string;
  email: string;
  items: OrderItem[];
  amountZat: number;
  address: string;
  qrText: string;
};

export type ApplyObservationInput = {
  eventId: string;
  address: string;
  receivedZat: number;
  observedAt: string;
};

export type ApplyResult =
  | { outcome: "applied"; order: Order }
  | { outcome: "duplicate"; order: Order }
  | { outcome: "stale"; order: Order }
  | { outcome: "unknown_address" };

type OrderRow = {
  id: string;
  email: string;
  items_json: string;
  amount_zat: number | bigint;
  amount_received_zat: number | bigint;
  address: string;
  qr_text: string;
  status: OrderStatus;
  last_event_id: string | null;
  last_event_version: number | bigint | null;
  last_observed_at: string | null;
  created_at: string;
  paid_at: string | null;
};

export class OrderStore {
  private readonly db: DatabaseSync;

  constructor(filename: string) {
    if (filename !== ":memory:") {
      mkdirSync(dirname(filename), { recursive: true });
    }
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA foreign_keys = ON");
    if (filename !== ":memory:") {
      this.db.exec("PRAGMA journal_mode = WAL");
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        items_json TEXT NOT NULL,
        amount_zat INTEGER NOT NULL,
        amount_received_zat INTEGER NOT NULL,
        address TEXT NOT NULL UNIQUE,
        qr_text TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('awaiting_payment', 'paid')),
        last_event_id TEXT,
        last_event_version INTEGER,
        last_observed_at TEXT,
        created_at TEXT NOT NULL,
        paid_at TEXT
      );

      CREATE TABLE IF NOT EXISTS webhook_events (
        event_id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
    `);
  }

  create(order: NewOrder): Order {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO orders (
          id, email, items_json, amount_zat, amount_received_zat, address, qr_text,
          status, last_event_id, last_event_version, last_observed_at, created_at, paid_at
        ) VALUES (?, ?, ?, ?, 0, ?, ?, 'awaiting_payment', NULL, NULL, NULL, ?, NULL)`,
      )
      .run(order.id, order.email, JSON.stringify(order.items), order.amountZat, order.address, order.qrText, now);
    return this.mustGet(order.id);
  }

  get(id: string): Order | undefined {
    const row = this.db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as OrderRow | undefined;
    return row ? mapOrder(row) : undefined;
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number | bigint };
    return Number(row.n);
  }

  applyObservation(input: ApplyObservationInput): ApplyResult {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.applyLocked(input);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  private applyLocked(input: ApplyObservationInput): ApplyResult {
    const row = this.db.prepare("SELECT * FROM orders WHERE address = ?").get(input.address) as OrderRow | undefined;
    if (!row) return { outcome: "unknown_address" };

    const order = mapOrder(row);
    const inserted = this.db
      .prepare("INSERT OR IGNORE INTO webhook_events (event_id, order_id, received_at) VALUES (?, ?, ?)")
      .run(input.eventId, order.id, new Date().toISOString());
    if (Number(inserted.changes) === 0) {
      return { outcome: "duplicate", order: this.mustGet(order.id) };
    }

    const version = eventVersion(input.eventId);
    if (order.lastEventVersion !== null && (version === null || version < order.lastEventVersion)) {
      return { outcome: "stale", order };
    }

    const status: OrderStatus = input.receivedZat >= order.amountZat ? "paid" : "awaiting_payment";
    const paidAt = status === "paid" ? (order.paidAt ?? new Date().toISOString()) : null;
    this.db
      .prepare(
        `UPDATE orders
         SET amount_received_zat = ?, status = ?, last_event_id = ?, last_event_version = ?,
             last_observed_at = ?, paid_at = ?
         WHERE id = ?`,
      )
      .run(
        input.receivedZat,
        status,
        input.eventId,
        version,
        input.observedAt,
        paidAt,
        order.id,
      );

    return { outcome: "applied", order: this.mustGet(order.id) };
  }

  private mustGet(id: string): Order {
    const order = this.get(id);
    if (!order) throw new Error(`order ${id} disappeared`);
    return order;
  }
}

export function openOrders(filename: string): OrderStore {
  return new OrderStore(filename);
}

export function eventVersion(eventId: string): number | null {
  const match = /^zcash:\d+:v(\d+)$/.exec(eventId);
  if (!match) return null;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) ? version : null;
}

function mapOrder(row: OrderRow): Order {
  return {
    id: row.id,
    email: row.email,
    items: JSON.parse(row.items_json) as OrderItem[],
    amountZat: Number(row.amount_zat),
    amountReceivedZat: Number(row.amount_received_zat),
    address: row.address,
    qrText: row.qr_text,
    status: row.status,
    lastEventId: row.last_event_id,
    lastEventVersion: row.last_event_version === null ? null : Number(row.last_event_version),
    lastObservedAt: row.last_observed_at,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}
