import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/hooks/publish-scheduled")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runPost } = await import("@/lib/publish.server");

        const { data: due } = await supabaseAdmin
          .from("posts")
          .select("id")
          .eq("status", "scheduled")
          .lte("scheduled_at", new Date().toISOString())
          .limit(10);

        let processed = 0;
        for (const post of due ?? []) {
          try {
            await runPost(post.id);
            processed++;
          } catch (error) {
            console.error("[cron publish]", post.id, error);
          }
        }
        return Response.json({ processed });
      },
    },
  },
});
