import { createFileRoute } from "@tanstack/react-router";

function closingPage(message: string, ok: boolean) {
  return new Response(
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>الربط</title>
<style>body{font-family:system-ui;background:#0b0b12;color:#fff;display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:24px}</style>
</head><body><div><p>${message}</p><p style="opacity:.6;font-size:14px">تقدر تقفل النافذة دي</p></div>
<script>try{window.opener&&window.opener.postMessage({type:"platformConnect",ok:${ok}},window.location.origin);}catch(e){}setTimeout(function(){window.close()},1200);</script>
</body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export const Route = createFileRoute("/api/public/oauth/$platform")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const platform = params.platform as "youtube" | "tiktok" | "facebook" | "instagram";
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");

        if (providerError) return closingPage(`فشل الربط: ${providerError}`, false);
        if (!code || !state) return closingPage("رابط الربط غير صالح.", false);

        try {
          const { verifyState, encryptJson } = await import("@/lib/crypto.server");
          const parsed = verifyState<{ userId: string; platform: string; origin: string }>(state);
          if (!parsed || parsed.platform !== platform) return closingPage("انتهت صلاحية طلب الربط، حاول تاني.", false);

          const { getPlatformCreds, exchangeAndResolveAccounts } = await import("@/lib/oauth.server");
          const creds = getPlatformCreds(platform);
          if (!creds) return closingPage("إعدادات المنصة ناقصة.", false);

          const accounts = await exchangeAndResolveAccounts(platform, creds, parsed.origin, code);
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          for (const account of accounts) {
            await supabaseAdmin.from("platform_accounts").upsert(
              {
                user_id: parsed.userId,
                platform,
                account_name: account.name,
                account_external_id: account.external_id,
                avatar_url: account.avatar_url ?? null,
                credentials_ciphertext: encryptJson(account.credentials),
                needs_reconnect: false,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "user_id,platform,account_external_id" },
            );
          }
          return closingPage("تم ربط الحساب بنجاح ✅", true);
        } catch (error) {
          const message = error instanceof Error ? error.message : "خطأ غير معروف";
          console.error("[oauth callback]", message);
          return closingPage(`فشل الربط: ${message}`, false);
        }
      },
    },
  },
});
