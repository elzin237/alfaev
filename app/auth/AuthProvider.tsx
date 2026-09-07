import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";

import { getSession, subscribeToAuthState } from "./authService";
import {
  loadUserProfile,
  type ProfileServiceErrorCode,
  type UserProfile,
} from "./profileService";

export type AuthStateErrorCode =
  | "session_restore_failed"
  | ProfileServiceErrorCode;

export interface AuthStateError {
  code: AuthStateErrorCode;
  message: string;
}

export interface AuthState {
  session: Session | null;
  profile: UserProfile | null;
  isAdmin: boolean;
  isActive: boolean;
  isLoading: boolean;
  error: AuthStateError | null;
}

interface AuthProviderProps {
  children: ReactNode;
}

interface StoredAuthState {
  session: Session | null;
  profile: UserProfile | null;
  isLoading: boolean;
  error: AuthStateError | null;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

const initialState: StoredAuthState = {
  session: null,
  profile: null,
  isLoading: true,
  error: null,
};

function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<StoredAuthState>(initialState);
  const operationIdRef = useRef(0);

  const applySession = useCallback(async (session: Session | null) => {
    const operationId = ++operationIdRef.current;

    if (!session) {
      setState({
        session: null,
        profile: null,
        isLoading: false,
        error: null,
      });
      return;
    }

    setState({
      session,
      profile: null,
      isLoading: true,
      error: null,
    });

    try {
      const profileResult = await loadUserProfile(session.user.id);

      if (operationId !== operationIdRef.current) {
        return;
      }

      if (!profileResult.ok) {
        setState({
          session,
          profile: null,
          isLoading: false,
          error: profileResult.error,
        });
        return;
      }

      setState({
        session,
        profile: profileResult.value,
        isLoading: false,
        error: null,
      });
    } catch {
      if (operationId === operationIdRef.current) {
        setState({
          session,
          profile: null,
          isLoading: false,
          error: {
            code: "profile_load_failed",
            message: "The AlfaEV profile could not be loaded.",
          },
        });
      }
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const restoreOperationId = ++operationIdRef.current;
    const subscription = subscribeToAuthState((_event, session) => {
      queueMicrotask(() => {
        if (isMounted) {
          void applySession(session);
        }
      });
    });

    void getSession()
      .then((sessionResult) => {
        if (
          !isMounted ||
          restoreOperationId !== operationIdRef.current
        ) {
          return;
        }

        if (!sessionResult.ok) {
          ++operationIdRef.current;
          setState({
            session: null,
            profile: null,
            isLoading: false,
            error: {
              code: "session_restore_failed",
              message: sessionResult.error.message,
            },
          });
          return;
        }

        void applySession(sessionResult.value);
      })
      .catch(() => {
        if (
          isMounted &&
          restoreOperationId === operationIdRef.current
        ) {
          ++operationIdRef.current;
          setState({
            session: null,
            profile: null,
            isLoading: false,
            error: {
              code: "session_restore_failed",
              message: "The authentication session could not be restored.",
            },
          });
        }
      });

    return () => {
      isMounted = false;
      ++operationIdRef.current;
      subscription.unsubscribe();
    };
  }, [applySession]);

  const value: AuthState = {
    ...state,
    isAdmin: state.profile?.isAdmin ?? false,
    isActive: state.profile?.isActive ?? false,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}

export default AuthProvider;
