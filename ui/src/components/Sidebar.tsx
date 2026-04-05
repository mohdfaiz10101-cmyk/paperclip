import {
  Inbox,
  CircleDot,
  Target,
  LayoutDashboard,
  DollarSign,
  History,
  Search,
  SquarePen,
  Network,
  Boxes,
  Repeat,
  Settings,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarProjects } from "./SidebarProjects";
import { SidebarAgents } from "./SidebarAgents";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { heartbeatsApi } from "../api/heartbeats";
import { queryKeys } from "../lib/queryKeys";
import { useInboxBadge } from "../hooks/useInboxBadge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { PluginSlotOutlet } from "@/plugins/slots";
import { t } from "@paperclipai/shared";

interface SidebarProps {
  collapsed?: boolean;
}

export function Sidebar({ collapsed = false }: SidebarProps) {
  const { openNewIssue } = useDialog();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const inboxBadge = useInboxBadge(selectedCompanyId);
  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 10_000,
  });
  const liveRunCount = liveRuns?.length ?? 0;

  function openSearch() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  }

  const pluginContext = {
    companyId: selectedCompanyId,
    companyPrefix: selectedCompany?.issuePrefix ?? null,
  };

  // Collapsed: icon-only sidebar (w-12)
  if (collapsed) {
    return (
      <aside className="w-12 h-full min-h-0 border-r border-border bg-background flex flex-col items-center py-2 gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => openNewIssue()}
              className="flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
            >
              <SquarePen className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{t("New Issue")}</TooltipContent>
        </Tooltip>
        <div className="w-8 border-t border-border my-1" />
        <SidebarNavItem to="/dashboard" label="" icon={LayoutDashboard} liveCount={liveRunCount} collapsed />
        <SidebarNavItem
          to="/inbox"
          label=""
          icon={Inbox}
          badge={inboxBadge.inbox}
          badgeTone={inboxBadge.failedRuns > 0 ? "danger" : "default"}
          alert={inboxBadge.failedRuns > 0}
          collapsed
        />
        <div className="w-8 border-t border-border my-1" />
        <SidebarNavItem to="/issues" label="" icon={CircleDot} collapsed />
        <SidebarNavItem to="/routines" label="" icon={Repeat} collapsed />
        <SidebarNavItem to="/goals" label="" icon={Target} collapsed />
        <div className="w-8 border-t border-border my-1" />
        <SidebarProjects collapsed />
        <SidebarAgents collapsed />
        <div className="flex-1" />
        <SidebarNavItem to="/org" label="" icon={Network} collapsed />
        <SidebarNavItem to="/skills" label="" icon={Boxes} collapsed />
        <SidebarNavItem to="/costs" label="" icon={DollarSign} collapsed />
        <SidebarNavItem to="/activity" label="" icon={History} collapsed />
        <SidebarNavItem to="/company/settings" label="" icon={Settings} collapsed />
      </aside>
    );
  }

  // Expanded: full sidebar (w-60)
  return (
    <aside className="w-60 h-full min-h-0 border-r border-border bg-background flex flex-col">
      <div className="flex items-center gap-1 px-3 h-12 shrink-0">
        {selectedCompany?.brandColor && (
          <div
            className="w-4 h-4 rounded-sm shrink-0 ml-1"
            style={{ backgroundColor: selectedCompany.brandColor }}
          />
        )}
        <span className="flex-1 text-sm font-bold text-foreground truncate pl-1">
          {selectedCompany?.name ?? "Select company"}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground shrink-0"
          onClick={openSearch}
        >
          <Search className="h-4 w-4" />
        </Button>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-auto-hide flex flex-col gap-4 px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <button
            onClick={() => openNewIssue()}
            className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
          >
            <SquarePen className="h-4 w-4 shrink-0" />
            <span className="truncate">{t("New Issue")}</span>
          </button>
          <SidebarNavItem to="/dashboard" label={t("Dashboard")} icon={LayoutDashboard} liveCount={liveRunCount} />
          <SidebarNavItem
            to="/inbox"
            label={t("Inbox")}
            icon={Inbox}
            badge={inboxBadge.inbox}
            badgeTone={inboxBadge.failedRuns > 0 ? "danger" : "default"}
            alert={inboxBadge.failedRuns > 0}
          />
          <PluginSlotOutlet
            slotTypes={["sidebar"]}
            context={pluginContext}
            className="flex flex-col gap-0.5"
            itemClassName="text-[13px] font-medium"
            missingBehavior="placeholder"
          />
        </div>

        <SidebarSection label={t("Work")}>
          <SidebarNavItem to="/issues" label={t("Issues")} icon={CircleDot} />
          <SidebarNavItem to="/routines" label={t("Routines")} icon={Repeat} textBadge="Beta" textBadgeTone="amber" />
          <SidebarNavItem to="/goals" label={t("Goals")} icon={Target} />
        </SidebarSection>

        <SidebarProjects />

        <SidebarAgents />

        <SidebarSection label={t("Company")}>
          <SidebarNavItem to="/org" label={t("Org")} icon={Network} />
          <SidebarNavItem to="/skills" label={t("Skills")} icon={Boxes} />
          <SidebarNavItem to="/costs" label={t("Costs")} icon={DollarSign} />
          <SidebarNavItem to="/activity" label={t("Activity")} icon={History} />
          <SidebarNavItem to="/company/settings" label={t("Settings")} icon={Settings} />
        </SidebarSection>

        <PluginSlotOutlet
          slotTypes={["sidebarPanel"]}
          context={pluginContext}
          className="flex flex-col gap-3"
          itemClassName="rounded-lg border border-border p-3"
          missingBehavior="placeholder"
        />
      </nav>
    </aside>
  );
}
