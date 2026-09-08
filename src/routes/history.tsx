import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { listPosts, retryPost } from "@/lib/posts.functions";
import { platformName } from "@/lib/platforms";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "سجل النشر — نشرة" },
      { name: "description", content: "تابع كل فيديو نشرته وحالته على كل منصة." },
      { property: "og:title", content: "سجل النشر — نشرة" },
      { property: "og:description", content: "تابع كل فيديو نشرته وحالته على كل منصة." },
    ],
  }),
  component: HistoryPage,
});

type Target = {
  id: string;
  platform: string;
  status: string;
  error_message: string | null;
  remote_url: string | null;
};
type Post = {
  id: string;
  title: string;
  description: string;
  status: string;
  scheduled_at: string | null;
  created_at: string;
  post_targets: Target[];
};

const statusLabel: Record<string, string> = {
  published: "تم النشر",
  failed: "فشل",
  pending: "في الانتظار",
  scheduled: "مجدول",
  partial: "نشر جزئي",
  queued: "جاري",
  publishing: "جاري النشر",
  draft: "مسودة",
};

function HistoryPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  const postsFn = useServerFn(listPosts);
  const retryFn = useServerFn(retryPost);

  const { data: posts = [] } = useQuery({
    queryKey: ["posts"],
    queryFn: () => postsFn() as Promise<Post[]>,
    enabled: !!session,
  });

  const retry = useMutation({
    mutationFn: (postId: string) => retryFn({ data: { postId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["posts"] });
      toast.success("تمت إعادة المحاولة");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (loading || !session) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">لحظة…</div>;
  }

  return (
    <AppShell>
      <h1 className="mb-1 font-display text-2xl font-extrabold">سجل النشر</h1>
      <p className="mb-6 text-sm text-muted-foreground">كل فيديو نشرته، وحالته على كل منصة.</p>

      {posts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          لسه مافيش نشر. ابدأ من صفحة «نشر جديد».
        </p>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <article key={post.id} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-display text-lg font-bold">{post.title || "بدون عنوان"}</h2>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{post.description}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {post.scheduled_at
                      ? `مجدول: ${new Date(post.scheduled_at).toLocaleString("ar-EG")}`
                      : new Date(post.created_at).toLocaleString("ar-EG")}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs">
                  {statusLabel[post.status] ?? post.status}
                </span>
              </div>

              <ul className="mt-3 space-y-2">
                {post.post_targets.map((target) => (
                  <li key={target.id} className="rounded-xl bg-secondary/50 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 font-semibold">{platformName(target.platform)}</span>
                      <span
                        className={
                          target.status === "published"
                            ? "text-success"
                            : target.status === "failed"
                              ? "text-destructive"
                              : "text-muted-foreground"
                        }
                      >
                        {statusLabel[target.status] ?? target.status}
                      </span>
                    </div>
                    {target.remote_url && (
                      <a
                        href={target.remote_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-accent underline"
                      >
                        فتح المنشور
                      </a>
                    )}
                    {target.error_message && (
                      <p className="mt-1 text-xs text-destructive break-words">{target.error_message}</p>
                    )}
                  </li>
                ))}
              </ul>

              {(post.status === "failed" || post.status === "partial") && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  disabled={retry.isPending}
                  onClick={() => retry.mutate(post.id)}
                >
                  إعادة المحاولة
                </Button>
              )}
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
