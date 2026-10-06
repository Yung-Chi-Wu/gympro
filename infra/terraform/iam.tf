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

  # Allow reading the API keys from SSM Parameter Store
  statement {
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = local.secret_param_arns
  }

  # Decrypting a SecureString needs kms:Decrypt. Scoped to calls SSM makes
  # on the Lambda's behalf, for these two parameters only.
  statement {
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${data.aws_region.current.name}.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "kms:EncryptionContext:PARAMETER_ARN"
      values   = local.secret_param_arns
    }
  }
}

resource "aws_iam_role_policy" "ai_worker_permissions" {
  name   = "gympro-ai-worker-permissions"
  role   = aws_iam_role.ai_worker_lambda_role.id
  policy = data.aws_iam_policy_document.ai_worker_permissions.json
}