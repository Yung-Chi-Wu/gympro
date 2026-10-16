# ---------- Main queue: AI analysis tasks are queued here ----------
resource "aws_sqs_queue" "ai_analysis_queue" {
  name = "gympro-ai-analysis-queue"

  # Once a worker picks up a message, other workers won't see it
  # again for this many seconds, preventing duplicate processing.
  # AWS recommends at least 6x the Lambda timeout (120s) so a slow
  # invocation isn't retried while it's still running.
  visibility_timeout_seconds = 720

  # Encrypted at rest with an SQS-owned key. A request is a user ID, a date and a
  # time, about 120 bytes; 8 KB leaves room and refuses anything far larger.
  sqs_managed_sse_enabled = true
  max_message_size        = 8192

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

  # The same encryption and size as the main queue, whose messages it takes
  sqs_managed_sse_enabled = true
  max_message_size        = 8192

  tags = {
    Project     = "gympro"
    Environment = "production"
  }
}

# ---------- Both queues: TLS only ----------
# The roles' policies say who may use the queues; this refuses any request over plain HTTP
data "aws_iam_policy_document" "sqs_tls_only" {
  for_each = {
    main = aws_sqs_queue.ai_analysis_queue.arn
    dlq  = aws_sqs_queue.ai_analysis_dlq.arn
  }

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["sqs:*"]
    resources = [each.value]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_sqs_queue_policy" "ai_analysis_queue_tls_only" {
  queue_url = aws_sqs_queue.ai_analysis_queue.id
  policy    = data.aws_iam_policy_document.sqs_tls_only["main"].json
}

resource "aws_sqs_queue_policy" "ai_analysis_dlq_tls_only" {
  queue_url = aws_sqs_queue.ai_analysis_dlq.id
  policy    = data.aws_iam_policy_document.sqs_tls_only["dlq"].json
}
