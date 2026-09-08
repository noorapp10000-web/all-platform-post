import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PlatformId } from "./platforms";

function currentOrigin() {
  const request = getRequest();
  if (!request) throw new Error("لا يمكن بدء الربط من هنا");
  const url = new URL(request.url);
  const forwarded = url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
  return forwarded ? `https://${forwarded}` : url.origin;
}

export const getPlatformSetup = createServerFn({ method: "GET" }).handler(async () => {
  const { getPlatformCreds, redirectUri } = await import("./oauth.server");
  const origin = currentOrigin();
  const ids: PlatformId[] = ["youtube", "tiktok", "facebook", "instagram"];
  return ids.map((id) => ({
    platform: id,
    ready: getPlatformCreds(id) !== null,
    redirectUri: redirectUri(origin, id),
  }));
});

export const startConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { platform: PlatformId }) => data)
  .handler(async ({ data, context }) => {
    const { getPlatformCreds, buildAuthorizeUrl } = await import("./oauth.server");
    const { signState } = await import("./crypto.server");
    const creds = getPlatformCreds(data.platform);
    if (!creds) throw new Error("هذه المنصة لسه محتاجة بيانات التطبيق من المالك.");
    const origin = currentOrigin();
    const state = signState({ userId: context.userId, platform: data.platform, origin });
    return { authorizationUrl: buildAuthorizeUrl(data.platform, creds, origin, state) };
  });

export const listAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("platform_accounts")
      .select("id, platform, account_name, avatar_url, needs_reconnect")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const disconnectAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("platform_accounts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
