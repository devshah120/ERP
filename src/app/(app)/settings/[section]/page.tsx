import { notFound } from "next/navigation";
import { SETTINGS_SECTIONS } from "@/lib/settings/definitions";
import SettingsFormView from "@/components/settings/SettingsFormView";

/** Item, Sales, Purchase, POS and Notification settings share one screen. */
export default async function SettingsSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!SETTINGS_SECTIONS[section]) notFound();
  // Only the key crosses to the client: the section holds a zod schema,
  // which is not serialisable.
  return <SettingsFormView sectionKey={section} />;
}
