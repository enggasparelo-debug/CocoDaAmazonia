import { describe, expect, it, vi } from "vitest";
import {
  enqueueSale,
  flushQueue,
  listQueue,
  type PendingSale,
} from "../lib/offlineQueue";
import type { SupabaseClient } from "@supabase/supabase-js";

// Em Node (sem indexedDB), as funções degradam graciosamente:
//   - enqueueSale: gera o item mas não persiste
//   - listQueue: retorna []
//   - flushQueue: { flushed: 0, failed: 0 }
// Estes testes validam o contrato de degradação.

describe("offlineQueue (sem IndexedDB)", () => {
  it("enqueueSale gera localId, payload e timestamp", async () => {
    const payload: PendingSale["payload"] = {
      customer_id: "c1",
      quantity: 5,
      unit_price: 10,
      discount: 0,
      total: 50,
      notes: null,
    };
    const item = await enqueueSale(payload);
    expect(item.localId).toBeTruthy();
    expect(typeof item.localId).toBe("string");
    expect(item.localId.length).toBeGreaterThan(5);
    expect(item.payload).toEqual(payload);
    expect(item.createdAt).toBeGreaterThan(0);
    expect(item.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it("listQueue retorna [] quando IndexedDB ausente", async () => {
    const list = await listQueue();
    expect(list).toEqual([]);
  });

  it("flushQueue retorna {flushed:0, failed:0} sem chamar supabase", async () => {
    const insert = vi.fn();
    const fakeSupabase = {
      from: () => ({ insert }),
    } as unknown as SupabaseClient;
    const out = await flushQueue(fakeSupabase);
    expect(out).toEqual({ flushed: 0, failed: 0 });
    expect(insert).not.toHaveBeenCalled();
  });

  it("enqueueSale gera localIds únicos em chamadas consecutivas", async () => {
    const a = await enqueueSale({
      customer_id: null,
      quantity: 1,
      unit_price: 1,
      discount: 0,
      total: 1,
      notes: null,
    });
    const b = await enqueueSale({
      customer_id: null,
      quantity: 1,
      unit_price: 1,
      discount: 0,
      total: 1,
      notes: null,
    });
    expect(a.localId).not.toBe(b.localId);
  });
});
