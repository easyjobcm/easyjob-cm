"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { usePendingTaskCount } from "@/lib/tasks/use-candidate-tasks";
import {
  Home,
  ClipboardList,
  Briefcase,
  User,
  LayoutDashboard,
  Users,
  Building2,
  Plus,
  Settings,
  FileCheck,
} from "lucide-react";

export type UserRole =
  | "candidate"
  | "candidate_premium"
  | "company"
  | "company_premium"
  | "admin"
  | "admin_support"
  | "admin_ops"
  | "admin_founder";

type NormalizedUserRole = "candidate" | "company" | "admin";

interface NavItem {
  href: string;
  label: string;
  labelEn: string;
  icon: React.ComponentType<{ className?: string }>;
}

const candidateNavItems: NavItem[] = [
  { href: "/jobs", label: "Offres", labelEn: "Jobs", icon: Home },
  { href: "/tasks", label: "Tâches", labelEn: "Tasks", icon: ClipboardList },
  { href: "/my-jobs", label: "Mes jobs", labelEn: "My Jobs", icon: Briefcase },
  { href: "/profile", label: "Profil", labelEn: "Profile", icon: User },
];

const companyNavItems: NavItem[] = [
  {
    href: "/company/dashboard",
    label: "Accueil",
    labelEn: "Home",
    icon: LayoutDashboard,
  },
  { href: "/company/jobs/new", label: "Publier", labelEn: "Post", icon: Plus },
  {
    // Les candidats se consultent depuis chaque offre.
    href: "/company/jobs",
    label: "Mes offres",
    labelEn: "My jobs",
    icon: Users,
  },
  {
    href: "/profile/company",
    label: "Profil",
    labelEn: "Profile",
    icon: Settings,
  },
];

const adminNavItems: NavItem[] = [
  {
    href: "/admin/dashboard",
    label: "Dashboard",
    labelEn: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    href: "/admin/momo",
    label: "MoMo",
    labelEn: "MoMo",
    icon: FileCheck,
  },
  {
    href: "/admin/candidates",
    label: "Candidats",
    labelEn: "Candidates",
    icon: Users,
  },
  {
    href: "/admin/companies",
    label: "Entreprises",
    labelEn: "Companies",
    icon: Building2,
  },
  // Modération des offres : section du tableau de bord.
  {
    href: "/admin/dashboard#moderation",
    label: "Offres",
    labelEn: "Jobs",
    icon: Briefcase,
  },
];

interface BottomNavProps {
  userRole?: UserRole;
}

export function BottomNav({ userRole = "candidate" }: BottomNavProps) {
  const pathname = usePathname();
  const { locale, t } = useI18n();

  const normalizedRole: NormalizedUserRole = React.useMemo(() => {
    if (userRole === "company" || userRole === "company_premium")
      return "company";
    if (
      userRole === "admin_support" ||
      userRole === "admin_ops" ||
      userRole === "admin_founder" ||
      userRole === "admin"
    )
      return "admin";
    return "candidate";
  }, [userRole]);

  // Point rouge des Tâches (lot 9d) : au moins une action attend le
  // candidat. Recalculé sur signal Realtime, reconnexion et retour au
  // premier plan ; ouvrir l'onglet ne l'efface pas.
  const pendingTasks = usePendingTaskCount(normalizedRole === "candidate");

  const navItems = React.useMemo(() => {
    switch (normalizedRole) {
      case "company":
        return companyNavItems;
      case "admin":
        return adminNavItems;
      default:
        return candidateNavItems;
    }
  }, [normalizedRole]);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/50 bg-card/80 backdrop-blur-xl safe-area-bottom">
      <div className="mx-auto flex h-16 max-w-lg items-center justify-around px-2">
        {navItems.map((item) => {
          const isProfileTab = item.href === "/profile";
          const isActive =
            pathname === item.href ||
            pathname?.startsWith(`${item.href}/`) ||
            (isProfileTab &&
              (pathname?.startsWith("/help") ||
                pathname?.startsWith("/terms") ||
                pathname?.startsWith("/privacy") ||
                pathname?.startsWith("/upgrade")));
          const Icon = item.icon;
          const showDot = item.href === "/tasks" && pendingTasks > 0;

          // Special styling for the "Post" button in company nav
          const isPostButton = item.href === "/company/jobs/new";

          if (isPostButton) {
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-1 flex-col items-center justify-center"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-primary shadow-glow text-white transition-all active:scale-95">
                  <Icon className="h-6 w-6" />
                </div>
              </Link>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              aria-label={showDot ? t.nav.tasksPending : undefined}
              data-testid={item.href === "/tasks" ? "nav-tasks" : undefined}
              data-pending={
                item.href === "/tasks"
                  ? showDot
                    ? "true"
                    : "false"
                  : undefined
              }
              className={cn(
                "group flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-all",
                isActive ? "text-primary" : "text-muted-foreground",
              )}
            >
              <div
                className={cn(
                  "relative flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-300",
                  isActive
                    ? "bg-primary/10 scale-110"
                    : "group-hover:bg-muted group-active:scale-95",
                )}
              >
                <Icon
                  className={cn(
                    "h-5 w-5 transition-transform",
                    isActive && "scale-110",
                  )}
                />
                {showDot && (
                  <motion.span
                    aria-hidden
                    data-testid="nav-tasks-dot"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-card"
                  />
                )}
              </div>
              <span
                className={cn(
                  "text-[10px] font-medium transition-colors",
                  isActive && "text-primary",
                )}
              >
                {locale === "fr" ? item.label : item.labelEn}
              </span>
              {isActive && (
                <div className="absolute bottom-1 h-1 w-1 rounded-full bg-primary animate-in zoom-in-50" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
