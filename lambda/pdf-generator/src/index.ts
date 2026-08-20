import type { SQSEvent, SQSHandler, SQSRecord } from 'aws-lambda'
import { getSupabaseClient, fetchReport, markPdfStatus } from './supabase'
import { generateReportPdf } from './pdf'
import { uploadPdf } from './s3'
import type { PdfRequestMessage } from './types'

async function processMessage(record: SQSRecord): Promise<void> {
    const message = JSON.parse(record.body) as PdfRequestMessage
    const { userId, periodStart } = message

    console.log(`Generating PDF for user ${userId}, period ${periodStart}`)

    const supabase = await getSupabaseClient()
    const bucket = process.env.PDF_BUCKET_NAME
    if (!bucket) {
        throw new Error('PDF_BUCKET_NAME environment variable is not set')
    }

    try {
        const { recommendation } = await fetchReport(supabase, userId, periodStart)
        const pdfBytes = await generateReportPdf(periodStart, recommendation)

        const key = `report-pdfs/${userId}/${periodStart}.pdf`
        await uploadPdf(bucket, key, pdfBytes)

        await markPdfStatus(supabase, userId, periodStart, 'completed')
        console.log(`PDF uploaded to s3://${bucket}/${key}`)
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        console.error(`Failed to generate PDF for user ${userId}:`, errorMessage)
        await markPdfStatus(supabase, userId, periodStart, 'failed')
        throw err
    }
}

export const handler: SQSHandler = async (event: SQSEvent) => {
    console.log(`Received ${event.Records.length} message(s) from SQS`)
    for (const record of event.Records) {
        await processMessage(record)
    }
}