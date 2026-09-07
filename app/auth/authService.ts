import type {
  AuthChangeEvent,
  AuthError,
  Session,
  Subscription,
} from "@supabase/supabase-js";

import { supabase } from "../../lib/supabase/client";

export interface SignInInput {
  email: string;
  password: string;
}

export type AuthServiceErrorCode =
  | "invalid_credentials"
  | "auth_request_failed";

export interface AuthServiceError {
  code: AuthServiceErrorCode;
  message: string;
}

export type AuthServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AuthServiceError };

export type AuthStateCallback = (
  event: AuthChangeEvent,
  session: Session | null,
) => void;

function toServiceError(error?: AuthError): AuthServiceError {
  if (error?.code === "invalid_credentials") {
    return {
      code: "invalid_credentials",
      message: "The email or password is incorrect.",
    };
  }

  return {
    code: "auth_request_failed",
    message: "The authentication request could not be completed.",
  };
}

export async function signIn(
  input: SignInInput,
): Promise<AuthServiceResult<Session>> {
  const { data, error } = await supabase.auth.signInWithPassword(input);

  if (error || !data.session) {
    return { ok: false, error: toServiceError(error ?? undefined) };
  }

  return { ok: true, value: data.session };
}

export async function signOut(): Promise<AuthServiceResult<void>> {
  const { error } = await supabase.auth.signOut();

  if (error) {
    return { ok: false, error: toServiceError(error) };
  }

  return { ok: true, value: undefined };
}

export async function getSession(): Promise<
  AuthServiceResult<Session | null>
> {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    return { ok: false, error: toServiceError(error) };
  }

  return { ok: true, value: data.session };
}

export function subscribeToAuthState(
  callback: AuthStateCallback,
): Subscription {
  const { data } = supabase.auth.onAuthStateChange(callback);

  return data.subscription;
}
