import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { template: "%s — Nexora Admin", default: "Nexora Admin Portal" },
};

export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="saRoot">
      {children}
    </div>
  );
}

