import { createClient } from "@supabase/supabase-js";

import {
  documentationPdfBucket,
  generatedPdfPath,
  isPdfAction,
  isRecordId,
  isValidPdf,
} from "./validation";

interface DenoRuntime {
  env: { get: (name: string) => string | undefined };
  serve: (handler: (request: Request) => Response | Promise<Response>) => void;
}

interface DocumentationRow {
  id: string;
  is_active: boolean;
  pdf_storage_path: string | null;
}

const deno = (globalThis as typeof globalThis & { Deno: DenoRuntime }).Deno;
const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
} as const;

function response(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status, headers: corsHeaders });
}

function bearerToken(request: Request): string | null {
  return /^Bearer\s+([^\s]+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? null;
}

function isDocumentationRow(value: unknown): value is DocumentationRow {
  return typeof value === "object" && value !== null &&
    "id" in value && isRecordId(value.id) &&
    "is_active" in value && typeof value.is_active === "boolean" &&
    "pdf_storage_path" in value &&
    (value.pdf_storage_path === null || typeof value.pdf_storage_path === "string");
}

deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return response(405, "method_not_allowed", "Only POST is supported.");
  const token = bearerToken(request);
  if (!token) return response(401, "unauthenticated", "Authentication is required.");

  const url = deno.env.get("SUPABASE_URL");
  const anonKey = deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    return response(500, "unavailable", "The Documentation service is unavailable.");
  }

  const options = { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } };
  const actor = createClient(url, anonKey, {
    ...options,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const privileged = createClient(url, serviceKey, options);

  try {
    const { data: userData, error: userError } = await actor.auth.getUser(token);
    if (userError || !userData.user) return response(401, "unauthenticated", "Authentication is required.");
    const { data: admin, error: adminError } = await actor.rpc("current_user_is_admin");
    if (adminError || admin !== true) return response(403, "access_denied", "Only an active administrator may access Documentation PDFs.");

    let action: unknown;
    let recordId: unknown;
    let file: File | null = null;
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      const form = await request.formData();
      action = form.get("action");
      recordId = form.get("recordId");
      const candidate = form.get("file");
      file = candidate instanceof File ? candidate : null;
    } else {
      const body: unknown = await request.json();
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return response(400, "invalid_request", "Invalid Documentation request.");
      }
      action = "action" in body ? body.action : null;
      recordId = "recordId" in body ? body.recordId : null;
    }
    if (!isPdfAction(action) || !isRecordId(recordId) || (action === "upload") !== (file !== null)) {
      return response(400, "invalid_request", "Invalid Documentation request.");
    }

    const { data: rawRecord, error: recordError } = await actor
      .from("documentation_records")
      .select("id,is_active,pdf_storage_path")
      .eq("id", recordId)
      .maybeSingle();
    if (recordError || !isDocumentationRow(rawRecord)) {
      return response(404, "not_found", "The Documentation record could not be found.");
    }
    const record = rawRecord;
    if ((action === "upload" || action === "remove") && !record.is_active) {
      return response(409, "archived", "Archived Documentation cannot change PDFs.");
    }

    const storage = privileged.storage.from(documentationPdfBucket);
    if (action === "open" || action === "download") {
      if (!record.pdf_storage_path) return response(404, "pdf_not_found", "No PDF is attached.");
      const { data: pdf, error } = await storage.download(record.pdf_storage_path);
      if (error || !pdf) return response(503, "pdf_unavailable", "The PDF could not be loaded.");
      return new Response(pdf, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/pdf",
          "Content-Disposition": `${action === "open" ? "inline" : "attachment"}; filename="alfaev-document-${record.id}.pdf"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (action === "remove") {
      if (!record.pdf_storage_path) return response(409, "pdf_not_found", "No PDF is attached.");
      const { error } = await privileged.rpc("set_documentation_pdf_reference_admin", {
        p_record_id: record.id,
        p_expected_path: record.pdf_storage_path,
        p_new_path: null,
        p_actor_auth_user_id: userData.user.id,
      });
      if (error) return response(409, "pdf_change_failed", "The PDF could not be removed.");
      // DB reference and audit are committed first. Failed cleanup leaves only a private orphan.
      try {
        await storage.remove([record.pdf_storage_path]);
      } catch {
        // A private orphan is safer than returning a false mutation failure.
      }
      return response(200, "pdf_removed", "PDF removed.");
    }

    if (!file || !(await isValidPdf(file))) {
      return response(400, "invalid_pdf", "Select a valid PDF file (up to 10 MiB).");
    }
    const newPath = generatedPdfPath(record.id, crypto.randomUUID());
    const { error: uploadError } = await storage.upload(newPath, file, {
      contentType: "application/pdf", upsert: false, cacheControl: "0",
    });
    if (uploadError) return response(503, "upload_failed", "The PDF could not be uploaded.");

    const { error: attachError } = await privileged.rpc("set_documentation_pdf_reference_admin", {
      p_record_id: record.id,
      p_expected_path: record.pdf_storage_path,
      p_new_path: newPath,
      p_actor_auth_user_id: userData.user.id,
    });
    if (attachError) {
      try {
        await storage.remove([newPath]);
      } catch {
        // The record still references its old PDF; the new orphan stays private.
      }
      return response(409, "pdf_change_failed", "The PDF could not be attached. Please try again.");
    }
    if (record.pdf_storage_path) {
      try {
        await storage.remove([record.pdf_storage_path]);
      } catch {
        // The committed new reference remains valid; cleanup is best-effort.
      }
    }
    return response(200, record.pdf_storage_path ? "pdf_replaced" : "pdf_attached", "PDF saved.");
  } catch {
    return response(500, "unavailable", "The Documentation service is unavailable.");
  }
});
