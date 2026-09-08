import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PlatformId } from "./platforms";

type TargetInput = { platform: PlatformId; accountId: string; caption: string };
type CreateInput = {
  videoPath: string;
  videoSize: number;
  title: string;
  description: string;
  scheduledAt: string | null;
  targets: TargetInput[];
};

export const createPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: CreateInput) => {
    if (!data.videoPath) throw new Error("لازم ترفع الفيديو الأول");
    if (!data.targets?.length) throw new Error("اختار منصة واحدة على الأقل");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { data: post, error } = await context.supabase
      .from("posts")
      .insert({
        user_id: context.userId,
        title: data.title,
        description: data.description,
        video_path: data.videoPath,
        video_size: data.videoSize,
        scheduled_at: data.scheduledAt,
        status: data.scheduledAt ? "scheduled" : "queued",
      })
      .select("id")
      .single();
    if (error || !post) throw new Error(error?.message ?? "تعذّر حفظ المنشور");

    const { error: targetError } = await context.supabase.from("post_targets").insert(
      data.targets.map((t) => ({
        post_id: post.id,
        user_id: context.userId,
        platform: t.platform,
        account_id: t.accountId,
        caption: t.caption,
      })),
    );
    if (targetError) throw new Error(targetError.message);

    if (!data.scheduledAt) {
      const { runPost } = await import("./publish.server");
      const status = await runPost(post.id);
      return { postId: post.id, status };
    }
    return { postId: post.id, status: "scheduled" };
  });

export const retryPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { postId: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: post } = await context.supabase
      .from("posts")
      .select("id")
      .eq("id", data.postId)
      .maybeSingle();
    if (!post) throw new Error("المنشور غير موجود");
    const { runPost } = await import("./publish.server");
    return { status: await runPost(post.id) };
  });

export const listPosts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("posts")
      .select(
        "id, title, description, status, scheduled_at, created_at, post_targets(id, platform, status, error_message, remote_url, caption)",
      )
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
