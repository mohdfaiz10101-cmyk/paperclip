import { createContext, useCallback, useContext, useState, useEffect, type ReactNode } from "react";

interface SidebarContextValue {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  setSidebarOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  isMobile: boolean;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

const MOBILE_BREAKPOINT = 768;

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= MOBILE_BREAKPOINT);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      setSidebarOpen(!e.matches);
      if (e.matches) setSidebarCollapsed(false);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // Desktop: open → collapsed → open. Mobile: open → closed → open.
  const toggleSidebar = useCallback(
    () =>
      setSidebarOpen((prev) => {
        if (prev) {
          // Currently open — decide whether to collapse or close
          if (!sidebarCollapsed && !isMobile) {
            // Desktop: collapse first
            setSidebarCollapsed(true);
            return true;
          }
          // Mobile or already collapsed: close
          setSidebarCollapsed(false);
          return false;
        }
        // Currently closed: open
        return true;
      }),
    [sidebarCollapsed, isMobile],
  );

  return (
    <SidebarContext.Provider value={{ sidebarOpen, sidebarCollapsed, setSidebarOpen, setSidebarCollapsed, toggleSidebar, isMobile }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useSidebar must be used within SidebarProvider");
  }
  return ctx;
}
