# ---------- Store the Anthropic API key securely ----------
# NOTE: We only create the "container" here via Terraform.
# The actual secret VALUE is set manually via AWS CLI (see next step),
# so the key itself never appears in Terraform code or state history in plaintext logs.
resource "aws_secretsmanager_secret" "anthropic_api_key" {
  name        = "gympro/anthropic-api-key"
  description = "Anthropic API key used by the AI worker Lambda"
}

resource "aws_secretsmanager_secret" "supabase_service_role_key" {
  name        = "gympro/supabase-service-role-key"
  description = "Supabase service_role key used by the AI worker Lambda to bypass RLS"
}