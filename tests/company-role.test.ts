import { describe, expect, it } from "vitest";
import { isCompanyRole } from "@/lib/utils/profile-status";

// Lot 9 : le tableau de bord entreprise renvoyait company_premium vers « / »,
// alors que les RPC entreprise acceptent ('company', 'company_premium').
describe("isCompanyRole", () => {
  it.each([
    ["company", true],
    ["company_premium", true],
    ["candidate", false],
    ["candidate_premium", false],
    ["admin_ops", false],
    [null, false],
  ])("%s → %s", (role, expected) => {
    expect(isCompanyRole(role)).toBe(expected);
  });
});
