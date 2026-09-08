import type { PlatformId } from "./platforms";
import { encryptJson } from "./crypto.server";

export const GRAPH = "https://graph.facebook.com/v21.0";

export type StoredCredentials = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  extra?: Record<string, unknown>;
};

export type PlatformCreds = { id: string; secret: string };

export function getPlatformCreds(platform: PlatformId): PlatformCreds | null {
  const pick = (idKey: string, secretKey: string): PlatformCreds | null => {
    const id = process.env[idKey];
    const secret = process.env[secretKey];
    return id && secret ? { id, secret } : null;
  };
  switch (platform) {
    case "youtube":
      return pick("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET");
    case "tiktok":
      return pick("TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET");
    case "facebook":
    case "instagram":
      return pick("META_APP_ID", "META_APP_SECRET");
  }
}

export function redirectUri(origin: string, platform: PlatformId) {
  return `${origin}/api/public/oauth/${platform}`;
}

export function buildAuthorizeUrl(platform: PlatformId, creds: PlatformCreds, origin: string, state: string) {
  const ru = redirectUri(origin, platform);
  switch (platform) {
    case "youtube": {
      const p = new URLSearchParams({
        client_id: creds.id,
        redirect_uri: ru,
        response_type: "code",
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        scope:
          "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
        state,
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
    }
    case "tiktok": {
      const p = new URLSearchParams({
        client_key: creds.id,
        response_type: "code",
        scope: "user.info.basic,video.publish,video.upload",
        redirect_uri: ru,
        state,
      });
      return `https://www.tiktok.com/v2/auth/authorize/?${p}`;
    }
    case "facebook":
    case "instagram": {
      const scope =
        platform === "facebook"
          ? "pages_show_list,pages_read_engagement,pages_manage_posts,business_management"
          : "pages_show_list,instagram_basic,instagram_content_publish,business_management";
      const p = new URLSearchParams({
        client_id: creds.id,
        redirect_uri: ru,
        response_type: "code",
        scope,
        state,
      });
      return `https://www.facebook.com/v21.0/dialog/oauth?${p}`;
    }
  }
}

async function asJson(res: Response, label: string) {
  const text = await res.text();
  if (!res.ok) throw new Error(`${label} [${res.status}]: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: invalid JSON ${text.slice(0, 200)}`);
  }
}

export type ResolvedAccount = {
  external_id: string;
  name: string;
  avatar_url?: string | null;
  credentials: StoredCredentials;
};

/** Exchanges the OAuth code and resolves the concrete publishing accounts. */
export async function exchangeAndResolveAccounts(
  platform: PlatformId,
  creds: PlatformCreds,
  origin: string,
  code: string,
): Promise<ResolvedAccount[]> {
  const ru = redirectUri(origin, platform);

  if (platform === "youtube") {
    const token = await asJson(
      await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: creds.id,
          client_secret: creds.secret,
          redirect_uri: ru,
          grant_type: "authorization_code",
        }),
      }),
      "Google token",
    );
    const channels = await asJson(
      await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
        headers: { authorization: `Bearer ${token.access_token}` },
      }),
      "YouTube channel",
    );
    const ch = channels.items?.[0];
    return [
      {
        external_id: ch?.id ?? "me",
        name: ch?.snippet?.title ?? "قناة يوتيوب",
        avatar_url: ch?.snippet?.thumbnails?.default?.url ?? null,
        credentials: {
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          expires_at: Date.now() + (token.expires_in ?? 3500) * 1000,
        },
      },
    ];
  }

  if (platform === "tiktok") {
    const token = await asJson(
      await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: creds.id,
          client_secret: creds.secret,
          code,
          grant_type: "authorization_code",
          redirect_uri: ru,
        }),
      }),
      "TikTok token",
    );
    if (token.error) throw new Error(`TikTok token: ${token.error_description ?? token.error}`);
    const info = await asJson(
      await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url", {
        headers: { authorization: `Bearer ${token.access_token}` },
      }),
      "TikTok user",
    );
    const u = info?.data?.user ?? {};
    return [
      {
        external_id: token.open_id ?? u.open_id ?? "me",
        name: u.display_name ?? "حساب تيك توك",
        avatar_url: u.avatar_url ?? null,
        credentials: {
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          expires_at: Date.now() + (token.expires_in ?? 86400) * 1000,
        },
      },
    ];
  }

  // Meta (facebook pages / instagram business accounts)
  const token = await asJson(
    await fetch(
      `${GRAPH}/oauth/access_token?` +
        new URLSearchParams({
          client_id: creds.id,
          client_secret: creds.secret,
          redirect_uri: ru,
          code,
        }),
    ),
    "Meta token",
  );
  const longLived = await asJson(
    await fetch(
      `${GRAPH}/oauth/access_token?` +
        new URLSearchParams({
          grant_type: "fb_exchange_token",
          client_id: creds.id,
          client_secret: creds.secret,
          fb_exchange_token: token.access_token,
        }),
    ),
    "Meta long-lived token",
  );
  const pages = await asJson(
    await fetch(
      `${GRAPH}/me/accounts?fields=id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}&access_token=${longLived.access_token}`,
    ),
    "Meta pages",
  );

  const out: ResolvedAccount[] = [];
  for (const page of pages.data ?? []) {
    if (platform === "facebook") {
      out.push({
        external_id: page.id,
        name: page.name,
        avatar_url: page.picture?.data?.url ?? null,
        credentials: { access_token: page.access_token, extra: { page_id: page.id } },
      });
    } else if (page.instagram_business_account?.id) {
      out.push({
        external_id: page.instagram_business_account.id,
        name: page.instagram_business_account.username ?? page.name,
        avatar_url: page.instagram_business_account.profile_picture_url ?? null,
        credentials: {
          access_token: page.access_token,
          extra: { ig_user_id: page.instagram_business_account.id, page_id: page.id },
        },
      });
    }
  }
  if (out.length === 0) {
    throw new Error(
      platform === "facebook"
        ? "لم يتم العثور على صفحة فيسبوك يمكن النشر عليها بهذا الحساب."
        : "لم يتم العثور على حساب انستجرام أعمال مرتبط بصفحة فيسبوك.",
    );
  }
  return out;
}

/** Refreshes an expired token when the platform supports it. */
export async function ensureFreshCredentials(
  platform: PlatformId,
  cred: StoredCredentials,
): Promise<{ cred: StoredCredentials; changed: boolean }> {
  if (!cred.expires_at || cred.expires_at > Date.now() + 60_000 || !cred.refresh_token) {
    return { cred, changed: false };
  }
  const creds = getPlatformCreds(platform);
  if (!creds) return { cred, changed: false };

  if (platform === "youtube") {
    const t = await asJson(
      await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: creds.id,
          client_secret: creds.secret,
          refresh_token: cred.refresh_token,
          grant_type: "refresh_token",
        }),
      }),
      "Google refresh",
    );
    return {
      cred: { ...cred, access_token: t.access_token, expires_at: Date.now() + (t.expires_in ?? 3500) * 1000 },
      changed: true,
    };
  }
  if (platform === "tiktok") {
    const t = await asJson(
      await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: creds.id,
          client_secret: creds.secret,
          grant_type: "refresh_token",
          refresh_token: cred.refresh_token,
        }),
      }),
      "TikTok refresh",
    );
    return {
      cred: {
        ...cred,
        access_token: t.access_token,
        refresh_token: t.refresh_token ?? cred.refresh_token,
        expires_at: Date.now() + (t.expires_in ?? 86400) * 1000,
      },
      changed: true,
    };
  }
  return { cred, changed: false };
}

export const encryptCredentials = (c: StoredCredentials) => encryptJson(c);
