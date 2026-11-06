"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Clock,
  Users,
  Star,
  CheckCircle,
  XCircle,
  Phone,
  FileText,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import type { Database, Tables } from "@/lib/database.types";

type Job = Pick<
  Tables<"jobs">,
  | "id"
  | "title"
  | "city"
  | "quartier"
  | "start_date"
  | "start_time"
  | "end_time"
  | "positions_available"
  | "positions_filled"
>;

/** Réponse de GET /api/jobs/[id]/applications (colonnes autorisées, F-16). */
type Application = Omit<
  Database["public"]["Functions"]["company_job_applicants"]["Returns"][number],
  "has_photo"
> & { photo_url: string | null };

export default function CompanyJobDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { toast } = useToast();
  const { t, locale } = useI18n();
  const ta = t.companyApplicants;
  const jobId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<Job | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [activeTab, setActiveTab] = useState("pending");
  const [selectedApplication, setSelectedApplication] =
    useState<Application | null>(null);
  const [actionType, setActionType] = useState<"select" | "reject" | null>(
    null,
  );
  const [rejectionReason, setRejectionReason] = useState("");
  const [processing, setProcessing] = useState(false);
  // Contrat de chaque candidature sélectionnée (colonnes lisibles, lot 7b).
  const [contracts, setContracts] = useState<
    Map<string, Pick<Tables<"contracts">, "id" | "status">>
  >(new Map());
  // Garde synchrone contre le double clic (l'état React arrive trop tard).
  const processingRef = useRef(false);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function loadData() {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { data: jobData } = await supabase
      .from("jobs")
      .select(
        "id, title, city, quartier, start_date, start_time, end_time, positions_available, positions_filled",
      )
      .eq("id", jobId)
      .single();

    if (jobData) setJob(jobData);

    const res = await fetch(`/api/jobs/${jobId}/applications`).catch(
      () => null,
    );
    if (res?.ok) {
      const body = (await res.json()) as { applications: Application[] };
      setApplications(body.applications);
    }

    const { data: contractRows } = await supabase
      .from("contracts")
      .select("id, application_id, status")
      .eq("job_id", jobId);
    setContracts(
      new Map(
        (contractRows ?? []).map((c) => [
          c.application_id,
          { id: c.id, status: c.status },
        ]),
      ),
    );

    setLoading(false);
  }

  const name = (app: Application | null) =>
    app
      ? [app.first_name, app.last_initial ? `${app.last_initial}.` : null]
          .filter(Boolean)
          .join(" ")
      : "";

  const handleSelectCandidate = async () => {
    if (!selectedApplication || processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);

    const res = await fetch(
      `/api/applications/${selectedApplication.application_id}/select`,
      { method: "POST" },
    ).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as {
      code?: string;
      selection?: { status?: string };
    };

    // Succès seulement si la base a bien enregistré la sélection.
    if (res?.ok && body.selection?.status === "selected") {
      toast({
        title: ta.toasts.selectedTitle,
        variant: "success",
        description: ta.toasts.selectedDesc,
      });
    } else {
      toast({
        title: ta.toasts.errorTitle,
        description:
          body.code && body.code in ta.errors
            ? ta.errors[body.code as keyof typeof ta.errors]
            : ta.errors.generic,
        variant: "destructive",
      });
    }
    // L'écran affiche toujours l'état relu (places, statut).
    await loadData();

    setSelectedApplication(null);
    setActionType(null);
    processingRef.current = false;
    setProcessing(false);
  };

  const handleRejectCandidate = async () => {
    if (!selectedApplication || processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);
    const supabase = createClient();

    const { data: updated, error } = await supabase
      .from("job_applications")
      .update({
        status: "rejected",
        rejection_reason: rejectionReason || null,
      })
      .eq("id", selectedApplication.application_id)
      .select("id");

    if (error || !updated?.length) {
      toast({
        title: ta.toasts.errorTitle,
        description: ta.toasts.rejectError,
        variant: "destructive",
      });
    } else {
      toast({
        title: ta.toasts.rejectedTitle,
        variant: "success",
        description: ta.toasts.rejectedDesc,
      });
    }
    await loadData();

    setSelectedApplication(null);
    setActionType(null);
    setRejectionReason("");
    processingRef.current = false;
    setProcessing(false);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString(
      locale === "fr" ? "fr-FR" : "en-GB",
      {
        day: "numeric",
        month: "long",
        year: "numeric",
      },
    );
  };

  const formatTime = (time: string) => {
    return time?.slice(0, 5) || "";
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case "pending":
        return (
          <Badge className="bg-yellow-100 text-yellow-700">
            {ta.status.pending}
          </Badge>
        );
      case "shortlisted":
        return (
          <Badge className="bg-blue-100 text-blue-700">
            {ta.status.shortlisted}
          </Badge>
        );
      case "selected":
        return (
          <Badge className="bg-green-100 text-green-700">
            {ta.status.selected}
          </Badge>
        );
      case "rejected":
        return (
          <Badge className="bg-red-100 text-red-700">
            {ta.status.rejected}
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary">
            {status && status in ta.status
              ? ta.status[status as keyof typeof ta.status]
              : status}
          </Badge>
        );
    }
  };

  const countStatus = (status: string) =>
    String(applications.filter((a) => a.status === status).length);

  const filteredApplications = applications.filter(
    (app) => app.status === activeTab,
  );
  const isFull =
    !!job && (job.positions_filled ?? 0) >= (job.positions_available ?? 1);

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-background p-4">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {ta.back}
        </Button>
        <div className="text-center mt-8">
          <p className="text-muted-foreground">{ta.jobNotFound}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b p-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="mb-3"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          {ta.back}
        </Button>

        <h1 className="text-xl font-bold">{job.title}</h1>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground mt-2">
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            {job.city}
            {job.quartier ? `, ${job.quartier}` : ""}
          </span>
          <span className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {formatDate(job.start_date)}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {formatTime(job.start_time)} - {formatTime(job.end_time)}
          </span>
        </div>

        <div className="flex items-center gap-4 mt-3">
          <div className="flex items-center gap-1.5">
            <Users className="h-4 w-4 text-violet-600" />
            <span className="font-medium">{applications.length}</span>
            <span className="text-sm text-muted-foreground">
              {ta.applications}
            </span>
          </div>
          <div className="text-sm">
            <span className="font-medium">{job.positions_filled}</span>
            <span className="text-muted-foreground">
              {ta.positionsFilled.replace(
                "{count}",
                String(job.positions_available),
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Applications */}
      <div className="p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="pending" className="text-xs">
              {ta.tabs.pending.replace("{count}", countStatus("pending"))}
            </TabsTrigger>
            <TabsTrigger value="shortlisted" className="text-xs">
              {ta.tabs.shortlisted.replace(
                "{count}",
                countStatus("shortlisted"),
              )}
            </TabsTrigger>
            <TabsTrigger value="selected" className="text-xs">
              {ta.tabs.selected.replace("{count}", countStatus("selected"))}
            </TabsTrigger>
            <TabsTrigger value="rejected" className="text-xs">
              {ta.tabs.rejected.replace("{count}", countStatus("rejected"))}
            </TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-4 space-y-3">
            {filteredApplications.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">{ta.empty}</p>
                </CardContent>
              </Card>
            ) : (
              filteredApplications.map((app) => (
                <Card key={app.application_id}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Avatar className="h-12 w-12">
                        {app.photo_url && (
                          <AvatarImage src={app.photo_url} alt={name(app)} />
                        )}
                        <AvatarFallback>
                          {app.first_name?.[0]}
                          {app.last_initial}
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{name(app)}</span>
                          {getStatusBadge(app.status)}
                          {app.match_score && (
                            <Badge variant="outline" className="text-xs">
                              {Math.round(app.match_score)}% match
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                          {app.distance_km !== null && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {ta.distance.replace(
                                "{km}",
                                Number(app.distance_km).toFixed(1),
                              )}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Star className="h-3 w-3 text-yellow-500" />
                            {Number(app.reliability_score || 0).toFixed(1)}
                          </span>
                          <span>
                            {ta.missions.replace(
                              "{count}",
                              String(app.completed_missions || 0),
                            )}
                          </span>
                        </div>

                        {app.skills.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {app.skills.slice(0, 3).map((skill) => (
                              <Badge
                                key={skill}
                                variant="secondary"
                                className="text-xs"
                              >
                                {skill}
                              </Badge>
                            ))}
                            {app.skills.length > 3 && (
                              <Badge variant="secondary" className="text-xs">
                                +{app.skills.length - 3}
                              </Badge>
                            )}
                          </div>
                        )}

                        {(app.status === "pending" ||
                          app.status === "shortlisted") && (
                          <div className="flex items-center gap-2 mt-3">
                            <Button
                              size="sm"
                              onClick={() => {
                                setSelectedApplication(app);
                                setActionType("select");
                              }}
                            >
                              <CheckCircle className="h-4 w-4 mr-1" />
                              {ta.actions.select}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedApplication(app);
                                setActionType("reject");
                              }}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              {ta.actions.reject}
                            </Button>
                          </div>
                        )}

                        {app.status === "selected" && (
                          <div className="flex flex-wrap items-center gap-2 mt-3">
                            <Button size="sm" variant="outline">
                              <Phone className="h-4 w-4 mr-1" />
                              {ta.actions.contact}
                            </Button>
                            {(() => {
                              const contract = contracts.get(
                                app.application_id,
                              );
                              if (!contract) return null;
                              return (
                                <>
                                  <motion.div whileTap={{ scale: 0.97 }}>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        router.push(`/contracts/${contract.id}`)
                                      }
                                    >
                                      <FileText className="h-4 w-4 mr-1" />
                                      {ta.actions.contract}
                                    </Button>
                                  </motion.div>
                                  <Badge
                                    variant={
                                      contract.status === "completed"
                                        ? "success"
                                        : "warning"
                                    }
                                    className="text-xs"
                                  >
                                    {
                                      t.contract.status[
                                        contract.status ?? "pending"
                                      ]
                                    }
                                  </Badge>
                                </>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Selection Dialog */}
      <Dialog
        open={actionType === "select"}
        onOpenChange={() => setActionType(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ta.selectDialog.title}</DialogTitle>
            <DialogDescription>
              {ta.selectDialog.description.replace(
                "{name}",
                name(selectedApplication),
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              {isFull ? ta.errors.no_positions : ta.selectDialog.notice}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionType(null)}>
              {ta.cancel}
            </Button>
            <Button onClick={handleSelectCandidate} disabled={processing}>
              {processing ? ta.processing : ta.selectDialog.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rejection Dialog */}
      <Dialog
        open={actionType === "reject"}
        onOpenChange={() => setActionType(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ta.rejectDialog.title}</DialogTitle>
            <DialogDescription>
              {ta.rejectDialog.description.replace(
                "{name}",
                name(selectedApplication),
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              placeholder={ta.rejectDialog.placeholder}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionType(null)}>
              {ta.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectCandidate}
              disabled={processing}
            >
              {processing ? ta.processing : ta.rejectDialog.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
