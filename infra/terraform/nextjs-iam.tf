# ---------- Trust Vercel's OIDC identity provider ----------
# Each Vercel deployment gets a short-lived token signed by Vercel.
# AWS verifies it against this provider and hands back temporary
# credentials, so no long-lived access key is stored in Vercel.
# (Uses the "Team" issuer mode — Vercel project Settings > Security.)
resource "aws_iam_openid_connect_provider" "vercel" {
  url            = "https://oidc.vercel.com/${var.vercel_team_slug}"
  client_id_list = ["https://vercel.com/${var.vercel_team_slug}"]
}

# ---------- Trust policies: production, and preview apart ----------
# Production may enqueue reports and embed queries. Preview deployments (any branch) get their
# own role that can only embed queries: a branch's code can't send to the production queue.
data "aws_iam_policy_document" "vercel_assume_role" {
  for_each = toset(["production", "preview"])

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
      values   = ["owner:${var.vercel_team_slug}:project:${var.vercel_project_name}:environment:${each.key}"]
    }
  }
}

resource "aws_iam_role" "nextjs" {
  name               = "gympro-nextjs-vercel-role"
  assume_role_policy = data.aws_iam_policy_document.vercel_assume_role["production"].json
}

resource "aws_iam_role" "nextjs_preview" {
  name               = "gympro-nextjs-vercel-preview-role"
  assume_role_policy = data.aws_iam_policy_document.vercel_assume_role["preview"].json
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

# ---------- Permissions: embed Ronnie's exercise-search queries ----------
# Each search_exercises call turns the query into a vector with Cohere Embed v4
# (lib/embeddings.ts), the model the search eval chose. Scoped to that one model.
data "aws_iam_policy_document" "nextjs_bedrock_embed" {
  statement {
    effect    = "Allow"
    actions   = ["bedrock:InvokeModel"]
    resources = ["arn:aws:bedrock:us-east-1::foundation-model/cohere.embed-v4:0"]
  }
}

resource "aws_iam_role_policy" "nextjs_bedrock_embed" {
  name   = "gympro-nextjs-bedrock-embed"
  role   = aws_iam_role.nextjs.id
  policy = data.aws_iam_policy_document.nextjs_bedrock_embed.json
}

resource "aws_iam_role_policy" "nextjs_preview_bedrock_embed" {
  name   = "gympro-nextjs-preview-bedrock-embed"
  role   = aws_iam_role.nextjs_preview.id
  policy = data.aws_iam_policy_document.nextjs_bedrock_embed.json
}

# ---------- Values to copy into Vercel environment variables ----------
output "nextjs_role_arn" {
  description = "Set as AWS_ROLE_ARN in Vercel, for Production"
  value       = aws_iam_role.nextjs.arn
}

output "nextjs_preview_role_arn" {
  description = "Set as AWS_ROLE_ARN in Vercel, for Preview"
  value       = aws_iam_role.nextjs_preview.arn
}

output "ai_analysis_queue_url" {
  description = "Set as SQS_QUEUE_URL in Vercel"
  value       = aws_sqs_queue.ai_analysis_queue.id
}
