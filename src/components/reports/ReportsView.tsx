"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Box, Tab, Tabs } from "@mui/material";
import { PageHeader } from "@/components/common/Bits";
import { IncidentsTab } from "./IncidentsTab";
import { DailyTab } from "./DailyTab";
import { LoginsTab } from "./LoginsTab";
import { BuildLogTab } from "./BuildLogTab";

const TABS = [
  { id: "incidents", label: "Incidents" },
  { id: "daily", label: "Daily" },
  { id: "logins", label: "Logins" },
  { id: "build", label: "Build log" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function ReportsView() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: TabId = TABS.some((t) => t.id === raw) ? (raw as TabId) : "incidents";

  return (
    <>
      <PageHeader title="Reports" subtitle="Incidents, the daily report, who signed in, and what the control centre can see so far." />
      <Tabs value={tab} onChange={(_, v: TabId) => router.replace(`/reports?tab=${v}`, { scroll: false })} variant="scrollable" allowScrollButtonsMobile aria-label="Report" sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}>
        {TABS.map((t) => (
          <Tab key={t.id} value={t.id} label={t.label} id={`tab-${t.id}`} aria-controls={`panel-${t.id}`} />
        ))}
      </Tabs>
      <Box role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "incidents" ? <IncidentsTab /> : tab === "daily" ? <DailyTab /> : tab === "logins" ? <LoginsTab focus={params.get("focus")} /> : <BuildLogTab />}
      </Box>
    </>
  );
}
