export interface TenantContext {
  id: string;         // UUID v4 — immutable
  slug: string;       // "dharmanugraha"
  schemaName: string; // "tenant_dharmanugraha"
}

export interface RequestWithTenant extends Request {
  tenant: TenantContext;
}
