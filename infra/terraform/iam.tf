# ---------- Trust policy: allows the Lambda SERVICE (not a person)
# ---------- to assume this role ----------
data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ai_worker_lambda_role" {
  name               = "gympro-ai-worker-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

# ---------- Permissions: what this role is actually allowed to DO ----------
data "aws_iam_policy_document" "ai_worker_permissions" {
  # Allow reading and deleting messages from the SQS queue
  statement {
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.ai_analysis_queue.arn]
  }

  # Allow enqueueing PDF generation requests once a recommendation is done
  statement {
    effect = "Allow"
    actions = [
      "sqs:SendMessage",
    ]
    resources = [aws_sqs_queue.pdf_generation_queue.arn]
  }

  # Allow writing logs to CloudWatch, so we can debug failures
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:aws:logs:*:*:*"]
  }

  # Allow reading the Anthropic API key from Secrets Manager
  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
    ]
    resources = [
      aws_secretsmanager_secret.anthropic_api_key.arn,
      aws_secretsmanager_secret.supabase_service_role_key.arn,
    ]
  }
}

resource "aws_iam_role_policy" "ai_worker_permissions" {
  name   = "gympro-ai-worker-permissions"
  role   = aws_iam_role.ai_worker_lambda_role.id
  policy = data.aws_iam_policy_document.ai_worker_permissions.json
}