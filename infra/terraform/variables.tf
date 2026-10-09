variable "supabase_url" {
  description = "The Supabase project URL"
  type        = string
}

variable "alert_email" {
  description = "Email address that receives CloudWatch alarm and AWS budget notifications"
  type        = string
}

variable "monthly_budget_usd" {
  description = "Monthly AWS spend (USD) the budget alerts are measured against"
  type        = number
  default     = 5
}

variable "vercel_team_slug" {
  description = "Vercel team slug — the first path segment of vercel.com/<team>/<project>"
  type        = string
}

variable "vercel_project_name" {
  description = "Vercel project name — the second path segment of vercel.com/<team>/<project>"
  type        = string
}

variable "vercel_environments" {
  description = "Vercel environments allowed to assume the Next.js role (production, preview, development)"
  type        = list(string)
  default     = ["production"]
}

variable "ai_errors_per_hour_alarm" {
  description = "Failed AI calls in one hour that raise the gympro-ai-errors alarm"
  type        = number
  default     = 3
}

variable "ai_daily_cost_alarm_usd" {
  description = "US$ of AI calls over 24 hours above which the gympro-ai-daily-cost alarm fires"
  type        = number
  default     = 2
}
