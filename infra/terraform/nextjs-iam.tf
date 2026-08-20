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

  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.report_pdfs.arn}/*"]
  }
}


resource "aws_iam_user_policy" "nextjs_sqs_send_only" {
  name   = "gympro-nextjs-sqs-send-only"
  user   = aws_iam_user.nextjs_sqs_sender.name
  policy = data.aws_iam_policy_document.nextjs_sqs_send_only.json
}

output "nextjs_sqs_sender_access_key_id" {
  value     = aws_iam_access_key.nextjs_sqs_sender.id
  sensitive = true
}

output "nextjs_sqs_sender_secret_access_key" {
  value     = aws_iam_access_key.nextjs_sqs_sender.secret
  sensitive = true
}