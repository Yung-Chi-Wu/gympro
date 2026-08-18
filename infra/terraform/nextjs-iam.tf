# ---------- Dedicated IAM user for the Next.js app to send SQS messages ----------
# This runs on Vercel (outside AWS), so it needs its own credentials —
# it cannot inherit permissions from an IAM role the way Lambda does.
resource "aws_iam_user" "nextjs_sqs_sender" {
  name = "gympro-nextjs-sqs-sender"
}

resource "aws_iam_access_key" "nextjs_sqs_sender" {
  user = aws_iam_user.nextjs_sqs_sender.name
}

data "aws_iam_policy_document" "nextjs_sqs_send_only" {
  statement {
    effect = "Allow"
    actions = [
      "sqs:SendMessage",
    ]
    resources = [aws_sqs_queue.ai_analysis_queue.arn]
  }
}

resource "aws_iam_user_policy" "nextjs_sqs_send_only" {
  name   = "gympro-nextjs-sqs-send-only"
  user   = aws_iam_user.nextjs_sqs_sender.name
  policy = data.aws_iam_policy_document.nextjs_sqs_send_only.json
}

# Outputs so we can retrieve the access key values after apply.
output "nextjs_sqs_sender_access_key_id" {
  value     = aws_iam_access_key.nextjs_sqs_sender.id
  sensitive = true
}

output "nextjs_sqs_sender_secret_access_key" {
  value     = aws_iam_access_key.nextjs_sqs_sender.secret
  sensitive = true
}