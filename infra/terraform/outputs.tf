output "api_base_url" {
  description = "Basis-URL des HTTP APIs."
  value       = aws_apigatewayv2_api.http.api_endpoint
}

output "api_custom_domain" {
  description = "Custom Domain (falls konfiguriert)."
  value       = local.use_custom_api_domain ? var.api_domain_name : null
}

output "websocket_api_url" {
  description = "WebSocket Endpoint fuer Activity Streaming."
  value       = aws_apigatewayv2_stage.websocket_default.invoke_url
}

output "rds_endpoint" {
  description = "RDS Endpoint Hostname."
  value       = aws_db_instance.main.address
}

output "rds_port" {
  description = "RDS Port."
  value       = aws_db_instance.main.port
}

output "runtime_secret_arn" {
  description = "Secrets Manager ARN fuer Runtime-Config."
  value       = aws_secretsmanager_secret.app_runtime.arn
}

output "eventbridge_bus_name" {
  description = "Name des Activity Event Busses."
  value       = aws_cloudwatch_event_bus.activities.name
}

output "realtime_activity_projection_queue_name" {
  description = "SQS Queue Name fuer Realtime -> Activity Projektion."
  value       = aws_sqs_queue.realtime_activity_projection.name
}

output "realtime_activity_projection_dlq_name" {
  description = "SQS DLQ Name fuer Realtime -> Activity Projektion."
  value       = aws_sqs_queue.realtime_activity_projection_dlq.name
}

output "content_bucket" {
  description = "S3 Bucket fuer Content."
  value       = aws_s3_bucket.content.bucket
}

output "assets_bucket" {
  description = "S3 Bucket fuer Assets."
  value       = aws_s3_bucket.assets.bucket
}

output "content_cdn_domain" {
  description = "CloudFront Domain fuer Content/Assets."
  value       = aws_cloudfront_distribution.content.domain_name
}

output "github_deploy_role_arn" {
  description = "Optionales GitHub OIDC Deploy Role ARN."
  value       = local.enable_github_deploy_role ? aws_iam_role.github_deploy[0].arn : null
}
