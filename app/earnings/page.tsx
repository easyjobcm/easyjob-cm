"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../components/ui/tabs";
import { Skeleton } from "../../components/ui/skeleton";
import {
  Wallet,
  ArrowDownToLine,
  TrendingUp,
  Clock,
  CheckCircle,
} from "lucide-react";
import { BottomNav } from "@/components/layout/bottom-nav";

interface EarningsSummary {
  available_balance: number;
  pending_balance: number;
  total_earned: number;
  total_withdrawn: number;
}

interface Transaction {
  id: string;
  transaction_type: string;
  amount: number;
  balance_after: number;
  description: string;
  created_at: string;
}

interface Payment {
  id: string;
  gross_amount: number;
  net_amount: number;
  hours_worked: number;
  status: string;
  created_at: string;
  mission: {
    scheduled_date: string;
    job: {
      title: string;
      company: {
        company_name: string;
      };
    };
  };
}

export default function EarningsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<EarningsSummary>({
    available_balance: 0,
    pending_balance: 0,
    total_earned: 0,
    total_withdrawn: 0,
  });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  useEffect(() => {
    async function loadData() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login?redirect=/earnings");
        return;
      }

      // Get candidate profile
      const { data: profile } = await supabase
        .from("candidate_profiles")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (!profile) {
        router.push("/onboarding/candidate");
        return;
      }

      // MVP: earnings are driven by mission payments only (no wallets/withdrawals).
      const { data: paymentData } = await supabase
        .from("payments")
        .select(
          `
          *,
          mission:missions(
            scheduled_date,
            job:jobs(
              title,
              company:company_profiles(company_name)
            )
          )
        `,
        )
        .eq("candidate_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(20);

      if (paymentData) {
        const typedPayments = paymentData as Payment[];
        setPayments(typedPayments);

        const totalEarned = typedPayments.reduce(
          (sum, payment) => sum + (payment.net_amount || 0),
          0,
        );
        const pendingBalance = typedPayments
          .filter(
            (payment) =>
              payment.status === "pending" || payment.status === "processing",
          )
          .reduce((sum, payment) => sum + (payment.net_amount || 0), 0);

        setSummary({
          available_balance: totalEarned - pendingBalance,
          pending_balance: pendingBalance,
          total_earned: totalEarned,
          total_withdrawn: 0,
        });

        const derivedTransactions: Transaction[] = typedPayments.map(
          (payment) => ({
            id: payment.id,
            transaction_type: "credit",
            amount: payment.net_amount,
            balance_after: 0,
            description: `Paiement mission: ${payment.mission?.job?.title || "Mission"}`,
            created_at: payment.created_at,
          }),
        );

        setTransactions(derivedTransactions);
      }

      setLoading(false);
    }

    loadData();
  }, [router]);

  const formatCurrency = (amount: number) => {
    return (
      new Intl.NumberFormat("fr-CM", {
        style: "decimal",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(amount) + " XAF"
    );
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-green-100 text-green-700">Complete</Badge>;
      case "pending":
        return (
          <Badge className="bg-yellow-100 text-yellow-700">En attente</Badge>
        );
      case "processing":
        return <Badge className="bg-blue-100 text-blue-700">En cours</Badge>;
      case "failed":
        return <Badge className="bg-red-100 text-red-700">Echoue</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case "credit":
        return <ArrowDownToLine className="h-4 w-4 text-green-600" />;
      default:
        return <CheckCircle className="h-4 w-4 text-blue-600" />;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background pb-20">
        <div className="p-4 space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <div className="bg-linear-to-br from-violet-600 to-violet-800 text-white p-6 rounded-b-3xl">
        <h1 className="text-xl font-bold mb-4">Mes Gains</h1>

        {/* Wallet Card */}
        <Card className="bg-white/10 border-white/20 backdrop-blur-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                <span className="text-sm opacity-80">Solde disponible</span>
              </div>
              <TrendingUp className="h-5 w-5 opacity-80" />
            </div>
            <div className="text-3xl font-bold mb-4">
              {formatCurrency(summary.available_balance)}
            </div>
            <div className="flex items-center justify-between text-sm">
              <div>
                <span className="opacity-70">En attente: </span>
                <span>{formatCurrency(summary.pending_balance)}</span>
              </div>
              <Badge className="bg-yellow-100 text-yellow-700">
                Retrait indisponible en MVP
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="bg-white/10 rounded-xl p-3">
            <div className="text-sm opacity-70">Total gagne</div>
            <div className="text-lg font-bold">
              {formatCurrency(summary.total_earned)}
            </div>
          </div>
          <div className="bg-white/10 rounded-xl p-3">
            <div className="text-sm opacity-70">Total retire</div>
            <div className="text-lg font-bold">
              {formatCurrency(summary.total_withdrawn)}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <Tabs defaultValue="payments" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="payments">Paiements</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
          </TabsList>

          <TabsContent value="payments" className="mt-4 space-y-3">
            {payments.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center">
                  <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">
                    Aucun paiement pour le moment
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Completez des missions pour recevoir des paiements
                  </p>
                </CardContent>
              </Card>
            ) : (
              payments.map((payment) => (
                <Card key={payment.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="font-medium">
                          {payment.mission?.job?.title || "Mission"}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {payment.mission?.job?.company?.company_name ||
                            "Entreprise"}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {formatDate(payment.created_at)} |{" "}
                          {payment.hours_worked}h
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-green-600">
                          +{formatCurrency(payment.net_amount)}
                        </div>
                        {getStatusBadge(payment.status)}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="transactions" className="mt-4 space-y-2">
            {transactions.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center">
                  <Wallet className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">Aucune transaction</p>
                </CardContent>
              </Card>
            ) : (
              transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center gap-3 p-3 bg-card rounded-lg"
                >
                  <div className="p-2 bg-muted rounded-full">
                    {getTransactionIcon(tx.transaction_type)}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm">
                      {tx.description || tx.transaction_type}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(tx.created_at)}
                    </div>
                  </div>
                  <div
                    className={`font-semibold ${tx.transaction_type === "credit" || tx.transaction_type === "bonus" ? "text-green-600" : "text-red-600"}`}
                  >
                    {tx.transaction_type === "credit" ||
                    tx.transaction_type === "bonus"
                      ? "+"
                      : "-"}
                    {formatCurrency(Math.abs(tx.amount))}
                  </div>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>

      <BottomNav />
    </div>
  );
}
