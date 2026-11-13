import { Outlet, useLocation } from "react-router";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { ThemeToggle } from "./theme";

export function AppLayout() {
  // O Jarvis ocupa toda a largura (centro de comando); as outras áreas ficam numa coluna legível.
  const full = useLocation().pathname.startsWith("/jarvis");
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" aria-label="Abrir ou fechar o menu" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <span className="text-sm text-muted-foreground">Aurora</span>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <main className={cn("mx-auto w-full flex-1", full ? "p-2 md:p-3" : "max-w-6xl p-4 md:p-6")}>
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
