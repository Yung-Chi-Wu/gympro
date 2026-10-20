# ---------- The daily review of Ronnie's conversations ----------
# Once a day a Lambda reads each user's Ronnie conversation from a day that has ended in their
# time zone, asks a model which replies got something wrong, flags them (ai_trace_flags, kind
# audit, kept a year) and emails the owner when anything is worth a look
# (lambda/ai-worker/src/audit.ts). The model calls cost about US$0.05 a conversation day and are
# capped per run in the code; they show in ai_usage_daily and the AI cost alarm as feature audit.

resource "aws_cloudwatch_log_group" "ronnie_audit_logs" {
  name              = "/aws/lambda/gympro-ronnie-audit"
  retention_in_days = 30

  tags = {
    Project = "gympro"
  }
}

# ---------- Where the email goes ----------
# Its own topic, so the alarms stay alarms. AWS emails a confirmation link after the first apply,
# and nothing is delivered until it has been clicked.
resource "aws_sns_topic" "ronnie_audit" {
  name = "gympro-ronnie-audit"

  tags = {
    Project = "gympro"
  }
}

resource "aws_sns_topic_subscription" "ronnie_audit_email" {
  topic_arn = aws_sns_topic.ronnie_audit.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_iam_role" "ronnie_audit_lambda_role" {
  name               = "gympro-ronnie-audit-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "ronnie_audit_permissions" {
  # Write to its own log group only
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.ronnie_audit_logs.arn}:*"]
  }

  # Both keys: it reads traces from Supabase and calls Claude
  statement {
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = local.secret_param_arns
  }

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

  # The email, on its own topic only
  statement {
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.ronnie_audit.arn]
  }
}

resource "aws_iam_role_policy" "ronnie_audit_permissions" {
  name   = "gympro-ronnie-audit-permissions"
  role   = aws_iam_role.ronnie_audit_lambda_role.id
  policy = data.aws_iam_policy_document.ronnie_audit_permissions.json
}

# Same zip as the AI worker (the build emits all three handlers into dist/)
resource "aws_lambda_function" "ronnie_audit" {
  function_name = "gympro-ronnie-audit"
  role          = aws_iam_role.ronnie_audit_lambda_role.arn
  handler       = "audit.handler"
  runtime       = "nodejs22.x"

  filename         = data.archive_file.ai_worker_zip.output_path
  source_code_hash = data.archive_file.ai_worker_zip.output_base64sha256

  # One model call per conversation day, up to 20 a run; the code starts no new one in the last 4 minutes
  timeout     = 900
  memory_size = 256

  environment {
    variables = {
      SUPABASE_URL                    = var.supabase_url
      ANTHROPIC_API_KEY_PARAM         = local.anthropic_api_key_param
      SUPABASE_SERVICE_ROLE_KEY_PARAM = local.supabase_service_role_key_param
      AUDIT_TOPIC_ARN                 = aws_sns_topic.ronnie_audit.arn
    }
  }

  depends_on = [aws_cloudwatch_log_group.ronnie_audit_logs]
}

# The schedule invokes it asynchronously. A failed run isn't retried at once: what it didn't
# finish is still unread, and the next day's run reads it.
resource "aws_lambda_function_event_invoke_config" "ronnie_audit" {
  function_name          = aws_lambda_function.ronnie_audit.function_name
  maximum_retry_attempts = 0
}

# ---------- The daily schedule ----------
resource "aws_iam_role" "ronnie_audit_schedule_role" {
  name               = "gympro-ronnie-audit-schedule-role"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume_role.json
}

data "aws_iam_policy_document" "ronnie_audit_schedule_permissions" {
  statement {
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.ronnie_audit.arn]
  }
}

resource "aws_iam_role_policy" "ronnie_audit_schedule_permissions" {
  name   = "gympro-ronnie-audit-schedule-permissions"
  role   = aws_iam_role.ronnie_audit_schedule_role.id
  policy = data.aws_iam_policy_document.ronnie_audit_schedule_permissions.json
}

resource "aws_scheduler_schedule" "daily_ronnie_audit" {
  name        = "gympro-daily-ronnie-audit"
  description = "Review each user's Ronnie conversations from days that have ended"

  # The owner's morning; every user's day before it has ended by then
  schedule_expression          = "cron(15 8 * * ? *)"
  schedule_expression_timezone = "America/New_York"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.ronnie_audit.arn
    role_arn = aws_iam_role.ronnie_audit_schedule_role.arn

    # Unread days wait for the next run, so no retries
    retry_policy {
      maximum_retry_attempts       = 0
      maximum_event_age_in_seconds = 3600
    }
  }
}

# ---------- Alarm: the daily review failed ----------
# A day it couldn't read is logged (gympro-lambda-logged-errors); this one is the run itself
# failing, such as a bad key or the email not sent.
resource "aws_cloudwatch_metric_alarm" "ronnie_audit_errors" {
  alarm_name        = "gympro-ronnie-audit-errors"
  alarm_description = "The daily Ronnie review Lambda threw an error. Unread days wait for the next run. Check /aws/lambda/gympro-ronnie-audit."

  namespace   = "AWS/Lambda"
  metric_name = "Errors"
  dimensions = {
    FunctionName = aws_lambda_function.ronnie_audit.function_name
  }

  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}
