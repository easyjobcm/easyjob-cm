"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Clock,
  CreditCard,
  Bell,
  Shield,
  HelpCircle,
  FileText,
  LogOut,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { LoadingSpinner } from "@/components/ui/loading";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n";

interface ProfileMenuProps {
  isCandidate: boolean;
}

export function ProfileMenu({ isCandidate }: ProfileMenuProps) {
  const router = useRouter();
  const { t } = useI18n();
  const supabase = createClient();
  const [showLogoutModal, setShowLogoutModal] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  const menuItem = (href: string, Icon: React.ElementType, label: string) => (
    <Link
      href={href}
      className="flex items-center justify-between p-4 transition-colors hover:bg-muted/50"
    >
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-muted-foreground" />
        <span className="font-medium text-foreground">{label}</span>
      </div>
      <ChevronRight className="h-5 w-5 text-muted-foreground" />
    </Link>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="space-y-6"
    >
      {/* Settings */}
      <div className="space-y-2">
        <h3 className="px-1 text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
          {t.profile.settings}
        </h3>
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {isCandidate &&
              menuItem("/profile/availability", Clock, t.profile.availability)}
            {menuItem("/profile/payment", CreditCard, t.profile.mobileMoney)}
            {menuItem("/profile/notifications", Bell, t.profile.notifications)}
            {menuItem("/profile/security", Shield, t.profile.security)}
          </CardContent>
        </Card>
      </div>

      {/* Support */}
      <div className="space-y-2">
        <h3 className="px-1 text-[11px] font-semibold uppercase tracking-[1.2px] text-[#7C3AED]">
          {t.profile.support}
        </h3>
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {menuItem("/help", HelpCircle, t.profile.helpCenter)}
            {menuItem("/terms", FileText, t.profile.terms)}
          </CardContent>
        </Card>
      </div>

      {/* Logout */}
      <Button
        variant="destructive"
        className="w-full"
        onClick={() => setShowLogoutModal(true)}
      >
        <LogOut className="mr-2 h-4 w-4" />
        {t.profile.logout}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        EasyJob v1.0.0
      </p>

      <Modal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        title={t.profile.logoutTitle}
      >
        <div className="space-y-4">
          <p className="text-muted-foreground">{t.profile.logoutDesc}</p>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowLogoutModal(false)}
            >
              {t.profile.cancel}
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleLogout}
              disabled={loggingOut}
            >
              {loggingOut ? <LoadingSpinner size="sm" /> : t.profile.logout}
            </Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  );
}
