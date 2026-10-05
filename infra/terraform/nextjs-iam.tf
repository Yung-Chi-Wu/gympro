# ---------- Trust Vercel's OIDC identity provider ----------
# Each Vercel deployment gets a short-lived token signed by Vercel.
# AWS verifies it against this provider and hands back temporary
# credentials, so no long-lived access key is stored in Vercel.
# (Uses the "Team" issuer mode — Vercel project Settings > Security.)
resource "aws_iam_openid_connect_provider" "vercel" {
  url            = "https://oidc.vercel.com/${var.vercel_team_slug}"
  client_id_list = ["https://vercel.com/${var.vercel_team_slug}"]
}

# ---------- Trust policy: only this project's chosen environments ----------
data "aws_iam_policy_document" "vercel_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.vercel.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "oidc.vercel.com/${var.vercel_team_slug}:aud"
      values   = ["https://vercel.com/${var.vercel_team_slug}"]
    }

    condition {
      test     = "StringEquals"
      variable = "oidc.vercel.com/${var.vercel_team_slug}:sub"
      values = [
        for env in var.vercel_environments :
        "owner:${var.vercel_team_slug}:project:${var.vercel_project_name}:environment:${env}"
      ]
    }
  }
}

resource "aws_iam_role" "nextjs" {
  name               = "gympro-nextjs-vercel-role"
  assume_role_policy = data.aws_iam_policy_document.vercel_assume_role.json
}

# ---------- Permissions: Next.js can only enqueue report requests ----------
data "aws_iam_policy_document" "nextjs_sqs_send_only" {
  statement {
    effect = "Allow"
    actions = [
      "sqs:SendMessage",
    ]
    resources = [aws_sqs_queue.ai_analysis_queue.arn]
  }
}

resource "aws_iam_role_policy" "nextjs_sqs_send_only" {
  name   = "gympro-nextjs-sqs-send-only"
  role   = aws_iam_role.nextjs.id
  policy = data.aws_iam_policy_document.nextjs_sqs_send_only.json
}

# ---------- Values to copy into Vercel environment variables ----------
output "nextjs_role_arn" {
  description = "Set as AWS_ROLE_ARN in Vercel"
  value       = aws_iam_role.nextjs.arn
}

output "ai_analysis_queue_url" {
  description = "Set as SQS_QUEUE_URL in Vercel"
  value       = aws_sqs_queue.ai_analysis_queue.id
}
