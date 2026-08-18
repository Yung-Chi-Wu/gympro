# ---------- Main queue: AI analysis tasks are queued here ----------
resource "aws_sqs_queue" "ai_analysis_queue" {
  name = "gympro-ai-analysis-queue"

  # Once a worker picks up a message, other workers won't see it
  # again for this many seconds, preventing duplicate processing.
  visibility_timeout_seconds = 120

  # Messages older than this are automatically discarded
  # to avoid unbounded buildup of stale tasks.
  message_retention_seconds = 86400 # 24 hours

  # After a message fails this many times, redirect it to the
  # dead letter queue instead of retrying forever.
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.ai_analysis_dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    Project     = "gympro"
    Environment = "production"
  }
}

# ---------- Dead Letter Queue: final destination for failed messages ----------
resource "aws_sqs_queue" "ai_analysis_dlq" {
  name = "gympro-ai-analysis-dlq"

  # Retained longer so there's time to investigate why messages
  # keep failing before they disappear.
  message_retention_seconds = 1209600 # 14 days

  tags = {
    Project     = "gympro"
    Environment = "production"
  }
}