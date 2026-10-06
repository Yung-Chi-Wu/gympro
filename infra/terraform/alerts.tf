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
resource "aws_cloudwatch_metric_alarm" "ai_analysis_dlq_not_empty" {
  alarm_name        = "gympro-ai-analysis-dlq-not-empty"
  alarm_description = "A report request failed 3 times and was moved to gympro-ai-analysis-dlq."

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
