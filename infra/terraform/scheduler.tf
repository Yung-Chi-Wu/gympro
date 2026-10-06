# ---------- Automatic period reports ----------
# EventBridge Scheduler invokes a small Lambda every hour. The Lambda finds users
# whose training period ended in their own time zone and queues their report on
# the existing SQS queue, so reports no longer wait for a manual check-in.
# Cost: ~720 schedule and Lambda invocations a month, inside the free tiers.

resource "aws_cloudwatch_log_group" "report_scheduler_logs" {
  name              = "/aws/lambda/gympro-report-scheduler"
  retention_in_days = 14

  tags = {
    Project = "gympro"
  }
}

resource "aws_iam_role" "report_scheduler_lambda_role" {
  name               = "gympro-report-scheduler-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "report_scheduler_permissions" {
  # Queue reports for the AI worker
  statement {
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.ai_analysis_queue.arn]
  }

  # Write to its own log group only
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.report_scheduler_logs.arn}:*"]
  }

  # Only the Supabase key: the scheduler never calls Claude
  statement {
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = [local.supabase_service_role_key_param_arn]
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
      values   = [local.supabase_service_role_key_param_arn]
    }
  }
}

resource "aws_iam_role_policy" "report_scheduler_permissions" {
  name   = "gympro-report-scheduler-permissions"
  role   = aws_iam_role.report_scheduler_lambda_role.id
  policy = data.aws_iam_policy_document.report_scheduler_permissions.json
}

# Same zip as the AI worker (the build emits both handlers into dist/)
resource "aws_lambda_function" "report_scheduler" {
  function_name = "gympro-report-scheduler"
  role          = aws_iam_role.report_scheduler_lambda_role.arn
  handler       = "scheduler.handler"
  runtime       = "nodejs22.x"

  filename         = data.archive_file.ai_worker_zip.output_path
  source_code_hash = data.archive_file.ai_worker_zip.output_base64sha256

  timeout     = 30
  memory_size = 128

  environment {
    variables = {
      SUPABASE_URL                    = var.supabase_url
      SUPABASE_SERVICE_ROLE_KEY_PARAM = local.supabase_service_role_key_param
      SQS_QUEUE_URL                   = aws_sqs_queue.ai_analysis_queue.url
    }
  }

  depends_on = [aws_cloudwatch_log_group.report_scheduler_logs]
}

# ---------- The hourly schedule ----------
data "aws_iam_policy_document" "scheduler_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }

    # Confused-deputy protection: only schedules in this account may use the role
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "report_schedule_role" {
  name               = "gympro-report-schedule-role"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume_role.json
}

data "aws_iam_policy_document" "report_schedule_permissions" {
  statement {
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.report_scheduler.arn]
  }
}

resource "aws_iam_role_policy" "report_schedule_permissions" {
  name   = "gympro-report-schedule-permissions"
  role   = aws_iam_role.report_schedule_role.id
  policy = data.aws_iam_policy_document.report_schedule_permissions.json
}

resource "aws_scheduler_schedule" "hourly_report_check" {
  name        = "gympro-hourly-report-check"
  description = "Queue reports for users whose training period just ended"

  # Five past each hour, so a period ending at local midnight is picked up within the hour
  schedule_expression = "cron(5 * * * ? *)"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.report_scheduler.arn
    role_arn = aws_iam_role.report_schedule_role.arn

    # The next hourly run retries anything missed, so don't pile up retries
    retry_policy {
      maximum_retry_attempts       = 1
      maximum_event_age_in_seconds = 3600
    }
  }
}
