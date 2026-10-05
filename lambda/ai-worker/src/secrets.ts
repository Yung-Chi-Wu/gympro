import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'

const client = new SSMClient({})

// Module-level cache: persists across invocations within the same
// warm Lambda execution environment, but resets on cold start.
const secretCache = new Map<string, string>()

// Reads a SecureString parameter from SSM Parameter Store, decrypted.
export async function getSecret(parameterName: string): Promise<string> {
  const cached = secretCache.get(parameterName)
  if (cached) {
    return cached
  }

  const response = await client.send(
    new GetParameterCommand({ Name: parameterName, WithDecryption: true })
  )

  const value = response.Parameter?.Value
  if (!value) {
    throw new Error(`Parameter ${parameterName} has no value`)
  }

  secretCache.set(parameterName, value)
  return value
}
