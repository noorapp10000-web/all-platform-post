export type PlatformId = "youtube" | "tiktok" | "facebook" | "instagram";

export const PLATFORMS: {
  id: PlatformId;
  name: string;
  hint: string;
  tone: string;
}[] = [
  { id: "youtube", name: "يوتيوب شورتس", hint: "فيديو رأسي أقل من ٣ دقائق", tone: "yt" },
  { id: "tiktok", name: "تيك توك", hint: "الوصف يظهر تحت الفيديو", tone: "tt" },
  { id: "facebook", name: "فيسبوك", hint: "النشر على صفحة تختارها", tone: "fb" },
  { id: "instagram", name: "انستجرام ريلز", hint: "حساب أعمال مرتبط بصفحة", tone: "ig" },
];

export const platformName = (id: string) => PLATFORMS.find((p) => p.id === id)?.name ?? id;
