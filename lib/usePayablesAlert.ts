"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function usePayablesAlert() {
  const [count, setCount] = useState(0);
  const supabase = createClient();

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const in3 = new Date();
    in3.setDate(in3.getDate() + 3);
    const limit = in3.toISOString().slice(0, 10);

    supabase
      .from("payables")
      .select("id", { count: "exact", head: true })
      .in("status", ["pendente", "vencido"])
      .lte("due_date", limit)
      .then(({ count: c }) => setCount(c ?? 0));
  }, []);

  return count;
}
