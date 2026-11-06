# The user pool is the tenant boundary (spec section 4). Two details carry the security:
#
# - No client lists custom:tenant_id in write_attributes. A client with no list can write every
#   attribute, and then any user could move themselves to another company.
# - The pre token trigger copies the tenant into the access token. Customizing access tokens needs
#   the V2_0 event, and that needs the Essentials plan.

locals {
  groups = toset(["all-staff", "engineering", "hr", "finance", "legal", "tenant-admin"])

  # The email scope needs both, or the token endpoint answers invalid_grant with no other hint.
  readable_attributes = ["email", "email_verified"]
  writable_attributes = ["email"]
}

data "archive_file" "pre_token" {
  type        = "zip"
  source_file = "${path.module}/../../../functions/pre_token/pre_token.py"
  output_path = "${path.module}/../../../build/pre_token.zip"
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "pre_token" {
  name               = "${var.name_prefix}-pre-token"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "pre_token_logs" {
  role       = aws_iam_role.pre_token.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "pre_token" {
  name              = "/aws/lambda/${var.name_prefix}-pre-token"
  retention_in_days = 14
}

resource "aws_lambda_function" "pre_token" {
  function_name    = "${var.name_prefix}-pre-token"
  role             = aws_iam_role.pre_token.arn
  runtime          = "python3.13"
  architectures    = ["arm64"]
  handler          = "pre_token.handler"
  filename         = data.archive_file.pre_token.output_path
  source_code_hash = data.archive_file.pre_token.output_base64sha256
  timeout          = 5

  depends_on = [aws_cloudwatch_log_group.pre_token]
}

resource "aws_lambda_permission" "pre_token" {
  statement_id  = "AllowCognito"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.pre_token.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.this.arn
}

resource "aws_cognito_user_pool" "this" {
  name                = var.name_prefix
  user_pool_tier      = "ESSENTIALS"
  deletion_protection = "INACTIVE"

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  password_policy {
    minimum_length                   = 16
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 1
  }

  schema {
    name                = "tenant_id"
    attribute_data_type = "String"
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 64
    }
  }

  lambda_config {
    pre_token_generation_config {
      lambda_arn     = aws_lambda_function.pre_token.arn
      lambda_version = "V2_0"
    }
  }
}

resource "aws_cognito_user_group" "this" {
  for_each = local.groups

  name         = each.key
  user_pool_id = aws_cognito_user_pool.this.id
}

resource "random_id" "domain" {
  byte_length = 4
}

resource "aws_cognito_user_pool_domain" "this" {
  domain       = "${var.name_prefix}-${random_id.domain.hex}"
  user_pool_id = aws_cognito_user_pool.this.id
}

# The browser: authorization code with PKCE, no secret.
resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.name_prefix}-web"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  callback_urls                        = var.callback_urls
  logout_urls                          = var.callback_urls
  supported_identity_providers         = ["COGNITO"]
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  read_attributes                      = local.readable_attributes
  write_attributes                     = local.writable_attributes
}

# The test scripts: logging in through this client needs the caller's AWS credentials.
resource "aws_cognito_user_pool_client" "eval" {
  name         = "${var.name_prefix}-eval"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret               = false
  explicit_auth_flows           = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_ADMIN_USER_PASSWORD_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  read_attributes               = local.readable_attributes
  write_attributes              = local.writable_attributes
}
