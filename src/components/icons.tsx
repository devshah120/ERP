import type { SVGProps } from "react";

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      width="1em"
      height="1em"
      {...props}
    />
  );
}

export function IconDashboard(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="3.5" width="7" height="9" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
      <rect x="3.5" y="15.5" width="7" height="5" rx="1.5" />
    </Icon>
  );
}

export function IconAccount(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8M8 13h8M8 17h4" />
    </Icon>
  );
}

export function IconSales(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 19h16" />
      <path d="M4 15l5-5 4 4 6-7" />
    </Icon>
  );
}

export function IconPurchase(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="20" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="17" cy="20" r="1.3" fill="currentColor" stroke="none" />
      <path d="M3 4h2l2.2 11h9.6L19 8H6" />
    </Icon>
  );
}

export function IconInventory(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3.5 7.5L12 3l8.5 4.5L12 12z" />
      <path d="M3.5 7.5V16l8.5 4.5V12" />
      <path d="M20.5 7.5V16L12 20.5" />
    </Icon>
  );
}

export function IconSettings(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.96 19.35a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.96a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.04 4.65a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15z" />
    </Icon>
  );
}

export function IconBell(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </Icon>
  );
}

export function IconClock(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icon>
  );
}

export function IconClipboard(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="6" y="4" width="12" height="17" rx="1.5" />
      <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <path d="M9 11h6M9 15h6" />
    </Icon>
  );
}

export function IconSearch(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </Icon>
  );
}

export function IconChevronRight(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M9 6l6 6-6 6" />
    </Icon>
  );
}

export function IconChevronDown(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M6 9l6 6 6-6" />
    </Icon>
  );
}

export function IconGrid(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
    </Icon>
  );
}

export function IconHelp(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .8-1 1.7" />
      <circle cx="12" cy="17" r="0.4" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconPlus(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function IconRefresh(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" />
      <path d="M3 21v-5h5" />
    </Icon>
  );
}

export function IconPrint(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M7 8V3h10v5" />
      <path d="M7 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
      <rect x="7" y="14" width="10" height="7" rx="1" />
    </Icon>
  );
}

export function IconEdit(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </Icon>
  );
}

export function IconEye(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M1.8 12S5 5.5 12 5.5 22.2 12 22.2 12 19 18.5 12 18.5 1.8 12 1.8 12z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

export function IconDots(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconTrash(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </Icon>
  );
}

export function IconCopy(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </Icon>
  );
}

export function IconMail(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </Icon>
  );
}

export function IconFilter(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 5h18l-7 8v6l-4 2v-8z" />
    </Icon>
  );
}

export function IconDownload(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 3v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M4 20h16" />
    </Icon>
  );
}

export function IconUpload(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 21V9" />
      <path d="M7 13l5-5 5 5" />
      <path d="M4 4h16" />
    </Icon>
  );
}

export function IconWarning(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M10.3 3.9L1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconKeyboard(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </Icon>
  );
}

export function IconChart(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </Icon>
  );
}

export function IconInfo(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <circle cx="12" cy="7.8" r="0.5" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconMenu(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  );
}

export function IconChevronUp(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M6 15l6-6 6 6" />
    </Icon>
  );
}

export function IconSave(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </Icon>
  );
}

export function IconClose(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M18 6L6 18M6 6l12 12" />
    </Icon>
  );
}

export function IconPercent(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M19 5L5 19" />
      <circle cx="7.5" cy="7.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
    </Icon>
  );
}

export function IconChevronLeft(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M15 6l-6 6 6 6" />
    </Icon>
  );
}

export function IconSidebar(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.5 4.5v15" />
    </Icon>
  );
}

export function IconLogout(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 16l-4-4 4-4" />
      <path d="M6 12h10" />
    </Icon>
  );
}

export function IconUser(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1-3.5 3.8-5 7-5s6 1.5 7 5" />
    </Icon>
  );
}

export function IconUsers(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3 19.5c.8-3.2 3.2-4.7 6-4.7s5.2 1.5 6 4.7" />
      <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8" />
      <path d="M17.5 14.9c1.8.5 3 1.9 3.5 4.6" />
    </Icon>
  );
}

export function IconCheck(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Icon>
  );
}

export function IconCheckCircle(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.3l2.4 2.4 4.6-4.9" />
    </Icon>
  );
}

export function IconAlertCircle(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v4.5" />
      <circle cx="12" cy="15.8" r="0.9" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconArrowRight(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </Icon>
  );
}

export function IconArrowLeft(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M19 12H5" />
      <path d="M11 6l-6 6 6 6" />
    </Icon>
  );
}

export function IconLock(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Icon>
  );
}

export function IconShield(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 3.5l7 2.8v5.4c0 4.3-2.9 7.6-7 8.8-4.1-1.2-7-4.5-7-8.8V6.3z" />
      <path d="M9.2 12.2l2 2 3.8-4" />
    </Icon>
  );
}

export function IconWallet(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" />
      <rect x="4" y="7.5" width="16.5" height="12" rx="2" />
      <path d="M16 13.5h2" />
    </Icon>
  );
}

export function IconBook(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M5 5.5A2 2 0 0 1 7 3.5h12v14H7a2 2 0 0 0-2 2z" />
      <path d="M5 19.5a2 2 0 0 0 2 1h12" />
      <path d="M9 8h6" />
    </Icon>
  );
}

export function IconDatabase(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <ellipse cx="12" cy="6" rx="7" ry="2.5" />
      <path d="M5 6v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6" />
      <path d="M5 12v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6" />
    </Icon>
  );
}

export function IconBox(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 3.5l8 4v9l-8 4-8-4v-9z" />
      <path d="M4 7.5l8 4 8-4" />
      <path d="M12 11.5v9" />
    </Icon>
  );
}

export function IconFile(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" />
      <path d="M14 3.5v5h5" />
      <path d="M9 13h6M9 16.5h4" />
    </Icon>
  );
}

export function IconTruck(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 6.5h11v10H3z" />
      <path d="M14 10h3.5l3 3v3.5H14" />
      <circle cx="7" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </Icon>
  );
}

export function IconLifebuoy(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M6 6l3.5 3.5M14.5 14.5L18 18M18 6l-3.5 3.5M9.5 14.5L6 18" />
    </Icon>
  );
}

export function IconSortAsc(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 6l-4 5h8z" fill="currentColor" stroke="none" />
      <path d="M12 18l-4-5h8z" fill="currentColor" stroke="none" opacity={0.25} />
    </Icon>
  );
}

export function IconSortDesc(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 6l-4 5h8z" fill="currentColor" stroke="none" opacity={0.25} />
      <path d="M12 18l-4-5h8z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconSortNone(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 6l-4 5h8z" fill="currentColor" stroke="none" opacity={0.3} />
      <path d="M12 18l-4-5h8z" fill="currentColor" stroke="none" opacity={0.3} />
    </Icon>
  );
}

export function IconInbox(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 13.5l2.5-8h11l2.5 8v5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z" />
      <path d="M4 13.5h4.5l1.5 2.5h4l1.5-2.5H20" />
    </Icon>
  );
}

export function IconTrendUp(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 16l5.5-5.5 3.5 3.5L20 7" />
      <path d="M14.5 7H20v5.5" />
    </Icon>
  );
}

export function IconBuilding(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4.5 20.5V5a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 15.5 5v15.5" />
      <path d="M15.5 9.5H18a1.5 1.5 0 0 1 1.5 1.5v9.5" />
      <path d="M3 20.5h18M8 7.5h4M8 11h4M8 14.5h4" />
    </Icon>
  );
}

export function IconLayers(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z" />
      <path d="M3.5 12.5L12 17l8.5-4.5" />
      <path d="M3.5 16.5L12 21l8.5-4.5" />
    </Icon>
  );
}

export function IconMailCheck(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M20 12.5V7a1.5 1.5 0 0 0-1.5-1.5h-13A1.5 1.5 0 0 0 4 7v10a1.5 1.5 0 0 0 1.5 1.5H12" />
      <path d="M4.5 7l7.5 5.5L19.5 7" />
      <path d="M15 17.5l2 2 3.5-3.5" />
    </Icon>
  );
}

export function IconKey(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l8.5-8.5M16.5 6.5l2.5 2.5M14 9l2 2" />
    </Icon>
  );
}

export function IconCalendar(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
      <path d="M8 3.5v4M16 3.5v4M4 10h16" />
    </Icon>
  );
}

export function IconCalculator(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <rect x="8" y="6.5" width="8" height="3" rx="0.5" />
      <path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01" strokeWidth={2.4} />
    </Icon>
  );
}

export function IconHeadset(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2" />
      <rect x="3.5" y="13" width="4" height="6" rx="1.5" />
      <rect x="16.5" y="13" width="4" height="6" rx="1.5" />
      <path d="M18.5 19c0 1.2-1.5 2-3.5 2h-2" />
    </Icon>
  );
}

export function IconHome(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 10.5L12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6h-6v6H5.5A1.5 1.5 0 0 1 4 19z" />
    </Icon>
  );
}

export function IconFactory(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3.5 20.5V10l5 3V10l5 3V6.5l7 3v11z" />
      <path d="M7.5 17h2M12 17h2M16.5 17h2" />
    </Icon>
  );
}

export function IconStore(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 9.5l1.5-5h13l1.5 5" />
      <path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0" />
      <path d="M5.5 11.5v8h13v-8M10 19.5v-4.5h4v4.5" />
    </Icon>
  );
}

export function IconHeart(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 19.5s-7.5-4.4-7.5-9.7A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.2c0 5.3-7.5 9.7-7.5 9.7z" />
    </Icon>
  );
}

export function IconTool(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M14.5 6.5a4 4 0 0 0 5 5l-8.5 8.5a2.1 2.1 0 0 1-3-3z" />
      <path d="M14.5 6.5l3-3 3 3-3 3" />
    </Icon>
  );
}

export function IconGlobe(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5S9.7 5.9 12 3.5z" />
    </Icon>
  );
}

export function IconList(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <circle cx="4.75" cy="6.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.75" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.75" cy="17.5" r="1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconBank(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3.5 9.5L12 4.5l8.5 5" />
      <path d="M5.5 10v7M10 10v7M14 10v7M18.5 10v7M3.5 20h17" />
    </Icon>
  );
}

export function IconPlug(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <path d="M17 14v6M14 17h6" />
    </Icon>
  );
}

export function IconMaximize(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </Icon>
  );
}

export function IconMinimize(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    </Icon>
  );
}

export function IconMinus(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M5 12h14" />
    </Icon>
  );
}

export function IconPause(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </Icon>
  );
}

export function IconEyeOff(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M10.6 5.6A10 10 0 0 1 12 5.5c7 0 10.2 6.5 10.2 6.5a17 17 0 0 1-3 3.9M6.6 6.6C3.5 8.4 1.8 12 1.8 12S5 18.5 12 18.5a9.6 9.6 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
    </Icon>
  );
}
