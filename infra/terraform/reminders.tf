# ---------- The daily reminder ----------
# EventBridge Scheduler invokes a small Lambda every hour on the hour. It sends the 21:00 reminder
# (lib/push.ts) to the devices of users whose local time is 21:00 to 21:59, by Web Push with the
# VAPID key below. It calls no model. Cost: ~720 schedule and Lambda invocations a month, inside the
# free tiers; push services charge nothing.

locals {
  # A SecureString created by hand, like the secrets in parameters.tf: the private key's public half
  # is NEXT_PUBLIC_VAPID_PUBLIC_KEY in Vercel, which the browser subscribes with
  vapid_private_key_param     = "/gympro/vapid-private-key"
  vapid_private_key_param_arn = "arn:aws:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter${local.vapid_private_key_param}"
  reminder_secret_arns        = [local.supabase_service_role_key_param_arn, local.vapid_private_key_param_arn]
}

resource "aws_cloudwatch_log_group" "reminders_logs" {
  name              = "/aws/lambda/gympro-reminders"
  retention_in_days = 30

  tags = {
    Project = "gympro"
  }
}

resource "aws_iam_role" "reminders_lambda_role" {
  name               = "gympro-reminders-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "reminders_permissions" {
  # Write to its own log group only
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.reminders_logs.arn}:*"]
  }

  # The Supabase key and the VAPID key: it never calls Claude
  statement {
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = local.reminder_secret_arns
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
      values   = local.reminder_secret_arns
    }
  }
}

resource "aws_iam_role_policy" "reminders_permissions" {
  name   = "gympro-reminders-permissions"
  role   = aws_iam_role.reminders_lambda_role.id
  policy = data.aws_iam_policy_document.reminders_permissions.json
}

# Same zip as the AI worker (the build emits every handler into dist/)
resource "aws_lambda_function" "reminders" {
  function_name = "gympro-reminders"
  role          = aws_iam_role.reminders_lambda_role.arn
  handler       = "reminders.handler"
  runtime       = "nodejs22.x"

  filename         = data.archive_file.ai_worker_zip.output_path
  source_code_hash = data.archive_file.ai_worker_zip.output_base64sha256

  timeout     = 60
  memory_size = 256

  environment {
    variables = {
      SUPABASE_URL                    = var.supabase_url
      SUPABASE_SERVICE_ROLE_KEY_PARAM = local.supabase_service_role_key_param
      VAPID_PRIVATE_KEY_PARAM         = local.vapid_private_key_param
    }
  }

  depends_on = [aws_cloudwatch_log_group.reminders_logs]
}

# ---------- The hourly schedule ----------
resource "aws_iam_role" "reminders_schedule_role" {
  name               = "gympro-reminders-schedule-role"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume_role.json
}

data "aws_iam_policy_document" "reminders_schedule_permissions" {
  statement {
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.reminders.arn]
  }
}

resource "aws_iam_role_policy" "reminders_schedule_permissions" {
  name   = "gympro-reminders-schedule-permissions"
  role   = aws_iam_role.reminders_schedule_role.id
  policy = data.aws_iam_policy_document.reminders_schedule_permissions.json
}

resource "aws_scheduler_schedule" "hourly_reminders" {
  name        = "gympro-hourly-reminders"
  description = "Send the 21:00 reminder to users whose local time is 21:00"

  # On the hour, so the reminder comes at 21:00 where the offset is whole hours
  schedule_expression = "cron(0 * * * ? *)"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.reminders.arn
    role_arn = aws_iam_role.reminders_schedule_role.arn

    # A retry within the hour still finds the users due; a device already reminded today is skipped
    retry_policy {
      maximum_retry_attempts       = 1
      maximum_event_age_in_seconds = 900
    }
  }
}

# ---------- Alarm: the reminder Lambda threw ----------
resource "aws_cloudwatch_metric_alarm" "reminders_errors" {
  alarm_name        = "gympro-reminders-errors"
  alarm_description = "The hourly reminder Lambda threw an error. Check /aws/lambda/gympro-reminders."

  namespace   = "AWS/Lambda"
  metric_name = "Errors"
  dimensions = {
    FunctionName = aws_lambda_function.reminders.function_name
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
