# ---------- Package the compiled Lambda code into a zip ----------
data "archive_file" "ai_worker_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../../lambda/ai-worker/dist"
  output_path = "${path.module}/../../lambda/ai-worker/dist.zip"
}

# ---------- The Lambda function itself ----------
resource "aws_lambda_function" "ai_worker" {
  function_name = "gympro-ai-worker"
  role          = aws_iam_role.ai_worker_lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"

  filename         = data.archive_file.ai_worker_zip.output_path
  source_code_hash = data.archive_file.ai_worker_zip.output_base64sha256

  timeout     = 60
  memory_size = 256

  environment {
    variables = {
      SUPABASE_URL          = var.supabase_url
      ANTHROPIC_SECRET_NAME = "gympro/anthropic-api-key"
      PDF_QUEUE_URL         = aws_sqs_queue.pdf_generation_queue.id
    }
  }

  depends_on = [aws_cloudwatch_log_group.ai_worker_logs]
}

# ---------- Connect the SQS queue to the Lambda: this is what
# ---------- actually triggers the function when a message arrives ----------
resource "aws_lambda_event_source_mapping" "sqs_trigger" {
  event_source_arn = aws_sqs_queue.ai_analysis_queue.arn
  function_name    = aws_lambda_function.ai_worker.arn
  batch_size       = 1
}