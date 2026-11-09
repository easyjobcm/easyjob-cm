"use client";

import * as React from "react";
import useSWR from "swr";
import { motion } from "framer-motion";
import { Award } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ReputationStars } from "@/components/reputation/reputation-stars";
import { useI18n } from "@/lib/i18n";
import { useLiveRefresh } from "@/lib/realtime/provider";
import { formatDate } from "@/lib/utils";
import { formatStarsNumber } from "@/lib/reputation/progress";
import { isReviewReason } from "@/lib/reputation/review-reasons";

type AdminReview = {
  id: string;
  rating: number;
  reasons: string[];
  comment: string | null;
  origin: string;
  created_at: string | null;
  author: { type: string; id: string; name: string | null };
  mission: {
    id: string;
    scheduled_date: string;
    job_title: string | null;
  } | null;
  impact: {
    admissible: boolean;
    nominal: number;
    applied: number;
    balance: number;
  } | null;
  contest: {
    id: string;
    status: string;
    outcome: "upheld" | "rejected" | null;
    note: string;
    resolution: string | null;
  } | null;
};

type AdminReputation = {
  subject_type: "candidate" | "company";
  can_decide: boolean;
  score: {
    stars: number;
    profile_pct: number;
    profile_stars: number;
    experience_units: number;
    experience_stars: number;
    confirmed_count: number;
    breach_count: number;
    review_units: number;
    review_stars: number;
    skill_count: number | null;
    skill_stars: number | null;
  };
  reviews: AdminReview[];
  changes: {
    id: string;
    from_stars: number;
    to_stars: number;
    direction: string;
    cause: string;
    created_at: string;
  }[];
  incidents: {
    id: string;
    kind: string;
    occurred_at: string;
    voided_at: string | null;
  }[];
};

const fetcher = async (url: string): Promise<AdminReputation> => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
};

/**
 * Réputation sur la fiche admin (lot 9c) : avis complets, impact et
 * contestations. Lecture pour les 3 grades ; décision pour admin_ops et
 * admin_founder (contrôlée aussi par la route et la RPC).
 */
export function ReputationAdminPanel({
  subjectType,
  subjectId,
}: {
  subjectType: "candidate" | "company";
  subjectId: string;
}) {
  const { t, locale } = useI18n();
  const ta = t.reputation.admin;
  const url = `/api/admin/reputation/${subjectType}/${subjectId}`;
  const { data, error, mutate } = useSWR(url, fetcher);
  useLiveRefresh(["admin:reputation"], () => mutate());

  if (error) return <p className="text-sm text-destructive">{ta.error}</p>;
  if (!data) return null;

  const s = data.score;
  const n = (v: number) => formatStarsNumber(Number(v), locale);
  const rows: [string, string][] = [
    [
      t.reputation.progress.categories.profile,
      `${n(s.profile_stars)}/1 · ${s.profile_pct} %`,
    ],
    [
      subjectType === "company"
        ? t.reputation.progress.categories.experienceCompany
        : t.reputation.progress.categories.experience,
      `${n(s.experience_stars)}/2 · ${s.experience_units}/20 · ${s.confirmed_count} ✓ · ${s.breach_count} ✗`,
    ],
    [
      t.reputation.progress.categories.reviews,
      `${n(s.review_stars)}/${subjectType === "company" ? 2 : 1} · ${s.review_units}/${subjectType === "company" ? 20 : 10}`,
    ],
  ];
  if (subjectType === "candidate") {
    rows.push([
      t.reputation.progress.categories.skills,
      `${n(s.skill_stars ?? 0)}/1 · ${s.skill_count ?? 0}`,
    ]);
  }

  return (
    <Card data-testid="admin-reputation">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <Award className="h-4 w-4 text-[#7C3AED]" aria-hidden />
            {ta.title}
          </h2>
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ReputationStars stars={s.stars} />
            {n(s.stars)}/5
          </span>
        </div>

        <dl className="space-y-1 text-sm" aria-label={ta.categories}>
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{ta.reviews}</h3>
          {data.reviews.length === 0 && (
            <p className="text-sm text-muted-foreground">{ta.noReviews}</p>
          )}
          {data.reviews.map((r) => (
            <ReviewRow
              key={r.id}
              review={r}
              canDecide={data.can_decide}
              url={url}
              onChanged={() => void mutate()}
            />
          ))}
        </section>

        <section className="space-y-1">
          <h3 className="text-sm font-semibold">{ta.incidents}</h3>
          {data.incidents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{ta.noIncidents}</p>
          ) : (
            data.incidents.map((i) => (
              <p key={i.id} className="text-xs text-muted-foreground">
                {formatDate(i.occurred_at, locale)} · {i.kind}
                {i.voided_at ? " · ✗" : ""}
              </p>
            ))
          )}
        </section>

        {data.changes.length > 0 && (
          <section className="space-y-1">
            <h3 className="text-sm font-semibold">{ta.changes}</h3>
            {data.changes.map((c) => (
              <p key={c.id} className="text-xs text-muted-foreground">
                {formatDate(c.created_at, locale)} · {n(c.from_stars)} →{" "}
                {n(c.to_stars)} · {c.cause}
              </p>
            ))}
          </section>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewRow({
  review,
  canDecide,
  url,
  onChanged,
}: {
  review: AdminReview;
  canDecide: boolean;
  url: string;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const ta = t.reputation.admin;
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  async function post(body: Record<string, string>) {
    setBusy(true);
    setMessage(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, review_id: review.id, note }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setNote("");
      setMessage(ta.saved);
      onChanged();
    } else {
      setMessage(ta.error);
    }
  }

  const contest = review.contest;
  const contestLabel = !contest
    ? ta.contestNone
    : contest.outcome === "upheld"
      ? ta.contestUpheld
      : contest.outcome === "rejected"
        ? ta.contestRejected
        : ta.contestOpen;
  const reasons = review.reasons
    .filter(isReviewReason)
    .map((code) => t.reputation.reasons[code]);

  return (
    <div
      className="space-y-1.5 rounded-xl border border-border p-3 text-sm"
      data-testid="admin-review"
      data-review-id={review.id}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {ta.rating} : {review.rating}/5
        </span>
        <span className="text-xs text-muted-foreground">
          {review.created_at ? formatDate(review.created_at, locale) : ""}
        </span>
      </div>
      <p className="text-xs">
        <span className="text-muted-foreground">{ta.author} : </span>
        {review.author.name ?? review.author.id} ({review.author.type})
      </p>
      {review.mission && (
        <p className="text-xs">
          <span className="text-muted-foreground">{ta.mission} : </span>
          {review.mission.job_title ?? review.mission.id} ·{" "}
          {formatDate(review.mission.scheduled_date, locale)}
        </p>
      )}
      <p className="text-xs">
        <span className="text-muted-foreground">{ta.reasons} : </span>
        {reasons.length > 0 ? reasons.join(", ") : "—"}
      </p>
      <p className="text-xs">
        <span className="text-muted-foreground">{ta.comment} : </span>
        {review.comment ?? ta.noComment}
      </p>
      <p className="text-xs" data-testid="admin-review-impact">
        <span className="text-muted-foreground">{ta.impact} : </span>
        {review.impact?.admissible
          ? ta.impactValue
              .replace("{applied}", String(review.impact.applied))
              .replace("{nominal}", String(review.impact.nominal))
              .replace("{balance}", String(review.impact.balance))
          : `${ta.notCounted} (${ta.notCountedHint})`}
      </p>
      <p className="text-xs" data-testid="admin-review-contest">
        <span className="text-muted-foreground">{ta.contest} : </span>
        {contestLabel}
        {contest?.note ? ` · ${contest.note}` : ""}
        {contest?.resolution ? ` · ${contest.resolution}` : ""}
      </p>

      {review.origin === "mission_flow" && !contest?.outcome && (
        <div className="space-y-2 pt-1">
          {(!contest || canDecide) && (
            <Textarea
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                contest ? ta.decisionPlaceholder : ta.notePlaceholder
              }
              className="min-h-16 text-xs"
            />
          )}
          <div className="flex flex-wrap gap-2">
            {!contest && (
              <motion.div whileTap={{ scale: 0.97 }}>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || note.trim().length < 3}
                  onClick={() => void post({ action: "open" })}
                >
                  {ta.openContest}
                </Button>
              </motion.div>
            )}
            {contest && canDecide && (
              <>
                <motion.div whileTap={{ scale: 0.97 }}>
                  <Button
                    size="sm"
                    disabled={busy || note.trim().length < 3}
                    onClick={() =>
                      void post({ action: "resolve", outcome: "upheld" })
                    }
                  >
                    {ta.uphold}
                  </Button>
                </motion.div>
                <motion.div whileTap={{ scale: 0.97 }}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || note.trim().length < 3}
                    onClick={() =>
                      void post({ action: "resolve", outcome: "rejected" })
                    }
                  >
                    {ta.reject}
                  </Button>
                </motion.div>
              </>
            )}
            {contest && !canDecide && (
              <p className="text-xs text-muted-foreground">{ta.readOnly}</p>
            )}
          </div>
          {message && (
            <p className="text-xs text-muted-foreground" role="status">
              {message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
