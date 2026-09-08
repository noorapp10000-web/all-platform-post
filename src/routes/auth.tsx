import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Rocket } from "lucide-react";
import { lovable } from "@/integrations/lovable/index";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "الدخول — نشرة" },
      { name: "description", content: "ادخل بضغطة واحدة وابدأ تنشر فيديوهاتك على كل المنصات." },
      { property: "og:title", content: "الدخول — نشرة" },
      { property: "og:description", content: "ادخل بضغطة واحدة وابدأ تنشر فيديوهاتك على كل المنصات." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) navigate({ to: "/" });
  }, [session, navigate]);

  const withGoogle = async () => {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setBusy(false);
      toast.error("تعذّر الدخول بجوجل");
      return;
    }
    if (result.redirected) return;
    navigate({ to: "/" });
  };

  const withEmail = async (mode: "in" | "up") => {
    if (!email || password.length < 6) {
      toast.error("اكتب بريد وكلمة سر ٦ حروف على الأقل");
      return;
    }
    setBusy(true);
    const { error } =
      mode === "in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate({ to: "/" });
  };

  if (loading) return <div className="grid min-h-screen place-items-center text-muted-foreground">لحظة…</div>;

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground glow">
            <Rocket className="size-7" />
          </span>
          <h1 className="font-display text-2xl font-extrabold">نشرة</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            فيديو واحد ووصف واحد… ينزل على يوتيوب وتيك توك وفيسبوك وانستجرام في نفس الوقت.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <Button className="w-full" onClick={withGoogle} disabled={busy}>
            الدخول بحساب جوجل
          </Button>
          <div className="my-4 text-center text-xs text-muted-foreground">أو بالبريد</div>
          <div className="space-y-3">
            <div>
              <Label htmlFor="email">البريد</Label>
              <Input id="email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="password">كلمة السر</Label>
              <Input
                id="password"
                type="password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => withEmail("up")} disabled={busy}>
                حساب جديد
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => withEmail("in")} disabled={busy}>
                دخول
              </Button>
            </div>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          الدخول مطلوب مرة واحدة بس، عشان حساباتك المربوطة تفضل محفوظة ومحميّة ليك أنت لوحدك.
        </p>
      </div>
    </div>
  );
}
