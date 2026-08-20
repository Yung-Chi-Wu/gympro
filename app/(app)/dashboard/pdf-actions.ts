'use server'

import { createClient } from '@/lib/supabase/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export interface GetPdfUrlResult {
    success: boolean
    url?: string
    message?: string
}

export async function getReportPdfUrl(periodStart: string): Promise<GetPdfUrlResult> {
    const supabase = await createClient()
    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        return { success: false, message: 'Not authenticated.' }
    }

    const { data: report } = await supabase
        .from('period_reports')
        .select('pdf_status')
        .eq('user_id', user.id)
        .eq('period_start', periodStart)
        .maybeSingle()

    if (!report || report.pdf_status !== 'completed') {
        return { success: false, message: 'PDF is not ready yet.' }
    }

    const bucket = process.env.PDF_BUCKET_NAME
    if (!bucket) {
        return { success: false, message: 'PDF storage is not configured.' }
    }

    try {
        const s3Client = new S3Client({ region: process.env.AWS_REGION })
        const key = `report-pdfs/${user.id}/${periodStart}.pdf`
        const url = await getSignedUrl(
            s3Client,
            new GetObjectCommand({ Bucket: bucket, Key: key }),
            { expiresIn: 300 } // link only valid for 5 minutes
        )
        return { success: true, url }
    } catch {
        return { success: false, message: 'Failed to prepare download. Please try again.' }
    }
}