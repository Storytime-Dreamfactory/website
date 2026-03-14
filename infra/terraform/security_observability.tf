resource "aws_kms_key" "app" {
  description         = "${local.prefix} app encryption key"
  enable_key_rotation = true
  tags                = local.tags
}

resource "aws_kms_alias" "app" {
  name          = "alias/${local.prefix}-app"
  target_key_id = aws_kms_key.app.key_id
}

resource "aws_cloudwatch_log_group" "lambda_api_stub" {
  name              = "/aws/lambda/${local.prefix}-api-stub"
  retention_in_days = var.lambda_log_retention_days
  tags              = local.tags
}

resource "aws_cloudwatch_log_group" "lambda_activity_projector" {
  name              = "/aws/lambda/${local.prefix}-activity-projector"
  retention_in_days = var.lambda_log_retention_days
  tags              = local.tags
}

resource "aws_cloudwatch_log_group" "apigw_http_access" {
  name              = "/aws/apigateway/${local.prefix}-http-access"
  retention_in_days = var.apigw_log_retention_days
  tags              = local.tags
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "${local.prefix}-lambda-errors"
  alarm_description   = "Alarmiert bei Lambda Errors > 0"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions = {
    FunctionName = aws_lambda_function.api_stub.function_name
  }
  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "lambda_activity_projector_errors" {
  alarm_name          = "${local.prefix}-lambda-activity-projector-errors"
  alarm_description   = "Alarmiert bei Activity-Projector Lambda Errors > 0"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions = {
    FunctionName = aws_lambda_function.activity_projector.function_name
  }
  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "apigw_5xx" {
  alarm_name          = "${local.prefix}-apigw-5xx"
  alarm_description   = "Alarmiert bei API Gateway 5XX Errors > 0"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions = {
    ApiId = aws_apigatewayv2_api.http.id
  }
  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "realtime_activity_projection_dlq_visible" {
  alarm_name          = "${local.prefix}-realtime-activity-projection-dlq-visible"
  alarm_description   = "Alarmiert bei sichtbaren Messages in der Realtime-Projektions-DLQ."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions = {
    QueueName = aws_sqs_queue.realtime_activity_projection_dlq.name
  }
  tags = local.tags
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  alarm_name          = "${local.prefix}-rds-cpu-high"
  alarm_description   = "Alarmiert bei hoher RDS CPU."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }
  tags = local.tags
}

locals {
  enable_github_deploy_role = var.github_oidc_provider_arn != "" && var.github_repository != ""
}

resource "aws_iam_role" "github_deploy" {
  count = local.enable_github_deploy_role ? 1 : 0
  name  = "${local.prefix}-github-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = var.github_oidc_provider_arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:*"
          }
        }
      }
    ]
  })
  tags = local.tags
}

resource "aws_iam_role_policy" "github_deploy_policy" {
  count = local.enable_github_deploy_role ? 1 : 0
  name  = "${local.prefix}-github-deploy-policy"
  role  = aws_iam_role.github_deploy[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "cloudformation:*",
          "ec2:*",
          "rds:*",
          "lambda:*",
          "apigateway:*",
          "apigatewayv2:*",
          "events:*",
          "secretsmanager:*",
          "s3:*",
          "cloudfront:*",
          "iam:PassRole",
          "iam:GetRole",
          "iam:CreateRole",
          "iam:AttachRolePolicy",
          "iam:PutRolePolicy",
          "iam:DetachRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:DeleteRole",
          "logs:*",
          "dynamodb:*",
          "kms:*"
        ]
        Resource = "*"
      }
    ]
  })
}
