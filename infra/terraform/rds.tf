resource "random_password" "db_password" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = "${local.prefix}-db-subnets"
  subnet_ids = [for s in aws_subnet.private : s.id]
  tags       = local.tags
}

resource "aws_db_parameter_group" "main" {
  name   = "${local.prefix}-postgres16"
  family = "postgres16"
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }
  tags = local.tags
}

resource "aws_db_instance" "main" {
  identifier                   = "${local.prefix}-postgres"
  engine                       = "postgres"
  engine_version               = var.db_engine_version
  instance_class               = var.db_instance_class
  allocated_storage            = var.db_allocated_storage
  max_allocated_storage        = var.db_max_allocated_storage
  db_name                      = var.db_name
  username                     = var.db_username
  password                     = random_password.db_password.result
  db_subnet_group_name         = aws_db_subnet_group.main.name
  vpc_security_group_ids       = [aws_security_group.rds.id]
  parameter_group_name         = aws_db_parameter_group.main.name
  backup_retention_period      = 14
  delete_automated_backups     = true
  auto_minor_version_upgrade   = true
  publicly_accessible          = false
  storage_encrypted            = true
  kms_key_id                   = aws_kms_key.app.arn
  skip_final_snapshot          = false
  final_snapshot_identifier    = "${local.prefix}-postgres-final-snapshot"
  performance_insights_enabled = true
  tags                         = local.tags
}
