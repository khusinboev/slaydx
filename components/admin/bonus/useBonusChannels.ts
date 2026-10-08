"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AdminAuthRequiredError, AdminForbiddenError, adminErrorMessage, adminRequestId, isAbortError } from "@/lib/admin-api/core";
import { bonusChannelBotStatus, listBonusChannels, type BonusChannel } from "@/lib/admin-api/bonus";
import type { BotCheck } from "./format";

export type ChannelsState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "error"; message: string; requestId?: string }
  | { status: "ready"; items: BonusChannel[] };

function sorted(items: BonusChannel[]): BonusChannel[] {
  return [...items].sort((a, b) => a.sort - b.sort || Number(a.id) - Number(b.id));
}

/**
 * Loads the channel list and, once it is there, checks the bot's admin status of every
 * channel (live Bot API calls; nothing about it is stored server-side). `recheck(id)` repeats
 * one check (the «Qayta tekshirish» button); `upsert` / `remove` apply a write's result
 * without another list request. A 401 `admin_auth` keeps the skeleton: the core has already
 * started the redirect to the login page.
 */
export function useBonusChannels() {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ attempt: number; value: ChannelsState }>({ attempt: 0, value: { status: "loading" } });
  const [bot, setBot] = useState<Record<string, BotCheck>>({});
  const alive = useRef(true);
  const checks = useRef(new Map<string, AbortController>());

  useEffect(() => {
    alive.current = true;
    const pending = checks.current;
    return () => {
      alive.current = false;
      for (const ctl of pending.values()) ctl.abort();
    };
  }, []);

  const recheck = useCallback((id: string) => {
    checks.current.get(id)?.abort();
    const ctl = new AbortController();
    checks.current.set(id, ctl);
    setBot((b) => ({ ...b, [id]: { status: "checking" } }));
    bonusChannelBotStatus(id, { signal: ctl.signal })
      .then((r) => {
        if (alive.current) setBot((b) => ({ ...b, [id]: { status: r.botAdmin, warning: r.warning } }));
      })
      .catch((e: unknown) => {
        if (isAbortError(e) || ctl.signal.aborted || !alive.current) return;
        setBot((b) => ({ ...b, [id]: { status: "unknown", warning: adminErrorMessage(e) } }));
      })
      .finally(() => {
        if (checks.current.get(id) === ctl) checks.current.delete(id);
      });
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    listBonusChannels({ signal: ctl.signal })
      .then((r) => {
        setLoaded({ attempt, value: { status: "ready", items: sorted(r.items) } });
        for (const c of r.items) recheck(c.id);
      })
      .catch((e: unknown) => {
        if (isAbortError(e) || ctl.signal.aborted || e instanceof AdminAuthRequiredError) return;
        const value: ChannelsState =
          e instanceof AdminForbiddenError ? { status: "forbidden" } : { status: "error", message: adminErrorMessage(e), requestId: adminRequestId(e) };
        setLoaded({ attempt, value });
      });
    return () => ctl.abort();
  }, [attempt, recheck]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const upsert = useCallback((item: BonusChannel) => {
    setLoaded((cur) => {
      if (cur.value.status !== "ready") return cur;
      const rest = cur.value.items.filter((i) => i.id !== item.id);
      return { attempt: cur.attempt, value: { status: "ready", items: sorted([...rest, item]) } };
    });
  }, []);

  const remove = useCallback((id: string) => {
    setLoaded((cur) =>
      cur.value.status === "ready" ? { attempt: cur.attempt, value: { status: "ready", items: cur.value.items.filter((i) => i.id !== id) } } : cur,
    );
  }, []);

  const setBotStatus = useCallback((id: string, check: BotCheck) => setBot((b) => ({ ...b, [id]: check })), []);

  const state: ChannelsState = loaded.attempt === attempt ? loaded.value : { status: "loading" };
  return { state, bot, reload, recheck, upsert, remove, setBotStatus };
}
