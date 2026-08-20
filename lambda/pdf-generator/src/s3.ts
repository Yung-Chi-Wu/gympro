import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const s3Client = new S3Client({})

export async function uploadPdf(bucket: string, key: string, bytes: Uint8Array): Promise<void> {
    await s3Client.send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: bytes,
            ContentType: 'application/pdf',
        })
    )
}