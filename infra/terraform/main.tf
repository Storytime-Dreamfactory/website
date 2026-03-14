locals {
  prefix = "${var.project}-${var.environment}"
  tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  api_routes = [
    "GET /api/activities",
    "POST /api/activities",
    "GET /api/activities/stream",
    "GET /api/conversations",
    "GET /api/conversations/characters-with-conversations",
    "GET /api/conversations/latest",
    "POST /api/conversations/start",
    "POST /api/conversations/metadata",
    "POST /api/conversations/message",
    "POST /api/conversations/end",
    "GET /api/conversations/latest-inspect",
    "GET /api/conversations/inspect",
    "GET /api/relationships",
    "GET /api/relationships/all",
    "GET /api/relationships/by-object",
    "GET /api/relationships/knowledge",
    "POST /api/relationships",
    "GET /api/game-objects",
    "GET /api/game-objects/{id}",
    "GET /api/game-objects/{id}/relationships",
    "GET /api/game-objects/{id}/images",
    "GET /api/gameobjects",
    "GET /api/gameobjects/{id}",
    "GET /api/gameobjects/{id}/relationships",
    "GET /api/gameobjects/{id}/images",
    "POST /api/tools/generate-conversation-hero",
    "POST /api/tools/run-learning-goal-quiz",
    "POST /api/tools/show-image",
    "POST /api/tools/display-existing-image",
    "POST /api/images/generate",
    "POST /api/realtime/session",
    "POST /api/realtime/instructions",
    "POST /api/realtime/events",
    "GET /health",
    "GET /ready"
  ]
}
