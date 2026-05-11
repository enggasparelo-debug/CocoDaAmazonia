"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function usePayablesAlert() {
  const [count, setCount] = useState(0);
  const supabase = createClient();

  useEffect(() => {
    const in3 = new Date();
    in3.setDate(in3.getDate() + 3);
    const limit = in3.toISOString().slice(0, 10);

    Promise.all([
      supabase
        .from("payables")
        .select("id", { count: "exact", head: true })
        .in("status", ["pendente", "vencido"])
        .lte("due_date", limit),
      supabase
        .from("expenses")
        .select("id", { count: "exact", head: true })
        .eq("status", "open")
        .is("carga_id", null)
        .lte("due_date", limit),
    ]).then(([p, e]) => setCount((p.count ?? 0) + (e.count ?? 0)));
  }, []);

  return count;
}
