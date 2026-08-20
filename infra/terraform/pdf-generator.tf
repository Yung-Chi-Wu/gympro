# ---------- SQS queue for PDF generation requests ----------
resource "aws_sqs_queue" "pdf_generation_queue" {
  name                       = "gympro-pdf-generation-queue"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 86400

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.pdf_generation_dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    Project = "gympro"
  }
}

resource "aws_sqs_queue" "pdf_generation_dlq" {
  name                      = "gympro-pdf-generation-dlq"
  message_retention_seconds = 1209600

  tags = {
    Project = "gympro"
  }
}

# ---------- Package the compiled Lambda code ----------
data "archive_file" "pdf_generator_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../../lambda/pdf-generator/dist"
  output_path = "${path.module}/../../lambda/pdf-generator/dist.zip"
}

# ---------- Log group ----------
resource "aws_cloudwatch_log_group" "pdf_generator_logs" {
  name              = "/aws/lambda/gympro-pdf-generator"
  retention_in_days = 14

  tags = {
    Project = "gympro"
  }
}

# ---------- IAM role the pdf-generator Lambda runs as ----------
resource "aws_iam_role" "pdf_generator_lambda_role" {
  name               = "gympro-pdf-generator-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "pdf_generator_permissions" {
  statement {
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.pdf_generation_queue.arn]
  }

  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
    ]
    resources = [aws_secretsmanager_secret.supabase_service_role_key.arn]
  }

  statement {
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.report_pdfs.arn}/*"]
  }

  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:aws:logs:*:*:*"]
  }
}

resource "aws_iam_role_policy" "pdf_generator_permissions" {
  name   = "gympro-pdf-generator-permissions"
  role   = aws_iam_role.pdf_generator_lambda_role.id
  policy = data.aws_iam_policy_document.pdf_generator_permissions.json
}

# ---------- The Lambda itself ----------
resource "aws_lambda_function" "pdf_generator" {
  function_name = "gympro-pdf-generator"
  role          = aws_iam_role.pdf_generator_lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"

  filename         = data.archive_file.pdf_generator_zip.output_path
  source_code_hash = data.archive_file.pdf_generator_zip.output_base64sha256

  timeout     = 30
  memory_size = 256

  environment {
    variables = {
      SUPABASE_URL    = var.supabase_url
      PDF_BUCKET_NAME = aws_s3_bucket.report_pdfs.bucket
    }
  }

  depends_on = [aws_cloudwatch_log_group.pdf_generator_logs]
}

resource "aws_lambda_event_source_mapping" "pdf_generator_sqs_trigger" {
  event_source_arn = aws_sqs_queue.pdf_generation_queue.arn
  function_name    = aws_lambda_function.pdf_generator.arn
  batch_size       = 1
}