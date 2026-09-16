import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  adminRpc: vi.fn(),
  recordSingle: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  download: vi.fn(),
  metadataRpc: vi.fn(),
  handler: null as null | ((request: Request) => Response | Promise<Response>),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

const recordId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const oldPath = `${recordId}/33333333-3333-4333-8333-333333333333.pdf`;

async function handler() {
  vi.stubGlobal("Deno", {
    env: { get: (name: string) => ({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
    })[name as "SUPABASE_URL" | "SUPABASE_ANON_KEY" | "SUPABASE_SERVICE_ROLE_KEY"] },
    serve: (value: typeof mocks.handler) => { mocks.handler = value; },
  });
  await import("../../supabase/functions/admin-documentation-pdf/index");
  if (!mocks.handler) throw new Error("Edge handler was not registered");
  return mocks.handler;
}

function uploadRequest() {
  const form = new FormData();
  form.set("action", "upload");
  form.set("recordId", recordId);
  form.set("file", new File(["%PDF-1.4\n1 0 obj\n%%EOF\n"], "user-name.pdf", { type: "application/pdf" }));
  return new Request("https://example.test", {
    method: "POST", headers: { Authorization: "Bearer actor-token" }, body: form,
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.handler = null;
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mocks.adminRpc.mockResolvedValue({ data: true, error: null });
  mocks.recordSingle.mockResolvedValue({ data: {
    id: recordId, is_active: true, pdf_storage_path: oldPath,
  }, error: null });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.download.mockResolvedValue({ data: new Blob(["%PDF-1.4\n%%EOF"]), error: null });
  mocks.metadataRpc.mockResolvedValue({ error: null });
  const actor = {
    auth: { getUser: mocks.getUser }, rpc: mocks.adminRpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.recordSingle }) }) }),
  };
  const service = {
    storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove, download: mocks.download }) },
    rpc: mocks.metadataRpc,
  };
  mocks.createClient.mockImplementation((_url: string, key: string) => key === "anon" ? actor : service);
});

describe("Documentation Edge orchestration", () => {
  it("denies inactive/non-Admin before object upload or metadata mutation", async () => {
    mocks.adminRpc.mockResolvedValue({ data: false, error: null });
    const response = await (await handler())(uploadRequest());
    expect(response.status).toBe(403);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.metadataRpc).not.toHaveBeenCalled();
  });

  it("rejects PDF-looking filenames with non-PDF bytes before upload", async () => {
    const form = new FormData();
    form.set("action", "upload");
    form.set("recordId", recordId);
    form.set("file", new File(["not a PDF, despite its extension"], "fake.pdf", { type: "application/pdf" }));
    const request = new Request("https://example.test", {
      method: "POST", headers: { Authorization: "Bearer actor-token" }, body: form,
    });
    const result = await (await handler())(request);
    expect(result.status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.metadataRpc).not.toHaveBeenCalled();
  });

  it("blocks attachment changes on archived Documentation", async () => {
    mocks.recordSingle.mockResolvedValue({ data: {
      id: recordId, is_active: false, pdf_storage_path: oldPath,
    }, error: null });
    const result = await (await handler())(uploadRequest());
    expect(result.status).toBe(409);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("removes the new object after a failed DB swap and preserves the old reference", async () => {
    mocks.metadataRpc.mockResolvedValue({ error: { code: "DOC04" } });
    const response = await (await handler())(uploadRequest());
    expect(response.status).toBe(409);
    const path = mocks.upload.mock.calls[0]?.[0] as string;
    expect(path).toMatch(new RegExp(`^${recordId}/[0-9a-f-]+\\.pdf$`));
    expect(path).not.toContain("user-name");
    expect(mocks.metadataRpc).toHaveBeenCalledWith("set_documentation_pdf_reference_admin", {
      p_record_id: recordId, p_expected_path: oldPath,
      p_new_path: path, p_actor_auth_user_id: userId,
    });
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith([path]);
    expect(mocks.remove).not.toHaveBeenCalledWith([oldPath]);
  });

  it("swaps to a new generated object before best-effort cleanup of the old one", async () => {
    const events: string[] = [];
    mocks.upload.mockImplementation(async () => { events.push("upload"); return { error: null }; });
    mocks.metadataRpc.mockImplementation(async () => { events.push("swap"); return { error: null }; });
    mocks.remove.mockImplementation(async () => { events.push("remove-old"); return { error: null }; });
    const response = await (await handler())(uploadRequest());
    expect(response.status).toBe(200);
    expect(events).toEqual(["upload", "swap", "remove-old"]);
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith([oldPath]);
  });

  it("reports success when old-object cleanup fails after the committed swap", async () => {
    mocks.remove.mockRejectedValue(new Error("transient Storage cleanup failure"));
    const response = await (await handler())(uploadRequest());
    expect(response.status).toBe(200);
    expect(mocks.metadataRpc).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledWith([oldPath]);
  });

  it("never deletes the object before a failed remove-reference mutation", async () => {
    mocks.metadataRpc.mockResolvedValue({ error: { code: "DOC04" } });
    const request = new Request("https://example.test", {
      method: "POST",
      headers: { Authorization: "Bearer actor-token", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", recordId }),
    });
    const response = await (await handler())(request);
    expect(response.status).toBe(409);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
