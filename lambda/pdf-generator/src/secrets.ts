import {
    SecretsManagerClient,
    GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager'

const client = new SecretsManagerClient({})
const secretCache = new Map<string, string>()

export async function getSecret(secretName: string): Promise<string> {
    const cached = secretCache.get(secretName)
    if (cached) return cached

    const response = await client.send(
        new GetSecretValueCommand({ SecretId: secretName })
    )

    const value = response.SecretString
    if (!value) {
        throw new Error(`Secret ${secretName} has no string value`)
    }

    secretCache.set(secretName, value)
    return value
}