/** Menu lateral com as áreas do produto. Áreas das próximas fases aparecem marcadas como "em breve". */
import { useQuery } from "@tanstack/react-query";
import {
  Blocks,
  BrainCircuit,
  Briefcase,
  CalendarClock,
  LayoutDashboard,
  MessagesSquare,
  Network,
  PackageCheck,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { NavLink, useLocation } from "react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { deliverablesApi, jobsApi, recoveryApi } from "@/lib/api";

interface Area {
  to: string;
  label: string;
  icon: LucideIcon;
  soon?: boolean;
  badge?: "approvals" | "recovery" | "deliverables";
}

const GROUPS: { label: string; areas: Area[] }[] = [
  {
    label: "Operação",
    areas: [
      { to: "/", label: "Command Center", icon: LayoutDashboard },
      { to: "/conversa", label: "Conversa", icon: MessagesSquare },
      { to: "/trabalhos", label: "Trabalhos", icon: Briefcase, badge: "approvals" },
      { to: "/entregas", label: "Entregas", icon: PackageCheck, badge: "deliverables" },
      { to: "/rotinas", label: "Rotinas", icon: CalendarClock },
    ],
  },
  {
    label: "Empresa",
    areas: [
      { to: "/cerebro", label: "Cérebro", icon: BrainCircuit },
      { to: "/agentes", label: "Agentes", icon: Users },
      { to: "/organograma", label: "Organograma", icon: Network },
      { to: "/integracoes", label: "Integrações", icon: Blocks, soon: true },
    ],
  },
  {
    label: "Administração",
    areas: [
      { to: "/governanca", label: "Governança", icon: ShieldCheck, badge: "recovery" },
      { to: "/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
];

function useBadges() {
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: jobsApi.list, refetchInterval: 4000 });
  const recovery = useQuery({ queryKey: ["recovery"], queryFn: recoveryApi.cases, refetchInterval: 8000 });
  const deliverables = useQuery({ queryKey: ["deliverables"], queryFn: deliverablesApi.list, refetchInterval: 8000 });
  return {
    deliverables: deliverables.data?.deliverables.filter((d) => d.status === "in_review").length ?? 0,
    approvals: jobs.data?.jobs.filter((j) => j.status === "awaiting_approval").length ?? 0,
    recovery: recovery.data?.cases.length ?? 0,
  };
}

export function AppSidebar() {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  const badges = useBadges();
  const isActive = (to: string) => (to === "/" ? pathname === "/" : pathname.startsWith(to));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <NavLink to="/" onClick={() => setOpenMobile(false)}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Sparkles className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="font-semibold">Aurora</span>
                  <span className="text-xs text-muted-foreground">Sua empresa com IA</span>
                </div>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.areas.map((area) => {
                  const count = area.badge ? badges[area.badge] : 0;
                  return (
                    <SidebarMenuItem key={area.to}>
                      <SidebarMenuButton asChild isActive={isActive(area.to)} tooltip={area.label}>
                        <NavLink to={area.to} onClick={() => setOpenMobile(false)}>
                          <area.icon />
                          <span>{area.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                      {area.soon && <SidebarMenuBadge className="text-[10px] text-muted-foreground">em breve</SidebarMenuBadge>}
                      {count > 0 && (
                        <SidebarMenuBadge className={area.badge === "recovery" ? "text-destructive" : "text-warning"} aria-label={`${count} pendentes`}>
                          {count}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="px-4 pb-3 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">Operador local</SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
