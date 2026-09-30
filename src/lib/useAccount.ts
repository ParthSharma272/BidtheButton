"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./client.ts";

export interface Me {
  id: string;
  email: string;
  display_name: string;
  role: "user" | "admin";
  verified: number;
  is_demo: number;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  read: number;
  created_at: number;
}

export function useAccount() {
  const [user, setUser] = useState<Me | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ user: Me | null; notifications?: Notification[] }>("/api/auth/me");
      setUser(r.user);
      setNotifications(r.notifications ?? []);
    } catch {
      setUser(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST", json: {} });
    setUser(null);
    setNotifications([]);
  }, []);

  return { user, notifications, loaded, refresh, logout };
}
