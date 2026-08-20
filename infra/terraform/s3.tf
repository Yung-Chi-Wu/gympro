# ---------- Private bucket storing generated report PDFs ----------
resource "aws_s3_bucket" "report_pdfs" {
  bucket = "gympro-report-pdfs"

  tags = {
    Project = "gympro"
  }
}

resource "aws_s3_bucket_public_access_block" "report_pdfs" {
  bucket = aws_s3_bucket.report_pdfs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}