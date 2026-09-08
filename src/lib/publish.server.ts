import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptJson, encryptJson } from "./crypto.server";
import {
  GRAPH,
  ensureFreshCredentials,
  type StoredCredentials,
} from "./oauth.server";
import type { PlatformId } from "./platforms";

async function signedVideoUrl(path: string) {
  const { data, error } = await supabaseAdmin.storage.from("videos").createSignedUrl(path, 60 * 120);
  if (error || !data?.signedUrl) throw new Error(`تعذّر تجهيز رابط الفيديو: ${error?.message ?? "unknown"}`);
  return data.signedUrl;
}

async function fetchVideo(url: string) {
  const head = await fetch(url, { method: "HEAD" });
  const size = Number(head.headers.get("content-length") ?? 0);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`تعذّر قراءة الفيديو (${res.status})`);
  return { body: res.body, size, contentType: res.headers.get("content-type") ?? "video/mp4" };
}

async function readError(res: Response, label: string) {
  const body = await res.text();
  throw new Error(`${label} [${res.status}]: ${body.slice(0, 400)}`);
}

async function publishYoutube(cred: StoredCredentials, videoUrl: string, title: string, caption: string) {
  const init = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${cred.access_token}`,
        "content-type": "application/json",
        "X-Upload-Content-Type": "video/*",
      },
      body: JSON.stringify({
        snippet: { title: title || caption.slice(0, 90) || "فيديو جديد", description: caption },
        status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
      }),
    },
  );
  if (!init.ok) await readError(init, "YouTube init");
  const uploadUrl = init.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube: لم يصل رابط الرفع");

  const video = await fetchVideo(videoUrl);
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": video.contentType, "content-length": String(video.size) },
    body: video.body,
    // @ts-expect-error runtime streaming body
    duplex: "half",
  });
  if (!put.ok) await readError(put, "YouTube upload");
  const data = (await put.json()) as { id?: string };
  return { url: data.id ? `https://youtube.com/shorts/${data.id}` : null };
}

async function publishTiktok(cred: StoredCredentials, videoUrl: string, caption: string) {
  const video = await fetchVideo(videoUrl);
  const init = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: { authorization: `Bearer ${cred.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({
      post_info: { title: caption.slice(0, 2200), privacy_level: "PUBLIC_TO_EVERYONE" },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: video.size,
        chunk_size: video.size,
        total_chunk_count: 1,
      },
    }),
  });
  if (!init.ok) await readError(init, "TikTok init");
  const data = (await init.json()) as {
    data?: { upload_url?: string; publish_id?: string };
    error?: { code?: string; message?: string };
  };
  if (data.error && data.error.code && data.error.code !== "ok") {
    throw new Error(`TikTok: ${data.error.message ?? data.error.code}`);
  }
  const uploadUrl = data.data?.upload_url;
  if (!uploadUrl) throw new Error("TikTok: لم يصل رابط الرفع");
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": video.contentType,
      "content-length": String(video.size),
      "content-range": `bytes 0-${video.size - 1}/${video.size}`,
    },
    body: video.body,
    // @ts-expect-error runtime streaming body
    duplex: "half",
  });
  if (!put.ok) await readError(put, "TikTok upload");
  return { url: null as string | null };
}

async function publishFacebook(cred: StoredCredentials, videoUrl: string, title: string, caption: string) {
  const pageId = (cred.extra?.["page_id"] as string) ?? "me";
  const res = await fetch(`https://graph-video.facebook.com/v21.0/${pageId}/videos`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      file_url: videoUrl,
      description: caption,
      title: title || "",
      access_token: cred.access_token,
    }),
  });
  if (!res.ok) await readError(res, "Facebook publish");
  const data = (await res.json()) as { id?: string };
  return { url: data.id ? `https://facebook.com/${data.id}` : null };
}

async function publishInstagram(cred: StoredCredentials, videoUrl: string, caption: string) {
  const ig = cred.extra?.["ig_user_id"] as string;
  if (!ig) throw new Error("Instagram: الحساب غير مكتمل، أعد الربط");
  const create = await fetch(`${GRAPH}/${ig}/media`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      media_type: "REELS",
      video_url: videoUrl,
      caption,
      access_token: cred.access_token,
    }),
  });
  if (!create.ok) await readError(create, "Instagram container");
  const { id: containerId } = (await create.json()) as { id: string };

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await fetch(`${GRAPH}/${containerId}?fields=status_code,status&access_token=${cred.access_token}`);
    const s = (await st.json()) as { status_code?: string; status?: string };
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR") throw new Error(`Instagram: فشل تجهيز الفيديو ${s.status ?? ""}`);
    if (i === 39) throw new Error("Instagram: استغرق تجهيز الفيديو وقتًا طويلًا");
  }

  const pub = await fetch(`${GRAPH}/${ig}/media_publish`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: containerId, access_token: cred.access_token }),
  });
  if (!pub.ok) await readError(pub, "Instagram publish");
  const data = (await pub.json()) as { id?: string };
  return { url: data.id ? `https://www.instagram.com/reel/${data.id}` : null };
}

/** Publishes one post to every pending target. Marks each target's result. */
export async function runPost(postId: string) {
  const { data: post } = await supabaseAdmin.from("posts").select("*").eq("id", postId).maybeSingle();
  if (!post) throw new Error("Post not found");

  await supabaseAdmin.from("posts").update({ status: "publishing" }).eq("id", postId);
  const { data: targets } = await supabaseAdmin
    .from("post_targets")
    .select("*")
    .eq("post_id", postId)
    .in("status", ["pending", "failed"]);

  const videoUrl = await signedVideoUrl(post.video_path);

  for (const target of targets ?? []) {
    try {
      if (!target.account_id) throw new Error("لم يتم اختيار حساب لهذه المنصة");
      const { data: account } = await supabaseAdmin
        .from("platform_accounts")
        .select("*")
        .eq("id", target.account_id)
        .maybeSingle();
      if (!account) throw new Error("الحساب غير مربوط");

      let cred = decryptJson<StoredCredentials>(account.credentials_ciphertext);
      const fresh = await ensureFreshCredentials(target.platform as PlatformId, cred);
      cred = fresh.cred;
      if (fresh.changed) {
        await supabaseAdmin
          .from("platform_accounts")
          .update({ credentials_ciphertext: encryptJson(cred) })
          .eq("id", account.id);
      }

      const caption = target.caption?.trim() || post.description;
      let result: { url: string | null };
      switch (target.platform as PlatformId) {
        case "youtube":
          result = await publishYoutube(cred, videoUrl, post.title, caption);
          break;
        case "tiktok":
          result = await publishTiktok(cred, videoUrl, caption);
          break;
        case "facebook":
          result = await publishFacebook(cred, videoUrl, post.title, caption);
          break;
        case "instagram":
          result = await publishInstagram(cred, videoUrl, caption);
          break;
      }

      await supabaseAdmin
        .from("post_targets")
        .update({
          status: "published",
          remote_url: result.url,
          error_message: null,
          published_at: new Date().toISOString(),
        })
        .eq("id", target.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[publish] ${target.platform} failed:`, message);
      await supabaseAdmin
        .from("post_targets")
        .update({ status: "failed", error_message: message.slice(0, 500) })
        .eq("id", target.id);
    }
  }

  const { data: finalTargets } = await supabaseAdmin
    .from("post_targets")
    .select("status")
    .eq("post_id", postId);
  const statuses = (finalTargets ?? []).map((t) => t.status);
  const status = statuses.every((s) => s === "published")
    ? "published"
    : statuses.some((s) => s === "published")
      ? "partial"
      : "failed";
  await supabaseAdmin.from("posts").update({ status }).eq("id", postId);
  return status;
}
