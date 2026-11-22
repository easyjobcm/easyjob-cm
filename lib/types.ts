import type { Enums } from "@/lib/database.types";

// Plans entreprise (ABO-07) — type
export type { CompanyPlan } from "./types/index";

// Types issus du schéma généré (lib/database.types.ts)
export type UserRole = Enums<"user_role">;
export type Locale = Enums<"locale_type">;
