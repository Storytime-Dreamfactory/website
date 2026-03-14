resource "aws_secretsmanager_secret" "app_runtime" {
  name        = "${local.prefix}/runtime"
  description = "Storytime Runtime Secrets und Konfiguration"
  kms_key_id  = aws_kms_key.app.arn
  tags        = local.tags
}

locals {
  database_url = "postgres://${var.db_username}:${random_password.db_password.result}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${var.db_name}"
}

resource "aws_secretsmanager_secret_version" "app_runtime" {
  secret_id = aws_secretsmanager_secret.app_runtime.id
  secret_string = jsonencode({
    DATABASE_URL          = local.database_url
    AWS_REGION            = var.aws_region
    OPENAI_API_KEY        = var.openai_api_key
    BFL_API_KEY           = var.bfl_api_key
    GOOGLE_GEMINI_API_KEY = var.google_gemini_api_key

    ACTIVITY_EVENTBRIDGE_ENABLED            = "true"
    ACTIVITY_EVENTBRIDGE_BUS_NAME           = aws_cloudwatch_event_bus.activities.name
    ACTIVITY_EVENTBRIDGE_SOURCE             = "storytime.activities"
    ACTIVITY_EVENTBRIDGE_DETAIL_TYPE_PREFIX = "storytime.activity"
    ACTIVITY_EVENTBRIDGE_STRICT             = "false"

    REALTIME_EVENTBRIDGE_ENABLED            = "true"
    REALTIME_EVENTBRIDGE_BUS_NAME           = aws_cloudwatch_event_bus.activities.name
    REALTIME_EVENTBRIDGE_SOURCE             = "storytime.realtime"
    REALTIME_EVENTBRIDGE_DETAIL_TYPE_PREFIX = "storytime.voice"
    REALTIME_EVENTBRIDGE_STRICT             = "true"
  })
  lifecycle {
    ignore_changes = [secret_string]
  }
}
