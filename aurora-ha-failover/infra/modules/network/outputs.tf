output "vpc_id" {
  value = aws_vpc.this.id
}

output "public_subnet_ids" {
  value = [for az in var.azs : aws_subnet.public[az].id]
}

output "app_subnet_ids" {
  value = [for az in var.azs : aws_subnet.app[az].id]
}

output "db_subnet_ids" {
  value = [for az in var.azs : aws_subnet.db[az].id]
}

output "app_security_group_id" {
  value = aws_security_group.app.id
}
