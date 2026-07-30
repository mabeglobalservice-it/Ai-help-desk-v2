"use client";

import { useEffect, useRef } from "react";
import { getSocket } from "./socket";

// Subscribes to a single Socket.IO event for the lifetime of the component.
// The subscription itself only depends on `event` (typically a constant),
// but always calls the latest `handler` via a ref — so callers can pass an
// inline function that closes over current props/state (e.g. active
// filters) without the listener ever running a stale closure.
// Returns silently (no-op) when there's no session yet — pages that render
// before login shouldn't attempt a connection.
export function useRealtimeEvent<T = unknown>(event: string, handler: (payload: T) => void) {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const listener = (payload: T) => handlerRef.current(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [event]);
}
