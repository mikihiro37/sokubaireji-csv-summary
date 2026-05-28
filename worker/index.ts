import type { Env } from "./types.js";
import { jsonOk, jsonError, resolveTenant, verifyAdminToken, extractToken } from "./auth.js";
import { handleSave } from "./handlers/save.js";
import { handleListImports, handleDeleteImport } from "./handlers/listImports.js";
import { handleAggregate, handleGetImportDetail } from "./handlers/aggregate.js";
import { handleAdminAction } from "./handlers/admin.js";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ===== 管理API =====
    if (url.pathname === "/admin/api") {
      return handleAdminRequest(request, env);
    }

    // ===== ユーザーAPI =====
    if (url.pathname === "/api") {
      return handleApiRequest(request, env);
    }

    // ===== 静的アセット =====
    return env.ASSETS.fetch(request);
  },
};

async function handleAdminRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return jsonError("method_not_allowed", "POST のみ受け付けます。", 405);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError("invalid_json", "JSONの解析に失敗しました。");
  }

  const token = extractToken(request, body);
  if (!verifyAdminToken(env, token)) {
    return jsonError("unauthorized", "管理者トークンが一致しません。", 401);
  }

  try {
    const result = await handleAdminAction(env.DB, String(body.action ?? ""), body);
    return jsonOk(result);
  } catch (e) {
    console.error("Admin error:", e);
    return jsonError("internal_error", "サーバーエラーが発生しました。", 500);
  }
}

async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return jsonError("method_not_allowed", "POST のみ受け付けます。", 405);

  // CORS（同一オリジンのみ想定だが念のため）
  const headers = { "Content-Type": "application/json" };

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError("invalid_json", "JSONの解析に失敗しました。");
  }

  const token  = extractToken(request, body);
  const tenant = await resolveTenant(env.DB, token);
  if (!tenant) {
    return jsonError("invalid_token", "トークンが無効です。設定を確認してください。", 401);
  }

  const action = String(body.action ?? "save");

  try {
    let result: unknown;
    switch (action) {
      case "save":
        result = await handleSave(env.DB, tenant.id, body);
        break;
      case "list_imports":
        result = await handleListImports(env.DB, tenant.id, body);
        break;
      case "delete_import":
        result = await handleDeleteImport(env.DB, tenant.id, body);
        break;
      case "get_aggregate":
        result = await handleAggregate(env.DB, tenant.id);
        break;
      case "get_import_detail":
        result = await handleGetImportDetail(env.DB, tenant.id, String(body.import_id ?? ""));
        break;
      case "create_pdf":
        // クライアントサイドPDFに移行したため、import詳細を返す
        result = await handleGetImportDetail(env.DB, tenant.id, String(body.import_id ?? ""));
        break;
      default:
        result = { ok: false, code: "unknown_action", message: "未対応のアクションです。" };
    }
    return new Response(JSON.stringify(result), { headers });
  } catch (e) {
    console.error("API error:", e);
    return jsonError("internal_error", "サーバーエラーが発生しました。", 500);
  }
}
