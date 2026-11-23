import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { EventRow, Role } from "./types";

export interface Membership {
  id: string;
  role: Role;
  event: EventRow;
}

interface AuthState {
  loading: boolean;
  session: Session | null;
  isPlatformAdmin: boolean;
  memberships: Membership[];
  aal: "aal1" | "aal2" | null;
  hasMfaFactor: boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPlatformAdmin, setPA] = useState(false);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [aal, setAal] = useState<"aal1" | "aal2" | null>(null);
  const [hasMfaFactor, setHasFactor] = useState(false);

  const load = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) {
      setPA(false);
      setMemberships([]);
      setAal(null);
      setLoading(false);
      return;
    }
    const [{ data: pa }, { data: roles }, { data: lvl }, { data: factors }] = await Promise.all([
      supabase.rpc("is_platform_admin"),
      supabase.from("user_roles").select("id, role, event:events(*)").eq("user_id", s.user.id),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ]);
    setPA(Boolean(pa));
    setMemberships(((roles ?? []) as unknown as Membership[]).filter((m) => m.event));
    setAal((lvl?.currentLevel as "aal1" | "aal2" | null) ?? null);
    setHasFactor((factors?.totp ?? []).some((f) => f.status === "verified"));
    setLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      void load(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await load(data.session);
  }, [load]);

  return (
    <Ctx.Provider value={{ loading, session, isPlatformAdmin, memberships, aal, hasMfaFactor, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

/** Family admins and platform admins must complete TOTP 2FA. */
export function needsMfa(a: AuthState): boolean {
  const privileged = a.isPlatformAdmin || a.memberships.some((m) => m.role === "family_admin");
  return privileged && a.aal !== "aal2";
}
