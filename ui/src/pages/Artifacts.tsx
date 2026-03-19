import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import { ArtifactsPanel } from "../components/ArtifactsPanel";
import { Loader2 } from "lucide-react";

export function Artifacts() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Artifacts" }]);
  }, [setBreadcrumbs]);

  // Find tasks that might have work products — use the planning task or any active task
  const { data: issues, isLoading } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const taskId = useMemo(() => {
    const planningTask = issues?.find(
      (i) =>
        i.title.toLowerCase().includes("hiring plan") ||
        i.title.toLowerCase().includes("build hiring plan") ||
        i.title.toLowerCase().includes("plan ai agents"),
    );
    return planningTask?.id ?? issues?.[0]?.id ?? null;
  }, [issues]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        Loading...
      </div>
    );
  }

  if (!taskId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-sm">
          <h2 className="text-lg font-semibold">No artifacts yet</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Artifacts will appear here as your agents produce deliverables.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-3rem)] -m-6 -mt-2">
      <ArtifactsPanel taskId={taskId} />
    </div>
  );
}
