import { redirect } from "next/navigation";

// Route historique dissoute dans /onboarding/candidate (formulaire unique,
// reellement sauvegarde). Conservee en redirection compatible.
export default function OnboardingRedirectPage() {
  redirect("/onboarding/candidate");
}
