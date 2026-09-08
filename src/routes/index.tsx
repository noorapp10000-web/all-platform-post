import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarClock, Check, Loader2, Upload, Video } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { listAccounts } from "@/lib/connections.functions";
import { createPost } from "@/lib/posts.functions";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "نشرة — انشر فيديو واحد على كل المنصات بضغطة" },
      {
        name: "description",
        content: "ارفع الفيديو واكتب وصف واحد، واختار المنصات والحسابات، والموقع ينشر على الكل في نفس اللحظة.",
      },
      { property: "og:title", content: "نشرة — انشر فيديو واحد على كل المنصات" },
      {
        property: "og:description",
        content: "يوتيوب شورتس وتيك توك وفيسبوك وانستجرام من مكان واحد.",
      },
    ],
  }),
  component: ComposerPage,
});

type Account = { id: string; platform: string; account_name: string; avatar_url: string | null };

function ComposerPage() {
  const navigate = useNavigate();
  const { session, user, loading } = useAuth();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<{ path: string; size: number } | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [perPlatform, setPerPlatform] = useState(false);
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  const accountsFn = useServerFn(listAccounts);
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => accountsFn() as Promise<Account[]>,
    enabled: !!session,
  });

  const byPlatform = useMemo(() => {
    const map: Record<string, Account[]> = {};
    for (const account of accounts) (map[account.platform] ??= []).push(account);
    return map;
  }, [accounts]);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const upload = async (nextFile: File) => {
    if (!user) return;
    setFile(nextFile);
    setUploaded(null);
    setUploading(true);
    const path = `${user.id}/${crypto.randomUUID()}-${nextFile.name.replace(/[^\w.\-]/g, "_")}`;
    const { error } = await supabase.storage.from("videos").upload(path, nextFile, {
      contentType: nextFile.type || "video/mp4",
      upsert: false,
    });
    setUploading(false);
    if (error) {
      toast.error(`تعذّر رفع الفيديو: ${error.message}`);
      return;
    }
    setUploaded({ path, size: nextFile.size });
    toast.success("تم رفع الفيديو");
  };

  const createFn = useServerFn(createPost);
  const publish = useMutation({
    mutationFn: async () => {
      if (!uploaded) throw new Error("ارفع الفيديو الأول");
      const targets = Object.entries(selected).map(([platform, accountId]) => ({
        platform: platform as PlatformId,
        accountId,
        caption: (perPlatform ? captions[platform] : "") || description,
      }));
      if (!targets.length) throw new Error("اختار منصة واحدة على الأقل");
      return createFn({
        data: {
          videoPath: uploaded.path,
          videoSize: uploaded.size,
          title,
          description,
          scheduledAt: scheduleOn && scheduledAt ? new Date(scheduledAt).toISOString() : null,
          targets,
        },
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["posts"] });
      const status = (result as { status: string }).status;
      toast.success(
        status === "scheduled"
          ? "تمت الجدولة، هينشر في ميعاده"
          : status === "published"
            ? "تم النشر على كل المنصات ✅"
            : "خلصنا — شوف السجل لتفاصيل كل منصة",
      );
      navigate({ to: "/history" });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggle = (platform: PlatformId) => {
    setSelected((current) => {
      const next = { ...current };
      if (next[platform]) {
        delete next[platform];
        return next;
      }
      const first = byPlatform[platform]?.[0];
      if (!first) {
        toast.error("اربط حسابك على المنصة دي الأول");
        return current;
      }
      next[platform] = first.id;
      return next;
    });
  };

  if (loading || !session) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">لحظة…</div>;
  }

  return (
    <AppShell>
      <section className="hero-surface mb-6 rounded-3xl border border-border p-6">
        <h1 className="font-display text-2xl font-extrabold sm:text-3xl">انشر فيديو واحد على كل المنصات</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          ارفع الفيديو، اكتب الوصف، اختار المنصات والحسابات — والباقي علينا.
        </p>
      </section>

      <div className="space-y-5">
        <div className="rounded-2xl border border-border bg-card p-5">
          <Label className="mb-3 block font-display text-base">١. الفيديو</Label>
          <input
            ref={fileInput}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const next = e.target.files?.[0];
              if (next) void upload(next);
            }}
          />
          {previewUrl ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <video src={previewUrl} className="h-48 w-full rounded-xl bg-black object-contain sm:w-40" controls />
              <div className="flex-1 text-sm">
                <p className="font-semibold break-all">{file?.name}</p>
                <p className="text-muted-foreground">
                  {uploading ? "جاري الرفع…" : uploaded ? "تم الرفع ✅" : "لم يُرفع"}
                </p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => fileInput.current?.click()}>
                  تغيير الفيديو
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => fileInput.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              {uploading ? <Loader2 className="size-6 animate-spin" /> : <Upload className="size-6" />}
              <span className="text-sm">اضغط لاختيار الفيديو</span>
            </button>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <Label className="mb-3 block font-display text-base">٢. العنوان والوصف</Label>
          <div className="space-y-3">
            <Input placeholder="العنوان (ليوتيوب وفيسبوك)" value={title} onChange={(e) => setTitle(e.target.value)} />
            <Textarea
              rows={4}
              placeholder="الوصف اللي هينزل على كل المنصات…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="flex items-center justify-between rounded-xl bg-secondary/60 px-3 py-2">
              <span className="text-sm">وصف مختلف لكل منصة</span>
              <Switch checked={perPlatform} onCheckedChange={setPerPlatform} />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <Label className="mb-3 block font-display text-base">٣. المنصات والحسابات</Label>
          <div className="grid gap-3 sm:grid-cols-2">
            {PLATFORMS.map((platform) => {
              const list = byPlatform[platform.id] ?? [];
              const active = !!selected[platform.id];
              return (
                <div
                  key={platform.id}
                  className={`rounded-xl border p-3 transition-colors ${active ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  <button className="flex w-full items-center gap-3 text-right" onClick={() => toggle(platform.id)}>
                    <span
                      className={`grid size-9 shrink-0 place-items-center rounded-lg ${active ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
                    >
                      {active ? <Check className="size-4" /> : <Video className="size-4" />}
                    </span>
                    <span className="flex-1">
                      <span className="block font-semibold">{platform.name}</span>
                      <span className="block text-xs text-muted-foreground">{platform.hint}</span>
                    </span>
                  </button>

                  {list.length === 0 ? (
                    <Link to="/accounts" className="mt-2 block text-xs text-accent underline">
                      اربط حسابك على {platform.name}
                    </Link>
                  ) : (
                    active && (
                      <div className="mt-3 space-y-2">
                        <select
                          className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                          value={selected[platform.id]}
                          onChange={(e) =>
                            setSelected((current) => ({ ...current, [platform.id]: e.target.value }))
                          }
                        >
                          {list.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.account_name}
                            </option>
                          ))}
                        </select>
                        {perPlatform && (
                          <Textarea
                            rows={3}
                            placeholder={`وصف خاص بـ${platform.name} (لو سيبته فاضي هيستخدم الوصف العام)`}
                            value={captions[platform.id] ?? ""}
                            onChange={(e) =>
                              setCaptions((current) => ({ ...current, [platform.id]: e.target.value }))
                            }
                          />
                        )}
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 font-display text-base">
              <CalendarClock className="size-4" /> جدولة لوقت لاحق
            </span>
            <Switch checked={scheduleOn} onCheckedChange={setScheduleOn} />
          </div>
          {scheduleOn && (
            <Input
              type="datetime-local"
              className="mt-3"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          )}
        </div>

        <Button
          size="lg"
          className="w-full glow"
          disabled={!uploaded || uploading || publish.isPending}
          onClick={() => publish.mutate()}
        >
          {publish.isPending ? (
            <>
              <Loader2 className="ml-2 size-4 animate-spin" /> جاري النشر…
            </>
          ) : scheduleOn ? (
            "جدولة النشر"
          ) : (
            "انشر على كل المنصات المختارة"
          )}
        </Button>
      </div>
    </AppShell>
  );
}
