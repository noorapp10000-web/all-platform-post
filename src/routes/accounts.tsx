import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Link2, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { disconnectAccount, getPlatformSetup, listAccounts, startConnect } from "@/lib/connections.functions";
import { PLATFORMS, type PlatformId } from "@/lib/platforms";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/accounts")({
  head: () => ({
    meta: [
      { title: "حساباتي — نشرة" },
      { name: "description", content: "اربط حساباتك على يوتيوب وتيك توك وفيسبوك وانستجرام مرة واحدة." },
      { property: "og:title", content: "حساباتي — نشرة" },
      { property: "og:description", content: "اربط حساباتك على المنصات وابدأ النشر من مكان واحد." },
    ],
  }),
  component: AccountsPage,
});

type Account = {
  id: string;
  platform: string;
  account_name: string;
  avatar_url: string | null;
  needs_reconnect: boolean;
};

function AccountsPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  const accountsFn = useServerFn(listAccounts);
  const setupFn = useServerFn(getPlatformSetup);
  const startFn = useServerFn(startConnect);
  const removeFn = useServerFn(disconnectAccount);

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => accountsFn() as Promise<Account[]>,
    enabled: !!session,
  });
  const { data: setup = [] } = useQuery({
    queryKey: ["platform-setup"],
    queryFn: () => setupFn() as Promise<{ platform: string; ready: boolean }[]>,
  });

  const connect = useMutation({
    mutationFn: async (platform: PlatformId) => {
      const popup = window.open("", "connect", "width=600,height=760");
      if (!popup) throw new Error("اسمح بالنوافذ المنبثقة وحاول تاني");
      try {
        const { authorizationUrl } = await startFn({ data: { platform } });
        const done = new Promise<void>((resolve, reject) => {
          const onMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin || event.data?.type !== "platformConnect") return;
            cleanup();
            event.data.ok ? resolve() : reject(new Error("لم يتم الربط"));
          };
          const timer = window.setInterval(() => {
            if (popup.closed) {
              cleanup();
              reject(new Error("تم إغلاق النافذة قبل إتمام الربط"));
            }
          }, 600);
          const cleanup = () => {
            window.removeEventListener("message", onMessage);
            window.clearInterval(timer);
          };
          window.addEventListener("message", onMessage);
        });
        popup.location.href = authorizationUrl;
        await done;
      } catch (error) {
        popup.close();
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("تم ربط الحساب ✅");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeFn({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("تم فصل الحساب");
    },
  });

  if (loading || !session) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">لحظة…</div>;
  }

  return (
    <AppShell>
      <h1 className="mb-1 font-display text-2xl font-extrabold">حساباتي</h1>
      <p className="mb-6 text-sm text-muted-foreground">اربط كل منصة مرة واحدة، وبعدها انشر عليها بضغطة.</p>

      <div className="space-y-4">
        {PLATFORMS.map((platform) => {
          const list = accounts.filter((account) => account.platform === platform.id);
          const ready = setup.find((s) => s.platform === platform.id)?.ready ?? false;
          return (
            <div key={platform.id} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-bold">{platform.name}</p>
                  <p className="text-xs text-muted-foreground">{platform.hint}</p>
                </div>
                <Button
                  size="sm"
                  variant={list.length ? "outline" : "default"}
                  disabled={!ready || connect.isPending}
                  onClick={() => connect.mutate(platform.id)}
                >
                  <Link2 className="ml-1 size-4" />
                  {list.length ? "ربط حساب آخر" : "ربط"}
                </Button>
              </div>

              {!ready && (
                <p className="mt-3 rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
                  الربط بهذه المنصة لسه مقفول لحد ما مالك الموقع يضيف بيانات تطبيقه عليها.
                </p>
              )}

              {list.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {list.map((account) => (
                    <li
                      key={account.id}
                      className="flex items-center gap-3 rounded-xl bg-secondary/50 px-3 py-2 text-sm"
                    >
                      {account.avatar_url ? (
                        <img src={account.avatar_url} alt="" className="size-8 rounded-full object-cover" />
                      ) : (
                        <span className="size-8 rounded-full bg-muted" />
                      )}
                      <span className="flex-1 truncate">{account.account_name}</span>
                      {account.needs_reconnect && <span className="text-xs text-destructive">محتاج إعادة ربط</span>}
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="فصل الحساب"
                        onClick={() => remove.mutate(account.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
