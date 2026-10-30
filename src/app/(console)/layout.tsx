import OverviewProvider from "@/providers/OverviewProvider";
import SessionProvider from "@/providers/SessionProvider";
import AskProvider from "@/providers/AskProvider";
import AppShell from "@/components/shell/AppShell";

// Everything behind sign-in shares the console shell; /login sits outside it.
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <OverviewProvider>
        <AskProvider>
          <AppShell>{children}</AppShell>
        </AskProvider>
      </OverviewProvider>
    </SessionProvider>
  );
}
