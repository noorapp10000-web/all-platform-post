CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile" ON public.profiles FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE TYPE public.platform AS ENUM ('youtube','tiktok','facebook','instagram');

CREATE TABLE public.platform_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  platform public.platform NOT NULL,
  account_name text NOT NULL,
  account_external_id text NOT NULL,
  avatar_url text,
  credentials_ciphertext text NOT NULL,
  needs_reconnect boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, account_external_id)
);
GRANT ALL ON public.platform_accounts TO service_role;
ALTER TABLE public.platform_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own accounts" ON public.platform_accounts FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "delete own accounts" ON public.platform_accounts FOR DELETE TO authenticated USING (user_id = auth.uid());
GRANT SELECT (id, user_id, platform, account_name, account_external_id, avatar_url, needs_reconnect, created_at, updated_at), DELETE ON public.platform_accounts TO authenticated;

CREATE TABLE public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  video_path text NOT NULL,
  video_size bigint,
  scheduled_at timestamptz,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts TO authenticated;
GRANT ALL ON public.posts TO service_role;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own posts" ON public.posts FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.post_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.posts ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  platform public.platform NOT NULL,
  account_id uuid REFERENCES public.platform_accounts ON DELETE SET NULL,
  caption text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  remote_url text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_targets TO authenticated;
GRANT ALL ON public.post_targets TO service_role;
ALTER TABLE public.post_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own targets" ON public.post_targets FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX post_targets_post_idx ON public.post_targets (post_id);
CREATE INDEX posts_user_idx ON public.posts (user_id, created_at DESC);
CREATE INDEX posts_sched_idx ON public.posts (status, scheduled_at);

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER t_posts BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_targets BEFORE UPDATE ON public.post_targets FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER t_accounts BEFORE UPDATE ON public.platform_accounts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE POLICY "own videos read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'videos' AND owner = auth.uid());
CREATE POLICY "own videos insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'videos' AND owner = auth.uid());
CREATE POLICY "own videos delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'videos' AND owner = auth.uid());