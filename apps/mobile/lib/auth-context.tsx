import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "./supabase";

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export class MobileAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MobileAuthError";
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) {
        setSession(nextSession);
        setLoading(false);
      }
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      setSession(error ? null : data.session);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setSession(null);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const value: AuthContextValue = {
    configured: Boolean(supabase),
    loading,
    session,
    async signIn(email, password) {
      if (!supabase) throw new MobileAuthError("Authentication is not configured.");
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new MobileAuthError("Sign-in failed. Check your credentials and connection.");
    },
    async signUp(email, password) {
      if (!supabase) throw new MobileAuthError("Authentication is not configured.");
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw new MobileAuthError("Account creation failed. Check your details and connection.");
      return !data.session;
    },
    async signOut() {
      if (!supabase) return;
      const { error } = await supabase.auth.signOut();
      if (error) throw new MobileAuthError("Sign-out failed. Please try again.");
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}