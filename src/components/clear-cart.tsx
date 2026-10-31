"use client";
import { useEffect } from "react";
import { useCart } from "./cart-store";

export function ClearCartOnPaid() {
  const { clear, count, ready } = useCart();
  useEffect(() => {
    if (ready && count > 0) clear();
  }, [ready, count, clear]);
  return null;
}
