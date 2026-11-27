import SettingsFormView from "@/components/settings/SettingsFormView";

/** HR Settings → a payroll settings section (see src/lib/settings/definitions.ts). */
export default function Page() {
  return <SettingsFormView sectionKey="hr-pf-settings" />;
}
