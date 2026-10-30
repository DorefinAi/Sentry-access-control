import type { Metadata } from "next";
import { PageHeader } from "@/components/common/Bits";
import { NotificationFeed } from "@/components/shell/NotificationFeed";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <>
      <PageHeader title="Notifications" subtitle="Alerts, incidents, code changes, backups and unusual sign-ins, newest first." />
      <NotificationFeed />
    </>
  );
}
