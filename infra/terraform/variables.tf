variable "project" {
  description = "Projektname fuer Tags/Resourcenamen."
  type        = string
  default     = "storytime"
}

variable "environment" {
  description = "Deployment-Umgebung, z. B. dev/staging/prod."
  type        = string
  default     = "prod"
}

variable "aws_region" {
  description = "AWS Region."
  type        = string
  default     = "eu-central-1"
}

variable "vpc_cidr" {
  description = "CIDR fuer die Haupt-VPC."
  type        = string
  default     = "10.40.0.0/16"
}

variable "availability_zones" {
  description = "Verfuegbare AZs fuer Subnets."
  type        = list(string)
  default     = ["eu-central-1a", "eu-central-1b"]
}

variable "db_instance_class" {
  description = "RDS Instanzklasse."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "RDS Storage in GB."
  type        = number
  default     = 50
}

variable "db_max_allocated_storage" {
  description = "Autoscaling Obergrenze fuer Storage in GB."
  type        = number
  default     = 200
}

variable "db_name" {
  description = "Name der App-Datenbank."
  type        = string
  default     = "storytime"
}

variable "db_username" {
  description = "Master Username fuer RDS."
  type        = string
  default     = "storytime_app"
}

variable "db_engine_version" {
  description = "Postgres Engine Version."
  type        = string
  default     = "16.13"
}

variable "api_domain_name" {
  description = "Optionaler Custom Domain Name fuer API Gateway."
  type        = string
  default     = ""
}

variable "api_acm_certificate_arn" {
  description = "Optionales ACM-Zertifikat fuer API Domain."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Optional: Route53 Zone ID fuer API Alias Record."
  type        = string
  default     = ""
}

variable "content_cdn_domain_alias" {
  description = "Optionaler Alias fuer CloudFront, z. B. content.example.com."
  type        = string
  default     = ""
}

variable "content_cdn_certificate_arn" {
  description = "Optionales ACM-Zertifikat (us-east-1) fuer CloudFront Alias."
  type        = string
  default     = ""
}

variable "openai_api_key" {
  description = "Optionaler Initialwert fuer OPENAI_API_KEY Secret."
  type        = string
  default     = ""
  sensitive   = true
}

variable "bfl_api_key" {
  description = "Optionaler Initialwert fuer BFL_API_KEY Secret."
  type        = string
  default     = ""
  sensitive   = true
}

variable "google_gemini_api_key" {
  description = "Optionaler Initialwert fuer GOOGLE_GEMINI_API_KEY Secret."
  type        = string
  default     = ""
  sensitive   = true
}

variable "lambda_log_retention_days" {
  description = "Aufbewahrungstage fuer CloudWatch Lambda Logs."
  type        = number
  default     = 30
}

variable "apigw_log_retention_days" {
  description = "Aufbewahrungstage fuer API Gateway Access Logs."
  type        = number
  default     = 30
}

variable "github_oidc_provider_arn" {
  description = "Optionales OIDC Provider ARN fuer GitHub Actions Deploy Role."
  type        = string
  default     = ""
}

variable "github_repository" {
  description = "Optionales GitHub Repo fuer OIDC Bindung (owner/repo)."
  type        = string
  default     = ""
}
