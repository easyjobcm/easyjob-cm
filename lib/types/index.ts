// Plans entreprise (ABO-07, docs/product/DECISIONS.md) : Free et Premium
// remplacent les quatre anciens plans. Le plan effectif est calculé en base
// (company_effective_plan) et lu par my_account_state ; aucun prix, aucune
// durée commerciale ni aucun frais n'est fixé ici.

export type CompanyPlan = "free" | "premium";
