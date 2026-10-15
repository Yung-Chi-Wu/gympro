# ---------- Where the Lambda's console.log output actually goes ----------
resource "aws_cloudwatch_log_group" "ai_worker_logs" {
  name = "/aws/lambda/gympro-ai-worker"
  # Longer than a message stays in the DLQ (14 days), so its logs are still there when it's looked at
  retention_in_days = 30

  tags = {
    Project = "gympro"
  }
}