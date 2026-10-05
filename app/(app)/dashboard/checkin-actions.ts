'use server'

import { createClient } from '@/lib/supabase/server'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider'
import { computeRegularCheckInWindow, computeProCheckInWindow } from '@/lib/checkin-window'
import { toFriendlyError } from '@/lib/friendly-error'

export interface CheckInResult {
    success: boolean
    message: string
}

export async function submitPeriodCheckIn(weightKg: number, userNote?: string): Promise<CheckInResult> {
    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        return { success: false, message: 'Not authenticated.' }
    }
    if (!weightKg || weightKg <= 0) {
        return { success: false, message: 'Enter a valid weight.' }
    }

    const { data: profile } = await supabase
        .from('user_profiles')
        .select('timezone, language')
        .eq('user_id', user.id)
        .maybeSingle()

    const timezone = profile?.timezone || 'UTC'
    const language = profile?.language || 'en'

    const { data: cycle } = await supabase
        .from('training_cycles')
        .select('cycle_length, start_date')
        .eq('user_id', user.id)
        .maybeSingle()

    const window = cycle
        ? computeProCheckInWindow(timezone, cycle.cycle_length, cycle.start_date)
        : computeRegularCheckInWindow(timezone)

    if (!window.isOpen || !window.periodStart || !window.periodEnd) {
        return { success: false, message: window.closedMessage ?? 'Check-in is not open yet.' }
    }

    const { data: existingReport } = await supabase
        .from('period_reports')
        .select('status')
        .eq('user_id', user.id)
        .eq('period_start', window.periodStart)
        .maybeSingle()

    if (existingReport && existingReport.status !== 'failed') {
        return {
            success: false,
            message:
                existingReport.status === 'completed'
                    ? 'You already checked in for this period — your report is ready below.'
                    : 'You already checked in for this period — your report is still being generated.',
        }
    }

    const { error: metricError } = await supabase.from('body_metrics').insert({
        user_id: user.id,
        weight_kg: weightKg,
        recorded_at: new Date().toISOString(),
    })
    if (metricError) {
        return { success: false, message: toFriendlyError(metricError) }
    }

    const { error: upsertError } = await supabase.from('period_reports').upsert(
        {
            user_id: user.id,
            period_start: window.periodStart,
            status: 'pending',
            user_note: userNote ?? null,
        },
        { onConflict: 'user_id,period_start' }
    )
    if (upsertError) {
        return { success: false, message: toFriendlyError(upsertError) }
    }

    try {
        // Short-lived credentials from Vercel OIDC — no stored AWS access key.
        // AWS_REGION must be set explicitly in Vercel, or it defaults to the function's own region.
        const sqsClient = new SQSClient({
            region: process.env.AWS_REGION,
            credentials: awsCredentialsProvider({ roleArn: process.env.AWS_ROLE_ARN! }),
        })
        const { MessageId } = await sqsClient.send(
            new SendMessageCommand({
                QueueUrl: process.env.SQS_QUEUE_URL,
                MessageBody: JSON.stringify({
                    userId: user.id,
                    periodStart: window.periodStart,
                    periodEnd: window.periodEnd,
                    userNote: userNote ?? undefined,
                    language,
                }),
            })
        )
        // The worker Lambda logs the same messageId, so this report can be traced in CloudWatch.
        console.log(`Queued report for user ${user.id}, period ${window.periodStart} (messageId ${MessageId})`)
    } catch (err) {
        console.error(`Failed to queue report for user ${user.id}, period ${window.periodStart}:`, err)
        // Otherwise the row stays 'pending' forever: the report panel spins and a
        // retry check-in is rejected as "already checked in".
        await supabase
            .from('period_reports')
            .update({ status: 'failed', error_message: 'Failed to queue report request.' })
            .eq('user_id', user.id)
            .eq('period_start', window.periodStart)
        return { success: false, message: 'Failed to queue your report. Please try again.' }
    }

    return { success: true, message: 'Check-in complete — your report is being generated.' }
}