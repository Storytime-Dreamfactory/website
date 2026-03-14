data "archive_file" "api_stub_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda_stub"
  output_path = "${path.module}/lambda_stub/api_stub.zip"
}

data "archive_file" "activity_projector_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda_activity_projector"
  output_path = "${path.module}/lambda_activity_projector/activity_projector.zip"
}

data "archive_file" "conversation_projector_zip" {
  type        = "zip"
  source_dir  = "${path.module}/lambda_conversation_projector"
  output_path = "${path.module}/lambda_conversation_projector/conversation_projector.zip"
}

resource "aws_iam_role" "lambda_exec" {
  name = "${local.prefix}-lambda-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "lambda_vpc" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_policy" "lambda_runtime" {
  name = "${local.prefix}-lambda-runtime-policy"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.app_runtime.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["events:PutEvents"]
        Resource = [aws_cloudwatch_event_bus.activities.arn]
      },
      {
        Effect = "Allow"
        Action = ["s3:GetObject"]
        Resource = [
          "${aws_s3_bucket.content.arn}/*",
          "${aws_s3_bucket.assets.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = ["s3:ListBucket"]
        Resource = [
          aws_s3_bucket.content.arn,
          aws_s3_bucket.assets.arn
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [aws_kms_key.app.arn]
      },
      {
        Effect = "Allow"
        Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = [
          aws_sqs_queue.realtime_activity_projection.arn,
          aws_sqs_queue.realtime_conversation_projection.arn
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_runtime" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = aws_iam_policy.lambda_runtime.arn
}

resource "aws_lambda_function" "api_stub" {
  function_name    = "${local.prefix}-api-stub"
  role             = aws_iam_role.lambda_exec.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.api_stub_zip.output_path
  source_code_hash = data.archive_file.api_stub_zip.output_base64sha256
  timeout          = 20
  memory_size      = 256
  vpc_config {
    security_group_ids = [aws_security_group.lambda.id]
    subnet_ids         = [for s in aws_subnet.private : s.id]
  }
  environment {
    variables = {
      RUNTIME_SECRET_ARN = aws_secretsmanager_secret.app_runtime.arn
      CONTENT_BUCKET     = aws_s3_bucket.content.bucket
    }
  }
  tags       = local.tags
  depends_on = [aws_cloudwatch_log_group.lambda_api_stub]
}

resource "aws_lambda_function" "activity_projector" {
  function_name    = "${local.prefix}-activity-projector"
  role             = aws_iam_role.lambda_exec.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.activity_projector_zip.output_path
  source_code_hash = data.archive_file.activity_projector_zip.output_base64sha256
  timeout          = 30
  memory_size      = 256
  vpc_config {
    security_group_ids = [aws_security_group.lambda.id]
    subnet_ids         = [for s in aws_subnet.private : s.id]
  }
  environment {
    variables = {
      RUNTIME_SECRET_ARN = aws_secretsmanager_secret.app_runtime.arn
    }
  }
  tags       = local.tags
  depends_on = [aws_cloudwatch_log_group.lambda_activity_projector]
}

resource "aws_lambda_function" "conversation_projector" {
  function_name    = "${local.prefix}-conversation-projector"
  role             = aws_iam_role.lambda_exec.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.conversation_projector_zip.output_path
  source_code_hash = data.archive_file.conversation_projector_zip.output_base64sha256
  timeout          = 30
  memory_size      = 256
  vpc_config {
    security_group_ids = [aws_security_group.lambda.id]
    subnet_ids         = [for s in aws_subnet.private : s.id]
  }
  environment {
    variables = {
      RUNTIME_SECRET_ARN = aws_secretsmanager_secret.app_runtime.arn
    }
  }
  tags       = local.tags
  depends_on = [aws_cloudwatch_log_group.lambda_conversation_projector]
}

resource "aws_lambda_event_source_mapping" "activity_projector_from_sqs" {
  event_source_arn = aws_sqs_queue.realtime_activity_projection.arn
  function_name    = aws_lambda_function.activity_projector.arn
  batch_size       = 10
  enabled          = true
}

resource "aws_lambda_event_source_mapping" "conversation_projector_from_sqs" {
  event_source_arn = aws_sqs_queue.realtime_conversation_projection.arn
  function_name    = aws_lambda_function.conversation_projector.arn
  batch_size       = 10
  enabled          = true
}
