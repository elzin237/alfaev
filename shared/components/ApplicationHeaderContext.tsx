import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useLocation } from "react-router";
import { useAuth } from "../../app/auth/AuthProvider";
import { frontendEnv } from "../../lib/config/env";
import { getHeaderMetadata } from "../../app/router/headerMetadata";

interface LabelRegistration { token: symbol; scope: string; route: string; label: string }
interface HeaderContextValue {
  scope: string | null;
  route: string;
  registration: LabelRegistration | null;
  publish: Dispatch<SetStateAction<LabelRegistration | null>>;
}
const HeaderContext = createContext<HeaderContextValue | null>(null);

export function ApplicationHeaderProvider({ children }: { children: ReactNode }) {
  const auth = useAuth(), location = useLocation();
  const scope = !auth.isLoading && !auth.error && auth.isActive && auth.profile?.isActive && auth.session &&
    auth.session.user.id === auth.profile.authUserId
    ? JSON.stringify([frontendEnv.supabaseUrl, auth.session.user.id, auth.profile.id, auth.isAdmin])
    : null;
  const route = JSON.stringify([location.key, location.pathname, location.search, location.hash]);
  const [registration, publish] = useState<LabelRegistration | null>(null);
  const value = useMemo(() => ({ scope, route, registration, publish }), [scope, route, registration]);
  return <HeaderContext.Provider value={value}>{children}</HeaderContext.Provider>;
}

// Pages publish ONLY display context from their own successful authorized read.
// No cache scanning, new requests, persisted state or URL-derived record names.
export function useApplicationHeaderLabel(label: string | null) {
  const context = useContext(HeaderContext);
  const scope = context?.scope, route = context?.route, publish = context?.publish;
  const previous = useRef({ scope, label });
  useLayoutEffect(() => {
    const last = previous.current;
    previous.current = { scope, label };
    // A profile/authority change cannot rebind unchanged, potentially cached text.
    // The page must clear/revalidate its read before publishing that text again.
    if (last.scope !== scope && last.label === label) return;
    if (!publish || !scope || !route || !label?.trim()) return;
    const token = Symbol("authorized-header-label");
    publish({ token, scope, route, label: label.trim() });
    // Before paint: revoked/unmounted screens cannot leave an old name visible.
    return () => publish(current => current?.token === token ? null : current);
  }, [publish, scope, route, label]);
}

export function useApplicationHeader() {
  const location = useLocation(), context = useContext(HeaderContext);
  const metadata = getHeaderMetadata(location.pathname);
  const entry = context?.registration;
  return metadata.contextual && context?.scope && entry?.scope === context.scope && entry.route === context.route
    ? { ...metadata, subtitle: entry.label }
    : metadata;
}
