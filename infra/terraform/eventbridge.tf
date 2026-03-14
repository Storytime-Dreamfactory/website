resource "aws_cloudwatch_event_bus" "activities" {
  name = "${local.prefix}-activity-bus"
  tags = local.tags
}

resource "aws_sqs_queue" "realtime_activity_projection_dlq" {
  name                      = "${local.prefix}-realtime-activity-projection-dlq"
  message_retention_seconds = 1209600
  tags                      = local.tags
}

resource "aws_sqs_queue" "realtime_activity_projection" {
  name                       = "${local.prefix}-realtime-activity-projection"
  visibility_timeout_seconds = 120
  message_retention_seconds  = 345600
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.realtime_activity_projection_dlq.arn
    maxReceiveCount     = 5
  })
  tags = local.tags
}

resource "aws_cloudwatch_event_rule" "realtime_activity_projection" {
  name           = "${local.prefix}-realtime-activity-projection"
  description    = "Leitet Realtime-Voice-Events an den Activity-Projektor."
  event_bus_name = aws_cloudwatch_event_bus.activities.name
  event_pattern = jsonencode({
    source = ["storytime.realtime"]
    detail = {
      schemaVersion = ["1.0"]
      eventType = [
        "voice.session.requested",
        "voice.instructions.updated",
        "voice.user.transcript.received",
        "voice.assistant.transcript.received",
        "voice.session.ended",
        "voice.session.failed"
      ]
    }
  })
}

resource "aws_cloudwatch_event_target" "realtime_activity_projection" {
  rule           = aws_cloudwatch_event_rule.realtime_activity_projection.name
  event_bus_name = aws_cloudwatch_event_bus.activities.name
  target_id      = "realtime-activity-projection-queue"
  arn            = aws_sqs_queue.realtime_activity_projection.arn
}

resource "aws_sqs_queue_policy" "realtime_activity_projection" {
  queue_url = aws_sqs_queue.realtime_activity_projection.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowEventBridgeSendMessage"
        Effect    = "Allow"
        Principal = { Service = "events.amazonaws.com" }
        Action    = "sqs:SendMessage"
        Resource  = aws_sqs_queue.realtime_activity_projection.arn
        Condition = {
          ArnEquals = {
            "aws:SourceArn" = aws_cloudwatch_event_rule.realtime_activity_projection.arn
          }
        }
      }
    ]
  })
}
