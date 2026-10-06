# ---------- Secrets the AI worker reads at runtime ----------
# These SSM Parameter Store SecureStrings are created by hand with
# `aws ssm put-parameter`, NOT by Terraform: an aws_ssm_parameter resource
# reads the decrypted value back into Terraform state on every refresh.
# Standard-tier parameters encrypted with the AWS managed key (aws/ssm) are free.
locals {
  anthropic_api_key_param         = "/gympro/anthropic-api-key"
  supabase_service_role_key_param = "/gympro/supabase-service-role-key"

  secret_param_arns = [
    for name in [local.anthropic_api_key_param, local.supabase_service_role_key_param] :
    "arn:aws:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter${name}"
  ]

  # The report scheduler reads only this one
  supabase_service_role_key_param_arn = local.secret_param_arns[1]
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}
