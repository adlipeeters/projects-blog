output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.this.id
}

output "vpc_cidr" {
  description = "VPC CIDR"
  value       = aws_vpc.this.cidr_block
}

output "private_subnet_ids" {
  description = "Private subnets, in AZ order"
  value       = [for az in var.azs : aws_subnet.private[az].id]
}

output "public_subnet_ids" {
  description = "Public subnets, in AZ order"
  value       = [for az in var.azs : aws_subnet.public[az].id]
}

output "app_sg_id" {
  description = "Security group for API tasks and Lambdas"
  value       = aws_security_group.app.id
}

output "search_sg_id" {
  description = "Security group for the OpenSearch domain"
  value       = aws_security_group.search.id
}
