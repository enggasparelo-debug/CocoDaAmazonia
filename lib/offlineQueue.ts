"use client";

// Fila de vendas offline persistida em IndexedDB.
// Quando a internet volta, os itens são reenviados ao Supabase.
//
// Limitações: a venda offline NÃO abre o modal de pagamento — fica como
// "aberta" e só sincroniza o cabeçalho. Pagamentos podem ser lançados depois
// pelas Contas a Receber (caso seja fiado) ou editando a venda.

import type { SupabaseClient } from "@supabase/supabase-js";

const DB_NAME = "coco-offline";
const STORE = "pending-sales";

export type PendingSale = {
  localId: string;
  payload: {
    customer_id: string | null;
    quantity: number;
    unit_price: number;
    discount: number;
    total: number;
    notes: string | null;
  };
  createdAt: number;
};

function idb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "localId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => Promise<T> | T
): Promise<T | null> {
  const db = await idb();
  if (!db) return null;
  return new Promise<T | null>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result: T | null = null;
    Promise.resolve(fn(store))
      .then((r) => (result = r ?? null))
      .catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function enqueueSale(payload: PendingSale["payload"]) {
  const item: PendingSale = {
    localId:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `local-${Date.now()}-${Math.random()}`,
    payload,
    createdAt: Date.now(),
  };
  await tx("readwrite", (s) => s.put(item));
  return item;
}

export async function listQueue(): Promise<PendingSale[]> {
  return new Promise<PendingSale[]>((resolve, reject) => {
    idb().then((db) => {
      if (!db) return resolve([]);
      const t = db.transaction(STORE, "readonly");
      const req = t.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as PendingSale[]);
      req.onerror = () => reject(req.error);
    });
  });
}

async function removeFromQueue(localId: string) {
  await tx("readwrite", (s) => s.delete(localId));
}

export async function flushQueue(supabase: SupabaseClient): Promise<{
  flushed: number;
  failed: number;
}> {
  const items = await listQueue();
  let flushed = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const { error } = await supabase.from("sales").insert(item.payload);
      if (error) throw error;
      await removeFromQueue(item.localId);
      flushed++;
    } catch (e) {
      failed++;
      // não remove — tenta de novo na próxima
    }
  }
  return { flushed, failed };
}
