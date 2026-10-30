# ---------- Where alarm notifications go ----------
resource "aws_sns_topic" "alerts" {
  name = "gympro-alerts"

  tags = {
    Project = "gympro"
  }
}

# AWS emails a confirmation link after the first apply — alerts are only
# delivered once that link has been clicked.
resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ---------- Alarm: the AI worker threw an error ----------
# Fires on the first failed attempt, even if SQS will retry it,
# so problems surface before the message gives up.
resource "aws_cloudwatch_metric_alarm" "ai_worker_errors" {
  alarm_name        = "gympro-ai-worker-errors"
  alarm_description = "The AI report worker Lambda threw an error. Check /aws/lambda/gympro-ai-worker."

  namespace   = "AWS/Lambda"
  metric_name = "Errors"
  dimensions = {
    FunctionName = aws_lambda_function.ai_worker.function_name
  }

  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ---------- Alarm: the hourly report scheduler failed ----------
# A failed run is retried by the next hourly run, but a persistent failure
# (bad Supabase key, queue permissions) means nobody gets a report.
resource "aws_cloudwatch_metric_alarm" "report_scheduler_errors" {
  alarm_name        = "gympro-report-scheduler-errors"
  alarm_description = "The hourly report scheduler Lambda threw an error. Check /aws/lambda/gympro-report-scheduler."

  namespace   = "AWS/Lambda"
  metric_name = "Errors"
  dimensions = {
    FunctionName = aws_lambda_function.report_scheduler.function_name
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

# ---------- Alarm: a report request gave up and landed in the DLQ ----------
# It stays in ALARM while a message sits there (up to 14 days), so clear the DLQ once the message
# is looked at. A later failure still emails meanwhile: whatever sends a message here throws in
# the worker first, which the worker-errors alarm reports each time.
resource "aws_cloudwatch_metric_alarm" "ai_analysis_dlq_not_empty" {
  alarm_name        = "gympro-ai-analysis-dlq-not-empty"
  alarm_description = "A report request failed 3 times and was moved to gympro-ai-analysis-dlq. Once it's looked at, purge or redrive the DLQ so this alarm can fire again."

  namespace   = "AWS/SQS"
  metric_name = "ApproximateNumberOfMessagesVisible"
  dimensions = {
    QueueName = aws_sqs_queue.ai_analysis_dlq.name
  }

  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ---------- Alarm: requests are piling up and nobody is consuming them ----------
# Three failed attempts take ~36 minutes with a 12-minute visibility timeout,
# so an hour means the worker isn't picking messages up at all
# (e.g. the event source mapping is disabled), not just retrying.
resource "aws_cloudwatch_metric_alarm" "ai_analysis_queue_stuck" {
  alarm_name        = "gympro-ai-analysis-queue-stuck"
  alarm_description = "A report request has waited over an hour in gympro-ai-analysis-queue."

  namespace   = "AWS/SQS"
  metric_name = "ApproximateAgeOfOldestMessage"
  dimensions = {
    QueueName = aws_sqs_queue.ai_analysis_queue.name
  }

  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 3600
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ---------- Alarm: AI calls are failing ----------
# The hourly scheduler counts the past hour's failed AI calls in ai_traces (Ronnie, Coach G,
# the report) and logs the count as a metric. One failure can be a blip; several in an hour
# means users are seeing errors.
resource "aws_cloudwatch_metric_alarm" "ai_errors" {
  alarm_name        = "gympro-ai-errors"
  alarm_description = "AI calls failed in the past hour (Ronnie, Coach G or the report). In Supabase: select * from ai_traces where status = 'error' order by created_at desc."

  namespace   = "GymPro/AI"
  metric_name = "ErrorsLastHour"

  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = var.ai_errors_per_hour_alarm
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ---------- Alarm: AI spending is high ----------
# What the past 24 hours of AI calls cost, from ai_traces. Anthropic bills separately from AWS,
# so the AWS budget doesn't see it; sign-up is open, so a runaway chat would show here first.
resource "aws_cloudwatch_metric_alarm" "ai_daily_cost" {
  alarm_name        = "gympro-ai-daily-cost"
  alarm_description = "AI calls cost more than the limit over the past 24 hours. In Supabase: select * from ai_usage_daily order by day desc."

  namespace   = "GymPro/AI"
  metric_name = "CostLast24hUSD"

  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = var.ai_daily_cost_alarm_usd
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ---------- Alarm: the hourly scheduler has gone quiet ----------
# Every hourly run publishes the GymPro/AI metrics, a quiet hour's 0 calls included. None for
# 3 hours means the schedule isn't invoking the scheduler, or it fails before publishing. Then
# no reports are queued, and the AI alarms see no data, which they read as fine: the alarms
# above can't report this one.
resource "aws_cloudwatch_metric_alarm" "report_scheduler_silent" {
  alarm_name        = "gympro-report-scheduler-silent"
  alarm_description = "The hourly report scheduler hasn't published its metrics for 3 hours: reports aren't being queued, and the AI alarms are blind. Check the schedule gympro-report-scheduler and /aws/lambda/gympro-report-scheduler."

  namespace   = "GymPro/AI"
  metric_name = "CallsLastHour"

  statistic           = "SampleCount"
  period              = 3600
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  # Missing data is the failure here
  treat_missing_data = "breaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ---------- Alarm: most of an hour's AI calls failed ----------
# The count alarm (gympro-ai-errors) needs several failures in an hour, which a quiet hour never
# reaches: with a key that stopped working, the one user who tried still saw an error. This one
# fires when at least one call failed and half or more of the hour's calls did. A Ronnie turn
# the user stopped isn't counted as a failure (the scheduler's stoppedByUser).
resource "aws_cloudwatch_metric_alarm" "ai_error_rate" {
  alarm_name        = "gympro-ai-error-rate"
  alarm_description = "Half or more of the past hour's AI calls failed. A dead or rotated Anthropic key looks like this (it lives in SSM and in Vercel). In Supabase: select * from ai_traces where status = 'error' order by created_at desc."

  metric_query {
    id          = "failing"
    expression  = "IF(errors >= 1 AND errors >= 0.5 * calls, 1, 0)"
    label       = "Half or more of the AI calls failed"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      namespace   = "GymPro/AI"
      metric_name = "ErrorsLastHour"
      stat        = "Maximum"
      period      = 3600
    }
  }

  metric_query {
    id = "calls"
    metric {
      namespace   = "GymPro/AI"
      metric_name = "CallsLastHour"
      stat        = "Maximum"
      period      = 3600
    }
  }

  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ---------- Alarms: a Lambda ran close to its timeout ----------
# Past the timeout a run is cut off: a report is retried and then lands in the DLQ, a scheduler
# run stops partway. Over 80% of it is the warning before that happens.
resource "aws_cloudwatch_metric_alarm" "ai_worker_near_timeout" {
  alarm_name        = "gympro-ai-worker-near-timeout"
  alarm_description = "A report took over 80% of the AI worker's ${aws_lambda_function.ai_worker.timeout} s timeout. Check the model's latency in ai_traces (feature 'report') and /aws/lambda/gympro-ai-worker."

  namespace   = "AWS/Lambda"
  metric_name = "Duration"
  dimensions = {
    FunctionName = aws_lambda_function.ai_worker.function_name
  }

  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = aws_lambda_function.ai_worker.timeout * 800
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "report_scheduler_near_timeout" {
  alarm_name        = "gympro-report-scheduler-near-timeout"
  alarm_description = "An hourly scheduler run took over 80% of its ${aws_lambda_function.report_scheduler.timeout} s timeout: with more users it will soon be cut off. Check /aws/lambda/gympro-report-scheduler."

  namespace   = "AWS/Lambda"
  metric_name = "Duration"
  dimensions = {
    FunctionName = aws_lambda_function.report_scheduler.function_name
  }

  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = aws_lambda_function.report_scheduler.timeout * 800
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ---------- Alarm: a Lambda logged an error ----------
# Some failures are logged and the run goes on, so the Errors alarms never see them: a message
# that isn't a report request, a status that couldn't be saved, a user the scheduler skipped,
# the AI metrics not published, a day the daily review couldn't read. Every console.error line has the level ERROR in the log. A
# thrown error is logged too, so it emails here as well as from its Errors alarm.
resource "aws_cloudwatch_log_metric_filter" "lambda_logged_errors" {
  for_each = {
    worker    = aws_cloudwatch_log_group.ai_worker_logs.name
    scheduler = aws_cloudwatch_log_group.report_scheduler_logs.name
    audit     = aws_cloudwatch_log_group.ronnie_audit_logs.name
    reminders = aws_cloudwatch_log_group.reminders_logs.name
  }

  name           = "gympro-${each.key}-logged-errors"
  log_group_name = each.value
  pattern        = "ERROR"

  metric_transformation {
    name      = "LoggedErrors"
    namespace = "GymPro/Lambda"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "lambda_logged_errors" {
  alarm_name        = "gympro-lambda-logged-errors"
  alarm_description = "A Lambda wrote an error to its log in the past hour, thrown or not. Search for ERROR in /aws/lambda/gympro-ai-worker, /aws/lambda/gympro-report-scheduler, /aws/lambda/gympro-ronnie-audit and /aws/lambda/gympro-reminders."

  namespace   = "GymPro/Lambda"
  metric_name = "LoggedErrors"

  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ---------- Alarm: the app hit an error ----------
# The website's own failures outside AI calls (a save that failed, a conversation not stored,
# an error no code caught), which only reached Vercel's log before. The app saves each to
# app_errors (lib/app-errors.ts) and the hourly scheduler counts the past hour's. One is enough:
# the owner wants to know of every bug. Warnings (an expired sign-in link) are left out.
resource "aws_cloudwatch_metric_alarm" "app_errors" {
  alarm_name        = "gympro-app-errors"
  alarm_description = "The app hit an error in the past hour. In Supabase: select created_at, source, message, context from app_errors where level = 'error' order by created_at desc limit 20;"

  namespace   = "GymPro/App"
  metric_name = "AppErrorsLastHour"

  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ---------- Alarm: the database is filling up ----------
# Supabase's free plan turns the database read-only at 500 MB, for every user at once. The hourly
# scheduler sends its size (database_size_bytes); this warns at 400 MB, with time to act. Each
# account's rows have a limit (migration 20261027160000), but many accounts together still add up.
resource "aws_cloudwatch_metric_alarm" "database_size" {
  alarm_name        = "gympro-database-size"
  alarm_description = "The database is past 400 MB of the free plan's 500 MB. In Supabase: select relname, pg_size_pretty(pg_total_relation_size(oid)) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by pg_total_relation_size(oid) desc limit 10;"

  namespace   = "GymPro/App"
  metric_name = "DatabaseMB"

  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 400
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}
