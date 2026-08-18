import { NextRequest, NextResponse } from 'next/server'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import { createClient } from '@/lib/supabase/server'

const sqsClient = new SQSClient({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
})

interface RequestBody {
    weekStart: string // ISO date string, e.g. "2026-08-17"
    userNote?: string
}

export async function POST(request: NextRequest) {
    const supabase = await createClient()

    // Confirm the request is coming from a logged-in user — we never
    // trust a userId sent from the client, we derive it from the
    // authenticated session instead.
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const body = (await request.json()) as RequestBody
    const { weekStart, userNote } = body

    if (!weekStart) {
        return NextResponse.json({ error: 'weekStart is required' }, { status: 400 })
    }

    // Create a pending row immediately, so the frontend can show
    // "processing..." right away instead of waiting for Lambda.
    const { error: upsertError } = await supabase.from('ai_recommendations').upsert(
        {
            user_id: user.id,
            week_start: weekStart,
            status: 'pending',
        },
        { onConflict: 'user_id,week_start' }
    )

    if (upsertError) {
        return NextResponse.json(
            { error: `Failed to create pending status: ${upsertError.message}` },
            { status: 500 }
        )
    }

    try {
        await sqsClient.send(
            new SendMessageCommand({
                QueueUrl: process.env.SQS_QUEUE_URL,
                MessageBody: JSON.stringify({
                    userId: user.id,
                    weekStart,
                    userNote,
                }),
            })
        )
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        return NextResponse.json(
            { error: `Failed to queue analysis request: ${errorMessage}` },
            { status: 500 }
        )
    }

    return NextResponse.json({ status: 'queued' }, { status: 202 })
}