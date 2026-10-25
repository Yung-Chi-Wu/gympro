import { PublishCommand, SNSClient } from '@aws-sdk/client-sns'
import type { Context } from 'aws-lambda'
import { getClaudeClient } from './claude'
import { getSupabaseClient } from './supabase'
import { runAudit } from './audit/run'
import { runWeeklyDigest } from './audit/digest'

// Two schedules from EventBridge Scheduler: each morning the daily review of Ronnie's
// conversations (audit/run.ts), and on Monday, with { "digest": "weekly" }, the owner's weekly
// email (audit/digest.ts). The email goes to its own SNS topic, apart from the alarms.

const sns = new SNSClient({})

/** The weekly schedule's input; anything else is the daily review */
export const isWeeklyDigest = (event: unknown) =>
    typeof event === 'object' && event !== null && (event as { digest?: unknown }).digest === 'weekly'

export async function handler(event: unknown, context: Context): Promise<void> {
    if (isWeeklyDigest(event)) {
        const topicArn = process.env.AUDIT_TOPIC_ARN
        if (!topicArn) throw new Error('AUDIT_TOPIC_ARN environment variable is not set')
        await runWeeklyDigest({
            supabase: await getSupabaseClient(),
            publish: async ({ subject, message }) => {
                await sns.send(new PublishCommand({ TopicArn: topicArn, Subject: subject, Message: message }))
            },
        })
        return
    }

    const [supabase, client] = await Promise.all([getSupabaseClient(), getClaudeClient()])
    await runAudit({ supabase, client, remainingMs: () => context.getRemainingTimeInMillis() })
}
