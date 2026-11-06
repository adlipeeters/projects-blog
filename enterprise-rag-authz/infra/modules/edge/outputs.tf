output "url" {
  description = "The app's HTTPS URL"
  value       = "https://${aws_cloudfront_distribution.this.domain_name}"
}

output "web_bucket_name" {
  description = "Bucket for the built React app"
  value       = aws_s3_bucket.web.id
}

output "distribution_id" {
  description = "CloudFront distribution ID"
  value       = aws_cloudfront_distribution.this.id
}
