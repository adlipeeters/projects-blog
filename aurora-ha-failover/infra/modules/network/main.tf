# One VPC, three tiers of subnets across three AZs (spec section 3):
#
#   public    10.40.0.0/24,  .1, .2     ALB and the NAT gateway
#   app       10.40.10.0/24, .11, .12   ECS tasks
#   db        10.40.20.0/24, .21, .22   Aurora instances and RDS Proxy
#
# One NAT gateway, in the first AZ. It is a shortcut (spec section 11): losing that AZ would
# cut the tasks' outbound path, and AZ loss is not one of the scenarios.

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

resource "aws_subnet" "app" {
  for_each = local.az_index

  vpc_id            = aws_vpc.this.id
  availability_zone = each.key
  cidr_block        = cidrsubnet(var.cidr_block, 8, 10 + each.value)

  tags = { Name = "${var.name_prefix}-app-${substr(each.key, -1, 1)}" }
}

resource "aws_subnet" "db" {
  for_each = local.az_index

  vpc_id            = aws_vpc.this.id
  availability_zone = each.key
  cidr_block        = cidrsubnet(var.cidr_block, 8, 20 + each.value)

  tags = { Name = "${var.name_prefix}-db-${substr(each.key, -1, 1)}" }
}

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "${var.name_prefix}-nat" }
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

# The tasks pull their image from ECR and read the secret from Secrets Manager through the NAT
# gateway. Interface endpoints would avoid it, but four of them cost more per hour than the NAT
# for a one-day test.
resource "aws_route_table" "app" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this.id
  }

  tags = { Name = "${var.name_prefix}-app" }
}

resource "aws_route_table_association" "app" {
  for_each = aws_subnet.app

  subnet_id      = each.value.id
  route_table_id = aws_route_table.app.id
}

# No route out of the DB tier at all.
resource "aws_route_table" "db" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.name_prefix}-db" }
}

resource "aws_route_table_association" "db" {
  for_each = aws_subnet.db

  subnet_id      = each.value.id
  route_table_id = aws_route_table.db.id
}

# The tasks' security group lives here, not in the ECS module, so the Aurora module can admit it
# before any task exists.
resource "aws_security_group" "app" {
  name        = "${var.name_prefix}-app"
  description = "ECS tasks: web and prober"
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${var.name_prefix}-app" }
}

resource "aws_vpc_security_group_egress_rule" "app_all" {
  security_group_id = aws_security_group.app.id
  description       = "ECR, Secrets Manager, RDS API and the database"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}
