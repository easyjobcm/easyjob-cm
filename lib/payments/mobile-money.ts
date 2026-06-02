// SERVER ONLY — ne jamais importer depuis un composant 'use client'.
// Mobile Money Payment Service for Cameroon
// Supports MTN MoMo and Orange Money

interface MobileMoneyConfig {
  provider: "mtn_momo" | "orange_money";
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
  callbackUrl: string;
  subscriptionKey?: string;
}

interface PaymentRequest {
  amount: number;
  currency: string;
  phoneNumber: string;
  reference: string;
  description: string;
}

interface PaymentResponse {
  success: boolean;
  transactionId?: string;
  status: "pending" | "completed" | "failed";
  message: string;
  externalReference?: string;
}

interface TransactionStatus {
  transactionId: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  amount?: number;
  payerMessage?: string;
}

// MTN Mobile Money API Integration (Sandbox/Production)
class MTNMoMoService {
  private config: MobileMoneyConfig;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(config: MobileMoneyConfig) {
    this.config = config;
  }

  private async getAccessToken(): Promise<string> {
    // Check if token is still valid
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    // For sandbox/demo, return mock token
    if (process.env.MOBILE_MONEY_SANDBOX === "true") {
      this.accessToken = "sandbox_token_" + Date.now();
      this.tokenExpiry = new Date(Date.now() + 3600000); // 1 hour
      return this.accessToken;
    }

    // Production token request
    const response = await fetch(`${this.config.baseUrl}/collection/token/`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.config.apiKey}:${this.config.apiSecret}`).toString("base64")}`,
        "Ocp-Apim-Subscription-Key": this.config.subscriptionKey || "",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to get MTN MoMo access token");
    }

    const data = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };

    if (!data.access_token) {
      throw new Error("MTN MoMo access token missing in response");
    }

    this.accessToken = data.access_token;
    this.tokenExpiry = new Date(Date.now() + (data.expires_in ?? 3600) * 1000);

    return data.access_token;
  }

  async initiatePayment(request: PaymentRequest): Promise<PaymentResponse> {
    // Sandbox mode - simulate payment
    if (process.env.MOBILE_MONEY_SANDBOX === "true") {
      console.log("[v0] MTN MoMo Sandbox Payment:", request);

      // Simulate processing delay
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // 90% success rate in sandbox
      const success = Math.random() > 0.1;

      return {
        success,
        transactionId: success
          ? `mtn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
          : undefined,
        status: success ? "pending" : "failed",
        message: success
          ? "Paiement initie avec succes"
          : "Echec du paiement (sandbox simulation)",
        externalReference: request.reference,
      };
    }

    // Production mode
    const token = await this.getAccessToken();
    const referenceId = crypto.randomUUID();

    const response = await fetch(
      `${this.config.baseUrl}/collection/v1_0/requesttopay`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Reference-Id": referenceId,
          "X-Target-Environment": "mtncameroon",
          "Content-Type": "application/json",
          "Ocp-Apim-Subscription-Key": this.config.subscriptionKey || "",
        },
        body: JSON.stringify({
          amount: request.amount.toString(),
          currency: request.currency || "XAF",
          externalId: request.reference,
          payer: {
            partyIdType: "MSISDN",
            partyId: request.phoneNumber.replace("+", ""),
          },
          payerMessage: request.description,
          payeeNote: "EasyJob Payment",
        }),
      },
    );

    if (!response.ok) {
      return {
        success: false,
        status: "failed",
        message: "Echec de l'initiation du paiement",
      };
    }

    return {
      success: true,
      transactionId: referenceId,
      status: "pending",
      message: "Paiement initie. Confirmez sur votre telephone.",
      externalReference: request.reference,
    };
  }

  async checkTransactionStatus(
    transactionId: string,
  ): Promise<TransactionStatus> {
    // Sandbox mode
    if (process.env.MOBILE_MONEY_SANDBOX === "true") {
      // Simulate different statuses
      const statuses: TransactionStatus["status"][] = [
        "completed",
        "completed",
        "pending",
        "failed",
      ];
      const status = statuses[Math.floor(Math.random() * statuses.length)];

      return {
        transactionId,
        status,
        payerMessage:
          status === "completed"
            ? "Transaction reussie"
            : "Transaction en cours",
      };
    }

    // Production mode
    const token = await this.getAccessToken();

    const response = await fetch(
      `${this.config.baseUrl}/collection/v1_0/requesttopay/${transactionId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Target-Environment": "mtncameroon",
          "Ocp-Apim-Subscription-Key": this.config.subscriptionKey || "",
        },
      },
    );

    if (!response.ok) {
      return { transactionId, status: "failed" };
    }

    const data = await response.json();

    return {
      transactionId,
      status: data.status?.toLowerCase() || "pending",
      amount: parseFloat(data.amount),
      payerMessage: data.payerMessage,
    };
  }

  async initiateWithdrawal(request: PaymentRequest): Promise<PaymentResponse> {
    // Sandbox mode
    if (process.env.MOBILE_MONEY_SANDBOX === "true") {
      console.log("[v0] MTN MoMo Sandbox Withdrawal:", request);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const success = Math.random() > 0.05; // 95% success rate for withdrawals

      return {
        success,
        transactionId: success ? `mtn_out_${Date.now()}` : undefined,
        status: success ? "completed" : "failed",
        message: success ? "Retrait effectue avec succes" : "Echec du retrait",
        externalReference: request.reference,
      };
    }

    // Production - Disbursement API
    const token = await this.getAccessToken();
    const referenceId = crypto.randomUUID();

    const response = await fetch(
      `${this.config.baseUrl}/disbursement/v1_0/transfer`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Reference-Id": referenceId,
          "X-Target-Environment": "mtncameroon",
          "Content-Type": "application/json",
          "Ocp-Apim-Subscription-Key": this.config.subscriptionKey || "",
        },
        body: JSON.stringify({
          amount: request.amount.toString(),
          currency: request.currency || "XAF",
          externalId: request.reference,
          payee: {
            partyIdType: "MSISDN",
            partyId: request.phoneNumber.replace("+", ""),
          },
          payerMessage: request.description,
          payeeNote: "EasyJob Payout",
        }),
      },
    );

    return {
      success: response.ok,
      transactionId: response.ok ? referenceId : undefined,
      status: response.ok ? "pending" : "failed",
      message: response.ok ? "Retrait initie avec succes" : "Echec du retrait",
    };
  }
}

// Orange Money API Integration
class OrangeMoneyService {
  private config: MobileMoneyConfig;

  constructor(config: MobileMoneyConfig) {
    this.config = config;
  }

  async initiatePayment(request: PaymentRequest): Promise<PaymentResponse> {
    // Sandbox mode
    if (process.env.MOBILE_MONEY_SANDBOX === "true") {
      console.log("[v0] Orange Money Sandbox Payment:", request);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const success = Math.random() > 0.1;

      return {
        success,
        transactionId: success
          ? `om_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
          : undefined,
        status: success ? "pending" : "failed",
        message: success
          ? "Paiement initie. Composez *144# pour confirmer."
          : "Echec du paiement",
        externalReference: request.reference,
      };
    }

    // Production - Orange Money API
    const response = await fetch(`${this.config.baseUrl}/payment`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        merchant_key: this.config.apiSecret,
        currency: request.currency || "XAF",
        order_id: request.reference,
        amount: request.amount,
        return_url: this.config.callbackUrl,
        cancel_url: this.config.callbackUrl,
        notif_url: this.config.callbackUrl,
        lang: "fr",
        reference: request.description,
      }),
    });

    if (!response.ok) {
      return {
        success: false,
        status: "failed",
        message: "Echec de l'initiation du paiement Orange Money",
      };
    }

    const data = await response.json();

    return {
      success: true,
      transactionId: data.pay_token,
      status: "pending",
      message: data.message || "Paiement initie",
      externalReference: request.reference,
    };
  }

  async initiateWithdrawal(request: PaymentRequest): Promise<PaymentResponse> {
    // Sandbox mode
    if (process.env.MOBILE_MONEY_SANDBOX === "true") {
      console.log("[v0] Orange Money Sandbox Withdrawal:", request);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const success = Math.random() > 0.05;

      return {
        success,
        transactionId: success ? `om_out_${Date.now()}` : undefined,
        status: success ? "completed" : "failed",
        message: success ? "Retrait effectue avec succes" : "Echec du retrait",
      };
    }

    // Production implementation would go here
    return {
      success: false,
      status: "failed",
      message: "Orange Money withdrawal not implemented",
    };
  }

  async checkTransactionStatus(
    transactionId: string,
  ): Promise<TransactionStatus> {
    if (process.env.MOBILE_MONEY_SANDBOX === "true") {
      const statuses: TransactionStatus["status"][] = [
        "completed",
        "completed",
        "pending",
      ];
      return {
        transactionId,
        status: statuses[Math.floor(Math.random() * statuses.length)],
      };
    }

    // Production status check
    return { transactionId, status: "pending" };
  }
}

// Factory function to get the appropriate payment service
export function getMobileMoneyService(provider: "mtn_momo" | "orange_money") {
  const baseConfig: Partial<MobileMoneyConfig> = {
    callbackUrl: process.env.NEXT_PUBLIC_APP_URL + "/api/payments/callback",
  };

  if (provider === "mtn_momo") {
    return new MTNMoMoService({
      ...baseConfig,
      provider: "mtn_momo",
      apiKey: process.env.MTN_MOMO_API_KEY || "sandbox_key",
      apiSecret: process.env.MTN_MOMO_API_SECRET || "sandbox_secret",
      baseUrl:
        process.env.MTN_MOMO_BASE_URL ||
        "https://sandbox.momodeveloper.mtn.com",
      subscriptionKey: process.env.MTN_MOMO_SUBSCRIPTION_KEY,
    } as MobileMoneyConfig);
  }

  return new OrangeMoneyService({
    ...baseConfig,
    provider: "orange_money",
    apiKey: process.env.ORANGE_MONEY_API_KEY || "sandbox_key",
    apiSecret: process.env.ORANGE_MONEY_MERCHANT_KEY || "sandbox_secret",
    baseUrl:
      process.env.ORANGE_MONEY_BASE_URL ||
      "https://api.orange.com/orange-money-webpay/cm/v1",
  } as MobileMoneyConfig);
}

// Process withdrawal request
export async function processWithdrawal(
  withdrawalId: string,
  phoneNumber: string,
  amount: number,
  provider: "mtn_momo" | "orange_money",
): Promise<PaymentResponse> {
  const service = getMobileMoneyService(provider);

  return service.initiateWithdrawal({
    amount,
    currency: "XAF",
    phoneNumber,
    reference: withdrawalId,
    description: "EasyJob - Retrait de gains",
  });
}

export type { PaymentRequest, PaymentResponse, TransactionStatus };
