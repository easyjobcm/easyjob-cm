"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Header } from "@/components/layout/header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { LoadingSpinner } from "@/components/ui/loading";
import { useI18n } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { ProfileCompletionWidget } from "@/components/profile/profile-completion-widget";
import { type Criterion } from "@/lib/utils/profile-completion";
import {
  MapPin,
  Star,
  Clock,
  ChevronRight,
  Edit2,
  CreditCard,
  Bell,
  Shield,
  LogOut,
  HelpCircle,
  FileText,
} from "lucide-react";

interface ProfileClientProps {
  user: {
    role: string;
    phone?: string | null;
    email?: string | null;
  };
  profile: {
    first_name?: string;
    last_name?: string;
    company_name?: string;
    reliability_score?: number;
    completed_missions?: number;
    city?: string;
    quartier?: string;
  } | null;
  skills: Array<{
    id: string;
    skill_name: string;
  }>;
  completionPct: number;
  sandboxLevel: number;
  criteria: Criterion[];
}

export function ProfileClient({
  user,
  profile,
  skills,
  completionPct,
  sandboxLevel,
  criteria,
}: ProfileClientProps) {
  const router = useRouter();
  const { locale } = useI18n();
  const supabase = createClient();
  const [showLogoutModal, setShowLogoutModal] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);
  const reliabilityScore = profile?.reliability_score ?? 0;
  const completedMissions = profile?.completed_missions ?? 0;

  const handleLogout = async () => {
    setLoggingOut(true);
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  const isCandidate = user.role === "candidate";

  return (
    <AppShell hideNav>
      <Header title={locale === "fr" ? "Mon Profil" : "My Profile"} showBack />

      <div className="px-4 py-6 space-y-6">
        {/* Profile Header */}
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-2xl bg-linear-to-br from-primary to-primary/60 flex items-center justify-center text-white text-2xl font-bold shadow-lg">
            {profile?.first_name?.[0] ||
              profile?.company_name?.[0] ||
              user.phone?.[0] ||
              "U"}
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">
              {isCandidate
                ? `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim() ||
                  user.phone
                : profile?.company_name || user.phone}
            </h1>
            <p className="text-sm text-muted-foreground">
              {user.phone || user.email}
            </p>
            {isCandidate && reliabilityScore > 0 && (
              <div className="flex items-center gap-1 mt-1">
                <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                <span className="text-sm font-medium">
                  {reliabilityScore.toFixed(1)}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({completedMissions}{" "}
                  {locale === "fr" ? "missions" : "missions"})
                </span>
              </div>
            )}
          </div>
          <Link href="/profile/edit">
            <Button variant="outline" size="icon">
              <Edit2 className="w-4 h-4" />
            </Button>
          </Link>
        </div>

        {/* Profile Completion Widget */}
        <ProfileCompletionWidget
          role={user.role}
          completionPct={completionPct}
          criteria={criteria}
          sandboxLevel={sandboxLevel}
        />

        {/* Quick Stats for Candidates */}
        {isCandidate && (
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold text-primary">
                  {profile?.completed_missions || 0}
                </p>
                <p className="text-xs text-muted-foreground">
                  {locale === "fr" ? "Missions" : "Missions"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold text-success">
                  {profile?.reliability_score?.toFixed(1) || "0.0"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {locale === "fr" ? "Score" : "Score"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-2xl font-bold text-foreground">
                  {skills.length}
                </p>
                <p className="text-xs text-muted-foreground">
                  {locale === "fr" ? "Competences" : "Skills"}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Skills */}
        {isCandidate && skills.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <h3 className="font-medium text-foreground mb-3">
                {locale === "fr" ? "Mes competences" : "My skills"}
              </h3>
              <div className="flex flex-wrap gap-2">
                {skills.map((skill) => (
                  <Badge key={skill.id} variant="secondary">
                    {skill.skill_name}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Location */}
        {(profile?.city || profile?.quartier) && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <MapPin className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="font-medium text-foreground">
                    {profile.quartier && `${profile.quartier}, `}
                    {profile.city}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {locale === "fr" ? "Localisation" : "Location"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Menu Items */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
            {locale === "fr" ? "Parametres" : "Settings"}
          </h3>

          <Card>
            <CardContent className="p-0 divide-y divide-border">
              {isCandidate && (
                <Link
                  href="/profile/availability"
                  className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Clock className="w-5 h-5 text-muted-foreground" />
                    <span className="font-medium text-foreground">
                      {locale === "fr" ? "Disponibilites" : "Availability"}
                    </span>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </Link>
              )}

              <Link
                href="/profile/payment"
                className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <CreditCard className="w-5 h-5 text-muted-foreground" />
                  <span className="font-medium text-foreground">
                    {locale === "fr" ? "Mobile Money" : "Mobile Money"}
                  </span>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </Link>

              <Link
                href="/profile/notifications"
                className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Bell className="w-5 h-5 text-muted-foreground" />
                  <span className="font-medium text-foreground">
                    {locale === "fr" ? "Notifications" : "Notifications"}
                  </span>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </Link>

              <Link
                href="/profile/security"
                className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Shield className="w-5 h-5 text-muted-foreground" />
                  <span className="font-medium text-foreground">
                    {locale === "fr" ? "Securite" : "Security"}
                  </span>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* Support */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
            {locale === "fr" ? "Support" : "Support"}
          </h3>

          <Card>
            <CardContent className="p-0 divide-y divide-border">
              <Link
                href="/help"
                className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <HelpCircle className="w-5 h-5 text-muted-foreground" />
                  <span className="font-medium text-foreground">
                    {locale === "fr" ? "Centre d'aide" : "Help Center"}
                  </span>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </Link>

              <Link
                href="/terms"
                className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-muted-foreground" />
                  <span className="font-medium text-foreground">
                    {locale === "fr"
                      ? "Conditions d'utilisation"
                      : "Terms of Service"}
                  </span>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </Link>
            </CardContent>
          </Card>
        </div>

        {/* Logout */}
        <Button
          variant="destructive"
          className="w-full"
          onClick={() => setShowLogoutModal(true)}
        >
          <LogOut className="w-4 h-4 mr-2" />
          {locale === "fr" ? "Se deconnecter" : "Log out"}
        </Button>

        {/* Version */}
        <p className="text-center text-xs text-muted-foreground">
          EasyJob v1.0.0
        </p>
      </div>

      {/* Logout Modal */}
      <Modal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        title={locale === "fr" ? "Se deconnecter ?" : "Log out?"}
      >
        <div className="space-y-4">
          <p className="text-muted-foreground">
            {locale === "fr"
              ? "Etes-vous sur de vouloir vous deconnecter ?"
              : "Are you sure you want to log out?"}
          </p>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowLogoutModal(false)}
            >
              {locale === "fr" ? "Annuler" : "Cancel"}
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleLogout}
              disabled={loggingOut}
            >
              {loggingOut ? (
                <LoadingSpinner size="sm" />
              ) : locale === "fr" ? (
                "Se deconnecter"
              ) : (
                "Log out"
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}
