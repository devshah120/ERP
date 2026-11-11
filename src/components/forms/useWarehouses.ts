"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api/client";

export interface WarehouseOption {
  id: string;
  name: string;
  code: string;
  isDefault?: boolean;
}

let cache: Promise<WarehouseOption[]> | null = null;

/** Active warehouses for pickers, fetched once per page load. */
export function useWarehouses() {
  const [list, setList] = useState<WarehouseOption[]>([]);
  useEffect(() => {
    cache ??= apiFetch<{ items: WarehouseOption[] }>("/api/masters/warehouses?pageSize=200&status=ACTIVE").then((r) => r.items);
    let cancelled = false;
    cache
      .then((w) => !cancelled && setList(w))
      .catch(() => {
        cache = null; // let the next mount retry
        if (!cancelled) setList([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return list;
}
