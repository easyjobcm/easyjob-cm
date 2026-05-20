import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { processWithdrawal } from "@/lib/payments/mobile-money"

// Process a withdrawal request
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 })
    }

    const body = await request.json()
    const { amount, payment_method, phone_number } = body

    // Validate input
    if (!amount || amount < 1000) {
      return NextResponse.json({ error: "Montant minimum: 1000 XAF" }, { status: 400 })
    }

    if (!payment_method || !['mtn_momo', 'orange_money'].includes(payment_method)) {
      return NextResponse.json({ error: "Methode de paiement invalide" }, { status: 400 })
    }

    if (!phone_number) {
      return NextResponse.json({ error: "Numero de telephone requis" }, { status: 400 })
    }

    // Get candidate profile and wallet
    const { data: candidate } = await supabase
      .from('candidate_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!candidate) {
      return NextResponse.json({ error: "Profil candidat non trouve" }, { status: 404 })
    }

    const { data: wallet } = await supabase
      .from('wallets')
      .select('*')
      .eq('candidate_id', candidate.id)
      .single()

    if (!wallet) {
      return NextResponse.json({ error: "Portefeuille non trouve" }, { status: 404 })
    }

    // Check sufficient balance
    if (wallet.available_balance < amount) {
      return NextResponse.json({ error: "Solde insuffisant" }, { status: 400 })
    }

    // Calculate fees (2%)
    const fee = Math.ceil(amount * 0.02)
    const netAmount = amount - fee

    // Create withdrawal request
    const { data: withdrawal, error: insertError } = await supabase
      .from('withdrawal_requests')
      .insert({
        candidate_id: candidate.id,
        wallet_id: wallet.id,
        amount,
        fee,
        net_amount: netAmount,
        payment_method,
        payment_details: { phone: phone_number },
        status: 'pending'
      })
      .select()
      .single()

    if (insertError) {
      console.error('[v0] Withdrawal insert error:', insertError)
      return NextResponse.json({ error: "Erreur lors de la creation de la demande" }, { status: 500 })
    }

    // Update wallet - move to pending
    await supabase
      .from('wallets')
      .update({
        available_balance: wallet.available_balance - amount,
        pending_balance: (wallet.pending_balance || 0) + amount
      })
      .eq('id', wallet.id)

    // Process the withdrawal via Mobile Money
    const paymentResult = await processWithdrawal(
      withdrawal.id,
      phone_number,
      netAmount,
      payment_method
    )

    // Update withdrawal with result
    if (paymentResult.success) {
      await supabase
        .from('withdrawal_requests')
        .update({
          status: 'processing',
          external_reference: paymentResult.transactionId
        })
        .eq('id', withdrawal.id)

      // Create transaction record
      await supabase.from('transactions').insert({
        wallet_id: wallet.id,
        transaction_type: 'withdrawal',
        amount: -amount,
        balance_after: wallet.available_balance - amount,
        reference_type: 'withdrawal',
        reference_id: withdrawal.id,
        description: `Retrait ${payment_method === 'mtn_momo' ? 'MTN MoMo' : 'Orange Money'}`
      })

      return NextResponse.json({
        success: true,
        message: paymentResult.message,
        withdrawal_id: withdrawal.id
      })
    } else {
      // Rollback - move back from pending
      await supabase
        .from('wallets')
        .update({
          available_balance: wallet.available_balance,
          pending_balance: (wallet.pending_balance || 0)
        })
        .eq('id', wallet.id)

      await supabase
        .from('withdrawal_requests')
        .update({ status: 'failed' })
        .eq('id', withdrawal.id)

      return NextResponse.json({
        success: false,
        error: paymentResult.message
      }, { status: 400 })
    }
  } catch (error) {
    console.error('[v0] Withdrawal error:', error)
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 })
  }
}

// Get withdrawal history
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '20')

    // Get candidate profile
    const { data: candidate } = await supabase
      .from('candidate_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (!candidate) {
      return NextResponse.json({ error: "Profil candidat non trouve" }, { status: 404 })
    }

    // Get withdrawals
    const { data: withdrawals } = await supabase
      .from('withdrawal_requests')
      .select('*')
      .eq('candidate_id', candidate.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    return NextResponse.json({ withdrawals })
  } catch (error) {
    console.error('[v0] Get withdrawals error:', error)
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 })
  }
}
