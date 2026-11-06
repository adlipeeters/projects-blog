# One VPC, two tiers across two AZs (spec section 3):
#
#   public    10.50.0.0/24, .1      the NAT gateway
#   private   10.50.10.0/24, .11    API tasks, Lambdas, ALB, OpenSearch
#
# Document text reaches Bedrock through interface endpoints, and S3 and DynamoDB through gateway
# endpoints, so it stays off the NAT path. One NAT gateway is a listed shortcut (spec section 13).

locals {
  az_index = { for i, az in var.azs : az => i }
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr_block
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = var.name_prefix }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = var.name_prefix }
}

resource "aws_subnet" "public" {
  for_each = local.az_index

  vpc_id                  = aws_vpc.this.id
  availability_zone       = each.key
  cidr_block              = cidrsubnet(var.cidr_block, 8, each.value)
  map_public_ip_on_launch = false

  tags = { Name = "${var.name_prefix}-public-${substr(each.key, -1, 1)}" }
}

resource "aws_subnet" "private" {
  for_each = local.az_index

  vpc_id            = aws_vpc.this.id
  availability_zone = each.key
  cidr_block        = cidrsubnet(var.cidr_block, 8, 10 + each.value)

  tags = { Name = "${var.name_prefix}-private-${substr(each.key, -1, 1)}" }
}

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = var.name_prefix }
}

resource "aws_nat_gateway" "this" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[var.azs[0]].id

  tags       = { Name = var.name_prefix }
  depends_on = [aws_internet_gateway.this]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = { Name = "${var.name_prefix}-public" }
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this.id
  }

  tags = { Name = "${var.name_prefix}-private" }
}

resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}

# Shared by the API tasks and the Lambdas. Everything private admits this group and nothing else.
resource "aws_security_group" "app" {
  name        = "${var.name_prefix}-app"
  description = "API tasks and Lambdas"
  vpc_id      = aws_vpc.this.id

  egress {
    description = "Outbound to endpoints, OpenSearch and the NAT gateway"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "search" {
  name        = "${var.name_prefix}-search"
  description = "OpenSearch domain"
  vpc_id      = aws_vpc.this.id

  ingress {
    description     = "HTTPS from the app"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
}

resource "aws_security_group" "endpoints" {
  name        = "${var.name_prefix}-endpoints"
  description = "Bedrock interface endpoints"
  vpc_id      = aws_vpc.this.id

  ingress {
    description     = "HTTPS from the app"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
}

resource "aws_vpc_endpoint" "gateway" {
  for_each = toset(["s3", "dynamodb"])

  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${var.region}.${each.key}"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]

  tags = { Name = "${var.name_prefix}-${each.key}" }
}

# bedrock-runtime carries embeddings and answers, bedrock-agent-runtime carries Rerank.
resource "aws_vpc_endpoint" "bedrock" {
  for_each = toset(["bedrock-runtime", "bedrock-agent-runtime"])

  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${var.region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = [for subnet in aws_subnet.private : subnet.id]
  security_group_ids  = [aws_security_group.endpoints.id]

  tags = { Name = "${var.name_prefix}-${each.key}" }
}
