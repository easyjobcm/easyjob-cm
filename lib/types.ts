import type { Enums } from "@/lib/database.types";

// Plans entreprise (SRS v1.2) — constantes et types
export { COMPANY_PLAN_FEES, type CompanyPlan } from "./types/index";

// Types issus du schéma généré (lib/database.types.ts)
export type UserRole = Enums<"user_role">;
export type Locale = Enums<"locale_type">;
