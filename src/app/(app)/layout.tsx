import { AuthProvider } from "./AuthProvider";
import AppShell from "./AppShell";
import { ShortcutProvider } from "@/lib/shortcuts/ShortcutProvider";
import ShortcutHelp from "@/components/shortcuts/ShortcutHelp";
import ShortcutToast from "@/components/shortcuts/ShortcutToast";
import { ToastProvider } from "@/components/ui/Toast";

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      {/* Shortcuts wrap the shell so the top bar's help button and every
          screen inside share one key handler and one Escape stack. */}
      <ShortcutProvider>
        <ToastProvider>
          <AppShell>{children}</AppShell>
          <ShortcutHelp />
          <ShortcutToast />
        </ToastProvider>
      </ShortcutProvider>
    </AuthProvider>
  );
}
