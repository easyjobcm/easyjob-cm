// Helper de lecture/évaluation du plan entreprise (SRS v1.2).
// IMPORTANT : la source de vérité est company_profiles.subscription_plan,
// JAMAIS user.role.

import type { SupabaseClient } from "@supabase/supabase-js";
import { COMPANY_PLAN_FEES, type CompanyPlan } from "@/lib/types";

export type { CompanyPlan };

export interface CompanyPlanPermissions {
  serviceFeePct: number;
  urgentFee: number;
  selectionDeadlineHours: number;
  lateCancellationHours: number;
  canDirectEdit: boolean;
  hasFreeUrgent: boolean;
  hasAiRecommendations: boolean;
  hasFavorites: boolean;
  hasDirectInvite: boolean;
  hasTemplates: boolean;
  hasMonthlyReport: boolean;
  hasPdfExport: boolean;
  hasGuaranteedReplacement: boolean;
  hasBulkHiring: boolean;
  hasPriorityInvite: boolean;
  hasAvailabilityAlerts: boolean;
  hasPresenceDashboard: boolean;
  hasSectorContracts: boolean;
  hasAdvancedReporting: boolean;
  hasDedicatedManager: boolean;
  hasPrioritySLA: boolean;
  hasImmediateModeration: boolean;
  trialDays: number;
}

export function getCompanyPlanPermissions(
  plan: CompanyPlan,
): CompanyPlanPermissions {
  const proOrBetter = plan === "pro" || plan === "business";
  const businessOnly = plan === "business";
  return {
    serviceFeePct: COMPANY_PLAN_FEES[plan].serviceFeePct,
    urgentFee: COMPANY_PLAN_FEES[plan].urgentFee,
    selectionDeadlineHours: COMPANY_PLAN_FEES[plan].selectionDeadlineHours,
    lateCancellationHours: COMPANY_PLAN_FEES[plan].lateCancellationHours,
    canDirectEdit: proOrBetter,
    hasFreeUrgent: proOrBetter,
    hasAiRecommendations: proOrBetter,
    hasFavorites: proOrBetter,
    hasDirectInvite: proOrBetter,
    hasTemplates: proOrBetter,
    hasMonthlyReport: proOrBetter,
    hasPdfExport: proOrBetter,
    hasGuaranteedReplacement: businessOnly,
    hasBulkHiring: businessOnly,
    hasPriorityInvite: businessOnly,
    hasAvailabilityAlerts: businessOnly,
    hasPresenceDashboard: businessOnly,
    hasSectorContracts: businessOnly,
    hasAdvancedReporting: businessOnly,
    hasDedicatedManager: businessOnly,
    hasPrioritySLA: businessOnly,
    hasImmediateModeration: businessOnly,
    trialDays: COMPANY_PLAN_FEES[plan].trialDays,
  };
}

export function isPlanAtLeast(
  plan: CompanyPlan,
  minimum: CompanyPlan,
): boolean {
  const order: CompanyPlan[] = ["free", "starter", "pro", "business"];
  return order.indexOf(plan) >= order.indexOf(minimum);
}

export function normalizeCompanyPlan(value?: string | null): CompanyPlan {
  switch ((value ?? "free").toLowerCase()) {
    case "starter":
      return "starter";
    case "pro":
      return "pro";
    case "business":
      return "business";
    default:
      return "free";
  }
}

/**
 * Lit le plan effectif d'une entreprise depuis company_profiles.subscription_plan.
 * À utiliser systématiquement côté serveur — jamais se baser sur user.role.
 */
export async function getCompanyPlan(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, "public", any>,
  userId: string,
): Promise<CompanyPlan> {
  const { data } = await supabase
    .from("company_profiles")
    .select("subscription_plan")
    .eq("user_id", userId)
    .single();
  return normalizeCompanyPlan(
    (data as { subscription_plan?: string | null } | null)?.subscription_plan,
  );
}
