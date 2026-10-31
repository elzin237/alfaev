import { matchRoutes } from "react-router";

export interface HeaderMetadata {
  title: string;
  subtitle: string;
  contextual?: boolean;
}

// The app uses declarative Routes (not a data router/useMatches). Match through
// React Router here and keep exact coverage checked against AppRouter in tests.
// Mirrors registered screens, not URL prefixes: /pcb/test and /work-orders/new
// must outrank detail parameters. Dialog-based Create/Edit flows keep their module.
export const HEADER_ROUTES = [
  { path: "/", handle: { title: "Operations Overview", subtitle: "From planning to production." } },
  { path: "/projects", handle: { title: "Projects", subtitle: "Planning, delivery and project progress." } },
  { path: "/projects/:projectId", handle: { title: "Projects", subtitle: "Project details and delivery planning.", contextual: true } },
  { path: "/procurement", handle: { title: "Procurement", subtitle: "Requests, deliveries and supplier coordination." } },
  { path: "/suppliers", handle: { title: "Suppliers", subtitle: "Supplier relationships and product sourcing." } },
  { path: "/suppliers/:supplierId", handle: { title: "Suppliers", subtitle: "Supplier details and product sourcing.", contextual: true } },
  { path: "/inventory", handle: { title: "Inventory", subtitle: "Materials and stock management." } },
  { path: "/inventory/:productId", handle: { title: "Inventory", subtitle: "Product details and warehouse balances.", contextual: true } },
  { path: "/pcb/test", handle: { title: "Test Calculator", subtitle: "Calculations, material planning and saved history." } },
  { path: "/pcb", handle: { title: "Product Calculator", subtitle: "BOMs and finished-product definitions." } },
  { path: "/pcb/:pcbCardId", handle: { title: "Product Calculator", subtitle: "Product definition and BOM management.", contextual: true } },
  { path: "/pcb/:pcbCardId/produce", handle: { title: "Production Planning", subtitle: "Prepare a PCB production Work Order.", contextual: true } },
  { path: "/work-orders", handle: { title: "Work Orders", subtitle: "Production plans, materials and completion." } },
  { path: "/work-orders/new", handle: { title: "New Work Order", subtitle: "Plan production and component requirements." } },
  { path: "/work-orders/:workOrderId", handle: { title: "Work Orders", subtitle: "Work Order details and production progress.", contextual: true } },
  { path: "/work-orders/:workOrderId/pdf", handle: { title: "Work Order Document", subtitle: "Authorized production records and documents." } },
  { path: "/documents", handle: { title: "Documentation", subtitle: "Company documents and reference records." } },
  { path: "/fixed-assets", handle: { title: "Fixed Assets", subtitle: "Asset records, ownership and lifecycle." } },
  { path: "/users", handle: { title: "Users", subtitle: "Profiles, account access and permissions." } },
  { path: "/users/:userId", handle: { title: "Users", subtitle: "User profile and access settings.", contextual: true } },
  { path: "/calendar", handle: { title: "Calendar", subtitle: "Upcoming events and important dates." } },
  { path: "/archive", handle: { title: "Archive", subtitle: "Archived records and authorized restoration." } },
  { path: "/login", handle: { title: "Sign in", subtitle: "Secure access to AlfaEV." } },
] satisfies { path: string; handle: HeaderMetadata }[];

const FALLBACK: HeaderMetadata = { title: "AlfaEV", subtitle: "Choose an available page from the navigation." };

export function getHeaderMetadata(pathname: string): HeaderMetadata {
  const matches = matchRoutes(HEADER_ROUTES, { pathname });
  return matches?.[matches.length - 1]?.route.handle ?? FALLBACK;
}
