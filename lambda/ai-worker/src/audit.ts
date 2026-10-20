import { PublishCommand, SNSClient } from '@aws-sdk/client-sns'
import type { Context } from 'aws-lambda'
import { getClaudeClient } from './claude'
import { getSupabaseClient } from './supabase'
import { runAudit } from './audit/run'

// Runs once a day from EventBridge Scheduler: the daily review of Ronnie's conversations
// (audit/run.ts). The email goes to its own SNS topic, apart from the alarms.

const sns = new SNSClient({})

export async function handler(_event: unknown, context: Context): Promise<void> {
    const topicArn = process.env.AUDIT_TOPIC_ARN
    if (!topicArn) throw new Error('AUDIT_TOPIC_ARN environment variable is not set')

    const [supabase, client] = await Promise.all([getSupabaseClient(), getClaudeClient()])
    await runAudit({
        supabase,
        client,
        publish: async ({ subject, message }) => {
            await sns.send(new PublishCommand({ TopicArn: topicArn, Subject: subject, Message: message }))
        },
        remainingMs: () => context.getRemainingTimeInMillis(),
    })
}
