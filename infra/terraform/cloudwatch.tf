# ---------- Where the Lambda's console.log output actually goes ----------
resource "aws_cloudwatch_log_group" "ai_worker_logs" {
  name              = "/aws/lambda/gympro-ai-worker"
  retention_in_days = 14

  tags = {
    Project = "gympro"
  }
}